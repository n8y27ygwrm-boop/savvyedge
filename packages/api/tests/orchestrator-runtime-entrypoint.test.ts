import { describe, expect, it, vi } from "vitest";
import {
  ConfigurationError,
  installProcessSignalHandlers,
  OrchestratorRuntime,
  parseRuntimeConfig,
} from "../src/runtime/orchestrator-runtime";

describe("Orchestrator Runtime Entrypoint (Boundary C3A)", () => {
  describe("Environment Configuration Parsing", () => {
    // 1. Valid empty env produces empty partial config (delegating defaults to OrchestratorService)
    it("produces empty config when environment variables are absent", () => {
      const config = parseRuntimeConfig({});
      expect(config).toEqual({});
    });

    // 2. Explicit valid integer configuration is mapped correctly
    it("maps valid integer environment variables to config fields", () => {
      const env: NodeJS.ProcessEnv = {
        WORKER_CONCURRENCY: "8",
        MAX_CONCURRENT_PER_DOMAIN: "4",
        MIN_DOMAIN_DELAY_MS: "500",
        DISCOVERY_INTERVAL_MS: "120000",
        CRAWL_INTERVAL_MS: "30000",
        EXTRACTION_INTERVAL_MS: "15000",
        VERIFICATION_INTERVAL_MS: "45000",
        RECOVERY_INTERVAL_MS: "20000",
        WORKER_POLL_INTERVAL_MS: "250",
        HEARTBEAT_INTERVAL_MS: "2000",
      };

      const config = parseRuntimeConfig(env);

      expect(config.workerConcurrency).toBe(8);
      expect(config.maxConcurrentPerDomain).toBe(4);
      expect(config.minDomainDelayMs).toBe(500);
      expect(config.discoveryIntervalMs).toBe(120000);
      expect(config.crawlIntervalMs).toBe(30000);
      expect(config.extractionIntervalMs).toBe(15000);
      expect(config.verificationIntervalMs).toBe(45000);
      expect(config.recoveryIntervalMs).toBe(20000);
      expect(config.workerPollIntervalMs).toBe(250);
      expect(config.heartbeatIntervalMs).toBe(2000);
    });

    // 3. Explicit valid boolean configuration is mapped correctly (case-insensitive)
    it("maps valid boolean environment variables to config fields", () => {
      const envTrue: NodeJS.ProcessEnv = {
        ORCHESTRATOR_ENABLE_WORKERS: "true",
        ORCHESTRATOR_ENABLE_SCHEDULERS: "TRUE",
        ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER: "False",
        ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER: "True",
        ORCHESTRATOR_ENABLE_RECOVERY: "True",
      };
      const configTrue = parseRuntimeConfig(envTrue);
      expect(configTrue.enableWorkers).toBe(true);
      expect(configTrue.enableSchedulers).toBe(true);
      expect(configTrue.enableDiscoveryScheduler).toBe(false);
      expect(configTrue.enableBonusReverificationScheduler).toBe(true);
      expect(configTrue.enableRecovery).toBe(true);

      const envFalse: NodeJS.ProcessEnv = {
        ORCHESTRATOR_ENABLE_WORKERS: "false",
        ORCHESTRATOR_ENABLE_SCHEDULERS: "FALSE",
        ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER: "TRUE",
        ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER: "False",
        ORCHESTRATOR_ENABLE_RECOVERY: "False",
      };
      const configFalse = parseRuntimeConfig(envFalse);
      expect(configFalse.enableWorkers).toBe(false);
      expect(configFalse.enableSchedulers).toBe(false);
      expect(configFalse.enableDiscoveryScheduler).toBe(true);
      expect(configFalse.enableBonusReverificationScheduler).toBe(false);
      expect(configFalse.enableRecovery).toBe(false);
    });

    // 4. Comma-separated seed sources normalize correctly
    it("normalizes comma-separated seed sources trimming whitespace and removing empty items", () => {
      const env: NodeJS.ProcessEnv = {
        SEED_SOURCES:
          " https://example.com/a, , https://example.com/b ,https://example.com/c/ ",
      };
      const config = parseRuntimeConfig(env);
      expect(config.seedSources).toEqual([
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c/",
      ]);
    });

    // 5. Invalid integer env fails closed
    it.each([
      ["WORKER_CONCURRENCY", "0"],
      ["WORKER_CONCURRENCY", "-1"],
      ["WORKER_CONCURRENCY", "banana"],
      ["WORKER_CONCURRENCY", "4.5"],
      ["MAX_CONCURRENT_PER_DOMAIN", "0"],
      ["MIN_DOMAIN_DELAY_MS", "-100"],
      ["DISCOVERY_INTERVAL_MS", "invalid"],
      ["RECOVERY_INTERVAL_MS", "-5"],
    ])("fails closed on invalid integer %s=%s", (envName, value) => {
      expect(() =>
        parseRuntimeConfig({ [envName]: value }),
      ).toThrowError(ConfigurationError);
    });

    // 6. Invalid boolean env fails closed
    it.each([
      ["ORCHESTRATOR_ENABLE_WORKERS", "1"],
      ["ORCHESTRATOR_ENABLE_WORKERS", "yes"],
      ["ORCHESTRATOR_ENABLE_WORKERS", "x"],
      ["ORCHESTRATOR_ENABLE_SCHEDULERS", "0"],
      ["ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER", "enabled"],
      ["ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER", "disabled"],
      ["ORCHESTRATOR_ENABLE_RECOVERY", "no"],
    ])("fails closed on invalid boolean %s=%s", (envName, value) => {
      expect(() => parseRuntimeConfig({ [envName]: value })).toThrowError(
        ConfigurationError,
      );
    });

    const productionEnv = (
      overrides: NodeJS.ProcessEnv = {},
    ): NodeJS.ProcessEnv => ({
      SAVVY_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/savvyedge",
      SAVVY_EVIDENCE_STORAGE_BACKEND: "supabase",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test_only",
      SAVVY_EVIDENCE_STORAGE_BUCKET: "savvyedge-evidence",
      ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER: "false",
      ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER: "true",
      ...overrides,
    });

    it("accepts the production D4B1 profile without seed sources", () => {
      expect(parseRuntimeConfig(productionEnv())).toEqual(
        expect.objectContaining({
          enableDiscoveryScheduler: false,
          enableBonusReverificationScheduler: true,
          seedSources: [],
        }),
      );
    });

    it("requires explicit production seeds only when discovery is enabled", () => {
      expect(() =>
        parseRuntimeConfig(
          productionEnv({
            ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER: "true",
          }),
        ),
      ).toThrowError(ConfigurationError);

      expect(
        parseRuntimeConfig(
          productionEnv({
            ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER: "true",
            SEED_SOURCES: "https://operator.example.test/promotions",
          }),
        ).seedSources,
      ).toEqual(["https://operator.example.test/promotions"]);
    });

    it("requires DATABASE_URL in explicit production", () => {
      expect(() =>
        parseRuntimeConfig(productionEnv({ DATABASE_URL: "" })),
      ).toThrowError(ConfigurationError);
    });

    it("requires explicit durable Supabase storage in production", () => {
      expect(() =>
        parseRuntimeConfig(
          productionEnv({ SAVVY_EVIDENCE_STORAGE_BACKEND: "filesystem" }),
        ),
      ).toThrowError(ConfigurationError);

      const implicitBackend = productionEnv();
      delete implicitBackend.SAVVY_EVIDENCE_STORAGE_BACKEND;
      expect(() => parseRuntimeConfig(implicitBackend)).toThrowError(
        ConfigurationError,
      );
    });

    it.each([
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "SAVVY_EVIDENCE_STORAGE_BUCKET",
    ])("requires production evidence storage setting %s", (name) => {
      const env = productionEnv();
      delete env[name];
      expect(() => parseRuntimeConfig(env)).toThrowError(ConfigurationError);
    });

    it("accepts the legacy service-role key only as a compatibility alias", () => {
      expect(
        parseRuntimeConfig(
          productionEnv({
            SUPABASE_SECRET_KEY: "",
            SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role-test-only",
          }),
        ),
      ).toEqual(expect.objectContaining({ seedSources: [] }));
    });

    it.each([
      "ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER",
      "ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER",
    ])("requires explicit production capability flag %s", (name) => {
      const env = productionEnv();
      delete env[name];
      expect(() => parseRuntimeConfig(env)).toThrowError(ConfigurationError);
    });

    it("parses the D3C 15-minute production interval", () => {
      expect(
        parseRuntimeConfig(
          productionEnv({ VERIFICATION_INTERVAL_MS: "900000" }),
        ).verificationIntervalMs,
      ).toBe(900_000);
    });
  });

  describe("Lifecycle Controller & Graceful Shutdown", () => {
    // 7. Successful startup calls Orchestrator start exactly once
    it("calls startOrchestrator exactly once on valid startup", async () => {
      const startSpy = vi.fn().mockResolvedValue(undefined);
      const logSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        startOrchestrator: startSpy,
        log: logSpy,
      });

      await runtime.run({
        WORKER_CONCURRENCY: "2",
      });

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledWith({ workerConcurrency: 2 });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("SavvyEdge ingestion orchestrator is running"),
      );
    });

    // 8–9. SIGINT / SIGTERM shutdown calls stop and disconnect exactly once
    it("executes stop and disconnect exactly once during graceful shutdown", async () => {
      const stopSpy = vi.fn().mockResolvedValue(undefined);
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);
      const exitCodeSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: stopSpy,
        disconnectDatabase: disconnectSpy,
        setProcessExitCode: exitCodeSpy,
      });

      await runtime.shutdown("SIGTERM", 0);

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(exitCodeSpy).toHaveBeenCalledWith(0);
      expect(runtime.getExitCode()).toBe(0);
    });

    // 10. Duplicate shutdown requests join one cleanup
    it("joins concurrent or duplicate shutdown requests into a single execution", async () => {
      const stopSpy = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: stopSpy,
        disconnectDatabase: disconnectSpy,
      });

      await Promise.all([
        runtime.shutdown("SIGINT", 0),
        runtime.shutdown("SIGTERM", 0),
        runtime.shutdown("duplicate", 0),
      ]);

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    // 11. Fatal request escalates exit code from 0 to 1 during active shutdown
    it("escalates requested exit code from 0 to 1 if a fatal reason arrives during shutdown", async () => {
      let releaseStop: () => void = () => undefined;
      const stopPromise = new Promise<void>((resolve) => {
        releaseStop = resolve;
      });

      const stopSpy = vi.fn().mockImplementation(async () => {
        await stopPromise;
      });
      const exitCodeSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: stopSpy,
        disconnectDatabase: vi.fn().mockResolvedValue(undefined),
        setProcessExitCode: exitCodeSpy,
      });

      const firstShutdown = runtime.shutdown("SIGINT", 0);

      // Fatal error arrives while SIGINT shutdown is in flight
      const fatalShutdown = runtime.shutdown("uncaughtException", 1);

      releaseStop();
      await Promise.all([firstShutdown, fatalShutdown]);

      expect(exitCodeSpy).toHaveBeenCalledWith(1);
      expect(runtime.getExitCode()).toBe(1);
    });

    // 12. Stop failure still attempts Prisma disconnect and yields exit code 1
    it("attempts database disconnect even if stop fails and sets exit code 1", async () => {
      const stopSpy = vi.fn().mockRejectedValue(new Error("stop timeout"));
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);
      const exitCodeSpy = vi.fn();
      const errorLogSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: stopSpy,
        disconnectDatabase: disconnectSpy,
        setProcessExitCode: exitCodeSpy,
        error: errorLogSpy,
      });

      await runtime.shutdown("SIGTERM", 0);

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(exitCodeSpy).toHaveBeenCalledWith(1);
      expect(runtime.getExitCode()).toBe(1);
      expect(errorLogSpy).toHaveBeenCalledWith(
        "[OrchestratorRuntime] Graceful shutdown failed (Error)",
      );
    });

    // 13. Disconnect failure yields exit code 1
    it("sets exit code 1 if database disconnect fails", async () => {
      const stopSpy = vi.fn().mockResolvedValue(undefined);
      const disconnectSpy = vi.fn().mockRejectedValue(new Error("db disconnect failed"));
      const exitCodeSpy = vi.fn();
      const errorLogSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: stopSpy,
        disconnectDatabase: disconnectSpy,
        setProcessExitCode: exitCodeSpy,
        error: errorLogSpy,
      });

      await runtime.shutdown("SIGINT", 0);

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(exitCodeSpy).toHaveBeenCalledWith(1);
      expect(runtime.getExitCode()).toBe(1);
      expect(errorLogSpy).toHaveBeenCalledWith(
        "[OrchestratorRuntime] Database disconnect failed (Error)",
      );
    });

    // 14. Startup failure enters cleanup and yields exit code 1
    it("enters graceful cleanup and sets exit code 1 if startup throws", async () => {
      const startSpy = vi.fn().mockRejectedValue(new Error("orchestrator startup failed"));
      const stopSpy = vi.fn().mockResolvedValue(undefined);
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);
      const exitCodeSpy = vi.fn();
      const errorLogSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        startOrchestrator: startSpy,
        stopOrchestrator: stopSpy,
        disconnectDatabase: disconnectSpy,
        setProcessExitCode: exitCodeSpy,
        error: errorLogSpy,
      });

      await runtime.run({});

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(exitCodeSpy).toHaveBeenCalledWith(1);
      expect(runtime.getExitCode()).toBe(1);
      expect(errorLogSpy).toHaveBeenCalledWith(
        "[OrchestratorRuntime] Startup failed (Error)",
      );
    });

    // 15–17. Watchdog triggers hard exit callback on hung shutdown and clears on clean shutdown
    it("arms watchdog and invokes injectable hardExit fallback on hung shutdown", async () => {
      const hardExitSpy = vi.fn();
      const errorLogSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        // Simulate a deadlocked stop that never settles
        stopOrchestrator: () => new Promise<void>(() => undefined),
        disconnectDatabase: vi.fn().mockResolvedValue(undefined),
        hardExit: hardExitSpy,
        error: errorLogSpy,
        watchdogTimeoutMs: 20, // Short timeout for test
      });

      void runtime.shutdown("SIGTERM", 0);

      await new Promise((resolve) => setTimeout(resolve, 45));

      expect(hardExitSpy).toHaveBeenCalledWith(1);
      expect(errorLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Shutdown timed out after 20ms; forcing process exit."),
      );
    });

    it("clears watchdog timer on successful clean shutdown without calling hardExit", async () => {
      const hardExitSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        stopOrchestrator: vi.fn().mockResolvedValue(undefined),
        disconnectDatabase: vi.fn().mockResolvedValue(undefined),
        hardExit: hardExitSpy,
        watchdogTimeoutMs: 25,
      });

      await runtime.shutdown("SIGINT", 0);

      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(hardExitSpy).not.toHaveBeenCalled();
    });

    // 18. Raw synthetic secret-bearing exception text is never emitted to logs
    it("never emits raw error messages or synthetic credentials to logs", async () => {
      const syntheticSecret =
        "postgresql://admin:super-secret-password-xyz@internal-db:5432/savvy";
      const sensitiveError = new Error(`Connection failed to ${syntheticSecret}`);
      sensitiveError.stack = `Error: Connection failed to ${syntheticSecret}\n  at /path/to/secret.ts:1:1`;

      const errorLogSpy = vi.fn();

      const runtime = new OrchestratorRuntime({
        startOrchestrator: vi.fn().mockRejectedValue(sensitiveError),
        error: errorLogSpy,
      });

      await runtime.run({});

      expect(errorLogSpy).toHaveBeenCalled();
      for (const call of errorLogSpy.mock.calls) {
        const loggedText = call.join(" ");
        expect(loggedText).not.toContain(syntheticSecret);
        expect(loggedText).not.toContain("super-secret-password-xyz");
        expect(loggedText).not.toContain("Connection failed");
      }
    });

    // 19. Signal handler registration and unregistration
    it("installs process signal handlers and cleanup removes them without side effects", () => {
      const runtime = new OrchestratorRuntime();
      const uninstall = installProcessSignalHandlers(runtime);

      // Verify uninstall runs cleanly
      expect(() => uninstall()).not.toThrow();
    });
  });
});
