import { AIProvider, AIProviderId } from "../types/provider.types";
import { GeminiProvider } from "../providers/gemini.provider";
import { OpenAIProvider } from "../providers/openai.provider";
import { AnthropicProvider } from "../providers/anthropic.provider";
import { OpenRouterProvider } from "../providers/openrouter.provider";
import { GenericOpenAICompatibleProvider } from "../providers/generic.provider";
import { DevAIProvider } from "../providers/dev.provider";

export class ProviderFactory {
  public static createProvider(id: AIProviderId): AIProvider {
    // Check if an API key exists for remote providers
    const hasGeminiKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY);
    const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
    const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY);

    switch (id) {
      case "gemini":
        return hasGeminiKey ? new GeminiProvider() : new DevAIProvider();
      case "openai":
        return hasOpenAIKey ? new OpenAIProvider() : new DevAIProvider();
      case "anthropic":
        return hasAnthropicKey ? new AnthropicProvider() : new DevAIProvider();
      case "openrouter":
        return hasOpenRouterKey ? new OpenRouterProvider() : new DevAIProvider();
      case "deepseek":
        return process.env.DEEPSEEK_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "deepseek",
              name: "DeepSeek",
              defaultModel: "deepseek-chat",
              baseURL: "https://api.deepseek.com/v1",
              apiKeyEnvVar: "DEEPSEEK_API_KEY",
            })
          : new DevAIProvider();
      case "grok":
        return process.env.GROK_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "grok",
              name: "xAI Grok",
              defaultModel: "grok-2-latest",
              baseURL: "https://api.x.ai/v1",
              apiKeyEnvVar: "GROK_API_KEY",
            })
          : new DevAIProvider();
      case "mistral":
        return process.env.MISTRAL_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "mistral",
              name: "Mistral AI",
              defaultModel: "mistral-large-latest",
              baseURL: "https://api.mistral.ai/v1",
              apiKeyEnvVar: "MISTRAL_API_KEY",
            })
          : new DevAIProvider();
      case "cohere":
        return process.env.COHERE_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "cohere",
              name: "Cohere",
              defaultModel: "command-r-plus",
              baseURL: "https://api.cohere.com/v2",
              apiKeyEnvVar: "COHERE_API_KEY",
            })
          : new DevAIProvider();
      case "together":
        return process.env.TOGETHER_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "together",
              name: "Together AI",
              defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
              baseURL: "https://api.together.xyz/v1",
              apiKeyEnvVar: "TOGETHER_API_KEY",
            })
          : new DevAIProvider();
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
      case "perplexity":
        return process.env.PERPLEXITY_API_KEY
          ? new GenericOpenAICompatibleProvider({
              id: "perplexity",
              name: "Perplexity AI",
              defaultModel: "sonar-reasoning",
              baseURL: "https://api.perplexity.ai",
              apiKeyEnvVar: "PERPLEXITY_API_KEY",
            })
          : new DevAIProvider();
      case "azure":
      case "bedrock":
      case "vertex":
      case "huggingface":
        return new GenericOpenAICompatibleProvider({
          id,
          name: id.toUpperCase(),
          defaultModel: "default-model",
          apiKeyEnvVar: `${id.toUpperCase()}_API_KEY`,
        });
      default:
        return new DevAIProvider();
    }
  }
}
