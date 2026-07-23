import { Prisma } from "@savvyedge/database";
import { BonusService } from "./bonus.service";

/**
 * ARCHITECTURAL MIGRATION NOTICE & TODO (Phase 2 Requirement):
 *
 * Current Phase 1 containment uses server-side normalization and memory/query blocklists
 * because the Prisma schema currently lacks explicit database fields for:
 * - publication_status / is_public (Enum/Boolean)
 * - review_status (Draft, In_Review, Approved, Rejected)
 * - quarantine_reason (String)
 * - canonical_entity_id / duplicate_of_id (UUID relation for duplicate grouping)
 * - entity_source_evidence_id (Direct mandatory foreign key relation)
 * - slot_verified_at (Direct timestamp on Slot model)
 *
 * Phase 2 will execute a DB schema migration to persist these fields natively.
 */

// Temporary Phase 1 Containment Blocklists
const QUARANTINED_SLUGS = [
  "fresh-dev-casino",
  "valid-casino-brand-pass",
  "dev-test-casino",
  "canonical-benchmark-casino",
  "askgamblers",
  "casinos-com",
  "gambling-com",
  "casino-org",
];

const QUARANTINED_EXACT_NAMES = [
  "askgamblers",
  "casinos.com",
  "gambling.com",
  "casino.org",
  "fresh dev casino",
  "valid casino brand pass",
  "dev test casino",
  "canonical benchmark casino",
];

const QUARANTINED_EXACT_DOMAINS = [
  "askgamblers.com",
  "casinos.com",
  "gambling.com",
  "casino.org",
];

const EXCLUDED_DATA_SOURCES = ["DEV_MOCK", "MOCK", "dev_mock", "mock"];

export const SUPPORTED_CALCULATOR_BONUS_TYPES = [
  "WELCOME",
  "WELCOME_MATCH",
  "WELCOME_PACKAGE",
  "RELOAD",
  "RELOAD_MATCH",
  "FREE_SPINS",
  "SPINS",
  "NO_DEPOSIT",
  "NO_DEPOSIT_BONUS",
];

export interface MonetaryCapParseResult {
  status: "VALID" | "MISSING_CAP" | "AMBIGUOUS_CAPS" | "INVALID_CAP";
  value?: number;
  reason?: string;
}

export interface CalculatorValidationResult {
  status: "VALID" | "MISSING_FIELDS" | "MISSING_CAP" | "AMBIGUOUS_CAPS" | "INVALID_CAP" | "UNSUPPORTED_TYPE" | "INELIGIBLE_BONUS";
  reason?: string;
  nominalValue?: number;
}

export class PublicationGateService {
  /**
   * Centralized Hostname Normalization.
   * Strips protocol, port, query params, leading 'www.', lowercases and trims.
   */
  public static normalizeDomainHost(url?: string | null): string {
    if (!url || typeof url !== "string") return "";
    try {
      let cleaned = url.trim().toLowerCase();
      if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        cleaned = "https://" + cleaned;
      }
      const parsed = new URL(cleaned);
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return url.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
    }
  }

  /**
   * Strict URL Validation.
   * Rejects null, empty, whitespace, malformed, ftp:, javascript:, data:, file: scheme URLs.
   */
  public static isValidSourceUrl(url?: string | null): boolean {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (trimmed === "") return false;

    if (/^(javascript|ftp|data|file):/i.test(trimmed)) {
      return false;
    }

    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Centralized Exact Identity Quarantine Matcher.
   * Avoids loose includes() matching to prevent false positive quarantining of legitimate brands.
   */
  public static isQuarantinedIdentity(name?: string | null, slug?: string | null, websiteUrl?: string | null): boolean {
    const nameNorm = String(name || "").trim().toLowerCase();
    const slugNorm = String(slug || "").trim().toLowerCase();
    const hostNorm = this.normalizeDomainHost(websiteUrl);

    if (nameNorm !== "" && QUARANTINED_EXACT_NAMES.includes(nameNorm)) {
      return true;
    }

    if (slugNorm !== "" && QUARANTINED_SLUGS.includes(slugNorm)) {
      return true;
    }

    if (hostNorm !== "") {
      for (const domPattern of QUARANTINED_EXACT_DOMAINS) {
        if (hostNorm === domPattern || hostNorm.endsWith("." + domPattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Deterministic Casino Verification Evidence Selector.
   * Ingestion logs or generic audit logs DO NOT qualify as verification evidence.
   * Qualifies ONLY when:
   * 1. source_url passes isValidSourceUrl();
   * 2. event_type === "VERIFICATION" or description explicitly describes license verification;
   * 3. timestamp occurred_at is valid, not in future, and within [verified_at - 7d, verified_at + 1d].
   */
  public static getQualifyingCasinoEvidence(casino: any): any | null {
    if (!casino || typeof casino !== "object" || !Array.isArray(casino.history_events) || casino.history_events.length === 0) {
      return null;
    }

    const now = new Date();

    const qualifyingEvents = casino.history_events.filter((he: any) => {
      if (!he || typeof he !== "object") return false;
      if (!this.isValidSourceUrl(he.source_url)) return false;

      const eventType = String(he.event_type || "").trim().toUpperCase();
      const desc = String(he.description || "").trim().toLowerCase();

      // STRICT: Ingestion or generic audits DO NOT qualify. Must be explicit VERIFICATION.
      const isExplicitVerification = eventType === "VERIFICATION" || desc.includes("license verification") || desc.includes("verified license");
      if (!isExplicitVerification) {
        return false;
      }

      const eventDate = he.occurred_at ? new Date(he.occurred_at) : null;
      if (!eventDate || isNaN(eventDate.getTime()) || eventDate > now) {
        return false;
      }

      if (casino.verified_at) {
        const verifiedDate = new Date(casino.verified_at);
        if (!isNaN(verifiedDate.getTime())) {
          const minAllowed = new Date(verifiedDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          const maxAllowed = new Date(verifiedDate.getTime() + 24 * 60 * 60 * 1000);
          if (eventDate < minAllowed || eventDate > maxAllowed) {
            return false;
          }
        }
      }

      return true;
    });

    if (qualifyingEvents.length === 0) return null;

    qualifyingEvents.sort((a: any, b: any) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    return qualifyingEvents[0];
  }

  /**
   * Deterministic Bonus Verification Evidence Selector.
   * Qualifies ONLY when:
   * 1. source_url passes isValidSourceUrl();
   * 2. field_changed === "verified_at";
   *    UNCORRELATED fields (e.g. description, title, status) with new_value === "ACTIVE"/"VERIFIED" ARE STRICTLY REJECTED.
   * 3. timestamp changed_at is valid, not in future, and within [verified_at - 7d, verified_at + 1d].
   */
  public static getQualifyingBonusEvidence(bonus: any): any | null {
    if (!bonus || typeof bonus !== "object" || !Array.isArray(bonus.history_events) || bonus.history_events.length === 0) {
      return null;
    }

    const now = new Date();

    const qualifyingEvents = bonus.history_events.filter((he: any) => {
      if (!he || typeof he !== "object") return false;
      if (!this.isValidSourceUrl(he.source_url)) return false;

      const fieldChanged = String(he.field_changed || "").trim();

      // STRICT: Must be exact verified_at field.
      // status=ACTIVE, status=VERIFIED, or description=VERIFIED are strictly rejected.
      if (fieldChanged !== "verified_at") {
        return false;
      }

      const eventDate = he.changed_at ? new Date(he.changed_at) : null;
      if (!eventDate || isNaN(eventDate.getTime()) || eventDate > now) {
        return false;
      }

      if (bonus.verified_at) {
        const verifiedDate = new Date(bonus.verified_at);
        if (!isNaN(verifiedDate.getTime())) {
          const minAllowed = new Date(verifiedDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          const maxAllowed = new Date(verifiedDate.getTime() + 24 * 60 * 60 * 1000);
          if (eventDate < minAllowed || eventDate > maxAllowed) {
            return false;
          }
        }
      }

      return true;
    });

    if (qualifyingEvents.length === 0) return null;

    qualifyingEvents.sort((a: any, b: any) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
    return qualifyingEvents[0];
  }

  /**
   * Conservative Prisma 'where' clause prefilter for Casino queries.
   */
  public static whereCasinoPublic(): Prisma.CasinoWhereInput {
    return {
      status: "ACTIVE",
      data_source_type: { notIn: EXCLUDED_DATA_SOURCES },
      verified_at: { not: null },
      slug: { notIn: QUARANTINED_SLUGS },
      history_events: {
        some: {
          source_url: { not: null },
        },
      },
    };
  }

  /**
   * Conservative Prisma 'where' clause prefilter for Bonus queries.
   */
  public static whereBonusPublic(): Prisma.BonusWhereInput {
    const now = new Date();
    return {
      status: "ACTIVE",
      data_source_type: { notIn: EXCLUDED_DATA_SOURCES },
      verified_at: { not: null },
      OR: [{ valid_until: null }, { valid_until: { gte: now } }],
      history_events: {
        some: {
          source_url: { not: null },
        },
      },
      casino: this.whereCasinoPublic(),
    };
  }

  /**
   * Conservative Prisma 'where' clause prefilter for Slot queries.
   */
  public static whereSlotPublic(): Prisma.SlotWhereInput {
    return {
      casino_slots: {
        some: {
          verified_at: { not: null },
          source_url: { not: null },
          casino: this.whereCasinoPublic(),
        },
      },
    };
  }

  /**
   * Runtime in-memory predicate for Casino eligibility.
   * FAILS CLOSED if licenses array is empty or getQualifyingCasinoEvidence() returns null.
   */
  public static isCasinoPubliclyEligible(casino: any): boolean {
    if (!casino || typeof casino !== "object") return false;
    if (casino.status !== "ACTIVE") return false;
    if (
      casino.data_source_type &&
      EXCLUDED_DATA_SOURCES.includes(String(casino.data_source_type).toUpperCase())
    ) {
      return false;
    }
    if (!casino.verified_at) return false;
    if (this.isQuarantinedIdentity(casino.name, casino.slug, casino.website_url)) {
      return false;
    }

    if (!Array.isArray(casino.licenses) || casino.licenses.length === 0) {
      return false;
    }

    const hasActiveVerifiedLicense = casino.licenses.some(
      (l: any) => l && l.status === "ACTIVE" && l.verified_at !== null
    );
    if (!hasActiveVerifiedLicense) return false;

    const evidence = this.getQualifyingCasinoEvidence(casino);
    if (!evidence) {
      return false;
    }

    return true;
  }

  /**
   * Runtime in-memory predicate for Bonus eligibility.
   * FAILS CLOSED if targetCasino is ineligible or getQualifyingBonusEvidence() returns null.
   */
  public static isBonusPubliclyEligible(bonus: any, casino?: any): boolean {
    if (!bonus || typeof bonus !== "object") return false;
    if (bonus.status !== "ACTIVE") return false;
    if (
      bonus.data_source_type &&
      EXCLUDED_DATA_SOURCES.includes(String(bonus.data_source_type).toUpperCase())
    ) {
      return false;
    }
    if (!bonus.verified_at) return false;
    if (bonus.valid_until) {
      const expiry = new Date(bonus.valid_until);
      if (isNaN(expiry.getTime()) || expiry < new Date()) {
        return false;
      }
    }

    if (!bonus.headline_value || String(bonus.headline_value).trim() === "") {
      return false;
    }

    const targetCasino = casino || bonus.casino;
    if (!targetCasino || typeof targetCasino !== "object") {
      return false;
    }

    if (!this.isCasinoPubliclyEligible(targetCasino)) {
      return false;
    }

    const evidence = this.getQualifyingBonusEvidence(bonus);
    if (!evidence) {
      return false;
    }

    return true;
  }

  /**
   * Runtime in-memory predicate for Slot eligibility.
   */
  public static isSlotPubliclyEligible(slot: any): boolean {
    if (!slot || typeof slot !== "object") return false;
    if (!Array.isArray(slot.casino_slots) || slot.casino_slots.length === 0) return false;

    return slot.casino_slots.some((cs: any) => {
      if (!cs || typeof cs !== "object") return false;
      if (!cs.verified_at) return false;
      if (!this.isValidSourceUrl(cs.source_url)) return false;
      if (!cs.casino || typeof cs.casino !== "object") return false;
      return this.isCasinoPubliclyEligible(cs.casino);
    });
  }

  /**
   * Verification Badge Presentation Policy (PHASE 1 STRICT CONTAINMENT).
   * Returns false in Phase 1 because the current schema cannot directly link source evidence to a specific License record.
   * UI will safely render "Verification Pending" until Phase 2 database schema expansion adds license_source_evidence_id.
   */
  public static isVerificationBadgeEligible(entity: any): boolean {
    // Phase 1: Fail closed because License model currently lacks a direct foreign key to source evidence
    return false;
  }

  /**
   * Structured Monetary Cap Parser.
   * Preserves structured outcomes: VALID, MISSING_CAP, AMBIGUOUS_CAPS, INVALID_CAP.
   * Strictly rejects malformed, zero, non-finite, and negative currency formats like -€500, €-500, -500 EUR, €abc, $--500, $1..500.
   */
  public static parseStructuredMonetaryCap(headline: string): MonetaryCapParseResult {
    if (!headline || typeof headline !== "string") {
      return { status: "MISSING_CAP", reason: "Headline value is empty or missing" };
    }
    const trimmed = headline.trim();
    if (!trimmed) {
      return { status: "MISSING_CAP", reason: "Headline value is empty or missing" };
    }

    // 1. Detect explicit currency indicators ($ € £ EUR USD GBP AUD CAD)
    const hasCurrencyIndicator = /[$€£]|\b(EUR|USD|GBP|AUD|CAD)\b/i.test(trimmed);

    // 2. Detect malformed / invalid / negative currency patterns
    if (hasCurrencyIndicator) {
      if (
        /-\s*[$€£]|[$€£]\s*-|--\d|-\s*\d+\s*(?:EUR|USD|GBP|AUD|CAD)\b/i.test(trimmed) ||
        /[$€£]\s*(nan|infinity|abc|\D+)/i.test(trimmed) ||
        /\b(EUR|USD|GBP|AUD|CAD)\s*(nan|infinity|abc)/i.test(trimmed) ||
        /[$€£]\s*\d+\.\.\d+|[$€£]\s*\d+,\.\d+|[$€£]\s*\d+,,+\d+/i.test(trimmed)
      ) {
        return { status: "INVALID_CAP", reason: "Headline contains malformed or negative monetary syntax" };
      }
    }

    // 3. Extract monetary candidates matching currency symbols ($ € £) or codes (EUR USD GBP AUD CAD)
    const matches = Array.from(
      trimmed.matchAll(/(?:(?:up\s+to\s+)?([$€£])\s*([0-9.,]+|[a-zA-Z]+)|(?:up\s+to\s+)?([0-9.,]+|[a-zA-Z]+)\s*([$€£]|EUR|USD|GBP|AUD|CAD))\b/gi)
    );

    if (matches.length === 0) {
      if (hasCurrencyIndicator) {
        return { status: "INVALID_CAP", reason: "Explicit currency indicator exists but numerical value is missing or malformed" };
      }
      return { status: "MISSING_CAP", reason: "Headline value contains no calculable monetary bonus cap" };
    }

    const candidates: { val: number; isValid: boolean }[] = [];

    for (const m of matches) {
      const rawValStr = (m[2] || m[3] || "").replace(/[$€£]/g, "").trim();
      if (!rawValStr) {
        return { status: "INVALID_CAP", reason: "Explicit currency symbol exists with no numeric value" };
      }

      const matchIndex = m.index ?? 0;
      const matchText = m[0];
      const afterText = trimmed.slice(matchIndex + matchText.length, matchIndex + matchText.length + 15).toLowerCase();

      // Ignore percentages (100%), wagering multipliers (35x), or free spins (50 spins)
      if (afterText.startsWith("%") || /^\s*(%|x\b|spins?|free\s*spins?)/.test(afterText)) {
        continue;
      }

      // Check for malformed numbers (double dots, double commas, non-digit chars, zero)
      if (/[^\d.,]/.test(rawValStr) || /\.\./.test(rawValStr) || /,,/.test(rawValStr) || /^0+$/.test(rawValStr.replace(/[,.]/g, ""))) {
        return { status: "INVALID_CAP", reason: "Explicit monetary value is malformed or non-positive" };
      }

      const cleanStr = rawValStr.replace(/,/g, "");
      const val = parseFloat(cleanStr);

      if (isNaN(val) || !isFinite(val) || val <= 0) {
        return { status: "INVALID_CAP", reason: "Explicit monetary cap must be a positive finite number" };
      }

      candidates.push({ val, isValid: true });
    }

    if (candidates.length === 0) {
      if (hasCurrencyIndicator) {
        return { status: "INVALID_CAP", reason: "Headline has currency indicator but no valid monetary cap" };
      }
      return { status: "MISSING_CAP", reason: "Headline value contains no calculable monetary bonus cap" };
    }

    if (candidates.length > 1) {
      return { status: "AMBIGUOUS_CAPS", reason: "Headline contains multiple conflicting monetary caps" };
    }

    return { status: "VALID", value: candidates[0].val };
  }

  /** Isolated monetary cap extraction helper for calculator validation */
  public static parseCalculableMonetaryCap(headline: string): number {
    const res = this.parseStructuredMonetaryCap(headline);
    return res.status === "VALID" ? (res.value ?? 0) : 0;
  }

  /**
   * Type-Aware Calculator Eligibility Validation.
   * Structured validation status outputs:
   * - VALID: Headline cap is unambiguous and wagering requirement is compliant
   * - MISSING_FIELDS: Missing bonus, or missing wagering requirement for deposit match bonuses
   * - MISSING_CAP: Headline contains no calculable monetary bonus cap
   * - AMBIGUOUS_CAPS: Headline contains multiple conflicting caps or extra unvalued spins/chips
   * - INVALID_CAP: Headline cap value is invalid or non-positive
   * - UNSUPPORTED_TYPE: Bonus type is not supported for EV calculation
   * - INELIGIBLE_BONUS: Bonus fails public data publication gate
   */
  public static validateCalculatorEligibility(bonus: any, casino?: any): CalculatorValidationResult {
    if (!bonus || typeof bonus !== "object") {
      return { status: "MISSING_FIELDS", reason: "Bonus record is missing or null" };
    }

    const rawType = String(bonus.type || "").toUpperCase().trim();
    const isWelcome = ["WELCOME", "WELCOME_MATCH", "WELCOME_PACKAGE"].includes(rawType);
    const isReload = ["RELOAD", "RELOAD_MATCH"].includes(rawType);
    const isFreeSpins = ["FREE_SPINS", "SPINS"].includes(rawType);
    const isNoDeposit = ["NO_DEPOSIT", "NO_DEPOSIT_BONUS"].includes(rawType);

    if (!isWelcome && !isReload && !isFreeSpins && !isNoDeposit) {
      return { status: "UNSUPPORTED_TYPE", reason: `Bonus type '${rawType}' is not supported for EV calculation` };
    }

    if (!this.isBonusPubliclyEligible(bonus, casino)) {
      return { status: "INELIGIBLE_BONUS", reason: "Bonus fails public data publication gate" };
    }

    const headline = String(bonus.headline_value || "").trim();

    const capResult = this.parseStructuredMonetaryCap(headline);
    if (capResult.status !== "VALID") {
      return { status: capResult.status, reason: capResult.reason };
    }

    const wageringReq = bonus.wagering_requirement;

    // PER-TYPE RULE: WELCOME and RELOAD require explicit non-negative wagering requirement
    if (isWelcome || isReload) {
      if (
        wageringReq === undefined ||
        wageringReq === null ||
        typeof wageringReq !== "number" ||
        isNaN(wageringReq) ||
        !Number.isFinite(wageringReq) ||
        wageringReq < 0
      ) {
        return { status: "MISSING_FIELDS", reason: "Wagering requirement must be a non-negative finite number for deposit match bonuses" };
      }

      if (/(\+|\band\b)\s*\d+\s*(free\s*spins?|spins?|chips?)/i.test(headline)) {
        return { status: "AMBIGUOUS_CAPS", reason: "Headline contains extra unvalued free spin or chip components" };
      }

      return { status: "VALID", nominalValue: capResult.value };
    }

    // PER-TYPE RULE: FREE_SPINS and NO_DEPOSIT allow optional/absent wagering requirement if monetary cap is valid
    if (isFreeSpins || isNoDeposit) {
      return { status: "VALID", nominalValue: capResult.value };
    }

    return { status: "UNSUPPORTED_TYPE", reason: `Unhandled bonus type '${rawType}'` };
  }

  /**
   * Boolean wrapper around validateCalculatorEligibility.
   */
  public static isCalculatorEligible(bonus: any, casino?: any): boolean {
    return this.validateCalculatorEligibility(bonus, casino).status === "VALID";
  }
}
