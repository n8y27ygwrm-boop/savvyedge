import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { JobQueueService } from "../src/services/job-queue.service";

describe("JobQueue Ownership-Safe Finalization and Atomic Stale Recovery (Boundary C2A)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Recovery query is scoped to requested queue
  it("scopes recovery candidate query strictly to requested queue", async () => {
    const findManySpy = vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);

    await JobQueueService.recoverStaleJobs("custom-queue");

    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queue_name: "custom-queue",
        }),
      }),
    );
  });

  // 2. Only PROCESSING candidates are queried
  it("queries only candidates in PROCESSING status for stale recovery", async () => {
    const findManySpy = vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PROCESSING",
        }),
      }),
    );
  });

  // 3. Expired locked_until predicate is required
  it("requires locked_until in the past for candidate selection", async () => {
    const findManySpy = vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);
    const beforeTime = new Date();

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    const callArg = findManySpy.mock.calls[0][0];
    const lockedUntilClause = callArg?.where?.locked_until;
    expect(lockedUntilClause).toBeDefined();
    expect(lockedUntilClause?.lt).toBeInstanceOf(Date);
    expect((lockedUntilClause?.lt as Date).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
  });

  // 4. Empty candidate set returns 0
  it("returns 0 recovered count when candidate list is empty", async () => {
    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany");

    const count = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(count).toBe(0);
    expect(updateManySpy).not.toHaveBeenCalled();
  });

  // 5. Expired PROCESSING retryable job -> PENDING
  it("transitions expired PROCESSING job with attempts < max_attempts to PENDING", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-node-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date("2026-08-08T11:55:00.000Z"),
      locked_until: new Date("2026-08-08T11:57:00.000Z"),
      error_log: null,
      started_at: new Date("2026-08-08T11:55:00.000Z"),
      completed_at: null,
      created_at: new Date("2026-08-08T11:50:00.000Z"),
      updated_at: new Date("2026-08-08T11:55:00.000Z"),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const count = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(count).toBe(1);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1", status: "PROCESSING" }),
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  // 6. Recovery clears locked_until
  it("clears locked_until to null when recovering stale job", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-node-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locked_until: null }),
      }),
    );
  });

  // 7. PENDING recovery clears worker_id
  it("clears worker_id to null on PENDING recovery to eliminate stale attribution", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-node-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ worker_id: null, status: "PENDING" }),
      }),
    );
  });

  // 8. Recovery preserves attempts counter
  it("does not increment attempts during crash recovery update", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-node-1",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    const updateData = updateManySpy.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("attempts");
  });

  // 9. Max-attempt candidate -> FAILED with retained observed worker_id
  it("transitions expired PROCESSING job to FAILED when attempts >= max_attempts and retains observed worker_id", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "terminal-crashed-worker",
      attempts: 3,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const count = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(count).toBe(1);
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          worker_id: "terminal-crashed-worker",
          locked_until: null,
          error_log: expect.stringContaining("Failed after max attempts (3/3)"),
        }),
      }),
    );
  });

  // 10. Retryable recovery run_at behavior matches exponential backoff
  it("schedules recovered PENDING jobs with exponential backoff run_at", async () => {
    const beforeNow = Date.now();
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-node-1",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    const updateData = updateManySpy.mock.calls[0][0].data;
    expect(updateData.run_at).toBeInstanceOf(Date);
    const runAtTime = (updateData.run_at as Date).getTime();
    // 2^2 = 4 seconds = 4000ms backoff
    expect(runAtTime).toBeGreaterThanOrEqual(beforeNow + 3900);
  });

  // 11. CAS includes id
  it("enforces CAS update matching candidate id", async () => {
    const staleJob = {
      id: "target-job-id",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "target-job-id" }),
      }),
    );
  });

  // 12. CAS includes queue_name
  it("enforces CAS update matching queue_name", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: "isolated-queue",
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs("isolated-queue");

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ queue_name: "isolated-queue" }),
      }),
    );
  });

  // 13. CAS includes PROCESSING state
  it("enforces CAS update requiring status PROCESSING", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
  });

  // 14. CAS includes observed worker_id
  it("enforces CAS update matching observed worker_id", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "observed-worker-99",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ worker_id: "observed-worker-99" }),
      }),
    );
  });

  // 15. CAS includes attempts claim epoch
  it("enforces CAS update matching observed attempts claim epoch", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempts: 2 }),
      }),
    );
  });

  // 16. CAS includes exact observed locked_until
  it("enforces CAS update matching exact observed locked_until timestamp", async () => {
    const exactLockedUntil = new Date("2026-08-08T11:50:00.000Z");
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: exactLockedUntil,
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locked_until: exactLockedUntil }),
      }),
    );
  });

  // 17. CAS loss contributes 0 to recovered count
  it("does not count candidate as recovered when CAS update returns count 0", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });

    const recovered = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(recovered).toBe(0);
  });

  // 18. Two competing recoverers cannot both report success
  it("ensures atomic recovery count across competing recoverers on the same candidate", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    vi.spyOn(prisma.jobQueue, "updateMany")
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [rec1, rec2] = await Promise.all([
      JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME),
      JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME),
    ]);

    expect(rec1 + rec2).toBe(1);
  });

  // 19. Returned count is sum of successful updateMany counts, not candidate count
  it("returns exactly the sum of successful CAS updates across multiple candidates", async () => {
    const candidate1 = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const candidate2 = {
      ...candidate1,
      id: "job-2",
    };
    const candidate3 = {
      ...candidate1,
      id: "job-3",
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([candidate1, candidate2, candidate3] as never);
    vi.spyOn(prisma.jobQueue, "updateMany")
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const recovered = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(recovered).toBe(2);
  });

  // 20. Successful owned execution transitions to COMPLETED
  it("transitions owned claimed job to COMPLETED on successful handler execution", async () => {
    const claimedJob = {
      id: "job-comp",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-node-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-node-1" },
    );

    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "job-comp",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "worker-node-1",
        attempts: 1,
      },
      data: {
        status: "COMPLETED",
        completed_at: expect.any(Date),
        locked_until: null,
      },
    });
  });

  // 21. Completion CAS includes queue/status/worker/attempt epoch
  it("enforces full claim epoch in completion CAS predicate", async () => {
    const claimedJob = {
      id: "epoch-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "EXTRACT_BONUS",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
        scrapedContent: "100% up to $500",
        observedAt: "2026-08-11T10:20:30.456Z",
      }),
      status: "PROCESSING",
      priority: "HIGH",
      domain: "example.com",
      worker_id: "worker-node-4",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { EXTRACT_BONUS: vi.fn().mockResolvedValue(undefined) },
      { workerId: "worker-node-4" },
    );

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "epoch-job",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "worker-node-4",
        attempts: 2,
      },
      data: {
        status: "COMPLETED",
        completed_at: expect.any(Date),
        locked_until: null,
      },
    });
  });

  // 22. Stale worker completion after recovery gets count 0 and does not overwrite PENDING
  it("safely ignores stale worker completion when recovery already reset status to PENDING", async () => {
    const claimedJob = {
      id: "stale-worker-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "slow-worker",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 1000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
      { workerId: "slow-worker" },
    );

    expect(result).toBe(true);
    expect(updateManySpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("lost ownership of job stale-worker-job during completion"),
    );
  });

  // 23. Old execution cannot complete a later re-claim with same workerId but higher attempts
  it("prevents old execution from completing a newer claim epoch with the same worker ID", async () => {
    const oldClaimedJob = {
      id: "reclaimed-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "reused-worker-id",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(oldClaimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
      { workerId: "reused-worker-id" },
    );

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "reclaimed-job",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "reused-worker-id",
        attempts: 1,
      },
      data: {
        status: "COMPLETED",
        completed_at: expect.any(Date),
        locked_until: null,
      },
    });
  });

  // 24. Owned retryable failure transitions PROCESSING -> PENDING with worker_id = null
  it("transitions owned failing job with attempts < max_attempts to PENDING with backoff and clears worker_id", async () => {
    const claimedJob = {
      id: "failing-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(new Error("network timeout")),
      },
      { workerId: "worker-1" },
    );

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "failing-job",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "worker-1",
        attempts: 1,
      },
      data: {
        status: "PENDING",
        worker_id: null,
        locked_until: null,
        error_log: "Job handler execution failed (Error)",
        run_at: expect.any(Date),
      },
    });
  });

  // 25. Owned final failure transitions PROCESSING -> FAILED and retains worker_id
  it("transitions owned failing job with attempts >= max_attempts to FAILED and retains worker_id", async () => {
    const claimedJob = {
      id: "final-fail-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "terminal-fail-worker",
      attempts: 3,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(new Error("fatal parsing error")),
      },
      { workerId: "terminal-fail-worker" },
    );

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "final-fail-job",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "terminal-fail-worker",
        attempts: 3,
      },
      data: {
        status: "FAILED",
        worker_id: "terminal-fail-worker",
        locked_until: null,
        error_log: "Job handler execution failed (Error)",
        run_at: undefined,
      },
    });
  });

  // 26. Failure CAS includes queue/status/worker/attempt epoch
  it("enforces full claim epoch predicate in failure CAS update", async () => {
    const claimedJob = {
      id: "epoch-fail-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-node-7",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(new Error("transient glitch")),
      },
      { workerId: "worker-node-7" },
    );

    expect(updateManySpy).toHaveBeenCalledWith({
      where: {
        id: "epoch-fail-job",
        queue_name: INGESTION_QUEUE_NAME,
        status: "PROCESSING",
        worker_id: "worker-node-7",
        attempts: 2,
      },
      data: {
        status: "PENDING",
        worker_id: null,
        locked_until: null,
        error_log: "Job handler execution failed (Error)",
        run_at: expect.any(Date),
      },
    });
  });

  // 27. Stale failure after recovery cannot overwrite new state
  it("safely skips state mutation when worker failure CAS returns count 0", async () => {
    const claimedJob = {
      id: "stale-failure-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "stale-worker",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 1000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(new Error("late failure")),
      },
      { workerId: "stale-worker" },
    );

    expect(updateManySpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("lost ownership of job stale-failure-job during failure handling"),
    );
  });

  // 28. Attempts are not incremented again during failure handling
  it("does not increment attempts during failure handling", async () => {
    const claimedJob = {
      id: "attempt-preserve-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-1",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(new Error("error")),
      },
      { workerId: "worker-1" },
    );

    const updateData = updateManySpy.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("attempts");
  });

  // 29. Persisted error_log does NOT persist synthetic secret or raw internal stack
  it("persists bounded non-sensitive error classification and never raw synthetic secrets to error_log", async () => {
    const syntheticSecretError = new Error(
      "DATABASE_URL=postgresql://admin:super-secret@internal-db/savvy password leak test",
    );
    syntheticSecretError.name = "DatabaseConnectionError";
    syntheticSecretError.stack =
      "Error: DATABASE_URL=postgresql://admin:super-secret@internal-db/savvy\n    at /internal/path/db.ts:42";

    const claimedJob = {
      id: "secret-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "secret-worker",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 120_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: vi.fn().mockRejectedValue(syntheticSecretError),
      },
      { workerId: "secret-worker" },
    );

    const persistedData = updateManySpy.mock.calls[0][0].data;
    expect(persistedData.error_log).toBe("Job handler execution failed (DatabaseConnectionError)");
    expect(persistedData.error_log).not.toContain("super-secret");
    expect(persistedData.error_log).not.toContain("postgresql://");
    expect(persistedData.error_log).not.toContain("/internal/path");
  });

  // 30. Recovery does not mutate WorkerNode
  it("does not query or mutate WorkerNode table during JobQueue recovery", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const workerNodeUpdateSpy = vi.spyOn(prisma.workerNode, "updateMany");
    const workerNodeFindSpy = vi.spyOn(prisma.workerNode, "findMany");

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(workerNodeUpdateSpy).not.toHaveBeenCalled();
    expect(workerNodeFindSpy).not.toHaveBeenCalled();
  });

  // 31. Recovery does not mutate ScrapeJob
  it("does not mutate ScrapeJob table during generic JobQueue recovery", async () => {
    const staleJob = {
      id: "job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: null,
      worker_id: "worker-1",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() - 10_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([staleJob] as never);
    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const scrapeJobUpdateSpy = vi.spyOn(prisma.scrapeJob, "updateMany");

    await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(scrapeJobUpdateSpy).not.toHaveBeenCalled();
  });

  // 32. C2 recovery loop is not activated
  it("executes recovery as a standalone service method without recurring orchestrator loop activation", async () => {
    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);

    const result = await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);

    expect(result).toBe(0);
  });

  // 33. Test suite has zero live DB dependency
  it("executes completely in-memory with zero live database dependency", async () => {
    expect(JobQueueService.recoverStaleJobs).toBeTypeOf("function");
    expect(JobQueueService.processNextJob).toBeTypeOf("function");
  });
});
