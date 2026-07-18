import { z } from "zod";
import { generateText, generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { BaseAIProvider } from "./base.provider";
import { ProviderMetadata, ExecutionOptions } from "../types/provider.types";

export class AnthropicProvider extends BaseAIProvider {
  public readonly metadata: ProviderMetadata = {
    id: "anthropic",
    name: "Anthropic Claude",
    defaultModel: "claude-3-5-sonnet-20241022",
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
      model: anthropic(modelName),
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
      model: anthropic(modelName),
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
