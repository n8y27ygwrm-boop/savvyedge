import { AIProviderId } from "../types/provider.types";

export interface AIEngineConfig {
  activeProvider: AIProviderId;
  fallbackProviders: AIProviderId[];
  defaultTimeoutMs: number;
  defaultMaxRetries: number;
}

export class AIConfigLoader {
  public static loadConfig(): AIEngineConfig {
    const activeProvider = (process.env.ACTIVE_AI_PROVIDER as AIProviderId) || "gemini";
    
    const fallbackEnv = process.env.FALLBACK_AI_PROVIDERS || "openai,anthropic,openrouter";
    const fallbackProviders = fallbackEnv
      .split(",")
      .map((p) => p.trim() as AIProviderId)
      .filter((p) => p !== activeProvider);

    return {
      activeProvider,
      fallbackProviders,
      defaultTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || "30000", 10),
      defaultMaxRetries: parseInt(process.env.AI_MAX_RETRIES || "3", 10),
    };
  }
}
