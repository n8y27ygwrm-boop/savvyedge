import { createHash } from "crypto";
import { isKnownTrackingParam } from "@savvyedge/ai-agents/url-normalizer";
import { Prisma } from "@savvyedge/database";

const BONUS_SOURCE_KEY_VERSION = "bonus-url-v1";

export type BonusSourceIdentityErrorCode =
  | "INVALID_SOURCE_IDENTITY_URL"
  | "CONCURRENT_SOURCE_IDENTITY_CONFLICT";

export class BonusSourceIdentityError extends Error {
  constructor(
    public readonly code: BonusSourceIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BonusSourceIdentityError";
  }
}

/**
 * Produces a deterministic identity URL without changing offer-significant
 * query parameters. This is deliberately independent of AI extraction output.
 */
export function normalizeBonusSourceIdentityUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BonusSourceIdentityError(
      "INVALID_SOURCE_IDENTITY_URL",
      `Bonus source identity URL is invalid: ${JSON.stringify(rawUrl)}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BonusSourceIdentityError(
      "INVALID_SOURCE_IDENTITY_URL",
      `Bonus source identity URL must use HTTP or HTTPS: ${JSON.stringify(rawUrl)}`,
    );
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  const meaningfulParameters = Array.from(parsed.searchParams.entries())
    .filter(([name]) => !isKnownTrackingParam(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = compareUrlComponent(leftName, rightName);
      return nameOrder !== 0
        ? nameOrder
        : compareUrlComponent(leftValue, rightValue);
    });

  parsed.search = "";
  for (const [name, value] of meaningfulParameters) {
    parsed.searchParams.append(name, value);
  }

  return parsed.href;
}

function compareUrlComponent(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function createBonusSourceOfferKey(rawUrl: string): string {
  const normalizedUrl = normalizeBonusSourceIdentityUrl(rawUrl);
  const digest = createHash("sha256").update(normalizedUrl).digest("hex");
  return `${BONUS_SOURCE_KEY_VERSION}:${digest}`;
}

export function isBonusIdentityUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  const targetText = Array.isArray(target)
    ? target.join(",")
    : String(target ?? "");

  return (
    targetText.includes("casino_id") && targetText.includes("source_offer_key")
  );
}

export function isRetryableBonusIdentityTransactionError(
  error: unknown,
): boolean {
  return (
    isBonusIdentityUniqueViolation(error) ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034")
  );
}
