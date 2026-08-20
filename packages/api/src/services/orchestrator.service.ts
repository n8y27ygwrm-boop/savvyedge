import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import type {
  IngestionJobPayloadMap,
  IngestionQueueHandlers,
} from "../contracts/ingestion-queue.contract";
import { JobQueueService } from "./job-queue.service";
import {
  buildOwnedWorkerNames,
  getOrchestratorInstanceId,
} from "../utils/orchestrator-instance";
import { DiscoveryService } from "./discovery.service";
import { IngestionService } from "./ingestion.service";
import { BonusService } from "./bonus.service";
import {
  BonusReverificationService,
  type ReverificationOverrides,
} from "./bonus-reverification.service";

export const BONUS_REVERIFICATION_AGE_MS = 60 * 60 * 60 * 1000;
export const BONUS_REVERIFICATION_COOLDOWN_MS = 60 * 60 * 1000;
export const BONUS_REVERIFICATION_BATCH_SIZE = 100;
export const DEFAULT_BONUS_REVERIFICATION_INTERVAL_MS = 15 * 60 * 1000;

export interface BonusReverificationSweepResult {
  enqueued: number;
  skipped: Array<{
    bonusId: string;
    reason:
      | "NO_AUTHORITATIVE_SOURCE_URL"
      | "SOURCE_IDENTITY_MISMATCH"
      | "ENQUEUE_FAILED";
  }>;
}

export interface WorkerNodePersistenceAdapter {
  upsertWorker(params: {
    workerName: string;
    status: string;
    activeJobs: number;
    lastHeartbeat: Date;
  }): Promise<void>;
  heartbeatWorkers(params: {
    workerNames: string[];
    now: Date;
  }): Promise<number>;
  markWorkersDead(params: {
    workerNames: string[];
  }): Promise<number>;
  countActiveWorkers?(): Promise<number>;
}

export const defaultWorkerNodePersistence: WorkerNodePersistenceAdapter = {
  async upsertWorker({ workerName, status, activeJobs, lastHeartbeat }) {
    await prisma.workerNode.upsert({
      where: { worker_name: workerName },
      update: {
        status,
        active_jobs: activeJobs,
        last_heartbeat: lastHeartbeat,
      },
      create: {
        worker_name: workerName,
        status,
        active_jobs: activeJobs,
        last_heartbeat: lastHeartbeat,
      },
    });
  },
  async heartbeatWorkers({ workerNames, now }) {
    const result = await prisma.workerNode.updateMany({
      where: {
        worker_name: { in: workerNames },
        status: "ACTIVE",
      },
      data: {
        last_heartbeat: now,
      },
    });
    return result.count;
  },
  async markWorkersDead({ workerNames }) {
    const result = await prisma.workerNode.updateMany({
      where: {
        worker_name: { in: workerNames },
      },
      data: {
        status: "DEAD",
        active_jobs: 0,
      },
    });
    return result.count;
  },
  async countActiveWorkers() {
    return prisma.workerNode.count({ where: { status: "ACTIVE" } });
  },
};

export interface OrchestratorConfig {
  discoveryIntervalMs: number;
  crawlIntervalMs: number;
  extractionIntervalMs: number;
  verificationIntervalMs: number;
  workerConcurrency: number;
  maxConcurrentPerDomain: number;
  minDomainDelayMs: number;
  seedSources: string[];
  enableWorkers?: boolean;
  enableSchedulers?: boolean;
  enableDiscoveryScheduler?: boolean;
  enableBonusReverificationScheduler?: boolean;
  enableRecovery?: boolean;
  workerPollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  recoveryIntervalMs?: number;
  workerNodeAdapter?: WorkerNodePersistenceAdapter;
  /**
   * Instance-scoping prefix for this process's owned WorkerNode identities.
   * Defaults to the per-process orchestrator instance id; overridable so
   * operators (and tests) can pin an explicit ownership scope.
   */
  instanceId?: string;
}

export type OrchestratorLifecycleState = "STOPPED" | "STARTING" | "RUNNING" | "STOPPING";

export class OrchestratorService {
  private static lifecycleState: OrchestratorLifecycleState = "STOPPED";
  private static startPromise: Promise<void> | null = null;
  private static stopPromise: Promise<void> | null = null;
  private static schedulerTimers: NodeJS.Timeout[] = [];
  private static workerHandles: Array<{
    id: string;
    stop: () => Promise<void>;
  }> = [];
  private static heartbeatTimer?: NodeJS.Timeout;
  private static recoveryTimer?: NodeJS.Timeout;
  private static recoveryInFlight = false;
  private static currentRecoveryPromise: Promise<void> | null = null;
  private static recoveryGeneration = 0;
  private static workerNodeAdapter: WorkerNodePersistenceAdapter = defaultWorkerNodePersistence;
  private static ownedWorkerNames: string[] = [];
  private static instanceId: string | null = null;
  private static heartbeatInFlight = false;
  private static currentHeartbeatPromise: Promise<void> | null = null;
  private static verificationSweepInFlight = false;
  private static currentVerificationSweepPromise: Promise<void> | null = null;

  public static get isRunning(): boolean {
    return this.lifecycleState === "RUNNING";
  }

  public static getLifecycleState(): OrchestratorLifecycleState {
    return this.lifecycleState;
  }

  /**
   * The instance scope that owns the currently registered WorkerNode rows,
   * or null while stopped. Exposed for observability and ownership assertions.
   */
  public static getInstanceId(): string | null {
    return this.instanceId;
  }

  // Domain rate limiting state
  private static domainActiveCount = new Map<string, number>();
  private static domainLastAccess = new Map<string, number>();

  private static getConfig(): Required<OrchestratorConfig> {
    return {
      discoveryIntervalMs: parseInt(process.env.DISCOVERY_INTERVAL_MS || "300000", 10),
      crawlIntervalMs: parseInt(process.env.CRAWL_INTERVAL_MS || "60000", 10),
      extractionIntervalMs: parseInt(process.env.EXTRACTION_INTERVAL_MS || "30000", 10),
      verificationIntervalMs: parseInt(
        process.env.VERIFICATION_INTERVAL_MS ||
          String(DEFAULT_BONUS_REVERIFICATION_INTERVAL_MS),
        10,
      ),
      workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || "4", 10),
      maxConcurrentPerDomain: parseInt(process.env.DEFAULT_MAX_CONCURRENT_PER_DOMAIN || "2", 10),
      minDomainDelayMs: parseInt(process.env.DEFAULT_MIN_DOMAIN_DELAY_MS || "1000", 10),
      seedSources: (
        process.env.SEED_SOURCES ||
        "https://www.askgamblers.com/online-casinos/bonuses/,https://www.casinos.com/us/bonuses,https://www.gambling.com/us/online-casinos/bonuses"
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      enableWorkers: true,
      enableSchedulers: true,
      enableDiscoveryScheduler: true,
      enableBonusReverificationScheduler: true,
      enableRecovery: true,
      workerPollIntervalMs: 500,
      heartbeatIntervalMs: 5000,
      recoveryIntervalMs: 30000,
      workerNodeAdapter: defaultWorkerNodePersistence,
      instanceId: getOrchestratorInstanceId(),
    };
  }

  /**
   * Starts the continuous Platform Orchestrator
   */
  public static async start(customConfig?: Partial<OrchestratorConfig>): Promise<void> {
    while (this.lifecycleState === "STOPPING" && this.stopPromise) {
      try {
        await this.stopPromise;
      } catch {
        // Wait for active stop to settle
      }
    }

    if (this.lifecycleState === "RUNNING") {
      console.log("[PlatformOrchestrator] Orchestrator is already running.");
      return;
    }

    if (this.lifecycleState === "STARTING" && this.startPromise) {
      return this.startPromise;
    }

    this.lifecycleState = "STARTING";
    const generation = ++this.recoveryGeneration;

    this.startPromise = (async () => {
      try {
        const defaultConfig = this.getConfig();
        const masterSchedulersEnabled =
          customConfig?.enableSchedulers ?? defaultConfig.enableSchedulers;
        const config: Required<OrchestratorConfig> = {
          ...defaultConfig,
          ...customConfig,
          enableDiscoveryScheduler:
            customConfig?.enableDiscoveryScheduler ?? masterSchedulersEnabled,
          enableBonusReverificationScheduler:
            customConfig?.enableBonusReverificationScheduler ??
            masterSchedulersEnabled,
        };
        this.workerNodeAdapter = config.workerNodeAdapter ?? defaultWorkerNodePersistence;

        console.log("=================================================");
        console.log("    SAVVYEDGE PLATFORM ORCHESTRATOR STARTING     ");
        console.log(` -> Instance ID:        ${config.instanceId}`);
        console.log(` -> Worker Concurrency: ${config.workerConcurrency}`);
        console.log(` -> Discovery Interval: ${config.discoveryIntervalMs} ms`);
        console.log(` -> Verification Int.: ${config.verificationIntervalMs} ms`);
        console.log(` -> Crawl Interval:     ${config.crawlIntervalMs} ms`);
        console.log(` -> Max Domain Concur:  ${config.maxConcurrentPerDomain}`);
        console.log(` -> Workers Enabled:    ${config.enableWorkers}`);
        console.log(` -> Scheduler Master:   ${config.enableSchedulers}`);
        console.log(
          ` -> Discovery Sched.:   ${config.enableDiscoveryScheduler}`,
        );
        console.log(
          ` -> Bonus Reverify:     ${config.enableBonusReverificationScheduler}`,
        );
        console.log(` -> Recovery Enabled:   ${config.enableRecovery}`);
        console.log("=================================================");

        // Worker identities are instance-scoped: two overlapping orchestrator
        // processes must never own the same persisted WorkerNode rows, so a
        // terminating deployment can only ever mark its own workers DEAD.
        const instanceId = config.instanceId || getOrchestratorInstanceId();
        const ownedWorkerNames = buildOwnedWorkerNames(
          instanceId,
          config.workerConcurrency,
        );
        this.instanceId = instanceId;
        this.ownedWorkerNames = ownedWorkerNames;

        // 1. Initialize Workers in Database (Fail-Closed)
        if (config.enableWorkers) {
          await this.initializeWorkers(ownedWorkerNames);
          this.startHeartbeatLoop(ownedWorkerNames, config.heartbeatIntervalMs);
        }

        // 2. Register Queue Handlers
        const handlers = this.getQueueHandlers(config.seedSources);

        // 3. Spawn Worker Loops
        const domainLimiter = {
          checkDomainAllowed: (domain: string) =>
            this.checkDomainAllowed(domain, config),
          recordDomainAccess: (domain: string) => this.recordDomainAccess(domain),
        };

        if (config.enableWorkers) {
          for (const workerId of ownedWorkerNames) {
            const handle = JobQueueService.startWorker(
              INGESTION_QUEUE_NAME,
              handlers,
              config.workerPollIntervalMs,
              {
                workerId,
                domainLimiter,
              },
            );
            this.workerHandles.push({ id: workerId, stop: () => handle.stop() });
          }
        }

        // 4. Initialize Recovery Loop (if enabled)
        if (config.enableRecovery) {
          this.startRecoveryLoop(config, generation);
        }

        // 5. Initialize Recurring Schedulers
        if (
          config.enableDiscoveryScheduler ||
          config.enableBonusReverificationScheduler
        ) {
          await this.startSchedulers(config, generation);
        }

        this.lifecycleState = "RUNNING";
      } catch (error) {
        this.lifecycleState = "STOPPING";
        this.recoveryGeneration += 1;
        this.schedulerTimers.forEach((t) => clearInterval(t));
        this.schedulerTimers = [];
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = undefined;
        }
        if (this.recoveryTimer !== undefined) {
          clearTimeout(this.recoveryTimer);
          this.recoveryTimer = undefined;
        }
        if (this.currentRecoveryPromise) {
          try {
            await this.currentRecoveryPromise;
          } catch {
            // Drain recovery
          }
        }
        this.recoveryInFlight = false;
        this.currentRecoveryPromise = null;
        this.recoveryTimer = undefined;
        if (this.currentVerificationSweepPromise) {
          try {
            await this.currentVerificationSweepPromise;
          } catch {
            // Verification sweep failures are contained by the scheduler
          }
        }
        this.verificationSweepInFlight = false;
        this.currentVerificationSweepPromise = null;

        const stops = this.workerHandles.map((w) => w.stop());
        this.workerHandles = [];
        await Promise.allSettled(stops);
        this.lifecycleState = "STOPPED";
        this.ownedWorkerNames = [];
        this.instanceId = null;
        this.workerNodeAdapter = defaultWorkerNodePersistence;
        throw error;
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  /**
   * Domain rate limiting check: enforces max concurrent requests and min delay between requests
   */
  private static checkDomainAllowed(domain: string, config: OrchestratorConfig): boolean {
    const active = this.domainActiveCount.get(domain) || 0;
    if (active >= config.maxConcurrentPerDomain) {
      return false;
    }

    const lastAccess = this.domainLastAccess.get(domain) || 0;
    const now = Date.now();
    if (now - lastAccess < config.minDomainDelayMs) {
      return false;
    }

    return true;
  }

  private static recordDomainAccess(domain: string) {
    const currentActive = this.domainActiveCount.get(domain) || 0;
    this.domainActiveCount.set(domain, currentActive + 1);
    this.domainLastAccess.set(domain, Date.now());

    // Automatically decrement after processing delay window
    setTimeout(() => {
      const updated = Math.max(0, (this.domainActiveCount.get(domain) || 1) - 1);
      this.domainActiveCount.set(domain, updated);
    }, 1000);
  }

  /**
   * Initializes WorkerNode table records
   */
  private static async initializeWorkers(workerNames: string[]) {
    const now = new Date();
    for (const workerName of workerNames) {
      await this.workerNodeAdapter.upsertWorker({
        workerName,
        status: "ACTIVE",
        activeJobs: 0,
        lastHeartbeat: now,
      });
    }
  }

  private static startHeartbeatLoop(workerNames: string[], intervalMs: number = 5000) {
    this.heartbeatTimer = setInterval(() => {
      if (this.lifecycleState !== "RUNNING" || this.heartbeatInFlight) {
        return;
      }

      this.heartbeatInFlight = true;
      this.currentHeartbeatPromise = (async () => {
        try {
          if (this.lifecycleState !== "RUNNING") return;
          await this.workerNodeAdapter.heartbeatWorkers({
            workerNames,
            now: new Date(),
          });
        } catch {
          console.error("[PlatformOrchestrator] Worker heartbeat update failed");
        } finally {
          this.heartbeatInFlight = false;
          this.currentHeartbeatPromise = null;
        }
      })();
    }, intervalMs);
  }

  private static startRecoveryLoop(
    config: Required<OrchestratorConfig>,
    generation: number,
  ) {
    const intervalMs =
      config.recoveryIntervalMs && config.recoveryIntervalMs > 0
        ? config.recoveryIntervalMs
        : 30000;

    const executeSweep = async () => {
      if (
        generation !== this.recoveryGeneration ||
        this.recoveryInFlight ||
        (this.lifecycleState !== "RUNNING" && this.lifecycleState !== "STARTING")
      ) {
        return;
      }

      this.recoveryInFlight = true;
      this.currentRecoveryPromise = (async () => {
        try {
          if (
            generation !== this.recoveryGeneration ||
            (this.lifecycleState !== "RUNNING" && this.lifecycleState !== "STARTING")
          ) {
            return;
          }
          await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);
        } catch (err: unknown) {
          const errorClassification =
            err instanceof Error
              ? `Recovery database operation failed (${err.name || "Error"})`
              : "Recovery database operation failed";
          console.warn(
            `[PlatformOrchestrator] Error in crash recovery loop: ${errorClassification}`,
          );
        } finally {
          if (generation === this.recoveryGeneration) {
            this.recoveryInFlight = false;
            this.currentRecoveryPromise = null;
          }
        }
      })();

      await this.currentRecoveryPromise;

      if (
        generation === this.recoveryGeneration &&
        (this.lifecycleState === "RUNNING" || this.lifecycleState === "STARTING")
      ) {
        this.recoveryTimer = setTimeout(scheduleSweep, intervalMs);
      }
    };

    const scheduleSweep = () => {
      if (
        generation !== this.recoveryGeneration ||
        this.lifecycleState !== "RUNNING"
      ) {
        return;
      }
      this.recoveryTimer = undefined;
      executeSweep();
    };

    executeSweep();
  }

  /**
   * Starts independently enabled recurring schedulers.
   *
   * Production v1 supports exactly one scheduler-enabled process. Multiple
   * scheduler replicas require persisted/atomic coordination in a later phase.
   */
  private static async startSchedulers(
    config: Required<OrchestratorConfig>,
    generation: number,
  ) {
    if (config.enableDiscoveryScheduler) {
      const discoveryTimer = setInterval(async () => {
        if (!this.isRunning) return;
        console.log(
          "[PlatformOrchestrator] [Scheduler] Enqueueing periodic DISCOVER_SEEDS job...",
        );
        await JobQueueService.enqueue(
          INGESTION_QUEUE_NAME,
          "DISCOVER_SEEDS",
          { seedUrls: config.seedSources },
          { priority: "HIGH", deduplicate: true },
        );
      }, config.discoveryIntervalMs);

      this.schedulerTimers.push(discoveryTimer);

      // Initial immediate discovery run
      try {
        await JobQueueService.enqueue(
          INGESTION_QUEUE_NAME,
          "DISCOVER_SEEDS",
          { seedUrls: config.seedSources },
          { priority: "HIGH", deduplicate: true },
        );
      } catch (error) {
        console.error(
          "[PlatformOrchestrator] Failed initial discovery enqueue:",
          error,
        );
      }
    }

    if (config.enableBonusReverificationScheduler) {
      const verificationTimer = setInterval(() => {
        void this.runScheduledBonusReverificationSweep(generation);
      }, config.verificationIntervalMs);

      this.schedulerTimers.push(verificationTimer);

      // Initial immediate re-verification sweep. Errors are contained so a
      // transient database failure cannot prevent the orchestrator from starting.
      await this.runScheduledBonusReverificationSweep(generation);
    }
  }

  private static runScheduledBonusReverificationSweep(
    generation: number,
  ): Promise<void> {
    // D3C v1 assumes one orchestrator scheduler process. Multiple scheduler
    // replicas require persisted/atomic subject coordination before enablement.
    if (
      generation !== this.recoveryGeneration ||
      this.verificationSweepInFlight ||
      (this.lifecycleState !== "RUNNING" && this.lifecycleState !== "STARTING")
    ) {
      return Promise.resolve();
    }

    this.verificationSweepInFlight = true;
    const sweepPromise = (async () => {
      try {
        if (
          generation !== this.recoveryGeneration ||
          (this.lifecycleState !== "RUNNING" && this.lifecycleState !== "STARTING")
        ) {
          return;
        }
        await this.runBonusReverificationSweep(new Date());
      } catch (error) {
        const errorClassification =
          error instanceof Error
            ? `Bonus re-verification sweep failed (${error.name || "Error"})`
            : "Bonus re-verification sweep failed";
        console.warn(
          `[PlatformOrchestrator] [Scheduler] ${errorClassification}`,
        );
      }
    })();
    this.currentVerificationSweepPromise = sweepPromise;
    void sweepPromise.then(() => {
      if (this.currentVerificationSweepPromise === sweepPromise) {
        this.verificationSweepInFlight = false;
        this.currentVerificationSweepPromise = null;
      }
    });
    return sweepPromise;
  }

  /**
   * Selects published Bonuses approaching the freshness limit and enqueues the
   * canonical true source re-verification path. This method is selection-only:
   * it never writes Bonus state.
   */
  public static async runBonusReverificationSweep(
    now: Date = new Date(),
  ): Promise<BonusReverificationSweepResult> {
    const cutoff = new Date(now.getTime() - BONUS_REVERIFICATION_AGE_MS);
    const cooldownCutoff = new Date(
      now.getTime() - BONUS_REVERIFICATION_COOLDOWN_MS,
    );

    const relevantJobs = await prisma.jobQueue.findMany({
      where: {
        queue_name: INGESTION_QUEUE_NAME,
        task_type: "VALIDATE_BONUS",
        OR: [
          { status: { in: ["PENDING", "PROCESSING"] } },
          {
            status: "COMPLETED",
            OR: [
              { completed_at: { gte: cooldownCutoff } },
              {
                completed_at: null,
                updated_at: { gte: cooldownCutoff },
              },
            ],
          },
          {
            status: "FAILED",
            updated_at: { gte: cooldownCutoff },
          },
        ],
      },
      select: { payload: true },
    });

    const blockedBonusIds = new Set<string>();
    for (const job of relevantJobs) {
      try {
        const payload = JSON.parse(job.payload) as { bonusId?: unknown };
        if (typeof payload.bonusId === "string" && payload.bonusId.length > 0) {
          blockedBonusIds.add(payload.bonusId);
        }
      } catch {
        // Invalid historical payloads cannot identify a Bonus to block.
      }
    }

    const candidates = await prisma.bonus.findMany({
      where: {
        ...(blockedBonusIds.size > 0
          ? { id: { notIn: [...blockedBonusIds] } }
          : {}),
        status: "ACTIVE",
        review_status: "APPROVED",
        publication_status: "PUBLISHED",
        quarantine_reason: null,
        OR: [{ verified_at: null }, { verified_at: { lte: cutoff } }],
        AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: now } }] }],
        casino: {
          status: "ACTIVE",
          review_status: "APPROVED",
          publication_status: "PUBLISHED",
          quarantine_reason: null,
        },
      },
      select: {
        id: true,
        source_offer_key: true,
        evidence_claims: {
          select: {
            id: true,
            verdict: true,
            created_at: true,
            evidence: {
              select: {
                id: true,
                source_url: true,
                observed_at: true,
                extracted_at: true,
              },
            },
          },
        },
        history_events: {
          select: {
            id: true,
            field_changed: true,
            source_url: true,
            changed_at: true,
          },
        },
      },
      orderBy: [
        { verified_at: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: BONUS_REVERIFICATION_BATCH_SIZE,
    });

    const result: BonusReverificationSweepResult = {
      enqueued: 0,
      skipped: [],
    };

    for (const bonus of candidates) {
      const source = BonusReverificationService.resolveAuthoritativeSourceUrl(
        bonus,
      );
      if ("error" in source) {
        result.skipped.push({ bonusId: bonus.id, reason: source.error });
        console.warn(
          `[PlatformOrchestrator] [Scheduler] Skipping Bonus ${bonus.id} (${source.error}).`,
        );
        continue;
      }

      try {
        await JobQueueService.enqueue(
          INGESTION_QUEUE_NAME,
          "VALIDATE_BONUS",
          { bonusId: bonus.id, url: source.url },
          { priority: "LOW", deduplicate: true, maxAttempts: 3 },
        );
        result.enqueued += 1;
      } catch {
        result.skipped.push({ bonusId: bonus.id, reason: "ENQUEUE_FAILED" });
        console.warn(
          `[PlatformOrchestrator] [Scheduler] Failed to enqueue Bonus ${bonus.id}.`,
        );
      }
    }

    return result;
  }

  /**
   * Handlers for all stage tasks (DISCOVER_SEEDS -> INGEST_URL -> CRAWL_URL -> EXTRACT_BONUS -> VALIDATE_BONUS)
   */
  public static getQueueHandlers(
    seedSources: string[],
    bonusReverificationOverrides?: ReverificationOverrides,
  ): IngestionQueueHandlers {
    return {
      DISCOVER_SEEDS: async (
        payload: IngestionJobPayloadMap["DISCOVER_SEEDS"],
      ) => {
        const seeds = payload.seedUrls || seedSources;
        console.log(`[PlatformOrchestrator] Executing DISCOVER_SEEDS across ${seeds.length} seeds...`);
        const result = await DiscoveryService.discoverAndEnqueue(seeds);
        console.log(`[PlatformOrchestrator] DISCOVER_SEEDS complete: ${result.totalEnqueued} URLs enqueued.`);
      },

      INGEST_URL: async (payload: IngestionJobPayloadMap["INGEST_URL"]) => {
        console.log(`[PlatformOrchestrator] Processing INGEST_URL: ${payload.url}`);
        await IngestionService.enqueueIngestion({ url: payload.url });
      },

      CRAWL_URL: async (payload: IngestionJobPayloadMap["CRAWL_URL"]) => {
        await IngestionService.handleCrawl(payload);
      },

      EXTRACT_BONUS: async (
        payload: IngestionJobPayloadMap["EXTRACT_BONUS"],
      ) => {
        const extractionResult = await IngestionService.handleExtraction(payload);

        if (extractionResult) {
          await JobQueueService.enqueue(
            INGESTION_QUEUE_NAME,
            "VALIDATE_BONUS",
            { bonusId: extractionResult.bonus.id, url: payload.url },
            { priority: "LOW", deduplicate: true }
          );
        }
      },

      EXTRACT_GAME_LIST: async (
        payload: IngestionJobPayloadMap["EXTRACT_GAME_LIST"],
      ) => {
        await IngestionService.handleGameListExtraction(payload);
      },

      REPROCESS_SNAPSHOT: async (
        payload: IngestionJobPayloadMap["REPROCESS_SNAPSHOT"],
      ) => {
        await IngestionService.handleSnapshotReprocessing(payload);
      },

      VALIDATE_BONUS: async (payload: { bonusId: string; url: string }) => {
        console.log(`[PlatformOrchestrator] Re-verifying Bonus ${payload.bonusId}...`);
        const result = bonusReverificationOverrides
          ? await BonusReverificationService.reverifyBonus(
              payload.bonusId,
              bonusReverificationOverrides,
            )
          : await BonusReverificationService.reverifyBonus(payload.bonusId);

        if (result.status === "VERIFIED_UNCHANGED") {
          console.log(
            `[PlatformOrchestrator] [PASS] Bonus ${payload.bonusId} verified at ${result.verifiedAt.toISOString()}.`,
          );
          return;
        }

        console.log(
          `[PlatformOrchestrator] [FAIL] Bonus ${payload.bonusId} was not freshness-renewed (${result.status}).`,
        );
      },
    };
  }

  /**
   * Graceful Shutdown
   */
  public static async stop(): Promise<void> {
    if (this.lifecycleState === "STOPPED") {
      return;
    }

    if (this.lifecycleState === "STOPPING" && this.stopPromise) {
      return this.stopPromise;
    }

    if (this.lifecycleState === "STARTING" && this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        if (this.getLifecycleState() === "STOPPED") {
          return;
        }
      }
    }

    if (this.getLifecycleState() === "STOPPED") {
      return;
    }

    this.lifecycleState = "STOPPING";

    this.stopPromise = (async () => {
      console.log("[PlatformOrchestrator] Initiating graceful shutdown...");
      let firstError: unknown = null;

      try {
        this.recoveryGeneration += 1;

        // 1. Clear timers and await in-flight heartbeat and recovery
        this.schedulerTimers.forEach((t) => clearInterval(t));
        this.schedulerTimers = [];

        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = undefined;
        }

        if (this.currentHeartbeatPromise) {
          try {
            await this.currentHeartbeatPromise;
          } catch {
            // Heartbeat failure handled
          }
        }

        if (this.recoveryTimer !== undefined) {
          clearTimeout(this.recoveryTimer);
          this.recoveryTimer = undefined;
        }

        if (this.currentRecoveryPromise) {
          try {
            await this.currentRecoveryPromise;
          } catch {
            // Recovery failure handled
          }
        }

        this.recoveryInFlight = false;
        this.currentRecoveryPromise = null;
        this.recoveryTimer = undefined;

        if (this.currentVerificationSweepPromise) {
          try {
            await this.currentVerificationSweepPromise;
          } catch {
            // Verification sweep failures are contained by the scheduler
          }
        }
        this.verificationSweepInFlight = false;
        this.currentVerificationSweepPromise = null;

        // 2. Stop workers
        const stops = this.workerHandles.map((worker) => worker.stop());
        this.workerHandles = [];
        const results = await Promise.allSettled(stops);
        for (const result of results) {
          if (result.status === "rejected" && firstError === null) {
            firstError = result.reason;
          }
        }

        // 3. Mark owned worker nodes DEAD in DB
        try {
          if (this.ownedWorkerNames.length > 0) {
            await this.workerNodeAdapter.markWorkersDead({
              workerNames: this.ownedWorkerNames,
            });
          }
        } catch (error) {
          console.error("[PlatformOrchestrator] Failed to persist terminal worker status:", error);
          if (firstError === null) {
            firstError = error;
          }
        }

        this.domainActiveCount.clear();
        this.domainLastAccess.clear();

        console.log("[PlatformOrchestrator] Graceful shutdown complete.");
      } finally {
        this.lifecycleState = "STOPPED";
        this.stopPromise = null;
        this.workerNodeAdapter = defaultWorkerNodePersistence;
        this.ownedWorkerNames = [];
        this.instanceId = null;
        this.recoveryInFlight = false;
        this.currentRecoveryPromise = null;
        this.recoveryTimer = undefined;
        this.verificationSweepInFlight = false;
        this.currentVerificationSweepPromise = null;
      }

      if (firstError) {
        throw firstError;
      }
    })();

    return this.stopPromise;
  }

  /**
   * Returns runtime metrics
   */
  public static async getMetrics() {
    const jobMetrics = await JobQueueService.getMetrics();
    const activeWorkers = await prisma.workerNode.count({ where: { status: "ACTIVE" } });

    return {
      activeWorkers,
      ...jobMetrics,
      isRunning: this.isRunning,
      timestamp: new Date(),
    };
  }
}
