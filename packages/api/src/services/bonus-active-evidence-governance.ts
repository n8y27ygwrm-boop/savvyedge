import { Prisma, PublicationStatus, ReviewStatus } from "@savvyedge/database";
import { WorkflowTransitionError } from "./workflow-transition.errors";
import { WorkflowTransitionService } from "./workflow-transition.service";

export interface BonusAuthorityState {
  id: string;
  governance_version: number;
  review_status: ReviewStatus;
  publication_status: PublicationStatus;
}

export class BonusHumanReviewPendingError extends Error {
  public readonly code = "HUMAN_REVIEW_PENDING";

  public constructor(
    public readonly bonusId: string,
    public readonly reviewStatus:
      typeof ReviewStatus.AWAITING_REVIEW | typeof ReviewStatus.IN_REVIEW,
    public readonly governanceVersion: number,
  ) {
    super("Automated evidence replacement is blocked during human review.");
    this.name = "BonusHumanReviewPendingError";
  }
}

export function isBonusHumanReviewPending(
  bonus: BonusAuthorityState,
): bonus is BonusAuthorityState & {
  review_status:
    typeof ReviewStatus.AWAITING_REVIEW | typeof ReviewStatus.IN_REVIEW;
} {
  return (
    bonus.review_status === ReviewStatus.AWAITING_REVIEW ||
    bonus.review_status === ReviewStatus.IN_REVIEW
  );
}

export function assertAutomatedEvidenceReplacementAllowed(
  bonus: BonusAuthorityState,
): void {
  if (isBonusHumanReviewPending(bonus)) {
    throw new BonusHumanReviewPendingError(
      bonus.id,
      bonus.review_status,
      bonus.governance_version,
    );
  }

  if (
    bonus.review_status === ReviewStatus.QUARANTINED ||
    bonus.review_status === ReviewStatus.SUPERSEDED ||
    (bonus.publication_status === PublicationStatus.PUBLISHED &&
      bonus.review_status !== ReviewStatus.APPROVED)
  ) {
    throw new WorkflowTransitionError("INVALID_TRANSITION");
  }
}

export function assertBonusAuthoritySnapshotUnchanged(
  expected: BonusAuthorityState | null | undefined,
  current: BonusAuthorityState,
): void {
  // `null` records an observed absence; it must not authorize adopting a Bonus
  // created while external machine extraction was in flight. Only `undefined`
  // means this legacy/non-artifact call could not take a stable snapshot.
  if (expected === undefined) return;

  if (
    expected === null ||
    expected.id !== current.id ||
    expected.governance_version !== current.governance_version ||
    expected.review_status !== current.review_status ||
    expected.publication_status !== current.publication_status
  ) {
    throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
  }
}

export async function applyAutomatedEvidenceReplacementGovernance(input: {
  transaction: Prisma.TransactionClient;
  bonus: BonusAuthorityState;
  actorId: string;
  claimIds: readonly string[];
  internalReason: string;
}): Promise<{
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus;
  governanceVersion: number;
}> {
  assertAutomatedEvidenceReplacementAllowed(input.bonus);

  if (input.bonus.review_status === ReviewStatus.APPROVED) {
    const result = await new WorkflowTransitionService(
      input.transaction as never,
    ).transitionBonusReview({
      subjectId: input.bonus.id,
      actorId: input.actorId,
      expectedVersion: input.bonus.governance_version,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      claimIds: input.claimIds,
      internalReason: input.internalReason,
    });
    return {
      reviewStatus: result.reviewStatus,
      publicationStatus:
        result.publicationStatus ?? input.bonus.publication_status,
      governanceVersion: result.governanceVersion,
    };
  }

  const cas = await input.transaction.bonus.updateMany({
    where: {
      id: input.bonus.id,
      governance_version: input.bonus.governance_version,
      review_status: input.bonus.review_status,
      publication_status: input.bonus.publication_status,
    },
    data: { updated_at: new Date() },
  });
  if (cas.count !== 1) {
    throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
  }

  return {
    reviewStatus: input.bonus.review_status,
    publicationStatus: input.bonus.publication_status,
    governanceVersion: input.bonus.governance_version,
  };
}
