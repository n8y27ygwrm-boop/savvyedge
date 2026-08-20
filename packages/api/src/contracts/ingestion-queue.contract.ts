import { INGESTION_QUEUE_NAME } from "../constants/queue-names";

export const INGESTION_JOB_TYPES = [
  "DISCOVER_SEEDS",
  "INGEST_URL",
  "CRAWL_URL",
  "EXTRACT_BONUS",
  "EXTRACT_GAME_LIST",
  "REPROCESS_SNAPSHOT",
  "VALIDATE_BONUS",
] as const;

export type IngestionJobType = (typeof INGESTION_JOB_TYPES)[number];

export interface IngestionJobPayloadMap {
  DISCOVER_SEEDS: { seedUrls?: string[] };
  INGEST_URL: { url: string; discovered_id?: string };
  CRAWL_URL: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    taskContext?: "BONUS" | "GAME_LIST";
  };
  EXTRACT_BONUS: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    scrapedMetadata?: unknown;
    observedAt: string;
  };
  EXTRACT_GAME_LIST: {
    scrapeJobId: string;
    url: string;
    casinoId: string;
    scrapedContent: string;
  };
  VALIDATE_BONUS: { bonusId: string; url: string };
  /**
   * Re-interpret an already persisted authoritative snapshot under the current
   * extraction contract. Every field is server-derived from the source
   * execution; the caller supplies only sourceScrapeJobId to the admin route.
   */
  REPROCESS_SNAPSHOT: {
    scrapeJobId: string;
    sourceScrapeJobId: string;
    url: string;
    taskContext: "BONUS";
    requestedExtractionVersion: string;
    casinoId?: string;
  };
}

export type IngestionQueueHandlers = {
  [JobType in IngestionJobType]: (
    payload: IngestionJobPayloadMap[JobType],
  ) => Promise<unknown>;
};

export type IngestionQueueContractErrorCode =
  | "INGESTION_JOB_WRONG_QUEUE"
  | "UNKNOWN_INGESTION_JOB"
  | "INVALID_INGESTION_PAYLOAD";

export class IngestionQueueContractError extends Error {
  constructor(
    public readonly code: IngestionQueueContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestionQueueContractError";
  }
}

const ingestionJobTypes = new Set<string>(INGESTION_JOB_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidPayload(taskType: IngestionJobType, reason: string): never {
  throw new IngestionQueueContractError(
    "INVALID_INGESTION_PAYLOAD",
    `${taskType} payload is invalid: ${reason}`,
  );
}

export function isIngestionJobType(
  taskType: string,
): taskType is IngestionJobType {
  return ingestionJobTypes.has(taskType);
}

export function assertIngestionQueueJob(
  queueName: string,
  taskType: string,
  payload: unknown,
): asserts payload is IngestionJobPayloadMap[IngestionJobType] {
  const knownTask = isIngestionJobType(taskType);

  if (queueName !== INGESTION_QUEUE_NAME) {
    if (knownTask) {
      throw new IngestionQueueContractError(
        "INGESTION_JOB_WRONG_QUEUE",
        `${taskType} must be routed through ${INGESTION_QUEUE_NAME}`,
      );
    }
    return;
  }

  if (!knownTask) {
    throw new IngestionQueueContractError(
      "UNKNOWN_INGESTION_JOB",
      `${taskType} is not supported by ${INGESTION_QUEUE_NAME}`,
    );
  }

  if (!isRecord(payload)) {
    invalidPayload(taskType, "expected an object");
  }

  switch (taskType) {
    case "DISCOVER_SEEDS":
      if (
        payload.seedUrls !== undefined &&
        (!Array.isArray(payload.seedUrls) ||
          payload.seedUrls.some((url) => !isNonEmptyString(url)))
      ) {
        invalidPayload(taskType, "seedUrls must be an array of strings");
      }
      return;

    case "INGEST_URL":
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
      if (
        payload.discovered_id !== undefined &&
        !isNonEmptyString(payload.discovered_id)
      ) {
        invalidPayload(taskType, "discovered_id must be a non-empty string");
      }
      return;

    case "CRAWL_URL":
      if (!isNonEmptyString(payload.scrapeJobId)) {
        invalidPayload(taskType, "scrapeJobId is required");
      }
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
      if (
        payload.taskContext !== undefined &&
        payload.taskContext !== "BONUS" &&
        payload.taskContext !== "GAME_LIST"
      ) {
        invalidPayload(taskType, "taskContext must be BONUS or GAME_LIST");
      }
      if (
        payload.casinoId !== undefined &&
        !isNonEmptyString(payload.casinoId)
      ) {
        invalidPayload(taskType, "casinoId must be a non-empty string");
      }
      if (
        payload.taskContext === "GAME_LIST" &&
        !isNonEmptyString(payload.casinoId)
      ) {
        invalidPayload(taskType, "casinoId is required for GAME_LIST");
      }
      return;

    case "EXTRACT_BONUS":
      if (!isNonEmptyString(payload.scrapeJobId)) {
        invalidPayload(taskType, "scrapeJobId is required");
      }
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
      if (!isNonEmptyString(payload.scrapedContent)) {
        invalidPayload(taskType, "scrapedContent is required");
      }
      if (
        !isNonEmptyString(payload.observedAt) ||
        !Number.isFinite(new Date(payload.observedAt).getTime())
      ) {
        invalidPayload(taskType, "observedAt must be a valid timestamp");
      }
      if (
        payload.casinoId !== undefined &&
        !isNonEmptyString(payload.casinoId)
      ) {
        invalidPayload(taskType, "casinoId must be a non-empty string");
      }
      return;

    case "EXTRACT_GAME_LIST":
      if (!isNonEmptyString(payload.scrapeJobId)) {
        invalidPayload(taskType, "scrapeJobId is required");
      }
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
      if (!isNonEmptyString(payload.casinoId)) {
        invalidPayload(taskType, "casinoId is required");
      }
      if (!isNonEmptyString(payload.scrapedContent)) {
        invalidPayload(taskType, "scrapedContent is required");
      }
      return;

    case "REPROCESS_SNAPSHOT":
      if (!isNonEmptyString(payload.scrapeJobId)) {
        invalidPayload(taskType, "scrapeJobId is required");
      }
      if (!isNonEmptyString(payload.sourceScrapeJobId)) {
        invalidPayload(taskType, "sourceScrapeJobId is required");
      }
      if (payload.sourceScrapeJobId === payload.scrapeJobId) {
        invalidPayload(taskType, "sourceScrapeJobId must differ from scrapeJobId");
      }
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
      // V1 is BONUS only. GAME_LIST reprocessing is deliberately unsupported.
      if (payload.taskContext !== "BONUS") {
        invalidPayload(taskType, "taskContext must be BONUS");
      }
      if (!isNonEmptyString(payload.requestedExtractionVersion)) {
        invalidPayload(taskType, "requestedExtractionVersion is required");
      }
      if (
        payload.casinoId !== undefined &&
        !isNonEmptyString(payload.casinoId)
      ) {
        invalidPayload(taskType, "casinoId must be a non-empty string");
      }
      return;

    case "VALIDATE_BONUS":
      if (!isNonEmptyString(payload.bonusId)) {
        invalidPayload(taskType, "bonusId is required");
      }
      if (!isNonEmptyString(payload.url)) {
        invalidPayload(taskType, "url is required");
      }
  }
}
