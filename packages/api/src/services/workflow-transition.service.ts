import {
  ActorKind,
  EvidenceVerdict,
  GovernedSubjectType,
  Prisma,
  PrismaClient,
  PublicationStatus,
  QuarantineReason,
  ReviewStatus,
  WorkflowEventType,
  prisma,
} from "@savvyedge/database";
import {
  WorkflowTransitionError,
  type WorkflowTransitionErrorCode,
} from "./workflow-transition.errors";
import {
  decideReviewTransition,
  getEvidenceEligibilityError,
  isActorAuthorized,
  type WorkflowAction,
} from "./workflow-transition.policy";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const MAX_SAFE_REASON_LENGTH = 500;

export interface ReviewTransitionCommand {
  subjectId: string;
  actorId: string;
  expectedVersion: number;
  toStatus: ReviewStatus;
  claimIds?: readonly string[];
  quarantineReason?: QuarantineReason;
  clearQuarantine?: boolean;
  canonicalTargetId?: string;
  internalReason?: string;
}

export interface PublicationTransitionCommand {
  subjectId: string;
  actorId: string;
  expectedVersion: number;
  toStatus: Extract<PublicationStatus, "PUBLISHED" | "UNPUBLISHED">;
  claimIds?: readonly string[];
  reason?: string;
  internalReason?: string;
}

export interface WorkflowTransitionResult {
  subjectId: string;
  workflowEventId: string;
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus | null;
  governanceVersion: number;
}

interface SubjectState {
  id: string;
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus | null;
  quarantineReason: QuarantineReason | null;
  governanceVersion: number;
  duplicateOfId: string | null;
}

interface NormalizedClaim {
  id: string;
  subjectId: string;
  evidenceId: string;
  verdict: EvidenceVerdict;
}

interface EvidenceState {
  id: string;
  source_url: string;
  observed_at: Date;
  extracted_at: Date;
  valid_from: Date | null;
  expires_at: Date | null;
}

type GovernedType = GovernedSubjectType;
type PublishableSubjectType = Extract<
  GovernedSubjectType,
  "CASINO" | "BONUS" | "SLOT"
>;

export class WorkflowTransitionService {
  public constructor(private readonly database: PrismaClient = prisma) {}

  public transitionCasinoReview(
    command: ReviewTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executeReviewTransition(GovernedSubjectType.CASINO, command);
  }

  public transitionBonusReview(
    command: ReviewTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executeReviewTransition(GovernedSubjectType.BONUS, command);
  }

  public transitionSlotReview(
    command: ReviewTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executeReviewTransition(GovernedSubjectType.SLOT, command);
  }

  public transitionLicenseReview(
    command: ReviewTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executeReviewTransition(GovernedSubjectType.LICENSE, command);
  }

  public transitionCasinoPublication(
    command: PublicationTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executePublicationTransition(
      GovernedSubjectType.CASINO,
      command,
    );
  }

  public transitionBonusPublication(
    command: PublicationTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executePublicationTransition(
      GovernedSubjectType.BONUS,
      command,
    );
  }

  public transitionSlotPublication(
    command: PublicationTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.executePublicationTransition(
      GovernedSubjectType.SLOT,
      command,
    );
  }

  private async executeReviewTransition(
    subjectType: GovernedType,
    command: ReviewTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.inSerializableTransaction(async (tx) => {
      const actor = await this.loadActor(tx, command.actorId);
      const subject = await this.loadSubject(tx, subjectType, command.subjectId);

      if (!subject) {
        throw new WorkflowTransitionError("SUBJECT_NOT_FOUND");
      }

      this.assertExpectedVersion(subject, command.expectedVersion);

      if (subject.reviewStatus === command.toStatus) {
        throw new WorkflowTransitionError("SAME_STATE_CONFLICT");
      }

      if (
        subject.reviewStatus === ReviewStatus.QUARANTINED &&
        command.toStatus === ReviewStatus.AWAITING_REVIEW &&
        command.clearQuarantine !== true
      ) {
        throw new WorkflowTransitionError("QUARANTINE_CLEARANCE_REQUIRED");
      }

      const decision = decideReviewTransition(
        subject.reviewStatus,
        command.toStatus,
        command.clearQuarantine === true,
      );
      if (!decision) {
        throw new WorkflowTransitionError("INVALID_TRANSITION");
      }

      this.assertReviewCommandShape(subject, command);
      this.assertActorAuthorization(actor.kind, decision.action, command);

      const claimIds = await this.validateClaims(
        tx,
        subjectType,
        subject.id,
        command.claimIds ?? [],
        new Date(),
      );

      // Per-field approval requirements remain a product-policy boundary. Until
      // defined, approval fails closed unless at least one eligible supporting
      // claim for the exact governed subject is explicitly supplied.
      if (
        command.toStatus === ReviewStatus.APPROVED &&
        claimIds.length === 0
      ) {
        throw new WorkflowTransitionError("EVIDENCE_INELIGIBLE");
      }

      const canonicalTargetId =
        command.toStatus === ReviewStatus.SUPERSEDED
          ? await this.validateCanonicalTarget(
              tx,
              subjectType,
              subject.id,
              command.canonicalTargetId,
            )
          : null;

      const resultingPublicationStatus =
        subject.publicationStatus === PublicationStatus.PUBLISHED &&
        (command.toStatus === ReviewStatus.REJECTED ||
          command.toStatus === ReviewStatus.QUARANTINED ||
          command.toStatus === ReviewStatus.SUPERSEDED)
          ? PublicationStatus.UNPUBLISHED
          : subject.publicationStatus;

      await this.compareAndSwapReviewState(
        tx,
        subjectType,
        subject,
        command,
        canonicalTargetId,
        resultingPublicationStatus,
      );

      const resultingVersion = command.expectedVersion + 1;
      const audit = await this.createAuditEvent(tx, {
        subjectType,
        subjectId: subject.id,
        actorId: actor.id,
        eventType: decision.eventType,
        fromReviewStatus: subject.reviewStatus,
        toReviewStatus: command.toStatus,
        fromPublicationStatus: subject.publicationStatus,
        toPublicationStatus: resultingPublicationStatus,
        quarantineReason:
          command.toStatus === ReviewStatus.QUARANTINED
            ? command.quarantineReason!
            : null,
        expectedVersion: command.expectedVersion,
        resultingVersion,
        canonicalTargetId,
        internalNote:
          actor.kind === ActorKind.SYSTEM
            ? this.normalizeSafeReason(command.internalReason)
            : null,
      });

      await this.linkClaims(tx, subjectType, audit.id, claimIds);

      return {
        subjectId: subject.id,
        workflowEventId: audit.id,
        reviewStatus: command.toStatus,
        publicationStatus: resultingPublicationStatus,
        governanceVersion: resultingVersion,
      };
    });
  }

  private async executePublicationTransition(
    subjectType: PublishableSubjectType,
    command: PublicationTransitionCommand,
  ): Promise<WorkflowTransitionResult> {
    return this.inSerializableTransaction(async (tx) => {
      const actor = await this.loadActor(tx, command.actorId);
      const subject = await this.loadSubject(tx, subjectType, command.subjectId);

      if (!subject) {
        throw new WorkflowTransitionError("SUBJECT_NOT_FOUND");
      }

      this.assertExpectedVersion(subject, command.expectedVersion);

      if (
        command.toStatus !== PublicationStatus.PUBLISHED &&
        command.toStatus !== PublicationStatus.UNPUBLISHED
      ) {
        throw new WorkflowTransitionError("INVALID_TRANSITION");
      }

      if (subject.publicationStatus === command.toStatus) {
        throw new WorkflowTransitionError("SAME_STATE_CONFLICT");
      }

      const action: WorkflowAction =
        command.toStatus === PublicationStatus.PUBLISHED
          ? "PUBLISH"
          : "UNPUBLISH";
      this.assertActorAuthorization(actor.kind, action, command);

      if (
        command.toStatus === PublicationStatus.PUBLISHED &&
        subject.publicationStatus !== PublicationStatus.UNPUBLISHED
      ) {
        throw new WorkflowTransitionError("INVALID_TRANSITION");
      }
      if (
        command.toStatus === PublicationStatus.UNPUBLISHED &&
        subject.publicationStatus !== PublicationStatus.PUBLISHED
      ) {
        throw new WorkflowTransitionError("INVALID_TRANSITION");
      }

      let publicationReason: string | null = null;
      if (command.toStatus === PublicationStatus.UNPUBLISHED) {
        publicationReason = this.normalizeSafeReason(command.reason);
        if (!publicationReason) {
          throw new WorkflowTransitionError("PUBLICATION_REASON_REQUIRED");
        }
      }

      if (command.toStatus === PublicationStatus.PUBLISHED) {
        if (
          subject.quarantineReason !== null ||
          subject.reviewStatus === ReviewStatus.QUARANTINED ||
          subject.reviewStatus === ReviewStatus.SUPERSEDED ||
          subject.duplicateOfId !== null
        ) {
          throw new WorkflowTransitionError("PUBLICATION_BLOCKED");
        }
        if (subject.reviewStatus !== ReviewStatus.APPROVED) {
          throw new WorkflowTransitionError("APPROVAL_REQUIRED");
        }
      }

      const now = new Date();
      const claimIds = await this.validateClaims(
        tx,
        subjectType,
        subject.id,
        command.claimIds ?? [],
        now,
      );
      if (
        command.toStatus === PublicationStatus.PUBLISHED &&
        claimIds.length === 0
      ) {
        throw new WorkflowTransitionError("PUBLICATION_BLOCKED");
      }

      if (
        subjectType === GovernedSubjectType.CASINO &&
        command.toStatus === PublicationStatus.PUBLISHED
      ) {
        await this.requireOneEligibleCasinoLicense(tx, subject.id, now);
      }

      const updated = await this.compareAndSwapPublicationState(
        tx,
        subjectType,
        subject,
        command.expectedVersion,
        command.toStatus,
      );
      if (!updated) {
        throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
      }

      const resultingVersion = command.expectedVersion + 1;
      const audit = await this.createAuditEvent(tx, {
        subjectType,
        subjectId: subject.id,
        actorId: actor.id,
        eventType:
          command.toStatus === PublicationStatus.PUBLISHED
            ? WorkflowEventType.PUBLISHED
            : WorkflowEventType.UNPUBLISHED,
        fromReviewStatus: subject.reviewStatus,
        toReviewStatus: subject.reviewStatus,
        fromPublicationStatus: subject.publicationStatus,
        toPublicationStatus: command.toStatus,
        quarantineReason: null,
        expectedVersion: command.expectedVersion,
        resultingVersion,
        canonicalTargetId: null,
        internalNote: publicationReason,
      });

      await this.linkClaims(tx, subjectType, audit.id, claimIds);

      return {
        subjectId: subject.id,
        workflowEventId: audit.id,
        reviewStatus: subject.reviewStatus,
        publicationStatus: command.toStatus,
        governanceVersion: resultingVersion,
      };
    });
  }

  private async inSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (typeof (this.database as any).$transaction !== "function") {
      return operation(this.database as Prisma.TransactionClient);
    }
    try {
      return await this.database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
      }
      throw error;
    }
  }

  private async loadActor(tx: Prisma.TransactionClient, actorId: string) {
    const actor = await tx.reviewActor.findUnique({
      where: { id: actorId },
      select: { id: true, kind: true, active: true },
    });
    if (!actor) {
      throw new WorkflowTransitionError("ACTOR_NOT_FOUND");
    }
    if (!actor.active) {
      throw new WorkflowTransitionError("ACTOR_NOT_AUTHORIZED");
    }
    return actor;
  }

  private async loadSubject(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    subjectId: string,
  ): Promise<SubjectState | null> {
    const select = {
      id: true,
      review_status: true,
      quarantine_reason: true,
      governance_version: true,
      duplicate_of_id: true,
    } as const;

    if (subjectType === GovernedSubjectType.CASINO) {
      const row = await tx.casino.findUnique({
        where: { id: subjectId },
        select: { ...select, publication_status: true },
      });
      return row
        ? {
            id: row.id,
            reviewStatus: row.review_status,
            publicationStatus: row.publication_status,
            quarantineReason: row.quarantine_reason,
            governanceVersion: row.governance_version,
            duplicateOfId: row.duplicate_of_id,
          }
        : null;
    }

    if (subjectType === GovernedSubjectType.BONUS) {
      const row = await tx.bonus.findUnique({
        where: { id: subjectId },
        select: { ...select, publication_status: true },
      });
      return row
        ? {
            id: row.id,
            reviewStatus: row.review_status,
            publicationStatus: row.publication_status,
            quarantineReason: row.quarantine_reason,
            governanceVersion: row.governance_version,
            duplicateOfId: row.duplicate_of_id,
          }
        : null;
    }

    if (subjectType === GovernedSubjectType.SLOT) {
      const row = await tx.slot.findUnique({
        where: { id: subjectId },
        select: { ...select, publication_status: true },
      });
      return row
        ? {
            id: row.id,
            reviewStatus: row.review_status,
            publicationStatus: row.publication_status,
            quarantineReason: row.quarantine_reason,
            governanceVersion: row.governance_version,
            duplicateOfId: row.duplicate_of_id,
          }
        : null;
    }

    const row = await tx.license.findUnique({
      where: { id: subjectId },
      select,
    });
    return row
      ? {
          id: row.id,
          reviewStatus: row.review_status,
          publicationStatus: null,
          quarantineReason: row.quarantine_reason,
          governanceVersion: row.governance_version,
          duplicateOfId: row.duplicate_of_id,
        }
      : null;
  }

  private assertExpectedVersion(
    subject: SubjectState,
    expectedVersion: number,
  ): void {
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= POSTGRES_INTEGER_MAX ||
      subject.governanceVersion !== expectedVersion
    ) {
      throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
    }
  }

  private assertReviewCommandShape(
    subject: SubjectState,
    command: ReviewTransitionCommand,
  ): void {
    if (command.toStatus === ReviewStatus.QUARANTINED) {
      if (!command.quarantineReason) {
        throw new WorkflowTransitionError("QUARANTINE_REASON_REQUIRED");
      }
    } else if (command.quarantineReason !== undefined) {
      throw new WorkflowTransitionError("INVALID_TRANSITION");
    }

    const isClearance =
      subject.reviewStatus === ReviewStatus.QUARANTINED &&
      command.toStatus === ReviewStatus.AWAITING_REVIEW;
    if (command.clearQuarantine === true && !isClearance) {
      throw new WorkflowTransitionError("INVALID_TRANSITION");
    }

    if (
      command.toStatus === ReviewStatus.SUPERSEDED &&
      !command.canonicalTargetId
    ) {
      throw new WorkflowTransitionError("CANONICAL_TARGET_REQUIRED");
    }
    if (
      command.toStatus !== ReviewStatus.SUPERSEDED &&
      command.canonicalTargetId !== undefined
    ) {
      throw new WorkflowTransitionError("INVALID_TRANSITION");
    }
  }

  private assertActorAuthorization(
    kind: ActorKind,
    action: WorkflowAction,
    command: { internalReason?: string },
  ): void {
    const internalReason = this.normalizeSafeReason(command.internalReason);
    if (!isActorAuthorized(kind, action, internalReason !== null)) {
      throw new WorkflowTransitionError("ACTOR_NOT_AUTHORIZED");
    }
  }

  private normalizeSafeReason(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    const normalized = value.trim();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_SAFE_REASON_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
    ) {
      return null;
    }
    return normalized;
  }

  private async compareAndSwapReviewState(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    subject: SubjectState,
    command: ReviewTransitionCommand,
    canonicalTargetId: string | null,
    resultingPublicationStatus: PublicationStatus | null,
  ): Promise<void> {
    const commonData = {
      review_status: command.toStatus,
      quarantine_reason:
        command.toStatus === ReviewStatus.QUARANTINED
          ? command.quarantineReason!
          : null,
      duplicate_of_id:
        command.toStatus === ReviewStatus.SUPERSEDED
          ? canonicalTargetId
          : null,
      governance_version: { increment: 1 },
    } as const;

    let count = 0;
    if (subjectType === GovernedSubjectType.CASINO) {
      count = (
        await tx.casino.updateMany({
          where: {
            id: subject.id,
            governance_version: command.expectedVersion,
            review_status: subject.reviewStatus,
            publication_status: subject.publicationStatus!,
          },
          data: {
            ...commonData,
            publication_status: resultingPublicationStatus!,
          },
        })
      ).count;
    } else if (subjectType === GovernedSubjectType.BONUS) {
      count = (
        await tx.bonus.updateMany({
          where: {
            id: subject.id,
            governance_version: command.expectedVersion,
            review_status: subject.reviewStatus,
            publication_status: subject.publicationStatus!,
          },
          data: {
            ...commonData,
            publication_status: resultingPublicationStatus!,
          },
        })
      ).count;
    } else if (subjectType === GovernedSubjectType.SLOT) {
      count = (
        await tx.slot.updateMany({
          where: {
            id: subject.id,
            governance_version: command.expectedVersion,
            review_status: subject.reviewStatus,
            publication_status: subject.publicationStatus!,
          },
          data: {
            ...commonData,
            publication_status: resultingPublicationStatus!,
          },
        })
      ).count;
    } else {
      count = (
        await tx.license.updateMany({
          where: {
            id: subject.id,
            governance_version: command.expectedVersion,
            review_status: subject.reviewStatus,
          },
          data: commonData,
        })
      ).count;
    }

    if (count !== 1) {
      throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
    }
  }

  private async compareAndSwapPublicationState(
    tx: Prisma.TransactionClient,
    subjectType: PublishableSubjectType,
    subject: SubjectState,
    expectedVersion: number,
    publicationStatus: PublicationStatus,
  ): Promise<boolean> {
    const where = {
      id: subject.id,
      governance_version: expectedVersion,
      review_status: subject.reviewStatus,
      publication_status: subject.publicationStatus!,
    };
    const data = {
      publication_status: publicationStatus,
      governance_version: { increment: 1 },
    } as const;

    if (subjectType === GovernedSubjectType.CASINO) {
      return (await tx.casino.updateMany({ where, data })).count === 1;
    }
    if (subjectType === GovernedSubjectType.BONUS) {
      return (await tx.bonus.updateMany({ where, data })).count === 1;
    }
    return (await tx.slot.updateMany({ where, data })).count === 1;
  }

  private async validateCanonicalTarget(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    subjectId: string,
    canonicalTargetId: string | undefined,
  ): Promise<string> {
    if (!canonicalTargetId) {
      throw new WorkflowTransitionError("CANONICAL_TARGET_REQUIRED");
    }
    if (canonicalTargetId === subjectId) {
      throw new WorkflowTransitionError("CANONICAL_TARGET_SELF_REFERENCE");
    }

    const canonical = await this.loadSubject(
      tx,
      subjectType,
      canonicalTargetId,
    );
    if (!canonical) {
      const otherType = await this.findOtherSubjectType(
        tx,
        subjectType,
        canonicalTargetId,
      );
      throw new WorkflowTransitionError(
        otherType
          ? "CANONICAL_TARGET_TYPE_MISMATCH"
          : "CANONICAL_TARGET_NOT_FOUND",
      );
    }

    if (
      canonical.reviewStatus !== ReviewStatus.APPROVED ||
      canonical.quarantineReason !== null ||
      canonical.duplicateOfId !== null
    ) {
      throw new WorkflowTransitionError("CANONICAL_TARGET_INELIGIBLE");
    }

    return canonical.id;
  }

  private async findOtherSubjectType(
    tx: Prisma.TransactionClient,
    expectedType: GovernedType,
    subjectId: string,
  ): Promise<GovernedType | null> {
    if (
      expectedType !== GovernedSubjectType.CASINO &&
      (await tx.casino.findUnique({
        where: { id: subjectId },
        select: { id: true },
      }))
    ) {
      return GovernedSubjectType.CASINO;
    }
    if (
      expectedType !== GovernedSubjectType.BONUS &&
      (await tx.bonus.findUnique({
        where: { id: subjectId },
        select: { id: true },
      }))
    ) {
      return GovernedSubjectType.BONUS;
    }
    if (
      expectedType !== GovernedSubjectType.SLOT &&
      (await tx.slot.findUnique({
        where: { id: subjectId },
        select: { id: true },
      }))
    ) {
      return GovernedSubjectType.SLOT;
    }
    if (
      expectedType !== GovernedSubjectType.LICENSE &&
      (await tx.license.findUnique({
        where: { id: subjectId },
        select: { id: true },
      }))
    ) {
      return GovernedSubjectType.LICENSE;
    }
    return null;
  }

  private async validateClaims(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    subjectId: string,
    suppliedClaimIds: readonly string[],
    now: Date,
  ): Promise<string[]> {
    const claimIds = [...suppliedClaimIds].sort();
    if (new Set(claimIds).size !== claimIds.length) {
      throw new WorkflowTransitionError("DUPLICATE_CLAIM_ID");
    }
    if (claimIds.length === 0) {
      return [];
    }

    const claims = await this.loadClaims(tx, subjectType, claimIds);
    const claimsById = new Map(claims.map((claim) => [claim.id, claim]));

    for (const claimId of claimIds) {
      const claim = claimsById.get(claimId);
      if (!claim) {
        const otherType = await this.findClaimType(tx, claimId);
        throw new WorkflowTransitionError(
          otherType && otherType !== subjectType
            ? "CLAIM_TYPE_MISMATCH"
            : "CLAIM_NOT_FOUND",
        );
      }
      if (claim.subjectId !== subjectId) {
        throw new WorkflowTransitionError("CLAIM_SUBJECT_MISMATCH");
      }
    }

    const evidenceIds = [...new Set(claims.map((claim) => claim.evidenceId))];
    const evidence = await tx.evidenceRecord.findMany({
      where: { id: { in: evidenceIds } },
      select: {
        id: true,
        source_url: true,
        observed_at: true,
        extracted_at: true,
        valid_from: true,
        expires_at: true,
      },
    });
    const evidenceById = new Map(evidence.map((record) => [record.id, record]));

    for (const claimId of claimIds) {
      const claim = claimsById.get(claimId)!;
      const record = evidenceById.get(claim.evidenceId);
      if (!record) {
        throw new WorkflowTransitionError("EVIDENCE_RECORD_NOT_FOUND");
      }
      const errorCode = getEvidenceEligibilityError(
        {
          verdict: claim.verdict,
          sourceUrl: record.source_url,
          observedAt: record.observed_at,
          extractedAt: record.extracted_at,
          validFrom: record.valid_from,
          expiresAt: record.expires_at,
        },
        now,
      );
      if (errorCode) {
        throw new WorkflowTransitionError(errorCode);
      }
    }

    return claimIds;
  }

  private async loadClaims(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    claimIds: string[],
  ): Promise<NormalizedClaim[]> {
    if (subjectType === GovernedSubjectType.CASINO) {
      const rows = await tx.casinoEvidenceClaim.findMany({
        where: { id: { in: claimIds } },
        select: {
          id: true,
          casino_id: true,
          evidence_id: true,
          verdict: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        subjectId: row.casino_id,
        evidenceId: row.evidence_id,
        verdict: row.verdict,
      }));
    }
    if (subjectType === GovernedSubjectType.BONUS) {
      const rows = await tx.bonusEvidenceClaim.findMany({
        where: { id: { in: claimIds } },
        select: {
          id: true,
          bonus_id: true,
          evidence_id: true,
          verdict: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        subjectId: row.bonus_id,
        evidenceId: row.evidence_id,
        verdict: row.verdict,
      }));
    }
    if (subjectType === GovernedSubjectType.SLOT) {
      const rows = await tx.slotEvidenceClaim.findMany({
        where: { id: { in: claimIds } },
        select: {
          id: true,
          slot_id: true,
          evidence_id: true,
          verdict: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        subjectId: row.slot_id,
        evidenceId: row.evidence_id,
        verdict: row.verdict,
      }));
    }
    const rows = await tx.licenseEvidenceClaim.findMany({
      where: { id: { in: claimIds } },
      select: {
        id: true,
        license_id: true,
        evidence_id: true,
        verdict: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      subjectId: row.license_id,
      evidenceId: row.evidence_id,
      verdict: row.verdict,
    }));
  }

  private async findClaimType(
    tx: Prisma.TransactionClient,
    claimId: string,
  ): Promise<GovernedType | null> {
    if (
      await tx.casinoEvidenceClaim.findUnique({
        where: { id: claimId },
        select: { id: true },
      })
    ) {
      return GovernedSubjectType.CASINO;
    }
    if (
      await tx.bonusEvidenceClaim.findUnique({
        where: { id: claimId },
        select: { id: true },
      })
    ) {
      return GovernedSubjectType.BONUS;
    }
    if (
      await tx.slotEvidenceClaim.findUnique({
        where: { id: claimId },
        select: { id: true },
      })
    ) {
      return GovernedSubjectType.SLOT;
    }
    if (
      await tx.licenseEvidenceClaim.findUnique({
        where: { id: claimId },
        select: { id: true },
      })
    ) {
      return GovernedSubjectType.LICENSE;
    }
    return null;
  }

  private async requireOneEligibleCasinoLicense(
    tx: Prisma.TransactionClient,
    casinoId: string,
    now: Date,
  ): Promise<void> {
    // License has no expiry scalar in the committed schema. Eligibility therefore
    // uses current ACTIVE status plus non-expired evidence linked to an immutable
    // License APPROVED event. No text fields or array order determine applicability.
    const candidates = await tx.license.findMany({
      where: {
        casino_id: casinoId,
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
      },
      select: { id: true, governance_version: true },
      orderBy: { id: "asc" },
    });

    const eligibleLicenseIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.governance_version <= 0) {
        continue;
      }

      // Only an approval event producing the License's current version can be
      // authoritative. An older approval is invalidated by every later event.
      const approvalEvent = await tx.workflowAuditEvent.findFirst({
        where: {
          subject_type: GovernedSubjectType.LICENSE,
          license_id: candidate.id,
          event_type: WorkflowEventType.APPROVED,
          to_review_status: ReviewStatus.APPROVED,
          expected_version: candidate.governance_version - 1,
          resulting_version: candidate.governance_version,
        },
        select: {
          evidence_claims: {
            select: { license_evidence_claim_id: true },
          },
        },
      });
      if (!approvalEvent) {
        continue;
      }

      const linkedClaimIds = [
        ...new Set(
          approvalEvent.evidence_claims
            .map((link) => link.license_evidence_claim_id)
            .filter((claimId): claimId is string => claimId !== null),
        ),
      ].sort();

      let hasEligibleApprovalEvidence = false;
      for (const claimId of linkedClaimIds) {
        try {
          await this.validateClaims(
            tx,
            GovernedSubjectType.LICENSE,
            candidate.id,
            [claimId],
            now,
          );
          hasEligibleApprovalEvidence = true;
          break;
        } catch (error) {
          if (!(error instanceof WorkflowTransitionError)) {
            throw error;
          }
        }
      }

      if (hasEligibleApprovalEvidence) {
        eligibleLicenseIds.push(candidate.id);
      }
    }

    if (eligibleLicenseIds.length === 0) {
      throw new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED");
    }
    if (eligibleLicenseIds.length > 1) {
      throw new WorkflowTransitionError("ELIGIBLE_LICENSE_AMBIGUOUS");
    }
  }

  private async createAuditEvent(
    tx: Prisma.TransactionClient,
    input: {
      subjectType: GovernedType;
      subjectId: string;
      actorId: string;
      eventType: WorkflowEventType;
      fromReviewStatus: ReviewStatus;
      toReviewStatus: ReviewStatus;
      fromPublicationStatus: PublicationStatus | null;
      toPublicationStatus: PublicationStatus | null;
      quarantineReason: QuarantineReason | null;
      expectedVersion: number;
      resultingVersion: number;
      canonicalTargetId: string | null;
      internalNote: string | null;
    },
  ) {
    return tx.workflowAuditEvent.create({
      data: {
        subject_type: input.subjectType,
        casino_id:
          input.subjectType === GovernedSubjectType.CASINO
            ? input.subjectId
            : null,
        bonus_id:
          input.subjectType === GovernedSubjectType.BONUS
            ? input.subjectId
            : null,
        slot_id:
          input.subjectType === GovernedSubjectType.SLOT
            ? input.subjectId
            : null,
        license_id:
          input.subjectType === GovernedSubjectType.LICENSE
            ? input.subjectId
            : null,
        actor_id: input.actorId,
        event_type: input.eventType,
        from_review_status: input.fromReviewStatus,
        to_review_status: input.toReviewStatus,
        from_publication_status: input.fromPublicationStatus,
        to_publication_status: input.toPublicationStatus,
        quarantine_reason: input.quarantineReason,
        expected_version: input.expectedVersion,
        resulting_version: input.resultingVersion,
        canonical_casino_id:
          input.subjectType === GovernedSubjectType.CASINO
            ? input.canonicalTargetId
            : null,
        canonical_bonus_id:
          input.subjectType === GovernedSubjectType.BONUS
            ? input.canonicalTargetId
            : null,
        canonical_slot_id:
          input.subjectType === GovernedSubjectType.SLOT
            ? input.canonicalTargetId
            : null,
        canonical_license_id:
          input.subjectType === GovernedSubjectType.LICENSE
            ? input.canonicalTargetId
            : null,
        internal_note: input.internalNote,
      },
      select: { id: true },
    });
  }

  private async linkClaims(
    tx: Prisma.TransactionClient,
    subjectType: GovernedType,
    workflowEventId: string,
    claimIds: string[],
  ): Promise<void> {
    for (const claimId of claimIds) {
      await tx.workflowEventClaim.create({
        data: {
          workflow_event_id: workflowEventId,
          casino_evidence_claim_id:
            subjectType === GovernedSubjectType.CASINO ? claimId : null,
          bonus_evidence_claim_id:
            subjectType === GovernedSubjectType.BONUS ? claimId : null,
          slot_evidence_claim_id:
            subjectType === GovernedSubjectType.SLOT ? claimId : null,
          license_evidence_claim_id:
            subjectType === GovernedSubjectType.LICENSE ? claimId : null,
        },
      });
    }
  }
}

export const workflowTransitionService = new WorkflowTransitionService();

export type { WorkflowTransitionErrorCode };
