import {
  ActorKind,
  EvidenceVerdict,
  ReviewStatus,
  WorkflowEventType,
} from "@savvyedge/database";
import { describe, expect, it } from "vitest";
import {
  decideReviewTransition,
  getEvidenceEligibilityError,
  isActorAuthorized,
  type WorkflowAction,
} from "../src/services/workflow-transition.policy";

describe("Slice 2.2B review-transition policy", () => {
  it.each([
    [ReviewStatus.NEW, ReviewStatus.AWAITING_REVIEW, "REVIEW_REQUESTED"],
    [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW, "REVIEW_STARTED"],
    [ReviewStatus.IN_REVIEW, ReviewStatus.APPROVED, "APPROVED"],
    [ReviewStatus.IN_REVIEW, ReviewStatus.REJECTED, "REJECTED"],
    [ReviewStatus.APPROVED, ReviewStatus.REJECTED, "REJECTED"],
    [ReviewStatus.REJECTED, ReviewStatus.AWAITING_REVIEW, "REVIEW_REQUESTED"],
  ] as const)(
    "allows %s -> %s",
    (fromStatus, toStatus, expectedEventType) => {
      expect(
        decideReviewTransition(fromStatus, toStatus, false)?.eventType,
      ).toBe(expectedEventType);
    },
  );

  it("maps explicit quarantine clearance and supersession", () => {
    expect(
      decideReviewTransition(
        ReviewStatus.QUARANTINED,
        ReviewStatus.AWAITING_REVIEW,
        true,
      ),
    ).toEqual({
      action: "CLEAR_QUARANTINE",
      eventType: WorkflowEventType.QUARANTINE_CLEARED,
    });
    expect(
      decideReviewTransition(
        ReviewStatus.APPROVED,
        ReviewStatus.SUPERSEDED,
        false,
      ),
    ).toEqual({
      action: "SUPERSEDE",
      eventType: WorkflowEventType.SUPERSEDED,
    });
  });

  it.each([
    [ReviewStatus.NEW, ReviewStatus.APPROVED],
    [ReviewStatus.AWAITING_REVIEW, ReviewStatus.APPROVED],
    [ReviewStatus.REJECTED, ReviewStatus.IN_REVIEW],
    [ReviewStatus.QUARANTINED, ReviewStatus.AWAITING_REVIEW],
    [ReviewStatus.SUPERSEDED, ReviewStatus.QUARANTINED],
    [ReviewStatus.SUPERSEDED, ReviewStatus.AWAITING_REVIEW],
  ] as const)("rejects %s -> %s", (fromStatus, toStatus) => {
    expect(decideReviewTransition(fromStatus, toStatus, false)).toBeNull();
  });
});

describe("Slice 2.2B actor authorization policy", () => {
  const allActions: WorkflowAction[] = [
    "SUBMIT_REVIEW",
    "BEGIN_REVIEW",
    "APPROVE",
    "REJECT",
    "QUARANTINE",
    "CLEAR_QUARANTINE",
    "SUPERSEDE",
    "PUBLISH",
    "UNPUBLISH",
  ];

  it("allows HUMAN actors to perform every supported command", () => {
    for (const action of allActions) {
      expect(isActorAuthorized(ActorKind.HUMAN, action, false)).toBe(true);
    }
  });

  it("limits SERVICE actors to submission and quarantine", () => {
    for (const action of allActions) {
      expect(isActorAuthorized(ActorKind.SERVICE, action, false)).toBe(
        action === "SUBMIT_REVIEW" || action === "QUARANTINE",
      );
    }
  });

  it("limits SYSTEM actors to reasoned quarantine and unpublication", () => {
    for (const action of allActions) {
      expect(isActorAuthorized(ActorKind.SYSTEM, action, false)).toBe(false);
      expect(isActorAuthorized(ActorKind.SYSTEM, action, true)).toBe(
        action === "QUARANTINE" || action === "UNPUBLISH",
      );
    }
  });

  it("denies MIGRATION actors runtime workflow authority", () => {
    for (const action of allActions) {
      expect(isActorAuthorized(ActorKind.MIGRATION, action, true)).toBe(false);
    }
  });
});

describe("Slice 2.2B evidence eligibility policy", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const eligible = {
    verdict: EvidenceVerdict.SUPPORTS,
    sourceUrl: "https://operator.example/terms",
    observedAt: new Date("2026-07-24T10:00:00.000Z"),
    extractedAt: new Date("2026-07-24T10:01:00.000Z"),
    validFrom: null,
    expiresAt: null,
  };

  it("accepts current supporting HTTP evidence", () => {
    expect(getEvidenceEligibilityError(eligible, now)).toBeNull();
  });

  it("distinguishes expired, contradictory and otherwise ineligible evidence", () => {
    expect(
      getEvidenceEligibilityError(
        { ...eligible, expiresAt: new Date(now.getTime()) },
        now,
      ),
    ).toBe("EVIDENCE_EXPIRED");
    expect(
      getEvidenceEligibilityError(
        { ...eligible, verdict: EvidenceVerdict.CONTRADICTS },
        now,
      ),
    ).toBe("EVIDENCE_CONTRADICTORY");
    expect(
      getEvidenceEligibilityError(
        { ...eligible, verdict: EvidenceVerdict.INCONCLUSIVE },
        now,
      ),
    ).toBe("EVIDENCE_INELIGIBLE");
    expect(
      getEvidenceEligibilityError(
        { ...eligible, sourceUrl: "ftp://operator.example/terms" },
        now,
      ),
    ).toBe("EVIDENCE_INELIGIBLE");
    expect(
      getEvidenceEligibilityError(
        {
          ...eligible,
          validFrom: new Date(now.getTime() + 1),
        },
        now,
      ),
    ).toBe("EVIDENCE_INELIGIBLE");
  });
});
