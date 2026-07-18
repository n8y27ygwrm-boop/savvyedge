export class RetryHandler {
  public static async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 500,
    backoffFactor: number = 2
  ): Promise<T> {
    let lastError: unknown;
    let delay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) break;

        // Apply exponential backoff with jitter
        const jitter = Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay *= backoffFactor;
      }
    }

    throw lastError;
  }
}
