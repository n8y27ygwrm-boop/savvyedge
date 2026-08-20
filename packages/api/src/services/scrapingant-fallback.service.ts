import { MAX_EVIDENCE_ARTIFACT_SIZE_BYTES } from "./evidence-artifact-storage.service";

export const SCRAPINGANT_V2_ENDPOINT = "https://api.scrapingant.com/v2/general";
export const SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS = 60;
export const SCRAPINGANT_ABORT_MARGIN_MS = 5_000;
export const SCRAPINGANT_ABORT_TIMEOUT_MS =
  SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS * 1_000 + SCRAPINGANT_ABORT_MARGIN_MS;

/**
 * HTTP 423 from ScrapingAnt reports an unsuccessful request: the assigned proxy
 * IP was detected or locked out by the target, not that the page is
 * unavailable. ScrapingAnt bills successful responses, so a 423 is not a
 * charged response. A new provider request triggers ScrapingAnt's per-request
 * proxy rotation while the same GB/residential/browser settings are preserved
 * (only the provider timeout may differ), which is why 423 alone is retryable.
 */
export const SCRAPINGANT_RETRYABLE_STATUS = 423;

/**
 * Absolute ceiling on provider requests issued within one scrape() call.
 * Bounds outbound request volume, independent of which responses are billed.
 */
export const SCRAPINGANT_MAX_PROVIDER_ATTEMPTS = 2;

/** Floor for the provider-side `timeout` query parameter, in seconds. */
export const SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS = 5;

/**
 * A retry is only issued when the shared envelope can still accommodate the
 * provider minimum plus the abort margin. Below this the second request would
 * be aborted before the provider could answer, so it is not sent at all.
 */
export const SCRAPINGANT_RETRY_MIN_REMAINING_MS =
  SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS * 1_000 +
  SCRAPINGANT_ABORT_MARGIN_MS;

export const SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS = 500;

/**
 * Worst-case UTF-8 width of the character bound. Reading beyond this can never
 * add a retainable diagnostic character, so it is the hard streaming budget.
 */
export const SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES =
  SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS * 4;

export type ScrapingAntFallbackErrorCode =
  | "CONFIGURATION_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_4XX"
  | "PROVIDER_5XX"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_RESPONSE";

export class ScrapingAntFallbackError extends Error {
  public constructor(
    public readonly code: ScrapingAntFallbackErrorCode,
    public readonly httpStatus?: number,
    public readonly providerDetail?: string,
  ) {
    super(`ScrapingAnt fallback failed (${code})`);
    this.name = "ScrapingAntFallbackError";
  }
}

export interface ScrapingAntFallbackResult {
  rawHtml: string;
  observedAt: Date;
}

type ProviderAttemptOutcome =
  | { kind: "SUCCESS"; result: ScrapingAntFallbackResult }
  | { kind: "LOCKED"; error: ScrapingAntFallbackError };

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

const REDACTED_URL = "[redacted-url]";
const ANY_URL_PATTERN = /https?:\/\/[^\s"'<>)\]}]*/gi;
const CONTROL_CHARACTER_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F]/g;

function escapedForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutOccurrences(value: string, needle: string): string {
  if (!needle) return value;
  const pattern = new RegExp(escapedForRegExp(needle), "gi");
  return value.replace(pattern, REDACTED_URL);
}

/**
 * Makes a provider error body safe to attach to an Error that will be
 * serialized, propagated across the adapter boundary and interpolated into a
 * single-line log.
 *
 * Refuses outright — rather than redacting — anything carrying the credential
 * in raw or URL-encoded form, or naming the `x-api-key` parameter at all: a
 * body reflecting the request query is untrustworthy as a whole. What survives
 * has both the target URL and every remaining absolute URL replaced,
 * control characters stripped so no second log line can be forged, whitespace
 * collapsed, and only then the character bound applied.
 */
function sanitizedProviderDetail(
  detail: string | undefined,
  secrets: { apiKey: string; targetUrls: readonly string[] },
): string | undefined {
  if (!detail) return undefined;

  const haystack = detail.toLowerCase();
  const forbidden = [
    secrets.apiKey,
    encodeURIComponent(secrets.apiKey),
    "x-api-key",
  ];
  for (const needle of forbidden) {
    if (needle && haystack.includes(needle.toLowerCase())) return undefined;
  }

  let safe = detail;
  for (const targetUrl of secrets.targetUrls) {
    safe = withoutOccurrences(safe, targetUrl);
    safe = withoutOccurrences(safe, encodeURIComponent(targetUrl));
  }
  safe = safe.replace(ANY_URL_PATTERN, REDACTED_URL);
  safe = safe.replace(CONTROL_CHARACTER_PATTERN, " ");
  safe = safe.replace(/\s+/g, " ").trim();

  if (!safe) return undefined;
  return safe.slice(0, SCRAPINGANT_PROVIDER_DETAIL_MAX_CHARS);
}

/**
 * Provider-side budget for one attempt: whatever remains of the shared envelope
 * minus the abort margin, clamped into the provider's accepted range. A retry
 * therefore asks the provider for the time it can actually wait, instead of
 * re-requesting the full 60s it no longer has.
 */
function providerTimeoutSecondsFor(remainingMs: number): number {
  const usableSeconds = Math.floor(
    (remainingMs - SCRAPINGANT_ABORT_MARGIN_MS) / 1_000,
  );
  return Math.min(
    SCRAPINGANT_PROVIDER_TIMEOUT_SECONDS,
    Math.max(SCRAPINGANT_PROVIDER_MIN_TIMEOUT_SECONDS, usableSeconds),
  );
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

/**
 * Diagnosis-only capture of a bounded provider error body.
 *
 * Streams the error body and stops at a hard byte budget, so an unbounded or
 * hostile provider response is never buffered, decoded or stored in full. The
 * budget is the worst-case UTF-8 width of the character bound, so the prefix
 * can always yield the full diagnostic allowance.
 *
 * Never throws: a missing body, a stream failure and malformed UTF-8 all
 * degrade to whatever safe prefix is already in hand.
 */
async function readBoundedErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const body = response.body;
  if (!body) return undefined;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    // The body is locked or otherwise unusable. Diagnosis is optional; the
    // PROVIDER_4XX/PROVIDER_5XX classification and its status are not, so give
    // up on the detail rather than letting this throw past the caller.
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = SCRAPINGANT_PROVIDER_DETAIL_MAX_BYTES - totalBytes;
      const acceptedLength = Math.min(value.byteLength, remaining);
      if (acceptedLength === 0) continue;
      // slice() copies into a fresh buffer. subarray() — and retaining `value`
      // itself — would keep a view onto the provider's backing ArrayBuffer,
      // which can be arbitrarily larger than the diagnostic budget and is
      // reused by the stream implementation.
      const accepted = value.slice(0, acceptedLength);
      chunks.push(accepted);
      totalBytes += accepted.byteLength;
    }
  } catch {
    // Keep the prefix already read; a provider stream failure is not fatal to
    // diagnosis and must never mask the HTTP status classification.
  } finally {
    // Reached the budget, hit the end, or failed: in every case release the
    // connection instead of draining the remainder of the body.
    await reader.cancel().catch(() => undefined);
  }

  if (totalBytes === 0) return undefined;

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    // Non-fatal on purpose: the budget can cut a multi-byte sequence in half,
    // and a malformed tail must degrade to replacement characters, not throw.
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
  if (!text) return undefined;

  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // not JSON (or truncated mid-document), fall through to the raw prefix
  }
  return text;
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

    // Everything a provider error body must never be able to echo back to us.
    // Both target forms are carried because the caller's spelling and the
    // normalized spelling can differ.
    const detailSecrets = {
      apiKey,
      targetUrls: [validatedUrl, targetUrl],
    } as const;

    // One envelope for the whole call, not one per attempt, measured on the
    // monotonic clock: a retry must not extend the adapter's existing
    // wall-clock envelope, which the job lease and its renewal interval are
    // sized against, and a system clock adjustment must not be able to move it.
    const startedAt = performance.now();

    let lockedFailure: ScrapingAntFallbackError | undefined;

    for (
      let attempt = 1;
      attempt <= SCRAPINGANT_MAX_PROVIDER_ATTEMPTS;
      attempt += 1
    ) {
      // The first attempt owns the full envelope by definition, so it is not
      // subject to clock-read jitter and keeps the established query contract.
      const remainingMs =
        attempt === 1
          ? this.abortTimeoutMs
          : Math.max(0, this.abortTimeoutMs - (performance.now() - startedAt));

      if (attempt > 1 && remainingMs < SCRAPINGANT_RETRY_MIN_REMAINING_MS) {
        break;
      }

      const outcome = await this.executeProviderAttempt({
        validatedUrl,
        apiKey,
        detailSecrets,
        remainingMs,
      });

      if (outcome.kind === "SUCCESS") {
        return outcome.result;
      }

      // Only a locked proxy reaches here; every other failure already threw.
      lockedFailure = outcome.error;
    }

    // The caller sees the latest locked failure after the bounded retry
    // opportunity is exhausted or skipped for insufficient remaining budget.
    throw lockedFailure ?? providerError("INVALID_RESPONSE");
  }

  /**
   * Builds the outbound v2 request for one attempt.
   *
   * The returned URL is secret-bearing because v2 requires x-api-key as a query
   * parameter. It is deliberately scoped to the adapter: never return it,
   * attach it to an Error, or pass it to logs, persistence or queue code.
   *
   * Only the provider `timeout` varies per attempt. The rotation-critical
   * settings — browser, proxy_country, proxy_type and resource blocking —
   * remain constant across attempts, while the new provider request receives a
   * rotated proxy IP.
   */
  private buildRequestUrl(input: {
    validatedUrl: string;
    apiKey: string;
    providerTimeoutSeconds: number;
  }): URL {
    const requestUrl = new URL(SCRAPINGANT_V2_ENDPOINT);
    const query = new URLSearchParams();
    query.set("x-api-key", input.apiKey);
    query.set("url", input.validatedUrl);
    query.set("browser", "true");
    query.set("proxy_country", "GB");
    query.set("proxy_type", "residential");
    query.set("timeout", String(input.providerTimeoutSeconds));
    for (const resource of ["image", "media", "font"]) {
      query.append("block_resource", resource);
    }
    requestUrl.search = query.toString();
    return requestUrl;
  }

  /**
   * One provider request, fully classified.
   *
   * Returns a LOCKED outcome instead of throwing only for
   * SCRAPINGANT_RETRYABLE_STATUS, which is what makes a bounded retry possible.
   * Every other failure — configuration, timeout, network, other 4xx, 5xx,
   * oversized or invalid body — throws exactly as before and is never retried.
   */
  private async executeProviderAttempt(input: {
    validatedUrl: string;
    apiKey: string;
    detailSecrets: { apiKey: string; targetUrls: readonly string[] };
    remainingMs: number;
  }): Promise<ProviderAttemptOutcome> {
    const { validatedUrl, apiKey, detailSecrets, remainingMs } = input;

    const requestUrl = this.buildRequestUrl({
      validatedUrl,
      apiKey,
      providerTimeoutSeconds: providerTimeoutSecondsFor(remainingMs),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

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
        const error = new ScrapingAntFallbackError(
          "PROVIDER_4XX",
          response.status,
          sanitizedProviderDetail(
            await readBoundedErrorDetail(response),
            detailSecrets,
          ),
        );
        if (response.status === SCRAPINGANT_RETRYABLE_STATUS) {
          return { kind: "LOCKED", error };
        }
        throw error;
      }
      if (response.status >= 500) {
        throw new ScrapingAntFallbackError(
          "PROVIDER_5XX",
          response.status,
          sanitizedProviderDetail(
            await readBoundedErrorDetail(response),
            detailSecrets,
          ),
        );
      }
      if (!response.ok) {
        throw providerError("INVALID_RESPONSE");
      }

      const rawHtml = await readBoundedResponseBody(response);
      if (rawHtml.includes(apiKey)) {
        throw providerError("INVALID_RESPONSE");
      }
      return { kind: "SUCCESS", result: { rawHtml, observedAt: new Date() } };
    } finally {
      clearTimeout(timeout);
    }
  }
}
