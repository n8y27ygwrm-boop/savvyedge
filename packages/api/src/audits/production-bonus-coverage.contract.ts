import type {
  ActiveObservationFreshnessDecision,
  ActiveObservationFreshnessInput,
  ActiveObservationRejectionCode,
} from "../services/freshness.policy";

export interface ActiveObservationAuditInput {
  bonus: ActiveObservationFreshnessInput | null | undefined;
}

export interface ActiveObservationAuditResult {
  /** Exact decision returned by evaluateActiveObservationFreshness. */
  activeObservationDecision: ActiveObservationFreshnessDecision;
  /** Derived only from the canonical decision's FRESH status. */
  activeObservationCompliant: boolean;
  /** Exact canonical rejection code, or null for FRESH. */
  activeObservationPrimaryFailure: ActiveObservationRejectionCode | null;
  /** Reserved for safe audit-only diagnostics; empty in this first boundary. */
  activeObservationOverlappingDetails: readonly never[];
}

export type ReverificationSourceResolution =
  "ACTIVE_POINTER" | "LEGACY_EVIDENCE" | "UNRESOLVED";

export type SourceOfferKeySyntax =
  "MISSING" | "WHITESPACE_PADDED" | "MALFORMED" | "CANONICAL";

export type CanonicalIdentityDerivability = "DERIVABLE" | "UNVERIFIABLE";

export type CanonicalIdentityEquality = "MATCH" | "MISMATCH" | "NOT_COMPARABLE";

export type CanonicalIdentityStatus =
  "DERIVABLE" | "VERIFIED" | "MISMATCH" | "UNVERIFIABLE";

export interface ReverificationReadinessInput {
  /**
   * Must be pre-resolved by a later database loader using the existing
   * canonical active-pointer-first source-resolution behavior. The pure audit
   * classifier does not load or resolve evidence.
   */
  sourceResolution: ReverificationSourceResolution;
  sourceOfferKey?: unknown;
  /**
   * Canonical key derived outside this boundary from the pre-resolved source.
   * A raw URL is intentionally not accepted as source identity.
   */
  resolvedCanonicalSourceOfferKey?: unknown;
}

export interface ReverificationReadinessResult {
  readiness: "READY" | "NOT_READY";
  sourceResolution: ReverificationSourceResolution;
  sourceOfferKeySyntax: SourceOfferKeySyntax;
  canonicalIdentityDerivability: CanonicalIdentityDerivability;
  canonicalIdentityEquality: CanonicalIdentityEquality;
  canonicalIdentityStatus: CanonicalIdentityStatus;
}

export interface PublicationGovernanceClaimInput {
  subjectBonusIdMatches: boolean;
  verdict: string | null | undefined;
  resolvesToActiveEvidence: boolean;
}

export interface PublicationGovernanceInput {
  currentPublicationEventAvailable: boolean;
  activeEvidenceAvailable: boolean;
  reliedUponClaims?: readonly PublicationGovernanceClaimInput[] | null;
}

export type PublicationGovernanceAssessment =
  "CONSISTENT" | "INCONSISTENT" | "NOT_ASSESSABLE";

export type PublicationGovernanceDiagnostic =
  | "MISSING_CURRENT_PUBLICATION_EVENT"
  | "ACTIVE_EVIDENCE_UNAVAILABLE"
  | "MISSING_RELIED_UPON_PUBLICATION_CLAIMS"
  | "PUBLICATION_CLAIM_SUBJECT_MISMATCH"
  | "PUBLICATION_CLAIM_NOT_SUPPORTS"
  | "PUBLICATION_CLAIM_NOT_ACTIVE_EVIDENCE";

export interface PublicationGovernanceResult {
  assessment: PublicationGovernanceAssessment;
  diagnostics: readonly PublicationGovernanceDiagnostic[];
}

export interface ProductionBonusCoverageInput {
  activeObservation: ActiveObservationAuditInput;
  reverificationReadiness: ReverificationReadinessInput;
  publicationGovernance: PublicationGovernanceInput;
}

export interface ProductionBonusCoverageResult {
  activeObservation: ActiveObservationAuditResult;
  reverificationReadiness: ReverificationReadinessResult;
  publicationGovernance: PublicationGovernanceResult;
}

/**
 * Counts a later database loader supplies. The reconciler treats every field as
 * untrusted at runtime: malformed input is reported as an issue, never thrown.
 */
export interface ProductionBonusCoverageReconciliationInput {
  publishedApprovedActive: number;
  activeObservationCompliant: number;
  activeObservationNonCompliant: number;
  activeObservationPrimaryFailureCounts: Partial<
    Record<ActiveObservationRejectionCode, number>
  >;
  reverificationReady: number;
  reverificationNotReady: number;
  governanceConsistent: number;
  governanceInconsistent: number;
  governanceNotAssessable: number;
}

export type ReconciliationIssueCode =
  | "INVALID_COUNT"
  | "UNKNOWN_ACTIVE_OBSERVATION_PRIMARY_FAILURE"
  | "ACTIVE_OBSERVATION_TOTAL_MISMATCH"
  | "ACTIVE_OBSERVATION_PRIMARY_FAILURE_TOTAL_MISMATCH"
  | "REVERIFICATION_TOTAL_MISMATCH"
  | "GOVERNANCE_TOTAL_MISMATCH";

export interface ReconciliationIssue {
  code: ReconciliationIssueCode;
  /**
   * The offending field. Stable, and additionally uses `"input"` when the whole
   * reconciliation input is unusable and the bare map name when the
   * primary-failure map is not a plain object.
   */
  field: string;
}

export interface ProductionBonusCoverageReconciliationResult {
  valid: boolean;
  issues: readonly ReconciliationIssue[];
  totals: {
    activeObservationPrimaryFailures: number | null;
  };
  equations: {
    activeObservation: boolean;
    activeObservationPrimaryFailures: boolean;
    reverificationReadiness: boolean;
    publicationGovernance: boolean;
  };
}
