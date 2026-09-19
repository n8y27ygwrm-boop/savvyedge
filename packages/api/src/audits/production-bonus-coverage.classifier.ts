import {
  evaluateActiveObservationFreshness,
  type ActiveObservationRejectionCode,
  type BonusFreshnessPolicy,
} from "../services/freshness.policy";
import { isBonusSourceOfferKey } from "../utils/bonus-source-offer-key";
import {
  type ActiveObservationAuditInput,
  type ActiveObservationAuditResult,
  type CanonicalIdentityEquality,
  type CanonicalIdentityStatus,
  type ProductionBonusCoverageInput,
  type ProductionBonusCoverageReconciliationInput,
  type ProductionBonusCoverageReconciliationResult,
  type ProductionBonusCoverageResult,
  type PublicationGovernanceDiagnostic,
  type PublicationGovernanceInput,
  type PublicationGovernanceResult,
  type ReconciliationIssue,
  type ReverificationReadinessInput,
  type ReverificationReadinessResult,
  type SourceOfferKeySyntax,
} from "./production-bonus-coverage.contract";

/**
 * Exhaustive mirror of the canonical rejection codes.
 *
 * `Record<ActiveObservationRejectionCode, true>` makes the mirror total in both
 * directions at compile time: dropping a canonical code is a missing-property
 * error, and inventing one is an excess-property error. A `satisfies` array
 * caught only invention, so a thirteenth canonical code could have been added
 * to the evaluator and silently treated here as unknown.
 *
 * This is a compile-time mirror only. It does not reorder, rename or reinterpret
 * anything: the canonical union in `freshness.policy` remains the authority.
 */
const ACTIVE_OBSERVATION_REJECTION_CODE_MAP: Record<
  ActiveObservationRejectionCode,
  true
> = {
  MISSING_ACTIVE_POINTER: true,
  AMBIGUOUS_ACTIVE_POINTER: true,
  MISSING_ACTIVE_EVIDENCE: true,
  ACTIVE_EVIDENCE_MISMATCH: true,
  INVALID_EXTRACTION_IDENTITY: true,
  MISSING_SUPPORTING_CLAIM: true,
  INVALID_EVIDENCE_SOURCE: true,
  INVALID_OBSERVATION: true,
  FUTURE_OBSERVATION: true,
  PREMATURE_EVIDENCE: true,
  EXPIRED_EVIDENCE: true,
  STALE_OBSERVATION: true,
  PROJECTION_MISMATCH: true,
};

/** Runtime membership set, derived from the exhaustive compile-time mirror. */
const ACTIVE_OBSERVATION_REJECTION_CODES = new Set<string>(
  Object.keys(ACTIVE_OBSERVATION_REJECTION_CODE_MAP),
);

/**
 * `policy` is forwarded verbatim to the canonical evaluator. Omitting it is
 * identical to the evaluator's own default, so callers that pass nothing keep
 * today's behaviour exactly; callers that audit under a non-default window must
 * state it, so the audit can never silently assume a different one.
 */
export function classifyActiveObservation(
  input: ActiveObservationAuditInput,
  auditNow: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): ActiveObservationAuditResult {
  const activeObservationDecision = evaluateActiveObservationFreshness(
    input.bonus,
    auditNow,
    policy,
  );

  return {
    activeObservationDecision,
    activeObservationCompliant: activeObservationDecision.status === "FRESH",
    activeObservationPrimaryFailure:
      activeObservationDecision.status === "REJECTED"
        ? activeObservationDecision.code
        : null,
    activeObservationOverlappingDetails: [],
  };
}

function classifySourceOfferKeySyntax(value: unknown): SourceOfferKeySyntax {
  if (value === null || value === undefined || value === "") {
    return "MISSING";
  }
  if (typeof value === "string" && value.trim() !== value) {
    return "WHITESPACE_PADDED";
  }
  return isBonusSourceOfferKey(value) ? "CANONICAL" : "MALFORMED";
}

export function classifyReverificationReadiness(
  input: ReverificationReadinessInput,
): ReverificationReadinessResult {
  const sourceOfferKeySyntax = classifySourceOfferKeySyntax(
    input.sourceOfferKey,
  );
  const resolvedIdentityDerivable = isBonusSourceOfferKey(
    input.resolvedCanonicalSourceOfferKey,
  );
  const storedIdentityCanonical = sourceOfferKeySyntax === "CANONICAL";

  let canonicalIdentityEquality: CanonicalIdentityEquality = "NOT_COMPARABLE";
  if (storedIdentityCanonical && resolvedIdentityDerivable) {
    canonicalIdentityEquality =
      input.sourceOfferKey === input.resolvedCanonicalSourceOfferKey
        ? "MATCH"
        : "MISMATCH";
  }

  let canonicalIdentityStatus: CanonicalIdentityStatus = "UNVERIFIABLE";
  if (resolvedIdentityDerivable) {
    if (!storedIdentityCanonical) {
      canonicalIdentityStatus = "DERIVABLE";
    } else {
      canonicalIdentityStatus =
        canonicalIdentityEquality === "MATCH" ? "VERIFIED" : "MISMATCH";
    }
  }

  const activePointerReady =
    input.sourceResolution === "ACTIVE_POINTER" &&
    resolvedIdentityDerivable &&
    (sourceOfferKeySyntax === "MISSING" ||
      canonicalIdentityEquality === "MATCH");
  const legacyEvidenceReady =
    input.sourceResolution === "LEGACY_EVIDENCE" &&
    sourceOfferKeySyntax === "CANONICAL" &&
    canonicalIdentityEquality === "MATCH";

  return {
    readiness:
      activePointerReady || legacyEvidenceReady ? "READY" : "NOT_READY",
    sourceResolution: input.sourceResolution,
    sourceOfferKeySyntax,
    canonicalIdentityDerivability: resolvedIdentityDerivable
      ? "DERIVABLE"
      : "UNVERIFIABLE",
    canonicalIdentityEquality,
    canonicalIdentityStatus,
  };
}

export function classifyPublicationGovernance(
  input: PublicationGovernanceInput,
): PublicationGovernanceResult {
  const diagnostics: PublicationGovernanceDiagnostic[] = [];

  if (!input.currentPublicationEventAvailable) {
    diagnostics.push("MISSING_CURRENT_PUBLICATION_EVENT");
  }
  if (!input.activeEvidenceAvailable) {
    diagnostics.push("ACTIVE_EVIDENCE_UNAVAILABLE");
  }
  if (diagnostics.length > 0) {
    return { assessment: "NOT_ASSESSABLE", diagnostics };
  }

  const claims = Array.isArray(input.reliedUponClaims)
    ? input.reliedUponClaims
    : [];
  if (claims.length === 0) {
    return {
      assessment: "INCONSISTENT",
      diagnostics: ["MISSING_RELIED_UPON_PUBLICATION_CLAIMS"],
    };
  }

  if (claims.some((claim) => !claim.subjectBonusIdMatches)) {
    diagnostics.push("PUBLICATION_CLAIM_SUBJECT_MISMATCH");
  }
  if (claims.some((claim) => claim.verdict !== "SUPPORTS")) {
    diagnostics.push("PUBLICATION_CLAIM_NOT_SUPPORTS");
  }
  if (claims.some((claim) => !claim.resolvesToActiveEvidence)) {
    diagnostics.push("PUBLICATION_CLAIM_NOT_ACTIVE_EVIDENCE");
  }

  return {
    assessment: diagnostics.length === 0 ? "CONSISTENT" : "INCONSISTENT",
    diagnostics,
  };
}

export function classifyProductionBonusCoverage(
  input: ProductionBonusCoverageInput,
  auditNow: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): ProductionBonusCoverageResult {
  return {
    activeObservation: classifyActiveObservation(
      input.activeObservation,
      auditNow,
      policy,
    ),
    reverificationReadiness: classifyReverificationReadiness(
      input.reverificationReadiness,
    ),
    publicationGovernance: classifyPublicationGovernance(
      input.publicationGovernance,
    ),
  };
}

function isValidCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * A reconciliation input — and its primary-failure map — must be a plain
 * object. Arrays, strings, numbers, booleans, functions and null are malformed
 * audit input, not containers to enumerate.
 */
function isPlainRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable field name for a reconciliation input that is unusable as a whole. */
const RECONCILIATION_INPUT_FIELD = "input";

/** Stable field name for an unusable primary-failure map. */
const PRIMARY_FAILURE_COUNTS_FIELD = "activeObservationPrimaryFailureCounts";

function unusableReconciliationInput(): ProductionBonusCoverageReconciliationResult {
  return {
    valid: false,
    issues: [{ code: "INVALID_COUNT", field: RECONCILIATION_INPUT_FIELD }],
    totals: { activeObservationPrimaryFailures: null },
    equations: {
      activeObservation: false,
      activeObservationPrimaryFailures: false,
      reverificationReadiness: false,
      publicationGovernance: false,
    },
  };
}

/**
 * Reconciles the audit dimensions against the published population.
 *
 * Malformed input is reported, never thrown: a later database loader builds
 * these counts from aggregates that can legitimately arrive absent or wrongly
 * shaped. An audit that crashes reports nothing at all, and one that treats an
 * unusable failure map as an empty one reports a false balance — so an unusable
 * map forces its equation false rather than summing to zero.
 */
export function reconcileProductionBonusCoverage(
  input: ProductionBonusCoverageReconciliationInput,
): ProductionBonusCoverageReconciliationResult {
  if (!isPlainRecord(input)) {
    return unusableReconciliationInput();
  }

  const issues: ReconciliationIssue[] = [];
  const countFields = [
    "publishedApprovedActive",
    "activeObservationCompliant",
    "activeObservationNonCompliant",
    "reverificationReady",
    "reverificationNotReady",
    "governanceConsistent",
    "governanceInconsistent",
    "governanceNotAssessable",
  ] as const;

  for (const field of countFields) {
    if (!isValidCount(input[field])) {
      issues.push({ code: "INVALID_COUNT", field });
    }
  }

  const primaryFailureCounts = input.activeObservationPrimaryFailureCounts;
  let primaryFailureTotal = 0;
  let primaryFailureCountsValid = isPlainRecord(primaryFailureCounts);

  if (!primaryFailureCountsValid) {
    // Exactly one issue for the container itself: with nothing enumerable to
    // trust, the map is neither summed nor reported key by key.
    issues.push({ code: "INVALID_COUNT", field: PRIMARY_FAILURE_COUNTS_FIELD });
  } else {
    for (const [failure, count] of Object.entries(primaryFailureCounts)) {
      if (!ACTIVE_OBSERVATION_REJECTION_CODES.has(failure)) {
        primaryFailureCountsValid = false;
        issues.push({
          code: "UNKNOWN_ACTIVE_OBSERVATION_PRIMARY_FAILURE",
          field: `${PRIMARY_FAILURE_COUNTS_FIELD}.${failure}`,
        });
        continue;
      }
      if (!isValidCount(count)) {
        primaryFailureCountsValid = false;
        issues.push({
          code: "INVALID_COUNT",
          field: `${PRIMARY_FAILURE_COUNTS_FIELD}.${failure}`,
        });
        continue;
      }
      primaryFailureTotal += count;
    }
  }

  const topLevelCountsValid = countFields.every((field) =>
    isValidCount(input[field]),
  );
  const activeObservation =
    topLevelCountsValid &&
    input.publishedApprovedActive ===
      input.activeObservationCompliant + input.activeObservationNonCompliant;
  const activeObservationPrimaryFailures =
    topLevelCountsValid &&
    primaryFailureCountsValid &&
    input.activeObservationNonCompliant === primaryFailureTotal;
  const reverificationReadiness =
    topLevelCountsValid &&
    input.publishedApprovedActive ===
      input.reverificationReady + input.reverificationNotReady;
  const publicationGovernance =
    topLevelCountsValid &&
    input.publishedApprovedActive ===
      input.governanceConsistent +
        input.governanceInconsistent +
        input.governanceNotAssessable;

  if (topLevelCountsValid && !activeObservation) {
    issues.push({
      code: "ACTIVE_OBSERVATION_TOTAL_MISMATCH",
      field: "activeObservation",
    });
  }
  if (
    topLevelCountsValid &&
    primaryFailureCountsValid &&
    !activeObservationPrimaryFailures
  ) {
    issues.push({
      code: "ACTIVE_OBSERVATION_PRIMARY_FAILURE_TOTAL_MISMATCH",
      field: PRIMARY_FAILURE_COUNTS_FIELD,
    });
  }
  if (topLevelCountsValid && !reverificationReadiness) {
    issues.push({
      code: "REVERIFICATION_TOTAL_MISMATCH",
      field: "reverificationReadiness",
    });
  }
  if (topLevelCountsValid && !publicationGovernance) {
    issues.push({
      code: "GOVERNANCE_TOTAL_MISMATCH",
      field: "publicationGovernance",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    totals: {
      activeObservationPrimaryFailures: primaryFailureCountsValid
        ? primaryFailureTotal
        : null,
    },
    equations: {
      activeObservation,
      activeObservationPrimaryFailures,
      reverificationReadiness,
      publicationGovernance,
    },
  };
}
