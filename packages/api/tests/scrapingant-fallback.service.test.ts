import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_EVIDENCE_ARTIFACT_SIZE_BYTES } from "../src/services/evidence-artifact-storage.service";
import {
  ScrapingAntFallbackError,
  ScrapingAntFallbackService,
} from "../src/services/scrapingant-fallback.service";

const API_KEY = "test-secret-api-key-never-persist";
const TARGET_URL = "https://casino.example.com/promotions/welcome";

function adapter(fetchImpl: typeof fetch, abortTimeoutMs = 65_000) {
  return new ScrapingAntFallbackService({
    env: { SCRAPINGANT_API_KEY: API_KEY },
    fetchImpl,
    abortTimeoutMs,
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
    [429, "PROVIDER_4XX"],
    [500, "PROVIDER_5XX"],
    [503, "PROVIDER_5XX"],
  ])(
    "maps HTTP %s without exposing the provider body",
    async (status, code) => {
      const response = new Response(`provider secret body ${API_KEY}`, {
        status,
      });
      await expect(
        adapter(vi.fn<typeof fetch>().mockResolvedValue(response)).scrape(
          TARGET_URL,
        ),
      ).rejects.toEqual(expect.objectContaining({ code }));
    },
  );

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

  it("fails statically when configuration is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new ScrapingAntFallbackService({ env: {}, fetchImpl });
    await expect(service.scrape(TARGET_URL)).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
