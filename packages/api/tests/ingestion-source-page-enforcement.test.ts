import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { IngestionService } from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import type { IngestionTaskContext } from "../src/services/source-page-eligibility";
import {
  EvidenceArtifactPersistenceError,
  EvidenceArtifactStorageService,
} from "../src/services/evidence-artifact-storage.service";
import {
  ExtractionInputRejectedError,
  evaluateExtractionInputSufficiency,
} from "../src/services/extraction-input-sufficiency";

const OBSERVED_AT = new Date("2026-08-11T10:20:30.456Z");

interface ScraperFixture {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl?: string;
  title?: string;
  content: string;
  taskContext?: IngestionTaskContext;
  casinoId?: string;
}

function mockScraperResult(fixture: ScraperFixture) {
  vi.spyOn(
    (
      IngestionService as unknown as {
        scraperAgent: { run: (input: unknown) => Promise<unknown> };
      }
    ).scraperAgent,
    "run",
  ).mockResolvedValue({
    url: fixture.requestedUrl,
    finalUrl: fixture.finalUrl,
    title: fixture.title || "Default Title",
    content: fixture.content,
    rawHtml: `<html><body>${fixture.content}</body></html>`,
    metadata: { title: fixture.title },
    htmlHash: "test-html-sha256-hash",
    contentHash: "test-content-sha256-hash",
    canonicalUrl: fixture.canonicalUrl,
    timestamp: OBSERVED_AT,
  });
}

function mockScraperError(error: unknown) {
  vi.spyOn(
    (
      IngestionService as unknown as {
        scraperAgent: { run: (input: unknown) => Promise<unknown> };
      }
    ).scraperAgent,
    "run",
  ).mockRejectedValue(error);
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(
    EvidenceArtifactStorageService,
    "persistObservation",
  ).mockResolvedValue({
    locator: "supabase://savvyedge-evidence/v1/observation.html",
    htmlHash: "test-html-sha256-hash",
    byteSize: 128,
  });
});

describe("source-page eligibility enforcement (Boundary B2)", () => {
  it("1-2. eligible BONUS page persists hashes/canonical metadata and enqueues EXTRACT_BONUS", async () => {
    const requestedUrl = "https://casino.example.com/promotions/welcome-bonus/";
    mockScraperResult({
      requestedUrl,
      finalUrl: requestedUrl,
      canonicalUrl: requestedUrl,
      title: "Welcome Bonus",
      content: "100% deposit match up to $500",
      taskContext: "BONUS",
    });

    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    const updateManyJob = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-1",
      data_source_id: "ds-1",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-queue-1" } as never);

    await IngestionService.handleCrawl({
      scrapeJobId: "scrape-job-1",
      url: requestedUrl,
      taskContext: "BONUS",
    });

    const provenanceCall = updateManyJob.mock.calls.find(
      ([call]) =>
        call.data.snapshot_path ===
        "supabase://savvyedge-evidence/v1/observation.html",
    );
    expect(provenanceCall?.[0]).toMatchObject({
      where: { id: "scrape-job-1", retry_count: 0 },
      data: {
        snapshot_path:
          "supabase://savvyedge-evidence/v1/observation.html",
        html_hash: "test-html-sha256-hash",
        content_hash: "test-content-sha256-hash",
        canonical_url: requestedUrl,
      },
    });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(
      vi.mocked(EvidenceArtifactStorageService.persistObservation).mock
        .invocationCallOrder[0],
    ).toBeLessThan(enqueue.mock.invocationCallOrder[0]);
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_BONUS",
      expect.objectContaining({
        scrapeJobId: "scrape-job-1",
        url: requestedUrl,
        observedAt: OBSERVED_AT.toISOString(),
      }),
      { deduplicate: true },
    );
  });

  it("3-4. eligible GAME_LIST page enqueues EXTRACT_GAME_LIST on canonical queue contract", async () => {
    const requestedUrl = "https://casino.example.com/casino/slots/";
    mockScraperResult({
      requestedUrl,
      finalUrl: requestedUrl,
      title: "Casino Slots Lobby",
      content: "Popular slot games and jackpot titles",
      taskContext: "GAME_LIST",
      casinoId: "casino-uuid-123",
    });

    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-2",
      data_source_id: "ds-2",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-queue-2" } as never);

    await IngestionService.handleCrawl({
      scrapeJobId: "scrape-job-2",
      url: requestedUrl,
      taskContext: "GAME_LIST",
      casinoId: "casino-uuid-123",
    });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_GAME_LIST",
      expect.objectContaining({
        scrapeJobId: "scrape-job-2",
        url: requestedUrl,
        casinoId: "casino-uuid-123",
      }),
    );
  });

  it("5-9. finalUrl, title, and canonicalUrl are passed to policy; missing/malformed canonical does not block valid page", async () => {
    const requestedUrl = "http://www.casino.example.com/promotions/welcome";
    const finalUrl = "https://casino.example.com/en/promotions/welcome/";
    const malformedCanonical = "ht://invalid-canonical-url";

    mockScraperResult({
      requestedUrl,
      finalUrl,
      canonicalUrl: malformedCanonical,
      title: "Welcome Bonus Terms",
      content: "Claim your 100% deposit match bonus.",
      taskContext: "BONUS",
    });

    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-3",
      data_source_id: "ds-3",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "job-queue-3" } as never);

    await IngestionService.handleCrawl({
      scrapeJobId: "scrape-job-3",
      url: requestedUrl,
      taskContext: "BONUS",
    });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      "ingestion-queue",
      "EXTRACT_BONUS",
      expect.objectContaining({
        scrapeJobId: "scrape-job-3",
        url: requestedUrl,
      }),
      { deduplicate: true },
    );
  });

  it("10-14. anti-bot, geo-restricted, unrelated-host, restricted-login, and context-mismatch pages enqueue no extraction job", async () => {
    const cases = [
      {
        req: "https://casino.example.com/promotions/welcome/",
        final: "https://casino.example.com/promotions/welcome/",
        title: "Just a moment...",
        content: "Cloudflare Ray ID: 123",
      },
      {
        req: "https://casino.example.com/promotions/welcome/",
        final: "https://casino.example.com/promotions/welcome/",
        title: "Services Unavailable in Your Location",
        content:
          "Not available in your country. " +
          "This rendered page includes substantial ordinary navigation and account information. ".repeat(
            12,
          ),
      },
      {
        req: "https://casino.example.com/promotions/welcome/",
        final: "https://casino.example.com/help/",
        title: "Help Center",
        content: "Player help",
      },
      {
        req: "https://casino.example.com/promotions/welcome/",
        final: "https://casino.example.com/login/",
        title: "Restricted Access Login",
        content: "Sign in required",
      },
      {
        req: "https://casino.example.com/promotions/welcome-offer/",
        final: "https://casino.example.com/en/",
        title: "Casino Home",
        content: "Play online games",
      },
    ];

    for (const c of cases) {
      mockScraperResult({
        requestedUrl: c.req,
        finalUrl: c.final,
        title: c.title,
        content: c.content,
        taskContext: "BONUS",
      });

      vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
      vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
        id: "scrape-job-rej",
        data_source_id: "ds-rej",
      } as never);
      const enqueue = vi.spyOn(JobQueueService, "enqueue");

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-rej",
          url: c.req,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow("SOURCE_PAGE_REJECTED");

      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it("15-20. rejected page marks ScrapeJob FAILED with sanitized error_log excluding raw URLs, tokens, and credentials", async () => {
    const sensitiveRequestedUrl =
      "https://admin:secret123@casino.example.com/promotions/welcome?token=super-secret-token#private";
    mockScraperResult({
      requestedUrl: sensitiveRequestedUrl,
      finalUrl: sensitiveRequestedUrl,
      title: "Services Unavailable in Your Location",
      content:
        "Not available in your country. " +
        "This rendered page includes substantial ordinary navigation and account information. ".repeat(
          12,
        ),
      taskContext: "BONUS",
    });

    const updateJob = vi
      .spyOn(prisma.scrapeJob, "update")
      .mockResolvedValue({} as never);
    const updateManyJob = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-sensitive",
      data_source_id: "ds-sensitive",
    } as never);
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-sensitive",
        url: sensitiveRequestedUrl,
        taskContext: "BONUS",
      }),
    ).rejects.toThrow("SOURCE_PAGE_REJECTED");

    expect(updateJob).not.toHaveBeenCalled();
    expect(
      EvidenceArtifactStorageService.persistObservation,
    ).not.toHaveBeenCalled();

    const failureCall = updateManyJob.mock.calls.find(
      ([call]) => call.data.status === "FAILED",
    );
    expect(failureCall).toBeDefined();
    const errorLogStr = failureCall![0].data.error_log as string;

    const parsedLog = JSON.parse(errorLogStr);
    expect(parsedLog).toEqual({
      code: "SOURCE_PAGE_REJECTED",
      category: "GEO_RESTRICTED",
      reason: "The rendered page reports location-based unavailability.",
    });

    expect(errorLogStr).not.toContain("admin");
    expect(errorLogStr).not.toContain("secret123");
    expect(errorLogStr).not.toContain("token");
    expect(errorLogStr).not.toContain("super-secret-token");
    expect(errorLogStr).not.toContain("private");

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("21-22. unexpected crawl error produces generic bounded failure data without persisting raw exception message or stack", async () => {
    const sensitiveException = new Error(
      "DATABASE_URL=postgresql://admin:super-secret@internal-db:5432/savvy",
    );
    mockScraperError(sensitiveException);

    const updateManyJob = vi
      .spyOn(prisma.scrapeJob, "updateMany")
      .mockResolvedValue({ count: 1 });

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-err",
        url: "https://casino.example.com/promotions/welcome/",
        taskContext: "BONUS",
      }),
    ).rejects.toThrow();

    const failureCall = updateManyJob.mock.calls.find(
      ([call]) => call.data.status === "FAILED",
    );
    expect(failureCall).toBeDefined();
    const errorLogStr = failureCall![0].data.error_log as string;

    expect(JSON.parse(errorLogStr)).toEqual({
      code: "CRAWL_FAILED",
      reason: "Crawl processing failed",
    });

    expect(errorLogStr).not.toContain("DATABASE_URL");
    expect(errorLogStr).not.toContain("postgresql");
    expect(errorLogStr).not.toContain("admin");
    expect(errorLogStr).not.toContain("super-secret");
    expect(errorLogStr).not.toContain("internal-db");
    expect(errorLogStr).not.toContain("5432");
  });

  it("23-25. duplicate crawl check prevents re-crawling; zero real DB, browser, or network required", async () => {
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue({
      status: "COMPLETED",
    } as never);
    const scraperSpy = vi.spyOn(
      (
        IngestionService as unknown as {
          scraperAgent: { run: (input: unknown) => Promise<unknown> };
        }
      ).scraperAgent,
      "run",
    );

    await IngestionService.handleCrawl({
      scrapeJobId: "scrape-job-completed",
      url: "https://casino.example.com/promotions/welcome/",
      taskContext: "BONUS",
    });

    expect(scraperSpy).not.toHaveBeenCalled();
  });

  it("fails closed before extraction enqueue when durable persistence fails", async () => {
    const requestedUrl = "https://casino.example.com/promotions/welcome/";
    mockScraperResult({
      requestedUrl,
      finalUrl: requestedUrl,
      title: "Welcome Bonus",
      content: "100% deposit match up to $500",
    });
    vi.mocked(EvidenceArtifactStorageService.persistObservation).mockRejectedValue(
      new Error("bounded durable persistence failure"),
    );
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-storage-failure",
      data_source_id: "ds-storage-failure",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
    const update = vi.spyOn(prisma.scrapeJob, "update");
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-storage-failure",
        url: requestedUrl,
        taskContext: "BONUS",
      }),
    ).rejects.toThrow("bounded durable persistence failure");

    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate content without creating an unnecessary artifact", async () => {
    const requestedUrl = "https://casino.example.com/promotions/welcome/";
    mockScraperResult({
      requestedUrl,
      finalUrl: requestedUrl,
      title: "Welcome Bonus",
      content: "100% deposit match up to $500",
    });
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-duplicate",
      data_source_id: "ds-duplicate",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue({
      id: "scrape-job-previous",
      content_hash: "test-content-sha256-hash",
    } as never);
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await IngestionService.handleCrawl({
      scrapeJobId: "scrape-job-duplicate",
      url: requestedUrl,
      taskContext: "BONUS",
    });

    expect(
      EvidenceArtifactStorageService.persistObservation,
    ).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  describe("extraction-input sufficiency boundary", () => {
    const requestedUrl = "https://casino.example.com/promotions/welcome/";
    // Global site chrome with no offer content: representative of the rendered
    // text that reached the extraction agent in production, not a capture of
    // the exact production payload.
    //
    // It carries the generic section labels a casino menu always has
    // ("Promotions", "Bonuses") and no offer detail, so it is insufficient for
    // BONUS while remaining ordinary, non-operator-specific navigation.
    const chromeOnlyContent =
      "Sports Casino Live Casino Bingo Poker Promotions Bonuses Help " +
      "About Us Apps Blog Home Racing Sponsors Log in Create account";

    function mockCrawlJob(id: string) {
      const updateMany = vi
        .spyOn(prisma.scrapeJob, "updateMany")
        .mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
        id,
        data_source_id: `ds-${id}`,
      } as never);
      vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
      vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
      return updateMany;
    }

    it("persists the durable observation before evaluating sufficiency and retains snapshot path, hashes, and canonical URL", async () => {
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        canonicalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: chromeOnlyContent,
      });
      const updateMany = mockCrawlJob("scrape-job-insufficient");
      const enqueue = vi.spyOn(JobQueueService, "enqueue");
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-insufficient",
          url: requestedUrl,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow(/EXTRACTION_INPUT_REJECTED/);

      // Durable evidence was written before the boundary ran...
      expect(
        EvidenceArtifactStorageService.persistObservation,
      ).toHaveBeenCalledOnce();
      // ...and its provenance was committed to the ScrapeJob.
      const provenanceCall = updateMany.mock.calls.find(
        ([call]) =>
          call.data.snapshot_path ===
          "supabase://savvyedge-evidence/v1/observation.html",
      );
      expect(provenanceCall?.[0]).toMatchObject({
        where: { id: "scrape-job-insufficient", retry_count: 0 },
        data: {
          snapshot_path: "supabase://savvyedge-evidence/v1/observation.html",
          html_hash: "test-html-sha256-hash",
          content_hash: "test-content-sha256-hash",
          canonical_url: requestedUrl,
        },
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("never enqueues EXTRACT_BONUS for insufficient BONUS input", async () => {
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: chromeOnlyContent,
      });
      mockCrawlJob("scrape-job-no-enqueue");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const enqueue = vi.spyOn(JobQueueService, "enqueue");

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-no-enqueue",
          url: requestedUrl,
          casinoId: "casino-id",
          taskContext: "BONUS",
        }),
      ).rejects.toThrow(/EXTRACTION_INPUT_REJECTED/);

      expect(enqueue).not.toHaveBeenCalled();
    });

    it("records a bounded machine-readable failure code with no raw content or URL", async () => {
      mockScraperResult({
        requestedUrl:
          "https://admin:secret-pass@casino.example.com/promotions/welcome/?api_key=secret-key-123",
        finalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: chromeOnlyContent,
      });
      mockCrawlJob("scrape-job-bounded-error");
      vi.spyOn(JobQueueService, "enqueue");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const updateMany = vi
        .spyOn(prisma.scrapeJob, "updateMany")
        .mockResolvedValue({ count: 1 });

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-bounded-error",
          url: requestedUrl,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow(/EXTRACTION_INPUT_REJECTED/);

      const failureWrite = updateMany.mock.calls.find(
        (call) => (call[0] as { data?: { status?: string } }).data?.status === "FAILED",
      );
      expect(failureWrite).toBeDefined();
      const errorLog = (
        failureWrite![0] as { data: { error_log: string } }
      ).data.error_log;

      expect(JSON.parse(errorLog)).toEqual({
        code: "EXTRACTION_INPUT_INSUFFICIENT",
        category: "INSUFFICIENT_CONTENT",
        reason: expect.any(String),
      });
      expect(errorLog.length).toBeLessThanOrEqual(300);
      for (const secret of [
        "secret-pass",
        "api_key",
        "secret-key-123",
        "casino.example.com",
        "https://",
        "Create account",
      ]) {
        expect(errorLog).not.toContain(secret);
      }
    });

    it("commits provenance and then refuses to enqueue EXTRACT_BONUS, in that order", async () => {
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: chromeOnlyContent,
      });
      const updateMany = mockCrawlJob("scrape-job-ordering");
      const enqueue = vi.spyOn(JobQueueService, "enqueue");
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-ordering",
          url: requestedUrl,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow(/EXTRACTION_INPUT_REJECTED/);

      // Ordering-sensitive: durable persistence and the provenance write both
      // happened, and the provenance write happened after persistence. If the
      // boundary ran earlier than specified, neither call would be recorded.
      const persistOrder =
        vi.mocked(EvidenceArtifactStorageService.persistObservation).mock
          .invocationCallOrder[0];
      const provenanceIndex = updateMany.mock.calls.findIndex(
        ([call]) =>
          call.data.snapshot_path ===
          "supabase://savvyedge-evidence/v1/observation.html",
      );
      const updateOrder = updateMany.mock.invocationCallOrder[provenanceIndex];
      expect(persistOrder).toBeGreaterThan(0);
      expect(updateOrder).toBeGreaterThan(persistOrder);

      // The one guarantee that matters at this boundary.
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("leaves GAME_LIST ungated: sparse input still follows the EXTRACT_GAME_LIST contract", async () => {
      // Text that the BONUS boundary would reject outright.
      const sparse = chromeOnlyContent;
      expect(
        evaluateExtractionInputSufficiency({
          content: sparse,
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);

      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        title: "Casino Games",
        content: sparse,
      });
      mockCrawlJob("scrape-job-gamelist-ungated");
      const paidFallback = vi.spyOn(
        (
          IngestionService as unknown as {
            scrapingAntFallbackService: {
              scrape: (url: string) => Promise<unknown>;
            };
          }
        ).scrapingAntFallbackService,
        "scrape",
      );
      const enqueue = vi
        .spyOn(JobQueueService, "enqueue")
        .mockResolvedValue({ id: "queue-job-id" } as never);

      await IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-gamelist-ungated",
        url: requestedUrl,
        casinoId: "casino-id",
        taskContext: "GAME_LIST",
      });

      expect(enqueue).toHaveBeenCalledOnce();
      expect(paidFallback).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledWith(
        "ingestion-queue",
        "EXTRACT_GAME_LIST",
        {
          scrapeJobId: "scrape-job-gamelist-ungated",
          url: requestedUrl,
          casinoId: "casino-id",
          scrapedContent: sparse,
        },
      );
    });

    it("leaves the canonical EXTRACT_BONUS payload contract unchanged for sufficient input", async () => {
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: "Get 300 FREE SPINS when you play £30 on slots",
      });
      mockCrawlJob("scrape-job-sufficient");
      const enqueue = vi
        .spyOn(JobQueueService, "enqueue")
        .mockResolvedValue({ id: "queue-job-id" } as never);

      await IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-sufficient",
        url: requestedUrl,
        taskContext: "BONUS",
      });

      expect(enqueue).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledWith(
        "ingestion-queue",
        "EXTRACT_BONUS",
        {
          scrapeJobId: "scrape-job-sufficient",
          url: requestedUrl,
          casinoId: undefined,
          scrapedContent: "Get 300 FREE SPINS when you play £30 on slots",
          scrapedMetadata: { title: "Welcome Bonus" },
          observedAt: OBSERVED_AT.toISOString(),
        },
        { deduplicate: true },
      );
    });

    it("accepts a terse but real offer, so the boundary does not over-reject", async () => {
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        title: "Welcome Bonus",
        content: "100% deposit match up to $500",
      });
      mockCrawlJob("scrape-job-terse");
      const enqueue = vi
        .spyOn(JobQueueService, "enqueue")
        .mockResolvedValue({ id: "queue-job-id" } as never);

      await IngestionService.handleCrawl({
        scrapeJobId: "scrape-job-terse",
        url: requestedUrl,
        taskContext: "BONUS",
      });

      expect(enqueue).toHaveBeenCalledOnce();
      expect(enqueue.mock.calls[0][1]).toBe("EXTRACT_BONUS");
    });
  });

  describe("insufficient BONUS input on the canonical queue retry path", () => {
    const insufficientError = () =>
      new ExtractionInputRejectedError({
        sufficient: false,
        category: "INSUFFICIENT_CONTENT",
        reason:
          "The rendered page text is too sparse or carries no offer-detail evidence for extraction.",
      });

    function claimCrawlJob(attempts: number, maxAttempts: number) {
      vi.spyOn(prisma, "$transaction").mockResolvedValueOnce({
        id: "crawl-insufficient-retry",
        queue_name: "ingestion-queue",
        task_type: "CRAWL_URL",
        payload: JSON.stringify({
          scrapeJobId: "scrape-job-insufficient-retry",
          url: "https://casino.example.com/promotions/welcome/",
          taskContext: "BONUS",
        }),
        status: "PROCESSING",
        priority: "NORMAL",
        domain: "casino.example.com",
        worker_id: "worker-insufficient",
        attempts,
        max_attempts: maxAttempts,
        run_at: new Date(),
        locked_until: new Date(Date.now() + 60_000),
      } as never);
    }

    it.each([
      ["non-final attempt", 1, 3, "PENDING", true],
      ["final attempt", 3, 3, "FAILED", false],
    ])(
      "%s produces queue status %s",
      async (_label, attempts, maxAttempts, expectedStatus, expectBackoff) => {
        claimCrawlJob(attempts as number, maxAttempts as number);
        const queueWrite = vi
          .spyOn(prisma.jobQueue, "updateMany")
          .mockResolvedValue({ count: 1 });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const before = Date.now();

        expect(
          await JobQueueService.processNextJob(
            "ingestion-queue",
            { CRAWL_URL: vi.fn().mockRejectedValue(insufficientError()) },
            { workerId: "worker-insufficient" },
          ),
        ).toBe(true);

        const terminal = queueWrite.mock.calls.at(-1)![0] as {
          data: { status: string; run_at?: Date; error_log: string };
        };
        expect(terminal.data.status).toBe(expectedStatus);

        if (expectBackoff) {
          // Exponential backoff: 2^attempts seconds.
          expect(terminal.data.run_at).toBeInstanceOf(Date);
          expect(terminal.data.run_at!.getTime()).toBeGreaterThanOrEqual(
            before + Math.pow(2, attempts as number) * 1000 - 50,
          );
        } else {
          expect(terminal.data.run_at).toBeUndefined();
        }

        // Queue-side error log carries the error *name* only.
        expect(terminal.data.error_log).toBe(
          "Job handler execution failed (ExtractionInputRejectedError)",
        );
        for (const leak of [
          "casino.example.com",
          "https://",
          "Create account",
          "secret",
          "api_key",
          "sparse",
        ]) {
          expect(terminal.data.error_log).not.toContain(leak);
        }
      },
    );

    it("ends the ScrapeJob FAILED with a bounded code while provenance survives", async () => {
      const requestedUrl = "https://casino.example.com/promotions/welcome/";
      mockScraperResult({
        requestedUrl,
        finalUrl: requestedUrl,
        canonicalUrl: requestedUrl,
        title: "Welcome Bonus",
        content:
          "Home Sports Casino Live Casino Promotions Bonuses Help About Us " +
          "Apps Blog Log in Create account",
      });
      vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
        id: "scrape-job-terminal",
        data_source_id: "ds-terminal",
      } as never);
      vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
      vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
      const scrapeJobWrite = vi
        .spyOn(prisma.scrapeJob, "updateMany")
        .mockResolvedValue({ count: 1 });
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-terminal",
          url: requestedUrl,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow(/EXTRACTION_INPUT_REJECTED/);

      // Provenance written before the boundary and never rolled back.
      const provenance = scrapeJobWrite.mock.calls.find(
        ([call]) =>
          call.data.snapshot_path ===
          "supabase://savvyedge-evidence/v1/observation.html",
      );
      expect(provenance?.[0]).toMatchObject({
        where: { id: "scrape-job-terminal", retry_count: 0 },
        data: {
          snapshot_path: "supabase://savvyedge-evidence/v1/observation.html",
          html_hash: "test-html-sha256-hash",
          content_hash: "test-content-sha256-hash",
          canonical_url: requestedUrl,
        },
      });

      const failure = scrapeJobWrite.mock.calls
        .map((c) => c[0] as { data: { status?: string; error_log?: string } })
        .find((c) => c.data.status === "FAILED");
      expect(failure).toBeDefined();
      expect(JSON.parse(failure!.data.error_log!)).toEqual({
        code: "EXTRACTION_INPUT_INSUFFICIENT",
        category: "INSUFFICIENT_CONTENT",
        reason: expect.any(String),
      });
      // The terminal write touches status/error_log/completed_at only, so the
      // snapshot path, hashes and canonical URL persist for diagnosis.
      expect(Object.keys(failure!.data).sort()).toEqual([
        "completed_at",
        "error_log",
        "status",
      ]);
    });
  });

  it("propagates a persistence failure into the canonical queue retry path", async () => {
    const claimedJob = {
      id: "crawl-storage-retry",
      queue_name: "ingestion-queue",
      task_type: "CRAWL_URL",
      payload: JSON.stringify({
        scrapeJobId: "scrape-job-storage-retry",
        url: "https://casino.example.com/promotions/welcome/",
        taskContext: "BONUS",
      }),
      status: "PROCESSING",
      priority: "NORMAL",
      domain: "casino.example.com",
      worker_id: "worker-storage-retry",
      attempts: 1,
      max_attempts: 3,
      run_at: new Date(),
      locked_until: new Date(Date.now() + 60_000),
    };
    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce(claimedJob as never);
    const failure = vi
      .spyOn(
        JobQueueService as unknown as {
          handleJobFailure: (...args: unknown[]) => Promise<void>;
        },
        "handleJobFailure",
      )
      .mockResolvedValue(undefined);
    const handler = vi
      .fn()
      .mockRejectedValue(
        new EvidenceArtifactPersistenceError("PERSISTENCE_FAILED"),
      );

    expect(
      await JobQueueService.processNextJob(
        "ingestion-queue",
        { CRAWL_URL: handler },
        { workerId: "worker-storage-retry" },
      ),
    ).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith(
      "crawl-storage-retry",
      expect.objectContaining({ code: "PERSISTENCE_FAILED" }),
      1,
      3,
      "ingestion-queue",
      "worker-storage-retry",
    );
  });
});
