import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import {
  classifyErrorForLogging,
  IngestionService,
  sanitizeUrlForLogging,
} from "../src/services/ingestion.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { SourcePageRejectedError } from "../src/services/source-page-eligibility";

describe("Ingestion Logging Sanitization (Boundary B2)", () => {
  const SENSITIVE_URL =
    "https://admin:super-secret-password-999@promotions.example.com:8443/exclusive/welcome?api_key=secret-key-123&token=very-secret-token#private-section";
  const SYNTHETIC_SECRET_ERROR = new Error(
    "DATABASE_URL=postgresql://admin:super-secret@internal-db:5432/savvy and token=very-secret-token",
  );
  SYNTHETIC_SECRET_ERROR.stack =
    "Error: DATABASE_URL=postgresql://admin:super-secret@internal-db:5432/savvy\n  at /path/to/secret.ts:1:1";

  beforeEach(() => {
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({
      id: "queue-job-id",
    } as never);
    vi.spyOn(prisma.dataSource, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.dataSource, "create").mockResolvedValue({
      id: "ds-id",
      url: SENSITIVE_URL,
    } as never);
    vi.spyOn(prisma.dataSource, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "create").mockResolvedValue({
      id: "scrape-job-id",
      status: "PROCESSING",
    } as never);
    vi.spyOn(prisma.scrapeJob, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.scrapeJob, "findUniqueOrThrow").mockResolvedValue({
      id: "scrape-job-id",
      data_source_id: "ds-id",
    } as never);
    vi.spyOn(prisma.scrapeJob, "findFirst").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("URL Sanitizer Utility", () => {
    it("strips user credentials, query parameters, path, and hash fragments from URLs", () => {
      const sanitized = sanitizeUrlForLogging(SENSITIVE_URL);
      expect(sanitized).toBe("https://promotions.example.com:8443");
      expect(sanitized).not.toContain("super-secret-password");
      expect(sanitized).not.toContain("admin");
      expect(sanitized).not.toContain("api_key");
      expect(sanitized).not.toContain("secret-key-123");
      expect(sanitized).not.toContain("very-secret-token");
      expect(sanitized).not.toContain("private-section");
    });

    it("handles standard valid URLs without modifying protocol and host", () => {
      expect(sanitizeUrlForLogging("https://example.com/promotions")).toBe(
        "https://example.com",
      );
      expect(sanitizeUrlForLogging("http://sub.domain.org:3000/test")).toBe(
        "http://sub.domain.org:3000",
      );
    });

    it("safely strips credentials from connection strings parsed as URLs", () => {
      const sanitized = sanitizeUrlForLogging(
        "postgresql://admin:super-secret@internal-db:5432/savvy",
      );
      expect(sanitized).toBe("postgresql://internal-db:5432");
      expect(sanitized).not.toContain("admin");
      expect(sanitized).not.toContain("super-secret");
      expect(sanitized).not.toContain("savvy");
    });

    it("returns bounded placeholder for invalid or missing URLs", () => {
      expect(sanitizeUrlForLogging("not a valid url")).toBe("<invalid-url>");
      expect(sanitizeUrlForLogging("")).toBe("<unknown-url>");
      expect(sanitizeUrlForLogging(undefined)).toBe("<unknown-url>");
      expect(sanitizeUrlForLogging(null)).toBe("<unknown-url>");
    });
  });

  describe("Error Classifier Utility", () => {
    it("classifies SourcePageRejectedError as SOURCE_PAGE_REJECTED", () => {
      const rejectedError = new SourcePageRejectedError(
        {
          requestedUrl: "https://example.com",
          finalUrl: "https://example.com",
          title: "403 Forbidden",
          content: "Access Denied",
        },
        {
          eligible: false,
          category: "GEO_RESTRICTED",
          reason: "Location blocked",
        },
      );
      expect(classifyErrorForLogging(rejectedError)).toBe(
        "SOURCE_PAGE_REJECTED",
      );
    });

    it("classifies allowed standard Error types by name", () => {
      expect(classifyErrorForLogging(new TypeError("test"))).toBe("TypeError");
      expect(classifyErrorForLogging(new RangeError("test"))).toBe("RangeError");
      expect(classifyErrorForLogging(new SyntaxError("test"))).toBe("SyntaxError");
      expect(classifyErrorForLogging(new ReferenceError("test"))).toBe("ReferenceError");
      expect(classifyErrorForLogging(new Error("test"))).toBe("Error");
    });

    it("collapses custom or secret-bearing Error.name to bounded 'Error' category", () => {
      const customSecretError = new Error(
        "DATABASE_URL=postgresql://admin:message-secret@internal-db/test",
      );
      customSecretError.name =
        "CUSTOM_SECRET_DATABASE_URL=postgresql://admin:name-secret@internal-db/test";

      const classified = classifyErrorForLogging(customSecretError);
      expect(classified).toBe("Error");
      expect(classified).not.toContain("CUSTOM_SECRET");
      expect(classified).not.toContain("name-secret");
      expect(classified).not.toContain("postgresql");
      expect(classified).not.toContain("DATABASE_URL");
    });

    it("classifies non-Error values as UnknownError", () => {
      expect(classifyErrorForLogging("string error")).toBe("UnknownError");
      expect(classifyErrorForLogging(null)).toBe("UnknownError");
      expect(classifyErrorForLogging(undefined)).toBe("UnknownError");
      expect(classifyErrorForLogging({ name: "ArbitraryObject" })).toBe("UnknownError");
    });
  });

  describe("Ingestion Pipeline Runtime Logging Sanitization", () => {
    it("sanitizes URL in enqueueIngestion logging", async () => {
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      await IngestionService.enqueueIngestion({
        url: SENSITIVE_URL,
        taskContext: "BONUS",
      });

      expect(logSpy).toHaveBeenCalled();
      for (const call of logSpy.mock.calls) {
        const loggedText = call.join(" ");
        expect(loggedText).not.toContain("admin");
        expect(loggedText).not.toContain("super-secret-password-999");
        expect(loggedText).not.toContain("secret-key-123");
        expect(loggedText).not.toContain("very-secret-token");
        expect(loggedText).toContain("https://promotions.example.com:8443");
        expect(loggedText).toContain("[IngestionService] Enqueueing ingestion");
      }
    });

    it("sanitizes URL and classifies error in performCrawl on scraper failure without leaking credentials", async () => {
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.spyOn(
        (
          IngestionService as unknown as {
            scraperAgent: { run: (input: unknown) => Promise<unknown> };
          }
        ).scraperAgent,
        "run",
      ).mockRejectedValue(SYNTHETIC_SECRET_ERROR);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-id",
          url: SENSITIVE_URL,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow();

      // Check console.log (start of crawl)
      expect(logSpy).toHaveBeenCalled();
      for (const call of logSpy.mock.calls) {
        const loggedText = call.join(" ");
        expect(loggedText).not.toContain("super-secret-password-999");
        expect(loggedText).not.toContain("secret-key-123");
        expect(loggedText).not.toContain("very-secret-token");
      }

      // Check console.error (crawl failure)
      expect(errorSpy).toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        const loggedText = call.join(" ");
        expect(loggedText).not.toContain("super-secret");
        expect(loggedText).not.toContain("super-secret-password-999");
        expect(loggedText).not.toContain("postgresql://admin");
        expect(loggedText).not.toContain("very-secret-token");
        expect(loggedText).not.toContain("DATABASE_URL");
        expect(loggedText).not.toContain("internal-db:5432");

        // Operational context must still be present
        expect(loggedText).toContain(
          "[IngestionService] [Worker] Crawl failed for URL: https://promotions.example.com:8443",
        );
        expect(loggedText).toContain("(Error)");
      }
    });

    it("does not leak secrets when an Error contains malicious/secret-bearing Error.name and message", async () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const maliciousSecretError = new Error(
        "DATABASE_URL=postgresql://admin:message-secret@internal-db/test",
      );
      maliciousSecretError.name =
        "CUSTOM_SECRET_DATABASE_URL=postgresql://admin:name-secret@internal-db/test";
      maliciousSecretError.stack =
        "Error: stack-secret at /internal/secrets.ts:1:1";

      vi.spyOn(
        (
          IngestionService as unknown as {
            scraperAgent: { run: (input: unknown) => Promise<unknown> };
          }
        ).scraperAgent,
        "run",
      ).mockRejectedValue(maliciousSecretError);

      await expect(
        IngestionService.handleCrawl({
          scrapeJobId: "scrape-job-id",
          url: SENSITIVE_URL,
          taskContext: "BONUS",
        }),
      ).rejects.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      const allErrors = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");

      // Assert all secret components are excluded
      expect(allErrors).not.toContain("message-secret");
      expect(allErrors).not.toContain("name-secret");
      expect(allErrors).not.toContain("stack-secret");
      expect(allErrors).not.toContain("CUSTOM_SECRET");
      expect(allErrors).not.toContain("postgresql://admin");
      expect(allErrors).not.toContain("DATABASE_URL=");

      // Assert bounded fallback classification is used
      expect(allErrors).toContain("(Error)");
      expect(allErrors).toContain("https://promotions.example.com:8443");
    });

    it("sanitizes URL in performExtraction logging without leaking credentials", async () => {
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      vi.spyOn(
        (
          IngestionService as unknown as {
            casinoResolutionAgent: {
              run: (input: unknown) => Promise<unknown>;
            };
          }
        ).casinoResolutionAgent,
        "run",
      ).mockResolvedValue({
        name: "Safe Casino",
        slug: "safe-casino",
        domain: "promotions.example.com",
      });

      vi.spyOn(
        (
          IngestionService as unknown as {
            bonusAgent: { run: (input: unknown) => Promise<unknown> };
          }
        ).bonusAgent,
        "run",
      ).mockResolvedValue({
        type: "WELCOME",
        headline_value: "100% Match",
      });

      vi.spyOn(
        IngestionService as unknown as {
          runGovernedPersistenceTransaction: (
            op: unknown,
          ) => Promise<{ casino: unknown; bonus: unknown; evidence: unknown }>;
        },
        "runGovernedPersistenceTransaction",
      ).mockResolvedValue({
        casino: { id: "c-1" },
        bonus: { id: "b-1" },
        evidence: {},
      });

      await IngestionService.handleExtraction({
        scrapeJobId: "scrape-job-id",
        url: SENSITIVE_URL,
        scrapedContent: "Bonus offer text",
      });

      expect(logSpy).toHaveBeenCalled();
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allLogs).not.toContain("super-secret-password-999");
      expect(allLogs).not.toContain("secret-key-123");
      expect(allLogs).not.toContain("very-secret-token");
      expect(allLogs).toContain(
        "[IngestionService] [Worker] Extracting entities for URL: https://promotions.example.com:8443",
      );
    });

    it("sanitizes URL in performGameListExtraction logging without leaking credentials", async () => {
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      vi.spyOn(
        (
          IngestionService as unknown as {
            gameListAgent: { run: (input: unknown) => Promise<unknown> };
          }
        ).gameListAgent,
        "run",
      ).mockResolvedValue({
        games: [{ name: "Starburst" }],
      });

      vi.spyOn(prisma.slot, "findMany").mockResolvedValue([]);

      await IngestionService.handleGameListExtraction({
        scrapeJobId: "scrape-job-id",
        url: SENSITIVE_URL,
        casinoId: "casino-uuid-1",
        scrapedContent: "Slots lobby text",
      });

      expect(logSpy).toHaveBeenCalled();
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allLogs).not.toContain("super-secret-password-999");
      expect(allLogs).not.toContain("secret-key-123");
      expect(allLogs).not.toContain("very-secret-token");
      expect(allLogs).toContain(
        "[IngestionService] [Worker] Extracting game list for Casino casino-uuid-1 from URL: https://promotions.example.com:8443",
      );
    });
  });
});
