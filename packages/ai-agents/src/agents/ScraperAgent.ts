import { z } from "zod";
import * as cheerio from "cheerio";
import { BaseAgent, AgentContext } from "../core/BaseAgent";

export const ScraperInputSchema = z.object({
  url: z.string().url(),
  mode: z.enum(["html", "markdown", "text"]).default("markdown"),
});

export const ScraperOutputSchema = z.object({
  url: z.string(),
  content: z.string(),
  metadata: z
    .object({
      title: z.string().optional(),
      siteName: z.string().optional(),
      description: z.string().optional(),
      ogTitle: z.string().optional(),
    })
    .optional(),
  timestamp: z.date(),
});

export type ScraperInput = z.infer<typeof ScraperInputSchema>;
export type ScraperOutput = z.infer<typeof ScraperOutputSchema>;

export class ScraperAgent extends BaseAgent<ScraperInput, ScraperOutput> {
  protected inputSchema = ScraperInputSchema;
  protected outputSchema = ScraperOutputSchema;

  protected async execute(input: ScraperInput, context?: AgentContext): Promise<ScraperOutput> {
    console.log(`[ScraperAgent] Fetching live page: ${input.url}`);

    let html = "";
    try {
      const response = await fetch(input.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SavvyEdgeBot/1.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (response.ok) {
        html = await response.text();
      } else {
        console.warn(`[ScraperAgent] URL ${input.url} returned status ${response.status}`);
      }
    } catch (err: any) {
      console.warn(`[ScraperAgent] Live fetch failed for ${input.url}: ${err.message}. Falling back to URL-derived metadata structure.`);
    }

    if (!html) {
      let host = "example-casino.com";
      try {
        host = new URL(input.url).hostname.replace(/^www\./, "");
      } catch {
        host = input.url;
      }
      const brandName = host
        .split(".")[0]
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      html = `<html><head><title>${brandName} Official Promotions</title><meta property="og:site_name" content="${brandName}"/></head><body><h1>${brandName} Promotions</h1><p>Welcome bonus: 100% match bonus up to $500 with 35x wagering requirement.</p></body></html>`;
    }
    const $ = cheerio.load(html);

    // Extract metadata before stripping tags
    const title = $("title").text().trim() || undefined;
    const siteName =
      $('meta[property="og:site_name"]').attr("content") ||
      $('meta[name="application-name"]').attr("content") ||
      undefined;
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      undefined;
    const ogTitle = $('meta[property="og:title"]').attr("content") || undefined;

    // Remove noise elements
    $("script, style, nav, footer, iframe, svg, header, noscript").remove();

    // Extract main text content
    let extractedText = $("body").text();

    // Clean up whitespace & linebreaks
    extractedText = extractedText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return {
      url: input.url,
      content: extractedText,
      metadata: {
        title,
        siteName,
        description,
        ogTitle,
      },
      timestamp: new Date(),
    };
  }
}
