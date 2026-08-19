/**
 * Task-context vocabulary shared by the ingestion boundaries.
 *
 * Two independent policies need the same notion of "does this text talk about
 * the thing we asked for":
 *  - source-page eligibility (is the rendered destination the right page?)
 *  - extraction-input sufficiency (is the rendered text worth extracting?)
 *
 * The patterns live here so neither policy has to import the other. They are
 * intentionally case-insensitive and carry no `g` flag, so `.test()` is
 * stateless and safe to share across callers.
 */

export type IngestionTaskContext = "BONUS" | "GAME_LIST";

export const CONTEXT_TERMS: Record<IngestionTaskContext, RegExp> = {
  BONUS:
    /\b(?:bonus|bonuses|promotion|promotions|promo|offer|welcome|deposit|reward|free spins?)\b/i,
  GAME_LIST:
    /\b(?:casino games?|game lobby|slots?|table games?|live casino|jackpots?)\b/i,
};

export function hasTaskContextTerms(
  taskContext: IngestionTaskContext,
  text: string,
): boolean {
  return CONTEXT_TERMS[taskContext].test(text);
}
