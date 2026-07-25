import {
  ActorKind,
  EvidenceVerdict,
  ReviewStatus,
  WorkflowEventType,
} from "@savvyedge/database";
import type { WorkflowTransitionErrorCode } from "./workflow-transition.errors";

export type WorkflowAction =
  | "SUBMIT_REVIEW"
  | "BEGIN_REVIEW"
  | "APPROVE"
  | "REJECT"
  | "QUARANTINE"
  | "CLEAR_QUARANTINE"
  | "SUPERSEDE"
  | "PUBLISH"
  | "UNPUBLISH";

export interface ReviewTransitionDecision {
  action: WorkflowAction;
  eventType: WorkflowEventType;
}

const REVIEW_TRANSITIONS = new Map<string, ReviewTransitionDecision>([
  [
    `${ReviewStatus.NEW}:${ReviewStatus.AWAITING_REVIEW}`,
    {
      action: "SUBMIT_REVIEW",
      eventType: WorkflowEventType.REVIEW_REQUESTED,
    },
  ],
  [
    `${ReviewStatus.APPROVED}:${ReviewStatus.AWAITING_REVIEW}`,
    {
      action: "SUBMIT_REVIEW",
      eventType: WorkflowEventType.MATERIAL_CHANGE_DETECTED,
    },
  ],
  [
    `${ReviewStatus.AWAITING_REVIEW}:${ReviewStatus.IN_REVIEW}`,
    {
      action: "BEGIN_REVIEW",
      eventType: WorkflowEventType.REVIEW_STARTED,
    },
  ],
  [
    `${ReviewStatus.IN_REVIEW}:${ReviewStatus.APPROVED}`,
    { action: "APPROVE", eventType: WorkflowEventType.APPROVED },
  ],
  [
    `${ReviewStatus.IN_REVIEW}:${ReviewStatus.REJECTED}`,
    { action: "REJECT", eventType: WorkflowEventType.REJECTED },
  ],
  [
    `${ReviewStatus.APPROVED}:${ReviewStatus.REJECTED}`,
    { action: "REJECT", eventType: WorkflowEventType.REJECTED },
  ],
  [
    `${ReviewStatus.REJECTED}:${ReviewStatus.AWAITING_REVIEW}`,
    {
      action: "SUBMIT_REVIEW",
      eventType: WorkflowEventType.REVIEW_REQUESTED,
    },
  ],
]);

export function decideReviewTransition(
  fromStatus: ReviewStatus,
  toStatus: ReviewStatus,
  explicitQuarantineClearance: boolean,
): ReviewTransitionDecision | null {
  if (
    toStatus === ReviewStatus.QUARANTINED &&
    fromStatus !== ReviewStatus.SUPERSEDED
  ) {
    return {
      action: "QUARANTINE",
      eventType: WorkflowEventType.QUARANTINED,
    };
  }

  if (
    toStatus === ReviewStatus.SUPERSEDED &&
    fromStatus !== ReviewStatus.SUPERSEDED
  ) {
    return {
      action: "SUPERSEDE",
      eventType: WorkflowEventType.SUPERSEDED,
    };
  }

  if (
    fromStatus === ReviewStatus.QUARANTINED &&
    toStatus === ReviewStatus.AWAITING_REVIEW
  ) {
    return explicitQuarantineClearance
      ? {
          action: "CLEAR_QUARANTINE",
          eventType: WorkflowEventType.QUARANTINE_CLEARED,
        }
      : null;
  }

  return REVIEW_TRANSITIONS.get(`${fromStatus}:${toStatus}`) ?? null;
}

export function isActorAuthorized(
  kind: ActorKind,
  action: WorkflowAction,
  hasExplicitInternalReason: boolean,
): boolean {
  if (kind === ActorKind.HUMAN) {
    return true;
  }

  if (kind === ActorKind.SERVICE) {
    return action === "SUBMIT_REVIEW" || action === "QUARANTINE";
  }

  if (kind === ActorKind.SYSTEM) {
    return (
      hasExplicitInternalReason &&
      (action === "QUARANTINE" || action === "UNPUBLISH")
    );
  }

  return false;
}

export interface EvidenceEligibilityInput {
  verdict: EvidenceVerdict;
  sourceUrl: string;
  observedAt: Date;
  extractedAt: Date;
  validFrom: Date | null;
  expiresAt: Date | null;
}

export function getEvidenceEligibilityError(
  evidence: EvidenceEligibilityInput,
  now: Date,
): WorkflowTransitionErrorCode | null {
  if (evidence.verdict === EvidenceVerdict.CONTRADICTS) {
    return "EVIDENCE_CONTRADICTORY";
  }

  if (evidence.verdict !== EvidenceVerdict.SUPPORTS) {
    return "EVIDENCE_INELIGIBLE";
  }

  if (evidence.expiresAt && evidence.expiresAt.getTime() <= now.getTime()) {
    return "EVIDENCE_EXPIRED";
  }

  if (
    (evidence.validFrom && evidence.validFrom.getTime() > now.getTime()) ||
    evidence.observedAt.getTime() > now.getTime() ||
    evidence.extractedAt.getTime() > now.getTime()
  ) {
    return "EVIDENCE_INELIGIBLE";
  }

  try {
    const protocol = new URL(evidence.sourceUrl).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return "EVIDENCE_INELIGIBLE";
    }
  } catch {
    return "EVIDENCE_INELIGIBLE";
  }

  return null;
}
