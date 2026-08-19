import fs from "node:fs";
import path from "node:path";
import { prisma } from "@savvyedge/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import {
  INGESTION_JOB_TYPES,
  IngestionQueueContractError,
  assertIngestionQueueJob,
} from "../src/contracts/ingestion-queue.contract";
import { DiscoveryService } from "../src/services/discovery.service";
import { IngestionService } from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";
import { EvidenceArtifactStorageService } from "../src/services/evidence-artifact-storage.service";

const OBSERVED_AT = new Date("2026-08-11T10:20:30.456Z");

beforeEach(() => {
  vi.spyOn(
    EvidenceArtifactStorageService,
    "persistObservation",
  ).mockResolvedValue({
    locator: "supabase://savvyedge-evidence/v1/queue-contract.html",
    htmlHash: "queue-contract-html",
    byteSize: 128,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function orchestratorHandlers() {
  return (
    OrchestratorService as unknown as {
      getQueueHandlers: (
        seedSources: string[],
      ) => Record<string, (payload: never) => Promise<unknown>>;
    }
  ).getQueueHandlers([]);
}

function readTypeScriptFiles(directory: string): string {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts")
        ? [fs.readFileSync(entryPath, "utf8")]
        : [];
    })
    .join("\n");
}

describe("unified ingestion queue contract", () => {
  it("defines the fixed queue and exactly the supported job types", () => {
    expect(INGESTION_QUEUE_NAME).toBe("ingestion-queue");
    expect(INGESTION_JOB_TYPES).toEqual([
      "DISCOVER_SEEDS",
      "INGEST_URL",
      "CRAWL_URL",
      "EXTRACT_BONUS",
      "EXTRACT_GAME_LIST",
      "VALIDATE_BONUS",
    ]);
    expect(Object.keys(orchestratorHandlers()).sort()).toEqual(
      [...INGESTION_JOB_TYPES].sort(),
    );
  });

  it("routes discovery and direct ingestion producers through the canonical queue", async () => {
    vi.spyOn(
      (
        DiscoveryService as unknown as {
          discoveryAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).discoveryAgent,
      "run",
    ).mockResolvedValue({
      totalSeeds: 1,
      totalDiscovered: 1,
      filteredCount: 0,
      candidateUrls: [
        {
          normalizedUrl: "https://operator.example.com/promotions/welcome",
          domain: "operator.example.com",
          sourceSeed: "https://seed.example.com",
        },
      ],
    });
    vi.spyOn(prisma.discoveredUrl, "upsert").mockResolvedValue({
      id: "discovered-id",
      status: "DISCOVERED",
    } as never);
    vi.spyOn(prisma.discoveredUrl, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.dataSource, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.dataSource, "create").mockResolvedValue({
      id: "source-id",
    } as never);
    vi.spyOn(prisma.scrapeJob, "create").mockResolvedValue({
      id: "scrape-job-id",
    } as never);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "queue-job-id" } as never);

    await DiscoveryService.discoverAndEnqueue(["https://seed.example.com"]);
    expect(enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "INGEST_URL",
      expect.objectContaining({
        url: "https://operator.example.com/promotions/welcome",
      }),
    );

    await IngestionService.enqueueIngestion({
      url: "https://operator.example.com/promotions/welcome",
    });
    expect(enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "CRAWL_URL",
      expect.objectContaining({
        scrapeJobId: "scrape-job-id",
        url: "https://operator.example.com/promotions/welcome",
      }),
    );
  });

  it.each([
    {
      taskContext: "BONUS" as const,
      url: "https://operator.example.com/promotions/welcome",
      casinoId: undefined,
      title: "Welcome bonus",
      content: "Welcome bonus 100% up to £200",
      expectedTask: "EXTRACT_BONUS",
    },
    {
      taskContext: "GAME_LIST" as const,
      url: "https://operator.example.com/casino/games",
      casinoId: "casino-id",
      title: "Casino games",
      content: "Slots and casino games lobby",
      expectedTask: "EXTRACT_GAME_LIST",
    },
  ])(
    "routes $expectedTask through the canonical queue",
    async ({ taskContext, url, casinoId, title, content, expectedTask }) => {
      vi.spyOn(
        (
          IngestionService as unknown as {
            scraperAgent: { run: (input: unknown) => Promise<unknown> };
          }
        ).scraperAgent,
        "run",
      ).mockResolvedValue({
        content,
        rawHtml: `<html><body>${content}</body></html>`,
        metadata: { title },
        snapshotPath: "/isolated/queue-contract.html",
        htmlHash: "queue-contract-html",
        contentHash: "queue-contract-content",
        finalUrl: url,
        title,
        canonicalUrl: url,
        timestamp: OBSERVED_AT,
      });
      vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
        id: "scrape-job-id",
        data_source_id: "source-id",
      } as never);
      vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
      const enqueue = vi
        .spyOn(JobQueueService, "enqueue")
        .mockResolvedValue({ id: "extraction-job-id" } as never);

      await IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-id",
        url,
        casinoId,
        taskContext,
      });

      const expectedArguments = [
        INGESTION_QUEUE_NAME,
        expectedTask,
        expect.objectContaining({ scrapeJobId: "scrape-job-id" }),
      ];
      if (expectedTask === "EXTRACT_BONUS") {
        expectedArguments.push({ deduplicate: true });
      }
      expect(enqueue).toHaveBeenCalledWith(...expectedArguments);
    },
  );

  it("lets INGEST_URL delegate the only downstream crawl to enqueueIngestion", async () => {
    const enqueueIngestion = vi
      .spyOn(IngestionService, "enqueueIngestion")
      .mockResolvedValue({ id: "scrape-job-id" } as never);
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await orchestratorHandlers().INGEST_URL({
      url: "https://operator.example.com/promotions/welcome",
    } as never);

    expect(enqueueIngestion).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("routes the exact extracted Bonus ID to validation on the canonical queue", async () => {
    vi.spyOn(IngestionService, "handleExtraction").mockResolvedValue({
      casino: { id: "casino-id" },
      bonus: { id: "bonus-exact" },
      evidence: { id: "evidence-id" },
    } as never);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "validation-job" } as never);

    await orchestratorHandlers().EXTRACT_BONUS({
      scrapeJobId: "scrape-job-id",
      url: "https://operator.example.com/promotions/welcome",
      scrapedContent: "Welcome bonus",
      observedAt: OBSERVED_AT.toISOString(),
    } as never);

    expect(enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      {
        bonusId: "bonus-exact",
        url: "https://operator.example.com/promotions/welcome",
      },
      { priority: "LOW", deduplicate: true },
    );
  });

  it("deduplicates the exact EXTRACT_BONUS payload while pending", async () => {
    const payload = {
      scrapeJobId: "scrape-job-id",
      url: "https://operator.example.com/promotions/welcome",
      casinoId: undefined,
      scrapedContent: "Welcome bonus 100% up to £200",
      scrapedMetadata: { title: "Welcome bonus" },
      observedAt: OBSERVED_AT.toISOString(),
    };
    const existing = { id: "existing-extraction-job" } as never;
    vi.spyOn(prisma.jobQueue, "findFirst").mockResolvedValue(existing);
    const create = vi.spyOn(prisma.jobQueue, "create");

    await expect(
      JobQueueService.enqueue(
        INGESTION_QUEUE_NAME,
        "EXTRACT_BONUS",
        payload,
        { deduplicate: true },
      ),
    ).resolves.toBe(existing);

    expect(prisma.jobQueue.findFirst).toHaveBeenCalledWith({
      where: {
        queue_name: INGESTION_QUEUE_NAME,
        task_type: "EXTRACT_BONUS",
        status: { in: ["PENDING", "PROCESSING"] },
        payload: JSON.stringify(payload),
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects known ingestion jobs on the legacy queue before persistence", async () => {
    const create = vi.spyOn(prisma.jobQueue, "create");

    await expect(
      JobQueueService.enqueue("orchestrator-queue", "INGEST_URL", {
        url: "https://operator.example.com/promotions/welcome",
      }),
    ).rejects.toMatchObject<Partial<IngestionQueueContractError>>({
      code: "INGESTION_JOB_WRONG_QUEUE",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unknown canonical tasks while allowing unrelated jobs on another queue", () => {
    expect(() =>
      assertIngestionQueueJob(INGESTION_QUEUE_NAME, "UNKNOWN_TASK", {}),
    ).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_INGESTION_JOB" }),
    );
    expect(() =>
      assertIngestionQueueJob("reporting-queue", "BUILD_REPORT", {
        reportId: "report-id",
      }),
    ).not.toThrow();
  });

  it("rejects malformed payloads, including GAME_LIST crawl without casinoId", () => {
    expect(() =>
      assertIngestionQueueJob(INGESTION_QUEUE_NAME, "INGEST_URL", {}),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_INGESTION_PAYLOAD" }),
    );
    expect(() =>
      assertIngestionQueueJob(INGESTION_QUEUE_NAME, "CRAWL_URL", {
        scrapeJobId: "scrape-job-id",
        url: "https://operator.example.com/casino/games",
        taskContext: "GAME_LIST",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_INGESTION_PAYLOAD" }),
    );
  });

  it("validates a claimed payload before invoking its handler", async () => {
    const job = {
      id: "invalid-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({ scrapeJobId: "scrape-job-id" }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "contract-worker",
      attempts: 1,
      max_attempts: 1,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 60_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce(job as never);
    const failure = vi
      .spyOn(
        JobQueueService as unknown as {
          handleJobFailure: (...args: unknown[]) => Promise<void>;
        },
        "handleJobFailure",
      )
      .mockResolvedValue(undefined);
    const handler = vi.fn(async () => undefined);

    expect(
      await JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: handler },
        { workerId: "contract-worker" },
      ),
    ).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
  });

  it("scopes stale recovery to the canonical queue", async () => {
    const findQueueJobs = vi
      .spyOn(prisma.jobQueue, "findMany")
      .mockResolvedValue([]);
    vi.spyOn(prisma.scrapeJob, "findMany").mockResolvedValue([]);

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(findQueueJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queue_name: INGESTION_QUEUE_NAME,
          status: "PROCESSING",
        }),
      }),
    );
  });

  it("uses no legacy queue literal in production or verification source", () => {
    const packageRoot = path.resolve(import.meta.dirname, "..");
    const productionAndVerificationSource = [
      readTypeScriptFiles(path.join(packageRoot, "src")),
      readTypeScriptFiles(path.join(packageRoot, "scripts")),
    ].join("\n");

    expect(productionAndVerificationSource).not.toContain(
      '"orchestrator-queue"',
    );
    expect(productionAndVerificationSource).toContain(INGESTION_QUEUE_NAME);
  });

  it("registers the worker listener on the canonical queue", () => {
    const orchestratorSource = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../src/services/orchestrator.service.ts",
      ),
      "utf8",
    );

    expect(orchestratorSource).toMatch(
      /startWorker\(\s*INGESTION_QUEUE_NAME,/,
    );
  });
});
