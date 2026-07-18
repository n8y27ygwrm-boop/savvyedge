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
    } else if (prompt.includes("casino ID") || prompt.includes("Extract bonus")) {
      const matchCasinoId = prompt.match(/casino ID '([^']+)'/);
      const casinoId = matchCasinoId ? matchCasinoId[1] : "00000000-0000-0000-0000-000000000000";

      result = {
        casino_id: casinoId,
        type: "WELCOME_PACKAGE",
        headline_value: "100% up to $500 + 100 Free Spins",
        wagering_requirement: 35,
        max_conversion: 1000,
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
