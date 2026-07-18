import { z } from "zod";
import * as cheerio from "cheerio";
import { BaseAgent } from "../core/BaseAgent";
import { PlaywrightScraper } from "../services/PlaywrightScraper";
import { normalizeUrl, filterCandidateUrl } from "../utils/url-normalizer";

export const DiscoveryInputSchema = z.object({
  seedUrls: z.array(z.string().url()),
  maxUrlsPerSeed: z.number().default(150),
});

export type DiscoveryInput = z.infer<typeof DiscoveryInputSchema>;

export const DiscoveredCandidateSchema = z.object({
  rawUrl: z.string(),
  normalizedUrl: z.string(),
  domain: z.string(),
  sourceSeed: z.string(),
});

export type DiscoveredCandidate = z.infer<typeof DiscoveredCandidateSchema>;

export const DiscoveryOutputSchema = z.object({
  totalSeeds: z.number(),
  totalDiscovered: z.number(),
  candidateUrls: z.array(DiscoveredCandidateSchema),
  filteredCount: z.number(),
  timestamp: z.date(),
});

export type DiscoveryOutput = z.infer<typeof DiscoveryOutputSchema>;

export class DiscoveryAgent extends BaseAgent<DiscoveryInput, DiscoveryOutput> {
  protected inputSchema = DiscoveryInputSchema;
  protected outputSchema = DiscoveryOutputSchema;

  protected async execute(input: DiscoveryInput): Promise<DiscoveryOutput> {
    console.log(`[DiscoveryAgent] Starting discovery crawl across ${input.seedUrls.length} seed sources...`);

    const candidateMap = new Map<string, DiscoveredCandidate>();
    let filteredCount = 0;

    for (const seedUrl of input.seedUrls) {
      console.log(`[DiscoveryAgent] Crawling seed source: ${seedUrl}`);

      try {
        const scrapeResult = await PlaywrightScraper.scrape({
          url: seedUrl,
          timeoutMs: 30000,
          maxRetries: 2,
        });

        const $ = cheerio.load(scrapeResult.rawHtml);
        const links = $("a[href]")
          .map((_, el) => $(el).attr("href"))
          .get() as string[];

        console.log(`[DiscoveryAgent] Extracted ${links.length} raw links from seed: ${seedUrl}`);

        let countForSeed = 0;
        for (const rawHref of links) {
          if (countForSeed >= input.maxUrlsPerSeed) break;

          const normalized = normalizeUrl(rawHref, seedUrl);
          if (!normalized) {
            filteredCount++;
            continue;
          }

          const filterResult = filterCandidateUrl(normalized);
          if (!filterResult.isRelevant) {
            filteredCount++;
            continue;
          }

          if (!candidateMap.has(normalized)) {
            let domain = "unknown";
            try {
              domain = new URL(normalized).hostname.replace(/^www\./, "");
            } catch {}

            candidateMap.set(normalized, {
              rawUrl: rawHref,
              normalizedUrl: normalized,
              domain,
              sourceSeed: seedUrl,
            });

            countForSeed++;
          }
        }
      } catch (err: any) {
        console.warn(`[DiscoveryAgent] Failed to crawl seed source ${seedUrl}: ${err.message}`);
      }
    }

    const candidateUrls = Array.from(candidateMap.values());
    console.log(
      `[DiscoveryAgent] Discovery complete: ${candidateUrls.length} unique candidate URLs discovered (${filteredCount} non-relevant links filtered out).`
    );

    return {
      totalSeeds: input.seedUrls.length,
      totalDiscovered: candidateUrls.length,
      candidateUrls,
      filteredCount,
      timestamp: new Date(),
    };
  }
}
