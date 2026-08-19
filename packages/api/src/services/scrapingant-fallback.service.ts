import { MAX_EVIDENCE_ARTIFACT_SIZE_BYTES } from "./evidence-artifact-storage.service";

export const SCRAPINGANT_V2_ENDPOINT = "https://api.scrapingant.com/v2/general";
export const SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS = 60;
export const SCRAPINGANT_ABORT_MARGIN_MS = 5_000;
export const SCRAPINGANT_ABORT_TIMEOUT_MS =
  SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS * 1_000 + SCRAPINGANT_ABORT_MARGIN_MS;

export type ScrapingAntFallbackErrorCode =
  | "CONFIGURATION_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_4XX"
  | "PROVIDER_5XX"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_RESPONSE";

export class ScrapingAntFallbackError extends Error {
  public constructor(public readonly code: ScrapingAntFallbackErrorCode) {
    super(`ScrapingAnt fallback failed (${code})`);
    this.name = "ScrapingAntFallbackError";
  }
}

export interface ScrapingAntFallbackResult {
  rawHtml: string;
  observedAt: Date;
}

export interface ScrapingAntFallbackServiceOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  abortTimeoutMs?: number;
}

function providerError(
  code: ScrapingAntFallbackErrorCode,
): ScrapingAntFallbackError {
  return new ScrapingAntFallbackError(code);
}

function validatedTargetUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw providerError("CONFIGURATION_ERROR");
    }
    return parsed.toString();
  } catch (error: unknown) {
    if (error instanceof ScrapingAntFallbackError) throw error;
    throw providerError("CONFIGURATION_ERROR");
  }
}

function decodeExactUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) {
      throw providerError("INVALID_RESPONSE");
    }
    return text;
  } catch (error: unknown) {
    if (error instanceof ScrapingAntFallbackError) throw error;
    throw providerError("INVALID_RESPONSE");
  }
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES
    ) {
      throw providerError(
        contentLength > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES
          ? "RESPONSE_TOO_LARGE"
          : "INVALID_RESPONSE",
      );
    }
  }

  if (!response.body) {
    throw providerError("INVALID_RESPONSE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw providerError("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error: unknown) {
    if (error instanceof ScrapingAntFallbackError) throw error;
    throw providerError("NETWORK_ERROR");
  }

  if (totalBytes === 0) {
    throw providerError("INVALID_RESPONSE");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeExactUtf8(bytes);
}

export class ScrapingAntFallbackService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly abortTimeoutMs: number;

  public constructor(options: ScrapingAntFallbackServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.abortTimeoutMs =
      options.abortTimeoutMs ?? SCRAPINGANT_ABORT_TIMEOUT_MS;
  }

  public async scrape(targetUrl: string): Promise<ScrapingAntFallbackResult> {
    const apiKey = this.env.SCRAPINGANT_API_KEY?.trim();
    if (!apiKey) {
      throw providerError("CONFIGURATION_ERROR");
    }
    const validatedUrl = validatedTargetUrl(targetUrl);

    // This URL is deliberately scoped to the adapter. It is secret-bearing
    // because v2 requires x-api-key as a query parameter. Never return it,
    // attach it to an Error, or pass it to logs, persistence or queue code.
    const requestUrl = new URL(SCRAPINGANT_V2_ENDPOINT);
    const query = new URLSearchParams();
    query.set("x-api-key", apiKey);
    query.set("url", validatedUrl);
    query.set("browser", "true");
    query.set("proxy_country", "GB");
    query.set("proxy_type", "residential");
    query.set("timeout", String(SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS));
    for (const resource of ["image", "media", "font"]) {
      query.append("block_resource", resource);
    }
    requestUrl.search = query.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.abortTimeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(requestUrl, {
          method: "GET",
          signal: controller.signal,
        });
      } catch {
        throw providerError(
          controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
        );
      }

      if (response.status >= 400 && response.status < 500) {
        throw providerError("PROVIDER_4XX");
      }
      if (response.status >= 500) {
        throw providerError("PROVIDER_5XX");
      }
      if (!response.ok) {
        throw providerError("INVALID_RESPONSE");
      }

      const rawHtml = await readBoundedResponseBody(response);
      if (rawHtml.includes(apiKey)) {
        throw providerError("INVALID_RESPONSE");
      }
      return { rawHtml, observedAt: new Date() };
    } finally {
      clearTimeout(timeout);
    }
  }
}
