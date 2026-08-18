import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IngestionService } from "@savvyedge/api";
import { IngestionEnqueueService } from "@savvyedge/api/ingestion-entrypoint";
import { POST } from "../../../apps/web/src/app/api/v1/ingestion/jobs/route";

const endpoint = "http://localhost/api/v1/ingestion/jobs";
const secret = "test-internal-api-secret";

function request(body: unknown, authorization?: string) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function rawRequest(bodyText: string, authorization?: string) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: bodyText,
  });
}

describe("POST /api/v1/ingestion/jobs", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = secret;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = originalSecret;
    }
  });

  it("returns 401 when authentication is missing", async () => {
    const enqueue = vi.spyOn(IngestionEnqueueService, "enqueueIngestion");

    const response = await POST(request({ url: "https://example.com/bonus" }));

    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns 403 when authentication is invalid", async () => {
    const enqueue = vi.spyOn(IngestionEnqueueService, "enqueueIngestion");

    const response = await POST(
      request({ url: "https://example.com/bonus" }, "Bearer invalid-secret"),
    );

    expect(response.status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns 400 when request body contains malformed JSON", async () => {
    const enqueue = vi.spyOn(IngestionEnqueueService, "enqueueIngestion");

    const response = await POST(
      rawRequest("{" + "invalid-json", `Bearer ${secret}`),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({
      error: { message: "Validation error", details: "Invalid JSON body" },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    [{ url: "not-a-url" }, "invalid URL"],
    [{ url: "ftp://example.com/bonus" }, "non-http/https URL"],
    [
      { url: "https://example.com/bonus", casino_id: "not-a-uuid" },
      "invalid casino_id UUID",
    ],
    [
      { url: "https://example.com/games", taskContext: "GAME_LIST" },
      "GAME_LIST without casino_id",
    ],
    [
      {
        url: "https://example.com/bonus",
        taskContext: "UNSUPPORTED",
      },
      "invalid taskContext",
    ],
  ])("returns 400 for %s (%s)", async (body) => {
    const enqueue = vi.spyOn(IngestionEnqueueService, "enqueueIngestion");

    const response = await POST(request(body, `Bearer ${secret}`));

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns 202 for a valid request with omitted taskContext", async () => {
    const scrapeJob = {
      id: "scrape-job-default-id",
      status: "PENDING",
    };
    const enqueue = vi
      .spyOn(IngestionEnqueueService, "enqueueIngestion")
      .mockResolvedValue(scrapeJob as never);

    const response = await POST(
      request({ url: "https://example.com/bonus" }, `Bearer ${secret}`),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({ url: "https://example.com/bonus" });
    expect(json).toMatchObject({
      data: { scrapeJob },
      meta: { accepted: true, execution: "asynchronous", queueTask: "CRAWL_URL" },
      error: null,
    });
  });

  it("returns 202 for a valid BONUS ingestion request", async () => {
    const scrapeJob = {
      id: "scrape-job-bonus-id",
      data_source_id: "data-source-id",
      status: "PENDING",
      started_at: new Date("2026-08-01T10:00:00.000Z"),
      completed_at: null,
      error_log: null,
      snapshot_path: null,
      retry_count: 0,
      html_hash: null,
      content_hash: null,
      canonical_url: null,
    };
    const enqueue = vi
      .spyOn(IngestionEnqueueService, "enqueueIngestion")
      .mockResolvedValue(scrapeJob);

    const response = await POST(
      request(
        {
          url: "https://example.com/promotions/welcome",
          taskContext: "BONUS",
        },
        `Bearer ${secret}`,
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({
      url: "https://example.com/promotions/welcome",
      taskContext: "BONUS",
    });
    expect(json).toMatchObject({
      data: {
        scrapeJob: {
          id: "scrape-job-bonus-id",
          status: "PENDING",
        },
      },
      meta: {
        accepted: true,
        execution: "asynchronous",
        queueTask: "CRAWL_URL",
      },
      error: null,
    });
  });

  it("returns 202 with the queued ScrapeJob and does not execute ingestion inline", async () => {
    const scrapeJob = {
      id: "scrape-job-id",
      data_source_id: "data-source-id",
      status: "PENDING",
      started_at: new Date("2026-07-31T10:00:00.000Z"),
      completed_at: null,
      error_log: null,
      snapshot_path: null,
      retry_count: 0,
      html_hash: null,
      content_hash: null,
      canonical_url: null,
    };
    const enqueue = vi
      .spyOn(IngestionEnqueueService, "enqueueIngestion")
      .mockResolvedValue(scrapeJob);
    const synchronousIngestion = vi.spyOn(
      IngestionService,
      "ingestBonusFromUrl",
    );

    const response = await POST(
      request(
        {
          url: "https://example.com/games",
          casino_id: "00000000-0000-4000-8000-000000000001",
          taskContext: "GAME_LIST",
        },
        `Bearer ${secret}`,
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({
      url: "https://example.com/games",
      casino_id: "00000000-0000-4000-8000-000000000001",
      taskContext: "GAME_LIST",
    });
    expect(synchronousIngestion).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      data: {
        scrapeJob: {
          id: "scrape-job-id",
          status: "PENDING",
        },
      },
      meta: {
        accepted: true,
        execution: "asynchronous",
        queueTask: "CRAWL_URL",
      },
      error: null,
    });
  });

  it("returns 500 with generic sanitized error envelope and safe static server logs when enqueueing throws an unexpected error", async () => {
    const sensitiveError = new Error(
      "DATABASE_URL=postgresql://admin:secret@internal-db:5432/savvy",
    );
    const enqueue = vi
      .spyOn(IngestionEnqueueService, "enqueueIngestion")
      .mockRejectedValue(sensitiveError);
    const synchronousIngestion = vi.spyOn(
      IngestionService,
      "ingestBonusFromUrl",
    );
    const logSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      request({ url: "https://example.com/bonus" }, `Bearer ${secret}`),
    );
    const json = await response.json();
    const rawResponseBody = JSON.stringify(json);
    const rawLogCalls = JSON.stringify(logSpy.mock.calls);

    expect(response.status).toBe(500);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(synchronousIngestion).not.toHaveBeenCalled();
    expect(json).toEqual({
      data: null,
      meta: null,
      error: { message: "Internal server error" },
    });
    expect(rawResponseBody).not.toContain("DATABASE_URL");
    expect(rawResponseBody).not.toContain("postgresql://");
    expect(rawResponseBody).not.toContain("admin");
    expect(rawResponseBody).not.toContain("secret");
    expect(rawResponseBody).not.toContain("internal-db");
    expect(rawResponseBody).not.toContain("/savvy");
    expect(rawResponseBody).not.toContain(sensitiveError.message);

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(
      "[POST /api/v1/ingestion/jobs] Failed to enqueue asynchronous ingestion job",
    );
    expect(rawLogCalls).not.toContain("DATABASE_URL");
    expect(rawLogCalls).not.toContain("postgresql://");
    expect(rawLogCalls).not.toContain("admin");
    expect(rawLogCalls).not.toContain("secret");
    expect(rawLogCalls).not.toContain("internal-db");
    expect(rawLogCalls).not.toContain("/savvy");
    expect(rawLogCalls).not.toContain(sensitiveError.message);
  });
});
