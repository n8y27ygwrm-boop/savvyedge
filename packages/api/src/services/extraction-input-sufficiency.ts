import {
  hasTaskContextTerms,
  type IngestionTaskContext,
} from "../constants/ingestion-task-context";

/**
 * Extraction-input sufficiency policy.
 *
 * Answers exactly one question: does this rendered text carry enough
 * task-relevant information to be worth sending to an extraction agent?
 *
 * This is deliberately NOT part of source-page eligibility. Eligibility is a
 * destination-integrity boundary (did we land on the page we asked for?) that
 * runs before durable evidence is stored and is guaranteed to tolerate empty
 * and short content. Sufficiency is an input-quality boundary that runs after
 * the durable artifact is persisted, so a rejection still leaves the raw HTML
 * and provenance available for diagnosis.
 *
 * The evaluator takes plain text. Stripping script/style/markup is the
 * scraper's responsibility; whitespace is normalized here only defensively so
 * that padding can never be counted as signal. No URL, title or credential is
 * ever consulted.
 *
 * Extraction vocabulary is deliberately NOT the eligibility vocabulary.
 * `CONTEXT_TERMS` answers "is this page about bonuses at all", which every
 * casino navigation menu satisfies with a bare "Promotions" or "Bonuses" link.
 * Deciding whether text is worth extracting needs offer *detail*, so BONUS is
 * evaluated against its own signal set below.
 */

export type ExtractionInputRejectionCategory = "INSUFFICIENT_CONTENT";

export type ExtractionInputSufficiencyResult =
  | { sufficient: true }
  | {
      sufficient: false;
      category: ExtractionInputRejectionCategory;
      reason: string;
    };

export interface ExtractionInputSufficiencyInput {
  content?: string | null;
  taskContext: IngestionTaskContext;
}

/**
 * Conservative floor on normalized readable text.
 *
 * Low on purpose: a terse but real offer such as "100% deposit match up to
 * $500" (29 characters) must pass. Separating chrome-only pages from real ones
 * is the job of the extraction-signal check, not of a large length threshold.
 */
export const MIN_EXTRACTION_INPUT_LENGTH = 24;

/**
 * Maximum number of characters allowed between a bare numeric value and the
 * bonus-detail vocabulary that gives it meaning. Deliberately small: it must
 * span a natural clause ("100% deposit match", "wagering requirement of 35x")
 * without letting two unrelated fragments of a navigation menu pair up.
 */
export const SIGNAL_PROXIMITY_WINDOW = 40;

/**
 * Bonus-detail vocabulary. Every entry names a mechanic or a term of an offer.
 *
 * Generic section labels ("promotion(s)", "bonus(es)", "offer", "welcome",
 * "jackpot", and the bare word "deposit") are deliberately absent: they are
 * navigation, not offer detail, and pairing them with a nearby number is what
 * let chrome such as "Balance £0.00 — Promotions" look extractable.
 */
const BONUS_DETAIL_SOURCE =
  "(?:deposit\\s+match|match(?:ed|es)?\\s+(?:your\\s+)?deposit|" +
  // "bonus" only ever counts when a qualifier makes it an offer rather than a
  // section label: "welcome bonus", "match bonus", "bonus up to".
  "welcome\\s+bonus|match(?:ed)?\\s+bonus|bonus\\s+up\\s+to|" +
  "cash\\s?back|bonus\\s+funds|(?:free|bonus)\\s+spins?|" +
  "min(?:imum)?\\.?\\s+deposit|" +
  "max(?:imum)?\\s+(?:conversion|cash\\s?out|cashout|withdrawal|win(?:nings)?)|" +
  "wager(?:ing)?|playthrough|turnover|free\\s+bets?|no[-\\s]deposit)";

/** A percentage or a monetary amount — meaningless on its own. */
const NUMERIC_VALUE_SOURCE = "(?:\\b\\d{1,4}\\s*%|[£$€]\\s*\\d[\\d,.]*)";

/** An `Nx` multiplier — meaningless on its own. */
const MULTIPLIER_SOURCE = "\\b\\d{1,4}\\s*x\\b";

/** Wagering semantics that make a multiplier interpretable. */
const WAGERING_SOURCE = "(?:wager(?:ing)?|playthrough|turnover)";

/**
 * Builds a pattern matching `left` and `right` within `window` characters of
 * each other, in either order, so natural phrasings on both sides read alike
 * ("35x wagering requirement" and "wagering requirement of 35x").
 */
function withinProximity(left: string, right: string, window: number): RegExp {
  return new RegExp(
    `(?:${left})[\\s\\S]{0,${window}}?(?:${right})` +
      `|(?:${right})[\\s\\S]{0,${window}}?(?:${left})`,
    "i",
  );
}

/**
 * BONUS extraction-signal policy.
 *
 * Each entry is evidence that the text describes the *terms* of an offer
 * rather than merely linking to one. Three families:
 *
 *  - contextual quantitative signals: a percentage, monetary amount or
 *    multiplier that sits next to vocabulary giving it bonus meaning. A bare
 *    number is never sufficient by itself;
 *  - composite offer phrases: a number fused into offer semantics
 *    ("300 free spins");
 *  - strong offer phrases: unambiguous offer detail that needs no number.
 *
 * The set is operator-neutral — no rule encodes any brand's markup or wording.
 */
export const BONUS_EXTRACTION_SIGNALS: ReadonlyArray<{
  readonly name: string;
  readonly pattern: RegExp;
}> = [
  // --- Contextual quantitative signals ---
  {
    name: "VALUE_WITH_BONUS_DETAIL",
    pattern: withinProximity(
      NUMERIC_VALUE_SOURCE,
      BONUS_DETAIL_SOURCE,
      SIGNAL_PROXIMITY_WINDOW,
    ),
  },
  {
    name: "WAGERING_MULTIPLIER",
    pattern: withinProximity(
      MULTIPLIER_SOURCE,
      WAGERING_SOURCE,
      SIGNAL_PROXIMITY_WINDOW,
    ),
  },
  // --- Composite offer phrases ---
  { name: "FREE_SPIN_COUNT", pattern: /\b\d[\d,]*\s*(?:free|bonus)\s+spins?\b/i },
  {
    // A percentage directly qualified by offer semantics ("100% up to £200",
    // "200% match"). An RTP or jackpot figure is never phrased this way, so
    // this stays closed to chrome such as "Slots RTP 96% Bonuses".
    name: "PERCENTAGE_OFFER_QUALIFIER",
    pattern: /\b\d{1,4}\s*%\s*(?:match(?:ed)?\b|up\s+to\b)/i,
  },
  // --- Strong offer phrases ---
  { name: "NO_DEPOSIT", pattern: /\bno[-\s]deposit\b/i },
  {
    name: "DEPOSIT_MATCH",
    pattern:
      /\b(?:deposit\s+match|match(?:ed|es)?\s+(?:your\s+)?deposit|matched\s+bonus)\b/i,
  },
  { name: "CASHBACK", pattern: /\bcash\s?back\b/i },
  {
    name: "WAGERING_TERMS",
    pattern: /\b(?:wagering|playthrough|turnover)\s+requirements?\b/i,
  },
  { name: "DEPOSIT_THRESHOLD", pattern: /\bmin(?:imum)?\.?\s+deposit\b/i },
  {
    name: "MAX_CONVERSION",
    pattern:
      /\bmax(?:imum)?\s+(?:conversion|cash\s?out|cashout|withdrawal|win(?:nings)?)\b/i,
  },
  { name: "FREE_BET", pattern: /\bfree\s+bets?\b/i },
];

export function hasBonusExtractionSignal(text: string): boolean {
  return BONUS_EXTRACTION_SIGNALS.some(({ pattern }) => pattern.test(text));
}

const STATIC_REJECTION_REASONS: Record<
  ExtractionInputRejectionCategory,
  string
> = {
  INSUFFICIENT_CONTENT:
    "The rendered page text is too sparse or carries no offer-detail evidence for extraction.",
};

export class ExtractionInputRejectedError extends Error {
  public readonly category: ExtractionInputRejectionCategory;
  public readonly reason: string;

  constructor(
    rejection: Extract<ExtractionInputSufficiencyResult, { sufficient: false }>,
  ) {
    super(
      `EXTRACTION_INPUT_REJECTED ${JSON.stringify({
        category: rejection.category,
        reason: rejection.reason,
      })}`,
    );
    this.name = "ExtractionInputRejectedError";
    this.category = rejection.category;
    this.reason = rejection.reason;
  }
}

/**
 * Collapses tabs and repeated intra-line whitespace, drops empty lines, and
 * keeps single newlines so distinct text blocks stay separated.
 */
export function normalizeExtractionInput(content?: string | null): string {
  if (typeof content !== "string") {
    return "";
  }
  return content
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function reject(
  category: ExtractionInputRejectionCategory,
): ExtractionInputSufficiencyResult {
  return {
    sufficient: false,
    category,
    reason: STATIC_REJECTION_REASONS[category],
  };
}

export function evaluateExtractionInputSufficiency(
  input: ExtractionInputSufficiencyInput,
): ExtractionInputSufficiencyResult {
  const normalized = normalizeExtractionInput(input.content);

  if (normalized.length < MIN_EXTRACTION_INPUT_LENGTH) {
    return reject("INSUFFICIENT_CONTENT");
  }

  if (input.taskContext === "BONUS") {
    return hasBonusExtractionSignal(normalized)
      ? { sufficient: true }
      : reject("INSUFFICIENT_CONTENT");
  }

  // GAME_LIST has no proven extraction signal yet: its vocabulary
  // ("slots", "live casino", "jackpots") is exactly what a casino navigation
  // menu contains, while a real lobby often renders only game titles. This
  // branch is intentionally NOT enforced at runtime by performCrawl; it exists
  // so the policy stays extensible once an element-aware signal is available.
  return hasTaskContextTerms(input.taskContext, normalized)
    ? { sufficient: true }
    : reject("INSUFFICIENT_CONTENT");
}
