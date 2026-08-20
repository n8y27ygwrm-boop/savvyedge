import { prisma } from "@savvyedge/database";
import {
  EXTRACTION_CONTRACT_VERSION,
  bonusExtractionKey,
} from "@savvyedge/ai-agents";
import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import { JobQueueService } from "./job-queue.service";
import { sanitizeUrlForLogging } from "./ingestion-enqueue.service";

/**
 * Creation-time validation for VERSIONED BONUS SNAPSHOT REPROCESSING V1.
 *
 * This module deliberately imports no scraper, browser or provider code. It
 * resolves everything from already persisted state, so a reprocessing request
 * can never reach the target site.
 */

export type SnapshotReprocessingErrorCode =
  | "SOURCE_JOB_NOT_FOUND"
  | "SOURCE_JOB_NOT_COMPLETED"
  | "SOURCE_ARTIFACT_ABSENT"
  | "SOURCE_EVIDENCE_NOT_FOUND"
  | "SOURCE_OBSERVATION_AMBIGUOUS"
  | "SOURCE_SNAPSHOT_NOT_CURRENT"
  | "ALREADY_PROCESSED"
  | "REPROCESS_CONTEXT_UNSUPPORTED";

export class SnapshotReprocessingError extends Error {
  public constructor(public readonly code: SnapshotReprocessingErrorCode) {
    super(`Snapshot reprocessing rejected (${code})`);
    this.name = "SnapshotReprocessingError";
  }
}

export interface SnapshotReprocessingRequest {
  /** The only value the caller supplies. */
  sourceScrapeJobId: string;
}

export interface SnapshotReprocessingPlan {
  scrapeJobId: string;
  sourceScrapeJobId: string;
  dataSourceId: string;
  url: string;
  snapshotLocator: string;
  htmlHash: string;
  contentHash: string;
  observedAt: Date;
  extractionKey: string;
  extractionVersion: string;
}

/**
 * Resolves the source execution and proves it is the current authoritative
 * snapshot for its data source. Everything the queue payload needs is derived
 * here from persisted state; nothing is taken from the caller.
 */
export async function planSnapshotReprocessing(
  request: SnapshotReprocessingRequest,
  db: typeof prisma = prisma,
): Promise<Omit<SnapshotReprocessingPlan, "scrapeJobId">> {
  const sourceJob = await db.scrapeJob.findUnique({
    where: { id: request.sourceScrapeJobId },
  });
  if (!sourceJob) {
    throw new SnapshotReprocessingError("SOURCE_JOB_NOT_FOUND");
  }
  if (sourceJob.status !== "COMPLETED") {
    throw new SnapshotReprocessingError("SOURCE_JOB_NOT_COMPLETED");
  }
  if (
    !sourceJob.snapshot_path ||
    !sourceJob.html_hash ||
    !sourceJob.content_hash
  ) {
    throw new SnapshotReprocessingError("SOURCE_ARTIFACT_ABSENT");
  }

  // Observation time comes from the source evidence, never from "now".
  const sourceEvidence = await db.evidenceRecord.findMany({
    where: { scrape_job_id: sourceJob.id },
    select: {
      id: true,
      observed_at: true,
      source_url: true,
    },
    orderBy: [{ observed_at: "desc" }, { id: "desc" }],
  });
  if (sourceEvidence.length === 0) {
    throw new SnapshotReprocessingError("SOURCE_EVIDENCE_NOT_FOUND");
  }
  const observedAtMillis = new Set(
    sourceEvidence.map((record) => record.observed_at.getTime()),
  );
  if (observedAtMillis.size !== 1) {
    // Cannot attribute a single authoritative observation time. Fail closed
    // rather than inventing one.
    throw new SnapshotReprocessingError("SOURCE_OBSERVATION_AMBIGUOUS");
  }

  const canonicalSourceEvidence = sourceEvidence[0];
  const observedAt = canonicalSourceEvidence.observed_at;
  const url = sourceJob.canonical_url || canonicalSourceEvidence.source_url;

  // Only the current real-world observation may mutate current state.
  // Reprocessing executions are explicitly excluded: they preserve the source
  // observed_at, so a later queue run must never outrank a later crawl or true
  // reverification. Equal observation times are resolved deterministically by
  // EvidenceRecord.id descending; only that exact record is current.
  const latestAuthoritative = await db.evidenceRecord.findFirst({
    where: {
      data_source_id: sourceJob.data_source_id,
      OR: [
        {
          scrape_job_id: null,
          snapshot_path: { not: null },
          html_hash: { not: null },
          content_hash: { not: null },
        },
        {
          scrape_job: {
            is: {
              reprocessed_from_id: null,
              status: "COMPLETED",
              snapshot_path: { not: null },
              html_hash: { not: null },
              content_hash: { not: null },
            },
          },
        },
      ],
    },
    select: { id: true, observed_at: true },
    orderBy: [{ observed_at: "desc" }, { id: "desc" }],
  });
  if (
    !latestAuthoritative ||
    latestAuthoritative.id !== canonicalSourceEvidence.id
  ) {
    throw new SnapshotReprocessingError("SOURCE_SNAPSHOT_NOT_CURRENT");
  }

  const extractionKey = bonusExtractionKey({
    snapshotLocator: sourceJob.snapshot_path,
    htmlHash: sourceJob.html_hash,
    contentHash: sourceJob.content_hash,
  });

  const existing = await db.evidenceRecord.findUnique({
    where: {
      data_source_id_extraction_key: {
        data_source_id: sourceJob.data_source_id,
        extraction_key: extractionKey,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new SnapshotReprocessingError("ALREADY_PROCESSED");
  }

  return {
    sourceScrapeJobId: sourceJob.id,
    dataSourceId: sourceJob.data_source_id,
    url,
    snapshotLocator: sourceJob.snapshot_path,
    htmlHash: sourceJob.html_hash,
    contentHash: sourceJob.content_hash,
    observedAt,
    extractionKey,
    extractionVersion: EXTRACTION_CONTRACT_VERSION,
  };
}

/**
 * Creates the reprocessing execution record and enqueues the task.
 *
 * The new ScrapeJob starts PROCESSING and stays PROCESSING until the governed
 * extraction transaction commits. Hashes are left null until the artifact has
 * actually been read and verified, so a null hash honestly means "not verified
 * yet" rather than "trusted from the source row".
 */
export async function requestSnapshotReprocessing(
  request: SnapshotReprocessingRequest,
  db: typeof prisma = prisma,
): Promise<SnapshotReprocessingPlan> {
  const plan = await planSnapshotReprocessing(request, db);

  const scrapeJob = await db.scrapeJob.create({
    data: {
      data_source_id: plan.dataSourceId,
      status: "PROCESSING",
      reprocessed_from_id: plan.sourceScrapeJobId,
      extraction_version: plan.extractionVersion,
    },
    select: { id: true },
  });

  await JobQueueService.enqueue(
    INGESTION_QUEUE_NAME,
    "REPROCESS_SNAPSHOT",
    {
      scrapeJobId: scrapeJob.id,
      sourceScrapeJobId: plan.sourceScrapeJobId,
      url: plan.url,
      taskContext: "BONUS" as const,
      requestedExtractionVersion: plan.extractionVersion,
    },
    { priority: "HIGH" },
  );

  console.log(
    `[SnapshotReprocessing] Queued reprocessing ${scrapeJob.id} from ${plan.sourceScrapeJobId} for ${sanitizeUrlForLogging(plan.url)} (${plan.extractionVersion})`,
  );

  return { ...plan, scrapeJobId: scrapeJob.id };
}
