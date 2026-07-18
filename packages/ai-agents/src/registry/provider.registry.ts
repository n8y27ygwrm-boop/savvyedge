import { AIProvider, AIProviderId } from "../types/provider.types";
import { ProviderFactory } from "./provider.factory";

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<AIProviderId, AIProvider> = new Map();

  private constructor() {}

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public getProvider(id: AIProviderId): AIProvider {
    if (!this.providers.has(id)) {
      const provider = ProviderFactory.createProvider(id);
      this.providers.set(id, provider);
    }
    return this.providers.get(id)!;
  }

  public registerProvider(id: AIProviderId, provider: AIProvider): void {
    this.providers.set(id, provider);
  }

  public getAllRegistered(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}
