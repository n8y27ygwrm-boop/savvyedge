import { prisma } from "@savvyedge/database";
import {
  OrchestratorConfig,
  OrchestratorService,
} from "../services/orchestrator.service";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface RuntimeDependencies {
  startOrchestrator?: (config?: Partial<OrchestratorConfig>) => Promise<void>;
  stopOrchestrator?: () => Promise<void>;
  disconnectDatabase?: () => Promise<void>;
  setProcessExitCode?: (code: number) => void;
  hardExit?: (code: number) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  watchdogTimeoutMs?: number;
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigurationError(
      `Invalid ${name}: expected positive integer, got "${value}"`,
    );
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed <= 0) {
    throw new ConfigurationError(
      `Invalid ${name}: expected integer greater than 0, got "${value}"`,
    );
  }
  return parsed;
}

function parseNonNegativeInteger(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigurationError(
      `Invalid ${name}: expected non-negative integer, got "${value}"`,
    );
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed < 0) {
    throw new ConfigurationError(
      `Invalid ${name}: expected integer greater than or equal to 0, got "${value}"`,
    );
  }
  return parsed;
}

function parseBoolean(
  name: string,
  value: string | undefined,
): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new ConfigurationError(
    `Invalid ${name}: expected "true" or "false", got "${value}"`,
  );
}

function parseSeedSources(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const seeds = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return seeds.length > 0 ? seeds : undefined;
}

function isExplicitProductionEnvironment(env: NodeJS.ProcessEnv): boolean {
  return [env.SAVVY_ENV, env.NEXT_PUBLIC_APP_ENV, env.NODE_ENV].some(
    (value) => {
      const normalized = value?.trim().toLowerCase();
      return normalized === "production" || normalized === "prod";
    },
  );
}

export function parseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Partial<OrchestratorConfig> {
  const config: Partial<OrchestratorConfig> = {};

  const workerConcurrency = parsePositiveInteger(
    "WORKER_CONCURRENCY",
    env.WORKER_CONCURRENCY,
  );
  if (workerConcurrency !== undefined) {
    config.workerConcurrency = workerConcurrency;
  }

  const maxConcurrentPerDomain = parsePositiveInteger(
    "MAX_CONCURRENT_PER_DOMAIN",
    env.MAX_CONCURRENT_PER_DOMAIN,
  );
  if (maxConcurrentPerDomain !== undefined) {
    config.maxConcurrentPerDomain = maxConcurrentPerDomain;
  }

  const minDomainDelayMs = parseNonNegativeInteger(
    "MIN_DOMAIN_DELAY_MS",
    env.MIN_DOMAIN_DELAY_MS,
  );
  if (minDomainDelayMs !== undefined) {
    config.minDomainDelayMs = minDomainDelayMs;
  }

  const discoveryIntervalMs = parsePositiveInteger(
    "DISCOVERY_INTERVAL_MS",
    env.DISCOVERY_INTERVAL_MS,
  );
  if (discoveryIntervalMs !== undefined) {
    config.discoveryIntervalMs = discoveryIntervalMs;
  }

  const crawlIntervalMs = parsePositiveInteger(
    "CRAWL_INTERVAL_MS",
    env.CRAWL_INTERVAL_MS,
  );
  if (crawlIntervalMs !== undefined) {
    config.crawlIntervalMs = crawlIntervalMs;
  }

  const extractionIntervalMs = parsePositiveInteger(
    "EXTRACTION_INTERVAL_MS",
    env.EXTRACTION_INTERVAL_MS,
  );
  if (extractionIntervalMs !== undefined) {
    config.extractionIntervalMs = extractionIntervalMs;
  }

  const verificationIntervalMs = parsePositiveInteger(
    "VERIFICATION_INTERVAL_MS",
    env.VERIFICATION_INTERVAL_MS,
  );
  if (verificationIntervalMs !== undefined) {
    config.verificationIntervalMs = verificationIntervalMs;
  }

  const recoveryIntervalMs = parsePositiveInteger(
    "RECOVERY_INTERVAL_MS",
    env.RECOVERY_INTERVAL_MS,
  );
  if (recoveryIntervalMs !== undefined) {
    config.recoveryIntervalMs = recoveryIntervalMs;
  }

  const workerPollIntervalMs = parsePositiveInteger(
    "WORKER_POLL_INTERVAL_MS",
    env.WORKER_POLL_INTERVAL_MS,
  );
  if (workerPollIntervalMs !== undefined) {
    config.workerPollIntervalMs = workerPollIntervalMs;
  }

  const heartbeatIntervalMs = parsePositiveInteger(
    "HEARTBEAT_INTERVAL_MS",
    env.HEARTBEAT_INTERVAL_MS,
  );
  if (heartbeatIntervalMs !== undefined) {
    config.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  const enableWorkers = parseBoolean(
    "ORCHESTRATOR_ENABLE_WORKERS",
    env.ORCHESTRATOR_ENABLE_WORKERS,
  );
  if (enableWorkers !== undefined) {
    config.enableWorkers = enableWorkers;
  }

  const enableSchedulers = parseBoolean(
    "ORCHESTRATOR_ENABLE_SCHEDULERS",
    env.ORCHESTRATOR_ENABLE_SCHEDULERS,
  );
  if (enableSchedulers !== undefined) {
    config.enableSchedulers = enableSchedulers;
  }

  const enableDiscoveryScheduler = parseBoolean(
    "ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER",
    env.ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER,
  );
  if (enableDiscoveryScheduler !== undefined) {
    config.enableDiscoveryScheduler = enableDiscoveryScheduler;
  }

  const enableBonusReverificationScheduler = parseBoolean(
    "ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER",
    env.ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER,
  );
  if (enableBonusReverificationScheduler !== undefined) {
    config.enableBonusReverificationScheduler =
      enableBonusReverificationScheduler;
  }

  const enableRecovery = parseBoolean(
    "ORCHESTRATOR_ENABLE_RECOVERY",
    env.ORCHESTRATOR_ENABLE_RECOVERY,
  );
  if (enableRecovery !== undefined) {
    config.enableRecovery = enableRecovery;
  }

  const seedSources = parseSeedSources(env.SEED_SOURCES);
  if (seedSources !== undefined) {
    config.seedSources = seedSources;
  }

  if (isExplicitProductionEnvironment(env)) {
    if (!env.DATABASE_URL?.trim()) {
      throw new ConfigurationError(
        "Invalid production configuration: DATABASE_URL is required",
      );
    }

    if (enableDiscoveryScheduler === undefined) {
      throw new ConfigurationError(
        "Invalid production configuration: ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER must be explicit",
      );
    }
    if (enableBonusReverificationScheduler === undefined) {
      throw new ConfigurationError(
        "Invalid production configuration: ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER must be explicit",
      );
    }

    if (enableDiscoveryScheduler && seedSources === undefined) {
      throw new ConfigurationError(
        "Invalid production configuration: SEED_SOURCES is required when discovery scheduling is enabled",
      );
    }

    // Override development-only service fallbacks. With discovery disabled an
    // empty seed set is valid and D3C can continue independently.
    config.seedSources = seedSources ?? [];
  }

  return config;
}

export class OrchestratorRuntime {
  private shutdownPromise: Promise<void> | null = null;
  private requestedExitCode = 0;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private readonly deps: Required<RuntimeDependencies>;

  constructor(deps: RuntimeDependencies = {}) {
    this.deps = {
      startOrchestrator:
        deps.startOrchestrator ??
        ((cfg) => OrchestratorService.start(cfg)),
      stopOrchestrator:
        deps.stopOrchestrator ??
        (() => OrchestratorService.stop()),
      disconnectDatabase:
        deps.disconnectDatabase ??
        (() => prisma.$disconnect()),
      setProcessExitCode:
        deps.setProcessExitCode ??
        ((code) => {
          process.exitCode = code;
        }),
      hardExit:
        deps.hardExit ??
        ((code) => {
          process.exit(code);
        }),
      log: deps.log ?? ((msg) => console.log(msg)),
      warn: deps.warn ?? ((msg) => console.warn(msg)),
      error: deps.error ?? ((msg) => console.error(msg)),
      watchdogTimeoutMs: deps.watchdogTimeoutMs ?? 30_000,
    };
  }

  public logError(context: string, err: unknown): void {
    const errorType =
      err instanceof Error ? err.name || "Error" : "Error";
    this.deps.error(`[OrchestratorRuntime] ${context} (${errorType})`);
  }

  public async shutdown(
    reason: string,
    exitCode: number = 0,
  ): Promise<void> {
    this.requestedExitCode = Math.max(this.requestedExitCode, exitCode);

    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      this.deps.log(`[OrchestratorRuntime] Shutting down: ${reason}`);

      // Arm watchdog timer for hung shutdown protection
      const timeoutMs = this.deps.watchdogTimeoutMs;
      if (timeoutMs > 0) {
        this.watchdogTimer = setTimeout(() => {
          this.deps.error(
            `[OrchestratorRuntime] Shutdown timed out after ${timeoutMs}ms; forcing process exit.`,
          );
          this.deps.hardExit(this.requestedExitCode || 1);
        }, timeoutMs);

        if (typeof this.watchdogTimer?.unref === "function") {
          this.watchdogTimer.unref();
        }
      }

      // Step 1: Stop orchestrator
      try {
        await this.deps.stopOrchestrator();
      } catch (err: unknown) {
        this.requestedExitCode = 1;
        this.logError("Graceful shutdown failed", err);
      }

      // Step 2: Disconnect database
      try {
        await this.deps.disconnectDatabase();
      } catch (err: unknown) {
        this.requestedExitCode = 1;
        this.logError("Database disconnect failed", err);
      }

      // Disarm watchdog timer
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }

      this.deps.setProcessExitCode(this.requestedExitCode);
      this.deps.log(
        `[OrchestratorRuntime] Shutdown complete (exit code ${this.requestedExitCode}).`,
      );
    })();

    return this.shutdownPromise;
  }

  public async run(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    try {
      const config = parseRuntimeConfig(env);
      await this.deps.startOrchestrator(config);
      this.deps.log(
        "[OrchestratorRuntime] SavvyEdge ingestion orchestrator is running.",
      );
    } catch (err: unknown) {
      this.logError("Startup failed", err);
      await this.shutdown("startup failure", 1);
    }
  }

  public getExitCode(): number {
    return this.requestedExitCode;
  }
}

export function installProcessSignalHandlers(
  runtime: OrchestratorRuntime,
): () => void {
  const onSigInt = () => {
    void runtime.shutdown("SIGINT", 0);
  };
  const onSigTerm = () => {
    void runtime.shutdown("SIGTERM", 0);
  };
  const onUnhandledRejection = (reason: unknown) => {
    runtime.logError("Unhandled rejection", reason);
    void runtime.shutdown("unhandledRejection", 1);
  };
  const onUncaughtException = (error: unknown) => {
    runtime.logError("Uncaught exception", error);
    void runtime.shutdown("uncaughtException", 1);
  };

  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);
  process.once("unhandledRejection", onUnhandledRejection);
  process.once("uncaughtException", onUncaughtException);

  return () => {
    process.removeListener("SIGINT", onSigInt);
    process.removeListener("SIGTERM", onSigTerm);
    process.removeListener("unhandledRejection", onUnhandledRejection);
    process.removeListener("uncaughtException", onUncaughtException);
  };
}
