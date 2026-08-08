import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { JobQueueService } from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";

beforeEach(() => {
  vi.spyOn(prisma.workerNode, "upsert").mockResolvedValue({} as never);
  vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 1 });
  vi.spyOn(prisma.workerNode, "update").mockResolvedValue({} as never);
  vi.spyOn(prisma.workerNode, "count").mockResolvedValue(0);
  vi.spyOn(prisma.jobQueue, "findFirst").mockResolvedValue(null);
  vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);
  vi.spyOn(prisma.jobQueue, "create").mockResolvedValue({ id: "mock-job-id" } as never);
  vi.spyOn(prisma.jobQueue, "updateMany").mockResolvedValue({ count: 1 });
  vi.spyOn(prisma.jobQueue, "findUnique").mockResolvedValue(null);
  vi.spyOn(prisma.jobQueue, "count").mockResolvedValue(0);
  vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(null);
  vi.spyOn(prisma.bonus, "update").mockResolvedValue({} as never);

  // Isolate worker execution from live queue polling and scrapers
  vi.spyOn(JobQueueService, "startWorker").mockReturnValue({
    stop: vi.fn(async () => {}),
  });
  vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({ id: "mock-job-id" } as never);
  vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);
});

afterEach(async () => {
  try {
    await OrchestratorService.stop();
  } finally {
    vi.restoreAllMocks();
  }
});

describe("Orchestrator Periodic Stale Job Recovery Lifecycle (Boundary C2C)", () => {
  // 1. Recovery disabled: zero calls & zero timers
  it("creates zero recovery sweeps and zero timers when enableRecovery is false", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: false,
    });

    expect(recoverSpy).not.toHaveBeenCalled();
  });

  // 2–4. Recovery enabled: immediate startup sweep on INGESTION_QUEUE_NAME
  it("executes an immediate startup sweep on the canonical queue when enableRecovery is true", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(2);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 60_000,
    });

    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith(INGESTION_QUEUE_NAME);
  });

  // 5–6. Configured recovery interval is honored and periodic sweep executes
  it("honors configured recoveryIntervalMs and executes periodic recovery sweeps", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 15,
    });

    // Initial sweep ran at startup (1 call)
    expect(recoverSpy).toHaveBeenCalledTimes(1);

    // Wait for at least 2 periodic ticks
    await new Promise((resolve) => setTimeout(resolve, 45));

    expect(recoverSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // 7–8. Non-overlapping recovery execution: slow sweep delays next schedule
  it("ensures recovery sweeps never overlap concurrently and slow sweeps delay next tick", async () => {
    let inFlightSweeps = 0;
    let maxConcurrentSweeps = 0;

    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      inFlightSweeps += 1;
      maxConcurrentSweeps = Math.max(maxConcurrentSweeps, inFlightSweeps);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlightSweeps -= 1;
      return 1;
    });

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(maxConcurrentSweeps).toBe(1);
  });

  // 9. Startup resilience: transient immediate recovery error does not fail start (F2)
  it("proceeds to RUNNING state even if the initial startup recovery sweep fails", async () => {
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockRejectedValueOnce(
      new Error("connection reset by peer"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      OrchestratorService.start({
        enableWorkers: false,
        enableSchedulers: false,
        enableRecovery: true,
        recoveryIntervalMs: 30_000,
      }),
    ).resolves.toBeUndefined();

    expect(OrchestratorService.isRunning).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error in crash recovery loop: Recovery database operation failed (Error)"),
    );
  });

  // 10–11. Periodic failure resilience: does not crash orchestrator and retries later
  it("handles transient periodic recovery errors gracefully and retries on the next tick", async () => {
    let callCount = 0;
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("transient database partition");
      }
      return 0;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 15,
    });

    await new Promise((resolve) => setTimeout(resolve, 55));

    expect(OrchestratorService.isRunning).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error in crash recovery loop: Recovery database operation failed (Error)"),
    );
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  // 12. Security: bounded logging never leaks raw secrets, credentials, or stack traces
  it("logs bounded error classification and never leaks secrets or raw messages", async () => {
    const syntheticSecret = "postgresql://admin:super-secret-password@db.internal:5432/savvy";
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockRejectedValueOnce(
      new Error(`Fatal connection error: ${syntheticSecret}`),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
    });

    expect(warnSpy).toHaveBeenCalled();
    const loggedMessage = warnSpy.mock.calls[0].join(" ");
    expect(loggedMessage).not.toContain(syntheticSecret);
    expect(loggedMessage).not.toContain("super-secret-password");
    expect(loggedMessage).toContain("Recovery database operation failed (Error)");
  });

  // 13–14. Duplicate start protection: sequential and concurrent start calls do not duplicate recovery
  it("prevents duplicate recovery loops upon duplicate or concurrent start calls", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    const config = {
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 60_000,
    };

    await Promise.all([
      OrchestratorService.start(config),
      OrchestratorService.start(config),
    ]);

    // Sequential second call
    await OrchestratorService.start(config);

    // Exactly 1 startup sweep occurred
    expect(recoverSpy).toHaveBeenCalledTimes(1);
  });

  // 15–16. Stop clears pending recovery timer and prevents future scheduling
  it("clears pending recovery timer and stops future scheduling on stop", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 15,
    });

    const callsBeforeStop = recoverSpy.mock.calls.length;
    await OrchestratorService.stop();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(recoverSpy.mock.calls.length).toBe(callsBeforeStop);
  });

  // 17. Stop awaits in-flight recovery sweep
  it("awaits active in-flight recovery sweep before resolving stop", async () => {
    let sweepFinished = false;
    let stopResolved = false;
    let releaseSweep: () => void = () => undefined;

    const sweepPromise = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });

    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      await sweepPromise;
      sweepFinished = true;
      return 1;
    });

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 60_000,
    });

    const stopPromise = OrchestratorService.stop().then(() => {
      stopResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(stopResolved).toBe(false);
    expect(sweepFinished).toBe(false);

    releaseSweep();
    await stopPromise;

    expect(sweepFinished).toBe(true);
    expect(stopResolved).toBe(true);
  });

  // 18–19. Duplicate stop is idempotent and no recovery runs post-stop
  it("ensures duplicate stop is idempotent and no recovery runs after shutdown", async () => {
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 15,
    });

    await Promise.all([
      OrchestratorService.stop(),
      OrchestratorService.stop(),
    ]);

    const count = recoverSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(recoverSpy.mock.calls.length).toBe(count);
  });

  // 20–23. Generation isolation: restart creates one fresh generation and neutralizes old callbacks
  it("isolates recovery generations so stale callbacks from previous runs cannot execute or corrupt new generation state", async () => {
    let activeGenerationSweeps = 0;
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      activeGenerationSweeps += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 0;
    });

    // Run Generation 1
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await OrchestratorService.stop();

    const gen1Count = activeGenerationSweeps;

    // Restart Generation 2
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await OrchestratorService.stop();

    expect(activeGenerationSweeps).toBeGreaterThan(gen1Count);
  });

  // 24. Stop during STARTING drains initial recovery sweep
  it("drains initial recovery sweep properly when stopped during STARTING state", async () => {
    let sweepSettled = false;
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      sweepSettled = true;
      return 1;
    });

    const startPromise = OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
    });

    // Stop while startup is in progress
    await OrchestratorService.stop();
    await startPromise.catch(() => undefined);

    expect(sweepSettled).toBe(true);
    expect(OrchestratorService.isRunning).toBe(false);
  });

  // 25. Startup rollback cleans up recovery timer and in-flight promise
  it("invalidates recovery resources if orchestrator startup fails in another subsystem", async () => {
    vi.spyOn(prisma.workerNode, "upsert").mockRejectedValueOnce(new Error("worker node init failure"));
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await expect(
      OrchestratorService.start({
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: true,
      }),
    ).rejects.toThrow("worker node init failure");

    expect(OrchestratorService.isRunning).toBe(false);
    const countAfterRollback = recoverSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(recoverSpy.mock.calls.length).toBe(countAfterRollback);
  });

  // 26. WorkerNode independence: heartbeat does not trigger or govern JobQueue recovery
  it("keeps WorkerNode heartbeat completely independent from JobQueue recovery", async () => {
    const heartbeatSpy = vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 1 });
    const recoverSpy = vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);

    await OrchestratorService.start({
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false, // Recovery OFF
      heartbeatIntervalMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(heartbeatSpy).toHaveBeenCalled();
    expect(recoverSpy).not.toHaveBeenCalled();
  });

  // 27. Regression: in-flight recovery during stop does not leave recoveryInFlight stuck true on restart
  it("ensures in-flight recovery during stop does not block new recovery generations on restart", async () => {
    let gen1Release: () => void = () => undefined;
    const gen1Hold = new Promise<void>((resolve) => {
      gen1Release = resolve;
    });

    let sweepsExecuted = 0;
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      sweepsExecuted += 1;
      if (sweepsExecuted === 1) {
        // Gen 1 immediate sweep holds until release
        await gen1Hold;
      }
      return 1;
    });

    // Start Generation 1
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    expect(sweepsExecuted).toBe(1);

    // Stop while Generation 1 recovery sweep is in flight
    const stopPromise = OrchestratorService.stop();

    // Release Gen 1 sweep so stop() finishes cleanly
    gen1Release();
    await stopPromise;

    // Start Generation 2: must immediately execute a fresh recovery sweep and resume scheduling
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    // Generation 2 initial sweep executed immediately
    expect(sweepsExecuted).toBeGreaterThanOrEqual(2);

    // Wait for a periodic tick in Generation 2
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(sweepsExecuted).toBeGreaterThanOrEqual(3);

    await OrchestratorService.stop();
  });

  // 28. Regression: failed startup with recovery in flight resets recovery state and leaves future starts working
  it("normalizes recovery state during startup rollback so subsequent starts are not poisoned", async () => {
    let recoverySweepStarted = false;
    let releaseRecovery: () => void = () => undefined;
    const recoveryHold = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });

    let sweepsCount = 0;
    const recoverySpy = vi
      .spyOn(JobQueueService, "recoverStaleJobs")
      .mockImplementation(async () => {
        sweepsCount += 1;
        recoverySweepStarted = true;
        await recoveryHold;
        return 1;
      });

    // Inject a propagating error after recovery loop has been activated
    vi.spyOn(
      OrchestratorService as unknown as { startSchedulers: () => Promise<void> },
      "startSchedulers",
    ).mockRejectedValueOnce(new Error("schedulers initialization crash"));

    const failedStartPromise = OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: true, // will invoke mocked startSchedulers after startRecoveryLoop
      enableRecovery: true,
    });

    // Wait until recovery sweep has started
    while (!recoverySweepStarted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Release recovery hold so rollback can complete
    releaseRecovery();

    await expect(failedStartPromise).rejects.toThrow("schedulers initialization crash");
    expect(OrchestratorService.isRunning).toBe(false);

    // Update existing spy implementation for Generation N+1
    recoverySpy.mockImplementation(async () => {
      sweepsCount += 1;
      return 0;
    });

    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    expect(OrchestratorService.isRunning).toBe(true);
    expect(sweepsCount).toBeGreaterThanOrEqual(2);
    expect(recoverySpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    await OrchestratorService.stop();
  });

  // 29. Regression: stale old-generation callback cannot clear recovery state of a newer generation
  it("preserves generation protection so old generation callbacks cannot clear new generation state", async () => {
    let slowGen1Release: () => void = () => undefined;
    const slowGen1Hold = new Promise<void>((resolve) => {
      slowGen1Release = resolve;
    });

    let gen1Ran = false;
    let gen2Ran = false;

    vi.spyOn(JobQueueService, "recoverStaleJobs").mockImplementation(async () => {
      if (!gen1Ran) {
        gen1Ran = true;
        await slowGen1Hold;
      } else {
        gen2Ran = true;
      }
      return 0;
    });

    // Start Generation 1
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 50,
    });

    // Trigger stop while Gen 1 sweep is held
    const stopPromise = OrchestratorService.stop();
    slowGen1Release();
    await stopPromise;

    // Start Generation 2
    await OrchestratorService.start({
      enableWorkers: false,
      enableSchedulers: false,
      enableRecovery: true,
      recoveryIntervalMs: 10,
    });

    expect(gen2Ran).toBe(true);
    expect(OrchestratorService.isRunning).toBe(true);

    await OrchestratorService.stop();
  });
});
