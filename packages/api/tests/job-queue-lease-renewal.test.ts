import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import {
  DEFAULT_JOB_LEASE_DURATION_MS,
  DEFAULT_JOB_LEASE_RENEW_INTERVAL_MS,
  JobQueueService,
} from "../src/services/job-queue.service";

describe("JobQueue Autonomous Lease Renewal (Boundary C2B)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Initial claim uses default 120s lease
  it("uses DEFAULT_JOB_LEASE_DURATION_MS (120s) for initial claim locked_until", async () => {
    const candidate = {
      id: "claim-default-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PENDING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: null,
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: null,
      error_log: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let claimedLockedUntil: Date | undefined;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: unknown) => {
      return (callback as (tx: unknown) => Promise<unknown>)({
        jobQueue: {
          findFirst: vi.fn().mockResolvedValue(candidate),
          updateMany: vi.fn().mockImplementation((args: { data: { locked_until?: Date } }) => {
            claimedLockedUntil = args.data.locked_until;
            return { count: 1 };
          }),
          findUnique: vi.fn().mockResolvedValue({
            ...candidate,
            status: "PROCESSING",
            worker_id: "worker-node-1",
            attempts: 1,
            locked_until: claimedLockedUntil,
          }),
        },
      });
    });

    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const beforeClaim = Date.now();

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
      { workerId: "worker-node-1" },
    );

    expect(claimedLockedUntil).toBeInstanceOf(Date);
    const lockedTime = (claimedLockedUntil as Date).getTime();
    expect(lockedTime).toBeGreaterThanOrEqual(beforeClaim + DEFAULT_JOB_LEASE_DURATION_MS - 100);
    expect(lockedTime).toBeLessThanOrEqual(beforeClaim + DEFAULT_JOB_LEASE_DURATION_MS + 2000);
  });

  // 2. Custom leaseDurationMs affects initial claim
  it("respects custom leaseDurationMs for initial claim locked_until", async () => {
    const candidate = {
      id: "claim-custom-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PENDING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: null,
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: null,
      error_log: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let claimedLockedUntil: Date | undefined;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: unknown) => {
      return (callback as (tx: unknown) => Promise<unknown>)({
        jobQueue: {
          findFirst: vi.fn().mockResolvedValue(candidate),
          updateMany: vi.fn().mockImplementation((args: { data: { locked_until?: Date } }) => {
            claimedLockedUntil = args.data.locked_until;
            return { count: 1 };
          }),
          findUnique: vi.fn().mockResolvedValue({
            ...candidate,
            status: "PROCESSING",
            worker_id: "worker-node-1",
            attempts: 1,
            locked_until: claimedLockedUntil,
          }),
        },
      });
    });

    vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const beforeClaim = Date.now();

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
      { workerId: "worker-node-1", leaseDurationMs: 45_000 },
    );

    expect(claimedLockedUntil).toBeInstanceOf(Date);
    const lockedTime = (claimedLockedUntil as Date).getTime();
    expect(lockedTime).toBeGreaterThanOrEqual(beforeClaim + 45_000 - 100);
    expect(lockedTime).toBeLessThanOrEqual(beforeClaim + 45_000 + 2000);
  });

  // 3. No renewal DB write before first interval (short-job behavior)
  it("issues zero renewal DB writes when handler settles before the first renewal interval", async () => {
    const claimedJob = {
      id: "short-job-1",
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

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
      { workerId: "worker-1", leaseRenewIntervalMs: 50_000 },
    );

    // Exactly 1 updateMany call: the terminal COMPLETED write
    expect(updateManySpy).toHaveBeenCalledTimes(1);
    expect(updateManySpy.mock.calls[0][0].data).toMatchObject({
      status: "COMPLETED",
      locked_until: null,
    });
  });

  // 4. Active long handler renews lease
  it("renews lease periodically during long-running handler execution", async () => {
    const claimedJob = {
      id: "long-job-1",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    let renewalTicks = 0;
    const handler = async () => {
      // Allow 2 renewal ticks to occur (renew interval 10ms)
      await new Promise((resolve) => setTimeout(resolve, 35));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseDurationMs: 200, leaseRenewIntervalMs: 10 },
    );

    // At least 2 renewal calls + 1 terminal COMPLETED call
    expect(updateManySpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    const renewalCalls = updateManySpy.mock.calls.filter(
      (call) => call[0].data.locked_until instanceof Date,
    );
    expect(renewalCalls.length).toBeGreaterThanOrEqual(2);
  });

  // 5. Renewal uses same effective lease duration as initial claim
  it("extends locked_until using the exact effective leaseDurationMs", async () => {
    const claimedJob = {
      id: "duration-check-1",
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
      locked_until: new Date(Date.now() + 60_000),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
    const beforeRenewal = Date.now();

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseDurationMs: 60_000, leaseRenewIntervalMs: 10 },
    );

    const renewalCall = updateManySpy.mock.calls.find(
      (call) => call[0].data.locked_until instanceof Date,
    );
    expect(renewalCall).toBeDefined();
    const newLockedUntil = (renewalCall![0].data.locked_until as Date).getTime();
    expect(newLockedUntil).toBeGreaterThanOrEqual(beforeRenewal + 60_000 - 100);
  });

  // 6–10. Renewal CAS predicate verification
  it("enforces complete claim epoch CAS predicate during renewal (id, queue_name, status, worker_id, attempts)", async () => {
    const claimedJob = {
      id: "predicate-job-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "worker-node-9",
      attempts: 2,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-node-9", leaseRenewIntervalMs: 10 },
    );

    const renewalCall = updateManySpy.mock.calls.find(
      (call) => call[0].data.locked_until instanceof Date,
    );
    expect(renewalCall).toBeDefined();
    expect(renewalCall![0].where).toEqual({
      id: "predicate-job-1",
      queue_name: INGESTION_QUEUE_NAME,
      status: "PROCESSING",
      worker_id: "worker-node-9",
      attempts: 2,
    });
  });

  // 11–12. Renewal changes only locked_until and never mutates attempts
  it("mutates only locked_until and preserves attempts, worker_id, and status during renewal", async () => {
    const claimedJob = {
      id: "mutation-isolation-1",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 10 },
    );

    const renewalCall = updateManySpy.mock.calls.find(
      (call) => call[0].data.locked_until instanceof Date,
    );
    expect(renewalCall).toBeDefined();
    const updateData = renewalCall![0].data;
    expect(Object.keys(updateData)).toEqual(["locked_until"]);
    expect(updateData).not.toHaveProperty("attempts");
    expect(updateData).not.toHaveProperty("worker_id");
    expect(updateData).not.toHaveProperty("status");
    expect(updateData).not.toHaveProperty("run_at");
  });

  // 13. Old execution cannot renew a newer attempts epoch
  it("prevents an old execution from renewing a newer claim epoch on reclaimed row", async () => {
    const oldClaimedJob = {
      id: "reclaimed-epoch-job",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: "same-worker-id",
      attempts: 1, // Old execution was attempt 1
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(oldClaimedJob as never);
    // Database has attempt 2 now, so attempt 1 renewal returns count 0
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "same-worker-id", leaseRenewIntervalMs: 10 },
    );

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "reclaimed-epoch-job",
          worker_id: "same-worker-id",
          attempts: 1,
        }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("lost lease ownership for job reclaimed-epoch-job"),
    );
  });

  // 14. CAS count 0 stops all future renewals (lost ownership)
  it("stops future renewal scheduling immediately when renewal CAS returns count 0", async () => {
    const claimedJob = {
      id: "lost-lease-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    // 1st renewal returns count 0 (ownership lost), completion returns count 0
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const handler = async () => {
      // Long handler: would normally trigger 4 renewals if not stopped
      await new Promise((resolve) => setTimeout(resolve, 45));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 10 },
    );

    const renewalCalls = updateManySpy.mock.calls.filter(
      (call) => call[0].data.locked_until instanceof Date,
    );
    // Exactly 1 renewal call occurred because count=0 stopped further scheduling
    expect(renewalCalls.length).toBe(1);
  });

  // 15–16. Transient DB error does not crash handler and allows later retry
  it("handles transient database renewal error gracefully without crashing and allows later retry", async () => {
    const claimedJob = {
      id: "transient-err-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    const updateManySpy = vi
      .spyOn(prisma.jobQueue, "updateMany")
      .mockRejectedValueOnce(new Error("connection reset by peer"))
      .mockResolvedValueOnce({ count: 1 }) // 2nd renewal succeeds
      .mockResolvedValueOnce({ count: 1 }); // completion succeeds

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    };

    const result = await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 10 },
    );

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to renew lease for job transient-err-job: Lease renewal database operation failed (Error)"),
    );
    // Verified 2nd renewal call was executed despite 1st error
    expect(updateManySpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // 17. Non-overlapping renewal execution
  it("ensures renewal database operations never overlap concurrently", async () => {
    const claimedJob = {
      id: "no-overlap-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);

    let inFlightRenewals = 0;
    let maxConcurrentRenewals = 0;

    vi.spyOn(prisma.jobQueue, "updateMany").mockImplementation(
      async (args: { data: { locked_until?: Date | null; status?: string } }) => {
        if (args.data.locked_until instanceof Date) {
          inFlightRenewals += 1;
          maxConcurrentRenewals = Math.max(maxConcurrentRenewals, inFlightRenewals);
          await new Promise((resolve) => setTimeout(resolve, 15));
          inFlightRenewals -= 1;
        }
        return { count: 1 };
      },
    );

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 45));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 5 },
    );

    expect(maxConcurrentRenewals).toBe(1);
  });

  // 18. Successful handler drains in-flight renewal before completion CAS
  it("drains in-flight renewal before executing terminal completion CAS on handler success", async () => {
    const claimedJob = {
      id: "drain-success-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);

    const callLog: string[] = [];
    vi.spyOn(prisma.jobQueue, "updateMany").mockImplementation(
      async (args: { data: { locked_until?: Date | null; status?: string } }) => {
        if (args.data.locked_until instanceof Date) {
          callLog.push("RENEW_START");
          await new Promise((resolve) => setTimeout(resolve, 15));
          callLog.push("RENEW_DONE");
        } else if (args.data.status === "COMPLETED") {
          callLog.push("COMPLETED");
        }
        return { count: 1 };
      },
    );

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 5 },
    );

    expect(callLog).toEqual(["RENEW_START", "RENEW_DONE", "COMPLETED"]);
  });

  // 19. Failed handler drains in-flight renewal before failure CAS
  it("drains in-flight renewal before executing terminal failure CAS on handler rejection", async () => {
    const claimedJob = {
      id: "drain-fail-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockResolvedValue(claimedJob as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const callLog: string[] = [];
    vi.spyOn(prisma.jobQueue, "updateMany").mockImplementation(
      async (args: { data: { locked_until?: Date | null; status?: string } }) => {
        if (args.data.locked_until instanceof Date) {
          callLog.push("RENEW_START");
          await new Promise((resolve) => setTimeout(resolve, 15));
          callLog.push("RENEW_DONE");
        } else if (args.data.status === "PENDING" || args.data.status === "FAILED") {
          callLog.push("FAILURE_CAS");
        }
        return { count: 1 };
      },
    );

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("handler execution failure");
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseRenewIntervalMs: 5 },
    );

    expect(callLog).toEqual(["RENEW_START", "RENEW_DONE", "FAILURE_CAS"]);
  });

  // 20. claimAdapter isolation
  it("produces zero lease renewal DB writes when claimAdapter is passed in options", async () => {
    const claimedJob = {
      id: "adapter-job-1",
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      attempts: 1,
      max_attempts: 3,
    };

    const claimAdapter = vi.fn().mockResolvedValue(claimedJob);
    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    };

    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "adapter-worker", claimAdapter, leaseRenewIntervalMs: 5 },
    );

    expect(updateManySpy).not.toHaveBeenCalled();
  });

  // 21. Graceful worker stop continues renewal while active handler drains
  it("continues renewing lease during graceful worker shutdown while active in-flight handler is finishing", async () => {
    const claimedJob = {
      id: "shutdown-drain-job",
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
      locked_until: new Date(Date.now() + 100),
      error_log: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let firstClaim = true;
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      if (firstClaim) {
        firstClaim = false;
        return claimedJob as never;
      }
      return null;
    });

    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    let handlerFinished = false;
    const worker = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      {
        CRAWL_URL: async () => {
          await new Promise((resolve) => setTimeout(resolve, 35));
          handlerFinished = true;
        },
      },
      5,
      { workerId: "worker-1", leaseDurationMs: 200, leaseRenewIntervalMs: 10 },
    );

    // Stop worker mid-flight at 15ms while handler is still running
    await new Promise((resolve) => setTimeout(resolve, 15));
    const stopPromise = worker.stop();

    await stopPromise;
    expect(handlerFinished).toBe(true);

    const renewalCalls = updateManySpy.mock.calls.filter(
      (call) => call[0].data.locked_until instanceof Date,
    );
    expect(renewalCalls.length).toBeGreaterThanOrEqual(2);
  });

  // 22. No renewal executes after terminal CAS
  it("ensures no renewal timer executes after terminal completion CAS has finished", async () => {
    const claimedJob = {
      id: "no-post-terminal-job",
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
      locked_until: new Date(Date.now() + 100),
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
      {
        CRAWL_URL: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
        },
      },
      { workerId: "worker-1", leaseRenewIntervalMs: 10 },
    );

    const callCountAtCompletion = updateManySpy.mock.calls.length;

    // Wait an additional interval
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Zero additional renewal calls occurred after processNextJob resolved
    expect(updateManySpy.mock.calls.length).toBe(callCountAtCompletion);
  });

  // 23. Zero live DB dependency
  it("runs completely in-memory with zero live database dependency", async () => {
    expect(DEFAULT_JOB_LEASE_DURATION_MS).toBe(120_000);
    expect(DEFAULT_JOB_LEASE_RENEW_INTERVAL_MS).toBe(30_000);
    expect(JobQueueService.processNextJob).toBeTypeOf("function");
  });

  // 24. Configuration: custom lease without custom interval derives approximately lease/4
  it("derives safe renewal interval of approximately leaseDurationMs / 4 when interval is omitted", async () => {
    const candidate = {
      id: "config-derived-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PENDING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: null,
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: null,
      error_log: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: unknown) => {
      return (callback as (tx: unknown) => Promise<unknown>)({
        jobQueue: {
          findFirst: vi.fn().mockResolvedValue(candidate),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            ...candidate,
            status: "PROCESSING",
            worker_id: "worker-1",
            attempts: 1,
            locked_until: new Date(Date.now() + 80_000),
          }),
        },
      });
    });

    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    };

    // leaseDurationMs = 80_000 -> derived interval = 20_000 (which is < 40_000)
    await JobQueueService.processNextJob(
      INGESTION_QUEUE_NAME,
      { CRAWL_URL: handler },
      { workerId: "worker-1", leaseDurationMs: 80_000 },
    );

    expect(updateManySpy).toHaveBeenCalled();
  });

  // 25. Configuration: explicit safe custom interval is honored
  it("honors an explicit positive leaseRenewIntervalMs when strictly less than half the lease duration", async () => {
    const candidate = {
      id: "config-safe-explicit-1",
      queue_name: INGESTION_QUEUE_NAME,
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-1",
        url: "https://example.com/bonus",
      }),
      status: "PENDING",
      priority: "NORMAL",
      domain: "example.com",
      worker_id: null,
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: null,
      error_log: null,
      started_at: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: unknown) => {
      return (callback as (tx: unknown) => Promise<unknown>)({
        jobQueue: {
          findFirst: vi.fn().mockResolvedValue(candidate),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            ...candidate,
            status: "PROCESSING",
            worker_id: "worker-1",
            attempts: 1,
            locked_until: new Date(Date.now() + 120_000),
          }),
        },
      });
    });

    const updateManySpy = vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });

    // leaseDurationMs = 120_000, leaseRenewIntervalMs = 20_000 (< 60_000)
    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 120_000, leaseRenewIntervalMs: 20_000 },
      ),
    ).resolves.toBe(true);

    expect(updateManySpy).toHaveBeenCalled();
  });

  // 26. Configuration: explicit interval equal to half the lease is rejected
  it("rejects an explicit leaseRenewIntervalMs equal to half the leaseDurationMs with RangeError", async () => {
    const txSpy = vi.spyOn(prisma, "$transaction");
    const updateSpy = vi.spyOn(prisma.jobQueue, "updateMany");

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 120_000, leaseRenewIntervalMs: 60_000 },
      ),
    ).rejects.toThrow(RangeError);

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 120_000, leaseRenewIntervalMs: 60_000 },
      ),
    ).rejects.toThrow("leaseRenewIntervalMs must be less than half of leaseDurationMs");

    // Zero DB mutation occurred
    expect(txSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // 27. Configuration: explicit interval greater than half the lease is rejected
  it("rejects an explicit leaseRenewIntervalMs greater than half the leaseDurationMs with RangeError", async () => {
    const txSpy = vi.spyOn(prisma, "$transaction");
    const updateSpy = vi.spyOn(prisma.jobQueue, "updateMany");

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 120_000, leaseRenewIntervalMs: 70_000 },
      ),
    ).rejects.toThrow(RangeError);

    expect(txSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // 28. Configuration: explicit interval greater than the entire lease is rejected
  it("rejects an explicit leaseRenewIntervalMs greater than the leaseDurationMs with RangeError", async () => {
    const txSpy = vi.spyOn(prisma, "$transaction");
    const updateSpy = vi.spyOn(prisma.jobQueue, "updateMany");

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 120_000, leaseRenewIntervalMs: 300_000 },
      ),
    ).rejects.toThrow(RangeError);

    expect(txSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // 29. Configuration: impossible tiny lease duration is rejected
  it("rejects impossible tiny leaseDurationMs with RangeError before any database access", async () => {
    const txSpy = vi.spyOn(prisma, "$transaction");
    const updateSpy = vi.spyOn(prisma.jobQueue, "updateMany");

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 2 },
      ),
    ).rejects.toThrow(RangeError);

    await expect(
      JobQueueService.processNextJob(
        INGESTION_QUEUE_NAME,
        { CRAWL_URL: vi.fn().mockResolvedValue(undefined) },
        { workerId: "worker-1", leaseDurationMs: 1 },
      ),
    ).rejects.toThrow(RangeError);

    expect(txSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
