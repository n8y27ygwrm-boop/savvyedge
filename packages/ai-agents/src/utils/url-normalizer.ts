const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "affiliate",
  "affiliate_id",
  "btag",
  "clickid",
  "subid",
]);

const STATIC_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".pdf",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".zip",
  ".woff",
  ".woff2",
  ".ttf",
  ".mp4",
  ".mp3",
  ".ico",
]);

const REJECT_DOMAINS = new Set([
  "facebook.com",
  "www.facebook.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "instagram.com",
  "www.instagram.com",
  "youtube.com",
  "www.youtube.com",
  "linkedin.com",
  "www.linkedin.com",
  "tiktok.com",
  "www.tiktok.com",
  "pinterest.com",
  "www.pinterest.com",
  "reddit.com",
  "www.reddit.com",
  "t.me",
  "telegram.org",
  "apple.com",
  "www.apple.com",
  "google.com",
  "www.google.com",
]);

const REJECT_PATH_PREFIXES = [
  "/privacy-policy",
  "/terms-of-use",
  "/terms-and-conditions",
  "/cookie-policy",
  "/contact-us",
  "/about-us",
  "/login",
  "/register",
  "/forgot-password",
  "/sitemap",
];

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    if (!rawUrl || rawUrl.trim().startsWith("#") || rawUrl.trim().startsWith("javascript:")) {
      return null;
    }

    const parsed = new URL(rawUrl, baseUrl);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";

    // Delete tracking query params
    const searchParams = parsed.searchParams;
    const keysToDelete: string[] = [];
    searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => searchParams.delete(key));

    // Normalize path trailing slash
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.href;
  } catch {
    return null;
  }
}

export function filterCandidateUrl(normalizedUrl: string): { isRelevant: boolean; reason?: string } {
  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (REJECT_DOMAINS.has(host)) {
      return { isRelevant: false, reason: `Excluded social/platform domain: ${host}` };
    }

    for (const ext of STATIC_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return { isRelevant: false, reason: `Static asset file extension: ${ext}` };
      }
    }

    for (const prefix of REJECT_PATH_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        return { isRelevant: false, reason: `Utility / policy page path: ${prefix}` };
      }
    }

    return { isRelevant: true };
  } catch {
    return { isRelevant: false, reason: "Invalid URL format" };
  }
}
