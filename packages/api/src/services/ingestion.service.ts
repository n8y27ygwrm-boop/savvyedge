import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import crypto from "crypto";
import {
  prisma,
  ActorKind,
  EvidenceType,
  EvidenceVerdict,
  CasinoEvidenceField,
  BonusEvidenceField,
  ReviewStatus,
  PublicationStatus,
  Prisma,
} from "@savvyedge/database";
import {
  ScraperAgent,
  BonusAgent,
  CasinoResolutionAgent,
  GameListAgent,
  buildScrapeResultFromHtml,
  normalizeBonusExtraction,
  type BonusSourceSemantics,
  type PlaywrightScrapeResult,
  type ScraperOutput,
} from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";
import { CasinoService } from "./casino.service";
import { JobQueueService } from "./job-queue.service";
import { WorkflowTransitionService } from "./workflow-transition.service";
import { PublicationGateService } from "./publication-gate.service";
import {
  evaluateSourcePageEligibility,
  SourcePageRejectedError,
} from "./source-page-eligibility";
import {
  evaluateExtractionInputSufficiency,
  ExtractionInputRejectedError,
} from "./extraction-input-sufficiency";
import {
  BonusSourceIdentityError,
  isBonusIdentityUniqueViolation,
  isRetryableBonusIdentityTransactionError,
} from "../utils/bonus-source-identity";
import {
  EvidenceArtifactStorageService,
  prepareEvidenceArtifact,
} from "./evidence-artifact-storage.service";
import {
  EvidenceArtifactRetrievalError,
  EvidenceArtifactRetrievalService,
} from "./evidence-artifact-retrieval.service";
import { classifyGeoBlock } from "./geo-block-classifier";
import {
  createGeoFallbackCheckpoint,
  GeoFallbackCheckpointError,
  parseGeoFallbackCheckpoint,
  type GeoFallbackCheckpoint,
} from "@savvyedge/types";
import {
  ScrapingAntFallbackError,
  ScrapingAntFallbackService,
} from "./scrapingant-fallback.service";
import {
  IngestionEnqueueService,
  sanitizeUrlForLogging,
  type IngestBonusInput,
} from "./ingestion-enqueue.service";

// Re-exported so the existing public surface of this module is unchanged.
export { sanitizeUrlForLogging } from "./ingestion-enqueue.service";
export type { IngestBonusInput } from "./ingestion-enqueue.service";

export const MAX_GEO_FALLBACK_ATTEMPTS = 1;
const FALLBACK_ARTIFACT_READ_ATTEMPTS = 2;
const FALLBACK_ARTIFACT_READ_RECHECK_DELAY_MS = 25;

type CrawlScrapeResult = ScraperOutput | PlaywrightScrapeResult;

type ConsumedGeoFallbackCheckpoint = Extract<
  GeoFallbackCheckpoint,
  { state: "REQUEST_CLAIMED" | "PROVIDER_FAILED" | "FALLBACK_REJECTED" }
>;

type GeoFallbackResumeDecision =
  | { action: "STANDARD" }
  | { action: "HANDLED" }
  | { action: "LOCAL_RECOVERY"; checkpoint: ConsumedGeoFallbackCheckpoint };

type GeoFallbackRuntimeErrorCode =
  | "FALLBACK_RESULT_UNAVAILABLE"
  | "FALLBACK_REJECTED"
  | "FALLBACK_BUDGET_EXHAUSTED"
  | "FALLBACK_CONCURRENT_STATE_CHANGED"
  | "FALLBACK_ARTIFACT_MISMATCH"
  | "LOCAL_RECOVERY_REJECTED"
  | "LOCAL_RECOVERY_STILL_GEO_BLOCKED";

class GeoFallbackRuntimeError extends Error {
  public constructor(public readonly code: GeoFallbackRuntimeErrorCode) {
    super(`Geo fallback failed (${code})`);
    this.name = "GeoFallbackRuntimeError";
  }
}

function checkpointJson(
  checkpoint: GeoFallbackCheckpoint,
): Prisma.InputJsonValue {
  return checkpoint as unknown as Prisma.InputJsonValue;
}

function exactUtf8(bytes: Buffer): string {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      throw new Error("non-exact UTF-8");
    }
    return content;
  } catch {
    throw new GeoFallbackRuntimeError("FALLBACK_RESULT_UNAVAILABLE");
  }
}

function hashString(val: string): string {
  return crypto.createHash("sha256").update(val.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function parseObservedAt(value: string | Date): Date {
  const observedAt = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("INVALID_OBSERVATION_TIMESTAMP");
  }
  return observedAt;
}

export function resolveHeadlineEvidenceObservation(
  bonus: { type?: string | null; headline_value?: string | null },
  semantics: BonusSourceSemantics,
): string | null {
  const headline = bonus.headline_value?.trim();
  if (!headline) return null;

  const capParse = PublicationGateService.parseStructuredMonetaryCap(headline);
  if (capParse.status === "VALID") {
    return semantics.headlineSourceText || headline;
  }

  if (
    semantics.freeSpinCount &&
    /\b\d[\d,]*\s+free\s+spins?\b/i.test(headline)
  ) {
    return semantics.headlineSourceText || headline;
  }

  return null;
}

export function resolveBonusSourceProvenance(
  requestedUrl: string,
  scrapeJob: { canonical_url?: string | null } | null,
) {
  return {
    sourceUrl: requestedUrl,
    sourceIdentityUrl: scrapeJob?.canonical_url ?? requestedUrl,
  };
}

const ALLOWED_ERROR_NAMES = new Set([
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "AbortError",
  "TimeoutError",
  "Error",
]);

/**
 * Classifies an error for safe operational logging using a finite bounded allowlist.
 * Never emits arbitrary or mutable error.name strings.
 */
export function classifyErrorForLogging(err: unknown): string {
  if (err instanceof SourcePageRejectedError) {
    return "SOURCE_PAGE_REJECTED";
  }
  if (err instanceof Error) {
    if (typeof err.name === "string" && ALLOWED_ERROR_NAMES.has(err.name)) {
      return err.name;
    }
    return "Error";
  }
  return "UnknownError";
}

export class IngestionService {
  private static scraperAgent = new ScraperAgent();
  private static scrapingAntFallbackService = new ScrapingAntFallbackService();
  private static evidenceArtifactReader = new EvidenceArtifactRetrievalService();
  private static bonusAgent = new BonusAgent();
  private static casinoResolutionAgent = new CasinoResolutionAgent();
  private static gameListAgent = new GameListAgent();

  /**
   * Enqueues an ingestion pipeline for a given URL.
   * Asynchronous entrypoint.
   *
   * Delegates to the lightweight control-plane service so worker and web
   * runtimes share one enqueue implementation without the web runtime having
   * to load this (execution-plane) module.
   */
  public static async enqueueIngestion(input: IngestBonusInput) {
    return IngestionEnqueueService.enqueueIngestion(input);
  }

  /**
   * The crawl handler (Step 1)
   */
  public static async handleCrawl(payload: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    taskContext?: "BONUS" | "GAME_LIST";
  }) {
    const shouldProcess = await this.markScrapeJobProcessing(
      payload.scrapeJobId,
    );
    if (!shouldProcess) {
      console.log(
        `[IngestionService] ScrapeJob ${payload.scrapeJobId} is already completed; skipping duplicate crawl`,
      );
      return;
    }
    try {
      return await this.performCrawl(payload);
    } catch (error) {
      await this.markScrapeJobFailed(payload.scrapeJobId, error, "CRAWL");
      throw error;
    }
  }

  private static async performCrawl(payload: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    taskContext?: "BONUS" | "GAME_LIST";
  }) {
    const { scrapeJobId, url, casinoId, taskContext = "BONUS" } = payload;
    const safeUrl = sanitizeUrlForLogging(url);
    console.log(
      `[IngestionService] [Worker] Crawling URL: ${safeUrl} (context: ${taskContext})`,
    );

    let currentJob =
      taskContext === "BONUS"
        ? await prisma.scrapeJob.findUniqueOrThrow({
            where: { id: scrapeJobId },
          })
        : null;

    const resumeDecision: GeoFallbackResumeDecision =
      taskContext === "BONUS" && currentJob
        ? await this.resumeGeoFallbackIfNeeded(payload, currentJob)
        : { action: "STANDARD" };
    if (resumeDecision.action === "HANDLED") {
      return;
    }

    let scrapeResult: CrawlScrapeResult;
    try {
      scrapeResult = await this.scraperAgent.run({ url });
    } catch (err: unknown) {
      const errorClassification = classifyErrorForLogging(err);
      console.error(
        `[IngestionService] [Worker] Crawl failed for URL: ${safeUrl} (${errorClassification})`,
      );
      throw err;
    }

    currentJob ??= await prisma.scrapeJob.findUniqueOrThrow({
      where: { id: scrapeJobId },
    });

    if (taskContext === "BONUS") {
      if (resumeDecision.action === "LOCAL_RECOVERY") {
        return this.performLocalRecovery(
          payload,
          currentJob,
          resumeDecision.checkpoint,
          scrapeResult,
        );
      }
      const geoBlock = classifyGeoBlock({
        title: scrapeResult.title || scrapeResult.metadata?.title,
        content: scrapeResult.content,
        httpStatus: scrapeResult.httpStatus,
      });
      if (geoBlock.blocked) {
        // Bounded positive-classification signal: classifier code plus the
        // already-sanitized origin. Never page content, HTML or checkpoints.
        console.log(
          `[IngestionService] [Worker] Geo-block classified for URL: ${safeUrl} (${geoBlock.code})`,
        );
        return this.performBonusGeoFallback(payload, currentJob, scrapeResult);
      }
    }

    return this.processStandardCrawlResult(payload, currentJob, scrapeResult);
  }

  private static eligibilityForResult(
    payload: {
      url: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    scrapeResult: CrawlScrapeResult,
  ) {
    const taskContext = payload.taskContext ?? "BONUS";
    const eligibilityInput = {
      requestedUrl: payload.url,
      finalUrl: scrapeResult.finalUrl || scrapeResult.url || payload.url,
      canonicalUrl: scrapeResult.canonicalUrl,
      title: scrapeResult.title || scrapeResult.metadata?.title,
      content: scrapeResult.content,
      taskContext,
    } as const;
    const eligibility = evaluateSourcePageEligibility(eligibilityInput);
    return { eligibilityInput, eligibility };
  }

  private static async findPreviousDuplicate(
    currentJob: { id: string; data_source_id: string },
    hashes: { htmlHash?: string | null; contentHash?: string | null },
  ) {
    const previousJob = await prisma.scrapeJob.findFirst({
      where: {
        data_source_id: currentJob.data_source_id,
        status: "COMPLETED",
        id: { not: currentJob.id },
      },
      orderBy: { completed_at: "desc" },
    });

    return previousJob &&
      ((hashes.contentHash &&
        previousJob.content_hash === hashes.contentHash) ||
        (hashes.htmlHash && previousJob.html_hash === hashes.htmlHash))
      ? previousJob
      : null;
  }

  private static async processStandardCrawlResult(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: {
      id: string;
      data_source_id: string;
      retry_count?: number;
    },
    scrapeResult: CrawlScrapeResult,
  ) {
    const { scrapeJobId, url, taskContext = "BONUS" } = payload;
    const { eligibilityInput, eligibility } = this.eligibilityForResult(
      payload,
      scrapeResult,
    );
    if (!eligibility.eligible) {
      throw new SourcePageRejectedError(eligibilityInput, eligibility);
    }

    const observedAt = parseObservedAt(scrapeResult.timestamp);
    const canonicalUrl =
      scrapeResult.canonicalUrl ||
      scrapeResult.finalUrl ||
      scrapeResult.url ||
      url;

    const previousJob = await this.findPreviousDuplicate(currentJob, {
      contentHash: scrapeResult.contentHash,
      htmlHash: scrapeResult.htmlHash,
    });

    if (previousJob) {
      console.log(
        `[IngestionService] Content hash matches previous crawl. Short-circuiting ingestion. Skipping LLM parsing.`,
      );
      if (taskContext === "BONUS") {
        const update = await prisma.scrapeJob.updateMany({
          where: {
            id: scrapeJobId,
            retry_count: currentJob.retry_count ?? 0,
            geo_fallback_checkpoint: { equals: Prisma.DbNull },
          },
          data: {
            snapshot_path: null,
            html_hash: scrapeResult.htmlHash || null,
            content_hash: scrapeResult.contentHash || null,
            canonical_url: canonicalUrl,
            status: "COMPLETED",
            completed_at: new Date(),
          },
        });
        if (update.count !== 1) {
          throw new GeoFallbackRuntimeError(
            "FALLBACK_CONCURRENT_STATE_CHANGED",
          );
        }
      } else {
        await prisma.scrapeJob.update({
          where: { id: scrapeJobId },
          data: {
            snapshot_path: null,
            html_hash: scrapeResult.htmlHash || null,
            content_hash: scrapeResult.contentHash || null,
            canonical_url: canonicalUrl,
            status: "COMPLETED",
            completed_at: new Date(),
          },
        });
      }
      return;
    }

    const persistedArtifact =
      await EvidenceArtifactStorageService.persistObservation({
        rawHtml: scrapeResult.rawHtml ?? "",
        expectedHtmlHash: scrapeResult.htmlHash ?? "",
        observationId: scrapeJobId,
        sourceUrl: scrapeResult.finalUrl || scrapeResult.url || url,
        observedAt,
      });

    if (taskContext === "BONUS") {
      const update = await prisma.scrapeJob.updateMany({
        where: {
          id: scrapeJobId,
          retry_count: currentJob.retry_count ?? 0,
          geo_fallback_checkpoint: { equals: Prisma.DbNull },
        },
        data: {
          snapshot_path: persistedArtifact.locator,
          html_hash: persistedArtifact.htmlHash,
          content_hash: scrapeResult.contentHash || null,
          canonical_url: canonicalUrl,
        },
      });
      if (update.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
    } else {
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: {
          snapshot_path: persistedArtifact.locator,
          html_hash: persistedArtifact.htmlHash,
          content_hash: scrapeResult.contentHash || null,
          canonical_url: canonicalUrl,
        },
      });
    }

    return this.enqueueExtractionForResult(payload, scrapeResult, observedAt);
  }

  private static async enqueueExtractionForResult(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    scrapeResult: CrawlScrapeResult,
    observedAt: Date,
  ) {
    const {
      scrapeJobId,
      url,
      casinoId,
      taskContext = "BONUS",
    } = payload;
    const safeUrl = sanitizeUrlForLogging(url);

    // Extraction-input boundary. The durable artifact and its provenance are
    // already committed above, so a rejection here keeps the raw HTML available
    // for diagnosis while guaranteeing that unusable text never reaches an
    // extraction agent. Throwing hands the job back to the existing crawl queue
    // retry path; no new queue status or payload is introduced.
    //
    // Enforced for BONUS only. GAME_LIST keeps its previous runtime behaviour:
    // its vocabulary is indistinguishable from casino navigation, and a real
    // lobby often renders only game titles, so gating it would both fail to
    // block chrome and reject legitimate lobbies. The policy stays extensible
    // for GAME_LIST pending an element-aware signal.
    if (taskContext === "BONUS") {
      const sufficiency = evaluateExtractionInputSufficiency({
        content: scrapeResult.content,
        taskContext,
      });
      if (!sufficiency.sufficient) {
        console.error(
          `[IngestionService] [Worker] Extraction input rejected for URL: ${safeUrl} (${sufficiency.category})`,
        );
        throw new ExtractionInputRejectedError(sufficiency);
      }
    }

    if (taskContext === "GAME_LIST") {
      if (!casinoId) {
        throw new Error("GAME_LIST crawl payload missing mandatory casinoId");
      }
      await JobQueueService.enqueue(INGESTION_QUEUE_NAME, "EXTRACT_GAME_LIST", {
        scrapeJobId,
        url,
        casinoId,
        scrapedContent: scrapeResult.content,
      });
    } else {
      await JobQueueService.enqueue(
        INGESTION_QUEUE_NAME,
        "EXTRACT_BONUS",
        {
          scrapeJobId,
          url,
          casinoId,
          scrapedContent: scrapeResult.content,
          scrapedMetadata: scrapeResult.metadata,
          observedAt: observedAt.toISOString(),
        },
        { deduplicate: true },
      );
    }
  }

  private static async performLocalRecovery(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: {
      id: string;
      data_source_id: string;
      retry_count: number;
    },
    previousCheckpoint: ConsumedGeoFallbackCheckpoint,
    primaryResult: CrawlScrapeResult,
  ) {
    const geoBlock = classifyGeoBlock({
      title: primaryResult.title || primaryResult.metadata?.title,
      content: primaryResult.content,
      httpStatus: primaryResult.httpStatus,
    });
    if (geoBlock.blocked) {
      throw new GeoFallbackRuntimeError(
        "LOCAL_RECOVERY_STILL_GEO_BLOCKED",
      );
    }

    const { eligibility } = this.eligibilityForResult(payload, primaryResult);
    if (!eligibility.eligible) {
      throw new GeoFallbackRuntimeError("LOCAL_RECOVERY_REJECTED");
    }

    const contentHash =
      primaryResult.contentHash ||
      crypto.createHash("sha256").update(primaryResult.content).digest("hex");
    const rawHtml = primaryResult.rawHtml ?? "";
    const htmlHash =
      primaryResult.htmlHash ||
      crypto.createHash("sha256").update(rawHtml).digest("hex");

    const sufficiency = evaluateExtractionInputSufficiency({
      content: primaryResult.content,
      taskContext: "BONUS",
    });
    const previousJob = sufficiency.sufficient
      ? await this.findPreviousDuplicate(currentJob, {
          contentHash,
          htmlHash,
        })
      : null;
    if (previousJob) {
      const deduplicatedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "DEDUPLICATED",
        priorScrapeJobId: previousJob.id,
      });
      const completed = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count,
          geo_fallback_checkpoint: {
            equals: checkpointJson(previousCheckpoint),
          },
        },
        data: {
          snapshot_path: null,
          html_hash: htmlHash,
          content_hash: contentHash,
          canonical_url:
            primaryResult.canonicalUrl ||
            primaryResult.finalUrl ||
            primaryResult.url ||
            payload.url,
          geo_fallback_checkpoint: checkpointJson(deduplicatedCheckpoint),
          status: "COMPLETED",
          completed_at: new Date(),
        },
      });
      if (completed.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      return;
    }

    const observedAt = parseObservedAt(primaryResult.timestamp);
    const persistedArtifact =
      await EvidenceArtifactStorageService.persistObservation({
        rawHtml,
        expectedHtmlHash: htmlHash,
        observationId: `${payload.scrapeJobId}_local_recovery`,
        sourceUrl:
          primaryResult.finalUrl || primaryResult.url || payload.url,
        observedAt,
      });
    const recoveredCheckpoint = sufficiency.sufficient
      ? createGeoFallbackCheckpoint({
          version: 1,
          state: "LOCAL_RECOVERED",
          locator: persistedArtifact.locator,
          htmlHash: persistedArtifact.htmlHash,
          contentHash,
          observedAt: observedAt.toISOString(),
        })
      : createGeoFallbackCheckpoint({
          version: 1,
          state: "EXTRACTION_REJECTED",
          locator: persistedArtifact.locator,
          htmlHash: persistedArtifact.htmlHash,
          contentHash,
          observedAt: observedAt.toISOString(),
          reason: "EXTRACTION_INPUT_INSUFFICIENT",
        });
    const recovered = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: currentJob.retry_count,
        geo_fallback_checkpoint: {
          equals: checkpointJson(previousCheckpoint),
        },
      },
      data: {
        snapshot_path: persistedArtifact.locator,
        html_hash: persistedArtifact.htmlHash,
        content_hash: contentHash,
        canonical_url:
          primaryResult.canonicalUrl ||
          primaryResult.finalUrl ||
          primaryResult.url ||
          payload.url,
        geo_fallback_checkpoint: checkpointJson(recoveredCheckpoint),
      },
    });
    if (recovered.count !== 1) {
      throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
    }

    if (!sufficiency.sufficient) {
      throw new ExtractionInputRejectedError(sufficiency);
    }

    return this.enqueueExtractionForResult(
      payload,
      primaryResult,
      observedAt,
    );
  }

  private static async performBonusGeoFallback(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: {
      id: string;
      data_source_id: string;
      retry_count?: number;
      snapshot_path?: string | null;
      html_hash?: string | null;
      content_hash?: string | null;
      geo_fallback_checkpoint?: Prisma.JsonValue | null;
    },
    primaryResult: CrawlScrapeResult,
  ) {
    const observedAt = parseObservedAt(primaryResult.timestamp);
    const persistedPrimary =
      await EvidenceArtifactStorageService.persistObservation({
        rawHtml: primaryResult.rawHtml ?? "",
        expectedHtmlHash: primaryResult.htmlHash ?? "",
        observationId: `${payload.scrapeJobId}_geo_primary`,
        sourceUrl: primaryResult.finalUrl || primaryResult.url || payload.url,
        observedAt,
      });
    const primaryCheckpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "PRIMARY_BLOCKED",
    });

    const primaryWrite = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: currentJob.retry_count ?? 0,
        geo_fallback_checkpoint: { equals: Prisma.DbNull },
      },
      data: {
        snapshot_path: persistedPrimary.locator,
        html_hash: persistedPrimary.htmlHash,
        content_hash: primaryResult.contentHash || null,
        canonical_url:
          primaryResult.canonicalUrl ||
          primaryResult.finalUrl ||
          primaryResult.url ||
          payload.url,
        geo_fallback_checkpoint: checkpointJson(primaryCheckpoint),
      },
    });

    if (primaryWrite.count !== 1) {
      const latest = await prisma.scrapeJob.findUniqueOrThrow({
        where: { id: payload.scrapeJobId },
      });
      const decision = await this.resumeGeoFallbackIfNeeded(payload, latest);
      if (decision.action === "HANDLED") return;
      if (decision.action === "LOCAL_RECOVERY") {
        throw new GeoFallbackRuntimeError(
          "LOCAL_RECOVERY_STILL_GEO_BLOCKED",
        );
      }
      throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
    }

    return this.claimAndExecuteGeoFallback(
      payload,
      { ...currentJob, retry_count: currentJob.retry_count ?? 0 },
      primaryCheckpoint,
    );
  }

  private static async claimAndExecuteGeoFallback(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: { id: string; data_source_id: string; retry_count: number },
    primaryCheckpoint: Extract<
      GeoFallbackCheckpoint,
      { state: "PRIMARY_BLOCKED" }
    >,
  ) {
    if (currentJob.retry_count >= MAX_GEO_FALLBACK_ATTEMPTS) {
      throw new GeoFallbackRuntimeError("FALLBACK_BUDGET_EXHAUSTED");
    }
    const claimedCheckpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "REQUEST_CLAIMED",
    });
    const claim = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: { lt: MAX_GEO_FALLBACK_ATTEMPTS },
        geo_fallback_checkpoint: { equals: checkpointJson(primaryCheckpoint) },
      },
      data: {
        retry_count: { increment: 1 },
        geo_fallback_checkpoint: checkpointJson(claimedCheckpoint),
      },
    });

    if (claim.count !== 1) {
      const latest = await prisma.scrapeJob.findUniqueOrThrow({
        where: { id: payload.scrapeJobId },
      });
      const latestCheckpoint = parseGeoFallbackCheckpoint(
        latest.geo_fallback_checkpoint,
      );
      if (latestCheckpoint?.state === "PRIMARY_BLOCKED") {
        if (latest.retry_count >= MAX_GEO_FALLBACK_ATTEMPTS) {
          throw new GeoFallbackRuntimeError("FALLBACK_BUDGET_EXHAUSTED");
        }
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      const decision = await this.resumeGeoFallbackIfNeeded(payload, latest);
      if (decision.action === "HANDLED") return;
      throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
    }

    // Two irreducible outcome-unknown windows remain by design:
    // 1. a worker can die after this paid-call claim but before the request;
    // 2. it can die after provider success but before RESULT_READY is stored.
    // Retrying the provider in either case could exceed the one-credit budget,
    // so these states never pay again. A later queue delivery may still make
    // one free local-browser recovery attempt.
    let paidResult: Awaited<
      ReturnType<ScrapingAntFallbackService["scrape"]>
    >;
    try {
      paidResult = await this.scrapingAntFallbackService.scrape(payload.url);
    } catch (error: unknown) {
      const boundedError =
        error instanceof ScrapingAntFallbackError
          ? error
          : new ScrapingAntFallbackError("INVALID_RESPONSE");
      const failedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "PROVIDER_FAILED",
        reason: boundedError.code,
      });
      const failed = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count + 1,
          geo_fallback_checkpoint: { equals: checkpointJson(claimedCheckpoint) },
        },
        data: {
          geo_fallback_checkpoint: checkpointJson(failedCheckpoint),
        },
      });
      if (failed.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      throw boundedError;
    }

    const fallbackResult = buildScrapeResultFromHtml({
      url: payload.url,
      finalUrl: payload.url,
      rawHtml: paidResult.rawHtml,
      timestamp: paidResult.observedAt,
      attemptCount: 1,
      durationMs: 0,
    });

    const repeatedGeoBlock = classifyGeoBlock({
      title: fallbackResult.title || fallbackResult.metadata.title,
      content: fallbackResult.content,
      httpStatus: fallbackResult.httpStatus,
    });
    const { eligibilityInput, eligibility } = this.eligibilityForResult(
      payload,
      fallbackResult,
    );
    if (repeatedGeoBlock.blocked || !eligibility.eligible) {
      const rejectedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "FALLBACK_REJECTED",
        reason: repeatedGeoBlock.blocked
          ? "STILL_GEO_BLOCKED"
          : "SOURCE_PAGE_REJECTED",
      });
      const rejected = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count + 1,
          geo_fallback_checkpoint: { equals: checkpointJson(claimedCheckpoint) },
        },
        data: {
          geo_fallback_checkpoint: checkpointJson(rejectedCheckpoint),
        },
      });
      if (rejected.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      if (!eligibility.eligible) {
        throw new SourcePageRejectedError(eligibilityInput, eligibility);
      }
      throw new GeoFallbackRuntimeError("FALLBACK_REJECTED");
    }

    const sufficiency = evaluateExtractionInputSufficiency({
      content: fallbackResult.content,
      taskContext: "BONUS",
    });

    const previousJob = sufficiency.sufficient
      ? await this.findPreviousDuplicate(currentJob, {
          contentHash: fallbackResult.contentHash,
          htmlHash: fallbackResult.htmlHash,
        })
      : null;
    if (previousJob) {
      const deduplicatedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "DEDUPLICATED",
        priorScrapeJobId: previousJob.id,
      });
      const completed = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count + 1,
          geo_fallback_checkpoint: { equals: checkpointJson(claimedCheckpoint) },
        },
        data: {
          snapshot_path: null,
          html_hash: fallbackResult.htmlHash,
          content_hash: fallbackResult.contentHash,
          canonical_url:
            fallbackResult.canonicalUrl || fallbackResult.finalUrl || payload.url,
          geo_fallback_checkpoint: checkpointJson(deduplicatedCheckpoint),
          status: "COMPLETED",
          completed_at: new Date(),
        },
      });
      if (completed.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      return;
    }

    const artifactInput = {
      rawHtml: fallbackResult.rawHtml,
      expectedHtmlHash: fallbackResult.htmlHash,
      observationId: `${payload.scrapeJobId}_geo_fallback`,
      sourceUrl: fallbackResult.finalUrl || fallbackResult.url || payload.url,
      observedAt: fallbackResult.timestamp,
    };
    const preparedArtifact = prepareEvidenceArtifact(artifactInput);
    const resultReadyCheckpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "RESULT_READY",
      locator: preparedArtifact.locator,
      htmlHash: fallbackResult.htmlHash,
      contentHash: fallbackResult.contentHash,
      observedAt: fallbackResult.timestamp.toISOString(),
    });
    // Persist the deterministic plan before object storage. A crash after the
    // upload can then recover by reading this exact locator; a crash before the
    // upload gets only the bounded visibility recheck in rebuildFallbackResult.
    const checkpointed = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: currentJob.retry_count + 1,
        geo_fallback_checkpoint: { equals: checkpointJson(claimedCheckpoint) },
      },
      data: {
        geo_fallback_checkpoint: checkpointJson(resultReadyCheckpoint),
      },
    });
    if (checkpointed.count !== 1) {
      throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
    }

    const persistedFallback =
      await EvidenceArtifactStorageService.persistObservation(artifactInput);
    if (
      persistedFallback.locator !== preparedArtifact.locator ||
      persistedFallback.htmlHash !== preparedArtifact.htmlHash
    ) {
      throw new GeoFallbackRuntimeError("FALLBACK_ARTIFACT_MISMATCH");
    }

    const extractionReadyCheckpoint = sufficiency.sufficient
      ? createGeoFallbackCheckpoint({
          ...resultReadyCheckpoint,
          state: "AVAILABLE",
        })
      : createGeoFallbackCheckpoint({
          ...resultReadyCheckpoint,
          state: "EXTRACTION_REJECTED",
          reason: "EXTRACTION_INPUT_INSUFFICIENT",
        });
    const promoted = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: currentJob.retry_count + 1,
        geo_fallback_checkpoint: {
          equals: checkpointJson(resultReadyCheckpoint),
        },
      },
      data: {
        snapshot_path: persistedFallback.locator,
        html_hash: persistedFallback.htmlHash,
        content_hash: fallbackResult.contentHash,
        canonical_url:
          fallbackResult.canonicalUrl || fallbackResult.finalUrl || payload.url,
        geo_fallback_checkpoint: checkpointJson(extractionReadyCheckpoint),
      },
    });
    if (promoted.count !== 1) {
      throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
    }

    if (!sufficiency.sufficient) {
      throw new ExtractionInputRejectedError(sufficiency);
    }

    return this.enqueueExtractionForResult(
      payload,
      fallbackResult,
      fallbackResult.timestamp,
    );
  }

  private static async resumeGeoFallbackIfNeeded(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: {
      id: string;
      data_source_id: string;
      retry_count: number;
      snapshot_path: string | null;
      html_hash: string | null;
      content_hash: string | null;
      geo_fallback_checkpoint: Prisma.JsonValue | null;
    },
  ): Promise<GeoFallbackResumeDecision> {
    const checkpoint = parseGeoFallbackCheckpoint(
      currentJob.geo_fallback_checkpoint,
    );
    if (!checkpoint) {
      return { action: "STANDARD" };
    }

    if (checkpoint.state === "PRIMARY_BLOCKED") {
      if (currentJob.retry_count >= MAX_GEO_FALLBACK_ATTEMPTS) {
        throw new GeoFallbackRuntimeError("FALLBACK_BUDGET_EXHAUSTED");
      }
      await this.claimAndExecuteGeoFallback(
        payload,
        {
          id: currentJob.id,
          data_source_id: currentJob.data_source_id,
          retry_count: currentJob.retry_count,
        },
        checkpoint,
      );
      return { action: "HANDLED" };
    }

    if (checkpoint.state === "DEDUPLICATED") {
      return { action: "HANDLED" };
    }
    if (
      checkpoint.state === "REQUEST_CLAIMED" ||
      checkpoint.state === "PROVIDER_FAILED" ||
      checkpoint.state === "FALLBACK_REJECTED"
    ) {
      return { action: "LOCAL_RECOVERY", checkpoint };
    }

    if (checkpoint.state === "EXTRACTION_REJECTED") {
      if (
        currentJob.snapshot_path !== checkpoint.locator ||
        currentJob.html_hash !== checkpoint.htmlHash ||
        currentJob.content_hash !== checkpoint.contentHash
      ) {
        throw new GeoFallbackCheckpointError();
      }
      const rejection = evaluateExtractionInputSufficiency({
        content: "",
        taskContext: "BONUS",
      });
      if (rejection.sufficient) {
        throw new GeoFallbackRuntimeError("FALLBACK_REJECTED");
      }
      throw new ExtractionInputRejectedError(rejection);
    }

    if (
      checkpoint.state === "AVAILABLE" ||
      checkpoint.state === "LOCAL_RECOVERED"
    ) {
      if (
        currentJob.snapshot_path !== checkpoint.locator ||
        currentJob.html_hash !== checkpoint.htmlHash ||
        currentJob.content_hash !== checkpoint.contentHash
      ) {
        throw new GeoFallbackCheckpointError();
      }
      const result = await this.rebuildFallbackResult(payload, checkpoint);
      await this.finishRecoveredExtractionReadyArtifact(
        payload,
        currentJob,
        checkpoint,
        result,
      );
      return { action: "HANDLED" };
    }

    const result = await this.rebuildFallbackResult(payload, checkpoint);
    const sufficiency = evaluateExtractionInputSufficiency({
      content: result.content,
      taskContext: "BONUS",
    });
    if (!sufficiency.sufficient) {
      const rejectedCheckpoint = createGeoFallbackCheckpoint({
        ...checkpoint,
        state: "EXTRACTION_REJECTED",
        reason: "EXTRACTION_INPUT_INSUFFICIENT",
      });
      const rejected = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count,
          geo_fallback_checkpoint: { equals: checkpointJson(checkpoint) },
          snapshot_path: currentJob.snapshot_path,
          html_hash: currentJob.html_hash,
        },
        data: {
          snapshot_path: checkpoint.locator,
          html_hash: checkpoint.htmlHash,
          content_hash: checkpoint.contentHash,
          canonical_url: result.canonicalUrl || result.finalUrl || payload.url,
          geo_fallback_checkpoint: checkpointJson(rejectedCheckpoint),
        },
      });
      if (rejected.count !== 1) {
        const latest = await prisma.scrapeJob.findUniqueOrThrow({
          where: { id: payload.scrapeJobId },
        });
        const latestCheckpoint = parseGeoFallbackCheckpoint(
          latest.geo_fallback_checkpoint,
        );
        if (
          latestCheckpoint?.state !== "EXTRACTION_REJECTED" ||
          latestCheckpoint.htmlHash !== checkpoint.htmlHash
        ) {
          throw new GeoFallbackRuntimeError(
            "FALLBACK_CONCURRENT_STATE_CHANGED",
          );
        }
      }
      throw new ExtractionInputRejectedError(sufficiency);
    }

    const previousJob = await this.findPreviousDuplicate(currentJob, {
      contentHash: checkpoint.contentHash,
      htmlHash: checkpoint.htmlHash,
    });
    if (previousJob) {
      const deduplicatedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "DEDUPLICATED",
        priorScrapeJobId: previousJob.id,
      });
      const completed = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count,
          geo_fallback_checkpoint: { equals: checkpointJson(checkpoint) },
        },
        data: {
          snapshot_path: null,
          html_hash: checkpoint.htmlHash,
          content_hash: checkpoint.contentHash,
          canonical_url: result.canonicalUrl || result.finalUrl || payload.url,
          geo_fallback_checkpoint: checkpointJson(deduplicatedCheckpoint),
          status: "COMPLETED",
          completed_at: new Date(),
        },
      });
      if (completed.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      return { action: "HANDLED" };
    }

    const availableCheckpoint = createGeoFallbackCheckpoint({
      ...checkpoint,
      state: "AVAILABLE",
    });
    const promoted = await prisma.scrapeJob.updateMany({
      where: {
        id: payload.scrapeJobId,
        retry_count: currentJob.retry_count,
        geo_fallback_checkpoint: { equals: checkpointJson(checkpoint) },
        snapshot_path: currentJob.snapshot_path,
        html_hash: currentJob.html_hash,
      },
      data: {
        snapshot_path: checkpoint.locator,
        html_hash: checkpoint.htmlHash,
        content_hash: checkpoint.contentHash,
        canonical_url: result.canonicalUrl || result.finalUrl || payload.url,
        geo_fallback_checkpoint: checkpointJson(availableCheckpoint),
      },
    });
    if (promoted.count !== 1) {
      const latest = await prisma.scrapeJob.findUniqueOrThrow({
        where: { id: payload.scrapeJobId },
      });
      const latestCheckpoint = parseGeoFallbackCheckpoint(
        latest.geo_fallback_checkpoint,
      );
      if (
        latestCheckpoint?.state !== "AVAILABLE" ||
        latestCheckpoint.htmlHash !== checkpoint.htmlHash
      ) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
    }

    await this.finishRecoveredExtractionReadyArtifact(
      payload,
      currentJob,
      availableCheckpoint,
      result,
    );
    return { action: "HANDLED" };
  }

  private static async rebuildFallbackResult(
    payload: { url: string },
    checkpoint: Extract<
      GeoFallbackCheckpoint,
      { state: "RESULT_READY" | "AVAILABLE" | "LOCAL_RECOVERED" }
    >,
  ): Promise<PlaywrightScrapeResult> {
    let artifact: Awaited<
      ReturnType<EvidenceArtifactRetrievalService["readArtifact"]>
    > | null = null;

    for (
      let attempt = 1;
      attempt <= FALLBACK_ARTIFACT_READ_ATTEMPTS;
      attempt += 1
    ) {
      try {
        artifact = await this.evidenceArtifactReader.readArtifact({
          locator: checkpoint.locator,
          expectedHtmlHash: checkpoint.htmlHash,
        });
        break;
      } catch (error: unknown) {
        const canRecheck =
          error instanceof EvidenceArtifactRetrievalError &&
          error.code === "ARTIFACT_NOT_AVAILABLE" &&
          attempt < FALLBACK_ARTIFACT_READ_ATTEMPTS;
        if (!canRecheck) {
          throw new GeoFallbackRuntimeError("FALLBACK_RESULT_UNAVAILABLE");
        }
        await new Promise((resolve) =>
          setTimeout(resolve, FALLBACK_ARTIFACT_READ_RECHECK_DELAY_MS),
        );
      }
    }
    if (!artifact) {
      throw new GeoFallbackRuntimeError("FALLBACK_RESULT_UNAVAILABLE");
    }

    return buildScrapeResultFromHtml({
      url: payload.url,
      finalUrl: payload.url,
      rawHtml: exactUtf8(artifact.bytes),
      timestamp: new Date(checkpoint.observedAt),
      attemptCount: 0,
      durationMs: 0,
    });
  }

  private static async finishRecoveredExtractionReadyArtifact(
    payload: {
      scrapeJobId: string;
      url: string;
      casinoId?: string;
      taskContext?: "BONUS" | "GAME_LIST";
    },
    currentJob: { id: string; data_source_id: string; retry_count: number },
    checkpoint: Extract<
      GeoFallbackCheckpoint,
      { state: "AVAILABLE" | "LOCAL_RECOVERED" }
    >,
    result: PlaywrightScrapeResult,
  ) {
    const repeatedGeoBlock = classifyGeoBlock({
      title: result.title || result.metadata.title,
      content: result.content,
      httpStatus: result.httpStatus,
    });
    const { eligibilityInput, eligibility } = this.eligibilityForResult(
      payload,
      result,
    );
    if (repeatedGeoBlock.blocked || !eligibility.eligible) {
      throw !eligibility.eligible
        ? new SourcePageRejectedError(eligibilityInput, eligibility)
        : new GeoFallbackRuntimeError("FALLBACK_REJECTED");
    }

    const previousJob = await this.findPreviousDuplicate(currentJob, {
      contentHash: result.contentHash,
      htmlHash: result.htmlHash,
    });
    if (previousJob) {
      const deduplicatedCheckpoint = createGeoFallbackCheckpoint({
        version: 1,
        state: "DEDUPLICATED",
        priorScrapeJobId: previousJob.id,
      });
      const completed = await prisma.scrapeJob.updateMany({
        where: {
          id: payload.scrapeJobId,
          retry_count: currentJob.retry_count,
          geo_fallback_checkpoint: { equals: checkpointJson(checkpoint) },
        },
        data: {
          snapshot_path: null,
          html_hash: result.htmlHash,
          content_hash: result.contentHash,
          canonical_url: result.canonicalUrl || result.finalUrl || payload.url,
          geo_fallback_checkpoint: checkpointJson(deduplicatedCheckpoint),
          status: "COMPLETED",
          completed_at: new Date(),
        },
      });
      if (completed.count !== 1) {
        throw new GeoFallbackRuntimeError("FALLBACK_CONCURRENT_STATE_CHANGED");
      }
      return;
    }

    return this.enqueueExtractionForResult(payload, result, result.timestamp);
  }

  /**
   * The extraction handler (Step 2 - Bonus)
   */
  public static async handleExtraction(payload: {
    scrapeJobId?: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    scrapedMetadata?: any;
    observedAt: string;
  }) {
    if (payload.scrapeJobId) {
      const shouldProcess = await this.markScrapeJobProcessing(
        payload.scrapeJobId,
      );
      if (!shouldProcess) {
        console.log(
          `[IngestionService] ScrapeJob ${payload.scrapeJobId} is already completed; skipping duplicate bonus extraction`,
        );
        return;
      }
    }
    try {
      return await this.performExtraction(payload);
    } catch (error) {
      if (payload.scrapeJobId) {
        await this.markScrapeJobFailed(payload.scrapeJobId, error, "BONUS");
      }
      throw error;
    }
  }

  private static async performExtraction(payload: {
    scrapeJobId?: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    scrapedMetadata?: any;
    observedAt: string;
  }) {
    const {
      scrapeJobId,
      url,
      casinoId,
      scrapedContent,
      scrapedMetadata,
      observedAt,
    } = payload;
    const sourceObservedAt = parseObservedAt(observedAt);
    const safeUrl = sanitizeUrlForLogging(url);
    console.log(`[IngestionService] [Worker] Extracting entities for URL: ${safeUrl}`);

    // 1. Resolve domain
    let domain = "example.com";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = "<invalid-domain>";
    }

    // 2. AI Entity Resolution (executed outside DB transaction)
    let initialCasino = casinoId ? await prisma.casino.findUnique({ where: { id: casinoId } }) : null;
    let resolvedIdentity: { name: string; slug: string; domain?: string; website_url?: string; license_info?: string | null } | null = null;

    if (!initialCasino) {
      console.log(`[IngestionService] [Worker] Resolving casino entity for domain '${domain}'...`);
      resolvedIdentity = await this.casinoResolutionAgent.run({
        url,
        domain,
        pageMetadata: scrapedMetadata,
        scrapedContentSnippet: scrapedContent,
      });
    }

    const dummyCasinoId = "00000000-0000-0000-0000-000000000000";
    const targetCasinoId = initialCasino?.id || dummyCasinoId;
    const extractedBonusInput = await this.bonusAgent.run({
      rawBonusText: scrapedContent,
      casino_id: targetCasinoId,
    });
    const { bonus: bonusInput, semantics: bonusSourceSemantics } =
      normalizeBonusExtraction(scrapedContent, extractedBonusInput);

    // 3. Governed Persistence inside a Single Atomic Transaction
    const { casino, bonus, evidence } =
      await this.runGovernedPersistenceTransaction(async (tx) => {
      // a. Resolve/Upsert Service Actor (service:ingestion)
      const actor = await tx.reviewActor.upsert({
        where: { stable_key: "service:ingestion" },
        update: { active: true },
        create: {
          kind: ActorKind.SERVICE,
          stable_key: "service:ingestion",
          display_name: "Ingestion Service",
          active: true,
        },
        select: { id: true },
      });

      // b. Resolve or Create Casino
      let activeCasino = initialCasino;
      let isNewCasino = false;
      let isCasinoApprovedOrPublished = false;
      let hasCasinoFieldDiffs = false;
      if (!activeCasino) {
        const res = await CasinoService.resolveOrCreateCasino({
          name: resolvedIdentity!.name,
          slug: resolvedIdentity!.slug,
          domain: resolvedIdentity!.domain || domain,
          website_url: resolvedIdentity!.website_url,
          license_info: resolvedIdentity!.license_info ?? null,
        }, tx);
        activeCasino = res.casino;
        isNewCasino = res.isNew;
        isCasinoApprovedOrPublished = res.isApprovedOrPublished;
        hasCasinoFieldDiffs = res.hasFieldDiffs;
      } else {
        isCasinoApprovedOrPublished =
          activeCasino.review_status === ReviewStatus.APPROVED ||
          activeCasino.publication_status === PublicationStatus.PUBLISHED;
        hasCasinoFieldDiffs =
          Boolean(resolvedIdentity?.name && resolvedIdentity.name !== activeCasino.name) ||
          Boolean(resolvedIdentity?.website_url && resolvedIdentity.website_url !== activeCasino.website_url) ||
          Boolean(resolvedIdentity?.license_info !== undefined && resolvedIdentity.license_info !== activeCasino.license_info);
      }

      const safeCasino = activeCasino!;

      // c. Resolve the current ScrapeJob and its stable source provenance
      const scrapeJob = scrapeJobId
        ? await tx.scrapeJob.findUnique({ where: { id: scrapeJobId } })
        : null;
      const bonusProvenance = resolveBonusSourceProvenance(url, scrapeJob);

      // d. Create or Update Bonus through its source-offer identity
      const bonusPayload = { ...bonusInput, casino_id: safeCasino.id };
      const {
        bonus: savedBonus,
        isNew: isNewBonus,
        isApprovedOrPublished: isBonusApprovedOrPublished,
        hasFieldDiffs: hasBonusFieldDiffs,
      } = await BonusService.saveGovernedBonus(
        bonusPayload,
        bonusProvenance,
        tx,
      );

      // e. Resolve DataSource
      let dataSourceId = scrapeJob ? scrapeJob.data_source_id : null;
      if (!dataSourceId) {
        let ds = await tx.dataSource.findFirst({ where: { url } });
        if (!ds) {
          ds = await tx.dataSource.create({
            data: {
              url,
              source_type: "CASINO_PROMOTION_PAGE",
              last_scraped_at: new Date(),
            },
          });
        }
        dataSourceId = ds.id;
      }

      // e. Create Single Shared EvidenceRecord
      const now = new Date();
      const evidenceRecord = await tx.evidenceRecord.create({
        data: {
          data_source_id: dataSourceId,
          scrape_job_id: scrapeJob ? scrapeJob.id : null,
          evidence_type: EvidenceType.OPERATOR_PAGE,
          source_url: url,
          snapshot_path: scrapeJob?.snapshot_path || null,
          html_hash: scrapeJob?.html_hash || null,
          content_hash: scrapeJob?.content_hash || null,
          observed_at: sourceObservedAt,
          extracted_at: now,
          created_by_id: actor.id,
        },
      });

      // f. Create Casino Evidence Claims
      const casinoClaimIds: string[] = [];
      const casinoObservedName = resolvedIdentity?.name || safeCasino.name;
      const casinoObservedUrl = resolvedIdentity?.website_url || safeCasino.website_url;
      const casinoObservedLicense = resolvedIdentity?.license_info ?? safeCasino.license_info;

      if (isNewCasino || hasCasinoFieldDiffs) {
        if (casinoObservedName) {
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.NAME,
              observed_value: casinoObservedName,
              normalized_value_hash: `normalizer-v1:NAME:${hashString(casinoObservedName)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
        if (casinoObservedUrl) {
          const host = PublicationGateService.normalizeDomainHost(casinoObservedUrl);
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.WEBSITE_HOST,
              observed_value: casinoObservedUrl,
              normalized_value_hash: `normalizer-v1:WEBSITE_HOST:${hashString(host)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
        if (casinoObservedLicense) {
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.LICENSE_ASSOCIATION,
              observed_value: casinoObservedLicense,
              normalized_value_hash: `normalizer-v1:LICENSE:${hashString(casinoObservedLicense)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
      }

      // g. Create Bonus Evidence Claims from newly extracted bonusInput
      const bonusClaimIds: string[] = [];
      const extractedType = bonusInput.type || savedBonus.type;
      if (extractedType) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.TYPE,
            observed_value: extractedType,
            normalized_value_hash: `normalizer-v1:TYPE:${hashString(extractedType)}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      const headlineEvidence = resolveHeadlineEvidenceObservation(
        bonusInput,
        bonusSourceSemantics,
      );
      if (headlineEvidence) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.HEADLINE_VALUE,
            observed_value: headlineEvidence,
            normalized_value_hash: `normalizer-v1:HEADLINE:${hashString(headlineEvidence)}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.wagering_requirement !== null && bonusInput.wagering_requirement !== undefined) {
        const scopedWageringEvidence =
          bonusSourceSemantics.wagering?.scope === "FREE_SPIN_WINNINGS" &&
          bonusSourceSemantics.wagering.multiplier === bonusInput.wagering_requirement
            ? bonusSourceSemantics.wagering.sourceText
            : String(bonusInput.wagering_requirement);
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.WAGERING_REQUIREMENT,
            observed_value: scopedWageringEvidence,
            normalized_value_hash: `normalizer-v1:WAGERING:${hashString(scopedWageringEvidence)}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.max_conversion !== null && bonusInput.max_conversion !== undefined) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.MAX_CONVERSION,
            observed_value: String(bonusInput.max_conversion),
            normalized_value_hash: `normalizer-v1:MAX_CONVERSION:${bonusInput.max_conversion}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.valid_from) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.VALID_FROM,
            observed_value: bonusInput.valid_from instanceof Date ? bonusInput.valid_from.toISOString() : String(bonusInput.valid_from),
            normalized_value_hash: `normalizer-v1:VALID_FROM:${hashString(String(bonusInput.valid_from))}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.valid_until) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.VALID_UNTIL,
            observed_value: bonusInput.valid_until instanceof Date ? bonusInput.valid_until.toISOString() : String(bonusInput.valid_until),
            normalized_value_hash: `normalizer-v1:VALID_UNTIL:${hashString(String(bonusInput.valid_until))}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      // h. Execute Governed Workflow Transitions (NEW -> AWAITING_REVIEW or APPROVED -> AWAITING_REVIEW)
      const workflowService = new WorkflowTransitionService(tx as any);

      if (isNewCasino && casinoClaimIds.length > 0) {
        await workflowService.transitionCasinoReview({
          subjectId: safeCasino.id,
          actorId: actor.id,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: casinoClaimIds,
        });
      } else if (!isNewCasino && isCasinoApprovedOrPublished && hasCasinoFieldDiffs && casinoClaimIds.length > 0) {
        await workflowService.transitionCasinoReview({
          subjectId: safeCasino.id,
          actorId: actor.id,
          expectedVersion: safeCasino.governance_version,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: casinoClaimIds,
        });
      }

      if (isNewBonus && bonusClaimIds.length > 0) {
        await workflowService.transitionBonusReview({
          subjectId: savedBonus.id,
          actorId: actor.id,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: bonusClaimIds,
        });
      } else if (!isNewBonus && isBonusApprovedOrPublished && hasBonusFieldDiffs && bonusClaimIds.length > 0) {
        await workflowService.transitionBonusReview({
          subjectId: savedBonus.id,
          actorId: actor.id,
          expectedVersion: savedBonus.governance_version,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: bonusClaimIds,
        });
      }

      // i. Mark ScrapeJob Completed
      if (scrapeJobId) {
        await tx.scrapeJob.update({
          where: { id: scrapeJobId },
          data: {
            status: "COMPLETED",
            completed_at: now,
          },
        });
      }

      return { casino: safeCasino, bonus: savedBonus, evidence: evidenceRecord };
    });

    console.log(`[IngestionService] [Worker] Extraction complete. Linked Casino ID: ${casino.id}, Bonus ID: ${bonus.id}`);
    return { casino, bonus, evidence };
  }

  /**
   * The extraction handler (Step 2 - Game List)
   */
  public static async handleGameListExtraction(payload: {
    scrapeJobId: string;
    url: string;
    casinoId: string;
    scrapedContent: string;
  }) {
    const shouldProcess = await this.markScrapeJobProcessing(
      payload.scrapeJobId,
    );
    if (!shouldProcess) {
      console.log(
        `[IngestionService] ScrapeJob ${payload.scrapeJobId} is already completed; skipping duplicate game-list extraction`,
      );
      return;
    }
    try {
      return await this.performGameListExtraction(payload);
    } catch (error) {
      await this.markScrapeJobFailed(payload.scrapeJobId, error, "GAME_LIST");
      throw error;
    }
  }

  private static async performGameListExtraction(payload: {
    scrapeJobId: string;
    url: string;
    casinoId: string;
    scrapedContent: string;
  }) {
    const { scrapeJobId, url, casinoId, scrapedContent } = payload;
    const safeUrl = sanitizeUrlForLogging(url);
    console.log(
      `[IngestionService] [Worker] Extracting game list for Casino ${casinoId} from URL: ${safeUrl}`,
    );

    const gameListResult = await this.gameListAgent.run({
      url,
      casinoId,
      scrapedContent,
    });

    const existingSlots = await prisma.slot.findMany();

    const normalizeGameName = (name: string): string => {
      return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/['’\.]/g, "");
    };

    const slotMap = new Map<string, string>();
    for (const slot of existingSlots) {
      slotMap.set(normalizeGameName(slot.name), slot.id);
    }

    let matchedCount = 0;
    const unmatchedNames: string[] = [];

    for (const game of gameListResult.games) {
      const normalizedInputName = normalizeGameName(game.name);
      const matchedSlotId = slotMap.get(normalizedInputName);

      if (matchedSlotId) {
        matchedCount++;
        await prisma.casinoSlot.upsert({
          where: {
            casino_id_slot_id: {
              casino_id: casinoId,
              slot_id: matchedSlotId,
            },
          },
          update: {
            source_url: url,
            verified_at: new Date(),
          },
          create: {
            casino_id: casinoId,
            slot_id: matchedSlotId,
            source_url: url,
            verified_at: new Date(),
          },
        });
      } else {
        unmatchedNames.push(game.name);
      }
    }

    console.log(
      `[GameListExtraction] Casino ${casinoId}: ${gameListResult.games.length} games extracted, ${matchedCount} matched to existing slots, ${unmatchedNames.length} unmatched: [${unmatchedNames.join(", ")}]`
    );

    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        status: "COMPLETED",
        completed_at: new Date(),
        error_log: null,
      },
    });
  }

  private static async markScrapeJobProcessing(
    scrapeJobId: string,
  ): Promise<boolean> {
    const result = await prisma.scrapeJob.updateMany({
      where: {
        id: scrapeJobId,
        status: { not: "COMPLETED" },
      },
      data: {
        status: "PROCESSING",
        started_at: new Date(),
        completed_at: null,
        error_log: null,
      },
    });
    if (result.count === 1) {
      return true;
    }

    const scrapeJob = await prisma.scrapeJob.findUnique({
      where: { id: scrapeJobId },
      select: { status: true },
    });
    if (!scrapeJob) {
      throw new Error(`ScrapeJob ${scrapeJobId} not found`);
    }
    return scrapeJob.status !== "COMPLETED";
  }

  private static async markScrapeJobFailed(
    scrapeJobId: string,
    error: unknown,
    taskContext: "CRAWL" | "BONUS" | "GAME_LIST" = "CRAWL",
  ) {
    let errorLog: string;
    if (error instanceof SourcePageRejectedError) {
      let parsedReason = "Source page rejected by policy";
      let category = error.category;
      try {
        const rawJson = error.message.replace(/^SOURCE_PAGE_REJECTED\s*/, "");
        const parsed = JSON.parse(rawJson);
        if (parsed.category) category = parsed.category;
        if (parsed.reason) parsedReason = parsed.reason;
      } catch {}
      errorLog = JSON.stringify({
        code: "SOURCE_PAGE_REJECTED",
        category,
        reason: parsedReason,
      });
    } else if (error instanceof ExtractionInputRejectedError) {
      errorLog = JSON.stringify({
        code: "EXTRACTION_INPUT_INSUFFICIENT",
        category: error.category,
        reason: error.reason,
      });
    } else if (taskContext === "BONUS") {
      errorLog = JSON.stringify({
        code: "BONUS_EXTRACTION_FAILED",
        reason: "Bonus extraction failed",
      });
    } else if (taskContext === "GAME_LIST") {
      errorLog = JSON.stringify({
        code: "GAME_LIST_EXTRACTION_FAILED",
        reason: "Game list extraction failed",
      });
    } else {
      errorLog = JSON.stringify({
        code: "CRAWL_FAILED",
        reason: "Crawl processing failed",
      });
    }

    await prisma.scrapeJob.updateMany({
      where: {
        id: scrapeJobId,
        status: { not: "COMPLETED" },
      },
      data: {
        status: "FAILED",
        error_log: errorLog,
        completed_at: new Date(),
      },
    });
  }

  private static async runGovernedPersistenceTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 30_000,
        });
      } catch (error) {
        if (
          isRetryableBonusIdentityTransactionError(error) &&
          attempt < maxAttempts
        ) {
          continue;
        }

        if (isBonusIdentityUniqueViolation(error)) {
          throw new BonusSourceIdentityError(
            "CONCURRENT_SOURCE_IDENTITY_CONFLICT",
            `Bonus source identity could not be resolved safely after ${maxAttempts} transaction attempts`,
          );
        }

        throw error;
      }
    }

    throw new BonusSourceIdentityError(
      "CONCURRENT_SOURCE_IDENTITY_CONFLICT",
      "Bonus source identity transaction exhausted its retry budget",
    );
  }

  /**
   * Returns a map of handlers for the worker
   */
  public static getQueueHandlers() {
    return {
      CRAWL_URL: (payload: any) => this.handleCrawl(payload),
      EXTRACT_BONUS: (payload: any) => this.handleExtraction(payload),
      EXTRACT_GAME_LIST: (payload: any) => this.handleGameListExtraction(payload),
    };
  }

  /**
   * Retained for backward compatibility (runs execution steps inline synchronously)
   */
  public static async ingestBonusFromUrl({ url, casino_id }: IngestBonusInput) {
    const startTime = Date.now();
    
    // Create job record and queue the crawl job
    const scrapeJob = await this.enqueueIngestion({ url, casino_id });
    
    // Execute crawl handler inline synchronously
    await this.handleCrawl({ scrapeJobId: scrapeJob.id, url, casinoId: casino_id });
    
    // Mark enqueued CRAWL_URL job for this scrapeJob as COMPLETED since executed inline
    await prisma.jobQueue.updateMany({
      where: {
        queue_name: INGESTION_QUEUE_NAME,
        task_type: "CRAWL_URL",
        payload: { contains: scrapeJob.id },
        status: "PENDING",
      },
      data: { status: "COMPLETED" },
    });

    const updatedJob = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: scrapeJob.id } });

    if (updatedJob.status === "COMPLETED") {
      console.log(`[IngestionService] Ingestion short-circuited for job ${scrapeJob.id}. Retrieving existing entities.`);
      const { bonus, casino } =
        await this.findPriorPersistedBonusForShortCircuit(updatedJob);

      return {
        bonus,
        casino,
        scrapeJob: updatedJob,
        meta: {
          durationMs: Date.now() - startTime,
          extractedContentLength: 0,
          snapshotPath: updatedJob.snapshot_path,
          shortCircuited: true,
        },
      };
    }

    // Find the queued EXTRACT_BONUS job that was created by handleCrawl
    const queuedJob = await prisma.jobQueue.findFirst({
      where: {
        queue_name: INGESTION_QUEUE_NAME,
        task_type: "EXTRACT_BONUS",
        payload: { contains: scrapeJob.id },
        status: "PENDING",
      },
      orderBy: { created_at: "desc" },
    });
    
    if (!queuedJob) {
      throw new Error("Queued EXTRACT_BONUS job not found during synchronous execution");
    }
    
    const payload = JSON.parse(queuedJob.payload);
    const extractionResult = await this.handleExtraction(payload);
    if (!extractionResult) {
      throw new Error(
        `Synchronous extraction for ScrapeJob ${scrapeJob.id} did not return a persisted Bonus`,
      );
    }
    
    // Mark queued jobs as COMPLETED
    await prisma.jobQueue.updateMany({
      where: {
        queue_name: INGESTION_QUEUE_NAME,
        payload: { contains: scrapeJob.id },
      },
      data: { status: "COMPLETED" },
    });

    // Retrieve the current ScrapeJob while preserving the exact extraction result
    const finalJob = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: scrapeJob.id } });

    return {
      bonus: extractionResult.bonus,
      casino: extractionResult.casino,
      scrapeJob: finalJob,
      meta: {
        durationMs: Date.now() - startTime,
        extractedContentLength: payload.scrapedContent.length,
        snapshotPath: finalJob.snapshot_path,
        shortCircuited: false,
      },
    };
  }
  private static async findPriorPersistedBonusForShortCircuit(scrapeJob: {
    id: string;
    data_source_id: string;
    html_hash: string | null;
    content_hash: string | null;
  }) {
    const matchingHashes: Prisma.ScrapeJobWhereInput[] = [];
    if (scrapeJob.content_hash) {
      matchingHashes.push({ content_hash: scrapeJob.content_hash });
    }
    if (scrapeJob.html_hash) {
      matchingHashes.push({ html_hash: scrapeJob.html_hash });
    }
    if (matchingHashes.length === 0) {
      throw new Error(
        `Short-circuited ScrapeJob ${scrapeJob.id} has no content hashes`,
      );
    }

    const priorScrapeJob = await prisma.scrapeJob.findFirst({
      where: {
        data_source_id: scrapeJob.data_source_id,
        id: { not: scrapeJob.id },
        status: "COMPLETED",
        OR: matchingHashes,
      },
      orderBy: { completed_at: "desc" },
      select: { id: true },
    });
    if (!priorScrapeJob) {
      throw new Error(
        `No prior completed ScrapeJob matches short-circuited job ${scrapeJob.id}`,
      );
    }

    const priorClaim = await prisma.bonusEvidenceClaim.findFirst({
      where: { evidence: { scrape_job_id: priorScrapeJob.id } },
      orderBy: { created_at: "desc" },
      include: { bonus: { include: { casino: true } } },
    });
    if (!priorClaim) {
      throw new Error(
        `No persisted Bonus evidence is linked to prior ScrapeJob ${priorScrapeJob.id}`,
      );
    }

    return {
      bonus: priorClaim.bonus,
      casino: priorClaim.bonus.casino,
    };
  }

}
