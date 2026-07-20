import { z } from "zod";
import * as cheerio from "cheerio";
import * as crypto from "crypto";
import { BaseAgent, AgentContext } from "../core/BaseAgent";

export const ScraperInputSchema = z.object({
  url: z.string().url(),
  mode: z.enum(["html", "markdown", "text"]).default("markdown"),
});

export const ScraperOutputSchema = z.object({
  url: z.string(),
  content: z.string(),
  rawHtml: z.string().optional(),
  htmlHash: z.string().optional(),
  contentHash: z.string().optional(),
  canonicalUrl: z.string().optional(),
  metadata: z
    .object({
      title: z.string().optional(),
      siteName: z.string().optional(),
      description: z.string().optional(),
      ogTitle: z.string().optional(),
      ogDescription: z.string().optional(),
      ogImage: z.string().optional(),
    })
    .optional(),
  snapshotPath: z.string().optional(),
  timestamp: z.date(),
});

export type ScraperInput = z.infer<typeof ScraperInputSchema>;
export type ScraperOutput = z.infer<typeof ScraperOutputSchema>;

import { PlaywrightScraper } from "../services/PlaywrightScraper";

export class ScraperAgent extends BaseAgent<ScraperInput, ScraperOutput> {
  protected inputSchema = ScraperInputSchema;
  protected outputSchema = ScraperOutputSchema;

  protected async execute(input: ScraperInput, context?: AgentContext): Promise<ScraperOutput> {
    console.log(`[ScraperAgent] Executing Playwright production scraper for URL: ${input.url}`);

    try {
      const result = await PlaywrightScraper.scrape({
        url: input.url,
        timeoutMs: 30000,
        maxRetries: 3,
      });

      return {
        url: result.url,
        content: result.content,
        rawHtml: result.rawHtml,
        htmlHash: result.htmlHash,
        contentHash: result.contentHash,
        canonicalUrl: result.canonicalUrl,
        metadata: result.metadata,
        snapshotPath: result.snapshotPath,
        timestamp: result.timestamp,
      };
    } catch (err: any) {
      console.error(`[ScraperAgent] Playwright scraping failed for ${input.url}: ${err.message}`);
      throw new Error(`ScraperAgent: failed to scrape ${input.url} after Playwright retries exhausted: ${err.message}`);
    }
  }
}
