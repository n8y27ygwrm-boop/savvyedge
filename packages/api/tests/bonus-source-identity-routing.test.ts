import { prisma } from "@savvyedge/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BonusService } from "../src/services/bonus.service";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { IngestionService } from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";

const TEST_HTML_HASH = "a".repeat(64);
const TEST_CONTENT_HASH = "b".repeat(64);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Bonus source identity result routing", () => {
  it("returns the exact governed persistence result from extraction", async () => {
    const persisted = {
      casino: { id: "casino-canonical" },
      bonus: { id: "bonus-canonical" },
      evidence: { id: "evidence-canonical" },
    };
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
      persisted.casino as never,
    );
    vi.spyOn(
      (
        IngestionService as unknown as {
          bonusAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).bonusAgent,
      "run",
    ).mockResolvedValue({
      casino_id: persisted.casino.id,
      type: "WELCOME",
      headline_value: "100% up to £200",
      wagering_requirement: 35,
      max_conversion: 500,
      valid_from: null,
      valid_until: null,
      status: "ACTIVE",
    });
    vi.spyOn(
      IngestionService as unknown as {
        runGovernedPersistenceTransaction: (
          operation: unknown,
        ) => Promise<unknown>;
      },
      "runGovernedPersistenceTransaction",
    ).mockResolvedValue(persisted);

    const result = await (
      IngestionService as unknown as {
        performExtraction: (payload: {
          url: string;
          casinoId: string;
          scrapedContent: string;
          observedAt: string;
        }) => Promise<typeof persisted>;
      }
    ).performExtraction({
      url: "https://casino.example.com/promotions/welcome",
      casinoId: persisted.casino.id,
      scrapedContent: "100% up to £200",
      observedAt: "2026-08-11T10:20:30.456Z",
    });

    expect(result.casino).toBe(persisted.casino);
    expect(result.bonus).toBe(persisted.bonus);
    expect(result.evidence).toBe(persisted.evidence);
    expect(result.bonus.id).toBe("bonus-canonical");
  });

  it("uses one canonical Bonus ID for evidence, workflow, and the returned result", async () => {
    const casino = {
      id: "casino-canonical",
      review_status: "APPROVED",
      publication_status: "UNPUBLISHED",
      governance_version: 4,
    };
    const savedBonus = { id: "bonus-canonical" };
    const evidence = { id: "evidence-canonical" };
    const transaction = {
      reviewActor: {
        upsert: vi.fn().mockResolvedValue({ id: "actor-ingestion" }),
      },
      scrapeJob: {
        findUnique: vi.fn().mockResolvedValue({
          id: "scrape-canonical",
          data_source_id: "source-canonical",
          canonical_url:
            "https://casino.example.com/promotions/canonical-welcome",
          snapshot_path:
            "supabase://savvyedge-evidence/v1/initial-observation.html",
          html_hash: TEST_HTML_HASH,
          content_hash: TEST_CONTENT_HASH,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      evidenceRecord: {
        create: vi.fn().mockResolvedValue(evidence),
      },
      bonusEvidenceClaim: {
        create: vi
          .fn()
          .mockImplementation(async ({ data }) => ({
            id: `claim-${data.field}`,
          })),
      },
      activeExtractionPointer: {
        upsert: vi.fn().mockResolvedValue({ id: "active-canonical" }),
      },
    };
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(casino as never);
    vi.spyOn(
      (
        IngestionService as unknown as {
          bonusAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).bonusAgent,
      "run",
    ).mockResolvedValue({
      casino_id: casino.id,
      type: "WELCOME",
      headline_value: "100% up to £200",
      wagering_requirement: 35,
      max_conversion: 500,
      valid_from: null,
      valid_until: null,
      status: "ACTIVE",
    });
    vi.spyOn(BonusService, "saveGovernedBonus").mockResolvedValue({
      bonus: savedBonus,
      isNew: true,
      isApprovedOrPublished: false,
      hasFieldDiffs: false,
    } as never);
    const transition = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockResolvedValue({} as never);
    vi.spyOn(
      IngestionService as unknown as {
        runGovernedPersistenceTransaction: <T>(
          operation: (tx: unknown) => Promise<T>,
        ) => Promise<T>;
      },
      "runGovernedPersistenceTransaction",
    ).mockImplementation((operation) => operation(transaction));

    const result = await (
      IngestionService as unknown as {
        performExtraction: (payload: {
          scrapeJobId: string;
          url: string;
          casinoId: string;
          scrapedContent: string;
          observedAt: string;
        }) => Promise<{
          casino: typeof casino;
          bonus: typeof savedBonus;
          evidence: typeof evidence;
        }>;
      }
    ).performExtraction({
      scrapeJobId: "scrape-canonical",
      url: "https://casino.example.com/go/welcome",
      casinoId: casino.id,
      scrapedContent: "100% up to £200, wagering 35x",
      observedAt: "2026-08-11T10:21:30.456Z",
    });

    expect(
      transaction.bonusEvidenceClaim.create.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(
      transaction.bonusEvidenceClaim.create.mock.calls.every(
        ([call]) => call.data.bonus_id === savedBonus.id,
      ),
    ).toBe(true);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: savedBonus.id }),
    );
    expect(transaction.evidenceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observed_at: new Date("2026-08-11T10:21:30.456Z"),
        snapshot_path:
          "supabase://savvyedge-evidence/v1/initial-observation.html",
      }),
    });
    expect(transaction.activeExtractionPointer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bonus_id_extraction_context: {
            bonus_id: savedBonus.id,
            extraction_context: "BONUS",
          },
        },
        create: expect.objectContaining({
          bonus_id: savedBonus.id,
          data_source_id: "source-canonical",
          evidence_id: evidence.id,
        }),
      }),
    );
    expect(result.bonus).toBe(savedBonus);
    expect(result.evidence).toBe(evidence);
  });

  it("hands the exact extracted Bonus ID to validation", async () => {
    const extracted = {
      casino: { id: "casino-shared" },
      bonus: { id: "bonus-current-offer" },
      evidence: { id: "evidence-current-offer" },
    };
    vi.spyOn(IngestionService, "handleExtraction").mockResolvedValue(
      extracted as never,
    );
    const rediscover = vi.spyOn(prisma.bonus, "findFirst").mockResolvedValue({
      id: "bonus-other-offer",
      casino_id: "casino-shared",
    } as never);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "validation-job" } as never);
    const handlers = (
      OrchestratorService as unknown as {
        getQueueHandlers: (seedSources: string[]) => {
          EXTRACT_BONUS: (payload: Record<string, unknown>) => Promise<void>;
        };
      }
    ).getQueueHandlers([]);

    await handlers.EXTRACT_BONUS({
      scrapeJobId: "scrape-current-offer",
      url: "https://casino.example.com/promotions/current",
      casinoId: "casino-shared",
      scrapedContent: "current offer",
      scrapedMetadata: {},
      observedAt: "2026-08-11T10:20:30.456Z",
    });

    expect(rediscover).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      {
        bonusId: "bonus-current-offer",
        url: "https://casino.example.com/promotions/current",
      },
      { priority: "LOW", deduplicate: true },
    );
  });

  it("returns the current synchronous extraction result without domain lookup", async () => {
    const scrapeJob = { id: "scrape-current" };
    const persisted = {
      casino: { id: "casino-current" },
      bonus: { id: "bonus-current" },
      evidence: { id: "evidence-current" },
    };
    vi.spyOn(IngestionService, "enqueueIngestion").mockResolvedValue(
      scrapeJob as never,
    );
    vi.spyOn(IngestionService, "handleCrawl").mockResolvedValue(undefined);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow")
      .mockResolvedValueOnce({
        ...scrapeJob,
        status: "PROCESSING",
      } as never)
      .mockResolvedValueOnce({
        ...scrapeJob,
        status: "COMPLETED",
        snapshot_path: "/tmp/snapshot.html",
      } as never);
    const queuedLookup = vi
      .spyOn(prisma.jobQueue, "findFirst")
      .mockResolvedValue({
        payload: JSON.stringify({
          scrapeJobId: scrapeJob.id,
          url: "https://casino.example.com/promotions/current",
          scrapedContent: "current offer",
        }),
      } as never);
    vi.spyOn(IngestionService, "handleExtraction").mockResolvedValue(
      persisted as never,
    );
    const casinoDomainLookup = vi.spyOn(prisma.casino, "findFirstOrThrow");

    const result = await IngestionService.ingestBonusFromUrl({
      url: "https://casino.example.com/promotions/current",
    });

    expect(queuedLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task_type: "EXTRACT_BONUS",
          payload: { contains: scrapeJob.id },
        }),
      }),
    );
    expect(casinoDomainLookup).not.toHaveBeenCalled();
    expect(result.bonus).toBe(persisted.bonus);
    expect(result.casino).toBe(persisted.casino);
  });

  it("resolves a short circuit through prior scrape evidence", async () => {
    const currentJob = {
      id: "scrape-current",
      data_source_id: "source-one",
      status: "COMPLETED",
      html_hash: TEST_HTML_HASH,
      content_hash: TEST_CONTENT_HASH,
      snapshot_path: "/tmp/current.html",
    };
    const persisted = {
      id: "bonus-from-prior-evidence",
      casino: { id: "casino-from-prior-evidence" },
    };
    vi.spyOn(IngestionService, "enqueueIngestion").mockResolvedValue(
      { id: currentJob.id } as never,
    );
    vi.spyOn(IngestionService, "handleCrawl").mockResolvedValue(undefined);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      currentJob as never,
    );
    const priorJobLookup = vi
      .spyOn(prisma.scrapeJob, "findFirst")
      .mockResolvedValue({ id: "scrape-prior" } as never);
    const priorClaimLookup = vi
      .spyOn(prisma.bonusEvidenceClaim, "findFirst")
      .mockResolvedValue({ bonus: persisted } as never);
    const extract = vi.spyOn(IngestionService, "handleExtraction");
    const casinoDomainLookup = vi.spyOn(prisma.casino, "findFirstOrThrow");

    const result = await IngestionService.ingestBonusFromUrl({
      url: "https://casino.example.com/promotions/current",
    });

    expect(priorJobLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          data_source_id: currentJob.data_source_id,
          id: { not: currentJob.id },
          OR: expect.arrayContaining([
            { content_hash: currentJob.content_hash },
            { html_hash: currentJob.html_hash },
          ]),
        }),
      }),
    );
    expect(priorClaimLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { evidence: { scrape_job_id: "scrape-prior" } },
      }),
    );
    expect(extract).not.toHaveBeenCalled();
    expect(casinoDomainLookup).not.toHaveBeenCalled();
    expect(result.bonus).toBe(persisted);
    expect(result.casino).toBe(persisted.casino);
  });

  it("fails closed when no prior ScrapeJob relationship exists", async () => {
    const currentJob = {
      id: "scrape-current",
      data_source_id: "source-one",
      status: "COMPLETED",
      html_hash: TEST_HTML_HASH,
      content_hash: TEST_CONTENT_HASH,
      snapshot_path: "/isolated/current.html",
    };
    vi.spyOn(IngestionService, "enqueueIngestion").mockResolvedValue(
      { id: currentJob.id } as never,
    );
    vi.spyOn(IngestionService, "handleCrawl").mockResolvedValue(undefined);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      currentJob as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const claimLookup = vi.spyOn(prisma.bonusEvidenceClaim, "findFirst");
    const casinoHeuristic = vi.spyOn(prisma.casino, "findFirstOrThrow");
    const bonusHeuristic = vi.spyOn(prisma.bonus, "findFirst");

    await expect(
      IngestionService.ingestBonusFromUrl({
        url: "https://casino.example.com/promotions/current",
      }),
    ).rejects.toThrow(
      "No prior completed ScrapeJob matches short-circuited job scrape-current",
    );

    expect(claimLookup).not.toHaveBeenCalled();
    expect(casinoHeuristic).not.toHaveBeenCalled();
    expect(bonusHeuristic).not.toHaveBeenCalled();
  });

  it("fails closed when prior scrape evidence has no Bonus claim", async () => {
    const currentJob = {
      id: "scrape-current",
      data_source_id: "source-one",
      status: "COMPLETED",
      html_hash: TEST_HTML_HASH,
      content_hash: TEST_CONTENT_HASH,
      snapshot_path: "/isolated/current.html",
    };
    vi.spyOn(IngestionService, "enqueueIngestion").mockResolvedValue(
      { id: currentJob.id } as never,
    );
    vi.spyOn(IngestionService, "handleCrawl").mockResolvedValue(undefined);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue(
      currentJob as never,
    );
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue({
      id: "scrape-prior",
    } as never);
    vi.spyOn(prisma.bonusEvidenceClaim, "findFirst").mockResolvedValue(null);
    const casinoHeuristic = vi.spyOn(prisma.casino, "findFirstOrThrow");
    const bonusHeuristic = vi.spyOn(prisma.bonus, "findFirst");

    await expect(
      IngestionService.ingestBonusFromUrl({
        url: "https://casino.example.com/promotions/current",
      }),
    ).rejects.toThrow(
      "No persisted Bonus evidence is linked to prior ScrapeJob scrape-prior",
    );

    expect(casinoHeuristic).not.toHaveBeenCalled();
    expect(bonusHeuristic).not.toHaveBeenCalled();
  });
});
