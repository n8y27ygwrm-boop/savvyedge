import { z } from "zod";
import {
  AIProvider,
  AIResponse,
  ExecutionOptions,
  ProviderMetadata,
  EmbeddingResponse,
  ModerationResponse,
  RerankResponse,
} from "../types/provider.types";
import { ProviderHealthStatus } from "../types/metrics.types";
import { AILogger } from "../telemetry/logger";
import { AIMetricsCalculator } from "../telemetry/metrics";
import { RetryHandler } from "../resilience/retry";
import { TimeoutHandler } from "../resilience/timeout";
import { CreateCasinoInputSchema, CreateBonusInputSchema } from "@savvyedge/types";
import { ClassificationResultSchema, EntityComparisonSchema, ReviewSummarySchema } from "../types/domain.types";

export abstract class BaseAIProvider implements AIProvider {
  public abstract readonly metadata: ProviderMetadata;

  public validateOutput<T>(data: unknown, schema: z.ZodSchema<T>): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Zod Output Validation Failed for ${this.metadata.id}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  public async generateText(prompt: string, options?: ExecutionOptions): Promise<AIResponse<string>> {
    return this.executeWithGovernance("generateText", options, async (signal) => {
      return this.doGenerateText(prompt, options, signal);
    });
  }

  public async generateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions
  ): Promise<AIResponse<T>> {
    return this.executeWithGovernance("generateStructuredObject", options, async (signal) => {
      const rawResult = await this.doGenerateStructuredObject(prompt, schema, options, signal);
      const validatedData = this.validateOutput(rawResult.data, schema);
      return {
        ...rawResult,
        data: validatedData,
      };
    });
  }

  public async extractCasino(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>> {
    const prompt = `Extract structured Casino entity from the following text:\n\n${unstructuredText}`;
    return this.generateStructuredObject(prompt, CreateCasinoInputSchema, options);
  }

  public async extractBonus(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>> {
    const prompt = `Extract structured Bonus entity from the following text:\n\n${unstructuredText}`;
    return this.generateStructuredObject(prompt, CreateBonusInputSchema, options);
  }

  public async summarizeReview(reviewText: string, options?: ExecutionOptions): Promise<AIResponse<string>> {
    const prompt = `Summarize the following review into key insights:\n\n${reviewText}`;
    const result = await this.generateStructuredObject(prompt, ReviewSummarySchema, options);
    return {
      data: JSON.stringify(result.data, null, 2),
      telemetry: result.telemetry,
      rawText: JSON.stringify(result.data),
    };
  }

  public async classifyContent(content: string, categories: string[], options?: ExecutionOptions): Promise<AIResponse<string>> {
    const prompt = `Classify the following text into one of these categories: ${categories.join(", ")}.\n\nText: ${content}`;
    const result = await this.generateStructuredObject(prompt, ClassificationResultSchema, options);
    return {
      data: result.data.category,
      telemetry: result.telemetry,
      rawText: JSON.stringify(result.data),
    };
  }

  public async compareEntities(entityA: unknown, entityB: unknown, options?: ExecutionOptions): Promise<AIResponse<string>> {
    const prompt = `Compare Entity A and Entity B objectively based on data:\nEntity A: ${JSON.stringify(entityA)}\nEntity B: ${JSON.stringify(entityB)}`;
    const result = await this.generateStructuredObject(prompt, EntityComparisonSchema, options);
    return {
      data: JSON.stringify(result.data, null, 2),
      telemetry: result.telemetry,
      rawText: JSON.stringify(result.data),
    };
  }

  public async generateEmbeddings(texts: string[], options?: ExecutionOptions): Promise<EmbeddingResponse> {
    const startTime = Date.now();
    const result = await RetryHandler.executeWithRetry(() =>
      TimeoutHandler.executeWithTimeout((signal) => this.doGenerateEmbeddings(texts, options, signal), options?.timeoutMs)
    );
    const durationMs = Date.now() - startTime;
    const telemetry = AIMetricsCalculator.createTelemetry(
      this.metadata.id,
      options?.model || this.metadata.defaultModel,
      result.usage,
      this.metadata.pricing,
      { startTimeMs: startTime, endTimeMs: Date.now(), durationMs },
      options?.traceId
    );
    AILogger.logExecution(telemetry, "generateEmbeddings");
    return { embeddings: result.embeddings, telemetry };
  }

  public async rerank(query: string, documents: string[], options?: ExecutionOptions): Promise<RerankResponse> {
    const startTime = Date.now();
    const result = await RetryHandler.executeWithRetry(() =>
      TimeoutHandler.executeWithTimeout((signal) => this.doRerank(query, documents, options, signal), options?.timeoutMs)
    );
    const durationMs = Date.now() - startTime;
    const telemetry = AIMetricsCalculator.createTelemetry(
      this.metadata.id,
      options?.model || this.metadata.defaultModel,
      result.usage,
      this.metadata.pricing,
      { startTimeMs: startTime, endTimeMs: Date.now(), durationMs },
      options?.traceId
    );
    AILogger.logExecution(telemetry, "rerank");
    return { results: result.results, telemetry };
  }

  public async moderate(content: string, options?: ExecutionOptions): Promise<ModerationResponse> {
    const startTime = Date.now();
    const result = await RetryHandler.executeWithRetry(() =>
      TimeoutHandler.executeWithTimeout((signal) => this.doModerate(content, options, signal), options?.timeoutMs)
    );
    const durationMs = Date.now() - startTime;
    const telemetry = AIMetricsCalculator.createTelemetry(
      this.metadata.id,
      options?.model || this.metadata.defaultModel,
      result.usage,
      this.metadata.pricing,
      { startTimeMs: startTime, endTimeMs: Date.now(), durationMs },
      options?.traceId
    );
    AILogger.logExecution(telemetry, "moderate");
    return { flagged: result.flagged, categories: result.categories, categoryScores: result.categoryScores, telemetry };
  }

  public async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      await this.generateText("Ping", { timeoutMs: 5000, retries: 0 });
      return {
        provider: this.metadata.id,
        isHealthy: true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (err: any) {
      return {
        provider: this.metadata.id,
        isHealthy: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: err.message,
      };
    }
  }

  protected async executeWithGovernance<T>(
    action: string,
    options: ExecutionOptions | undefined,
    fn: (signal: AbortSignal) => Promise<{ data: T; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; rawText?: string }>
  ): Promise<AIResponse<T>> {
    const startTime = Date.now();
    const retries = options?.retries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 30000;

    try {
      const res = await RetryHandler.executeWithRetry(
        () => TimeoutHandler.executeWithTimeout((signal) => fn(signal), timeoutMs),
        retries
      );
      const durationMs = Date.now() - startTime;
      const telemetry = AIMetricsCalculator.createTelemetry(
        this.metadata.id,
        options?.model || this.metadata.defaultModel,
        res.usage,
        this.metadata.pricing,
        { startTimeMs: startTime, endTimeMs: Date.now(), durationMs },
        options?.traceId
      );

      AILogger.logExecution(telemetry, action);
      return { data: res.data, telemetry, rawText: res.rawText };
    } catch (error) {
      AILogger.logError(this.metadata.id, action, error);
      throw error;
    }
  }

  protected abstract doGenerateText(
    prompt: string,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>;

  protected abstract doGenerateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: T; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>;

  protected async doGenerateEmbeddings(
    texts: string[],
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ embeddings: number[][]; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return { embeddings: texts.map(() => []), usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  protected async doRerank(
    query: string,
    documents: string[],
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ results: { id: string; text: string; score: number }[]; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return {
      results: documents.map((doc, idx) => ({ id: `doc-${idx}`, text: doc, score: 1.0 - idx * 0.1 })),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  protected async doModerate(
    content: string,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ flagged: boolean; categories: Record<string, boolean>; categoryScores: Record<string, number>; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return {
      flagged: false,
      categories: { hate: false, violence: false, spam: false },
      categoryScores: { hate: 0, violence: 0, spam: 0 },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
