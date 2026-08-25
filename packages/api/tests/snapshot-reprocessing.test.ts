import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScrapeResultFromHtml,
} from "@savvyedge/ai-agents";
import {
  ExtractionContractError,
  bonusExtractionKey,
} from "@savvyedge/ai-agents/extraction-contract";
import {
  AdminRole,
  AdminUserStatus,
  Prisma,
  prisma,
} from "@savvyedge/database";
import { WorkflowTransitionService } from "@savvyedge/api/workflow";
import { POST as transitionRoute } from "../../../apps/admin/src/app/api/admin/transitions/route";
import { hashSessionToken } from "../../../apps/admin/src/lib/auth";
import { EvidenceArtifactRetrievalError } from "../src/services/evidence-artifact-retrieval.service";
import {
  IngestionService,
  resolveBonusExtractionKey,
} from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { BonusService } from "../src/services/bonus.service";
import { planSnapshotReprocessing } from "@savvyedge/api/snapshot-reprocessing";
import {
  getGovernanceEligibleBonusClaimIds,
  partitionBonusClaimsByActivity,
} from "@savvyedge/api/active-evidence";
import {
  EXTRACTION_IDENTITY_CONSTRAINT,
  isExtractionKeyUniqueViolation,
} from "../src/utils/extraction-identity";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "../..");

const NEW_JOB = "30000000-0000-4000-8000-000000000001";
const SOURCE_JOB = "30000000-0000-4000-8000-000000000002";
const SOURCE_ID = "40000000-0000-4000-8000-000000000001";
const URL = "https://www.betmgm.co.uk/promo";
const OBSERVED_AT = new Date("2026-08-20T11:18:16.311Z");
const LOCATOR = "v1_source_snapshot.html";

const SOURCE_HTML =
  `<!doctype html><html><head><title>Promo</title></head><body><main>` +
  `<h1>Weekly Residency Free Spins</h1>` +
  `<p>Opt in, wager £20+ on eligible games Mon 00:01 - Thurs 23:59 for 10 Free Spins worth 10p each on Gold Blitz Fortune Tower Fusion. Terms apply.</p>` +
  `</main></body></html>`;

function sourceResult() {
  return buildScrapeResultFromHtml({
    url: URL,
    finalUrl: URL,
    rawHtml: SOURCE_HTML,
    timestamp: OBSERVED_AT,
    attemptCount: 1,
    durationMs: 0,
  });
}

const SOURCE = sourceResult();

interface Internals {
  scraperAgent: { run(input: unknown): Promise<unknown> };
  bonusAgent: { run(input: unknown): Promise<unknown> };
  scrapingAntFallbackService: { scrape(url: string): Promise<unknown> };
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
}
const internals = IngestionService as unknown as Internals;

function sourceJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_JOB,
    data_source_id: SOURCE_ID,
    status: "COMPLETED",
    snapshot_path: LOCATOR,
    html_hash: SOURCE.htmlHash,
    content_hash: SOURCE.contentHash,
    canonical_url: URL,
    completed_at: new Date("2026-08-20T11:19:00.000Z"),
    reprocessed_from_id: null,
    extraction_version: null,
    ...overrides,
  };
}

function sourceEvidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence-source",
    observed_at: OBSERVED_AT,
    source_url: URL,
    snapshot_path: LOCATOR,
    html_hash: SOURCE.htmlHash,
    content_hash: SOURCE.contentHash,
    ...overrides,
  };
}

function planningDb(
  options: {
    sourceJob?: Record<string, unknown>;
    sourceEvidence?: Array<Record<string, unknown>>;
    latest?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  return {
    scrapeJob: {
      findUnique: vi.fn().mockResolvedValue(sourceJobRow(options.sourceJob)),
    },
    evidenceRecord: {
      findMany: vi
        .fn()
        .mockResolvedValue(options.sourceEvidence ?? [sourceEvidenceRow()]),
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.latest === undefined
            ? { id: "evidence-source", observed_at: OBSERVED_AT }
            : options.latest,
        ),
      findUnique: vi.fn().mockResolvedValue(options.existing ?? null),
    },
  } as never;
}

function mockArtifactReader(rawHtml = SOURCE_HTML) {
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

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    scrapeJobId: NEW_JOB,
    sourceScrapeJobId: SOURCE_JOB,
    url: URL,
    taskContext: "BONUS" as const,
    requestedExtractionVersion: "extraction-v2",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SAVVY_ENV", "test");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("REPROCESS_SNAPSHOT zero-network boundary", () => {
  it("never imports scraper, browser or provider modules", () => {
    const source = fs.readFileSync(
      path.join(
        repoRoot,
        "packages/api/src/services/snapshot-reprocessing.service.ts",
      ),
      "utf8",
    );
    for (const forbidden of [
      "ScraperAgent",
      "PlaywrightScraper",
      "ScrapingAntFallbackService",
      "playwright",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("reads storage only and makes zero target or provider calls", async () => {
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const provider = vi.spyOn(internals.scrapingAntFallbackService, "scrape");
    const networkFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network request"));
    const reader = mockArtifactReader();

    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue(
      sourceJobRow() as never,
    );
    vi.spyOn(prisma.evidenceRecord, "findFirst").mockResolvedValue({
      observed_at: OBSERVED_AT,
    } as never);
    const jobUpdate = vi
      .spyOn(prisma.scrapeJob, "update")
      .mockResolvedValue({} as never);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "queued" } as never);

    await IngestionService.handleSnapshotReprocessing(basePayload());

    expect(reader).toHaveBeenCalledWith({
      locator: LOCATOR,
      expectedHtmlHash: SOURCE.htmlHash,
    });
    expect(scraper).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();

    // Source observation time is preserved; extracted_at is the new run.
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_BONUS",
      expect.objectContaining({
        scrapeJobId: NEW_JOB,
        observedAt: OBSERVED_AT.toISOString(),
      }),
      { deduplicate: true },
    );
    // Verified hashes are written only after verification.
    expect(jobUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: NEW_JOB },
      data: { snapshot_path: LOCATOR, content_hash: SOURCE.contentHash },
    });
    // The ScrapeJob is NOT completed here; extraction owns completion.
    expect(jobUpdate.mock.calls[0][0].data).not.toHaveProperty("status");
  });
});

describe("REPROCESS_SNAPSHOT failure semantics", () => {
  function failingSetup() {
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue(
      sourceJobRow() as never,
    );
    vi.spyOn(prisma.evidenceRecord, "findFirst").mockResolvedValue({
      observed_at: OBSERVED_AT,
    } as never);
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    return vi.spyOn(JobQueueService, "enqueue");
  }

  it("fails closed on a deployed-version mismatch without extracting", async () => {
    const enqueue = vi.spyOn(JobQueueService, "enqueue");
    const reader = vi.spyOn(internals.evidenceArtifactReader, "readArtifact");
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue(
      sourceJobRow() as never,
    );

    await expect(
      IngestionService.handleSnapshotReprocessing(
        basePayload({ requestedExtractionVersion: "extraction-v1" }),
      ),
    ).rejects.toMatchObject({ code: "EXTRACTION_VERSION_MISMATCH" });

    expect(reader).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails explicitly when the artifact is missing", async () => {
    const enqueue = failingSetup();
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(
      internals.evidenceArtifactReader,
      "readArtifact",
    ).mockRejectedValue(
      new EvidenceArtifactRetrievalError("ARTIFACT_NOT_AVAILABLE"),
    );

    await expect(
      IngestionService.handleSnapshotReprocessing(basePayload()),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_AVAILABLE" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails explicitly when the artifact is corrupt", async () => {
    const enqueue = failingSetup();
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(
      internals.evidenceArtifactReader,
      "readArtifact",
    ).mockRejectedValue(
      new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED"),
    );

    await expect(
      IngestionService.handleSnapshotReprocessing(basePayload()),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails when the rebuilt content diverges from the source observation", async () => {
    const enqueue = failingSetup();
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    mockArtifactReader(
      "<!doctype html><html><body><p>different</p></body></html>",
    );

    await expect(
      IngestionService.handleSnapshotReprocessing(basePayload()),
    ).rejects.toMatchObject({ code: "CONTENT_HASH_DIVERGED" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never puts the snapshot locator into an error", async () => {
    failingSetup();
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(
      internals.evidenceArtifactReader,
      "readArtifact",
    ).mockRejectedValue(
      new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED"),
    );

    let caught: unknown;
    try {
      await IngestionService.handleSnapshotReprocessing(basePayload());
    } catch (error) {
      caught = error;
    }
    const surface = JSON.stringify({
      name: (caught as Error).name,
      message: (caught as Error).message,
      stack: (caught as Error).stack,
    });
    expect(surface).not.toContain(LOCATOR);
    expect(surface).not.toContain("supabase://");
  });
});

describe("source snapshot currency", () => {
  it("rejects an older observed artifact even when its job completed later", async () => {
    const db = planningDb({
      sourceJob: { completed_at: new Date("2026-08-20T15:00:00.000Z") },
      latest: {
        id: "evidence-newer-observation",
        observed_at: new Date("2026-08-20T12:00:00.000Z"),
      },
    });

    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db),
    ).rejects.toMatchObject({ code: "SOURCE_SNAPSHOT_NOT_CURRENT" });
  });

  it("accepts the newest observed artifact when completion order is inverted", async () => {
    const db = planningDb({
      sourceJob: { completed_at: new Date("2026-08-20T11:18:30.000Z") },
    });

    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db),
    ).resolves.toMatchObject({ observedAt: OBSERVED_AT });
  });

  it("does not use nullable legacy completed_at for currency", async () => {
    const db = planningDb({ sourceJob: { completed_at: null } });

    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db),
    ).resolves.toMatchObject({ sourceScrapeJobId: SOURCE_JOB });
  });

  it("excludes reprocessing copies from latest-observation selection", async () => {
    const db = planningDb();

    await planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db);

    expect(db.evidenceRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
        }),
        orderBy: [{ observed_at: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("uses the exact evidence id as the deterministic equal-time tie-breaker", async () => {
    const losingTie = planningDb({
      latest: { id: "evidence-z-tie", observed_at: OBSERVED_AT },
    });
    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, losingTie),
    ).rejects.toMatchObject({ code: "SOURCE_SNAPSHOT_NOT_CURRENT" });

    const winningTie = planningDb({
      latest: { id: "evidence-source", observed_at: OBSERVED_AT },
    });
    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, winningTie),
    ).resolves.toMatchObject({ observedAt: OBSERVED_AT });
  });

  it("rejects an already-processed artifact and version", async () => {
    const key = bonusExtractionKey({
      snapshotLocator: LOCATOR,
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
    });
    const db = planningDb({ existing: { id: "already" } });

    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db),
    ).rejects.toMatchObject({ code: "ALREADY_PROCESSED" });
    expect(key).toContain("extraction-v2:BONUS:");
  });

  it("fails closed when the source observation time is ambiguous", async () => {
    const db = planningDb({
      sourceEvidence: [
        sourceEvidenceRow(),
        sourceEvidenceRow({
          id: "evidence-source-2",
          observed_at: new Date("2026-08-19T00:00:00Z"),
        }),
      ],
    });

    await expect(
      planSnapshotReprocessing({ sourceScrapeJobId: SOURCE_JOB }, db),
    ).rejects.toMatchObject({ code: "SOURCE_OBSERVATION_AMBIGUOUS" });
  });

  it("derives the plan entirely from persisted state", async () => {
    const db = planningDb();

    const plan = await planSnapshotReprocessing(
      { sourceScrapeJobId: SOURCE_JOB },
      db,
    );
    expect(plan).toMatchObject({
      dataSourceId: SOURCE_ID,
      snapshotLocator: LOCATOR,
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
      observedAt: OBSERVED_AT,
      extractionVersion: "extraction-v2",
    });
    expect(plan.extractionKey).toContain("extraction-v2:BONUS:");
  });
});

describe("provenance-scoped extraction identity", () => {
  it("gives two data sources independent identities for identical content", () => {
    // Identity is per artifact; the data source is the other half of the
    // composite unique, so identical text at two sources never collides.
    const a = bonusExtractionKey({
      snapshotLocator: "v1_a.html",
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
    });
    const b = bonusExtractionKey({
      snapshotLocator: "v1_b.html",
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
    });
    expect(a).not.toBe(b);
  });

  it("resolves the same key for repeated reprocessing of one artifact", () => {
    const first = bonusExtractionKey({
      snapshotLocator: LOCATOR,
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
    });
    const second = bonusExtractionKey({
      snapshotLocator: LOCATOR,
      htmlHash: SOURCE.htmlHash,
      contentHash: SOURCE.contentHash,
    });
    expect(first).toBe(second);
  });

  it("pins the database constraints and aborting migration preflight", () => {
    const schema = fs.readFileSync(
      path.join(repoRoot, "packages/database/prisma/schema.prisma"),
      "utf8",
    );
    const migration = fs.readFileSync(
      path.join(
        repoRoot,
        "packages/database/prisma/migrations/20260820140000_versioned_snapshot_reprocessing/migration.sql",
      ),
      "utf8",
    );

    expect(schema).toContain(
      '@@unique([bonus_id, extraction_context], map: "ActiveExtractionPointer_bonus_id_extraction_context_key")',
    );
    expect(schema).not.toContain(
      "@@unique([data_source_id, extraction_context]",
    );
    expect(migration).toContain("DO $$");
    expect(migration).toContain("RAISE EXCEPTION USING");
    expect(migration).toContain("HAVING COUNT(*) > 1");
    expect(migration.indexOf("DO $$")).toBeLessThan(
      migration.indexOf('ALTER TABLE "ScrapeJob"'),
    );
    expect(migration).toContain(EXTRACTION_IDENTITY_CONSTRAINT);
  });
});

describe("malformed extraction provenance", () => {
  it("never degrades a newly governed ingestion write to a NULL key", async () => {
    const tx = {
      reviewActor: {
        upsert: vi.fn().mockResolvedValue({ id: "actor-ingestion" }),
      },
      scrapeJob: {
        findUnique: vi.fn().mockResolvedValue({
          ...sourceJobRow({
            id: NEW_JOB,
            status: "PROCESSING",
            html_hash: "synthetic-not-sha256",
          }),
        }),
        update: vi.fn(),
      },
      evidenceRecord: { create: vi.fn() },
      bonusHistoryEvent: { create: vi.fn() },
      bonus: { update: vi.fn(), updateMany: vi.fn() },
      activeExtractionPointer: { upsert: vi.fn() },
    };
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue({
      id: "casino-1",
      review_status: "NEW",
      publication_status: "UNPUBLISHED",
      governance_version: 0,
    } as never);
    vi.spyOn(internals.bonusAgent, "run").mockResolvedValue({
      casino_id: "casino-1",
      type: "FREE_SPINS",
      headline_value: "10 free spins",
      wagering_requirement: null,
      max_conversion: null,
      valid_from: null,
      valid_until: null,
      status: "ACTIVE",
    });
    vi.spyOn(BonusService, "saveGovernedBonus").mockResolvedValue({
      bonus: { id: "bonus-1", type: "FREE_SPINS" },
      isNew: true,
      isApprovedOrPublished: false,
      hasFieldDiffs: false,
    } as never);
    vi.spyOn(
      IngestionService as unknown as {
        runGovernedPersistenceTransaction: <T>(
          operation: (tx: unknown) => Promise<T>,
        ) => Promise<T>;
      },
      "runGovernedPersistenceTransaction",
    ).mockImplementation((operation) => operation(tx));

    await expect(
      IngestionService.handleExtraction({
        scrapeJobId: NEW_JOB,
        url: URL,
        casinoId: "casino-1",
        scrapedContent: "Get 10 free spins",
        observedAt: OBSERVED_AT.toISOString(),
      }),
    ).rejects.toMatchObject({
      name: "ExtractionContractError",
      code: "INVALID_HTML_HASH",
    });

    expect(tx.evidenceRecord.create).not.toHaveBeenCalled();
    expect(tx.bonusHistoryEvent.create).not.toHaveBeenCalled();
    expect(tx.bonus.update).not.toHaveBeenCalled();
    expect(tx.bonus.updateMany).not.toHaveBeenCalled();
    expect(tx.activeExtractionPointer.upsert).not.toHaveBeenCalled();
    expect(tx.scrapeJob.update).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(prisma.scrapeJob.updateMany)
        .mock.calls.some(([call]) => call.data.status === "COMPLETED"),
    ).toBe(false);
  });

  it("rejects missing provenance rather than returning NULL", () => {
    expect(() => resolveBonusExtractionKey(null)).toThrow(
      ExtractionContractError,
    );
  });
});

describe("active versus historical claim selection", () => {
  const BONUS_ID = "50000000-0000-4000-8000-000000000001";

  it("preserves legacy behaviour before any pointer exists", async () => {
    const db = {
      bonusEvidenceClaim: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "claim-old", evidence_id: "ev-old" }]),
      },
      activeExtractionPointer: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;

    expect(await getGovernanceEligibleBonusClaimIds(BONUS_ID, db)).toEqual([
      "claim-old",
    ]);
  });

  it("excludes the historical 20 SUPPORTS claim once a pointer exists", async () => {
    const db = {
      bonusEvidenceClaim: {
        findMany: vi.fn().mockResolvedValue([
          { id: "claim-stale-20", evidence_id: "ev-old" },
          { id: "claim-current", evidence_id: "ev-new" },
        ]),
      },
      activeExtractionPointer: {
        findUnique: vi.fn().mockResolvedValue({ evidence_id: "ev-new" }),
      },
    } as never;

    const eligible = await getGovernanceEligibleBonusClaimIds(BONUS_ID, db);
    expect(eligible).toEqual(["claim-current"]);
    expect(eligible).not.toContain("claim-stale-20");
  });

  it("reverifying bonus A cannot supersede bonus B on the same data source", async () => {
    const BONUS_B_ID = "50000000-0000-4000-8000-000000000002";
    const db = {
      bonusEvidenceClaim: {
        findMany: vi.fn().mockImplementation(({ where }) =>
          where.bonus_id === BONUS_ID
            ? [
                { id: "claim-a-old", evidence_id: "ev-shared-old" },
                { id: "claim-a-new", evidence_id: "ev-a-new" },
              ]
            : [
                { id: "claim-b-current", evidence_id: "ev-shared-old" },
                { id: "claim-b-unrelated", evidence_id: "ev-b-other" },
              ],
        ),
      },
      activeExtractionPointer: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const bonusId = where.bonus_id_extraction_context.bonus_id;
          return bonusId === BONUS_ID
            ? { evidence_id: "ev-a-new" }
            : { evidence_id: "ev-shared-old" };
        }),
      },
    } as never;

    expect(await getGovernanceEligibleBonusClaimIds(BONUS_ID, db)).toEqual([
      "claim-a-new",
    ]);
    expect(await getGovernanceEligibleBonusClaimIds(BONUS_B_ID, db)).toEqual([
      "claim-b-current",
    ]);
    expect(db.activeExtractionPointer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bonus_id_extraction_context: {
            bonus_id: BONUS_B_ID,
            extraction_context: "BONUS",
          },
        },
      }),
    );
  });
});

describe("exactly-once effective extraction", () => {
  function p2002(target: unknown) {
    return new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target },
      } as never,
    );
  }

  function extractionKeyConflict() {
    return p2002(["data_source_id", "extraction_key"]);
  }

  function mockWinningReconciliation() {
    const tx = {
      scrapeJob: {
        findUnique: vi.fn().mockResolvedValue({
          ...sourceJobRow({ id: NEW_JOB, status: "PROCESSING" }),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      evidenceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          id: "winning-evidence",
          bonus_claims: [{ bonus_id: "winning-bonus" }],
        }),
      },
      activeExtractionPointer: {
        count: vi.fn().mockResolvedValue(1),
      },
    };
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) =>
      callback(tx),
    );
    return tx;
  }

  it("classifies only the exact extraction-identity constraint", () => {
    expect(isExtractionKeyUniqueViolation(extractionKeyConflict())).toBe(true);
    expect(
      isExtractionKeyUniqueViolation(p2002(EXTRACTION_IDENTITY_CONSTRAINT)),
    ).toBe(true);
    expect(
      isExtractionKeyUniqueViolation(
        p2002(["data_source_id", "extraction_key", "other"]),
      ),
    ).toBe(false);
    expect(
      isExtractionKeyUniqueViolation(
        p2002(`prefix_${EXTRACTION_IDENTITY_CONSTRAINT}`),
      ),
    ).toBe(false);
    expect(
      isExtractionKeyUniqueViolation(p2002(["casino_id", "source_offer_key"])),
    ).toBe(false);
  });

  it("completes the losing race benignly without partial domain writes", async () => {
    const perform = vi
      .spyOn(
        IngestionService as unknown as {
          performExtraction: (p: unknown) => Promise<unknown>;
        },
        "performExtraction",
      )
      .mockRejectedValue(extractionKeyConflict());
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    const reconciliation = mockWinningReconciliation();
    const bonusUpdate = vi.spyOn(prisma.bonus, "update");
    const historyCreate = vi.spyOn(prisma.bonusHistoryEvent, "create");
    const claimCreate = vi.spyOn(prisma.bonusEvidenceClaim, "create");
    const pointerUpsert = vi.spyOn(prisma.activeExtractionPointer, "upsert");

    // Resolves rather than throwing: a duplicate is not a failure.
    await expect(
      IngestionService.handleExtraction({
        scrapeJobId: NEW_JOB,
        url: URL,
        scrapedContent: "content",
        observedAt: OBSERVED_AT.toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect(perform).toHaveBeenCalledOnce();
    // The Serializable transaction rolled back, so nothing domain-level ran
    // outside it, and the loser writes only its own terminal status.
    expect(bonusUpdate).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(claimCreate).not.toHaveBeenCalled();
    expect(pointerUpsert).not.toHaveBeenCalled();

    const terminal = reconciliation.scrapeJob.updateMany.mock.calls.at(-1)![0];
    expect(terminal).toMatchObject({
      where: { id: NEW_JOB, status: "PROCESSING" },
      data: { status: "COMPLETED" },
    });
    expect(reconciliation.activeExtractionPointer.count).toHaveBeenCalledWith({
      where: {
        bonus_id: { in: ["winning-bonus"] },
        extraction_context: "BONUS",
        evidence_id: "winning-evidence",
      },
    });
  });

  it("skips a queue retry after the loser has been reconciled to COMPLETED", async () => {
    const perform = vi
      .spyOn(
        IngestionService as unknown as {
          performExtraction: (p: unknown) => Promise<unknown>;
        },
        "performExtraction",
      )
      .mockRejectedValueOnce(extractionKeyConflict());
    vi.spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue({
      status: "COMPLETED",
    } as never);
    mockWinningReconciliation();

    const payload = {
      scrapeJobId: NEW_JOB,
      url: URL,
      scrapedContent: "content",
      observedAt: OBSERVED_AT.toISOString(),
    };
    await IngestionService.handleExtraction(payload);
    await IngestionService.handleExtraction(payload);

    expect(perform).toHaveBeenCalledOnce();
  });

  it("still fails loudly for unrelated unique violations", async () => {
    const unrelated = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target: ["casino_id", "source_offer_key"] },
      } as never,
    );
    vi.spyOn(
      IngestionService as unknown as {
        performExtraction: (p: unknown) => Promise<unknown>;
      },
      "performExtraction",
    ).mockRejectedValue(unrelated);
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    const reconciliation = vi.spyOn(prisma, "$transaction");

    await expect(
      IngestionService.handleExtraction({
        scrapeJobId: NEW_JOB,
        url: URL,
        scrapedContent: "content",
        observedAt: OBSERVED_AT.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(reconciliation).not.toHaveBeenCalled();
  });
});

describe("recovery after enqueue failure", () => {
  it("re-reads storage only, with no target or provider call", async () => {
    const scraper = vi.spyOn(internals.scraperAgent, "run");
    const provider = vi.spyOn(internals.scrapingAntFallbackService, "scrape");
    const reader = mockArtifactReader();
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue(
      sourceJobRow() as never,
    );
    vi.spyOn(prisma.evidenceRecord, "findFirst").mockResolvedValue({
      observed_at: OBSERVED_AT,
    } as never);
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);

    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue({ id: "queued" } as never);

    await expect(
      IngestionService.handleSnapshotReprocessing(basePayload()),
    ).rejects.toThrow();

    // Redelivery succeeds from storage alone.
    await IngestionService.handleSnapshotReprocessing(basePayload());

    expect(reader).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(scraper).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("reviewer evidence labelling", () => {
  it.each([
    "apps/admin/src/app/review/bonus/[id]/page.tsx",
    "apps/admin/src/app/quarantine/bonus/[id]/page.tsx",
  ])("labels active versus historical evidence in %s", (relative) => {
    const source = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    expect(source).toContain("ACTIVE EVIDENCE");
    expect(source).toContain("HISTORICAL EVIDENCE");
    expect(source).toContain("partitionBonusClaimsByActivity");
  });

  it("collects only active claims for governance transitions", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "apps/admin/src/app/api/admin/transitions/route.ts"),
      "utf8",
    );
    expect(source).toContain("getGovernanceEligibleBonusClaimIds");
    expect(source).not.toContain("bonusEvidenceClaim.findMany");

    // Every BONUS path that attaches evidence must go through the server-side
    // resolver, never through the raw request body.
    expect(source).toContain("getGovernanceEligibleBonusClaimIdsForTransition");
    expect(source).not.toContain("claimIds: parsed.claimIds ?? []");

    // The BONUS branch must be resolved before the client short-circuit,
    // otherwise a supplied set silently bypasses the boundary again.
    expect(source.indexOf('request.subjectType === "BONUS"')).toBeLessThan(
      source.indexOf("if (request.claimIds && request.claimIds.length > 0)"),
    );
  });
});

describe("bonus governance UI transition payloads", () => {
  // Defence in depth: the admin transitions route stays authoritative, but the
  // BONUS pages must stop handing superseded claim ids to the controls at all.
  const BONUS_PAGES = [
    ["review", "apps/admin/src/app/review/bonus/[id]/page.tsx"],
    ["quarantine", "apps/admin/src/app/quarantine/bonus/[id]/page.tsx"],
  ] as const;

  // Formatting-tolerant: only the shape of the derivation is contractual.
  const DERIVES_FROM_ACTIVE_SET =
    /const transitionClaimIds = bonus\.evidence_claims\s*\.filter\(\(claim\) => activeClaimIds\.has\(claim\.id\)\)\s*\.map\(\(claim\) => claim\.id\)/;

  function readPageSource(relative: string): string {
    return fs
      .readFileSync(path.join(repoRoot, relative), "utf8")
      .replace(/\s+/g, " ");
  }

  it.each(BONUS_PAGES)(
    "the bonus %s page narrows the transition payload to active claims",
    (_label, relative) => {
      const source = readPageSource(relative);

      expect(source).toMatch(DERIVES_FROM_ACTIVE_SET);
      expect(source).toContain("claimIds={transitionClaimIds}");
      expect(source).not.toContain("claimIds={claimIds}");
    },
  );

  it.each(BONUS_PAGES)(
    "the bonus %s page still displays every claim, active and historical",
    (_label, relative) => {
      const source = readPageSource(relative);

      // Display iterates the full claim list, never the narrowed payload.
      expect(source).toContain("bonus.evidence_claims.map((claim) => (");
      expect(source).toContain("ACTIVE EVIDENCE");
      expect(source).toContain("HISTORICAL EVIDENCE");
    },
  );

  describe("derivation semantics against the real activity partition", () => {
    const BONUS_ID = "50000000-0000-4000-8000-000000000020";
    const ACTIVE_EVIDENCE_ID = "60000000-0000-4000-8000-000000000011";
    const HISTORICAL_EVIDENCE_ID = "60000000-0000-4000-8000-000000000012";

    // Ordered as the pages render them (created_at desc), with superseded rows
    // interleaved so an order-preserving filter is distinguishable.
    const DISPLAYED_CLAIMS = [
      { id: "70000000-0000-4000-8000-000000000011", evidence_id: ACTIVE_EVIDENCE_ID },
      { id: "70000000-0000-4000-8000-000000000012", evidence_id: HISTORICAL_EVIDENCE_ID },
      { id: "70000000-0000-4000-8000-000000000013", evidence_id: HISTORICAL_EVIDENCE_ID },
      { id: "70000000-0000-4000-8000-000000000014", evidence_id: ACTIVE_EVIDENCE_ID },
    ];
    const ACTIVE_IDS = [
      "70000000-0000-4000-8000-000000000011",
      "70000000-0000-4000-8000-000000000014",
    ];

    function stubClaimReads(hasActivePointer: boolean) {
      vi.spyOn(prisma.bonusEvidenceClaim, "findMany").mockImplementation(
        (async ({ where }: { where: { bonus_id: string } }) =>
          where.bonus_id === BONUS_ID ? DISPLAYED_CLAIMS : []) as never,
      );
      vi.spyOn(prisma.activeExtractionPointer, "findUnique").mockResolvedValue(
        (hasActivePointer
          ? { id: "pointer-1", evidence_id: ACTIVE_EVIDENCE_ID }
          : null) as never,
      );
    }

    /** The expression both BONUS pages evaluate, asserted on above. */
    async function transitionClaimIdsFor(hasActivePointer: boolean) {
      stubClaimReads(hasActivePointer);
      const { activeClaimIds } = await partitionBonusClaimsByActivity(BONUS_ID);
      return DISPLAYED_CLAIMS.filter((claim) =>
        activeClaimIds.has(claim.id),
      ).map((claim) => claim.id);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("yields only active claims, in display order", async () => {
      expect(await transitionClaimIdsFor(true)).toEqual(ACTIVE_IDS);
    });

    it("preserves legacy behaviour for bonuses with no active extraction pointer", async () => {
      // Pre-contract bonuses keep every displayed claim in the payload.
      expect(await transitionClaimIdsFor(false)).toEqual(
        DISPLAYED_CLAIMS.map((claim) => claim.id),
      );
    });
  });
});

describe("governed bonus evidence boundary for admin transitions", () => {
  // Mirrors the production incident: the active extraction carries only the
  // two current claims, while historical evidence correctly retains the older
  // ones, including the retracted WAGERING_REQUIREMENT = 20.
  const BONUS_ID = "50000000-0000-4000-8000-000000000010";
  const ACTIVE_EVIDENCE_ID = "60000000-0000-4000-8000-000000000001";
  const HISTORICAL_EVIDENCE_ID = "60000000-0000-4000-8000-000000000002";

  const ACTIVE_CLAIMS = [
    // TYPE = FREE_SPINS
    { id: "70000000-0000-4000-8000-000000000001", evidence_id: ACTIVE_EVIDENCE_ID },
    // HEADLINE_VALUE = 10 Free Spins
    { id: "70000000-0000-4000-8000-000000000002", evidence_id: ACTIVE_EVIDENCE_ID },
  ];
  const HISTORICAL_CLAIMS = [
    // WAGERING_REQUIREMENT = 20, superseded by the reprocessed extraction.
    { id: "70000000-0000-4000-8000-000000000003", evidence_id: HISTORICAL_EVIDENCE_ID },
    { id: "70000000-0000-4000-8000-000000000004", evidence_id: HISTORICAL_EVIDENCE_ID },
    { id: "70000000-0000-4000-8000-000000000005", evidence_id: HISTORICAL_EVIDENCE_ID },
  ];
  const ALL_CLAIMS = [...ACTIVE_CLAIMS, ...HISTORICAL_CLAIMS];

  const ACTIVE_CLAIM_IDS = ACTIVE_CLAIMS.map((claim) => claim.id);
  const HISTORICAL_CLAIM_IDS = HISTORICAL_CLAIMS.map((claim) => claim.id);
  // A claim belonging to a different bonus entirely.
  const FOREIGN_CLAIM_ID = "70000000-0000-4000-8000-0000000000ff";

  const SESSION_TOKEN = "boundary-regression-session-token";

  function stubBoundaryReads(options: { hasActivePointer?: boolean } = {}) {
    const { hasActivePointer = true } = options;

    // The eligible set is queried by bonus_id, so a foreign-subject claim id
    // is never a member of it regardless of what the browser supplies.
    vi.spyOn(prisma.bonusEvidenceClaim, "findMany").mockImplementation(
      (async ({ where }: { where: { bonus_id: string } }) =>
        where.bonus_id === BONUS_ID ? ALL_CLAIMS : []) as never,
    );
    vi.spyOn(prisma.activeExtractionPointer, "findUnique").mockResolvedValue(
      (hasActivePointer
        ? { evidence_id: ACTIVE_EVIDENCE_ID }
        : null) as never,
    );
    vi.spyOn(prisma.adminSession, "findUnique").mockResolvedValue({
      id: "80000000-0000-4000-8000-000000000001",
      token_hash: hashSessionToken(SESSION_TOKEN),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      revoked_at: null,
      user: {
        id: "90000000-0000-4000-8000-000000000001",
        email: "admin@savvyedge.com",
        display_name: "Boundary Admin",
        role: AdminRole.ADMIN,
        status: AdminUserStatus.ACTIVE,
        actor_id: "a0000000-0000-4000-8000-000000000001",
        actor: { stable_key: "admin-user:boundary" },
      },
    } as never);
  }

  function transitionRequest(action: string, claimIds: string[]) {
    return new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${SESSION_TOKEN}` },
      body: JSON.stringify({
        subjectType: "BONUS",
        subjectId: BONUS_ID,
        action,
        expectedVersion: 1,
        claimIds,
      }),
    });
  }

  /** The claim ids the route actually hands to the workflow transition. */
  async function linkedClaimIdsFor(
    action: "APPROVE" | "PUBLISH",
    suppliedClaimIds: string[],
  ): Promise<string[]> {
    const method =
      action === "APPROVE" ? "transitionBonusReview" : "transitionBonusPublication";
    const spy = vi
      .spyOn(WorkflowTransitionService.prototype, method)
      .mockResolvedValue({ ok: true } as never);

    const response = await transitionRoute(transitionRequest(action, suppliedClaimIds));
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    return [...(spy.mock.calls[0][0].claimIds ?? [])];
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["APPROVE", "PUBLISH"] as const)(
    "%s cannot link historical claims the browser supplies alongside active ones",
    async (action) => {
      stubBoundaryReads();

      // Exactly the payload the real admin UI sends today: every claim the
      // review page rendered, active and historical together.
      const linked = await linkedClaimIdsFor(action, [
        ...ACTIVE_CLAIM_IDS,
        ...HISTORICAL_CLAIM_IDS,
      ]);

      expect(linked.sort()).toEqual([...ACTIVE_CLAIM_IDS].sort());
      for (const historicalId of HISTORICAL_CLAIM_IDS) {
        expect(linked).not.toContain(historicalId);
      }
      // The five-claim link that reached production must be impossible.
      expect(linked).toHaveLength(2);
    },
  );

  it.each(["APPROVE", "PUBLISH"] as const)(
    "%s keeps active extraction claims attachable",
    async (action) => {
      stubBoundaryReads();

      expect((await linkedClaimIdsFor(action, ACTIVE_CLAIM_IDS)).sort()).toEqual(
        [...ACTIVE_CLAIM_IDS].sort(),
      );
    },
  );

  it("cannot link a foreign-subject claim id supplied by the browser", async () => {
    stubBoundaryReads();

    const linked = await linkedClaimIdsFor("APPROVE", [
      ...ACTIVE_CLAIM_IDS,
      FOREIGN_CLAIM_ID,
    ]);

    expect(linked).not.toContain(FOREIGN_CLAIM_ID);
    expect(linked.sort()).toEqual([...ACTIVE_CLAIM_IDS].sort());
  });

  it("cannot link only-ineligible claims even when they are the entire payload", async () => {
    stubBoundaryReads();

    // Fails closed downstream rather than linking superseded evidence.
    const linked = await linkedClaimIdsFor("APPROVE", HISTORICAL_CLAIM_IDS);

    expect(linked.sort()).toEqual([...ACTIVE_CLAIM_IDS].sort());
    for (const historicalId of HISTORICAL_CLAIM_IDS) {
      expect(linked).not.toContain(historicalId);
    }
  });

  it("preserves legacy behaviour for bonuses with no active extraction pointer", async () => {
    stubBoundaryReads({ hasActivePointer: false });

    const linked = await linkedClaimIdsFor("APPROVE", ACTIVE_CLAIM_IDS);

    // Pre-contract bonuses keep every claim governance eligible.
    expect(linked.sort()).toEqual(ALL_CLAIMS.map((c) => c.id).sort());
  });

  it("leaves historical claims queryable, merely unlinked", async () => {
    stubBoundaryReads();

    const eligible = await getGovernanceEligibleBonusClaimIds(BONUS_ID);
    expect(eligible.sort()).toEqual([...ACTIVE_CLAIM_IDS].sort());

    // The historical rows are still readable; nothing was rewritten or deleted.
    const rows = await prisma.bonusEvidenceClaim.findMany({
      where: { bonus_id: BONUS_ID },
      select: { id: true, evidence_id: true },
    });
    expect(rows.map((row: { id: string }) => row.id).sort()).toEqual(
      ALL_CLAIMS.map((c) => c.id).sort(),
    );
  });

  it("narrows CLEAR_QUARANTINE evidence to the active extraction as well", async () => {
    stubBoundaryReads();

    const spy = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockResolvedValue({ ok: true } as never);

    const response = await transitionRoute(
      new Request("http://localhost/api/admin/transitions", {
        method: "POST",
        headers: { Cookie: `savvy_admin_session=${SESSION_TOKEN}` },
        body: JSON.stringify({
          subjectType: "BONUS",
          subjectId: BONUS_ID,
          action: "CLEAR_QUARANTINE",
          expectedVersion: 1,
          claimIds: [...ACTIVE_CLAIM_IDS, ...HISTORICAL_CLAIM_IDS],
          internalReason: "Quarantine cleared after snapshot reprocessing.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const linked = [...(spy.mock.calls[0][0].claimIds ?? [])];
    expect(linked.sort()).toEqual([...ACTIVE_CLAIM_IDS].sort());
  });
});
