import { z } from "zod";
import { generateText, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { BaseAIProvider } from "./base.provider";
import { ProviderMetadata, ExecutionOptions } from "../types/provider.types";

export class GeminiProvider extends BaseAIProvider {
  public readonly metadata: ProviderMetadata = {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-1.5-pro",
    contextWindow: 1048576,
    capabilities: {
      supportsStructuredOutput: true,
      supportsFunctionCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsEmbeddings: true,
      supportsRerank: false,
      supportsModeration: false,
    },
    pricing: {
      promptTokenUsdPer1k: 0.00125,
      completionTokenUsdPer1k: 0.005,
    },
  };

  protected async doGenerateText(
    prompt: string,
    options?: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<{ data: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const modelName = options?.model || this.metadata.defaultModel;
    const response = await generateText({
      model: google(modelName),
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
      model: google(modelName),
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
