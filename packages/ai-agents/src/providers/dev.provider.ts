import { z } from "zod";
import { BaseAIProvider } from "./base.provider";
import { ProviderMetadata, ExecutionOptions } from "../types/provider.types";

export class DevAIProvider extends BaseAIProvider {
  public readonly metadata: ProviderMetadata = {
    id: "gemini", // Impersonates active provider or dev
    name: "Development Local Heuristic AI Provider",
    defaultModel: "dev-fallback-v1",
    contextWindow: 128000,
    capabilities: {
      supportsStructuredOutput: true,
      supportsFunctionCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsEmbeddings: true,
      supportsRerank: true,
      supportsModeration: true,
    },
    pricing: {
      promptTokenUsdPer1k: 0,
      completionTokenUsdPer1k: 0,
    },
  };

  protected async doGenerateText(
    prompt: string,
    options?: ExecutionOptions
  ): Promise<{ data: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return {
      data: `Dev AI Output for prompt: ${prompt.substring(0, 100)}...`,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }

  protected async doGenerateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions
  ): Promise<{ data: T; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    console.log(`[DevAIProvider] Generating Zod-structured object for prompt length ${prompt.length}...`);

    // Smart heuristic matching for known schemas
    let result: unknown;

    if (
      prompt.includes("Perform casino entity resolution") ||
      prompt.includes("canonical Casino identity") ||
      prompt.includes("Target URL:")
    ) {
      const urlMatch = prompt.match(/Target URL:\s*(https?:\/\/[^\s\n]+)/) || prompt.match(/(https?:\/\/[^\s'"]+)/);
      const domainMatch = prompt.match(/Domain:\s*([^\s\n]+)/);

      let rawUrl = urlMatch ? urlMatch[1] : "https://example-casino.com";
      let host = domainMatch ? domainMatch[1] : "";
      if (!host && urlMatch) {
        try {
          host = new URL(rawUrl).hostname.replace(/^www\./, "");
        } catch {
          host = "example-casino.com";
        }
      }
      if (!host) host = "example-casino.com";

      const baseBrand = host.split(".")[0] || "example-casino";
      const name = baseBrand
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      const slug = baseBrand.toLowerCase();
      const website_url = `https://${host}`;

      result = {
        name,
        slug,
        domain: host,
        website_url,
        status: "ACTIVE",
        license_info: "MGA/B2C/888/2024",
        verified_at: new Date(),
      };
    } else if (
      prompt.includes("Extract all slot games") ||
      prompt.includes("slot games mentioned")
    ) {
      // Heuristic extraction for slot game lobby text
      const contentIndex = prompt.indexOf("Content:");
      const rawText = contentIndex !== -1 ? prompt.substring(contentIndex) : prompt;

      const games: { name: string; providerNameHint: string | null }[] = [];
      const lines = rawText.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("Content:") || trimmed.startsWith("URL:") || trimmed.startsWith("Casino ID:")) {
          continue;
        }

        // Match patterns like "1. Starburst by NetEnt - Spin..." or "- Book of Dead" or "Gonzo's Quest by NetEnt"
        const listMatch = trimmed.match(/^(?:\d+[\.\)]|[\*\-\•])?\s*([A-Za-z0-9'&:\s]+?)(?:\s+by\s+([A-Za-z0-9'\s]+))?(?:\s*[\-\–].*)?$/i);

        if (listMatch) {
          let name = listMatch[1].trim();
          let provider = listMatch[2] ? listMatch[2].trim() : null;

          // Ignore common header/footer strings
          const lowerName = name.toLowerCase();
          if (
            lowerName.includes("welcome") ||
            lowerName.includes("terms") ||
            lowerName.includes("trending") ||
            lowerName.includes("instructions") ||
            name.length < 3
          ) {
            continue;
          }

          games.push({
            name,
            providerNameHint: provider,
          });
        }
      }

      result = { games };
    } else if (
      prompt.includes("casino ID") ||
      prompt.includes("Casino ID") ||
      prompt.includes("Extract bonus")
    ) {
      // Heuristic extraction for bonus text (regex-based fallback)
      const matchCasinoId =
        prompt.match(/casino ID '([^']+)'/i) ||
        prompt.match(/Casino ID:\s*([^\s\n]+)/i);
      const casinoId = matchCasinoId ? matchCasinoId[1] : "00000000-0000-0000-0000-000000000000";

      // 1. Headline value heuristic regexes
      let headline_value: string | null = null;
      const pctMatch = prompt.match(/\b(\d+(?:\.\d+)?%\s*(?:up\s+to|match)?\s*[$€£]?\d+(?:\.\d+)?(?:\s*\+\s*\d+\s+Free\s+Spins)?)\b/i);
      const freeBetMatch = prompt.match(/([$€£]\d+(?:\.\d+)?(?:\s+Free\s+Bet)?(?:\s*\+\s*[$€£]?\d+\s+Bonus)?)\b/i);
      const spinsMatch = prompt.match(/\b(\d+\s+Free\s+Spins(?:\s+No\s+Deposit)?)\b/i);

      if (pctMatch) {
        headline_value = pctMatch[1].trim();
      } else if (freeBetMatch) {
        headline_value = freeBetMatch[1].trim();
      } else if (spinsMatch) {
        headline_value = spinsMatch[1].trim();
      }

      // 2. Wagering requirement heuristic
      const wageringMatch =
        prompt.match(/(\d+(?:\.\d+)?)\s*x\s*(?:wagering|playthrough)?/i) ||
        prompt.match(/wagering[:\s]+(\d+(?:\.\d+)?)\s*x?/i);
      const wagering_requirement = wageringMatch ? parseFloat(wageringMatch[1]) : null;

      // 3. Max conversion heuristic
      const maxConvMatch =
        prompt.match(/max\s*(?:conversion|payout|cashout|withdrawal)?[:\s]+[$€£]?(\d+(?:\.\d+)?)/i) ||
        prompt.match(/cap[:\s]+[$€£]?(\d+(?:\.\d+)?)/i);
      const max_conversion = maxConvMatch ? parseFloat(maxConvMatch[1]) : null;

      // 4. Bonus type heuristic
      let type = "WELCOME_PACKAGE";
      if (/free\s+spins/i.test(prompt)) type = "FREE_SPINS";
      else if (/free\s+bet/i.test(prompt)) type = "FREE_BET";

      result = {
        casino_id: casinoId,
        type,
        headline_value,
        wagering_requirement,
        max_conversion,
        valid_from: new Date(),
        valid_until: null,
        status: "ACTIVE",
      };
    } else {
      result = {
        name: "Dev Extracted Casino",
        slug: "dev-extracted-casino",
        domain: "example.com",
        status: "ACTIVE",
        license_info: "MGA/B2C/888/2024",
        website_url: "https://example.com",
        verified_at: new Date(),
      };
    }

    return {
      data: result as T,
      usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    };
  }
}
