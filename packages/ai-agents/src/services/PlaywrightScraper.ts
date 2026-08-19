import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as cheerio from "cheerio";
import * as crypto from "crypto";

function resolveDocumentUrl(
  value: string | undefined,
  base: string,
): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Elements whose text is never page content.
 *
 * Deliberately excludes `header`, `nav` and `button`: those are semantic
 * containers that legitimately carry promotion headlines and offer copy on
 * real operator and affiliate pages, and deleting them globally destroys the
 * very text extraction depends on. `footer` stays excluded because it carries
 * only site-wide legal boilerplate.
 */
export const NON_CONTENT_SELECTOR =
  "script, style, iframe, svg, noscript, footer";

/**
 * Extracts normalized readable text from rendered HTML.
 *
 * Exported as a pure function so the cleanup contract can be exercised
 * directly without launching a browser.
 */
export function extractReadableText(html: string): string {
  const $ = cheerio.load(html);
  $(NON_CONTENT_SELECTOR).remove();
  return $("body")
    .text()
    .split("\n")
    // Collapse tabs and repeated intra-line whitespace, but keep single
    // newlines so distinct text blocks stay separated.
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export interface PlaywrightScrapeOptions {
  url: string;
  timeoutMs?: number;
  maxRetries?: number;
  snapshotDir?: string;
}

export interface PlaywrightScrapeResult {
  url: string;
  finalUrl: string;
  title?: string;
  rawHtml: string;
  content: string;
  htmlHash: string;
  contentHash: string;
  canonicalUrl?: string;
  metadata: {
    title?: string;
    siteName?: string;
    description?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    ogSiteName?: string;
    ogType?: string;
    ogUrl?: string;
  };
  snapshotPath?: string;
  attemptCount: number;
  durationMs: number;
  timestamp: Date;
}

export class PlaywrightScraper {
  private static DEFAULT_TIMEOUT_MS = 30000;
  private static DEFAULT_MAX_RETRIES = 3;

  public static async scrape(
    options: PlaywrightScrapeOptions,
  ): Promise<PlaywrightScrapeResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? this.DEFAULT_MAX_RETRIES;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      console.log(
        `[PlaywrightScraper] Attempt ${attempt}/${maxRetries} for URL: ${options.url}`,
      );

      let browser: Browser | null = null;
      try {
        // Parse proxy settings if PROXY_URL is configured
        const proxyUrl = process.env.PROXY_URL;
        let proxyOptions: any = undefined;
        if (proxyUrl) {
          try {
            const urlObj = new URL(proxyUrl);
            proxyOptions = {
              server: `${urlObj.protocol}//${urlObj.host}`,
              username: urlObj.username
                ? decodeURIComponent(urlObj.username)
                : undefined,
              password: urlObj.password
                ? decodeURIComponent(urlObj.password)
                : undefined,
            };
            console.log(
              `[PlaywrightScraper] Using rotating proxy: ${proxyOptions.server}`,
            );
          } catch (err: any) {
            console.warn(
              `[PlaywrightScraper] Invalid PROXY_URL configured: ${err.message}`,
            );
          }
        }

        browser = await chromium.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--blink-settings=imagesEnabled=true",
          ],
          proxy: proxyOptions,
        });

        const context: BrowserContext = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          locale: "en-US",
          timezoneId: "America/New_York",
          extraHTTPHeaders: {
            "Accept-Language": "en-US,en;q=0.9",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Sec-Ch-Ua":
              '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"macOS"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          },
          viewport: { width: 1440, height: 900 },
          proxy: proxyOptions,
        });

        // Stealth: Hide Webdriver and Emulate Chrome plugins/features
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
          (window as any).chrome = {
            runtime: {},
            loadTimes: function () {},
            csi: function () {},
            app: {},
          };
          Object.defineProperty(navigator, "languages", {
            get: () => ["en-US", "en"],
          });
          Object.defineProperty(navigator, "plugins", {
            get: () => [
              {
                description: "Portable Document Format",
                filename: "internal-pdf-viewer",
                name: "Chrome PDF Viewer",
              },
              {
                description: "Portable Document Format",
                filename: "internal-pdf-viewer",
                name: "Chromium PDF Viewer",
              },
            ],
          });
        });

        const page: Page = await context.newPage();

        // Navigate with timeout
        await page.goto(options.url, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });

        // Short wait to ensure dynamic JS rendering / DOM hydration finishes
        await page.waitForTimeout(1500).catch(() => {});

        const finalUrl = page.url();
        const pageTitle =
          (await page.title().catch(() => "")).trim() || undefined;

        // Extract canonical URL using Playwright locator
        let canonicalUrl: string | undefined = undefined;
        try {
          const canonicalAttr = await page
            .locator("link[rel='canonical']")
            .getAttribute("href");
          if (canonicalAttr) {
            canonicalUrl = resolveDocumentUrl(canonicalAttr, finalUrl);
          }
        } catch {
          // Ignore if canonical tag not present
        }

        const rawHtml = await page.content();
        const observedAt = new Date();
        await browser.close();
        browser = null;

        // Parse HTML via Cheerio to extract OpenGraph & metadata
        const $ = cheerio.load(rawHtml);

        const documentTitle = $("title").text().trim() || undefined;
        const description =
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          undefined;

        const ogTitle =
          $('meta[property="og:title"]').attr("content") || undefined;
        const ogDescription =
          $('meta[property="og:description"]').attr("content") || undefined;
        const ogImage =
          $('meta[property="og:image"]').attr("content") || undefined;
        const ogSiteName =
          $('meta[property="og:site_name"]').attr("content") ||
          $('meta[name="application-name"]').attr("content") ||
          undefined;
        const ogType =
          $('meta[property="og:type"]').attr("content") || undefined;
        const ogUrl = $('meta[property="og:url"]').attr("content") || undefined;

        // Strip non-content elements & extract normalized readable text
        const cleanedText = extractReadableText(rawHtml);

        // Compute SHA-256 hashes
        const htmlHash = crypto
          .createHash("sha256")
          .update(rawHtml)
          .digest("hex");
        const contentHash = crypto
          .createHash("sha256")
          .update(cleanedText)
          .digest("hex");

        const durationMs = Date.now() - startTime;
        console.log(
          `[PlaywrightScraper] Successfully scraped ${options.url} in ${durationMs}ms`,
        );

        return {
          url: options.url,
          finalUrl,
          title: pageTitle || documentTitle,
          rawHtml,
          content: cleanedText,
          htmlHash,
          contentHash,
          canonicalUrl: canonicalUrl || resolveDocumentUrl(ogUrl, finalUrl),
          metadata: {
            title: ogTitle || pageTitle || documentTitle,
            siteName: ogSiteName,
            description: ogDescription || description,
            ogTitle,
            ogDescription,
            ogImage,
            ogSiteName,
            ogType,
            ogUrl,
          },
          // Snapshot persistence is intentionally owned by the API layer after
          // source-page eligibility has been established.
          snapshotPath: undefined,
          attemptCount: attempt,
          durationMs,
          timestamp: observedAt,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[PlaywrightScraper] Attempt ${attempt} failed for ${options.url}: ${err.message}`,
        );

        if (browser) {
          await browser.close().catch(() => {});
        }

        // Exponential backoff before retrying
        if (attempt < maxRetries) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          await new Promise((res) => setTimeout(res, backoffMs));
        }
      }
    }

    throw new Error(
      `PlaywrightScraper failed after ${maxRetries} attempts for ${options.url}. Last error: ${lastError?.message}`,
    );
  }
}
