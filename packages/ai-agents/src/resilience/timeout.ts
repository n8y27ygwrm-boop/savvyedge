export class TimeoutHandler {
  public static async executeWithTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      return result;
    } catch (error: any) {
      if (controller.signal.aborted) {
        throw new Error(`Execution timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
