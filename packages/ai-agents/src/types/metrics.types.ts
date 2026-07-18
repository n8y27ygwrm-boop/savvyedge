export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostMetrics {
  promptCostUsd: number;
  completionCostUsd: number;
  totalCostUsd: number;
}

export interface LatencyMetrics {
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
}

export interface ExecutionTelemetry {
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: CostMetrics;
  latency: LatencyMetrics;
  traceId?: string;
}

export interface ProviderHealthStatus {
  provider: string;
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: Date;
  error?: string;
}
