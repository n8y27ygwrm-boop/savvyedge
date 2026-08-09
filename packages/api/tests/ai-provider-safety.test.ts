import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIConfigLoader,
  AIEngine,
  AIProvider,
  DevAIProvider,
  GeminiProvider,
  OpenAIProvider,
  ProviderFactory,
  ProviderRegistry,
} from "@savvyedge/ai-agents";

describe("AI Provider Safety & Fail-Closed Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all AI API keys by default in each test
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROK_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.COHERE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.ACTIVE_AI_PROVIDER;
    delete process.env.FALLBACK_AI_PROVIDERS;

    ProviderRegistry.resetForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    ProviderRegistry.resetForTesting();
    vi.restoreAllMocks();
  });

  describe("Gemini Model Configuration", () => {
    it("defaults to gemini-2.5-pro when GEMINI_MODEL is not set", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const provider = ProviderFactory.createProvider("gemini");
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.metadata.defaultModel).toBe("gemini-2.5-pro");
    });

    it("overrides default model when GEMINI_MODEL is set", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.GEMINI_MODEL = "gemini-2.5-flash";
      const provider = ProviderFactory.createProvider("gemini");
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.metadata.defaultModel).toBe("gemini-2.5-flash");
    });
  });

  describe("Remote Provider Authentication Fail-Closed Enforcement", () => {
    it("resolves GeminiProvider when valid key is provided", () => {
      process.env.GEMINI_API_KEY = "valid-key-123";
      const provider = ProviderFactory.createProvider("gemini");
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.metadata.id).toBe("gemini");
    });

    it("throws explicit configuration error and does NOT return DevAIProvider when Gemini key is missing", () => {
      expect(() => ProviderFactory.createProvider("gemini")).toThrowError(
        /Missing API key for AI provider 'gemini'/,
      );
    });

    it("throws explicit configuration error and does NOT return DevAIProvider when OpenAI key is missing", () => {
      expect(() => ProviderFactory.createProvider("openai")).toThrowError(
        /Missing API key for AI provider 'openai'/,
      );
    });

    it("throws explicit configuration error and does NOT return DevAIProvider when Anthropic key is missing", () => {
      expect(() => ProviderFactory.createProvider("anthropic")).toThrowError(
        /Missing API key for AI provider 'anthropic'/,
      );
    });

    it("throws explicit configuration error and does NOT return DevAIProvider when OpenRouter key is missing", () => {
      expect(() => ProviderFactory.createProvider("openrouter")).toThrowError(
        /Missing API key for AI provider 'openrouter'/,
      );
    });
  });

  describe("Explicit Dev Provider Selection", () => {
    it("returns DevAIProvider only when explicitly requested via 'dev' provider ID", () => {
      const provider = ProviderFactory.createProvider("dev");
      expect(provider).toBeInstanceOf(DevAIProvider);
      expect(provider.metadata.id).toBe("dev");
    });

    it("allows explicit DevAIProvider usage via ACTIVE_AI_PROVIDER='dev'", () => {
      process.env.ACTIVE_AI_PROVIDER = "dev";
      const engine = new AIEngine();
      const activeProvider = engine.getActiveProvider();
      expect(activeProvider).toBeInstanceOf(DevAIProvider);
      expect(activeProvider.metadata.id).toBe("dev");
    });
  });

  describe("Safe Fallback Defaults and Failover Behavior", () => {
    it("defaults to NO fallback providers if FALLBACK_AI_PROVIDERS is not specified", () => {
      const config = AIConfigLoader.loadConfig();
      expect(config.activeProvider).toBe("gemini");
      expect(config.fallbackProviders).toEqual([]);
    });

    it("parses explicitly configured fallback providers", () => {
      process.env.FALLBACK_AI_PROVIDERS = "openai,anthropic";
      const config = AIConfigLoader.loadConfig();
      expect(config.fallbackProviders).toEqual(["openai", "anthropic"]);
    });

    it("fails closed without synthetic DevAIProvider execution during unauthenticated failover", async () => {
      // Configure active as gemini (with key) and fallback as openai (without key)
      process.env.GEMINI_API_KEY = "valid-gemini-key";
      process.env.FALLBACK_AI_PROVIDERS = "openai";

      const engine = new AIEngine();

      // Mock generateText on Gemini to simulate an upstream failure
      const geminiProvider = engine.getActiveProvider();
      vi.spyOn(geminiProvider, "generateText").mockRejectedValue(
        new Error("Gemini quota exceeded"),
      );

      // AIEngine should attempt failover to OpenAI, discover missing key, and throw
      await expect(
        engine.generateText("Test prompt without network"),
      ).rejects.toThrow(/All configured AI Providers failed/);
    });

    it("succeeds during failover when a fallback provider has valid credentials", async () => {
      process.env.GEMINI_API_KEY = "valid-gemini-key";
      process.env.OPENAI_API_KEY = "valid-openai-key";
      process.env.FALLBACK_AI_PROVIDERS = "openai";

      const engine = new AIEngine();

      // Active provider fails
      const geminiProvider = ProviderRegistry.getInstance().getProvider("gemini");
      vi.spyOn(geminiProvider, "generateText").mockRejectedValue(
        new Error("Gemini upstream 503"),
      );

      // Fallback provider succeeds
      const openaiProvider = ProviderRegistry.getInstance().getProvider("openai");
      expect(openaiProvider).toBeInstanceOf(OpenAIProvider);
      vi.spyOn(openaiProvider, "generateText").mockResolvedValue({
        data: "Recovered output from OpenAI fallback",
        telemetry: {
          traceId: "test-trace",
          provider: "openai",
          model: "gpt-4o",
          latencyMs: 120,
          tokens: { prompt: 10, completion: 20, total: 30 },
          costUsd: 0.0001,
          success: true,
        },
      });

      const result = await engine.generateText("Test prompt");
      expect(result.data).toBe("Recovered output from OpenAI fallback");
      expect(result.telemetry.provider).toBe("openai");
    });
  });
});
