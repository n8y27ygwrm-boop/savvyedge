import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScrapeResultFromHtml,
  type PlaywrightScrapeResult,
} from "@savvyedge/ai-agents";
import { prisma } from "@savvyedge/database";
import {
  createGeoFallbackCheckpoint,
  type GeoFallbackCheckpoint,
} from "@savvyedge/types";
import { EvidenceArtifactRetrievalError } from "../src/services/evidence-artifact-retrieval.service";
import {
  EvidenceArtifactStorageService,
  prepareEvidenceArtifact,
  type PersistObservationInput,
} from "../src/services/evidence-artifact-storage.service";
import { IngestionService } from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import {
  ScrapingAntFallbackError,
  type ScrapingAntFallbackResult,
} from "../src/services/scrapingant-fallback.service";

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const PRIOR_JOB_ID = "10000000-0000-4000-8000-000000000002";
const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const URL = "https://casino.example.com/promotions/welcome";
const OBSERVED_AT = new Date("2026-08-19T10:20:30.456Z");
const PRIMARY_LOCATOR = "v1_primary_geo_block.html";

const PRIMARY_HTML = `<!doctype html><html><head>
  <title>BetMGM.uk is not available at your location</title>
</head><body>BetMGM.uk is not available at your location</body></html>`;

const FALLBACK_HTML = `<!doctype html><html><head>
  <title>Welcome Bonus</title>
  <link rel="canonical" href="${URL}">
</head><body><main>
  <h1>Welcome Bonus</h1>
  <p>Get a 100% deposit match up to £200 when you deposit £20. Terms and wagering requirements apply.</p>
</main></body></html>`;

const INSUFFICIENT_FALLBACK_HTML = `<!doctype html><html><head>
  <title>Welcome Bonus</title>
  <link rel="canonical" href="${URL}">
</head><body><main>
  <h1>Welcome Bonus</h1>
  <p>Casino Sports Live Casino Promotions Bonuses Help Responsible Gaming Contact Us</p>
</main></body></html>`;

interface IngestionInternals {
  scraperAgent: {
    run(input: unknown): Promise<PlaywrightScrapeResult>;
  };
  scrapingAntFallbackService: {
    scrape(url: string): Promise<ScrapingAntFallbackResult>;
  };
  evidenceArtifactReader: {
    readArtifact(input: {
      locator: string;
      expectedHtmlHash: string;
    }): Promise<{
      bytes: Buffer;
      htmlHash: string;
      byteSize: number;
      locatorType: "FILESYSTEM" | "SUPABASE";
    }>;
  };
  claimAndExecuteGeoFallback(
    payload: {
      scrapeJobId: string;
      url: string;
      taskContext: "BONUS";
    },
    currentJob: { id: string; data_source_id: string; retry_count: number },
    checkpoint: Extract<GeoFallbackCheckpoint, { state: "PRIMARY_BLOCKED" }>,
  ): Promise<void>;
}

const internals = IngestionService as unknown as IngestionInternals;

function fallbackResult(): PlaywrightScrapeResult {
  return buildScrapeResultFromHtml({
    url: URL,
    finalUrl: URL,
    rawHtml: FALLBACK_HTML,
    timestamp: OBSERVED_AT,
    attemptCount: 1,
    durationMs: 0,
  });
}

function insufficientFallbackResult(): PlaywrightScrapeResult {
  return buildScrapeResultFromHtml({
    url: URL,
    finalUrl: URL,
    rawHtml: INSUFFICIENT_FALLBACK_HTML,
    timestamp: OBSERVED_AT,
    attemptCount: 1,
    durationMs: 0,
  });
}

function primaryResult(): PlaywrightScrapeResult {
  return buildScrapeResultFromHtml({
    url: URL,
    finalUrl: URL,
    rawHtml: PRIMARY_HTML,
    timestamp: OBSERVED_AT,
    httpStatus: 451,
    attemptCount: 1,
    durationMs: 0,
  });
}

function plannedFallbackArtifact() {
  const result = fallbackResult();
  return prepareEvidenceArtifact({
    rawHtml: result.rawHtml,
    expectedHtmlHash: result.htmlHash,
    observationId: `${JOB_ID}_geo_fallback`,
    sourceUrl: URL,
    observedAt: OBSERVED_AT,
  });
}

function plannedLocalRecoveryArtifact() {
  const result = fallbackResult();
  return prepareEvidenceArtifact({
    rawHtml: result.rawHtml,
    expectedHtmlHash: result.htmlHash,
    observationId: `${JOB_ID}_local_recovery`,
    sourceUrl: URL,
    observedAt: OBSERVED_AT,
  });
}

function localInsufficientCheckpoint() {
  const result = insufficientFallbackResult();
  const artifact = prepareEvidenceArtifact({
    rawHtml: result.rawHtml,
    expectedHtmlHash: result.htmlHash,
    observationId: `${JOB_ID}_local_recovery`,
    sourceUrl: URL,
    observedAt: OBSERVED_AT,
  });
  return createGeoFallbackCheckpoint({
    version: 1,
    state: "EXTRACTION_REJECTED",
    locator: artifact.locator,
    htmlHash: result.htmlHash,
    contentHash: result.contentHash,
    observedAt: OBSERVED_AT.toISOString(),
    reason: "EXTRACTION_INPUT_INSUFFICIENT",
  });
}

function artifactCheckpoint(
  state:
    | "RESULT_READY"
    | "AVAILABLE"
    | "LOCAL_RECOVERED"
    | "EXTRACTION_REJECTED",
  options: { insufficient?: boolean } = {},
) {
  const result = options.insufficient
    ? insufficientFallbackResult()
    : fallbackResult();
  const artifact = options.insufficient
    ? prepareEvidenceArtifact({
        rawHtml: result.rawHtml,
        expectedHtmlHash: result.htmlHash,
        observationId: `${JOB_ID}_geo_fallback`,
        sourceUrl: URL,
        observedAt: OBSERVED_AT,
      })
    : state === "LOCAL_RECOVERED"
      ? plannedLocalRecoveryArtifact()
      : plannedFallbackArtifact();
  if (state === "EXTRACTION_REJECTED") {
    return createGeoFallbackCheckpoint({
      version: 1,
      state,
      locator: artifact.locator,
      htmlHash: result.htmlHash,
      contentHash: result.contentHash,
      observedAt: OBSERVED_AT.toISOString(),
      reason: "EXTRACTION_INPUT_INSUFFICIENT",
    });
  }
  return createGeoFallbackCheckpoint({
    version: 1,
    state,
    locator: artifact.locator,
    htmlHash: result.htmlHash,
    contentHash: result.contentHash,
    observedAt: OBSERVED_AT.toISOString(),
  });
}

function jobWithCheckpoint(
  checkpoint: GeoFallbackCheckpoint | null,
  overrides: Record<string, unknown> = {},
) {
  const artifactBearing =
    checkpoint?.state === "AVAILABLE" ||
    checkpoint?.state === "LOCAL_RECOVERED" ||
    checkpoint?.state === "EXTRACTION_REJECTED";
  return {
    id: JOB_ID,
    data_source_id: SOURCE_ID,
    retry_count: checkpoint && checkpoint.state !== "PRIMARY_BLOCKED" ? 1 : 0,
    snapshot_path: artifactBearing ? checkpoint.locator : PRIMARY_LOCATOR,
    html_hash:
      artifactBearing
        ? checkpoint.htmlHash
        : createHash("sha256").update(PRIMARY_HTML).digest("hex"),
    content_hash: artifactBearing ? checkpoint.contentHash : null,
    canonical_url: URL,
    geo_fallback_checkpoint: checkpoint,
    status: "PROCESSING",
    ...overrides,
  };
}

function mockArtifactReader(rawHtml = FALLBACK_HTML) {
  const bytes = Buffer.from(rawHtml, "utf8");
  return vi
    .spyOn(internals.evidenceArtifactReader, "readArtifact")
    .mockResolvedValue({
      bytes,
      htmlHash: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      locatorType: "FILESYSTEM",
    });
}

function mockDeterministicPersistence() {
  return vi
    .spyOn(EvidenceArtifactStorageService, "persistObservation")
    .mockImplementation(async (input: PersistObservationInput) => {
      if (input.observationId.endsWith("_geo_primary")) {
        return {
          locator: PRIMARY_LOCATOR,
          htmlHash: input.expectedHtmlHash,
          byteSize: Buffer.byteLength(input.rawHtml),
        };
      }
      return prepareEvidenceArtifact(input);
    });
}

function checkpointStates(updateMany: ReturnType<typeof vi.spyOn>): string[] {
  return updateMany.mock.calls
    .map(([call]) => call.data?.geo_fallback_checkpoint?.state)
    .filter((state): state is string => typeof state === "string");
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SAVVY_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "test");
  vi.stubEnv("SAVVY_EVIDENCE_STORAGE_BACKEND", "filesystem");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("BONUS geo fallback state machine and recovery", () => {
  it("persists the blocked primary before the one paid request, then promotes the fallback artifact", async () => {
    const currentJob = jobWithCheckpoint(null);
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      currentJob as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(primaryResult());
    const paidRequest = vi
      .spyOn(internals.scrapingAntFallbackService, "scrape")
      .mockResolvedValue({ rawHtml: FALLBACK_HTML, observedAt: OBSERVED_AT });
    const persist = mockDeterministicPersistence();
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "queue-job" } as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0][0].observationId).toBe(
      `${JOB_ID}_geo_primary`,
    );
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      paidRequest.mock.invocationCallOrder[0],
    );
    expect(checkpointStates(updateMany)).toEqual([
      "PRIMARY_BLOCKED",
      "REQUEST_CLAIMED",
      "RESULT_READY",
      "AVAILABLE",
    ]);

    const planned = plannedFallbackArtifact();
    const promotion = updateMany.mock.calls.find(
      ([call]) => call.data?.geo_fallback_checkpoint?.state === "AVAILABLE",
    );
    expect(promotion?.[0]).toMatchObject({
      data: {
        snapshot_path: planned.locator,
        html_hash: fallbackResult().htmlHash,
        content_hash: fallbackResult().contentHash,
        canonical_url: URL,
      },
    });
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_BONUS",
      expect.objectContaining({
        scrapeJobId: JOB_ID,
        url: URL,
        observedAt: OBSERVED_AT.toISOString(),
      }),
      { deduplicate: true },
    );
    const durableAndQueueSurface = JSON.stringify({
      writes: updateMany.mock.calls,
      evidence: persist.mock.calls,
      queue: enqueue.mock.calls,
    });
    expect(durableAndQueueSurface).not.toContain("test-secret-api-key");
    expect(durableAndQueueSurface).not.toContain("api.scrapingant.com");
    expect(durableAndQueueSurface).not.toContain("x-api-key");
  });

  it("retains the primary canonical artifact when the provider fails", async () => {
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(null) as never,
    );
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(primaryResult());
    vi.spyOn(internals.scrapingAntFallbackService, "scrape").mockRejectedValue(
      new ScrapingAntFallbackError("PROVIDER_5XX"),
    );
    const persist = mockDeterministicPersistence();
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_5XX" });

    expect(persist).toHaveBeenCalledOnce();
    expect(checkpointStates(updateMany)).toEqual([
      "PRIMARY_BLOCKED",
      "REQUEST_CLAIMED",
      "PROVIDER_FAILED",
    ]);
    const canonicalWrites = updateMany.mock.calls.filter(
      ([call]) => call.data?.snapshot_path !== undefined,
    );
    expect(canonicalWrites).toHaveLength(1);
    expect(canonicalWrites[0][0].data.snapshot_path).toBe(PRIMARY_LOCATOR);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("retains the primary canonical artifact when the paid result is still geo-blocked", async () => {
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(null) as never,
    );
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(primaryResult());
    vi.spyOn(internals.scrapingAntFallbackService, "scrape").mockResolvedValue({
      rawHtml: PRIMARY_HTML,
      observedAt: OBSERVED_AT,
    });
    const persist = mockDeterministicPersistence();
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({ code: "FALLBACK_REJECTED" });

    expect(persist).toHaveBeenCalledOnce();
    expect(checkpointStates(updateMany)).toEqual([
      "PRIMARY_BLOCKED",
      "REQUEST_CLAIMED",
      "FALLBACK_REJECTED",
    ]);
    expect(
      updateMany.mock.calls.filter(
        ([call]) => call.data?.snapshot_path !== undefined,
      ),
    ).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("persists insufficient provider HTML in EXTRACTION_REJECTED without enqueueing", async () => {
    const result = insufficientFallbackResult();
    const rejectedCheckpoint = artifactCheckpoint("EXTRACTION_REJECTED", {
      insufficient: true,
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(null) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(primaryResult());
    const paidRequest = vi
      .spyOn(internals.scrapingAntFallbackService, "scrape")
      .mockResolvedValue({
        rawHtml: INSUFFICIENT_FALLBACK_HTML,
        observedAt: OBSERVED_AT,
      });
    const persist = mockDeterministicPersistence();
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    let thrown: unknown;
    try {
      await IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "ExtractionInputRejectedError",
      category: "INSUFFICIENT_CONTENT",
    });
    expect((thrown as Error).message).toBe(
      'EXTRACTION_INPUT_REJECTED {"category":"INSUFFICIENT_CONTENT","reason":"The rendered page text is too sparse or carries no offer-detail evidence for extraction."}',
    );
    expect(paidRequest).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(checkpointStates(updateMany)).toEqual([
      "PRIMARY_BLOCKED",
      "REQUEST_CLAIMED",
      "RESULT_READY",
      "EXTRACTION_REJECTED",
    ]);
    const rejectedWrite = updateMany.mock.calls.find(
      ([call]) =>
        call.data?.geo_fallback_checkpoint?.state === "EXTRACTION_REJECTED",
    );
    expect(rejectedWrite?.[0].data).toMatchObject({
      snapshot_path: rejectedCheckpoint.locator,
      html_hash: result.htmlHash,
      content_hash: result.contentHash,
      canonical_url: URL,
      geo_fallback_checkpoint: rejectedCheckpoint,
    });
    expect(enqueue).not.toHaveBeenCalled();

    const checkpointSurface = JSON.stringify(
      rejectedWrite?.[0].data.geo_fallback_checkpoint,
    );
    expect(checkpointSurface).not.toContain(INSUFFICIENT_FALLBACK_HTML);
    expect(checkpointSurface).not.toContain(URL);
    expect(checkpointSurface).not.toContain("api.scrapingant.com");
    expect(checkpointSurface).not.toContain("x-api-key");
    expect(checkpointSurface).not.toContain("test-secret-api-key");
    const failedWrite = updateMany.mock.calls.find(
      ([call]) => typeof call.data?.error_log === "string",
    );
    expect(failedWrite?.[0].data.error_log).toBe(
      '{"code":"EXTRACTION_INPUT_INSUFFICIENT","category":"INSUFFICIENT_CONTENT","reason":"The rendered page text is too sparse or carries no offer-detail evidence for extraction."}',
    );
  });

  it("retries EXTRACTION_REJECTED deterministically without browser, provider, artifact read, or enqueue", async () => {
    const checkpoint = artifactCheckpoint("EXTRACTION_REJECTED", {
      insufficient: true,
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const reader = vi.spyOn(internals.evidenceArtifactReader, "readArtifact");
    const persist = vi.spyOn(
      EvidenceArtifactStorageService,
      "persistObservation",
    );
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({
      name: "ExtractionInputRejectedError",
      category: "INSUFFICIENT_CONTENT",
      message:
        'EXTRACTION_INPUT_REJECTED {"category":"INSUFFICIENT_CONTENT","reason":"The rendered page text is too sparse or carries no offer-detail evidence for extraction."}',
    });

    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(checkpointStates(updateMany)).toEqual([]);
  });

  it("allows exactly one of two concurrent claims to call the provider", async () => {
    const primaryCheckpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "PRIMARY_BLOCKED",
    });
    let claimed = false;
    vi.spyOn(prisma.scrapeJob, "updateMany").mockImplementation(
      async (call: never) => {
        const input = call as {
          data?: { retry_count?: { increment: number } };
        };
        if (input.data?.retry_count?.increment === 1) {
          if (claimed) return { count: 0 };
          claimed = true;
        }
        return { count: 1 };
      },
    );
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(
        createGeoFallbackCheckpoint({ version: 1, state: "REQUEST_CLAIMED" }),
      ) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const paidRequest = vi
      .spyOn(internals.scrapingAntFallbackService, "scrape")
      .mockResolvedValue({ rawHtml: FALLBACK_HTML, observedAt: OBSERVED_AT });
    mockDeterministicPersistence();
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({} as never);

    const payload = {
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    } as const;
    const currentJob = {
      id: JOB_ID,
      data_source_id: SOURCE_ID,
      retry_count: 0,
    };
    const outcomes = await Promise.allSettled([
      internals.claimAndExecuteGeoFallback(
        payload,
        currentJob,
        primaryCheckpoint,
      ),
      internals.claimAndExecuteGeoFallback(
        payload,
        currentJob,
        primaryCheckpoint,
      ),
    ]);

    expect(paidRequest).toHaveBeenCalledOnce();
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });

  it("resumes PRIMARY_BLOCKED by claiming once without rerunning Playwright", async () => {
    const checkpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "PRIMARY_BLOCKED",
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi
      .spyOn(internals.scrapingAntFallbackService, "scrape")
      .mockResolvedValue({ rawHtml: FALLBACK_HTML, observedAt: OBSERVED_AT });
    const persist = mockDeterministicPersistence();
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({} as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][0].observationId).toBe(
      `${JOB_ID}_geo_fallback`,
    );
    expect(checkpointStates(updateMany)).toEqual([
      "REQUEST_CLAIMED",
      "RESULT_READY",
      "AVAILABLE",
    ]);
  });

  it("recovers RESULT_READY after persistence and promotes without Playwright, provider, or rewrite", async () => {
    const checkpoint = artifactCheckpoint("RESULT_READY");
    const currentJob = jobWithCheckpoint(checkpoint);
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      currentJob as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const reader = mockArtifactReader();
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const persist = vi.spyOn(
      EvidenceArtifactStorageService,
      "persistObservation",
    );
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({} as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(reader).toHaveBeenCalledOnce();
    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    const promotion = updateMany.mock.calls.find(
      ([call]) => call.data?.geo_fallback_checkpoint?.state === "AVAILABLE",
    );
    expect(promotion?.[0]).toMatchObject({
      where: {
        id: JOB_ID,
        retry_count: 1,
        geo_fallback_checkpoint: { equals: checkpoint },
        snapshot_path: PRIMARY_LOCATOR,
      },
      data: { snapshot_path: checkpoint.locator },
    });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("recovers an insufficient RESULT_READY artifact into EXTRACTION_REJECTED", async () => {
    const checkpoint = artifactCheckpoint("RESULT_READY", {
      insufficient: true,
    });
    const rejectedCheckpoint = artifactCheckpoint("EXTRACTION_REJECTED", {
      insufficient: true,
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const reader = mockArtifactReader(INSUFFICIENT_FALLBACK_HTML);
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({
      name: "ExtractionInputRejectedError",
      category: "INSUFFICIENT_CONTENT",
    });

    expect(reader).toHaveBeenCalledOnce();
    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    const promotion = updateMany.mock.calls.find(
      ([call]) =>
        call.data?.geo_fallback_checkpoint?.state === "EXTRACTION_REJECTED",
    );
    expect(promotion?.[0]).toMatchObject({
      where: {
        id: JOB_ID,
        retry_count: 1,
        geo_fallback_checkpoint: { equals: checkpoint },
        snapshot_path: PRIMARY_LOCATOR,
      },
      data: {
        snapshot_path: rejectedCheckpoint.locator,
        geo_fallback_checkpoint: rejectedCheckpoint,
      },
    });
  });

  it("resumes AVAILABLE with zero Playwright and zero provider calls", async () => {
    const checkpoint = artifactCheckpoint("AVAILABLE");
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    mockArtifactReader();
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({} as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_BONUS",
      expect.objectContaining({ scrapeJobId: JOB_ID }),
      { deduplicate: true },
    );
  });

  it.each([
    [
      "REQUEST_CLAIMED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "REQUEST_CLAIMED",
      }),
    ],
    [
      "PROVIDER_FAILED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "PROVIDER_FAILED",
        reason: "PROVIDER_5XX",
      }),
    ],
    [
      "FALLBACK_REJECTED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "FALLBACK_REJECTED",
        reason: "STILL_GEO_BLOCKED",
      }),
    ],
  ])(
    "recovers %s locally and resumes an enqueue failure from the durable artifact",
    async (_label, previousCheckpoint) => {
      const recoveredCheckpoint = artifactCheckpoint("LOCAL_RECOVERED");
      const updateMany = vi
        .spyOn(prisma.scrapeJob, "updateMany")
        .mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow")
        .mockResolvedValueOnce(jobWithCheckpoint(previousCheckpoint) as never)
        .mockResolvedValueOnce(jobWithCheckpoint(recoveredCheckpoint) as never);
      vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
      const scraper = vi
        .spyOn(internals.scraperAgent, "run")
        .mockResolvedValue(fallbackResult());
      const paidRequest = vi.spyOn(
        internals.scrapingAntFallbackService,
        "scrape",
      );
      const persist = mockDeterministicPersistence();
      const reader = mockArtifactReader();
      const enqueue = vi
        .spyOn(JobQueueService, "enqueue")
        .mockRejectedValueOnce(new Error("bounded queue failure"))
        .mockResolvedValueOnce({} as never);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: JOB_ID,
          url: URL,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow("bounded queue failure");
      await IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      });

      expect(scraper).toHaveBeenCalledOnce();
      expect(paidRequest).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          observationId: `${JOB_ID}_local_recovery`,
          sourceUrl: URL,
          expectedHtmlHash: fallbackResult().htmlHash,
        }),
      );
      const recoveredWrite = updateMany.mock.calls.find(
        ([call]) =>
          call.data?.geo_fallback_checkpoint?.state === "LOCAL_RECOVERED",
      );
      expect(recoveredWrite?.[0]).toMatchObject({
        where: {
          id: JOB_ID,
          retry_count: 1,
          geo_fallback_checkpoint: { equals: previousCheckpoint },
        },
        data: {
          snapshot_path: recoveredCheckpoint.locator,
          html_hash: recoveredCheckpoint.htmlHash,
          content_hash: recoveredCheckpoint.contentHash,
          canonical_url: URL,
          geo_fallback_checkpoint: recoveredCheckpoint,
        },
      });
      expect(reader).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledTimes(2);
      for (const call of enqueue.mock.calls) {
        expect(call).toEqual([
          "ingestion-queue",
          "EXTRACT_BONUS",
          {
            scrapeJobId: JOB_ID,
            url: URL,
            casinoId: undefined,
            scrapedContent: fallbackResult().content,
            scrapedMetadata: fallbackResult().metadata,
            observedAt: OBSERVED_AT.toISOString(),
          },
          { deduplicate: true },
        ]);
      }
    },
  );

  it.each([
    [
      "REQUEST_CLAIMED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "REQUEST_CLAIMED",
      }),
    ],
    [
      "PROVIDER_FAILED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "PROVIDER_FAILED",
        reason: "PROVIDER_5XX",
      }),
    ],
    [
      "FALLBACK_REJECTED",
      createGeoFallbackCheckpoint({
        version: 1,
        state: "FALLBACK_REJECTED",
        reason: "STILL_GEO_BLOCKED",
      }),
    ],
  ])(
    "persists insufficient local recovery from %s before terminal rejection",
    async (_label, previousCheckpoint) => {
      const result = insufficientFallbackResult();
      const rejectedCheckpoint = localInsufficientCheckpoint();
      const updateMany = vi
        .spyOn(prisma.scrapeJob, "updateMany")
        .mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow")
        .mockResolvedValueOnce(jobWithCheckpoint(previousCheckpoint) as never)
        .mockResolvedValueOnce(jobWithCheckpoint(rejectedCheckpoint) as never);
      const duplicateLookup = vi
        .spyOn(prisma.scrapeJob, "findFirst")
        .mockResolvedValue({
          id: PRIOR_JOB_ID,
          html_hash: result.htmlHash,
          content_hash: result.contentHash,
        } as never);
      const scraper = vi
        .spyOn(internals.scraperAgent, "run")
        .mockResolvedValue(result);
      const paidRequest = vi.spyOn(
        internals.scrapingAntFallbackService,
        "scrape",
      );
      const persist = mockDeterministicPersistence();
      const reader = vi.spyOn(
        internals.evidenceArtifactReader,
        "readArtifact",
      );
      const enqueue = vi.spyOn(JobQueueService, "enqueue");

      const captureRejection = async () => {
        try {
          await IngestionService.handleCrawl({
            scrapeJobId: JOB_ID,
            url: URL,
            taskContext: "BONUS",
          });
          return null;
        } catch (error) {
          return error;
        }
      };
      const firstError = await captureRejection();
      const retryError = await captureRejection();
      const expectedError = {
        name: "ExtractionInputRejectedError",
        category: "INSUFFICIENT_CONTENT",
        message:
          'EXTRACTION_INPUT_REJECTED {"category":"INSUFFICIENT_CONTENT","reason":"The rendered page text is too sparse or carries no offer-detail evidence for extraction."}',
      };

      expect(firstError).toMatchObject(expectedError);
      expect(retryError).toMatchObject(expectedError);
      expect((retryError as Error).message).toBe((firstError as Error).message);
      expect(scraper).toHaveBeenCalledOnce();
      expect(paidRequest).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith({
        rawHtml: result.rawHtml,
        expectedHtmlHash: result.htmlHash,
        observationId: `${JOB_ID}_local_recovery`,
        sourceUrl: URL,
        observedAt: OBSERVED_AT,
      });
      const rejectedWrite = updateMany.mock.calls.find(
        ([call]) =>
          call.data?.geo_fallback_checkpoint?.state === "EXTRACTION_REJECTED",
      );
      expect(rejectedWrite?.[0]).toMatchObject({
        where: {
          id: JOB_ID,
          retry_count: 1,
          geo_fallback_checkpoint: { equals: previousCheckpoint },
        },
        data: {
          snapshot_path: rejectedCheckpoint.locator,
          html_hash: rejectedCheckpoint.htmlHash,
          content_hash: rejectedCheckpoint.contentHash,
          canonical_url: URL,
          geo_fallback_checkpoint: rejectedCheckpoint,
        },
      });
      expect(checkpointStates(updateMany)).toEqual(["EXTRACTION_REJECTED"]);
      expect(duplicateLookup).not.toHaveBeenCalled();
      expect(
        updateMany.mock.calls.filter(
          ([call]) => call.data?.status === "COMPLETED",
        ),
      ).toHaveLength(0);
      expect(reader).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it("keeps the consumed checkpoint and makes no provider call when local recovery is still geo-blocked", async () => {
    const checkpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "REQUEST_CLAIMED",
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    const scraper = vi
      .spyOn(internals.scraperAgent, "run")
      .mockResolvedValue(primaryResult());
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const persist = vi.spyOn(
      EvidenceArtifactStorageService,
      "persistObservation",
    );
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({ code: "LOCAL_RECOVERY_STILL_GEO_BLOCKED" });

    expect(scraper).toHaveBeenCalledOnce();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(checkpointStates(updateMany)).toEqual([]);
  });

  it("fails finitely without a provider call when PRIMARY_BLOCKED has exhausted its claim budget", async () => {
    const checkpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "PRIMARY_BLOCKED",
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint, { retry_count: 1 }) as never,
    );
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({ code: "FALLBACK_BUDGET_EXHAUSTED" });

    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(
      updateMany.mock.calls.filter(
        ([call]) => call.data?.retry_count?.increment === 1,
      ),
    ).toHaveLength(0);
  });

  it("does not recursively resume PRIMARY_BLOCKED after a lost claim observes exhausted budget", async () => {
    const checkpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "PRIMARY_BLOCKED",
    });
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 0 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint, { retry_count: 1 }) as never,
    );
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );

    await expect(
      internals.claimAndExecuteGeoFallback(
        { scrapeJobId: JOB_ID, url: URL, taskContext: "BONUS" },
        { id: JOB_ID, data_source_id: SOURCE_ID, retry_count: 0 },
        checkpoint,
      ),
    ).rejects.toMatchObject({ code: "FALLBACK_BUDGET_EXHAUSTED" });

    expect(updateMany).toHaveBeenCalledOnce();
    expect(paidRequest).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed checkpoint before browser, provider, or artifact access", async () => {
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      ...jobWithCheckpoint(null),
      retry_count: 1,
      geo_fallback_checkpoint: {
        version: 1,
        state: "AVAILABLE",
        rawHtml: "forbidden",
      },
    } as never);
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const reader = vi.spyOn(internals.evidenceArtifactReader, "readArtifact");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toMatchObject({ code: "INVALID_GEO_FALLBACK_CHECKPOINT" });

    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing",
      new EvidenceArtifactRetrievalError("ARTIFACT_NOT_AVAILABLE"),
      2,
    ],
    [
      "hash-mismatched",
      new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED"),
      1,
    ],
  ])(
    "fails boundedly when RESULT_READY is %s",
    async (_label, error, reads) => {
      const checkpoint = artifactCheckpoint("RESULT_READY");
      vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
        jobWithCheckpoint(checkpoint) as never,
      );
      vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
      const reader = vi
        .spyOn(internals.evidenceArtifactReader, "readArtifact")
        .mockRejectedValue(error);
      const scraper = vi.spyOn(internals.scraperAgent, "run");
      const paidRequest = vi.spyOn(
        internals.scrapingAntFallbackService,
        "scrape",
      );

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: JOB_ID,
          url: URL,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow("FALLBACK_RESULT_UNAVAILABLE");

      expect(reader).toHaveBeenCalledTimes(reads);
      expect(scraper).not.toHaveBeenCalled();
      expect(paidRequest).not.toHaveBeenCalled();
    },
  );

  it("uses a conditional RESULT_READY promotion so a stale worker cannot overwrite AVAILABLE", async () => {
    const checkpoint = artifactCheckpoint("RESULT_READY");
    const available = artifactCheckpoint("AVAILABLE");
    const currentJob = jobWithCheckpoint(checkpoint);
    const latestJob = jobWithCheckpoint(available);
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockImplementation(async (call: never) => {
        const input = call as { data?: { snapshot_path?: string } };
        return {
          count: input.data?.snapshot_path === checkpoint.locator ? 0 : 1,
        };
      });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow")
      .mockResolvedValueOnce(currentJob as never)
      .mockResolvedValueOnce(latestJob as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    mockArtifactReader();
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({} as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    const attemptedPromotion = updateMany.mock.calls.find(
      ([call]) => call.data?.snapshot_path === checkpoint.locator,
    );
    expect(attemptedPromotion?.[0].where).toMatchObject({
      id: JOB_ID,
      retry_count: 1,
      geo_fallback_checkpoint: { equals: checkpoint },
      snapshot_path: PRIMARY_LOCATOR,
    });
    expect(
      updateMany.mock.calls.filter(
        ([call]) => call.data?.geo_fallback_checkpoint?.state === "AVAILABLE",
      ),
    ).toHaveLength(1);
  });

  it("recovers an enqueue failure from AVAILABLE without another paid call", async () => {
    const checkpoint = artifactCheckpoint("AVAILABLE");
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(checkpoint) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const reader = mockArtifactReader();
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockRejectedValueOnce(new Error("bounded queue failure"))
      .mockResolvedValueOnce({} as never);

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: JOB_ID,
        url: URL,
        taskContext: "BONUS",
      }),
    ).rejects.toThrow("bounded queue failure");
    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(reader).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(scraper).not.toHaveBeenCalled();
    expect(paidRequest).not.toHaveBeenCalled();
  });

  it("short-circuits a duplicate fallback without creating its artifact or enqueueing", async () => {
    const updateMany = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(null) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue({
      id: PRIOR_JOB_ID,
      html_hash: fallbackResult().htmlHash,
      content_hash: fallbackResult().contentHash,
    } as never);
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(primaryResult());
    vi.spyOn(internals.scrapingAntFallbackService, "scrape").mockResolvedValue({
      rawHtml: FALLBACK_HTML,
      observedAt: OBSERVED_AT,
    });
    const persist = mockDeterministicPersistence();
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(checkpointStates(updateMany)).toContain("DEDUPLICATED");
    const deduplicated = updateMany.mock.calls.find(
      ([call]) => call.data?.geo_fallback_checkpoint?.state === "DEDUPLICATED",
    );
    expect(deduplicated?.[0].data).toMatchObject({
      snapshot_path: null,
      geo_fallback_checkpoint: { priorScrapeJobId: PRIOR_JOB_ID },
      status: "COMPLETED",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never contacts the provider for a normal eligible BONUS offer", async () => {
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      jobWithCheckpoint(null) as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(internals.scraperAgent, "run").mockResolvedValue(fallbackResult());
    const paidRequest = vi.spyOn(
      internals.scrapingAntFallbackService,
      "scrape",
    );
    mockDeterministicPersistence();
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({} as never);

    await IngestionService.handleCrawl({
      scrapeJobId: JOB_ID,
      url: URL,
      taskContext: "BONUS",
    });

    expect(paidRequest).not.toHaveBeenCalled();
  });
});
