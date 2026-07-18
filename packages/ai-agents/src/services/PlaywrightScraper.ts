import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface PlaywrightScrapeOptions {
  url: string;
  timeoutMs?: number;
  maxRetries?: number;
  snapshotDir?: string;
}

export interface PlaywrightScrapeResult {
  url: string;
  rawHtml: string;
  content: string;
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
  private static DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), "storage/snapshots");

  public static async scrape(options: PlaywrightScrapeOptions): Promise<PlaywrightScrapeResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? this.DEFAULT_MAX_RETRIES;
    const snapshotDir = options.snapshotDir ?? this.DEFAULT_SNAPSHOT_DIR;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      console.log(`[PlaywrightScraper] Attempt ${attempt}/${maxRetries} for URL: ${options.url}`);

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
              username: urlObj.username ? decodeURIComponent(urlObj.username) : undefined,
              password: urlObj.password ? decodeURIComponent(urlObj.password) : undefined,
            };
            console.log(`[PlaywrightScraper] Using rotating proxy: ${proxyOptions.server}`);
          } catch (err: any) {
            console.warn(`[PlaywrightScraper] Invalid PROXY_URL configured: ${err.message}`);
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
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
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
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          (window as any).chrome = {
            runtime: {},
            loadTimes: function () {},
            csi: function () {},
            app: {},
          };
          Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
          Object.defineProperty(navigator, "plugins", {
            get: () => [
              { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chrome PDF Viewer" },
              { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chromium PDF Viewer" },
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

        const rawHtml = await page.content();
        await browser.close();
        browser = null;

        // Parse HTML via Cheerio to extract OpenGraph & metadata
        const $ = cheerio.load(rawHtml);

        const title = $("title").text().trim() || undefined;
        const description =
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          undefined;

        const ogTitle = $('meta[property="og:title"]').attr("content") || undefined;
        const ogDescription = $('meta[property="og:description"]').attr("content") || undefined;
        const ogImage = $('meta[property="og:image"]').attr("content") || undefined;
        const ogSiteName =
          $('meta[property="og:site_name"]').attr("content") ||
          $('meta[name="application-name"]').attr("content") ||
          undefined;
        const ogType = $('meta[property="og:type"]').attr("content") || undefined;
        const ogUrl = $('meta[property="og:url"]').attr("content") || undefined;

        // Strip noise & extract clean readable text
        $("script, style, nav, footer, iframe, svg, header, noscript, style, button").remove();
        let cleanedText = $("body").text();
        cleanedText = cleanedText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join("\n");

        // Store HTML snapshot on disk
        let snapshotPath: string | undefined;
        try {
          if (!fs.existsSync(snapshotDir)) {
            fs.mkdirSync(snapshotDir, { recursive: true });
          }

          let host = "unknown";
          try {
            host = new URL(options.url).hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
          } catch {}

          const hash = crypto.createHash("md5").update(options.url).digest("hex").substring(0, 8);
          const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
          const fileName = `${dateStr}_${host}_${hash}.html`;
          snapshotPath = path.join(snapshotDir, fileName);

          fs.writeFileSync(snapshotPath, rawHtml, "utf-8");
          console.log(`[PlaywrightScraper] Saved HTML snapshot to: ${snapshotPath}`);
        } catch (err: any) {
          console.warn(`[PlaywrightScraper] Could not save HTML snapshot: ${err.message}`);
        }

        const durationMs = Date.now() - startTime;
        console.log(`[PlaywrightScraper] Successfully scraped ${options.url} in ${durationMs}ms`);

        return {
          url: options.url,
          rawHtml,
          content: cleanedText,
          metadata: {
            title: ogTitle || title,
            siteName: ogSiteName,
            description: ogDescription || description,
            ogTitle,
            ogDescription,
            ogImage,
            ogSiteName,
            ogType,
            ogUrl,
          },
          snapshotPath,
          attemptCount: attempt,
          durationMs,
          timestamp: new Date(),
        };
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[PlaywrightScraper] Attempt ${attempt} failed for ${options.url}: ${err.message}`
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
      `PlaywrightScraper failed after ${maxRetries} attempts for ${options.url}. Last error: ${lastError?.message}`
    );
  }
}
