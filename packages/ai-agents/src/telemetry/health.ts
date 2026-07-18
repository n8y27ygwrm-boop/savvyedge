import { ProviderHealthStatus } from "../types/metrics.types";
import { AIProvider } from "../types/provider.types";

export class ProviderHealthChecker {
  public static async checkHealth(provider: AIProvider): Promise<ProviderHealthStatus> {
    try {
      return await provider.healthCheck();
    } catch (error: any) {
      return {
        provider: provider.metadata.id,
        isHealthy: false,
        latencyMs: -1,
        lastChecked: new Date(),
        error: error.message || "Unknown health check failure",
      };
    }
  }
}
