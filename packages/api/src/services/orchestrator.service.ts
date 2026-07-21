import { prisma } from "@savvyedge/database";
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
}

export class OrchestratorService {
  private static isRunning = false;
  private static schedulerTimers: NodeJS.Timeout[] = [];
  private static workerHandles: Array<{ id: string; stop: () => void }> = [];
  private static heartbeatTimer?: NodeJS.Timeout;
  private static recoveryTimer?: NodeJS.Timeout;

  // Domain rate limiting state
  private static domainActiveCount = new Map<string, number>();
  private static domainLastAccess = new Map<string, number>();

  private static getConfig(): OrchestratorConfig {
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
    };
  }

  /**
   * Starts the continuous Platform Orchestrator
   */
  public static async start(customConfig?: Partial<OrchestratorConfig>) {
    if (this.isRunning) {
      console.log("[PlatformOrchestrator] Orchestrator is already running.");
      return;
    }

    const config = { ...this.getConfig(), ...customConfig };
    this.isRunning = true;

    console.log("=================================================");
    console.log("    SAVVYEDGE PLATFORM ORCHESTRATOR STARTING     ");
    console.log(` -> Worker Concurrency: ${config.workerConcurrency}`);
    console.log(` -> Discovery Interval: ${config.discoveryIntervalMs} ms`);
    console.log(` -> Crawl Interval:     ${config.crawlIntervalMs} ms`);
    console.log(` -> Max Domain Concur:  ${config.maxConcurrentPerDomain}`);
    console.log("=================================================");

    // 1. Initialize Workers in Database & Memory
    await this.initializeWorkers(config.workerConcurrency);

    // 2. Start Worker Heartbeat & Crash Recovery Loops
    this.startHeartbeatLoop(config.workerConcurrency);
    this.startRecoveryLoop();

    // 3. Register Queue Handlers
    const handlers = this.getQueueHandlers(config.seedSources);

    // 4. Spawn Worker Loops
    const domainLimiter = {
      checkDomainAllowed: (domain: string) => this.checkDomainAllowed(domain, config),
      recordDomainAccess: (domain: string) => this.recordDomainAccess(domain),
    };

    for (let i = 0; i < config.workerConcurrency; i++) {
      const workerId = `worker-node-${i + 1}`;
      const handle = JobQueueService.startWorker("orchestrator-queue", handlers, 500, {
        workerId,
        domainLimiter,
      });
      this.workerHandles.push({ id: workerId, stop: handle.stop });
    }

    // 5. Initialize Recurring Schedulers
    this.startSchedulers(config);
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
      if (!this.isRunning) return;
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
      if (!this.isRunning) return;
      try {
        await JobQueueService.recoverStaleJobs();
      } catch (err: any) {
        console.error("[PlatformOrchestrator] Error in crash recovery loop:", err.message);
      }
    }, 15000);
  }

  /**
   * Starts recurring job schedulers with duplicate protection
   */
  private static startSchedulers(config: OrchestratorConfig) {
    // 1. Discovery Scheduler
    const discoveryTimer = setInterval(async () => {
      if (!this.isRunning) return;
      console.log("[PlatformOrchestrator] [Scheduler] Enqueueing periodic DISCOVER_SEEDS job...");
      await JobQueueService.enqueue(
        "orchestrator-queue",
        "DISCOVER_SEEDS",
        { seedUrls: config.seedSources },
        { priority: "HIGH", deduplicate: true }
      );
    }, config.discoveryIntervalMs);

    // Initial immediate discovery run
    JobQueueService.enqueue(
      "orchestrator-queue",
      "DISCOVER_SEEDS",
      { seedUrls: config.seedSources },
      { priority: "HIGH", deduplicate: true }
    );

    this.schedulerTimers.push(discoveryTimer);
  }

  /**
   * Handlers for all stage tasks (DISCOVER_SEEDS -> INGEST_URL -> CRAWL_URL -> EXTRACT_BONUS -> VALIDATE_BONUS)
   */
  private static getQueueHandlers(seedSources: string[]) {
    return {
      DISCOVER_SEEDS: async (payload: { seedUrls?: string[] }) => {
        const seeds = payload.seedUrls || seedSources;
        console.log(`[PlatformOrchestrator] Executing DISCOVER_SEEDS across ${seeds.length} seeds...`);
        const result = await DiscoveryService.discoverAndEnqueue(seeds);
        console.log(`[PlatformOrchestrator] DISCOVER_SEEDS complete: ${result.totalEnqueued} URLs enqueued.`);
      },

      INGEST_URL: async (payload: { url: string; discovered_id?: string }) => {
        console.log(`[PlatformOrchestrator] Processing INGEST_URL: ${payload.url}`);
        const scrapeJob = await IngestionService.enqueueIngestion({ url: payload.url });
        await JobQueueService.enqueue(
          "orchestrator-queue",
          "CRAWL_URL",
          { scrapeJobId: scrapeJob.id, url: payload.url },
          { priority: "NORMAL", deduplicate: true }
        );
      },

      CRAWL_URL: async (payload: { scrapeJobId: string; url: string; casinoId?: string }) => {
        await IngestionService.handleCrawl(payload);
      },

      EXTRACT_BONUS: async (payload: {
        scrapeJobId: string;
        url: string;
        casinoId?: string;
        scrapedContent: string;
        scrapedMetadata: any;
      }) => {
        await IngestionService.handleExtraction(payload);

        // Find created bonus and enqueue validation
        const domain = payload.url ? new URL(payload.url).hostname.replace(/^www\./, "") : "";
        const bonus = await prisma.bonus.findFirst({
          where: { casino: { website_url: { contains: domain, mode: "insensitive" } } },
          orderBy: { valid_from: "desc" },
        });

        if (bonus) {
          await JobQueueService.enqueue(
            "orchestrator-queue",
            "VALIDATE_BONUS",
            { bonusId: bonus.id, url: payload.url },
            { priority: "LOW", deduplicate: true }
          );
        }
      },

      EXTRACT_GAME_LIST: async (payload: {
        scrapeJobId: string;
        url: string;
        casinoId: string;
        scrapedContent: string;
      }) => {
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
  public static async stop() {
    if (!this.isRunning) return;

    console.log("[PlatformOrchestrator] Initiating graceful shutdown...");
    this.isRunning = false;

    // 1. Clear timers
    this.schedulerTimers.forEach((t) => clearInterval(t));
    this.schedulerTimers = [];

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);

    // 2. Stop workers
    this.workerHandles.forEach((w) => w.stop());
    this.workerHandles = [];

    // 3. Mark worker nodes DEAD in DB
    try {
      await prisma.workerNode.updateMany({
        data: { status: "DEAD" },
      });
    } catch {}

    console.log("[PlatformOrchestrator] Graceful shutdown complete.");
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
