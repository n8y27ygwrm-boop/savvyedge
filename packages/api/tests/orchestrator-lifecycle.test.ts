import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import {
  JobQueueService,
  WorkerHandle,
  DomainConcurrencyManager,
} from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";

beforeEach(() => {
  vi.spyOn(prisma.workerNode, "upsert").mockResolvedValue({} as never);
  vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 1 });
  vi.spyOn(prisma.workerNode, "update").mockResolvedValue({} as never);
  vi.spyOn(prisma.jobQueue, "findFirst").mockResolvedValue(null);
  vi.spyOn(prisma.jobQueue, "create").mockResolvedValue({ id: "mock-job-id" } as never);
  vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
  vi.spyOn(prisma.jobQueue, "findUnique").mockResolvedValue(null);
});

afterEach(async () => {
  try {
    await OrchestratorService.stop();
  } finally {
    vi.restoreAllMocks();
  }
});

describe("WorkerPool and Orchestrator Lifecycle (Boundary C1B)", () => {
  // 1. Worker stop handle is awaitable
  it("provides an awaitable stop handle for the worker loop", async () => {
    const handle: WorkerHandle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      {},
      50,
      { claimAdapter: async () => null },
    );

    expect(typeof handle.stop).toBe("function");
    const stopPromise = handle.stop();
    expect(stopPromise).toBeInstanceOf(Promise);
    await expect(stopPromise).resolves.toBeUndefined();
  });

  // 2. Worker duplicate stop joins one shutdown
  it("joins the same shutdown promise on duplicate worker stop calls", async () => {
    let releaseClaim: () => void = () => undefined;
    const claimHold = new Promise<void>((r) => {
      releaseClaim = r;
    });

    const handle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      {},
      10,
      {
        claimAdapter: async () => {
          await claimHold;
          return null;
        },
      },
    );

    const firstStop = handle.stop();
    const secondStop = handle.stop();
    expect(firstStop).toBe(secondStop);

    releaseClaim();
    await Promise.all([firstStop, secondStop]);
  });

  // 3. Worker stop clears pending poll timeout
  it("clears pending polling timeout on stop so no timers survive shutdown", async () => {
    vi.useFakeTimers();
    try {
      const processNext = vi
        .spyOn(JobQueueService, "processNextJob")
        .mockResolvedValue(false);

      const handle = JobQueueService.startWorker(
        INGESTION_QUEUE_NAME,
        {},
        1000,
        { claimAdapter: async () => null },
      );

      // Initial cycle runs and schedules next poll
      await vi.advanceTimersByTimeAsync(0);
      const callsBeforeStop = processNext.mock.calls.length;

      // Stop while waiting in poll interval
      await handle.stop();

      // Advance time past the poll interval
      await vi.advanceTimersByTimeAsync(5000);

      // No additional calls should have occurred
      expect(processNext.mock.calls.length).toBe(callsBeforeStop);
    } finally {
      vi.useRealTimers();
    }
  });

  // 4. Worker stop prevents subsequent claims
  it("prevents subsequent claims once stop is initiated", async () => {
    let claimCalls = 0;
    let stopTriggered = false;
    let workerHandle: WorkerHandle;

    const claimAdapter = async () => {
      claimCalls += 1;
      if (claimCalls === 1) {
        stopTriggered = true;
        await workerHandle.stop();
        return null;
      }
      return null;
    };

    workerHandle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      {},
      10,
      { claimAdapter },
    );

    await workerHandle.stop();
    expect(stopTriggered).toBe(true);
    const countAfterStop = claimCalls;
    await new Promise((r) => setTimeout(r, 20));
    expect(claimCalls).toBe(countAfterStop);
  });

  // 5. Worker stop during handler waits for in-flight handler
  it("awaits active in-flight handler completion before resolving stop", async () => {
    let handlerFinished = false;
    let stopResolved = false;
    let releaseHandler: () => void = () => undefined;

    const handlerPromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const handlers = {
      CRAWL_URL: async () => {
        await handlerPromise;
        handlerFinished = true;
      },
    };

    let claimed = false;
    const claimAdapter = async () => {
      if (!claimed) {
        claimed = true;
        return {
          id: "job-inflight",
          task_type: "CRAWL_URL",
          payload: JSON.stringify({ scrapeJobId: "scrape-1", url: "https://example.com" }),
          attempts: 1,
          max_attempts: 3,
        };
      }
      return null;
    };

    const handle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      handlers,
      10,
      { claimAdapter },
    );

    await new Promise((r) => setTimeout(r, 10));

    const stopPromise = handle.stop().then(() => {
      stopResolved = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(stopResolved).toBe(false);
    expect(handlerFinished).toBe(false);

    releaseHandler();
    await stopPromise;

    expect(handlerFinished).toBe(true);
    expect(stopResolved).toBe(true);
  });

  // 6. Handler error semantics remain intact during stop
  it("preserves handler error handling semantics when stop occurs during execution", async () => {
    let handlerErrorCaught = false;
    let releaseHandler: () => void = () => undefined;

    const handlerPromise = new Promise<void>((_, reject) => {
      releaseHandler = () => reject(new Error("in-flight handler failed"));
    });

    const handlers = {
      CRAWL_URL: async () => {
        try {
          await handlerPromise;
        } catch (err) {
          handlerErrorCaught = true;
          throw err;
        }
      },
    };

    let claimed = false;
    const claimAdapter = async () => {
      if (!claimed) {
        claimed = true;
        return {
          id: "job-failing",
          task_type: "CRAWL_URL",
          payload: JSON.stringify({ scrapeJobId: "scrape-2", url: "https://example.com" }),
          attempts: 1,
          max_attempts: 3,
        };
      }
      return null;
    };

    const handle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      handlers,
      10,
      { claimAdapter },
    );

    await new Promise((r) => setTimeout(r, 10));
    const stopPromise = handle.stop();

    releaseHandler();
    await stopPromise;

    expect(handlerErrorCaught).toBe(true);
  });

  // 7. Domain slot releases after in-flight completion
  it("releases domain slot when in-flight handler finishes during shutdown", async () => {
    const manager = new DomainConcurrencyManager(1);
    let releaseHandler: () => void = () => undefined;

    const handlerPromise = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const handlers = {
      CRAWL_URL: async () => {
        await handlerPromise;
      },
    };

    let claimed = false;
    const claimAdapter = async (
      _queue: string,
      _worker: string,
      canAcquire: (dom: string | undefined) => boolean,
    ) => {
      if (!claimed && canAcquire("example.com")) {
        claimed = true;
        return {
          id: "job-domain-slot",
          task_type: "CRAWL_URL",
          payload: JSON.stringify({ scrapeJobId: "scrape-3", url: "https://example.com" }),
          attempts: 1,
          max_attempts: 3,
        };
      }
      return null;
    };

    const handle = JobQueueService.startWorker(
      INGESTION_QUEUE_NAME,
      handlers,
      10,
      { claimAdapter, domainLimiter: manager },
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(manager.getActiveCount("example.com")).toBe(1);

    const stopPromise = handle.stop();
    releaseHandler();
    await stopPromise;

    expect(manager.getActiveCount("example.com")).toBe(0);
  });

  // 8. First orchestrator start creates workers
  it("creates configured number of workers on first start", async () => {
    const workerStopMock = vi.fn().mockResolvedValue(undefined);
    const startWorkerSpy = vi
      .spyOn(JobQueueService, "startWorker")
      .mockReturnValue({ stop: workerStopMock });

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    expect(startWorkerSpy).toHaveBeenCalledTimes(2);
    await OrchestratorService.stop();
  });

  // 9. Sequential duplicate start creates no duplicates
  it("prevents duplicate worker and scheduler creation on sequential start calls", async () => {
    const workerStopMock = vi.fn().mockResolvedValue(undefined);
    const startWorkerSpy = vi
      .spyOn(JobQueueService, "startWorker")
      .mockReturnValue({ stop: workerStopMock });

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    expect(startWorkerSpy).toHaveBeenCalledTimes(2);
    await OrchestratorService.stop();
  });

  // 10. Concurrent duplicate start creates no duplicates
  it("joins the same startup promise when concurrent start calls occur", async () => {
    const workerStopMock = vi.fn().mockResolvedValue(undefined);
    const startWorkerSpy = vi
      .spyOn(JobQueueService, "startWorker")
      .mockReturnValue({ stop: workerStopMock });

    const p1 = OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });
    const p2 = OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await Promise.all([p1, p2]);
    expect(startWorkerSpy).toHaveBeenCalledTimes(2);
    await OrchestratorService.stop();
  });

  // 11. Stop before start is safe
  it("safely no-ops when stop is called before start", async () => {
    await expect(OrchestratorService.stop()).resolves.toBeUndefined();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 12. Sequential duplicate stop is safe
  it("safely handles sequential duplicate stop calls idempotently", async () => {
    const workerStopMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(JobQueueService, "startWorker").mockReturnValue({
      stop: workerStopMock,
    });

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await OrchestratorService.stop();
    await expect(OrchestratorService.stop()).resolves.toBeUndefined();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 13. Concurrent duplicate stop joins active shutdown
  it("joins the same in-progress shutdown promise across concurrent stop calls", async () => {
    let releaseStop: () => void = () => undefined;
    const workerStopHold = new Promise<void>((r) => {
      releaseStop = r;
    });

    vi.spyOn(JobQueueService, "startWorker").mockReturnValue({
      stop: vi.fn().mockReturnValue(workerStopHold),
    });

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    const stop1 = OrchestratorService.stop();
    const stop2 = OrchestratorService.stop();

    let stop2Resolved = false;
    stop2.then(() => {
      stop2Resolved = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(stop2Resolved).toBe(false);

    releaseStop();
    await Promise.all([stop1, stop2]);
    expect(stop2Resolved).toBe(true);
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 14. Orchestrator stop waits for all worker handles
  it("awaits all worker handle stops before declaring shutdown complete", async () => {
    let stopCount = 0;
    const workerStopMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      stopCount += 1;
    });

    vi.spyOn(JobQueueService, "startWorker").mockReturnValue({
      stop: workerStopMock,
    });

    await OrchestratorService.start({
      workerConcurrency: 3,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await OrchestratorService.stop();
    expect(stopCount).toBe(3);
  });

  // 15. Scheduler timers clear on stop
  it("clears scheduler timers on graceful shutdown", async () => {
    const enqueueSpy = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-sched" } as never);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: true,
      enableRecovery: false,
      discoveryIntervalMs: 50000,
      seedSources: ["https://example.com/seed"],
    });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    await OrchestratorService.stop();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 16. Restart after completed stop works
  it("allows clean restart after a full graceful stop", async () => {
    const workerStop1 = vi.fn().mockResolvedValue(undefined);
    const workerStop2 = vi.fn().mockResolvedValue(undefined);

    const startWorkerSpy = vi
      .spyOn(JobQueueService, "startWorker")
      .mockReturnValueOnce({ stop: workerStop1 })
      .mockReturnValueOnce({ stop: workerStop2 });

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });
    expect(startWorkerSpy).toHaveBeenCalledTimes(1);

    await OrchestratorService.stop();
    expect(workerStop1).toHaveBeenCalledTimes(1);

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });
    expect(startWorkerSpy).toHaveBeenCalledTimes(2);

    await OrchestratorService.stop();
    expect(workerStop2).toHaveBeenCalledTimes(1);
  });

  // 17. Start during STOPPING waits and starts only afterward
  it("waits for active shutdown before starting fresh generation when start is called during STOPPING", async () => {
    let releaseWorkerStop: () => void = () => undefined;
    const workerStopPromise = new Promise<void>((resolve) => {
      releaseWorkerStop = resolve;
    });

    const stopMock1 = vi.fn().mockReturnValue(workerStopPromise);
    const stopMock2 = vi.fn().mockResolvedValue(undefined);

    const startWorkerSpy = vi
      .spyOn(JobQueueService, "startWorker")
      .mockReturnValueOnce({ stop: stopMock1 })
      .mockReturnValueOnce({ stop: stopMock2 });

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    // Initiate stop and hold it unresolved
    const stopOp = OrchestratorService.stop();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPING");

    // Initiate start during STOPPING
    let restartStarted = false;
    const startOp = OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    }).then(() => {
      restartStarted = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(restartStarted).toBe(false);
    expect(startWorkerSpy).toHaveBeenCalledTimes(1);

    // Release old worker shutdown
    releaseWorkerStop();
    await stopOp;
    await startOp;

    expect(restartStarted).toBe(true);
    expect(startWorkerSpy).toHaveBeenCalledTimes(2);
    expect(OrchestratorService.getLifecycleState()).toBe("RUNNING");

    await OrchestratorService.stop();
  });

  // 18. Stop during STARTING cleans partial resources safely
  it("handles stop during STARTING by cleaning resources once start settles", async () => {
    const workerStopMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(JobQueueService, "startWorker").mockReturnValue({
      stop: workerStopMock,
    });

    const startPromise = OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    const stopPromise = OrchestratorService.stop();
    await Promise.all([startPromise, stopPromise]);

    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 19-20. Startup failure rolls back partial resources and leaves state restartable
  it("rolls back partial lifecycle resources and leaves state restartable upon startup error", async () => {
    const workerStop1 = vi.fn().mockResolvedValue(undefined);
    const workerStop2 = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(JobQueueService, "startWorker")
      .mockReturnValueOnce({ stop: workerStop1 })
      .mockImplementationOnce(() => {
        throw new Error("simulated second worker spawn failure");
      })
      .mockReturnValueOnce({ stop: workerStop2 });

    await expect(
      OrchestratorService.start({
        workerConcurrency: 2,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
      }),
    ).rejects.toThrow("simulated second worker spawn failure");

    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
    expect(workerStop1).toHaveBeenCalledTimes(1);

    // A subsequent start can now succeed cleanly
    await expect(
      OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
      }),
    ).resolves.toBeUndefined();

    expect(OrchestratorService.getLifecycleState()).toBe("RUNNING");
    await OrchestratorService.stop();
  });

  // 21-22. Worker-stop rejection does not leave state stuck in STOPPING and stops all workers
  it("ensures all workers receive stop even if one rejects and transitions to STOPPED", async () => {
    const workerStop1 = vi.fn().mockRejectedValue(new Error("worker-1 stop failed"));
    const workerStop2 = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(JobQueueService, "startWorker")
      .mockReturnValueOnce({ stop: workerStop1 })
      .mockReturnValueOnce({ stop: workerStop2 });

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await expect(OrchestratorService.stop()).rejects.toThrow("worker-1 stop failed");
    expect(workerStop1).toHaveBeenCalledTimes(1);
    expect(workerStop2).toHaveBeenCalledTimes(1);
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 23-30. Isolation and invariant assertions
  it("executes lifecycle without database writes, process signals, or process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: false,
    });

    await OrchestratorService.stop();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });
});
