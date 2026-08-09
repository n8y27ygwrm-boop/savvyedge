import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { DiscoveryService } from "../src/services/discovery.service";
import { IngestionService } from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";


describe("Deterministic Ingestion Orchestrator Runtime Integration (Boundary C3B)", () => {
  beforeEach(() => {
    // Default safety mocks for all external IO boundaries
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);
    vi.spyOn(prisma.workerNode, "upsert").mockResolvedValue({} as never);
    vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.workerNode, "count").mockResolvedValue(1);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) =>
      callback(prisma),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await OrchestratorService.stop();
    vi.restoreAllMocks();
  });

  // Test 1: Handler registration on canonical queue
  it("registers all canonical ingestion queue handlers on INGESTION_QUEUE_NAME", async () => {
    let capturedQueueName: string | null = null;
    let capturedHandlers: Record<string, unknown> = {};

    vi.spyOn(JobQueueService, "startWorker").mockImplementation(
      (queueName, handlers) => {
        capturedQueueName = queueName;
        capturedHandlers = handlers as Record<string, unknown>;
        return { stop: vi.fn(async () => undefined) };
      },
    );

    await OrchestratorService.start({
      workerConcurrency: 1,
      seedSources: ["https://seed.example.com"],
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    expect(capturedQueueName).toBe(INGESTION_QUEUE_NAME);
    expect(capturedHandlers.DISCOVER_SEEDS).toBeTypeOf("function");
    expect(capturedHandlers.INGEST_URL).toBeTypeOf("function");
    expect(capturedHandlers.CRAWL_URL).toBeTypeOf("function");
    expect(capturedHandlers.EXTRACT_BONUS).toBeTypeOf("function");
    expect(capturedHandlers.EXTRACT_GAME_LIST).toBeTypeOf("function");
    expect(capturedHandlers.VALIDATE_BONUS).toBeTypeOf("function");
  });

  // Test 2: Discovery to ingestion contract (DISCOVER_SEEDS -> INGEST_URL)
  it("executes DISCOVER_SEEDS handler producing consumable INGEST_URL tasks on canonical queue", async () => {
    vi.spyOn(
      (
        DiscoveryService as unknown as {
          discoveryAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).discoveryAgent,
      "run",
    ).mockResolvedValue({
      totalSeeds: 1,
      seedUrls: ["https://seed.example.com"],
      totalDiscovered: 1,
      filteredCount: 0,
      candidateUrls: [
        {
          url: "https://operator.example.com/bonuses/welcome",
          normalizedUrl: "https://operator.example.com/bonuses/welcome",
          domain: "operator.example.com",
          sourceSeed: "https://seed.example.com",
          status: "DISCOVERED",
          filterReason: null,
        },
      ],
    });

    vi.spyOn(prisma.discoveredUrl, "upsert").mockResolvedValue({
      id: "discovered-rec-1",
      status: "DISCOVERED",
    } as never);
    vi.spyOn(prisma.discoveredUrl, "update").mockResolvedValue({} as never);

    const enqueueSpy = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-ingest-1" } as never);

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.DISCOVER_SEEDS({
      seedUrls: ["https://seed.example.com"],
    });

    expect(enqueueSpy).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "INGEST_URL",
      expect.objectContaining({
        url: "https://operator.example.com/bonuses/welcome",
        discovered_id: "discovered-rec-1",
      }),
    );
  });

  // Test 3: INGEST_URL to exactly one CRAWL_URL
  it("executes INGEST_URL handler producing exactly one downstream CRAWL_URL task", async () => {
    vi.spyOn(prisma.dataSource, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.dataSource, "create").mockResolvedValue({
      id: "source-ds-1",
      url: "https://operator.example.com/bonuses/welcome",
    } as never);
    vi.spyOn(prisma.scrapeJob, "create").mockResolvedValue({
      id: "scrape-job-101",
      status: "PROCESSING",
    } as never);

    const enqueueSpy = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-crawl-1" } as never);

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.INGEST_URL({
      url: "https://operator.example.com/bonuses/welcome",
      discovered_id: "discovered-rec-1",
    });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "CRAWL_URL",
      expect.objectContaining({
        scrapeJobId: "scrape-job-101",
        url: "https://operator.example.com/bonuses/welcome",
        taskContext: "BONUS",
      }),
    );
  });

  // Test 4: BONUS crawl branching
  it("executes CRAWL_URL for BONUS context enqueuing EXTRACT_BONUS on canonical queue", async () => {
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-101",
      data_source_id: "source-ds-1",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);

    vi.spyOn(
      (
        IngestionService as unknown as {
          scraperAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).scraperAgent,
      "run",
    ).mockResolvedValue({
      content: "Exclusive 100% Welcome Bonus up to $500",
      metadata: { title: "Casino Welcome Promo" },
      snapshotPath: null,
      htmlHash: "hash-html-123",
      contentHash: "hash-content-456",
      canonicalUrl: "https://operator.example.com/bonuses/welcome",
    });

    const enqueueSpy = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-extract-1" } as never);

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.CRAWL_URL({
      scrapeJobId: "scrape-job-101",
      url: "https://operator.example.com/bonuses/welcome",
      taskContext: "BONUS",
    });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const [queue, task, payload] = enqueueSpy.mock.calls[0];
    expect(queue).toBe(INGESTION_QUEUE_NAME);
    expect(task).toBe("EXTRACT_BONUS");
    expect(payload).toMatchObject({
      scrapeJobId: "scrape-job-101",
      url: "https://operator.example.com/bonuses/welcome",
      scrapedContent: "Exclusive 100% Welcome Bonus up to $500",
    });
  });

  // Test 5: GAME_LIST branching
  it("executes CRAWL_URL for GAME_LIST context enqueuing EXTRACT_GAME_LIST with casinoId", async () => {
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-202",
      data_source_id: "source-ds-2",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);

    vi.spyOn(
      (
        IngestionService as unknown as {
          scraperAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).scraperAgent,
      "run",
    ).mockResolvedValue({
      content: "Popular Slots: Starburst, Book of Dead",
      metadata: { title: "Game Lobby" },
      snapshotPath: null,
      htmlHash: "games-html-hash",
      contentHash: "games-content-hash",
      canonicalUrl: "https://operator.example.com/games",
    });

    const enqueueSpy = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-extract-games" } as never);

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.CRAWL_URL({
      scrapeJobId: "scrape-job-202",
      url: "https://operator.example.com/games",
      casinoId: "casino-uuid-777",
      taskContext: "GAME_LIST",
    });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const [queue, task, payload] = enqueueSpy.mock.calls[0];
    expect(queue).toBe(INGESTION_QUEUE_NAME);
    expect(task).toBe("EXTRACT_GAME_LIST");
    expect(payload).toMatchObject({
      scrapeJobId: "scrape-job-202",
      url: "https://operator.example.com/games",
      casinoId: "casino-uuid-777",
    });
  });

  // Test 6: Full vertical BONUS composition
  it("executes full vertical pipeline chaining captured production outputs from discovery through validation", async () => {
    // Pipeline Enqueue Capture Log
    const capturedEnqueues: Array<{
      queue: string;
      taskType: string;
      payload: unknown;
    }> = [];

    vi.spyOn(JobQueueService, "enqueue").mockImplementation(
      async (queue, taskType, payload) => {
        capturedEnqueues.push({
          queue,
          taskType,
          payload,
        });
        return { id: `enqueued-${capturedEnqueues.length}` } as never;
      },
    );

    // Mocks for Discovery Stage
    vi.spyOn(
      (
        DiscoveryService as unknown as {
          discoveryAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).discoveryAgent,
      "run",
    ).mockResolvedValue({
      totalSeeds: 1,
      seedUrls: ["https://seed.example.com"],
      totalDiscovered: 1,
      filteredCount: 0,
      candidateUrls: [
        {
          url: "https://operator.example.com/welcome-offer",
          normalizedUrl: "https://operator.example.com/welcome-offer",
          domain: "operator.example.com",
          sourceSeed: "https://seed.example.com",
          status: "DISCOVERED",
          filterReason: null,
        },
      ],
    });
    vi.spyOn(prisma.discoveredUrl, "upsert").mockResolvedValue({
      id: "discovered-uuid-1",
      status: "DISCOVERED",
    } as never);
    vi.spyOn(prisma.discoveredUrl, "update").mockResolvedValue({} as never);

    // Mocks for Ingestion Stage
    vi.spyOn(prisma.dataSource, "findFirst").mockResolvedValue({
      id: "ds-uuid-1",
    } as never);
    vi.spyOn(prisma.dataSource, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "create").mockResolvedValue({
      id: "scrape-job-vertical-1",
      status: "PROCESSING",
    } as never);

    // Mocks for Crawl Stage
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-vertical-1",
      data_source_id: "ds-uuid-1",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    vi.spyOn(
      (
        IngestionService as unknown as {
          scraperAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).scraperAgent,
      "run",
    ).mockResolvedValue({
      content: "100% Match Bonus up to $1000 with 30x Wagering",
      metadata: { title: "Official Welcome Offer" },
      snapshotPath: null,
      htmlHash: "html-hash-vertical",
      contentHash: "content-hash-vertical",
      canonicalUrl: "https://operator.example.com/welcome-offer",
    });

    // Mocks for Extraction Stage
    vi.spyOn(IngestionService, "handleExtraction").mockResolvedValue({
      casino: { id: "casino-uuid-1", name: "Operator Casino" },
      bonus: { id: "bonus-uuid-999", headline_value: "100% Up to $1000" },
      evidence: { id: "evidence-uuid-1" },
    } as never);

    // Mocks for Validation Stage
    vi.spyOn(
      WorkflowTransitionService.prototype,
      "assertCasinoHasOneEligibleLicense",
    ).mockResolvedValue(undefined);

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
      id: "bonus-uuid-999",
      headline_value: "100% Up to $1000",
      wagering_requirement: 30,
      max_conversion: 5000,
      status: "NEW",
      casino: {
        id: "casino-uuid-1",
        name: "Test Casino",
      },
    } as never);


    const bonusUpdateSpy = vi
      .spyOn(prisma.bonus, "update")
      .mockResolvedValue({ id: "bonus-uuid-999", verified_at: new Date() } as never);
    const historyEventSpy = vi
      .spyOn(prisma.bonusHistoryEvent, "create")
      .mockResolvedValue({ id: "event-uuid-1" } as never);

    const handlers = OrchestratorService.getQueueHandlers([]);

    // --- STAGE 1: DISCOVER_SEEDS ---
    await handlers.DISCOVER_SEEDS({
      seedUrls: ["https://seed.example.com"],
    });

    expect(capturedEnqueues).toHaveLength(1);
    expect(capturedEnqueues[0].taskType).toBe("INGEST_URL");
    const ingestPayload = capturedEnqueues[0].payload as {
      url: string;
      discovered_id?: string;
    };

    // --- STAGE 2: INGEST_URL (consuming exact captured payload) ---
    await handlers.INGEST_URL(ingestPayload);

    expect(capturedEnqueues).toHaveLength(2);
    expect(capturedEnqueues[1].taskType).toBe("CRAWL_URL");
    const crawlPayload = capturedEnqueues[1].payload as {
      scrapeJobId: string;
      url: string;
      taskContext?: "BONUS" | "GAME_LIST";
    };

    // --- STAGE 3: CRAWL_URL (consuming exact captured payload) ---
    await handlers.CRAWL_URL(crawlPayload);

    expect(capturedEnqueues).toHaveLength(3);
    expect(capturedEnqueues[2].taskType).toBe("EXTRACT_BONUS");
    const extractPayload = capturedEnqueues[2].payload as {
      scrapeJobId: string;
      url: string;
      scrapedContent: string;
    };

    // --- STAGE 4: EXTRACT_BONUS (consuming exact captured payload) ---
    await handlers.EXTRACT_BONUS(extractPayload);

    expect(capturedEnqueues).toHaveLength(4);
    expect(capturedEnqueues[3].taskType).toBe("VALIDATE_BONUS");
    const validatePayload = capturedEnqueues[3].payload as {
      bonusId: string;
      url: string;
    };

    // --- STAGE 5: VALIDATE_BONUS (consuming exact captured payload) ---
    await handlers.VALIDATE_BONUS(validatePayload);

    // Assert Terminal Outcome: verified_at timestamp and BonusHistoryEvent
    expect(bonusUpdateSpy).toHaveBeenCalledWith({
      where: { id: "bonus-uuid-999" },
      data: { verified_at: expect.any(Date) },
    });
    expect(historyEventSpy).toHaveBeenCalledWith({
      data: {
        bonus_id: "bonus-uuid-999",
        field_changed: "verified_at",
        old_value: null,
        new_value: expect.any(String),
        changed_at: expect.any(Date),
        source_url: validatePayload.url,
      },
    });
  });


  // Test 7: Extraction failure propagation to ScrapeJob error_log
  it("records bounded failure classification in ScrapeJob error_log when extraction rejects", async () => {
    const updateManySpy = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });

    vi.spyOn(
      IngestionService as unknown as {
        performExtraction: (input: unknown) => Promise<unknown>;
      },
      "performExtraction",
    ).mockRejectedValue(new Error("AI extraction model timeout"));

    const handlers = OrchestratorService.getQueueHandlers([]);

    await expect(
      handlers.EXTRACT_BONUS({
        scrapeJobId: "scrape-job-fail-1",
        url: "https://operator.example.com/promo",
        scrapedContent: "raw promo content",
      }),
    ).rejects.toThrow("AI extraction model timeout");

    // Verify terminal failure transition in ScrapeJob
    const failureCalls = updateManySpy.mock.calls.filter((call) => {
      const data = (call[0] as { data?: { status?: string } })?.data;
      return data?.status === "FAILED";
    });

    expect(failureCalls).toHaveLength(1);
    const failureUpdate = failureCalls[0][0] as {
      where: { id: string; status: { not: string } };
      data: { status: string; error_log: string };
    };

    expect(failureUpdate.where.id).toBe("scrape-job-fail-1");
    expect(failureUpdate.where.status).toEqual({ not: "COMPLETED" });
    expect(failureUpdate.data.status).toBe("FAILED");
    expect(failureUpdate.data.error_log).toBeDefined();

    const parsedLog = JSON.parse(failureUpdate.data.error_log);
    expect(parsedLog.code).toBe("BONUS_EXTRACTION_FAILED");
  });

  // Test 8: Completed job short-circuit
  it("short-circuits duplicate execution when ScrapeJob is already completed", async () => {
    // When ScrapeJob is already COMPLETED:
    // 1. updateMany to PROCESSING matches 0 rows
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 0 });
    // 2. findUnique confirms the job is in COMPLETED status
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue({
      id: "scrape-job-completed-1",
      status: "COMPLETED",
    } as never);

    const scraperSpy = vi.spyOn(
      (
        IngestionService as unknown as {
          scraperAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).scraperAgent,
      "run",
    );

    const enqueueSpy = vi.spyOn(JobQueueService, "enqueue");

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.CRAWL_URL({
      scrapeJobId: "scrape-job-completed-1",
      url: "https://operator.example.com/already-scraped",
      taskContext: "BONUS",
    });

    expect(scraperSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  // Test 9: Validation-stage rejection for invalid fields or missing licenses
  it("does not update bonus or record history when validation rules fail", async () => {
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
      id: "bonus-invalid-1",
      headline_value: "", // Empty headline (invalid)
      wagering_requirement: 150, // Wagering > 100 (invalid)
      max_conversion: 0, // max_conversion <= 0 (invalid)
      status: "ACTIVE",
      casino: {
        id: "casino-invalid-1",
        name: "Invalid Casino",
      },
    } as never);

    const bonusUpdateSpy = vi.spyOn(prisma.bonus, "update");
    const historyEventSpy = vi.spyOn(prisma.bonusHistoryEvent, "create");

    const handlers = OrchestratorService.getQueueHandlers([]);

    await handlers.VALIDATE_BONUS({
      bonusId: "bonus-invalid-1",
      url: "https://operator.example.com/invalid-offer",
    });

    expect(bonusUpdateSpy).not.toHaveBeenCalled();
    expect(historyEventSpy).not.toHaveBeenCalled();
  });
});
