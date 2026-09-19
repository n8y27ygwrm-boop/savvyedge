import { BONUS_EXTRACTION_CONTEXT } from "../constants/extraction-context";
import { isCanonicalBonusExtractionIdentity } from "@savvyedge/ai-agents/extraction-contract";

export interface BonusFreshnessPolicy {
  maxAgeMs: number;
}

/**
 * The single freshness constant for the bonus boundary. Every threshold in this
 * module — the pure `verified_at` predicate, the active-observation evaluator,
 * and the query floor used by the publication gate prefilter — derives from it.
 * Never introduce a second 72-hour literal.
 */
export const DEFAULT_BONUS_FRESHNESS_POLICY: BonusFreshnessPolicy = {
  maxAgeMs: 72 * 60 * 60 * 1000, // 72 hours
};

function resolveMaxAgeMs(policy?: Partial<BonusFreshnessPolicy>): number {
  return policy?.maxAgeMs ?? DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs;
}

/**
 * The oldest observation instant still considered fresh at `now`.
 *
 * Exposed so a database prefilter and the in-memory evaluator cannot drift:
 * both derive their boundary from this one function.
 */
export function bonusFreshnessFloor(
  now: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): Date {
  return new Date(now.getTime() - resolveMaxAgeMs(policy));
}

/**
 * Pure predicate to evaluate whether a Bonus machine/source verification timestamp is fresh.
 *
 * Rules:
 * - null, undefined, or missing => false
 * - invalid date timestamp => false
 * - verified_at strictly in the future (> now) => false
 * - age <= maxAgeMs (e.g. <= 72h) => true
 * - age > maxAgeMs (e.g. > 72h) => false
 */
export function isBonusFresh(
  verifiedAt: Date | string | null | undefined,
  now: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): boolean {
  if (!verifiedAt) {
    return false;
  }

  const verifiedDate =
    typeof verifiedAt === "string" ? new Date(verifiedAt) : verifiedAt;
  const verifiedTime = verifiedDate.getTime();

  if (isNaN(verifiedTime)) {
    return false;
  }

  const nowTime = now.getTime();
  if (isNaN(nowTime)) {
    return false;
  }

  // Reject future timestamps
  if (verifiedTime > nowTime) {
    return false;
  }

  const ageMs = nowTime - verifiedTime;

  return ageMs <= resolveMaxAgeMs(policy);
}

/* -------------------------------------------------------------------------
 * D3C: Active-observation freshness authority
 *
 * `Bonus.verified_at` is a denormalized query projection, never the authority.
 * The authority is the observation instant recorded on the EvidenceRecord that
 * the bonus's single active extraction pointer resolves to.
 *
 * Freshness is never inferred from `updated_at`, `extracted_at`, history-event
 * timestamps, pointer activation time, job completion or snapshot reprocessing:
 * those all move when the pipeline runs, not when the operator page was read.
 * ---------------------------------------------------------------------- */

const SUPPORTS_VERDICT = "SUPPORTS";

export type ActiveObservationRejectionCode =
  /** No pointer, or the bonus predates the extraction contract. */
  | "MISSING_ACTIVE_POINTER"
  /** More than one BONUS pointer: the active extraction is not unique. */
  | "AMBIGUOUS_ACTIVE_POINTER"
  /** The pointer does not resolve to a loaded evidence record. */
  | "MISSING_ACTIVE_EVIDENCE"
  /** The loaded record is not the one the pointer names. */
  | "ACTIVE_EVIDENCE_MISMATCH"
  /** The active pointer/evidence key is not a supported extraction identity. */
  | "INVALID_EXTRACTION_IDENTITY"
  /** The active evidence carries no SUPPORTS claim for this bonus. */
  | "MISSING_SUPPORTING_CLAIM"
  /** The evidence source is not an HTTP(S) URL. */
  | "INVALID_EVIDENCE_SOURCE"
  /** observed_at is absent or unparseable. */
  | "INVALID_OBSERVATION"
  /** observed_at (or extracted_at) is ahead of the evaluation clock. */
  | "FUTURE_OBSERVATION"
  /** valid_from has not been reached yet. */
  | "PREMATURE_EVIDENCE"
  /** expires_at is now or earlier. */
  | "EXPIRED_EVIDENCE"
  /** The observation is older than the policy window. */
  | "STALE_OBSERVATION"
  /** Bonus.verified_at does not project the active observed_at exactly. */
  | "PROJECTION_MISMATCH";

export interface ActiveEvidenceClaimInput {
  bonus_id?: string | null;
  verdict?: string | null;
}

export interface ActiveEvidenceRecordInput {
  id?: string | null;
  data_source_id?: string | null;
  source_url?: string | null;
  observed_at?: Date | string | null;
  extracted_at?: Date | string | null;
  valid_from?: Date | string | null;
  expires_at?: Date | string | null;
  extraction_key?: string | null;
  bonus_claims?: ActiveEvidenceClaimInput[] | null;
}

export interface ActiveExtractionPointerInput {
  extraction_context?: string | null;
  contract_version: string | null;
  bonus_id?: string | null;
  data_source_id?: string | null;
  evidence_id?: string | null;
  extraction_key?: string | null;
  evidence?: ActiveEvidenceRecordInput | null;
}

/** The minimum shape a caller must load for the evaluator to decide. */
export interface ActiveObservationFreshnessInput {
  id?: string | null;
  verified_at?: Date | string | null;
  active_extractions?: ActiveExtractionPointerInput[] | null;
}

export type ActiveObservationFreshnessDecision =
  | { status: "FRESH"; evidenceId: string; observedAt: Date }
  | { status: "REJECTED"; code: ActiveObservationRejectionCode };

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function asExactIdentity(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value.trim() === value
    ? value
    : null;
}

/**
 * Same HTTP(S) rule the publication gate and the workflow evidence policy
 * apply: anything that is not an http:/https: URL is not a citable source.
 */
function isHttpSourceUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string" || url.trim() === "") return false;
  try {
    const protocol = new URL(url.trim()).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pure evaluator for the active-observation freshness authority.
 *
 * Fails closed on every missing relation: a caller that forgets to load the
 * pointer, its evidence, or that evidence's claims gets a rejection, never a
 * pass. `now` is supplied by the caller so a request evaluates one clock.
 */
export function evaluateActiveObservationFreshness(
  bonus: ActiveObservationFreshnessInput | null | undefined,
  now: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): ActiveObservationFreshnessDecision {
  const reject = (
    code: ActiveObservationRejectionCode,
  ): ActiveObservationFreshnessDecision => ({ status: "REJECTED", code });

  if (!bonus || typeof bonus !== "object") {
    return reject("MISSING_ACTIVE_POINTER");
  }
  const nowTime = now instanceof Date ? now.getTime() : NaN;
  if (isNaN(nowTime)) {
    return reject("INVALID_OBSERVATION");
  }

  const loadedPointers = Array.isArray(bonus.active_extractions)
    ? bonus.active_extractions.filter(
        (pointer) => pointer && typeof pointer === "object",
      )
    : [];
  const pointers = loadedPointers.filter(
    (pointer) => pointer.extraction_context === BONUS_EXTRACTION_CONTEXT,
  );

  if (pointers.length === 0) {
    return reject(
      loadedPointers.length === 0
        ? "MISSING_ACTIVE_POINTER"
        : "INVALID_EXTRACTION_IDENTITY",
    );
  }
  if (pointers.length > 1) return reject("AMBIGUOUS_ACTIVE_POINTER");

  const pointer = pointers[0];
  const evidence = pointer.evidence;
  if (!evidence || typeof evidence !== "object") {
    return reject("MISSING_ACTIVE_EVIDENCE");
  }

  // The loaded record must be the record the pointer names, and both sides must
  // carry the same complete, non-empty extraction identity. Missing identifiers
  // fail closed: an omitted relation field is not evidence that the join
  // matched.
  const bonusId = asExactIdentity(bonus.id);
  const pointerBonusId = asExactIdentity(pointer.bonus_id);
  const pointerDataSourceId = asExactIdentity(pointer.data_source_id);
  const evidenceDataSourceId = asExactIdentity(evidence.data_source_id);
  const pointerEvidenceId = asExactIdentity(pointer.evidence_id);
  const evidenceId = asExactIdentity(evidence.id);
  const pointerExtractionKey = asExactIdentity(pointer.extraction_key);
  const evidenceExtractionKey = asExactIdentity(evidence.extraction_key);

  if (
    !isCanonicalBonusExtractionIdentity({
      extractionKey: pointer.extraction_key,
      contractVersion: pointer.contract_version,
      extractionContext: pointer.extraction_context,
    }) ||
    !isCanonicalBonusExtractionIdentity({
      extractionKey: evidence.extraction_key,
      contractVersion: pointer.contract_version,
      extractionContext: pointer.extraction_context,
    })
  ) {
    return reject("INVALID_EXTRACTION_IDENTITY");
  }

  if (
    !bonusId ||
    !pointerBonusId ||
    pointerBonusId !== bonusId ||
    !pointerDataSourceId ||
    !evidenceDataSourceId ||
    pointerDataSourceId !== evidenceDataSourceId ||
    !pointerEvidenceId ||
    !evidenceId ||
    pointerEvidenceId !== evidenceId ||
    !pointerExtractionKey ||
    !evidenceExtractionKey ||
    pointerExtractionKey !== evidenceExtractionKey
  ) {
    return reject("ACTIVE_EVIDENCE_MISMATCH");
  }

  // A SUPPORTS claim on historical evidence never qualifies: only the claims
  // carried by this active record are consulted.
  const claims = Array.isArray(evidence.bonus_claims)
    ? evidence.bonus_claims
    : [];
  const hasSupportingClaim =
    bonusId !== null &&
    claims.some(
      (claim) =>
        claim &&
        typeof claim === "object" &&
        claim.bonus_id === bonusId &&
        claim.verdict === SUPPORTS_VERDICT,
    );
  if (!hasSupportingClaim) return reject("MISSING_SUPPORTING_CLAIM");

  if (!isHttpSourceUrl(evidence.source_url)) {
    return reject("INVALID_EVIDENCE_SOURCE");
  }

  const observedAt = asDate(evidence.observed_at);
  if (!observedAt) return reject("INVALID_OBSERVATION");

  // extracted_at does not determine age. It is checked only because the
  // existing evidence-eligibility policy requires a valid, non-future
  // extraction timestamp.
  const extractedAt = asDate(evidence.extracted_at);
  if (!extractedAt) return reject("INVALID_OBSERVATION");
  if (observedAt.getTime() > nowTime || extractedAt.getTime() > nowTime) {
    return reject("FUTURE_OBSERVATION");
  }

  const validFrom = asDate(evidence.valid_from);
  if (validFrom !== null && validFrom.getTime() > nowTime) {
    return reject("PREMATURE_EVIDENCE");
  }

  // Expiry is inclusive: expires_at === now is already expired.
  const expiresAt = asDate(evidence.expires_at);
  if (expiresAt !== null && expiresAt.getTime() <= nowTime) {
    return reject("EXPIRED_EVIDENCE");
  }

  // Exactly maxAgeMs old is still fresh; one millisecond older is stale.
  if (nowTime - observedAt.getTime() > resolveMaxAgeMs(policy)) {
    return reject("STALE_OBSERVATION");
  }

  // verified_at is only a projection of this observation, so it must match it
  // exactly. A drifted projection means the denormalisation is untrustworthy.
  const projectedVerifiedAt = asDate(bonus.verified_at);
  if (
    projectedVerifiedAt === null ||
    projectedVerifiedAt.getTime() !== observedAt.getTime()
  ) {
    return reject("PROJECTION_MISMATCH");
  }

  return {
    status: "FRESH",
    evidenceId,
    observedAt,
  };
}

/** Boolean form of {@link evaluateActiveObservationFreshness}. */
export function hasFreshActiveObservation(
  bonus: ActiveObservationFreshnessInput | null | undefined,
  now: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): boolean {
  return (
    evaluateActiveObservationFreshness(bonus, now, policy).status === "FRESH"
  );
}
