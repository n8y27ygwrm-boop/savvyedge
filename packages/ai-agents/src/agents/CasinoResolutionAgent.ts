import { z } from "zod";
import { BaseAgent } from "../core/BaseAgent";
import { AIEngine } from "../engine/ai.engine";

const engine = new AIEngine();

export const CasinoResolutionInputSchema = z.object({
  url: z.string().url(),
  domain: z.string(),
  pageMetadata: z
    .object({
      title: z.string().optional(),
      siteName: z.string().optional(),
      description: z.string().optional(),
      ogTitle: z.string().optional(),
    })
    .optional(),
  scrapedContentSnippet: z.string().optional(),
});

export type CasinoResolutionInput = z.infer<typeof CasinoResolutionInputSchema>;

export const CasinoResolutionOutputSchema = z.object({
  name: z.string(),
  slug: z.string(),
  domain: z.string(),
  website_url: z.string(),
  license_info: z.string().nullable().optional(),
});

export type CasinoResolutionOutput = z.infer<typeof CasinoResolutionOutputSchema>;

export class CasinoResolutionAgent extends BaseAgent<CasinoResolutionInput, CasinoResolutionOutput> {
  protected inputSchema = CasinoResolutionInputSchema;
  protected outputSchema = CasinoResolutionOutputSchema;

  protected async execute(input: CasinoResolutionInput): Promise<CasinoResolutionOutput> {
    const prompt = `Perform casino entity resolution for the target page below:

Target URL: ${input.url}
Domain: ${input.domain}
Page Title: ${input.pageMetadata?.title || "N/A"}
Site Name: ${input.pageMetadata?.siteName || "N/A"}
OG Title: ${input.pageMetadata?.ogTitle || "N/A"}
Description: ${input.pageMetadata?.description || "N/A"}
Content Snippet: ${(input.scrapedContentSnippet || "").substring(0, 500)}

Extract the canonical Casino identity with:
- name: Official casino brand name
- slug: URL-friendly slugified brand name (e.g., 'spin-casino')
- domain: Clean domain hostname (e.g., 'spin-casino.com')
- website_url: Official base homepage URL (e.g., 'https://spin-casino.com')
- license_info: Gambling license identifier if found (e.g., 'MGA/B2C/100/2024'), or null`;

    const res = await engine.generateStructuredObject(prompt, this.outputSchema);
    return res.data;
  }
}
