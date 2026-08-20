import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_EVIDENCE_ARTIFACT_SIZE_BYTES } from "../src/services/evidence-artifact-storage.service";
import {
  SCRAPINGANT_ABORT_MARGIN_MS,
  SCRAPINGANT_MAX_PROVIDER_ATTEMPTS,
  SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES,
  SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS,
  SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS,
  SCRAPINGANT_RETRY_MIN_REMAINING_MS,
  SCRAPINGANT_RETRYABLE_STATUS,
  ScrapingAntFallbackError,
  ScrapingAntFallbackService,
} from "../src/services/scrapingant-fallback.service";

const API_KEY = "test-secret-api-key-never-persist";
/** Percent-encodes to something different from itself, unlike API_KEY. */
const ENCODABLE_API_KEY = "sk live/secret+key=value";
const TARGET_URL = "https://casino.example.com/promotions/welcome";
const ENCODED_TARGET_URL = encodeURIComponent(TARGET_URL);
const PROVIDER_REQUEST_URL =
  "https://api.scrapingant.com/v2/general?url=https%3A%2F%2Fcasino.example.com";

function adapter(
  fetchImpl: typeof fetch,
  abortTimeoutMs = 65_000,
  apiKey = API_KEY,
) {
  return new ScrapingAntFallbackService({
    env: { SCRAPINGANT_API_KEY: apiKey },
    fetchImpl,
    abortTimeoutMs,
  });
}

/** Runs one scrape against a stubbed response and returns the thrown error. */
async function scrapeError(
  response: Response,
  apiKey = API_KEY,
): Promise<ScrapingAntFallbackError> {
  try {
    await adapter(
      vi.fn<typeof fetch>().mockResolvedValue(response),
      65_000,
      apiKey,
    ).scrape(TARGET_URL);
  } catch (error) {
    return error as ScrapingAntFallbackError;
  }
  throw new Error("expected the adapter to reject");
}

/**
 * A body far larger than the read budget that reports how much of itself was
 * actually pulled and whether the reader was cancelled.
 */
function instrumentedBody(chunkSize: number, chunkCount: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunkCount) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new TextEncoder().encode("A".repeat(chunkSize)));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state, totalBytes: chunkSize * chunkCount };
}

/**
 * A body delivered as a single chunk that is a *view* onto a much larger
 * ArrayBuffer, the shape a pooled provider allocator produces. The surrounding
 * buffer is filled with a distinct byte so any over-read is visible.
 *
 * `closeAfterChunk: false` parks instead of closing, which is what makes
 * `cancel()` observable — a stream that has already ended swallows the cancel
 * as a no-op.
 */
function pooledViewBody(options: {
  bufferBytes: number;
  viewBytes: number;
  content: string;
  filler: string;
  closeAfterChunk: boolean;
}) {
  const backing = new ArrayBuffer(options.bufferBytes);
  const whole = new Uint8Array(backing);
  whole.fill(options.filler.charCodeAt(0));
  const view = new Uint8Array(backing, 0, options.viewBytes);
  view.fill(options.content.charCodeAt(0));

  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      if (state.pulled === 1) {
        controller.enqueue(view);
        return;
      }
      if (options.closeAfterChunk) controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state, view };
}

/**
 * Serves the given responses in order, then makes any further call fail loudly:
 * exceeding the attempt ceiling must never be silently absorbed.
 */
function sequencedFetch(...responses: Response[]) {
  const impl = vi.fn<typeof fetch>();
  for (const response of responses) impl.mockResolvedValueOnce(response);
  impl.mockImplementation(() => {
    throw new Error("provider called more times than the attempt ceiling");
  });
  return impl;
}

/** The rotation-critical query contract, asserted per attempt. */
function assertRotationQuery(call: unknown) {
  expect(call).toBeInstanceOf(URL);
  const url = call as URL;
  expect(`${url.origin}${url.pathname}`).toBe(
    "https://api.scrapingant.com/v2/general",
  );
  expect(url.searchParams.get("proxy_country")).toBe("GB");
  expect(url.searchParams.get("proxy_type")).toBe("residential");
  expect(url.searchParams.get("browser")).toBe("true");
  expect(url.searchParams.get("url")).toBe(TARGET_URL);
  expect(url.searchParams.getAll("block_resource")).toEqual([
    "image",
    "media",
    "font",
  ]);
}

/**
 * Everything about an attempt's query except its per-attempt provider timeout.
 * The credential is dropped so a mismatch can never print it.
 */
function rotationSignature(call: unknown): string {
  const url = call as URL;
  const params = new URLSearchParams(url.searchParams);
  params.delete("x-api-key");
  params.delete("timeout");
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${url.origin}${url.pathname}?${new URLSearchParams(sorted).toString()}`;
}

function providerTimeoutOf(call: unknown): number {
  return Number((call as URL).searchParams.get("timeout"));
}

/**
 * Replaces the monotonic clock with one the test advances explicitly, so
 * remaining-budget behaviour is exact instead of racing real elapsed time.
 */
function controllableClock() {
  const state = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => state.now);
  return state;
}

/** A 423 that advances the monotonic clock as the provider answers. */
function lockedAfter(clock: { now: number }, elapsedMs: number) {
  return async () => {
    clock.now = elapsedMs;
    return new Response("proxy locked", {
      status: SCRAPINGANT_RETRYABLE_STATUS,
    });
  };
}

/** The exact single-line shape the ingestion diagnostic log interpolates. */
function diagnosticLogLine(error: ScrapingAntFallbackError): string {
  return `[IngestionService] [GeoFallback] Provider failure for job job-1: code=${error.code} httpStatus=${error.httpStatus ?? "n/a"} detail=${error.providerDetail ?? "n/a"}`;
}

/**
 * Full inspectable surface of a thrown adapter error, including the
 * non-enumerable Error fields that JSON.stringify alone would omit.
 */
function errorSurface(error: unknown): string {
  const typed = error as Error & {
    code?: string;
    httpStatus?: number;
    providerDetail?: string;
    cause?: unknown;
  };
  return JSON.stringify({
    own: error,
    name: typed?.name,
    message: typed?.message,
    stack: typed?.stack,
    code: typed?.code,
    httpStatus: typed?.httpStatus,
    providerDetail: typed?.providerDetail,
    cause: typed?.cause,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ScrapingAnt v2 fallback adapter", () => {
  it("uses the exact v2 query contract and returns no request/Response object", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html><body>100% deposit match up to £500</body></html>", {
        status: 200,
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await adapter(fetchImpl).scrape(TARGET_URL);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const outbound = fetchImpl.mock.calls[0][0];
    expect(outbound).toBeInstanceOf(URL);
    const outboundUrl = outbound as URL;
    expect(`${outboundUrl.origin}${outboundUrl.pathname}`).toBe(
      "https://api.scrapingant.com/v2/general",
    );
    expect(outboundUrl.searchParams.get("x-api-key")).toBe(API_KEY);
    expect(outboundUrl.searchParams.get("url")).toBe(TARGET_URL);
    expect(outboundUrl.searchParams.get("browser")).toBe("true");
    expect(outboundUrl.searchParams.get("proxy_country")).toBe("GB");
    expect(outboundUrl.searchParams.get("proxy_type")).toBe("residential");
    expect(outboundUrl.searchParams.get("timeout")).toBe("60");
    expect(outboundUrl.searchParams.getAll("block_resource")).toEqual([
      "image",
      "media",
      "font",
    ]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(JSON.stringify(fetchImpl.mock.calls[0][1])).not.toContain(API_KEY);

    expect(result.rawHtml).toContain("deposit match");
    expect(result.observedAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("response");
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length without reading the body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = new Response("small", {
      status: 200,
      headers: {
        "content-length": String(MAX_EVIDENCE_ARTIFACT_SIZE_BYTES + 1),
      },
    });
    Object.defineProperty(response, "body", {
      value: { cancel },
    });
    const service = adapter(vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(service.scrape(TARGET_URL)).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("enforces the streaming byte cap when Content-Length is absent", async () => {
    const oversized = new Uint8Array(MAX_EVIDENCE_ARTIFACT_SIZE_BYTES + 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const response = new Response(body, { status: 200 });
    await expect(
      adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
        TARGET_URL,
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("maps timeout and native network failures to static errors", async () => {
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error(`native timeout ${API_KEY}`)),
          );
        }),
    );
    await expect(adapter(timeoutFetch, 5).scrape(TARGET_URL)).rejects.toEqual(
      expect.objectContaining({ code: "TIMEOUT" }),
    );

    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          `fetch failed https://api.scrapingant.com/?x-api-key=${API_KEY}`,
        ),
      );
    let caught: unknown;
    try {
      await adapter(networkFetch).scrape(TARGET_URL);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScrapingAntFallbackError);
    expect(caught).toMatchObject({ code: "NETWORK_ERROR" });
    const serialized = JSON.stringify({
      name: (caught as Error).name,
      message: (caught as Error).message,
      stack: (caught as Error).stack,
      code: (caught as ScrapingAntFallbackError).code,
      cause: (caught as Error & { cause?: unknown }).cause,
    });
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain("api.scrapingant.com");
    expect(serialized).not.toContain(TARGET_URL);
  });

  it.each([
    [401, "PROVIDER_4XX"],
    [403, "PROVIDER_4XX"],
    [429, "PROVIDER_4XX"],
    [500, "PROVIDER_5XX"],
    [503, "PROVIDER_5XX"],
  ])(
    "maps HTTP %s with its status and without exposing the provider body",
    async (status, code) => {
      const response = new Response(`provider secret body ${API_KEY}`, {
        status,
      });
      let caught: unknown;
      try {
        await adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
          TARGET_URL,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toEqual(
        expect.objectContaining({ code, httpStatus: status }),
      );
      // The credential can only reach the detail via a reflecting body, which
      // the adapter refuses rather than propagates.
      expect(
        (caught as ScrapingAntFallbackError).providerDetail,
      ).toBeUndefined();
      expect(errorSurface(caught)).not.toContain(API_KEY);
    },
  );

  it("captures a bounded provider detail from a JSON error body", async () => {
    const response = new Response(
      JSON.stringify({ detail: "Not enough API credits to fulfil request" }),
      { status: 403 },
    );
    let caught: unknown;
    try {
      await adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
        TARGET_URL,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScrapingAntFallbackError);
    expect(caught).toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: 403,
      providerDetail: "Not enough API credits to fulfil request",
    });
    expect(errorSurface(caught)).not.toContain(API_KEY);
    expect(errorSurface(caught)).not.toContain("api.scrapingant.com");
  });

  it.each([
    ["plain text", new Response("Forbidden", { status: 403 }), "Forbidden"],
    ["empty", new Response("", { status: 403 }), undefined],
    [
      "JSON without a detail field",
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
      '{"error":"forbidden"}',
    ],
    [
      "malformed JSON",
      new Response('{"detail": "truncated', { status: 403 }),
      '{"detail": "truncated',
    ],
  ])(
    "does not throw from detail capture for a %s body",
    async (_label, response, expected) => {
      let caught: unknown;
      try {
        await adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
          TARGET_URL,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ScrapingAntFallbackError);
      expect(caught).toMatchObject({ code: "PROVIDER_4XX", httpStatus: 403 });
      expect((caught as ScrapingAntFallbackError).providerDetail).toBe(
        expected,
      );
      expect(errorSurface(caught)).not.toContain(API_KEY);
    },
  );

  it("bounds an oversized provider detail to 500 characters", async () => {
    const error = await scrapeError(
      new Response("x".repeat(5_000), { status: 500 }),
    );
    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 500 });
    expect(error.providerDetail).toHaveLength(
      SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS,
    );
  });

  it("stops and cancels a large streaming body at the read budget", async () => {
    const { stream, state, totalBytes } = instrumentedBody(512, 200);
    expect(totalBytes).toBeGreaterThan(SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES);
    // No Content-Length: the bound must come from the streaming read itself.
    const response = new Response(stream, { status: 502 });
    expect(response.headers.get("content-length")).toBeNull();

    const error = await scrapeError(response);

    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 502 });
    expect(error.providerDetail).toBe(
      "A".repeat(SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS),
    );
    expect(state.cancelled).toBe(true);
    // The complete body is never consumed: only enough chunks to fill the
    // byte budget are pulled, plus at most the stream's own read-ahead.
    expect(state.pulled).toBeLessThan(200);
    const budgetChunks = Math.ceil(SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES / 512);
    expect(state.pulled).toBeLessThanOrEqual(budgetChunks + 1);
  });

  it("bounds one oversized chunk to 500 characters and cancels the reader", async () => {
    const { stream, state, view } = pooledViewBody({
      bufferBytes: 1_048_576,
      viewBytes: 100_000,
      content: "A",
      filler: "Z",
      closeAfterChunk: false,
    });
    expect(view.byteLength).toBeGreaterThan(
      SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES,
    );

    const error = await scrapeError(new Response(stream, { status: 502 }));

    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 502 });
    expect(error.providerDetail).toBe(
      "A".repeat(SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS),
    );
    // One chunk filled the budget. The only further pull is the stream's own
    // read-ahead; the reader itself never asked for more and then cancelled.
    expect(state.pulled).toBeLessThanOrEqual(2);
    expect(state.cancelled).toBe(true);
  });

  it("reads only a small view, never its much larger backing buffer", async () => {
    // 32 diagnostic bytes handed out as a view onto 1 MiB of pooled memory.
    const { stream, view } = pooledViewBody({
      bufferBytes: 1_048_576,
      viewBytes: 32,
      content: "A",
      filler: "Z",
      closeAfterChunk: true,
    });
    expect(view.buffer.byteLength).toBe(1_048_576);

    const error = await scrapeError(new Response(stream, { status: 500 }));

    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 500 });
    // Exactly the view's own bytes: none of the surrounding 1 MiB is read,
    // and the diagnostic stays far inside the bound.
    expect(error.providerDetail).toBe("A".repeat(32));
    expect(error.providerDetail).not.toContain("Z");
    expect((error.providerDetail as string).length).toBeLessThanOrEqual(
      SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS,
    );
  });

  it("stops decoding at the byte budget, before a later JSON field", async () => {
    // `detail` sits past the byte budget. Only a reader that truly stops at the
    // budget fails to parse the prefix as JSON and falls back to raw text; a
    // reader that buffered the whole body would surface the field instead.
    const padding = "P".repeat(SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES);
    const body = JSON.stringify({ padding, detail: "LATE-DETAIL-FIELD" });
    expect(body.length).toBeGreaterThan(SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES);

    const error = await scrapeError(new Response(body, { status: 500 }));

    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 500 });
    expect(error.providerDetail).not.toContain("LATE-DETAIL-FIELD");
    expect(error.providerDetail).toHaveLength(
      SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS,
    );
    expect(error.providerDetail?.startsWith('{"padding":"PPP')).toBe(true);
  });

  it("keeps the provider classification when the body cannot be read", async () => {
    const response = new Response("provider explanation", { status: 503 });
    // Lock the stream so the adapter's own getReader() throws.
    const lock = response.body?.getReader();
    expect(lock).toBeDefined();
    expect(response.bodyUsed || response.body?.locked).toBe(true);

    const error = await scrapeError(response);

    expect(error).toBeInstanceOf(ScrapingAntFallbackError);
    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 503 });
    expect(error.providerDetail).toBeUndefined();
    expect(error.message).toBe("ScrapingAnt fallback failed (PROVIDER_5XX)");
  });

  it("drops a detail that reflects the raw or URL-encoded credential", async () => {
    const raw = await scrapeError(
      new Response(`upstream rejected key ${API_KEY}`, { status: 403 }),
    );
    expect(raw).toMatchObject({ code: "PROVIDER_4XX", httpStatus: 403 });
    expect(raw.providerDetail).toBeUndefined();
    expect(errorSurface(raw)).not.toContain(API_KEY);

    const encodedKey = encodeURIComponent(ENCODABLE_API_KEY);
    expect(encodedKey).not.toBe(ENCODABLE_API_KEY);
    const encoded = await scrapeError(
      new Response(`query was x_api=${encodedKey}`, { status: 403 }),
      ENCODABLE_API_KEY,
    );
    expect(encoded.providerDetail).toBeUndefined();
    expect(errorSurface(encoded)).not.toContain(encodedKey);
    expect(errorSurface(encoded)).not.toContain(ENCODABLE_API_KEY);
  });

  it("drops a detail that names the x-api-key parameter at all", async () => {
    const error = await scrapeError(
      new Response('{"detail":"missing x-api-key parameter"}', { status: 401 }),
    );
    expect(error).toMatchObject({ code: "PROVIDER_4XX", httpStatus: 401 });
    expect(error.providerDetail).toBeUndefined();
    expect(errorSurface(error).toLowerCase()).not.toContain("x-api-key");
  });

  it("redacts the target URL, its encoded form, and reflected provider URLs", async () => {
    const error = await scrapeError(
      new Response(
        `Could not load ${TARGET_URL} (url=${ENCODED_TARGET_URL}) via ${PROVIDER_REQUEST_URL}`,
        { status: 422 },
      ),
    );

    expect(error).toMatchObject({ code: "PROVIDER_4XX", httpStatus: 422 });
    const surface = errorSurface(error);
    for (const secret of [
      TARGET_URL,
      ENCODED_TARGET_URL,
      "casino.example.com",
      "api.scrapingant.com",
      PROVIDER_REQUEST_URL,
    ]) {
      expect(surface).not.toContain(secret);
    }
    expect(error.providerDetail).toBe(
      "Could not load [redacted-url] (url=[redacted-url]) via [redacted-url]",
    );
  });

  it("redacts any absolute URL left in an otherwise safe detail", async () => {
    const error = await scrapeError(
      new Response('{"detail":"see http://status.example.net/incidents/42"}', {
        status: 503,
      }),
    );
    expect(error).toMatchObject({ code: "PROVIDER_5XX", httpStatus: 503 });
    expect(error.providerDetail).toBe("see [redacted-url]");
    expect(errorSurface(error)).not.toContain("status.example.net");
  });

  it("collapses CR, LF, NUL and control characters into one log line", async () => {
    const error = await scrapeError(
      new Response(
        "line one\r\n[IngestionService] forged second line\u0000\u0007\ttail",
        { status: 500 },
      ),
    );

    const detail = error.providerDetail as string;
    expect(detail).toBe("line one [IngestionService] forged second line tail");
    expect(detail).not.toMatch(/[\r\n\u0000-\u001F\u007F-\u009F]/);
    expect(diagnosticLogLine(error).split(/\r?\n/)).toHaveLength(1);
  });

  it("bounds the detail after sanitization, not before", async () => {
    const noisy = `${TARGET_URL}\n`.repeat(400);
    const error = await scrapeError(new Response(noisy, { status: 500 }));
    const detail = error.providerDetail as string;
    expect(detail.length).toBeLessThanOrEqual(
      SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS,
    );
    expect(detail).not.toContain(TARGET_URL);
    expect(detail).not.toMatch(/[\r\n]/);
    expect(detail.startsWith("[redacted-url]")).toBe(true);
  });

  it.each([
    new Response("", { status: 200 }),
    new Response("   \n", { status: 200 }),
    new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
  ])(
    "rejects empty, whitespace, and malformed UTF-8 bodies",
    async (response) => {
      await expect(
        adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
          TARGET_URL,
        ),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );

  it("rejects a response that reflects the required query credential", async () => {
    const response = new Response(`<html>${API_KEY}</html>`, { status: 200 });
    await expect(
      adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
        TARGET_URL,
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("derives the retry floor from the provider minimum plus the abort margin", () => {
    expect(SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS).toBe(5);
    expect(SCRAPINGANT_ABORT_MARGIN_MS).toBe(5_000);
    expect(SCRAPINGANT_RETRY_MIN_REMAINING_MS).toBe(
      SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS * 1_000 +
        SCRAPINGANT_ABORT_MARGIN_MS,
    );
    // Pinned explicitly: the boundary tests below are written relative to this
    // constant, so only a literal keeps them from moving with a regression.
    expect(SCRAPINGANT_RETRY_MIN_REMAINING_MS).toBe(10_000);
    expect(SCRAPINGANT_MAX_PROVIDER_ATTEMPTS).toBe(2);
    expect(SCRAPINGANT_RETRYABLE_STATUS).toBe(423);
  });

  it("retries exactly once on 423 and succeeds on the fresh IP", async () => {
    const fetchImpl = sequencedFetch(
      new Response("proxy locked", { status: SCRAPINGANT_RETRYABLE_STATUS }),
      new Response("<html><body>100% deposit match</body></html>", {
        status: 200,
      }),
    );

    const result = await adapter(fetchImpl).scrape(TARGET_URL);

    expect(result.rawHtml).toContain("deposit match");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Both attempts carry the identical rotation query, which is what makes
    // ScrapingAnt hand out a different residential IP.
    assertRotationQuery(fetchImpl.mock.calls[0][0]);
    assertRotationQuery(fetchImpl.mock.calls[1][0]);
    expect(rotationSignature(fetchImpl.mock.calls[1][0])).toBe(
      rotationSignature(fetchImpl.mock.calls[0][0]),
    );
  });

  it("stops at the attempt ceiling when the retry is also 423", async () => {
    const fetchImpl = sequencedFetch(
      new Response("proxy locked", { status: SCRAPINGANT_RETRYABLE_STATUS }),
      new Response('{"detail":"IP is still locked"}', {
        status: SCRAPINGANT_RETRYABLE_STATUS,
      }),
    );

    let caught: unknown;
    try {
      await adapter(fetchImpl).scrape(TARGET_URL);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScrapingAntFallbackError);
    // On this path PROVIDER_FAILED follows the attempt ceiling; it may also
    // follow a retry skipped for insufficient remaining budget.
    expect(caught).toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: SCRAPINGANT_RETRYABLE_STATUS,
      providerDetail: "IP is still locked",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(SCRAPINGANT_MAX_PROVIDER_ATTEMPTS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(errorSurface(caught)).not.toContain(API_KEY);
  });

  it.each([400, 403, 404, 422, 429, 500, 502, 503])(
    "never retries HTTP %s",
    async (status) => {
      const fetchImpl = sequencedFetch(
        new Response("provider said no", { status }),
      );

      let caught: unknown;
      try {
        await adapter(fetchImpl).scrape(TARGET_URL);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ httpStatus: status });
      expect(caught).toMatchObject({
        code: status < 500 ? "PROVIDER_4XX" : "PROVIDER_5XX",
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("never retries a timeout or a native network failure", async () => {
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("native timeout")),
          );
        }),
    );
    await expect(adapter(timeoutFetch, 5).scrape(TARGET_URL)).rejects.toEqual(
      expect.objectContaining({ code: "TIMEOUT" }),
    );
    expect(timeoutFetch).toHaveBeenCalledOnce();

    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("fetch failed"));
    await expect(adapter(networkFetch).scrape(TARGET_URL)).rejects.toEqual(
      expect.objectContaining({ code: "NETWORK_ERROR" }),
    );
    expect(networkFetch).toHaveBeenCalledOnce();
  });

  it("does not issue the retry when the shared envelope is nearly gone", async () => {
    const fetchImpl = sequencedFetch(
      new Response("proxy locked", { status: SCRAPINGANT_RETRYABLE_STATUS }),
      new Response("<html><body>never reached</body></html>", { status: 200 }),
    );

    // A total envelope below the retry floor: the second request could not
    // finish, so it is never sent.
    await expect(
      adapter(fetchImpl, 1_000).scrape(TARGET_URL),
    ).rejects.toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: SCRAPINGANT_RETRYABLE_STATUS,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("asks the provider only for the time the retry still has", async () => {
    const clock = controllableClock();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(lockedAfter(clock, 40_000))
      .mockImplementationOnce(
        async () =>
          new Response("<html><body>fresh IP</body></html>", {
            status: 200,
          }),
      );

    const result = await adapter(fetchImpl).scrape(TARGET_URL);

    expect(result.rawHtml).toContain("fresh IP");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // First attempt owns the full 65s envelope: 60s provider + 5s margin.
    expect(providerTimeoutOf(fetchImpl.mock.calls[0][0])).toBe(60);
    // 25s remain, so the retry asks for 20s and keeps the same 5s margin.
    expect(providerTimeoutOf(fetchImpl.mock.calls[1][0])).toBe(
      (25_000 - SCRAPINGANT_ABORT_MARGIN_MS) / 1_000,
    );
    // Everything that drives IP rotation is byte-identical across attempts.
    expect(rotationSignature(fetchImpl.mock.calls[1][0])).toBe(
      rotationSignature(fetchImpl.mock.calls[0][0]),
    );
    assertRotationQuery(fetchImpl.mock.calls[1][0]);
  });

  it("clamps the retry timeout to the provider minimum at the floor", async () => {
    const clock = controllableClock();
    // Leave exactly the retry floor: provider minimum plus the abort margin.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        lockedAfter(clock, 65_000 - SCRAPINGANT_RETRY_MIN_REMAINING_MS),
      )
      .mockImplementationOnce(
        async () =>
          new Response("<html><body>fresh IP</body></html>", {
            status: 200,
          }),
      );

    const result = await adapter(fetchImpl).scrape(TARGET_URL);

    expect(result.rawHtml).toContain("fresh IP");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(providerTimeoutOf(fetchImpl.mock.calls[1][0])).toBe(
      SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS,
    );
  });

  it("refuses the retry one millisecond below the floor", async () => {
    const clock = controllableClock();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        lockedAfter(clock, 65_000 - SCRAPINGANT_RETRY_MIN_REMAINING_MS + 1),
      )
      .mockImplementationOnce(
        async () =>
          new Response("<html><body>never reached</body></html>", {
            status: 200,
          }),
      );

    await expect(adapter(fetchImpl).scrape(TARGET_URL)).rejects.toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: SCRAPINGANT_RETRYABLE_STATUS,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("ignores wall-clock jumps when measuring the shared envelope", async () => {
    const clock = controllableClock();
    // A wall clock that leaps an hour backwards would make a Date.now()-based
    // deadline look almost untouched; the monotonic envelope must not move.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow - 3_600_000);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        lockedAfter(clock, 65_000 - SCRAPINGANT_RETRY_MIN_REMAINING_MS + 1),
      )
      .mockImplementationOnce(
        async () =>
          new Response("<html><body>never reached</body></html>", {
            status: 200,
          }),
      );

    await expect(adapter(fetchImpl).scrape(TARGET_URL)).rejects.toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: SCRAPINGANT_RETRYABLE_STATUS,
    });
    // The envelope is exhausted on the monotonic clock, so no retry is issued
    // no matter what the wall clock claims.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps bounded, sanitized detail on a retried 423 body", async () => {
    const fetchImpl = sequencedFetch(
      new Response("proxy locked", { status: SCRAPINGANT_RETRYABLE_STATUS }),
      new Response(`locked for ${TARGET_URL} key=${API_KEY}`, {
        status: SCRAPINGANT_RETRYABLE_STATUS,
      }),
    );

    let caught: unknown;
    try {
      await adapter(fetchImpl).scrape(TARGET_URL);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "PROVIDER_4XX",
      httpStatus: SCRAPINGANT_RETRYABLE_STATUS,
    });
    // The reflected credential still collapses the whole detail.
    expect((caught as ScrapingAntFallbackError).providerDetail).toBeUndefined();
    expect(errorSurface(caught)).not.toContain(API_KEY);
    expect(errorSurface(caught)).not.toContain(TARGET_URL);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails statically when configuration is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new ScrapingAntFallbackService({ env: {}, fetchImpl });
    await expect(service.scrape(TARGET_URL)).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
