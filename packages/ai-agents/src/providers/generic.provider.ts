import { z } from "zod";
import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { BaseAIProvider } from "./base.provider";
import { ProviderMetadata, ExecutionOptions, AIProviderId } from "../types/provider.types";

export interface GenericProviderConfig {
  id: AIProviderId;
  name: string;
  defaultModel: string;
  baseURL?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
  pricing?: { promptTokenUsdPer1k: number; completionTokenUsdPer1k: number };
}

export class GenericOpenAICompatibleProvider extends BaseAIProvider {
  public readonly metadata: ProviderMetadata;
  private client: ReturnType<typeof createOpenAI>;

  constructor(config: GenericProviderConfig) {
    super();
    this.metadata = {
      id: config.id,
      name: config.name,
      defaultModel: config.defaultModel,
      contextWindow: config.contextWindow || 128000,
      capabilities: {
        supportsStructuredOutput: true,
        supportsFunctionCalling: true,
        supportsReasoning: true,
        supportsVision: false,
        supportsStreaming: true,
        supportsEmbeddings: true,
        supportsRerank: false,
        supportsModeration: false,
      },
      pricing: config.pricing || { promptTokenUsdPer1k: 0.001, completionTokenUsdPer1k: 0.002 },
    };

    const apiKey = config.apiKeyEnvVar ? process.env[config.apiKeyEnvVar] || "dummy-key" : "dummy-key";
    this.client = createOpenAI({
      baseURL: config.baseURL,
      apiKey,
    });
  }

  protected async doGenerateText(
    prompt: string,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const modelName = options?.model || this.metadata.defaultModel;
    const response = await generateText({
      model: this.client(modelName),
      prompt,
      system: options?.systemPrompt,
      temperature: options?.temperature,
      abortSignal: signal,
    });

    return {
      data: response.text,
      usage: {
        promptTokens: response.usage?.inputTokens || 0,
        completionTokens: response.usage?.outputTokens || 0,
        totalTokens: response.usage?.totalTokens || 0,
      },
    };
  }

  protected async doGenerateStructuredObject<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: T; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const modelName = options?.model || this.metadata.defaultModel;
    const response = await generateObject({
      model: this.client(modelName),
      prompt,
      schema,
      system: options?.systemPrompt,
      temperature: options?.temperature,
      abortSignal: signal,
    });

    return {
      data: response.object as T,
      usage: {
        promptTokens: response.usage?.inputTokens || 0,
        completionTokens: response.usage?.outputTokens || 0,
        totalTokens: response.usage?.totalTokens || 0,
      },
    };
  }
}
