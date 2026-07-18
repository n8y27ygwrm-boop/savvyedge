import { z } from "zod";
import {
  AIProvider,
  AIProviderId,
  AIResponse,
  ExecutionOptions,
  EmbeddingResponse,
  ModerationResponse,
  RerankResponse,
} from "../types/provider.types";
import { AIConfigLoader, AIEngineConfig } from "../config/ai-config";
import { ProviderRegistry } from "../registry/provider.registry";
import { AILogger } from "../telemetry/logger";

export class AIEngine {
  private config: AIEngineConfig;
  private registry: ProviderRegistry;

  constructor(config?: Partial<AIEngineConfig>) {
    const defaultConfig = AIConfigLoader.loadConfig();
    this.config = { ...defaultConfig, ...config };
    this.registry = ProviderRegistry.getInstance();
  }

  public getActiveProvider(): AIProvider {
    return this.registry.getProvider(this.config.activeProvider);
  }

  public async generateText(prompt: string, options?: ExecutionOptions): Promise<AIResponse<string>> {
    return this.executeWithFailover((provider) => provider.generateText(prompt, options));
  }

  public async generateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions
  ): Promise<AIResponse<T>> {
    return this.executeWithFailover((provider) => provider.generateStructuredObject(prompt, schema, options));
  }

  public async extractCasino(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>> {
    return this.executeWithFailover((provider) => provider.extractCasino(unstructuredText, options));
  }

  public async extractBonus(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>> {
    return this.executeWithFailover((provider) => provider.extractBonus(unstructuredText, options));
  }

  public async summarizeReview(reviewText: string, options?: ExecutionOptions): Promise<AIResponse<string>> {
    return this.executeWithFailover((provider) => provider.summarizeReview(reviewText, options));
  }

  public async classifyContent(content: string, categories: string[], options?: ExecutionOptions): Promise<AIResponse<string>> {
    return this.executeWithFailover((provider) => provider.classifyContent(content, categories, options));
  }

  public async compareEntities(entityA: unknown, entityB: unknown, options?: ExecutionOptions): Promise<AIResponse<string>> {
    return this.executeWithFailover((provider) => provider.compareEntities(entityA, entityB, options));
  }

  public async generateEmbeddings(texts: string[], options?: ExecutionOptions): Promise<EmbeddingResponse> {
    return this.executeWithFailover((provider) => provider.generateEmbeddings(texts, options));
  }

  public async rerank(query: string, documents: string[], options?: ExecutionOptions): Promise<RerankResponse> {
    return this.executeWithFailover((provider) => provider.rerank(query, documents, options));
  }

  public async moderate(content: string, options?: ExecutionOptions): Promise<ModerationResponse> {
    return this.executeWithFailover((provider) => provider.moderate(content, options));
  }

  private async executeWithFailover<T>(operation: (provider: AIProvider) => Promise<T>): Promise<T> {
    const providersToTry: AIProviderId[] = [this.config.activeProvider, ...this.config.fallbackProviders];
    let lastError: unknown;

    for (const providerId of providersToTry) {
      try {
        const provider = this.registry.getProvider(providerId);
        return await operation(provider);
      } catch (error) {
        lastError = error;
        AILogger.logError(providerId, "FailoverAttempt", error);
        console.warn(`[AI-ENGINE] Provider '${providerId}' failed. Attempting failover to next provider...`);
      }
    }

    throw new Error(`All configured AI Providers failed. Last error: ${String(lastError)}`);
  }
}
