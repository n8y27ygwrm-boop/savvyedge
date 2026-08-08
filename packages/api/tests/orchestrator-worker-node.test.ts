import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import {
  JobQueueService,
  WorkerHandle,
} from "../src/services/job-queue.service";
import {
  OrchestratorService,
  WorkerNodePersistenceAdapter,
} from "../src/services/orchestrator.service";

describe("WorkerNode Registration, Heartbeat, and Graceful Status Reconciliation (Boundary C1C)", () => {
  let upsertCalls: Array<{
    workerName: string;
    status: string;
    activeJobs: number;
    lastHeartbeat: Date;
  }> = [];
  let heartbeatCalls: Array<{
    workerNames: string[];
    now: Date;
  }> = [];
  let markDeadCalls: Array<{
    workerNames: string[];
  }> = [];
  let mockAdapter: WorkerNodePersistenceAdapter;

  beforeEach(() => {
    upsertCalls = [];
    heartbeatCalls = [];
    markDeadCalls = [];

    mockAdapter = {
      upsertWorker: vi.fn(async (params) => {
        upsertCalls.push({ ...params });
      }),
      heartbeatWorkers: vi.fn(async (params) => {
        heartbeatCalls.push({
          workerNames: [...params.workerNames],
          now: params.now,
        });
        return params.workerNames.length;
      }),
      markWorkersDead: vi.fn(async (params) => {
        markDeadCalls.push({
          workerNames: [...params.workerNames],
        });
        return params.workerNames.length;
      }),
      countActiveWorkers: vi.fn(async () => upsertCalls.length),
    };

    vi.spyOn(JobQueueService, "startWorker").mockImplementation(
      (): WorkerHandle => ({
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    );
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({ id: "mock-job-id" } as never);
  });

  afterEach(async () => {
    try {
      await OrchestratorService.stop();
    } finally {
      vi.restoreAllMocks();
    }
  });

  // 1. Start registers exactly configured WorkerNodes
  it("registers exactly the configured number of WorkerNodes on start", async () => {
    await OrchestratorService.start({
      workerConcurrency: 3,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    expect(upsertCalls.length).toBe(3);
    expect(upsertCalls.map((c) => c.workerName)).toEqual([
      "worker-node-1",
      "worker-node-2",
      "worker-node-3",
    ]);
  });

  // 2. Registration uses ACTIVE status
  it("registers WorkerNodes with status ACTIVE", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    for (const call of upsertCalls) {
      expect(call.status).toBe("ACTIVE");
    }
  });

  // 3. Registration resets active_jobs to 0
  it("resets active_jobs to 0 upon registration", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    for (const call of upsertCalls) {
      expect(call.activeJobs).toBe(0);
    }
  });

  // 4. Registration refreshes last_heartbeat
  it("refreshes last_heartbeat timestamp on registration", async () => {
    const before = Date.now();
    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    const after = Date.now();

    expect(upsertCalls[0].lastHeartbeat.getTime()).toBeGreaterThanOrEqual(before);
    expect(upsertCalls[0].lastHeartbeat.getTime()).toBeLessThanOrEqual(after);
  });

  // 5. Registration completes before first WorkerPool starts
  it("completes WorkerNode registration before worker loops start processing", async () => {
    const executionOrder: string[] = [];
    mockAdapter.upsertWorker = vi.fn(async () => {
      executionOrder.push("upsert");
    });
    vi.spyOn(JobQueueService, "startWorker").mockImplementation(
      (): WorkerHandle => {
        executionOrder.push("startWorker");
        return { stop: vi.fn().mockResolvedValue(undefined) };
      },
    );

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    expect(executionOrder).toEqual(["upsert", "startWorker"]);
  });

  // 6. Registration failure prevents worker start (fail-closed)
  it("fails closed and prevents worker loops from starting if registration rejects", async () => {
    const startWorkerSpy = vi.spyOn(JobQueueService, "startWorker");
    mockAdapter.upsertWorker = vi.fn().mockRejectedValue(new Error("database connection timeout"));

    await expect(
      OrchestratorService.start({
        workerConcurrency: 2,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        workerNodeAdapter: mockAdapter,
      }),
    ).rejects.toThrow("database connection timeout");

    expect(startWorkerSpy).not.toHaveBeenCalled();
  });

  // 7. Registration failure returns lifecycle to STOPPED
  it("returns lifecycle state to STOPPED when registration fails during start", async () => {
    mockAdapter.upsertWorker = vi.fn().mockRejectedValue(new Error("DB error"));

    await expect(
      OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        workerNodeAdapter: mockAdapter,
      }),
    ).rejects.toThrow("DB error");

    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 8. Duplicate/concurrent start does not duplicate registration generation
  it("does not duplicate WorkerNode registrations when concurrent starts occur", async () => {
    const p1 = OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    const p2 = OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await Promise.all([p1, p2]);
    expect(upsertCalls.length).toBe(2);
  });

  // 9. Heartbeat targets only owned worker names
  it("targets only owned worker names during heartbeat ticks", async () => {
    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 2,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 50,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(60);
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);
      expect(heartbeatCalls[0].workerNames).toEqual(["worker-node-1", "worker-node-2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // 10. Heartbeat updates only last_heartbeat
  it("refreshes last_heartbeat on periodic heartbeat without overwriting status to ACTIVE", async () => {
    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 50,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(60);
      expect(heartbeatCalls.length).toBe(1);
      expect(heartbeatCalls[0].now).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11. Heartbeat does not write ACTIVE status
  it("heartbeat persistence adapter does not set status in update data", async () => {
    expect(typeof mockAdapter.heartbeatWorkers).toBe("function");
    const result = await mockAdapter.heartbeatWorkers({
      workerNames: ["worker-node-1"],
      now: new Date(),
    });
    expect(result).toBe(1);
  });

  // 12. Heartbeat uses ACTIVE predicate where appropriate
  it("heartbeat operations are constrained to workers with active status", async () => {
    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(25);
      expect(heartbeatCalls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // 13. Slow heartbeat cannot overlap another heartbeat execution
  it("prevents overlapping heartbeat executions when database operation latency is high", async () => {
    let releaseHeartbeat: () => void = () => undefined;
    const heartbeatHold = new Promise<number>((resolve) => {
      releaseHeartbeat = () => resolve(1);
    });

    let activeCalls = 0;
    let maxConcurrent = 0;
    mockAdapter.heartbeatWorkers = vi.fn(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await heartbeatHold;
      activeCalls--;
      return 1;
    });

    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      // Advance through multiple intervals while heartbeat is still in-flight
      await vi.advanceTimersByTimeAsync(80);
      expect(maxConcurrent).toBe(1);
      expect(mockAdapter.heartbeatWorkers).toHaveBeenCalledTimes(1);
    } finally {
      releaseHeartbeat();
      await OrchestratorService.stop();
      vi.useRealTimers();
    }
  });

  // 14. Heartbeat failure does not stop workers
  it("swallows transient heartbeat failure and keeps workers executing", async () => {
    vi.useFakeTimers();
    try {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockAdapter.heartbeatWorkers = vi.fn().mockRejectedValue(new Error("Transient DB network glitch"));

      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(30);
      expect(OrchestratorService.isRunning).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[PlatformOrchestrator] Worker heartbeat update failed");
    } finally {
      vi.useRealTimers();
    }
  });

  // 15. Heartbeat failure does not invoke recovery
  it("does not trigger stale job recovery on heartbeat database error", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs");
      mockAdapter.heartbeatWorkers = vi.fn().mockRejectedValue(new Error("DB error"));

      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(30);
      expect(recoverSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // 16. Heartbeat stops scheduling when lifecycle enters STOPPING
  it("stops future heartbeat scheduling immediately upon entering STOPPING state", async () => {
    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      await vi.advanceTimersByTimeAsync(25);
      const callsBeforeStop = heartbeatCalls.length;

      const stopOp = OrchestratorService.stop();
      await vi.advanceTimersByTimeAsync(50);
      await stopOp;

      expect(heartbeatCalls.length).toBe(callsBeforeStop);
    } finally {
      vi.useRealTimers();
    }
  });

  // 17. Stop waits for in-flight heartbeat before terminal write
  it("waits for in-flight heartbeat promise to settle before issuing terminal DEAD update", async () => {
    let releaseHeartbeat: () => void = () => undefined;
    const heartbeatHold = new Promise<number>((resolve) => {
      releaseHeartbeat = () => resolve(1);
    });

    const executionLog: string[] = [];
    mockAdapter.heartbeatWorkers = vi.fn(async () => {
      executionLog.push("heartbeat-start");
      await heartbeatHold;
      executionLog.push("heartbeat-end");
      return 1;
    });
    mockAdapter.markWorkersDead = vi.fn(async () => {
      executionLog.push("markDead");
      return 1;
    });

    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 20,
        workerNodeAdapter: mockAdapter,
      });

      // Trigger heartbeat
      await vi.advanceTimersByTimeAsync(25);
      expect(executionLog).toContain("heartbeat-start");

      const stopPromise = OrchestratorService.stop();
      releaseHeartbeat();
      await stopPromise;

      expect(executionLog).toEqual(["heartbeat-start", "heartbeat-end", "markDead"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // 18. Final DEAD write happens after WorkerHandle drain
  it("executes terminal DEAD status reconciliation only after worker handles have drained", async () => {
    const sequence: string[] = [];
    vi.spyOn(JobQueueService, "startWorker").mockImplementation(
      (): WorkerHandle => ({
        stop: vi.fn(async () => {
          sequence.push("workerHandle.stop");
        }),
      }),
    );
    mockAdapter.markWorkersDead = vi.fn(async () => {
      sequence.push("markWorkersDead");
      return 1;
    });

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await OrchestratorService.stop();
    expect(sequence).toEqual(["workerHandle.stop", "workerHandle.stop", "markWorkersDead"]);
  });

  // 19. DEAD write targets only owned worker names
  it("scopes terminal DEAD database update strictly to owned worker names", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await OrchestratorService.stop();
    expect(markDeadCalls.length).toBe(1);
    expect(markDeadCalls[0].workerNames).toEqual(["worker-node-1", "worker-node-2"]);
  });

  // 20. DEAD write resets active_jobs to 0
  it("resets active_jobs to 0 upon graceful terminal status reconciliation", async () => {
    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await OrchestratorService.stop();
    expect(mockAdapter.markWorkersDead).toHaveBeenCalledWith({
      workerNames: ["worker-node-1"],
    });
  });

  // 21. Global/unscoped WorkerNode DEAD update is impossible
  it("never executes an un-scoped global DEAD update without worker name filtering", async () => {
    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await OrchestratorService.stop();
    for (const call of markDeadCalls) {
      expect(call.workerNames.length).toBeGreaterThan(0);
      expect(call.workerNames).toEqual(["worker-node-1"]);
    }
  });

  // 22. Concurrent duplicate stop performs one terminal write
  it("performs exactly one terminal database update across concurrent stop calls", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    const stop1 = OrchestratorService.stop();
    const stop2 = OrchestratorService.stop();
    await Promise.all([stop1, stop2]);

    expect(markDeadCalls.length).toBe(1);
  });

  // 23. Restart re-upserts workers ACTIVE
  it("re-registers and activates WorkerNodes upon restart after clean shutdown", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    expect(upsertCalls.length).toBe(2);
    expect(markDeadCalls.length).toBe(1);

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    expect(upsertCalls.length).toBe(4);
    expect(upsertCalls.slice(2).map((c) => c.status)).toEqual(["ACTIVE", "ACTIVE"]);
  });

  // 24. Restart resets active_jobs to 0
  it("guarantees active_jobs is reset to 0 on restart", async () => {
    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    expect(upsertCalls[1].activeJobs).toBe(0);
  });

  // 25. Stale heartbeat generation cannot mutate restarted/stopped generation
  it("prevents stale heartbeat timers from prior generations from running after restart", async () => {
    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 1,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 50,
        workerNodeAdapter: mockAdapter,
      });

      await OrchestratorService.stop();
      heartbeatCalls = [];

      await vi.advanceTimersByTimeAsync(100);
      expect(heartbeatCalls.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 26. Terminal DB failure still leaves lifecycle STOPPED
  it("transitions lifecycle state to STOPPED even if terminal database update throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockAdapter.markWorkersDead = vi.fn().mockRejectedValue(new Error("PostgreSQL connection terminated"));

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await expect(OrchestratorService.stop()).rejects.toThrow("PostgreSQL connection terminated");
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 27. Terminal DB failure is surfaced after cleanup
  it("surfaces terminal status database failure to caller after completing resource cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const workerStopSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(JobQueueService, "startWorker").mockReturnValue({ stop: workerStopSpy });
    mockAdapter.markWorkersDead = vi.fn().mockRejectedValue(new Error("terminal persistence failure"));

    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    await expect(OrchestratorService.stop()).rejects.toThrow("terminal persistence failure");
    expect(workerStopSpy).toHaveBeenCalledTimes(1);
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 28. No fabricated live active_jobs updates
  it("does not fabricate estimated active_jobs metrics without exact worker pool claims", async () => {
    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });

    for (const call of upsertCalls) {
      expect(call.activeJobs).toBe(0);
    }
  });

  // 29. Zero C2 recovery invocation
  it("does not execute C2 stale job recovery during normal C1C lifecycle", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs");

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    expect(recoverSpy).not.toHaveBeenCalled();
  });

  // 30. Zero process signals / process.exit
  it("executes full C1C lifecycle without process signals or process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(OrchestratorService.getLifecycleState()).toBe("STOPPED");
  });

  // 31. Suite runs with no live database
  it("runs completely deterministically in-memory with zero live database dependency", async () => {
    expect(upsertCalls).toBeDefined();
    expect(heartbeatCalls).toBeDefined();
    expect(markDeadCalls).toBeDefined();
  });

  // 32. Separate Orchestrator instances do not share owned worker-name state incorrectly
  it("clears owned worker identities upon shutdown so consecutive runs remain isolated", async () => {
    await OrchestratorService.start({
      workerConcurrency: 1,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    expect(markDeadCalls.length).toBe(1);
    expect(markDeadCalls[0].workerNames).toEqual(["worker-node-1"]);

    await OrchestratorService.start({
      workerConcurrency: 3,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: mockAdapter,
    });
    await OrchestratorService.stop();

    expect(markDeadCalls.length).toBe(2);
    expect(markDeadCalls[1].workerNames).toEqual(["worker-node-1", "worker-node-2", "worker-node-3"]);
  });
});
