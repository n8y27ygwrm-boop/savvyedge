export const WorkflowTransitionErrorCodes = [
  "SUBJECT_NOT_FOUND",
  "ACTOR_NOT_FOUND",
  "ACTOR_NOT_AUTHORIZED",
  "INVALID_TRANSITION",
  "SAME_STATE_CONFLICT",
  "STALE_GOVERNANCE_VERSION",
  "QUARANTINE_REASON_REQUIRED",
  "QUARANTINE_CLEARANCE_REQUIRED",
  "QUARANTINE_CLEARANCE_REASON_REQUIRED",
  "CANONICAL_TARGET_REQUIRED",
  "CANONICAL_TARGET_NOT_FOUND",
  "CANONICAL_TARGET_TYPE_MISMATCH",
  "CANONICAL_TARGET_SELF_REFERENCE",
  "CANONICAL_TARGET_INELIGIBLE",
  "CLAIM_NOT_FOUND",
  "CLAIM_TYPE_MISMATCH",
  "CLAIM_SUBJECT_MISMATCH",
  "DUPLICATE_CLAIM_ID",
  "EVIDENCE_RECORD_NOT_FOUND",
  "EVIDENCE_EXPIRED",
  "EVIDENCE_INELIGIBLE",
  "EVIDENCE_CONTRADICTORY",
  "APPROVAL_REQUIRED",
  "PUBLICATION_BLOCKED",
  "PUBLICATION_REASON_REQUIRED",
  "ELIGIBLE_LICENSE_REQUIRED",
  "ELIGIBLE_LICENSE_AMBIGUOUS",
] as const;

export type WorkflowTransitionErrorCode =
  (typeof WorkflowTransitionErrorCodes)[number];

const SAFE_MESSAGES: Record<WorkflowTransitionErrorCode, string> = {
  SUBJECT_NOT_FOUND: "The governed subject was not found.",
  ACTOR_NOT_FOUND: "The review actor was not found.",
  ACTOR_NOT_AUTHORIZED: "The review actor is not authorized for this action.",
  INVALID_TRANSITION: "The requested governance transition is not allowed.",
  SAME_STATE_CONFLICT: "The governed subject is already in the requested state.",
  STALE_GOVERNANCE_VERSION:
    "The governed subject changed before this transition could be applied.",
  QUARANTINE_REASON_REQUIRED:
    "A quarantine reason is required for this transition.",
  QUARANTINE_CLEARANCE_REQUIRED:
    "Explicit quarantine clearance is required for this transition.",
  QUARANTINE_CLEARANCE_REASON_REQUIRED:
    "An explicit safe reason is required for quarantine clearance.",
  CANONICAL_TARGET_REQUIRED:
    "A canonical target is required for supersession.",
  CANONICAL_TARGET_NOT_FOUND: "The canonical target was not found.",
  CANONICAL_TARGET_TYPE_MISMATCH:
    "The canonical target has the wrong governed-subject type.",
  CANONICAL_TARGET_SELF_REFERENCE:
    "A governed subject cannot be its own canonical target.",
  CANONICAL_TARGET_INELIGIBLE:
    "The canonical target is not eligible for supersession.",
  CLAIM_NOT_FOUND: "A relied-upon evidence claim was not found.",
  CLAIM_TYPE_MISMATCH:
    "A relied-upon evidence claim has the wrong subject type.",
  CLAIM_SUBJECT_MISMATCH:
    "A relied-upon evidence claim belongs to a different subject.",
  DUPLICATE_CLAIM_ID: "Duplicate evidence claim identifiers are not allowed.",
  EVIDENCE_RECORD_NOT_FOUND:
    "A relied-upon evidence record was not found.",
  EVIDENCE_EXPIRED: "A relied-upon evidence record is expired.",
  EVIDENCE_INELIGIBLE:
    "The supplied evidence does not satisfy the transition policy.",
  EVIDENCE_CONTRADICTORY:
    "Contradictory evidence cannot authorize this transition.",
  APPROVAL_REQUIRED: "Approval is required before publication.",
  PUBLICATION_BLOCKED: "The governed subject is not eligible for publication.",
  PUBLICATION_REASON_REQUIRED:
    "An explicit safe reason is required for unpublication.",
  ELIGIBLE_LICENSE_REQUIRED:
    "Casino publication requires an eligible related license.",
  ELIGIBLE_LICENSE_AMBIGUOUS:
    "Casino publication cannot choose between multiple eligible licenses.",
};

export class WorkflowTransitionError extends Error {
  public readonly code: WorkflowTransitionErrorCode;

  public constructor(code: WorkflowTransitionErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "WorkflowTransitionError";
    this.code = code;
  }
}
