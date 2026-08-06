export type IngestionTaskContext = "BONUS" | "GAME_LIST";

export type SourcePageRejectionCategory =
  | "ANTI_BOT"
  | "CONTEXT_MISMATCH"
  | "GEO_RESTRICTED"
  | "INVALID_DESTINATION"
  | "RESTRICTED_ACCESS"
  | "UNRELATED_HOST"
  | "UNRELATED_PATH";

export type SourcePageEligibilityResult =
  | { eligible: true }
  | {
      eligible: false;
      category: SourcePageRejectionCategory;
      reason: string;
    };

export interface SourcePageEligibilityInput {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl?: string | null;
  title?: string | null;
  content?: string | null;
  taskContext: IngestionTaskContext;
}

const SUPPORT_PATH_PATTERN =
  /(?:^|\/)(?:help|help-center|support|customer-support|customer-service|contact|contact-us|faq|faqs)(?:\/|$)/i;
const RESTRICTED_PATH_PATTERN =
  /(?:^|\/)(?:login|log-in|signin|sign-in|restricted|blocked|access-denied|unavailable)(?:\/|$)/i;
const SUPPORT_TITLE_PATTERN =
  /\b(?:help\s*(?:&|and)\s*support|help center|player help|customer support|support center|sign[ -]?in|log[ -]?in)\b/i;
const RESTRICTED_TITLE_PATTERN =
  /\b(?:access denied|restricted access|services? unavailable|site unavailable|not available in your (?:country|location|region))\b/i;
const GEO_RESTRICTION_PATTERN =
  /\b(?:services? unavailable in your location|not available in your (?:country|location|region)|unavailable in your (?:country|location|region)|restricted in your (?:country|location|region)|geo(?:graphically)?[ -]?blocked|outside (?:of )?your (?:country|location|region))\b/i;
const ANTI_BOT_PATTERN =
  /(?:\bjust a moment\b|\bchecking your browser\b|\bverify (?:that )?you are human\b|\battention required\b.*\bcloudflare\b|\bcloudflare ray id\b|\bcf-chl-|\benable javascript and cookies to continue\b|\bchecking if the site connection is secure\b)/i;

const CONTEXT_TERMS: Record<IngestionTaskContext, RegExp> = {
  BONUS:
    /\b(?:bonus|bonuses|promotion|promotions|promo|offer|welcome|deposit|reward|free spins?)\b/i,
  GAME_LIST:
    /\b(?:casino games?|game lobby|slots?|table games?|live casino|jackpots?)\b/i,
};

const STATIC_REJECTION_REASONS: Record<SourcePageRejectionCategory, string> = {
  ANTI_BOT: "The rendered page is an anti-bot or browser challenge page.",
  GEO_RESTRICTED: "The rendered page reports location-based unavailability.",
  UNRELATED_HOST: "The page destination host is unrelated to the requested domain.",
  UNRELATED_PATH: "The page destination path is a help or support path.",
  RESTRICTED_ACCESS:
    "The page destination path or title identifies a login or restricted-access page.",
  CONTEXT_MISMATCH:
    "The final page has no matching ingestion context for the requested URL.",
  INVALID_DESTINATION:
    "The requested or final browser URL could not be parsed.",
};

export class SourcePageRejectedError extends Error {
  public readonly category: SourcePageRejectionCategory;

  constructor(
    _input: SourcePageEligibilityInput,
    rejection: Extract<SourcePageEligibilityResult, { eligible: false }>,
  ) {
    super(
      `SOURCE_PAGE_REJECTED ${JSON.stringify({
        category: rejection.category,
        reason: rejection.reason,
      })}`,
    );
    this.name = "SourcePageRejectedError";
    this.category = rejection.category;
  }
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    const u = base ? new URL(value, base) : new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) {
    host = host.slice(4);
  } else if (host.startsWith("m.")) {
    host = host.slice(2);
  }
  return host;
}

function isIpAddress(host: string): boolean {
  const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^\[?[0-9a-fA-F:]+\]?$/;
  return ipv4Regex.test(host) || (host.includes(":") && ipv6Regex.test(host));
}

/**
 * Conservative host-relatedness evaluator.
 * DNS hosts left and right are considered related if:
 * 1. Normalized hosts are identical (e.g. example.com == www.example.com)
 * 2. One host is a true DNS subdomain of the other (e.g. en.example.com endsWith .example.com)
 *
 * IP literals and localhost must match exactly.
 * Note on Sibling Subdomains: Without a full Public Suffix List, sibling subdomains
 * like promo.example.com and casino.example.com are fail-closed rejected as UNRELATED_HOST
 * unless one is a true subdomain of the other or both normalize to the exact same host via www./m. prefix.
 */
export function hostsAreRelated(left: string, right: string): boolean {
  const normLeft = normalizeHost(left);
  const normRight = normalizeHost(right);

  if (normLeft === normRight) {
    return true;
  }

  if (
    isIpAddress(normLeft) ||
    isIpAddress(normRight) ||
    normLeft === "localhost" ||
    normRight === "localhost"
  ) {
    return normLeft === normRight;
  }

  return normLeft.endsWith(`.${normRight}`) || normRight.endsWith(`.${normLeft}`);
}

function normalizePath(pathname: string): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  if (segments.length > 1 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) {
    segments.shift();
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function reject(
  category: SourcePageRejectionCategory,
): SourcePageEligibilityResult {
  return {
    eligible: false,
    category,
    reason: STATIC_REJECTION_REASONS[category],
  };
}

export function evaluateSourcePageEligibility(
  input: SourcePageEligibilityInput,
): SourcePageEligibilityResult {
  const requested = parseUrl(input.requestedUrl);
  const final = parseUrl(input.finalUrl);
  if (!requested || !final) {
    return reject("INVALID_DESTINATION");
  }

  const title = input.title?.trim() || "";
  const inspectedText = `${title}\n${(input.content || "").slice(0, 12_000)}`;

  if (ANTI_BOT_PATTERN.test(inspectedText)) {
    return reject("ANTI_BOT");
  }

  if (GEO_RESTRICTION_PATTERN.test(inspectedText)) {
    return reject("GEO_RESTRICTED");
  }

  const destinations = [final];
  if (input.canonicalUrl) {
    const canonical = parseUrl(input.canonicalUrl, final.toString());
    if (canonical) {
      destinations.push(canonical);
    }
  }

  for (const destination of destinations) {
    if (!hostsAreRelated(requested.hostname, destination.hostname)) {
      return reject("UNRELATED_HOST");
    }

    if (SUPPORT_PATH_PATTERN.test(destination.pathname)) {
      return reject("UNRELATED_PATH");
    }

    if (RESTRICTED_PATH_PATTERN.test(destination.pathname)) {
      return reject("RESTRICTED_ACCESS");
    }
  }

  if (RESTRICTED_TITLE_PATTERN.test(title)) {
    return reject("RESTRICTED_ACCESS");
  }

  if (SUPPORT_TITLE_PATTERN.test(title)) {
    return reject("UNRELATED_PATH");
  }

  const requestedPath = normalizePath(requested.pathname);
  const destinationsMatchRequestedPath = destinations.every(
    (destination) => normalizePath(destination.pathname) === requestedPath,
  );
  if (destinationsMatchRequestedPath) {
    return { eligible: true };
  }

  const contextPattern = CONTEXT_TERMS[input.taskContext];
  const requestedHasContext = contextPattern.test(requested.pathname);
  const destinationContext = destinations
    .map((destination) => destination.pathname)
    .join(" ");
  const renderedPageHasContext = contextPattern.test(
    `${destinationContext}\n${title}`,
  );

  if (requestedHasContext && !renderedPageHasContext) {
    return reject("CONTEXT_MISMATCH");
  }

  return { eligible: true };
}
