import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { JobQueueService } from "../src/services/job-queue.service";
import { OrchestratorService } from "../src/services/orchestrator.service";

const DISCOVERY_INTERVAL_MS = 60_000;
const VERIFICATION_INTERVAL_MS = 900_000;
const SEEDS = ["https://operator.example.test/bonuses"];

describe("D4B1 independent scheduler capabilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({
      id: "job-1",
    } as never);
    vi.spyOn(
      OrchestratorService,
      "runBonusReverificationSweep",
    ).mockResolvedValue({
      enqueued: 0,
      skipped: [],
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await OrchestratorService.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function startSchedulers(config: {
    enableSchedulers?: boolean;
    enableDiscoveryScheduler?: boolean;
    enableBonusReverificationScheduler?: boolean;
  }) {
    await OrchestratorService.start({
      enableWorkers: false,
      enableRecovery: false,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
      verificationIntervalMs: VERIFICATION_INTERVAL_MS,
      seedSources: SEEDS,
      ...config,
    });
  }

  it("runs immediate and periodic D3C while discovery is disabled", async () => {
    await startSchedulers({
      enableSchedulers: false,
      enableDiscoveryScheduler: false,
      enableBonusReverificationScheduler: true,
    });

    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      VERIFICATION_INTERVAL_MS - DISCOVERY_INTERVAL_MS,
    );
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).toHaveBeenCalledTimes(2);
  });

  it("runs immediate and periodic discovery while D3C is disabled", async () => {
    await startSchedulers({
      enableSchedulers: false,
      enableDiscoveryScheduler: true,
      enableBonusReverificationScheduler: false,
    });

    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(2);
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).not.toHaveBeenCalled();
  });

  it("runs both independently enabled schedulers", async () => {
    await startSchedulers({
      enableSchedulers: false,
      enableDiscoveryScheduler: true,
      enableBonusReverificationScheduler: true,
    });

    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(VERIFICATION_INTERVAL_MS);
    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(
      1 + VERIFICATION_INTERVAL_MS / DISCOVERY_INTERVAL_MS,
    );
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).toHaveBeenCalledTimes(2);
  });

  it("starts no scheduler when both capabilities are disabled", async () => {
    await startSchedulers({
      enableSchedulers: true,
      enableDiscoveryScheduler: false,
      enableBonusReverificationScheduler: false,
    });

    await vi.advanceTimersByTimeAsync(VERIFICATION_INTERVAL_MS);
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).not.toHaveBeenCalled();
  });

  it("keeps the legacy scheduler master enabled behavior", async () => {
    await startSchedulers({ enableSchedulers: true });

    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy scheduler master disabled behavior", async () => {
    await startSchedulers({ enableSchedulers: false });

    await vi.advanceTimersByTimeAsync(VERIFICATION_INTERVAL_MS);
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
    expect(
      OrchestratorService.runBonusReverificationSweep,
    ).not.toHaveBeenCalled();
  });
});
