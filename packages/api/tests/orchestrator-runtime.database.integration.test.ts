/**
 * C3C is opt-in real PostgreSQL integration coverage.
 * Run only with PHASE2_WORKFLOW_TEST_DATABASE_URL pointing to an isolated localhost database whose name contains "test".
 * Never use a dev/staging/production database.
 */

import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const rawTestDatabaseUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;

interface ValidatedDbConfig {
  safe: boolean;
  databaseUrl?: string;
  expectedDatabaseName?: string;
  error?: string;
}

function validateTestDatabaseUrl(
  rawUrl: string | undefined,
): ValidatedDbConfig {
  if (!rawUrl || rawUrl.trim() === "") {
    return { safe: false }; // Missing: cleanly skip
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      safe: false,
      error: "C3C test database configuration is unsafe: malformed URL",
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    return {
      safe: false,
      error:
        "C3C test database configuration is unsafe: non-PostgreSQL protocol",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!allowedHosts.has(hostname)) {
    return {
      safe: false,
      error:
        "C3C test database configuration is unsafe: hostname must be localhost",
    };
  }

  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) {
    return {
      safe: false,
      error:
        "C3C test database configuration is unsafe: database name must contain 'test'",
    };
  }

  return {
    safe: true,
    databaseUrl: rawUrl.trim(),
    expectedDatabaseName: databaseName,
  };
}

const dbConfig = validateTestDatabaseUrl(rawTestDatabaseUrl);

if (rawTestDatabaseUrl && !dbConfig.safe && dbConfig.error) {
  throw new Error(dbConfig.error);
}

const describeDatabaseIntegration = dbConfig.safe
  ? describe.sequential
  : describe.skip;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

describeDatabaseIntegration(
  "Real PostgreSQL Concurrency Verification (Boundary C3C)",
  () => {
    let prisma: import("@savvyedge/database").PrismaClient;
    let JobQueueService: typeof import("../src/services/job-queue.service").JobQueueService;
    const createdJobIds = new Set<string>();

    beforeAll(async () => {
      // Rebind DATABASE_URL to dedicated test database before initializing runtime client
      process.env.DATABASE_URL = dbConfig.databaseUrl!;

      // Dynamically import database client and service modules after binding
      const dbModule = await import("@savvyedge/database");
      prisma = dbModule.prisma;

      const jqModule = await import("../src/services/job-queue.service");
      JobQueueService = jqModule.JobQueueService;

      // Verify current_database() matches expected test database name
      const result = await prisma.$queryRawUnsafe<
        Array<{ current_database: string }>
      >("SELECT current_database() as current_database");
      const connectedDb = result[0]?.current_database?.toLowerCase();
      if (!connectedDb || connectedDb !== dbConfig.expectedDatabaseName) {
        throw new Error(
          "C3C test database verification failed: connected database identity mismatch",
        );
      }
    });

    afterEach(async () => {
      if (createdJobIds.size > 0 && prisma) {
        const idsToDelete = Array.from(createdJobIds);
        await prisma.jobQueue.deleteMany({
          where: { id: { in: idsToDelete } },
        });
        for (const id of idsToDelete) {
          createdJobIds.delete(id);
        }
      }
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.$disconnect();
      }
    });

    // Test 1: Real worker claim race (Worker Claim CAS)
    it("guarantees only one of two concurrent claim attempts gains ownership in PostgreSQL", async () => {
      const queueName = `c3c-claim-race-${crypto.randomUUID()}`;
      const testPayload = { task: "concurrent-claim-check" };

      const job = await prisma.jobQueue.create({
        data: {
          queue_name: queueName,
          task_type: "CLAIM_TASK",
          payload: JSON.stringify(testPayload),
          status: "PENDING",
          priority: "NORMAL",
          attempts: 0,
          max_attempts: 3,
          run_at: new Date(),
        },
      });
      createdJobIds.add(job.id);

      let handlerExecutions = 0;
      let notifyStarted: () => void = () => undefined;
      const startedPromise = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });

      let releaseHold: () => void = () => undefined;
      const holdPromise = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });

      const handlers = {
        CLAIM_TASK: async () => {
          handlerExecutions += 1;
          notifyStarted();
          await holdPromise;
        },
      };

      // Launch both claim attempts concurrently without awaiting immediately
      const claimAPromise = JobQueueService.processNextJob(queueName, handlers, {
        workerId: "c3c-worker-a",
      });
      const claimBPromise = JobQueueService.processNextJob(queueName, handlers, {
        workerId: "c3c-worker-b",
      });

      let claimA: boolean | undefined;
      let claimB: boolean | undefined;
      let claimError: unknown;

      try {
        // Wait until the winning worker starts executing the handler
        await withTimeout(
          startedPromise,
          2500,
          "Timed out waiting for winning worker to claim job and start handler",
        );

        // Verify only 1 execution has entered the handler
        expect(handlerExecutions).toBe(1);

        // Inspect row in PostgreSQL during active execution
        const activeRow = await prisma.jobQueue.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(activeRow.status).toBe("PROCESSING");
        expect(activeRow.attempts).toBe(1);
        expect(["c3c-worker-a", "c3c-worker-b"]).toContain(activeRow.worker_id);
      } finally {
        // Release the winning handler so its processNextJob can finalize
        releaseHold();

        // Drain both claim promises completely inside cleanup
        try {
          const results = await Promise.all([claimAPromise, claimBPromise]);
          claimA = results[0];
          claimB = results[1];
        } catch (err) {
          claimError = err;
        }
      }

      if (claimError) {
        throw claimError;
      }

      // Exactly one execution succeeded in claiming the job
      expect(Number(claimA) + Number(claimB)).toBe(1);
      expect(handlerExecutions).toBe(1);

      const finalRow = await prisma.jobQueue.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(finalRow.status).toBe("COMPLETED");
      expect(finalRow.attempts).toBe(1);
      expect(["c3c-worker-a", "c3c-worker-b"]).toContain(finalRow.worker_id);
    });

    // Test 2: Competing stale recovery race (Stale Recovery CAS)
    it("guarantees exactly one of two concurrent recoverStaleJobs calls recovers an expired job", async () => {
      const queueName = `c3c-recovery-race-${crypto.randomUUID()}`;
      const pastDate = new Date(Date.now() - 120_000); // 2 minutes in the past

      const job = await prisma.jobQueue.create({
        data: {
          queue_name: queueName,
          task_type: "RECOVER_TASK",
          payload: JSON.stringify({ item: "stale" }),
          status: "PROCESSING",
          priority: "NORMAL",
          worker_id: "dead-worker-1",
          attempts: 1,
          max_attempts: 3,
          run_at: pastDate,
          locked_until: pastDate,
          started_at: pastDate,
        },
      });
      createdJobIds.add(job.id);

      const [recoveredA, recoveredB] = await Promise.all([
        JobQueueService.recoverStaleJobs(queueName),
        JobQueueService.recoverStaleJobs(queueName),
      ]);

      expect(recoveredA + recoveredB).toBe(1);

      const finalRow = await prisma.jobQueue.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(finalRow.status).toBe("PENDING");
      expect(finalRow.worker_id).toBeNull();
      expect(finalRow.locked_until).toBeNull();
      expect(finalRow.attempts).toBe(1); // Recovery does not increment attempts
    });

    // Test 3: Real lease renewal protects against recovery
    it("extends locked_until via real lease renewal and excludes active job from recovery", async () => {
      const queueName = `c3c-lease-renewal-${crypto.randomUUID()}`;
      const initialRunAt = new Date();

      const job = await prisma.jobQueue.create({
        data: {
          queue_name: queueName,
          task_type: "LEASE_TASK",
          payload: JSON.stringify({ item: "long-running" }),
          status: "PENDING",
          priority: "NORMAL",
          attempts: 0,
          max_attempts: 3,
          run_at: initialRunAt,
        },
      });
      createdJobIds.add(job.id);

      let releaseHandler: () => void = () => undefined;
      const handlerHold = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });

      const leaseDurationMs = 500;
      const leaseRenewIntervalMs = 100; // 100 < 500/2

      const processingPromise = JobQueueService.processNextJob(
        queueName,
        {
          LEASE_TASK: async () => {
            await handlerHold;
          },
        },
        {
          workerId: "c3c-lease-worker",
          leaseDurationMs,
          leaseRenewIntervalMs,
        },
      );

      let processedOk: boolean | undefined;
      let processingError: unknown;

      try {
        // 1. Wait until job is claimed and initial locked_until is set in DB
        let initialLockedUntil: Date | null = null;
        const claimDeadline = Date.now() + 2500;
        while (Date.now() < claimDeadline) {
          const row = await prisma.jobQueue.findUnique({
            where: { id: job.id },
            select: { locked_until: true, status: true },
          });
          if (row?.status === "PROCESSING" && row.locked_until) {
            initialLockedUntil = row.locked_until;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(initialLockedUntil).not.toBeNull();

        // 2. Poll until real background lease renewal updates locked_until in PostgreSQL
        let renewed = false;
        const renewalDeadline = Date.now() + 3000;
        while (Date.now() < renewalDeadline) {
          const row = await prisma.jobQueue.findUnique({
            where: { id: job.id },
            select: { locked_until: true },
          });
          if (
            row?.locked_until &&
            row.locked_until.getTime() > initialLockedUntil!.getTime()
          ) {
            renewed = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 40));
        }

        expect(renewed).toBe(true);

        // 3. Run recovery while the job is actively processing and renewed
        const recoveredCount =
          await JobQueueService.recoverStaleJobs(queueName);
        expect(recoveredCount).toBe(0);
      } finally {
        // Always release the handler to unblock worker execution
        releaseHandler();

        // Drain the worker promise inside cleanup on all paths
        try {
          processedOk = await processingPromise;
        } catch (err) {
          processingError = err;
        }
      }

      if (processingError) {
        throw processingError;
      }

      expect(processedOk).toBe(true);

      const finalRow = await prisma.jobQueue.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(finalRow.status).toBe("COMPLETED");
    });

    // Test 4: Old claim epoch cannot complete newer ownership
    it("prevents an orphaned execution from completing a job after newer claim epoch exists", async () => {
      const queueName = `c3c-epoch-cas-${crypto.randomUUID()}`;

      const job = await prisma.jobQueue.create({
        data: {
          queue_name: queueName,
          task_type: "EPOCH_TASK",
          payload: JSON.stringify({ item: "epoch-test" }),
          status: "PENDING",
          priority: "NORMAL",
          attempts: 0,
          max_attempts: 3,
          run_at: new Date(),
        },
      });
      createdJobIds.add(job.id);

      let releaseExecutionA: () => void = () => undefined;
      const holdA = new Promise<void>((resolve) => {
        releaseExecutionA = resolve;
      });

      const executionAPromise = JobQueueService.processNextJob(
        queueName,
        {
          EPOCH_TASK: async () => {
            await holdA;
          },
        },
        {
          workerId: "worker-epoch-A",
          leaseDurationMs: 2000,
          leaseRenewIntervalMs: 500,
        },
      );

      let executionAResult: boolean | undefined;
      let executionAError: unknown;

      try {
        // 1. Wait until execution A has claimed the row in DB
        let claimedByA = false;
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const row = await prisma.jobQueue.findUnique({
            where: { id: job.id },
            select: { worker_id: true, attempts: true, status: true },
          });
          if (
            row?.status === "PROCESSING" &&
            row.worker_id === "worker-epoch-A" &&
            row.attempts === 1
          ) {
            claimedByA = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(claimedByA).toBe(true);

        // 2. Simulate reclaim by worker B (epoch: attempts = 2, worker_id = "worker-epoch-B")
        await prisma.jobQueue.update({
          where: { id: job.id },
          data: {
            attempts: 2,
            worker_id: "worker-epoch-B",
            status: "PROCESSING",
            locked_until: new Date(Date.now() + 60_000),
          },
        });
      } finally {
        // 3. Always release execution A
        releaseExecutionA();

        // 4. Drain execution A promise inside cleanup on all paths
        try {
          executionAResult = await executionAPromise;
        } catch (err) {
          executionAError = err;
        }
      }

      if (executionAError) {
        throw executionAError;
      }

      expect(executionAResult).toBe(true);

      // 5. Verify the row was NOT set to COMPLETED by A and retains Worker B's epoch
      const finalRow = await prisma.jobQueue.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(finalRow.status).toBe("PROCESSING");
      expect(finalRow.worker_id).toBe("worker-epoch-B");
      expect(finalRow.attempts).toBe(2);
    });
  },
);
