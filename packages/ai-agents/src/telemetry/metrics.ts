import { TokenUsage, CostMetrics, LatencyMetrics, ExecutionTelemetry } from "../types/metrics.types";
import { ModelPricing } from "../types/provider.types";

export class AIMetricsCalculator {
  public static calculateCost(usage: TokenUsage, pricing: ModelPricing): CostMetrics {
    const promptCostUsd = (usage.promptTokens / 1000) * pricing.promptTokenUsdPer1k;
    const completionCostUsd = (usage.completionTokens / 1000) * pricing.completionTokenUsdPer1k;
    const totalCostUsd = promptCostUsd + completionCostUsd;

    return {
      promptCostUsd,
      completionCostUsd,
      totalCostUsd,
    };
  }

  public static createTelemetry(
    provider: string,
    model: string,
    usage: TokenUsage,
    pricing: ModelPricing,
    latency: LatencyMetrics,
    traceId?: string
  ): ExecutionTelemetry {
    const cost = this.calculateCost(usage, pricing);
    return {
      provider,
      model,
      usage,
      cost,
      latency,
      traceId,
    };
  }
}
