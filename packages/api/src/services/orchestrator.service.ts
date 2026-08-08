import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import type {
  IngestionJobPayloadMap,
  IngestionQueueHandlers,
} from "../contracts/ingestion-queue.contract";
import { JobQueueService } from "./job-queue.service";
import { DiscoveryService } from "./discovery.service";
import { IngestionService } from "./ingestion.service";
import { BonusService } from "./bonus.service";

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
  enableRecovery?: boolean;
  workerPollIntervalMs?: number;
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

  public static get isRunning(): boolean {
    return this.lifecycleState === "RUNNING";
  }

  public static getLifecycleState(): OrchestratorLifecycleState {
    return this.lifecycleState;
  }

  // Domain rate limiting state
  private static domainActiveCount = new Map<string, number>();
  private static domainLastAccess = new Map<string, number>();

  private static getConfig(): Required<OrchestratorConfig> {
    return {
      discoveryIntervalMs: parseInt(process.env.DISCOVERY_INTERVAL_MS || "300000", 10),
      crawlIntervalMs: parseInt(process.env.CRAWL_INTERVAL_MS || "60000", 10),
      extractionIntervalMs: parseInt(process.env.EXTRACTION_INTERVAL_MS || "30000", 10),
      verificationIntervalMs: parseInt(process.env.VERIFICATION_INTERVAL_MS || "60000", 10),
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
      enableRecovery: true,
      workerPollIntervalMs: 500,
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

    this.startPromise = (async () => {
      try {
        const config = { ...this.getConfig(), ...customConfig };

        console.log("=================================================");
        console.log("    SAVVYEDGE PLATFORM ORCHESTRATOR STARTING     ");
        console.log(` -> Worker Concurrency: ${config.workerConcurrency}`);
        console.log(` -> Discovery Interval: ${config.discoveryIntervalMs} ms`);
        console.log(` -> Crawl Interval:     ${config.crawlIntervalMs} ms`);
        console.log(` -> Max Domain Concur:  ${config.maxConcurrentPerDomain}`);
        console.log(` -> Workers Enabled:    ${config.enableWorkers}`);
        console.log(` -> Schedulers Enabled: ${config.enableSchedulers}`);
        console.log(` -> Recovery Enabled:   ${config.enableRecovery}`);
        console.log("=================================================");

        // 1. Register Queue Handlers
        const handlers = this.getQueueHandlers(config.seedSources);

        // 2. Spawn Worker Loops
        const domainLimiter = {
          checkDomainAllowed: (domain: string) =>
            this.checkDomainAllowed(domain, config),
          recordDomainAccess: (domain: string) => this.recordDomainAccess(domain),
        };

        if (config.enableWorkers) {
          for (let i = 0; i < config.workerConcurrency; i++) {
            const workerId = `worker-node-${i + 1}`;
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

        // 3. Initialize Recurring Schedulers
        if (config.enableSchedulers) {
          await this.startSchedulers(config);
        }

        this.lifecycleState = "RUNNING";
      } catch (error) {
        this.lifecycleState = "STOPPING";
        this.schedulerTimers.forEach((t) => clearInterval(t));
        this.schedulerTimers = [];
        const stops = this.workerHandles.map((w) => w.stop());
        this.workerHandles = [];
        await Promise.allSettled(stops);
        this.lifecycleState = "STOPPED";
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
  private static async initializeWorkers(count: number) {
    for (let i = 0; i < count; i++) {
      const workerName = `worker-node-${i + 1}`;
      await prisma.workerNode.upsert({
        where: { worker_name: workerName },
        update: {
          status: "ACTIVE",
          last_heartbeat: new Date(),
        },
        create: {
          worker_name: workerName,
          status: "ACTIVE",
          active_jobs: 0,
          last_heartbeat: new Date(),
        },
      });
    }
  }

  private static startHeartbeatLoop(count: number) {
    this.heartbeatTimer = setInterval(async () => {
      if (this.lifecycleState !== "RUNNING") return;
      for (let i = 0; i < count; i++) {
        const workerName = `worker-node-${i + 1}`;
        try {
          await prisma.workerNode.update({
            where: { worker_name: workerName },
            data: { status: "ACTIVE", last_heartbeat: new Date() },
          });
        } catch {}
      }
    }, 5000);
  }

  private static startRecoveryLoop() {
    this.recoveryTimer = setInterval(async () => {
      if (this.lifecycleState !== "RUNNING") return;
      try {
        await JobQueueService.recoverStaleJobs(INGESTION_QUEUE_NAME);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[PlatformOrchestrator] Error in crash recovery loop:", errorMsg);
      }
    }, 15000);
  }

  /**
   * Starts recurring job schedulers with duplicate protection
   */
  private static async startSchedulers(config: OrchestratorConfig) {
    // 1. Discovery Scheduler
    const discoveryTimer = setInterval(async () => {
      if (!this.isRunning) return;
      console.log("[PlatformOrchestrator] [Scheduler] Enqueueing periodic DISCOVER_SEEDS job...");
      await JobQueueService.enqueue(
        INGESTION_QUEUE_NAME,
        "DISCOVER_SEEDS",
        { seedUrls: config.seedSources },
        { priority: "HIGH", deduplicate: true }
      );
    }, config.discoveryIntervalMs);

    this.schedulerTimers.push(discoveryTimer);

    // Initial immediate discovery run
    try {
      await JobQueueService.enqueue(
        INGESTION_QUEUE_NAME,
        "DISCOVER_SEEDS",
        { seedUrls: config.seedSources },
        { priority: "HIGH", deduplicate: true }
      );
    } catch (error) {
      console.error("[PlatformOrchestrator] Failed initial discovery enqueue:", error);
    }
  }

  /**
   * Handlers for all stage tasks (DISCOVER_SEEDS -> INGEST_URL -> CRAWL_URL -> EXTRACT_BONUS -> VALIDATE_BONUS)
   */
  public static getQueueHandlers(seedSources: string[]): IngestionQueueHandlers {
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

      VALIDATE_BONUS: async (payload: { bonusId: string; url: string }) => {
        console.log(`[PlatformOrchestrator] Validating Bonus ${payload.bonusId}...`);
        const bonus = await prisma.bonus.findUnique({
          where: { id: payload.bonusId },
          include: {
            casino: {
              include: {
                licenses: {
                  where: { status: "ACTIVE" },
                },
              },
            },
          },
        });

        if (!bonus) {
          console.log(`[PlatformOrchestrator] [FAIL] Bonus ${payload.bonusId} not found.`);
          return;
        }

        const failedChecks: string[] = [];

        if (!bonus.headline_value || bonus.headline_value.trim() === "") {
          failedChecks.push("headline_value is null or empty");
        }

        if (bonus.wagering_requirement === null || bonus.wagering_requirement <= 0 || bonus.wagering_requirement > 100) {
          failedChecks.push(`wagering_requirement is invalid (${bonus.wagering_requirement})`);
        }

        if (bonus.max_conversion !== null && bonus.max_conversion <= 0) {
          failedChecks.push(`max_conversion is invalid (${bonus.max_conversion})`);
        }

        const activeLicenses = bonus.casino?.licenses || [];
        if (activeLicenses.length === 0) {
          failedChecks.push("casino has no active license");
        }

        if (failedChecks.length > 0) {
          console.log(`[PlatformOrchestrator] [FAIL] Bonus ${bonus.id} failed validation: ${failedChecks.join(", ")}`);
        } else {
          await prisma.bonus.update({
            where: { id: bonus.id },
            data: { status: "VERIFIED" },
          });
          console.log(`[PlatformOrchestrator] [PASS] Bonus ${bonus.id} verified and set to VERIFIED.`);
        }
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
        // 1. Clear timers
        this.schedulerTimers.forEach((t) => clearInterval(t));
        this.schedulerTimers = [];

        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = undefined;
        }
        if (this.recoveryTimer) {
          clearInterval(this.recoveryTimer);
          this.recoveryTimer = undefined;
        }

        // 2. Stop workers
        const stops = this.workerHandles.map((worker) => worker.stop());
        this.workerHandles = [];
        const results = await Promise.allSettled(stops);
        for (const result of results) {
          if (result.status === "rejected" && firstError === null) {
            firstError = result.reason;
          }
        }

        // 3. Mark worker nodes DEAD in DB
        try {
          await prisma.workerNode.updateMany({
            data: { status: "DEAD" },
          });
        } catch {}

        this.domainActiveCount.clear();
        this.domainLastAccess.clear();

        console.log("[PlatformOrchestrator] Graceful shutdown complete.");
      } finally {
        this.lifecycleState = "STOPPED";
        this.stopPromise = null;
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
