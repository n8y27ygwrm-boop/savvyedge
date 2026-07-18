import { z } from "zod";

export interface AgentContext {
  promptContext: string;
}

export abstract class BaseAgent<Input, Output> {
  protected abstract inputSchema: z.ZodSchema<Input, any, any>;
  protected abstract outputSchema: z.ZodSchema<Output, any, any>;
  
  /**
   * Executes the agent's primary task. Subclasses must implement this.
   */
  protected abstract execute(input: Input, context?: AgentContext): Promise<Output>;

  /**
   * Public entrypoint that enforces typed input and output validation.
   */
  public async run(rawInput: unknown, context?: AgentContext): Promise<Output> {
    // 1. Validate Input
    const parseInputResult = this.inputSchema.safeParse(rawInput);
    if (!parseInputResult.success) {
      throw new Error(`Agent Input Validation Failed: ${parseInputResult.error.message}`);
    }

    // 2. Execute Business/LLM Logic (with automatic retries placeholder)
    let rawOutput: unknown;
    try {
      rawOutput = await this.execute(parseInputResult.data, context);
    } catch (error: any) {
      // In the future, exponential backoff and retry logic goes here
      throw new Error(`Agent Execution Failed: ${error.message}`);
    }

    // 3. Validate Output
    const parseOutputResult = this.outputSchema.safeParse(rawOutput);
    if (!parseOutputResult.success) {
      // In the future, this is where we'd ask the LLM to fix its own formatting error
      throw new Error(`Agent Output Validation Failed: ${parseOutputResult.error.message}`);
    }

    return parseOutputResult.data;
  }
}
