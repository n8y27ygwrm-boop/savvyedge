import { ExecutionTelemetry } from "../types/metrics.types";

export class AILogger {
  public static logExecution(telemetry: ExecutionTelemetry, action: string): void {
    const logPayload = {
      timestamp: new Date().toISOString(),
      action,
      provider: telemetry.provider,
      model: telemetry.model,
      durationMs: telemetry.latency.durationMs,
      promptTokens: telemetry.usage.promptTokens,
      completionTokens: telemetry.usage.completionTokens,
      totalTokens: telemetry.usage.totalTokens,
      totalCostUsd: telemetry.cost.totalCostUsd.toFixed(6),
      traceId: telemetry.traceId || "n/a",
    };

    console.log(`[AI-ENGINE] [${action}]`, JSON.stringify(logPayload));
  }

  public static logError(provider: string, action: string, error: unknown): void {
    console.error(`[AI-ENGINE-ERROR] [${provider}] [${action}]`, error);
  }
}
