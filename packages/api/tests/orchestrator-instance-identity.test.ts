import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JobQueueService,
  WorkerHandle,
} from "../src/services/job-queue.service";
import {
  OrchestratorService,
  WorkerNodePersistenceAdapter,
} from "../src/services/orchestrator.service";
import {
  MAX_INSTANCE_ID_LENGTH,
  WORKER_NAME_DELIMITER,
  buildOwnedWorkerNames,
  getOrchestratorInstanceId,
  resetOrchestratorInstanceIdCache,
  resolveOrchestratorInstanceId,
  sanitizeInstanceId,
} from "../src/utils/orchestrator-instance";

interface WorkerRow {
  status: string;
  activeJobs: number;
  lastHeartbeat: Date;
}

/**
 * In-memory WorkerNode store mirroring the exact predicates of
 * `defaultWorkerNodePersistence`:
 *  - upsert by unique worker_name
 *  - heartbeat: updateMany WHERE worker_name IN (...) AND status = 'ACTIVE'
 *  - markDead:  updateMany WHERE worker_name IN (...)
 *
 * The production race is entirely a consequence of those predicates meeting
 * colliding identities, so the store reproduces them rather than the ORM.
 */
function createWorkerNodeStore() {
  const rows = new Map<string, WorkerRow>();

  const adapter: WorkerNodePersistenceAdapter = {
    async upsertWorker({ workerName, status, activeJobs, lastHeartbeat }) {
      rows.set(workerName, { status, activeJobs, lastHeartbeat });
    },
    async heartbeatWorkers({ workerNames, now }) {
      let count = 0;
      for (const workerName of workerNames) {
        const row = rows.get(workerName);
        if (row && row.status === "ACTIVE") {
          row.lastHeartbeat = now;
          count += 1;
        }
      }
      return count;
    },
    async markWorkersDead({ workerNames }) {
      let count = 0;
      for (const workerName of workerNames) {
        const row = rows.get(workerName);
        if (row) {
          row.status = "DEAD";
          row.activeJobs = 0;
          count += 1;
        }
      }
      return count;
    },
    async countActiveWorkers() {
      return [...rows.values()].filter((row) => row.status === "ACTIVE").length;
    },
  };

  return {
    adapter,
    rows,
    statusesOf: (workerNames: string[]) =>
      workerNames.map((name) => rows.get(name)?.status ?? "MISSING"),
    /** Simulates another orchestrator process running initializeWorkers(). */
    registerForeignInstance: async (workerNames: string[], at: Date) => {
      for (const workerName of workerNames) {
        await adapter.upsertWorker({
          workerName,
          status: "ACTIVE",
          activeJobs: 0,
          lastHeartbeat: at,
        });
      }
    },
  };
}

describe("Orchestrator instance identity", () => {
  afterEach(() => {
    resetOrchestratorInstanceIdCache();
  });

  // 1. Two orchestrator instances cannot generate the same worker identities.
  it("resolves a distinct instance id per process when no runtime identity exists", () => {
    const resolved = Array.from({ length: 200 }, () =>
      resolveOrchestratorInstanceId({} as NodeJS.ProcessEnv),
    );

    expect(new Set(resolved).size).toBe(resolved.length);
  });

  it("produces disjoint worker identities for two different instances", () => {
    const instanceA = resolveOrchestratorInstanceId({} as NodeJS.ProcessEnv);
    const instanceB = resolveOrchestratorInstanceId({} as NodeJS.ProcessEnv);

    const namesA = buildOwnedWorkerNames(instanceA, 4);
    const namesB = buildOwnedWorkerNames(instanceB, 4);

    expect(instanceA).not.toBe(instanceB);
    expect(namesA).toHaveLength(4);
    expect(namesB).toHaveLength(4);
    expect(namesA.filter((name) => namesB.includes(name))).toEqual([]);
  });

  it("lets the Railway replica identity win over a configured override", () => {
    expect(
      resolveOrchestratorInstanceId({
        ORCHESTRATOR_INSTANCE_ID: "pinned-scope",
        RAILWAY_REPLICA_ID: "replica-xyz",
      } as NodeJS.ProcessEnv),
    ).toBe("replica-xyz");
  });

  /**
   * A static ORCHESTRATOR_INSTANCE_ID set at Railway service/environment scope
   * is inherited by every replica and by both sides of a rolling deploy. If it
   * outranked the replica id it would recreate the original collision, so the
   * per-replica identity must remain authoritative.
   */
  it("keeps two Railway replicas disjoint even under one shared configured override", () => {
    const replicaOne = resolveOrchestratorInstanceId({
      ORCHESTRATOR_INSTANCE_ID: "savvyedge-orchestrator",
      RAILWAY_REPLICA_ID: "replica-one",
    } as NodeJS.ProcessEnv);
    const replicaTwo = resolveOrchestratorInstanceId({
      ORCHESTRATOR_INSTANCE_ID: "savvyedge-orchestrator",
      RAILWAY_REPLICA_ID: "replica-two",
    } as NodeJS.ProcessEnv);

    expect(replicaOne).not.toBe(replicaTwo);

    const namesOne = buildOwnedWorkerNames(replicaOne, 4);
    const namesTwo = buildOwnedWorkerNames(replicaTwo, 4);
    expect(namesOne.filter((name) => namesTwo.includes(name))).toEqual([]);
  });

  it("uses an explicit override only where no per-replica identity exists", () => {
    expect(
      resolveOrchestratorInstanceId({
        ORCHESTRATOR_INSTANCE_ID: "pinned-scope",
      } as NodeJS.ProcessEnv),
    ).toBe("pinned-scope");

    // A blank/whitespace replica id is not a valid identity and must not shadow
    // the override.
    expect(
      resolveOrchestratorInstanceId({
        ORCHESTRATOR_INSTANCE_ID: "pinned-scope",
        RAILWAY_REPLICA_ID: "   ",
      } as NodeJS.ProcessEnv),
    ).toBe("pinned-scope");
  });

  it("never derives identity from the deployment id, which every replica shares", () => {
    const resolved = resolveOrchestratorInstanceId({
      RAILWAY_DEPLOYMENT_ID: "deployment-shared-by-all-replicas",
    } as NodeJS.ProcessEnv);

    expect(resolved).not.toContain("deployment-shared-by-all-replicas");

    // Two replicas of one deployment must still not collide.
    const second = resolveOrchestratorInstanceId({
      RAILWAY_DEPLOYMENT_ID: "deployment-shared-by-all-replicas",
    } as NodeJS.ProcessEnv);
    expect(resolved).not.toBe(second);
  });

  it("keeps instance ids bounded and free of the worker-name delimiter", () => {
    const hostile = `${"x".repeat(200)}${WORKER_NAME_DELIMITER}worker-node-1`;
    const sanitized = sanitizeInstanceId(hostile);

    expect(sanitized.length).toBeLessThanOrEqual(MAX_INSTANCE_ID_LENGTH);
    expect(sanitized).not.toContain(WORKER_NAME_DELIMITER);
    expect(sanitizeInstanceId("  spaced/slashes:colons  ")).toBe(
      "spaced-slashes-colons",
    );
  });

  it("memoizes the random fallback identity for the lifetime of the process", () => {
    resetOrchestratorInstanceIdCache();
    const first = getOrchestratorInstanceId({} as NodeJS.ProcessEnv);
    const second = getOrchestratorInstanceId({} as NodeJS.ProcessEnv);
    const third = getOrchestratorInstanceId({} as NodeJS.ProcessEnv);

    expect(second).toBe(first);
    expect(third).toBe(first);
    // Stable even if a runtime identity appears later in the process lifetime,
    // so start/heartbeat/stop can never disagree about ownership.
    expect(
      getOrchestratorInstanceId({
        RAILWAY_REPLICA_ID: "late-replica",
      } as NodeJS.ProcessEnv),
    ).toBe(first);
  });

  // 6. Worker concurrency count semantics remain correct.
  it("still yields exactly workerConcurrency slots numbered 1..N", () => {
    expect(buildOwnedWorkerNames("scope", 4)).toEqual([
      "scope:worker-node-1",
      "scope:worker-node-2",
      "scope:worker-node-3",
      "scope:worker-node-4",
    ]);
    expect(buildOwnedWorkerNames("scope", 1)).toHaveLength(1);
    expect(buildOwnedWorkerNames("scope", 0)).toEqual([]);
  });
});

describe("Railway rolling deployment overlap (worker identity collision regression)", () => {
  const OLD_INSTANCE = "deploy-old";
  const NEW_INSTANCE = "deploy-new";
  let store: ReturnType<typeof createWorkerNodeStore>;

  beforeEach(() => {
    store = createWorkerNodeStore();
    vi.spyOn(JobQueueService, "startWorker").mockImplementation(
      (): WorkerHandle => ({
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    );
    vi.spyOn(JobQueueService, "recoverStaleJobs").mockResolvedValue(0);
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({
      id: "mock-job-id",
    } as never);
  });

  afterEach(async () => {
    try {
      await OrchestratorService.stop();
    } finally {
      vi.restoreAllMocks();
    }
  });

  // 2 & 3. Instance A shutdown marks only A's rows DEAD; B's rows stay ACTIVE.
  it("lets a terminating deployment mark only its own worker rows DEAD", async () => {
    const oldNames = buildOwnedWorkerNames(OLD_INSTANCE, 4);
    const newNames = buildOwnedWorkerNames(NEW_INSTANCE, 4);

    // OLD deployment is running.
    await OrchestratorService.start({
      workerConcurrency: 4,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: store.adapter,
      instanceId: OLD_INSTANCE,
    });
    expect(store.statusesOf(oldNames)).toEqual([
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
    ]);

    // NEW deployment boots and registers its own workers (rolling overlap).
    await store.registerForeignInstance(newNames, new Date());

    // OLD deployment receives SIGTERM and shuts down gracefully.
    await OrchestratorService.stop();

    expect(store.statusesOf(oldNames)).toEqual(["DEAD", "DEAD", "DEAD", "DEAD"]);
    expect(store.statusesOf(newNames)).toEqual([
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
      "ACTIVE",
    ]);
  });

  // 4. Heartbeat for B keeps matching rows after A's shutdown.
  it("keeps the replacement deployment's heartbeat effective after the old one stops", async () => {
    const oldNames = buildOwnedWorkerNames(OLD_INSTANCE, 4);
    const newNames = buildOwnedWorkerNames(NEW_INSTANCE, 4);
    const bootedAt = new Date("2026-08-19T08:49:17.274Z");

    await OrchestratorService.start({
      workerConcurrency: 4,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: store.adapter,
      instanceId: OLD_INSTANCE,
    });
    await store.registerForeignInstance(newNames, bootedAt);
    await OrchestratorService.stop();

    // The exact operation that returned 0 rows in production.
    const beat = new Date("2026-08-19T08:49:22.000Z");
    const updated = await store.adapter.heartbeatWorkers({
      workerNames: newNames,
      now: beat,
    });

    expect(updated).toBe(4);
    for (const name of newNames) {
      expect(store.rows.get(name)?.lastHeartbeat).toEqual(beat);
    }
    expect(store.statusesOf(oldNames)).toEqual(["DEAD", "DEAD", "DEAD", "DEAD"]);
  });

  it("drives a live heartbeat loop for the replacement deployment after the old one stopped", async () => {
    const newNames = buildOwnedWorkerNames(NEW_INSTANCE, 2);

    await OrchestratorService.start({
      workerConcurrency: 2,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: store.adapter,
      instanceId: OLD_INSTANCE,
    });
    await store.registerForeignInstance(newNames, new Date(0));
    await OrchestratorService.stop();

    vi.useFakeTimers();
    try {
      await OrchestratorService.start({
        workerConcurrency: 2,
        enableWorkers: true,
        enableSchedulers: false,
        enableRecovery: false,
        heartbeatIntervalMs: 50,
        workerNodeAdapter: store.adapter,
        instanceId: NEW_INSTANCE,
      });

      await vi.advanceTimersByTimeAsync(60);

      expect(store.statusesOf(newNames)).toEqual(["ACTIVE", "ACTIVE"]);
      for (const name of newNames) {
        expect(store.rows.get(name)?.lastHeartbeat.getTime()).toBeGreaterThan(0);
      }
      expect(OrchestratorService.getInstanceId()).toBe(NEW_INSTANCE);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Guards the guard: with the previous globally fixed identities the very same
   * sequence silently killed the replacement deployment. If this ever stops
   * failing, the regression tests above would be passing vacuously.
   */
  it("demonstrates the collision the old global worker-node-N identities caused", async () => {
    const sharedNames = ["worker-node-1", "worker-node-2"];
    const bootedAt = new Date("2026-08-19T08:49:17.274Z");

    // NEW deployment registers the globally fixed names as ACTIVE.
    await store.registerForeignInstance(sharedNames, bootedAt);

    // OLD deployment shuts down and marks the *same* names DEAD.
    await store.adapter.markWorkersDead({ workerNames: sharedNames });

    // NEW deployment's heartbeat now matches nothing: it is DEAD forever.
    const updated = await store.adapter.heartbeatWorkers({
      workerNames: sharedNames,
      now: new Date("2026-08-19T08:49:22.000Z"),
    });

    expect(updated).toBe(0);
    expect(store.statusesOf(sharedNames)).toEqual(["DEAD", "DEAD"]);
  });

  // 6. Worker concurrency semantics through the real lifecycle.
  it("registers and drives exactly workerConcurrency scoped workers", async () => {
    const startWorkerSpy = vi.spyOn(JobQueueService, "startWorker");

    await OrchestratorService.start({
      workerConcurrency: 3,
      enableWorkers: true,
      enableSchedulers: false,
      enableRecovery: false,
      workerNodeAdapter: store.adapter,
      instanceId: NEW_INSTANCE,
    });

    expect(startWorkerSpy).toHaveBeenCalledTimes(3);
    expect(
      startWorkerSpy.mock.calls.map((call) => call[3]?.workerId),
    ).toEqual(buildOwnedWorkerNames(NEW_INSTANCE, 3));
    expect(await store.adapter.countActiveWorkers?.()).toBe(3);
  });
});
