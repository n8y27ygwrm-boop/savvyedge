import type { CreateBonusInput } from "@savvyedge/types";

export type WageringScope = "DEPOSIT_BONUS" | "FREE_SPIN_WINNINGS" | "UNSCOPED";

export interface SourceMoneyAmount {
  amount: number;
  currency: "$" | "€" | "£";
  sourceText: string;
}

export interface SourceWageringTerm {
  multiplier: number;
  scope: WageringScope;
  sourceText: string;
}

export interface BonusSourceSemantics {
  headlineSourceText: string | null;
  freeSpinCount: number | null;
  freeSpinValue: SourceMoneyAmount | null;
  qualifyingPlaySpend: SourceMoneyAmount | null;
  depositRequirement: SourceMoneyAmount | null;
  monetaryBonusCap: SourceMoneyAmount | null;
  maxConversion: SourceMoneyAmount | null;
  wagering: SourceWageringTerm | null;
  isCombinedMonetaryAndFreeSpins: boolean;
}

const MONEY_PATTERN = "([£$€])\\s*(\\d+(?:[,.]\\d+)?)";
const FREE_SPINS_PATTERN = /\b(\d[\d,]*)\s+free\s+spins?\b/i;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceSupportsDate(rawText: string, value: Date | null): boolean {
  if (!value) return true;
  if (Number.isNaN(value.getTime())) return false;

  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const year = String(value.getUTCFullYear());
  const monthName = value.toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  const normalizedSource = rawText.toLowerCase();

  return [
    `${year}-${month}-${day}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day} ${monthName} ${year}`,
    `${monthName} ${Number(day)}, ${year}`,
  ].some((candidate) => normalizedSource.includes(candidate.toLowerCase()));
}

function sourceSegments(rawText: string): string[] {
  return rawText
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(compact)
    .filter(Boolean);
}

function parseMoneyMatch(match: RegExpMatchArray): SourceMoneyAmount {
  return {
    currency: match[1] as SourceMoneyAmount["currency"],
    amount: Number(match[2].replace(/,/g, "")),
    sourceText: compact(match[0]),
  };
}

function findMoney(
  segments: string[],
  pattern: RegExp,
): SourceMoneyAmount | null {
  for (const segment of segments) {
    const match = segment.match(pattern);
    if (match) return parseMoneyMatch(match);
  }
  return null;
}

function findBestFreeSpinsSegment(segments: string[]): string | null {
  const candidates = segments
    .map((segment, index) => {
      const match = segment.match(FREE_SPINS_PATTERN);
      if (!match) return null;

      let score = 0;
      if (/\b(?:get|claim|receive|enjoy|offer|welcome)\b/i.test(segment)) {
        score += 4;
      }
      if (segment.length <= 220) score += 2;
      if (/\b(?:terms|faq|how it works)\b/i.test(segment)) score -= 2;

      return { segment, index, score };
    })
    .filter(
      (
        candidate,
      ): candidate is { segment: string; index: number; score: number } =>
        candidate !== null,
    );

  candidates.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  return candidates[0]?.segment || null;
}

function findWagering(segments: string[]): SourceWageringTerm | null {
  for (const segment of segments) {
    if (!/\b(?:wager|wagering|playthrough)\b/i.test(segment)) continue;

    const multiplierMatch =
      segment.match(/\b(\d+(?:\.\d+)?)\s*x\b/i) ||
      segment.match(/\b(\d+(?:\.\d+)?)\s+times?\b/i) ||
      segment.match(/\bwager(?:ing)?[^\d]{0,30}(\d+(?:\.\d+)?)\b/i);
    if (!multiplierMatch) continue;

    let scope: WageringScope = "UNSCOPED";
    if (
      /(?:winnings?\s+from\s+(?:the\s+)?free\s+spins?|free\s+spin\s+winnings?)/i.test(
        segment,
      ) ||
      (/\bfree\s+spins?\b/i.test(segment) &&
        /\bwager\s+(?:the\s+)?winnings?\b/i.test(segment))
    ) {
      scope = "FREE_SPIN_WINNINGS";
    } else if (
      /(?:deposit\s+bonus|bonus\s+(?:funds?|amount|balance))/i.test(segment)
    ) {
      scope = "DEPOSIT_BONUS";
    }

    return {
      multiplier: Number(multiplierMatch[1]),
      scope,
      sourceText: segment,
    };
  }
  return null;
}

export function analyzeBonusSourceSemantics(
  rawText: string,
): BonusSourceSemantics {
  const segments = sourceSegments(rawText);
  const freeSpinsSegment = findBestFreeSpinsSegment(segments);
  const freeSpinsMatch = freeSpinsSegment?.match(FREE_SPINS_PATTERN) || null;
  const freeSpinValueMatch = freeSpinsSegment?.match(
    new RegExp(`${MONEY_PATTERN}\\s*(?:per|each)\\s*(?:free\\s*)?spin`, "i"),
  );
  const combinedHeadlineMatch = freeSpinsSegment?.match(
    /\b\d+(?:\.\d+)?%\s+(?:bonus\s+)?(?:up\s+to\s+)?[£$€]\s*\d+(?:[,.]\d+)?\s*(?:\+|plus|and)\s*\d[\d,]*\s+free\s+spins?\b/i,
  );

  let headlineSourceText: string | null = null;
  if (combinedHeadlineMatch) {
    headlineSourceText = compact(combinedHeadlineMatch[0]);
  } else if (freeSpinsMatch && freeSpinsSegment) {
    const start = freeSpinsMatch.index || 0;
    let end = start + freeSpinsMatch[0].length;
    if (
      freeSpinValueMatch?.index !== undefined &&
      freeSpinValueMatch.index >= end &&
      freeSpinValueMatch.index - end <= 12
    ) {
      end = freeSpinValueMatch.index + freeSpinValueMatch[0].length;
    }
    headlineSourceText = compact(freeSpinsSegment.slice(start, end));
  }

  const monetaryBonusCap = findMoney(
    segments,
    new RegExp(`\\bup\\s+to\\s+${MONEY_PATTERN}`, "i"),
  );

  return {
    headlineSourceText,
    freeSpinCount: freeSpinsMatch
      ? Number(freeSpinsMatch[1].replace(/,/g, ""))
      : null,
    freeSpinValue: freeSpinValueMatch
      ? parseMoneyMatch(freeSpinValueMatch)
      : null,
    qualifyingPlaySpend: findMoney(
      segments,
      new RegExp(
        `\\b(?:play|spend|stake)\\s+(?:at\\s+least\\s+)?${MONEY_PATTERN}`,
        "i",
      ),
    ),
    depositRequirement: findMoney(
      segments,
      new RegExp(
        `\\b(?:deposit|make\\s+a\\s+deposit(?:\\s+of)?)\\s+(?:at\\s+least\\s+)?${MONEY_PATTERN}`,
        "i",
      ),
    ),
    monetaryBonusCap,
    maxConversion: findMoney(
      segments,
      new RegExp(
        `\\b(?:max(?:imum)?\\s+(?:conversion|cashout|payout|withdrawal)|cashout\\s+limit)\\s*(?:is|of|:)?\\s*${MONEY_PATTERN}`,
        "i",
      ),
    ),
    wagering: findWagering(segments),
    isCombinedMonetaryAndFreeSpins: Boolean(
      freeSpinsMatch && monetaryBonusCap && /\d+(?:\.\d+)?%/.test(rawText),
    ),
  };
}

export function normalizeBonusExtraction(
  rawText: string,
  extracted: CreateBonusInput,
): { bonus: CreateBonusInput; semantics: BonusSourceSemantics } {
  const semantics = analyzeBonusSourceSemantics(rawText);
  if (!semantics.freeSpinCount || !semantics.headlineSourceText) {
    return { bonus: extracted, semantics };
  }

  const isCombined = semantics.isCombinedMonetaryAndFreeSpins;
  const wagering =
    semantics.wagering?.scope === "FREE_SPIN_WINNINGS" && isCombined
      ? null
      : (semantics.wagering?.multiplier ?? null);

  return {
    bonus: {
      ...extracted,
      type: isCombined ? "WELCOME_PACKAGE" : "FREE_SPINS",
      headline_value: semantics.headlineSourceText,
      wagering_requirement: wagering,
      max_conversion: semantics.maxConversion?.amount ?? null,
      valid_from: sourceSupportsDate(rawText, extracted.valid_from)
        ? extracted.valid_from
        : null,
      valid_until: sourceSupportsDate(rawText, extracted.valid_until)
        ? extracted.valid_until
        : null,
    },
    semantics,
  };
}
