import { z } from "zod";
import { BaseAgent } from "../core/BaseAgent";
import { AIEngine } from "../engine/ai.engine";

const engine = new AIEngine();

export const GameListInputSchema = z.object({
  url: z.string().url(),
  casinoId: z.string().uuid(),
  scrapedContent: z.string(),
});

export type GameListInput = z.infer<typeof GameListInputSchema>;

export const GameListOutputSchema = z.object({
  games: z.array(
    z.object({
      name: z.string(),
      providerNameHint: z.string().nullable(),
    })
  ),
});

export type GameListOutput = z.infer<typeof GameListOutputSchema>;

export class GameListAgent extends BaseAgent<GameListInput, GameListOutput> {
  protected inputSchema = GameListInputSchema;
  protected outputSchema = GameListOutputSchema;

  protected async execute(input: GameListInput): Promise<GameListOutput> {
    const prompt = `Extract all slot games mentioned on the casino game lobby page below.

URL: ${input.url}
Casino ID: ${input.casinoId}

Content:
${input.scrapedContent}

Instructions:
- Extract ONLY games that are explicitly named in the text content.
- Do NOT invent, hallucinate, or infer any game titles that are not textually present.
- For each game, extract the game title ('name').
- If a game provider is explicitly mentioned near the game title (e.g. "Book of Dead by Play'n GO"), set 'providerNameHint' to that provider's name (e.g. "Play'n GO").
- If no provider is explicitly stated for a game, set 'providerNameHint' to null. Do NOT guess or infer a provider.`;

    const res = await engine.generateStructuredObject(prompt, this.outputSchema);
    return res.data;
  }
}
