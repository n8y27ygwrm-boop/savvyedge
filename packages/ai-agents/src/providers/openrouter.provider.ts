import { z } from "zod";
import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { BaseAIProvider } from "./base.provider";
import { ProviderMetadata, ExecutionOptions } from "../types/provider.types";

export class OpenRouterProvider extends BaseAIProvider {
  private openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "dummy",
  });

  public readonly metadata: ProviderMetadata = {
    id: "openrouter",
    name: "OpenRouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    contextWindow: 200000,
    capabilities: {
      supportsStructuredOutput: true,
      supportsFunctionCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsEmbeddings: false,
      supportsRerank: false,
      supportsModeration: false,
    },
    pricing: {
      promptTokenUsdPer1k: 0.003,
      completionTokenUsdPer1k: 0.015,
    },
  };

  protected async doGenerateText(
    prompt: string,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const modelName = options?.model || this.metadata.defaultModel;
    const response = await generateText({
      model: this.openrouter(modelName),
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
      model: this.openrouter(modelName),
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
