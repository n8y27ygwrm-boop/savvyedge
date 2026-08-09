import { AIProvider, AIProviderId } from "../types/provider.types";
import { GeminiProvider } from "../providers/gemini.provider";
import { OpenAIProvider } from "../providers/openai.provider";
import { AnthropicProvider } from "../providers/anthropic.provider";
import { OpenRouterProvider } from "../providers/openrouter.provider";
import { GenericOpenAICompatibleProvider } from "../providers/generic.provider";
import { DevAIProvider } from "../providers/dev.provider";

export class ProviderFactory {
  public static createProvider(id: AIProviderId): AIProvider {
    const hasGeminiKey = Boolean(
      process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY,
    );
    const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
    const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY);

    switch (id) {
      case "gemini":
        if (!hasGeminiKey) {
          throw new Error(
            "Missing API key for AI provider 'gemini' (expected GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)",
          );
        }
        return new GeminiProvider();

      case "openai":
        if (!hasOpenAIKey) {
          throw new Error(
            "Missing API key for AI provider 'openai' (expected OPENAI_API_KEY)",
          );
        }
        return new OpenAIProvider();

      case "anthropic":
        if (!hasAnthropicKey) {
          throw new Error(
            "Missing API key for AI provider 'anthropic' (expected ANTHROPIC_API_KEY)",
          );
        }
        return new AnthropicProvider();

      case "openrouter":
        if (!hasOpenRouterKey) {
          throw new Error(
            "Missing API key for AI provider 'openrouter' (expected OPENROUTER_API_KEY)",
          );
        }
        return new OpenRouterProvider();

      case "deepseek":
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'deepseek' (expected DEEPSEEK_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "deepseek",
          name: "DeepSeek",
          defaultModel: "deepseek-chat",
          baseURL: "https://api.deepseek.com/v1",
          apiKeyEnvVar: "DEEPSEEK_API_KEY",
        });

      case "grok":
        if (!process.env.GROK_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'grok' (expected GROK_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "grok",
          name: "xAI Grok",
          defaultModel: "grok-2-latest",
          baseURL: "https://api.x.ai/v1",
          apiKeyEnvVar: "GROK_API_KEY",
        });

      case "mistral":
        if (!process.env.MISTRAL_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'mistral' (expected MISTRAL_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "mistral",
          name: "Mistral AI",
          defaultModel: "mistral-large-latest",
          baseURL: "https://api.mistral.ai/v1",
          apiKeyEnvVar: "MISTRAL_API_KEY",
        });

      case "cohere":
        if (!process.env.COHERE_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'cohere' (expected COHERE_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "cohere",
          name: "Cohere",
          defaultModel: "command-r-plus",
          baseURL: "https://api.cohere.com/v2",
          apiKeyEnvVar: "COHERE_API_KEY",
        });

      case "together":
        if (!process.env.TOGETHER_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'together' (expected TOGETHER_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "together",
          name: "Together AI",
          defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
          baseURL: "https://api.together.xyz/v1",
          apiKeyEnvVar: "TOGETHER_API_KEY",
        });

      case "perplexity":
        if (!process.env.PERPLEXITY_API_KEY) {
          throw new Error(
            "Missing API key for AI provider 'perplexity' (expected PERPLEXITY_API_KEY)",
          );
        }
        return new GenericOpenAICompatibleProvider({
          id: "perplexity",
          name: "Perplexity AI",
          defaultModel: "sonar-reasoning",
          baseURL: "https://api.perplexity.ai",
          apiKeyEnvVar: "PERPLEXITY_API_KEY",
        });

      case "ollama":
        return new GenericOpenAICompatibleProvider({
          id: "ollama",
          name: "Ollama (Local)",
          defaultModel: "llama3",
          baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        });

      case "lmstudio":
        return new GenericOpenAICompatibleProvider({
          id: "lmstudio",
          name: "LM Studio (Local)",
          defaultModel: "local-model",
          baseURL: process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1",
        });

      case "azure":
      case "bedrock":
      case "vertex":
      case "huggingface": {
        const envVar = `${id.toUpperCase()}_API_KEY`;
        if (!process.env[envVar]) {
          throw new Error(
            `Missing API key for AI provider '${id}' (expected ${envVar})`,
          );
        }
        return new GenericOpenAICompatibleProvider({
          id,
          name: id.toUpperCase(),
          defaultModel: "default-model",
          apiKeyEnvVar: envVar,
        });
      }

      case "dev":
        return new DevAIProvider();

      default:
        throw new Error(`Unknown or unsupported AI provider '${id as string}'`);
    }
  }
}
