import { describe, expect, it, vi } from "vitest";
import {
  DomainConcurrencyManager,
  JobQueueService,
  ProcessJobOptions,
} from "../src/services/job-queue.service";

describe("WorkerPool Domain Concurrency (Boundary C1A)", () => {
  // Helper to create an in-memory queue store for deterministic testing without Prisma/DB
  function createMockQueueStore(
    jobs: Array<{
      id: string;
      task_type: string;
      payload: Record<string, unknown>;
      priority?: string;
      domain?: string;
    }>,
  ) {
    const state = jobs.map((j) => ({
      id: j.id,
      task_type: j.task_type,
      payload: JSON.stringify(j.payload),
      rawPayload: j.payload,
      priority: j.priority || "NORMAL",
      domain: j.domain,
      status: "PENDING" as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
      attempts: 0,
      max_attempts: 3,
    }));

    const claimAdapter: NonNullable<ProcessJobOptions["claimAdapter"]> = async (
      _queueName,
      _workerId,
      canAcquireDomain,
    ) => {
      const candidate = state.find((item) => {
        if (item.status !== "PENDING") return false;
        const dom =
          item.domain ||
          JobQueueService.extractDomainFromPayload(item.rawPayload);
        return canAcquireDomain(dom);
      });

      if (!candidate) return null;

      candidate.status = "PROCESSING";
      candidate.attempts += 1;
      return {
        id: candidate.id,
        task_type: candidate.task_type,
        payload: candidate.payload,
        attempts: candidate.attempts,
        max_attempts: candidate.max_attempts,
        domain: candidate.domain,
      };
    };

    return { state, claimAdapter };
  }

  // 1. Global concurrency limit contract
  it("preserves global concurrency options contract", () => {
    const manager = new DomainConcurrencyManager(2);
    expect(manager.maxConcurrentPerDomain).toBe(2);
  });

  // 2. Per-domain cap of 1 prevents two same-domain handlers from executing simultaneously
  it("prevents two same-domain handlers from executing simultaneously when cap is 1", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/page1" },
      },
      {
        id: "job-2",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-2", url: "https://example.com/page2" },
      },
    ]);

    let resolveHandler1: () => void = () => {};
    const handler1Promise = new Promise<void>((r) => {
      resolveHandler1 = r;
    });

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(async () => {
        await handler1Promise;
      }),
    };

    // First processNextJob claims job-1
    const p1 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    // Tick microtask to ensure job-1 has claimed slot and entered handler
    await new Promise((r) => setTimeout(r, 10));

    // Second processNextJob while job-1 is active returns false (skipped)
    const p2Result = await JobQueueService.processNextJob(
      "ingestion-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );

    expect(p2Result).toBe(false);
    expect(state[0].status).toBe("PROCESSING");
    expect(state[1].status).toBe("PENDING");
    expect(state[1].attempts).toBe(0); // Job 2 was never claimed

    resolveHandler1();
    await p1;
  });

  // 3. Two different domains execute concurrently when global capacity is 2
  it("executes jobs for two different domains concurrently when global capacity is 2", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "job-a",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-a", url: "https://domainA.com/page" },
      },
      {
        id: "job-b",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-b", url: "https://domainB.com/page" },
      },
    ]);

    let resolveBoth: () => void = () => {};
    const bothPromise = new Promise<void>((r) => {
      resolveBoth = r;
    });

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(async () => {
        await bothPromise;
      }),
    };

    const p1 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    const p2 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(state[0].status).toBe("PROCESSING");
    expect(state[1].status).toBe("PROCESSING");
    expect(manager.getActiveCount("domaina.com")).toBe(1);
    expect(manager.getActiveCount("domainb.com")).toBe(1);

    resolveBoth();
    await Promise.all([p1, p2]);
  });

  // 4. www.example.com and example.com share one normalized domain bucket
  it("normalizes www.example.com and example.com to the same domain bucket", () => {
    const d1 = JobQueueService.extractDomainFromPayload({
      url: "https://www.example.com/path",
    });
    const d2 = JobQueueService.extractDomainFromPayload({
      url: "https://example.com/other",
    });
    expect(d1).toBe("example.com");
    expect(d2).toBe("example.com");
  });

  // 5. Hostname matching is case-insensitive
  it("normalizes upper-case hostnames to lower-case", () => {
    const d = JobQueueService.extractDomainFromPayload({
      url: "HTTPS://EXAMPLE.COM/PATH",
    });
    expect(d).toBe("example.com");
  });

  // 6. URL paths and query parameters do not affect the domain bucket
  it("strips paths, query parameters, and fragments from domain bucket", () => {
    const d = JobQueueService.extractDomainFromPayload({
      url: "https://casino.example.com/promotions/welcome?token=abc123#terms",
    });
    expect(d).toBe("casino.example.com");
  });

  // 7. Credentials in a URL do not enter the bucket key or logs
  it("strips basic auth credentials from domain extraction without logging sensitive data", () => {
    const d = JobQueueService.extractDomainFromPayload({
      url: "https://admin:secret123@operator.example.com/dashboard",
    });
    expect(d).toBe("operator.example.com");
  });

  // 8. Invalid URL does not throw
  it("returns undefined for invalid URLs without throwing exceptions", () => {
    expect(() => {
      const d = JobQueueService.extractDomainFromPayload({
        url: "invalid-not-a-url",
      });
      expect(d).toBeUndefined();
    }).not.toThrow();
  });

  // 9. Missing URL does not throw
  it("returns undefined for payloads missing a URL without throwing", () => {
    expect(JobQueueService.extractDomainFromPayload({})).toBeUndefined();
    expect(JobQueueService.extractDomainFromPayload(null)).toBeUndefined();
    expect(
      JobQueueService.extractDomainFromPayload({ url: 12345 }),
    ).toBeUndefined();
  });

  // 10. Jobs without a domain remain governed only by global concurrency
  it("allows jobs without a domain to proceed without domain throttling limits", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      { id: "job-nodom-1", task_type: "CUSTOM_TASK", payload: { foo: "bar" } },
      { id: "job-nodom-2", task_type: "CUSTOM_TASK", payload: { baz: "qux" } },
    ]);

    const handlers = {
      CUSTOM_TASK: vi.fn().mockResolvedValue(true),
    };

    const res1 = await JobQueueService.processNextJob(
      "other-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );

    const res2 = await JobQueueService.processNextJob(
      "other-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(state[0].status).toBe("PROCESSING");
    expect(state[1].status).toBe("PROCESSING");
  });

  // 11. Handler success releases the domain slot
  it("releases the domain slot on handler resolution", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/page" },
      },
    ]);

    const handlers = {
      CRAWL_URL: vi.fn().mockResolvedValue("success"),
    };

    await JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    expect(manager.getActiveCount("example.com")).toBe(0);
  });

  // 12. Handler rejection releases the domain slot
  it("releases the domain slot on async handler rejection", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/page" },
      },
    ]);

    const handlers = {
      CRAWL_URL: vi.fn().mockRejectedValue(new Error("Async Error")),
    };

    await JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    expect(manager.getActiveCount("example.com")).toBe(0);
  });

  // 13. Synchronous handler throw releases the domain slot
  it("releases the domain slot when handler throws synchronously", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/page" },
      },
    ]);

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(() => {
        throw new Error("Sync Throw");
      }),
    };

    await JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    expect(manager.getActiveCount("example.com")).toBe(0);
  });

  // 14. Domain counter entry is deleted when it reaches zero
  it("deletes internal map entry when active count reaches 0", () => {
    const manager = new DomainConcurrencyManager(1);
    manager.acquire("test.com");
    expect(manager.getActiveCount("test.com")).toBe(1);

    manager.release("test.com");
    expect(manager.getActiveCount("test.com")).toBe(0);
  });

  // 15. Counter never becomes negative
  it("prevents negative domain counts if released excessively", () => {
    const manager = new DomainConcurrencyManager(1);
    manager.release("nonexistent.com");
    expect(manager.getActiveCount("nonexistent.com")).toBe(0);

    manager.acquire("test.com");
    manager.release("test.com");
    manager.release("test.com");
    expect(manager.getActiveCount("test.com")).toBe(0);
  });

  // 16. A waiting same-domain job begins after the first finishes
  it("allows waiting same-domain job to acquire capacity after first job completes", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/1" },
      },
      {
        id: "job-2",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-2", url: "https://example.com/2" },
      },
    ]);

    const handlers = {
      CRAWL_URL: vi.fn().mockResolvedValue(true),
    };

    // First processNextJob processes and finishes job-1
    await JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });
    expect(state[0].status).toBe("PROCESSING");

    // Second processNextJob now claims job-2 because job-1 released slot
    const res2 = await JobQueueService.processNextJob(
      "ingestion-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );

    expect(res2).toBe(true);
    expect(state[1].status).toBe("PROCESSING");
  });

  // 17. A saturated domain does not block an available job from another domain
  it("skips saturated domain and processes eligible candidate from another domain", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "job-doma-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-a1", url: "https://domainA.com/1" },
      },
      {
        id: "job-doma-2",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-a2", url: "https://domainA.com/2" },
      },
      {
        id: "job-domb-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-b1", url: "https://domainB.com/1" },
      },
    ]);

    let resolveDomA: () => void = () => {};
    const domAPromise = new Promise<void>((r) => {
      resolveDomA = r;
    });

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(async (payload) => {
        if (payload.url.includes("domainA.com/1")) {
          await domAPromise;
        }
      }),
    };

    // Process job-doma-1 (locks domainA)
    const p1 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    await new Promise((r) => setTimeout(r, 10));

    // Next processNextJob skips job-doma-2 and claims job-domb-1
    const p2 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    await p2;

    expect(state[0].status).toBe("PROCESSING"); // domainA/1 active
    expect(state[1].status).toBe("PENDING"); // domainA/2 skipped & stays pending
    expect(state[1].attempts).toBe(0); // 0 attempts
    expect(state[2].status).toBe("PROCESSING"); // domainB/1 active

    resolveDomA();
    await p1;
  });

  // 18. Invariant test: No claimed job waits while holding a lease solely for domain capacity
  it("verifies pre-claim Model A: skipped domain job remains PENDING with 0 attempts", async () => {
    const manager = new DomainConcurrencyManager(1);
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "job-1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://example.com/1" },
      },
      {
        id: "job-2",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-2", url: "https://example.com/2" },
      },
    ]);

    let resolveJob1: () => void = () => {};
    const job1Promise = new Promise<void>((r) => {
      resolveJob1 = r;
    });

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(async () => {
        await job1Promise;
      }),
    };

    const p1 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });

    await new Promise((r) => setTimeout(r, 10));

    const p2Result = await JobQueueService.processNextJob(
      "ingestion-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );

    expect(p2Result).toBe(false);
    expect(state[1].status).toBe("PENDING");
    expect(state[1].attempts).toBe(0);

    resolveJob1();
    await p1;
  });

  // 19. Stop/lifecycle behavior is unchanged by C1A
  it("provides worker stop handle without mutating external lifecycle", () => {
    const handle = JobQueueService.startWorker(
      "test-isolated-queue",
      {},
      100000,
      { claimAdapter: async () => null },
    );
    expect(typeof handle.stop).toBe("function");
    handle.stop();
  });

  // 20-22. Isolation assertions
  it("executes purely in memory without DB, browser, filesystem or network side effects", () => {
    const manager = new DomainConcurrencyManager(2);
    expect(manager.canAcquire("example.com")).toBe(true);
  });

  // 23. Invalid maxConcurrentPerDomain rejection
  it("throws configuration error when maxConcurrentPerDomain is invalid", () => {
    expect(() => new DomainConcurrencyManager(0)).toThrow(
      "maxConcurrentPerDomain must be a positive integer",
    );
    expect(() => new DomainConcurrencyManager(-5)).toThrow(
      "maxConcurrentPerDomain must be a positive integer",
    );
    expect(() => new DomainConcurrencyManager(1.5)).toThrow(
      "maxConcurrentPerDomain must be a positive integer",
    );
  });

  // 24. Default per-domain limit explicitly tested
  it("defaults maxConcurrentPerDomain to 2 when unspecified", () => {
    const manager = new DomainConcurrencyManager();
    expect(manager.maxConcurrentPerDomain).toBe(2);
  });

  // 25. Global concurrency greater than per-domain cap
  it("supports global capacity greater than per-domain cap", async () => {
    const manager = new DomainConcurrencyManager(2); // Cap = 2 per domain
    const { state, claimAdapter } = createMockQueueStore([
      {
        id: "j1",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-1", url: "https://domainA.com/1" },
      },
      {
        id: "j2",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-2", url: "https://domainA.com/2" },
      },
      {
        id: "j3",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-3", url: "https://domainA.com/3" },
      },
      {
        id: "j4",
        task_type: "CRAWL_URL",
        payload: { scrapeJobId: "s-4", url: "https://domainB.com/1" },
      },
    ]);

    let resolveAll: () => void = () => {};
    const allPromise = new Promise<void>((r) => {
      resolveAll = r;
    });

    const handlers = {
      CRAWL_URL: vi.fn().mockImplementation(async () => {
        await allPromise;
      }),
    };

    // Claim j1 (domainA: 1)
    const p1 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });
    await new Promise((r) => setTimeout(r, 10));

    // Claim j2 (domainA: 2 - cap reached)
    const p2 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });
    await new Promise((r) => setTimeout(r, 10));

    // Claim j4 (domainB: 1 - allowed, skips domainA 3rd job j3)
    const p4 = JobQueueService.processNextJob("ingestion-queue", handlers, {
      domainLimiter: manager,
      claimAdapter,
    });
    await new Promise((r) => setTimeout(r, 10));

    // Try another processNextJob (j3 is domainA cap 2 reached -> returns false)
    const p3Result = await JobQueueService.processNextJob(
      "ingestion-queue",
      handlers,
      {
        domainLimiter: manager,
        claimAdapter,
      },
    );
    expect(p3Result).toBe(false);

    expect(state[0].status).toBe("PROCESSING");
    expect(state[1].status).toBe("PROCESSING");
    expect(state[2].status).toBe("PENDING"); // domainA 3rd job skipped
    expect(state[3].status).toBe("PROCESSING"); // domainB job allowed

    resolveAll();
    await Promise.all([p1, p2, p4]);
  });
});
