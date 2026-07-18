import { z } from "zod";
import { ExecutionTelemetry, ProviderHealthStatus } from "./metrics.types";

export type AIProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "grok"
  | "deepseek"
  | "mistral"
  | "cohere"
  | "together"
  | "openrouter"
  | "ollama"
  | "lmstudio"
  | "azure"
  | "bedrock"
  | "vertex"
  | "huggingface"
  | "perplexity";

export interface ProviderCapabilities {
  supportsStructuredOutput: boolean;
  supportsFunctionCalling: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  supportsRerank: boolean;
  supportsModeration: boolean;
}

export interface ModelPricing {
  promptTokenUsdPer1k: number;
  completionTokenUsdPer1k: number;
}

export interface ProviderMetadata {
  id: AIProviderId;
  name: string;
  defaultModel: string;
  contextWindow: number;
  capabilities: ProviderCapabilities;
  pricing: ModelPricing;
}

export interface ExecutionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  timeoutMs?: number;
  retries?: number;
  traceId?: string;
}

export interface AIResponse<T> {
  data: T;
  telemetry: ExecutionTelemetry;
  rawText?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  telemetry: ExecutionTelemetry;
}

export interface ModerationResponse {
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
  telemetry: ExecutionTelemetry;
}

export interface RerankItem {
  id: string;
  text: string;
  score: number;
}

export interface RerankResponse {
  results: RerankItem[];
  telemetry: ExecutionTelemetry;
}

/**
 * Universal Unified Interface for all AI Providers
 */
export interface AIProvider {
  readonly metadata: ProviderMetadata;

  generateText(prompt: string, options?: ExecutionOptions): Promise<AIResponse<string>>;

  generateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions
  ): Promise<AIResponse<T>>;

  extractCasino(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>>;

  extractBonus(unstructuredText: string, options?: ExecutionOptions): Promise<AIResponse<unknown>>;

  summarizeReview(reviewText: string, options?: ExecutionOptions): Promise<AIResponse<string>>;

  classifyContent(content: string, categories: string[], options?: ExecutionOptions): Promise<AIResponse<string>>;

  compareEntities(entityA: unknown, entityB: unknown, options?: ExecutionOptions): Promise<AIResponse<string>>;

  generateEmbeddings(texts: string[], options?: ExecutionOptions): Promise<EmbeddingResponse>;

  rerank(query: string, documents: string[], options?: ExecutionOptions): Promise<RerankResponse>;

  moderate(content: string, options?: ExecutionOptions): Promise<ModerationResponse>;

  validateOutput<T>(data: unknown, schema: z.ZodSchema<T>): T;

  healthCheck(): Promise<ProviderHealthStatus>;
}
