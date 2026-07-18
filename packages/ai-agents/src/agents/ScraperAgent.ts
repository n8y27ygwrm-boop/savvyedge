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
  timestamp: z.date(),
});

export type ScraperInput = z.infer<typeof ScraperInputSchema>;
export type ScraperOutput = z.infer<typeof ScraperOutputSchema>;

export class ScraperAgent extends BaseAgent<ScraperInput, ScraperOutput> {
  protected inputSchema = ScraperInputSchema;
  protected outputSchema = ScraperOutputSchema;

  protected async execute(input: ScraperInput, context?: AgentContext): Promise<ScraperOutput> {
    console.log(`[ScraperAgent] Fetching live page: ${input.url}`);

    const response = await fetch(input.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SavvyEdgeBot/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL ${input.url}: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

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
      timestamp: new Date(),
    };
  }
}
