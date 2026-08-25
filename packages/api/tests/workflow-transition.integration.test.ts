import {
  ActorKind,
  EvidenceType,
  EvidenceVerdict,
  PrismaClient,
  PublicationStatus,
  QuarantineReason,
  ReviewStatus,
} from "@savvyedge/database";
import { beforeEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WorkflowTransitionService,
  type ReviewTransitionCommand,
} from "../src/services/workflow-transition.service";
import { requireIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

declare const process: { env: Record<string, string | undefined> };

const databaseUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;
// Destructive suite (TRUNCATE ... CASCADE): the opt-in alone is not enough, the
// guard proves DATABASE_URL and DIRECT_URL resolve to the same isolated target.
const describeWithDatabase = requireIsolatedTestDatabase()
  ? describe
  : describe.skip;

const ids = {
  human: "10000000-0000-4000-8000-000000000001",
  service: "10000000-0000-4000-8000-000000000002",
  system: "10000000-0000-4000-8000-000000000003",
  migration: "10000000-0000-4000-8000-000000000004",
  inactiveHuman: "10000000-0000-4000-8000-000000000005",
  casinoA: "20000000-0000-4000-8000-000000000001",
  casinoB: "20000000-0000-4000-8000-000000000002",
  bonusA: "30000000-0000-4000-8000-000000000001",
  bonusB: "30000000-0000-4000-8000-000000000002",
  provider: "40000000-0000-4000-8000-000000000001",
  slotA: "50000000-0000-4000-8000-000000000001",
  slotB: "50000000-0000-4000-8000-000000000002",
  jurisdiction: "60000000-0000-4000-8000-000000000001",
  regulator: "70000000-0000-4000-8000-000000000001",
  licenseA: "80000000-0000-4000-8000-000000000001",
  licenseB: "80000000-0000-4000-8000-000000000002",
  dataSource: "90000000-0000-4000-8000-000000000001",
} as const;

type SubjectKind = "CASINO" | "BONUS" | "SLOT" | "LICENSE";

describeWithDatabase(
  "Slice 2.2B atomic workflow transitions",
  () => {
    let database: PrismaClient;
    let workflow: WorkflowTransitionService;
    let sequence = 0;

    const nextId = (prefix: string) => `${prefix}-${++sequence}`;

    const expectCode = async (
      promise: Promise<unknown>,
      code: string,
    ): Promise<void> => {
      await expect(promise).rejects.toMatchObject({
        name: "WorkflowTransitionError",
        code,
      });
    };

    const createClaim = async (
      subjectType: SubjectKind,
      subjectId: string,
      options: {
        verdict?: EvidenceVerdict;
        expiresAt?: Date | null;
        validFrom?: Date | null;
        sourceUrl?: string;
      } = {},
    ): Promise<string> => {
      const evidenceId = nextId("evidence");
      const claimId = nextId("claim");
      const now = new Date();

      await database.evidenceRecord.create({
        data: {
          id: evidenceId,
          data_source_id: ids.dataSource,
          evidence_type: EvidenceType.OPERATOR_PAGE,
          source_url:
            options.sourceUrl ?? "https://operator.example/evidence",
          observed_at: new Date(now.getTime() - 60_000),
          extracted_at: new Date(now.getTime() - 30_000),
          valid_from: options.validFrom ?? null,
          expires_at: options.expiresAt ?? null,
          created_by_id: ids.human,
        },
      });

      const common = {
        id: claimId,
        evidence_id: evidenceId,
        observed_value: "verified",
        normalized_value_hash: `normalizer-v1:${claimId}`,
        verdict: options.verdict ?? EvidenceVerdict.SUPPORTS,
      };
      if (subjectType === "CASINO") {
        await database.casinoEvidenceClaim.create({
          data: { ...common, casino_id: subjectId, field: "NAME" },
        });
      } else if (subjectType === "BONUS") {
        await database.bonusEvidenceClaim.create({
          data: { ...common, bonus_id: subjectId, field: "TYPE" },
        });
      } else if (subjectType === "SLOT") {
        await database.slotEvidenceClaim.create({
          data: { ...common, slot_id: subjectId, field: "NAME" },
        });
      } else {
        await database.licenseEvidenceClaim.create({
          data: {
            ...common,
            license_id: subjectId,
            field: "LICENSE_NUMBER",
          },
        });
      }
      return claimId;
    };

    const setCasinoState = async (
      reviewStatus: ReviewStatus,
      options: {
        version?: number;
        publicationStatus?: PublicationStatus;
        casinoId?: string;
        duplicateOfId?: string | null;
      } = {},
    ) => {
      const casinoId = options.casinoId ?? ids.casinoA;
      await database.casino.update({
        where: { id: casinoId },
        data: {
          review_status: reviewStatus,
          publication_status:
            options.publicationStatus ?? PublicationStatus.UNPUBLISHED,
          quarantine_reason:
            reviewStatus === ReviewStatus.QUARANTINED
              ? QuarantineReason.MANUAL_HOLD
              : null,
          duplicate_of_id:
            reviewStatus === ReviewStatus.SUPERSEDED
              ? (options.duplicateOfId ?? ids.casinoB)
              : null,
          governance_version: options.version ?? 0,
        },
      });
    };

    const setBonusState = async (
      reviewStatus: ReviewStatus,
      publicationStatus: PublicationStatus = PublicationStatus.UNPUBLISHED,
      version = 0,
    ) => {
      await database.bonus.update({
        where: { id: ids.bonusA },
        data: {
          review_status: reviewStatus,
          publication_status: publicationStatus,
          quarantine_reason:
            reviewStatus === ReviewStatus.QUARANTINED
              ? QuarantineReason.MANUAL_HOLD
              : null,
          duplicate_of_id:
            reviewStatus === ReviewStatus.SUPERSEDED ? ids.bonusB : null,
          governance_version: version,
        },
      });
    };

    const setSlotState = async (
      reviewStatus: ReviewStatus,
      publicationStatus: PublicationStatus = PublicationStatus.UNPUBLISHED,
      version = 0,
    ) => {
      await database.slot.update({
        where: { id: ids.slotA },
        data: {
          review_status: reviewStatus,
          publication_status: publicationStatus,
          quarantine_reason:
            reviewStatus === ReviewStatus.QUARANTINED
              ? QuarantineReason.MANUAL_HOLD
              : null,
          duplicate_of_id:
            reviewStatus === ReviewStatus.SUPERSEDED ? ids.slotB : null,
          governance_version: version,
        },
      });
    };

    const setLicenseState = async (
      licenseId: string,
      reviewStatus: ReviewStatus,
      version = 0,
    ) => {
      await database.license.update({
        where: { id: licenseId },
        data: {
          review_status: reviewStatus,
          quarantine_reason:
            reviewStatus === ReviewStatus.QUARANTINED
              ? QuarantineReason.MANUAL_HOLD
              : null,
          duplicate_of_id:
            reviewStatus === ReviewStatus.SUPERSEDED ? ids.licenseB : null,
          governance_version: version,
        },
      });
    };

    const approveLicense = async (licenseId: string): Promise<string> => {
      await setLicenseState(licenseId, ReviewStatus.IN_REVIEW);
      const claimId = await createClaim("LICENSE", licenseId);
      await workflow.transitionLicenseReview({
        subjectId: licenseId,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [claimId],
      });
      return claimId;
    };

    beforeAll(() => {
      database = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
      workflow = new WorkflowTransitionService(database);
    });

    afterAll(async () => {
      await database?.$disconnect();
    });

    beforeEach(async () => {
      sequence = 0;
      await database.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "fail_workflow_claim_insert"() CASCADE`,
      );
      await database.$executeRawUnsafe(
        `ALTER TABLE "CasinoEvidenceClaim" ENABLE TRIGGER ALL`,
      );
      await database.$executeRawUnsafe(
        `TRUNCATE
          "WorkflowEventClaim",
          "WorkflowAuditEvent",
          "CasinoDomain",
          "CasinoEvidenceClaim",
          "BonusEvidenceClaim",
          "SlotEvidenceClaim",
          "LicenseEvidenceClaim",
          "EvidenceRecord",
          "ReviewActor",
          "DataSource",
          "License",
          "Regulator",
          "Jurisdiction",
          "Bonus",
          "CasinoSlot",
          "Slot",
          "Provider",
          "Casino"
        RESTART IDENTITY CASCADE`,
      );

      await database.reviewActor.createMany({
        data: [
          {
            id: ids.human,
            kind: ActorKind.HUMAN,
            stable_key: "human:reviewer",
            display_name: "Reviewer",
          },
          {
            id: ids.service,
            kind: ActorKind.SERVICE,
            stable_key: "service:ingestion",
            display_name: "Ingestion",
          },
          {
            id: ids.system,
            kind: ActorKind.SYSTEM,
            stable_key: "system:safety",
            display_name: "Safety System",
          },
          {
            id: ids.migration,
            kind: ActorKind.MIGRATION,
            stable_key: "migration:legacy",
            display_name: "Legacy Migration",
          },
          {
            id: ids.inactiveHuman,
            kind: ActorKind.HUMAN,
            stable_key: "human:inactive",
            display_name: "Inactive Reviewer",
            active: false,
          },
        ],
      });
      await database.casino.createMany({
        data: [
          {
            id: ids.casinoA,
            slug: "workflow-casino-a",
            name: "Workflow Casino A",
            status: "ACTIVE",
          },
          {
            id: ids.casinoB,
            slug: "workflow-casino-b",
            name: "Workflow Casino B",
            status: "ACTIVE",
          },
        ],
      });
      await database.bonus.createMany({
        data: [
          {
            id: ids.bonusA,
            casino_id: ids.casinoA,
            type: "WELCOME",
            status: "ACTIVE",
          },
          {
            id: ids.bonusB,
            casino_id: ids.casinoB,
            type: "WELCOME",
            status: "ACTIVE",
          },
        ],
      });
      await database.provider.create({
        data: {
          id: ids.provider,
          slug: "workflow-provider",
          name: "Workflow Provider",
        },
      });
      await database.slot.createMany({
        data: [
          {
            id: ids.slotA,
            slug: "workflow-slot-a",
            name: "Workflow Slot A",
            provider_id: ids.provider,
          },
          {
            id: ids.slotB,
            slug: "workflow-slot-b",
            name: "Workflow Slot B",
            provider_id: ids.provider,
          },
        ],
      });
      await database.jurisdiction.create({
        data: {
          id: ids.jurisdiction,
          slug: "workflow-jurisdiction",
          name: "Workflow Jurisdiction",
        },
      });
      await database.regulator.create({
        data: {
          id: ids.regulator,
          slug: "workflow-regulator",
          name: "Workflow Regulator",
          jurisdiction_id: ids.jurisdiction,
        },
      });
      await database.license.createMany({
        data: [
          {
            id: ids.licenseA,
            casino_id: ids.casinoA,
            regulator_id: ids.regulator,
            license_no: "WF-A",
            status: "ACTIVE",
          },
          {
            id: ids.licenseB,
            casino_id: ids.casinoA,
            regulator_id: ids.regulator,
            license_no: "WF-B",
            status: "ACTIVE",
          },
        ],
      });
      await database.dataSource.create({
        data: {
          id: ids.dataSource,
          url: "https://operator.example",
          source_type: "OPERATOR",
        },
      });
    });

    it.each([
      [ReviewStatus.NEW, ReviewStatus.AWAITING_REVIEW],
      [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW],
      [ReviewStatus.IN_REVIEW, ReviewStatus.APPROVED],
      [ReviewStatus.IN_REVIEW, ReviewStatus.REJECTED],
      [ReviewStatus.APPROVED, ReviewStatus.REJECTED],
      [ReviewStatus.REJECTED, ReviewStatus.AWAITING_REVIEW],
    ] as const)("applies allowed Casino transition %s -> %s", async (from, to) => {
      await setCasinoState(from);
      const claimIds =
        to === ReviewStatus.APPROVED
          ? [await createClaim("CASINO", ids.casinoA)]
          : [];

      const result = await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: to,
        claimIds,
      });

      expect(result.reviewStatus).toBe(to);
      expect(result.governanceVersion).toBe(1);
      const persisted = await database.casino.findUniqueOrThrow({
        where: { id: ids.casinoA },
      });
      expect(persisted.review_status).toBe(to);
      expect(persisted.governance_version).toBe(1);
    });

    it("rejects illegal and same-state transitions", async () => {
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
        }),
        "INVALID_TRANSITION",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.NEW,
        }),
        "SAME_STATE_CONFLICT",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: "missing-subject",
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
        "SUBJECT_NOT_FOUND",
      );
    });

    it("requires a reason for quarantine and explicit clearance", async () => {
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.QUARANTINED,
        }),
        "QUARANTINE_REASON_REQUIRED",
      );

      await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.QUARANTINED,
        quarantineReason: QuarantineReason.MANUAL_HOLD,
      });
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 1,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
        "QUARANTINE_CLEARANCE_REQUIRED",
      );
      const cleared = await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 1,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        internalReason: "Cleared after review",
      });
      expect(cleared.reviewStatus).toBe(ReviewStatus.AWAITING_REVIEW);
      expect(
        (
          await database.casino.findUniqueOrThrow({
            where: { id: ids.casinoA },
          })
        ).quarantine_reason,
      ).toBeNull();
    });

    it("stores exact supersession state, version and canonical target", async () => {
      await setCasinoState(ReviewStatus.APPROVED, {
        casinoId: ids.casinoB,
      });
      const result = await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.SUPERSEDED,
        canonicalTargetId: ids.casinoB,
      });

      const event = await database.workflowAuditEvent.findUniqueOrThrow({
        where: { id: result.workflowEventId },
      });
      expect(event).toMatchObject({
        subject_type: "CASINO",
        casino_id: ids.casinoA,
        event_type: "SUPERSEDED",
        from_review_status: "NEW",
        to_review_status: "SUPERSEDED",
        expected_version: 0,
        resulting_version: 1,
        canonical_casino_id: ids.casinoB,
        canonical_bonus_id: null,
        canonical_slot_id: null,
        canonical_license_id: null,
      });
    });

    it("distinguishes missing, wrong-type, self and ineligible canonical targets", async () => {
      const base: ReviewTransitionCommand = {
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.SUPERSEDED,
      };
      await expectCode(
        workflow.transitionCasinoReview(base),
        "CANONICAL_TARGET_REQUIRED",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          ...base,
          canonicalTargetId: "missing-canonical",
        }),
        "CANONICAL_TARGET_NOT_FOUND",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          ...base,
          canonicalTargetId: ids.bonusA,
        }),
        "CANONICAL_TARGET_TYPE_MISMATCH",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          ...base,
          canonicalTargetId: ids.casinoA,
        }),
        "CANONICAL_TARGET_SELF_REFERENCE",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          ...base,
          canonicalTargetId: ids.casinoB,
        }),
        "CANONICAL_TARGET_INELIGIBLE",
      );
    });

    it("approves Casino, Bonus, Slot and License with exact subject claims", async () => {
      await setCasinoState(ReviewStatus.IN_REVIEW);
      await setBonusState(ReviewStatus.IN_REVIEW);
      await setSlotState(ReviewStatus.IN_REVIEW);
      await setLicenseState(ids.licenseA, ReviewStatus.IN_REVIEW);

      const cases = [
        {
          kind: "CASINO" as const,
          subjectId: ids.casinoA,
          claimId: await createClaim("CASINO", ids.casinoA),
          run: (claimId: string) =>
            workflow.transitionCasinoReview({
              subjectId: ids.casinoA,
              actorId: ids.human,
              expectedVersion: 0,
              toStatus: ReviewStatus.APPROVED,
              claimIds: [claimId],
            }),
        },
        {
          kind: "BONUS" as const,
          subjectId: ids.bonusA,
          claimId: await createClaim("BONUS", ids.bonusA),
          run: (claimId: string) =>
            workflow.transitionBonusReview({
              subjectId: ids.bonusA,
              actorId: ids.human,
              expectedVersion: 0,
              toStatus: ReviewStatus.APPROVED,
              claimIds: [claimId],
            }),
        },
        {
          kind: "SLOT" as const,
          subjectId: ids.slotA,
          claimId: await createClaim("SLOT", ids.slotA),
          run: (claimId: string) =>
            workflow.transitionSlotReview({
              subjectId: ids.slotA,
              actorId: ids.human,
              expectedVersion: 0,
              toStatus: ReviewStatus.APPROVED,
              claimIds: [claimId],
            }),
        },
        {
          kind: "LICENSE" as const,
          subjectId: ids.licenseA,
          claimId: await createClaim("LICENSE", ids.licenseA),
          run: (claimId: string) =>
            workflow.transitionLicenseReview({
              subjectId: ids.licenseA,
              actorId: ids.human,
              expectedVersion: 0,
              toStatus: ReviewStatus.APPROVED,
              claimIds: [claimId],
            }),
        },
      ];

      for (const testCase of cases) {
        const result = await testCase.run(testCase.claimId);
        const links = await database.workflowEventClaim.findMany({
          where: { workflow_event_id: result.workflowEventId },
        });
        expect(links).toHaveLength(1);
        expect(
          links[0]?.casino_evidence_claim_id ??
            links[0]?.bonus_evidence_claim_id ??
            links[0]?.slot_evidence_claim_id ??
            links[0]?.license_evidence_claim_id,
        ).toBe(testCase.claimId);
      }
    });

    it("distinguishes missing, wrong-model and wrong-subject claims", async () => {
      await setCasinoState(ReviewStatus.IN_REVIEW);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: ["missing-claim"],
        }),
        "CLAIM_NOT_FOUND",
      );

      const bonusClaim = await createClaim("BONUS", ids.bonusA);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [bonusClaim],
        }),
        "CLAIM_TYPE_MISMATCH",
      );

      const otherCasinoClaim = await createClaim("CASINO", ids.casinoB);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [otherCasinoClaim],
        }),
        "CLAIM_SUBJECT_MISMATCH",
      );
    });

    it("rejects an orphaned claim with a missing EvidenceRecord", async () => {
      await setCasinoState(ReviewStatus.IN_REVIEW);
      await database.$executeRawUnsafe(
        `ALTER TABLE "CasinoEvidenceClaim" DISABLE TRIGGER ALL`,
      );
      try {
        await database.$executeRawUnsafe(
          `INSERT INTO "CasinoEvidenceClaim" (
            "id",
            "evidence_id",
            "casino_id",
            "field",
            "observed_value",
            "normalized_value_hash",
            "verdict"
          ) VALUES (
            'orphan-claim',
            'missing-evidence',
            $1,
            'NAME',
            'orphan',
            'normalizer-v1:orphan',
            'SUPPORTS'
          )`,
          ids.casinoA,
        );
      } finally {
        await database.$executeRawUnsafe(
          `ALTER TABLE "CasinoEvidenceClaim" ENABLE TRIGGER ALL`,
        );
      }

      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: ["orphan-claim"],
        }),
        "EVIDENCE_RECORD_NOT_FOUND",
      );
    });

    it("rejects expired, contradictory, inconclusive and duplicate claims", async () => {
      await setCasinoState(ReviewStatus.IN_REVIEW);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
        }),
        "EVIDENCE_INELIGIBLE",
      );
      const expired = await createClaim("CASINO", ids.casinoA, {
        expiresAt: new Date(Date.now() - 1),
      });
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [expired],
        }),
        "EVIDENCE_EXPIRED",
      );

      const contradictory = await createClaim("CASINO", ids.casinoA, {
        verdict: EvidenceVerdict.CONTRADICTS,
      });
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [contradictory],
        }),
        "EVIDENCE_CONTRADICTORY",
      );

      const inconclusive = await createClaim("CASINO", ids.casinoA, {
        verdict: EvidenceVerdict.INCONCLUSIVE,
      });
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [inconclusive],
        }),
        "EVIDENCE_INELIGIBLE",
      );

      const duplicate = await createClaim("CASINO", ids.casinoA);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [duplicate, duplicate],
        }),
        "DUPLICATE_CLAIM_ID",
      );
    });

    it("publishes and explicitly unpublishes with immutable audit history", async () => {
      await setBonusState(ReviewStatus.APPROVED);
      const claimId = await createClaim("BONUS", ids.bonusA);
      const published = await workflow.transitionBonusPublication({
        subjectId: ids.bonusA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: PublicationStatus.PUBLISHED,
        claimIds: [claimId],
      });
      expect(published.publicationStatus).toBe(PublicationStatus.PUBLISHED);

      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.human,
          expectedVersion: 1,
          toStatus: PublicationStatus.UNPUBLISHED,
        }),
        "PUBLICATION_REASON_REQUIRED",
      );
      const unpublished = await workflow.transitionBonusPublication({
        subjectId: ids.bonusA,
        actorId: ids.human,
        expectedVersion: 1,
        toStatus: PublicationStatus.UNPUBLISHED,
        reason: "Corrective withdrawal",
      });
      const event = await database.workflowAuditEvent.findUniqueOrThrow({
        where: { id: unpublished.workflowEventId },
      });
      expect(event).toMatchObject({
        event_type: "UNPUBLISHED",
        from_publication_status: "PUBLISHED",
        to_publication_status: "UNPUBLISHED",
        expected_version: 1,
        resulting_version: 2,
        internal_note: "Corrective withdrawal",
      });
    });

    it("publishes Slot with eligible subject evidence", async () => {
      await setSlotState(ReviewStatus.APPROVED);
      const claimId = await createClaim("SLOT", ids.slotA);
      const result = await workflow.transitionSlotPublication({
        subjectId: ids.slotA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: PublicationStatus.PUBLISHED,
        claimIds: [claimId],
      });

      expect(result).toMatchObject({
        reviewStatus: "APPROVED",
        publicationStatus: "PUBLISHED",
        governanceVersion: 1,
      });
    });

    it("rejects publication without approval or while quarantined or superseded", async () => {
      const claimId = await createClaim("BONUS", ids.bonusA);
      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus:
            "WITHDRAWN" as unknown as PublicationStatus,
          claimIds: [claimId],
        }),
        "INVALID_TRANSITION",
      );
      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [claimId],
        }),
        "APPROVAL_REQUIRED",
      );

      await setBonusState(ReviewStatus.QUARANTINED);
      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [claimId],
        }),
        "PUBLICATION_BLOCKED",
      );

      await setBonusState(ReviewStatus.SUPERSEDED);
      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [claimId],
        }),
        "PUBLICATION_BLOCKED",
      );
    });

    it.each([
      [ReviewStatus.REJECTED, undefined],
      [ReviewStatus.QUARANTINED, QuarantineReason.MANUAL_HOLD],
      [ReviewStatus.SUPERSEDED, undefined],
    ] as const)(
      "automatically unpublishes when review becomes %s",
      async (toStatus, quarantineReason) => {
        await setCasinoState(ReviewStatus.APPROVED, {
          publicationStatus: PublicationStatus.PUBLISHED,
        });
        if (toStatus === ReviewStatus.SUPERSEDED) {
          await setCasinoState(ReviewStatus.APPROVED, {
            casinoId: ids.casinoB,
          });
        }

        const result = await workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus,
          quarantineReason,
          canonicalTargetId:
            toStatus === ReviewStatus.SUPERSEDED ? ids.casinoB : undefined,
        });
        expect(result.publicationStatus).toBe(
          PublicationStatus.UNPUBLISHED,
        );
        const event = await database.workflowAuditEvent.findUniqueOrThrow({
          where: { id: result.workflowEventId },
        });
        expect(event).toMatchObject({
          from_publication_status: "PUBLISHED",
          to_publication_status: "UNPUBLISHED",
        });
      },
    );

    it("automatically unpublishes through the Bonus and Slot review branches", async () => {
      await setBonusState(
        ReviewStatus.APPROVED,
        PublicationStatus.PUBLISHED,
      );
      await setSlotState(
        ReviewStatus.APPROVED,
        PublicationStatus.PUBLISHED,
      );

      const rejectedBonus = await workflow.transitionBonusReview({
        subjectId: ids.bonusA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.REJECTED,
      });
      const quarantinedSlot = await workflow.transitionSlotReview({
        subjectId: ids.slotA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.QUARANTINED,
        quarantineReason: QuarantineReason.MANUAL_HOLD,
      });

      expect(rejectedBonus.publicationStatus).toBe(
        PublicationStatus.UNPUBLISHED,
      );
      expect(quarantinedSlot.publicationStatus).toBe(
        PublicationStatus.UNPUBLISHED,
      );
    });

    it("publishes a Casino with exactly one eligible License and never links its License claim", async () => {
      const licenseClaimId = await approveLicense(ids.licenseA);
      await setCasinoState(ReviewStatus.APPROVED);
      const casinoClaimId = await createClaim("CASINO", ids.casinoA);

      const result = await workflow.transitionCasinoPublication({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: PublicationStatus.PUBLISHED,
        claimIds: [casinoClaimId],
      });
      const links = await database.workflowEventClaim.findMany({
        where: { workflow_event_id: result.workflowEventId },
      });
      expect(links).toEqual([
        expect.objectContaining({
          casino_evidence_claim_id: casinoClaimId,
          bonus_evidence_claim_id: null,
          slot_evidence_claim_id: null,
          license_evidence_claim_id: null,
        }),
      ]);
      expect(
        links.some(
          (link) => link.license_evidence_claim_id === licenseClaimId,
        ),
      ).toBe(false);
    });

    it("rejects a stale License approval event after a later audit event", async () => {
      await approveLicense(ids.licenseA);
      await workflow.transitionLicenseReview({
        subjectId: ids.licenseA,
        actorId: ids.human,
        expectedVersion: 1,
        toStatus: ReviewStatus.REJECTED,
      });

      // Simulate current-state drift without inventing immutable history. The
      // version-1 approval must not authorize the version-2 License state.
      await database.license.update({
        where: { id: ids.licenseA },
        data: { review_status: ReviewStatus.APPROVED },
      });
      await setCasinoState(ReviewStatus.APPROVED);
      const casinoClaimId = await createClaim("CASINO", ids.casinoA);

      await expectCode(
        workflow.transitionCasinoPublication({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [casinoClaimId],
        }),
        "ELIGIBLE_LICENSE_REQUIRED",
      );
    });

    it("fails Casino publication with zero or multiple eligible Licenses", async () => {
      await setCasinoState(ReviewStatus.APPROVED);
      const casinoClaimId = await createClaim("CASINO", ids.casinoA);

      await expectCode(
        workflow.transitionCasinoPublication({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [casinoClaimId],
        }),
        "ELIGIBLE_LICENSE_REQUIRED",
      );

      await approveLicense(ids.licenseA);
      await approveLicense(ids.licenseB);
      await expectCode(
        workflow.transitionCasinoPublication({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [casinoClaimId],
        }),
        "ELIGIBLE_LICENSE_AMBIGUOUS",
      );
    });

    it("enforces HUMAN, SERVICE, SYSTEM, MIGRATION and inactive-actor authorization", async () => {
      await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.service,
        expectedVersion: 0,
        toStatus: ReviewStatus.AWAITING_REVIEW,
      });
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.service,
          expectedVersion: 1,
          toStatus: ReviewStatus.IN_REVIEW,
        }),
        "ACTOR_NOT_AUTHORIZED",
      );

      await setBonusState(
        ReviewStatus.APPROVED,
        PublicationStatus.PUBLISHED,
      );
      await expectCode(
        workflow.transitionBonusPublication({
          subjectId: ids.bonusA,
          actorId: ids.system,
          expectedVersion: 0,
          toStatus: PublicationStatus.UNPUBLISHED,
          reason: "Safety withdrawal",
        }),
        "ACTOR_NOT_AUTHORIZED",
      );
      await workflow.transitionBonusPublication({
        subjectId: ids.bonusA,
        actorId: ids.system,
        expectedVersion: 0,
        toStatus: PublicationStatus.UNPUBLISHED,
        reason: "Safety withdrawal",
        internalReason: "Automated safety rule",
      });

      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoB,
          actorId: ids.system,
          expectedVersion: 0,
          toStatus: ReviewStatus.QUARANTINED,
          quarantineReason: QuarantineReason.MANUAL_HOLD,
        }),
        "ACTOR_NOT_AUTHORIZED",
      );
      await workflow.transitionCasinoReview({
        subjectId: ids.casinoB,
        actorId: ids.system,
        expectedVersion: 0,
        toStatus: ReviewStatus.QUARANTINED,
        quarantineReason: QuarantineReason.MANUAL_HOLD,
        internalReason: "Automated identity safety rule",
      });

      await expectCode(
        workflow.transitionBonusReview({
          subjectId: ids.bonusB,
          actorId: ids.migration,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
        "ACTOR_NOT_AUTHORIZED",
      );
      await expectCode(
        workflow.transitionSlotReview({
          subjectId: ids.slotB,
          actorId: ids.inactiveHuman,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
        "ACTOR_NOT_AUTHORIZED",
      );
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: "missing-actor",
          expectedVersion: 1,
          toStatus: ReviewStatus.IN_REVIEW,
        }),
        "ACTOR_NOT_FOUND",
      );
    });

    it("keeps License review-only at the service API boundary", () => {
      expect(workflow).not.toHaveProperty("transitionLicensePublication");
    });

    it("rolls back subject, audit and links after a deliberately late failure", async () => {
      await setCasinoState(ReviewStatus.IN_REVIEW);
      const claimId = await createClaim("CASINO", ids.casinoA);
      await database.$executeRawUnsafe(`
        CREATE FUNCTION "fail_workflow_claim_insert"()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'deliberate late link failure';
        END;
        $$
      `);
      await database.$executeRawUnsafe(`
        CREATE TRIGGER "fail_workflow_claim_insert_trigger"
        BEFORE INSERT ON "WorkflowEventClaim"
        FOR EACH ROW
        EXECUTE FUNCTION "fail_workflow_claim_insert"()
      `);

      try {
        await expect(
          workflow.transitionCasinoReview({
            subjectId: ids.casinoA,
            actorId: ids.human,
            expectedVersion: 0,
            toStatus: ReviewStatus.APPROVED,
            claimIds: [claimId],
          }),
        ).rejects.toThrow();
      } finally {
        await database.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "fail_workflow_claim_insert"() CASCADE`,
        );
      }

      const subject = await database.casino.findUniqueOrThrow({
        where: { id: ids.casinoA },
      });
      expect(subject).toMatchObject({
        review_status: "IN_REVIEW",
        governance_version: 0,
      });
      expect(await database.workflowAuditEvent.count()).toBe(0);
      expect(await database.workflowEventClaim.count()).toBe(0);
    });

    it("rejects stale versions and increments governance_version exactly once", async () => {
      const result = await workflow.transitionCasinoReview({
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.AWAITING_REVIEW,
      });
      expect(result.governanceVersion).toBe(1);
      await expectCode(
        workflow.transitionCasinoReview({
          subjectId: ids.casinoA,
          actorId: ids.human,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
        "STALE_GOVERNANCE_VERSION",
      );
      expect(
        (
          await database.casino.findUniqueOrThrow({
            where: { id: ids.casinoA },
          })
        ).governance_version,
      ).toBe(1);
    });

    it("allows at most one concurrent command for the same expected version", async () => {
      const command = {
        subjectId: ids.casinoA,
        actorId: ids.human,
        expectedVersion: 0,
        toStatus: ReviewStatus.AWAITING_REVIEW,
      } as const;
      const results = await Promise.allSettled([
        workflow.transitionCasinoReview(command),
        workflow.transitionCasinoReview(command),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      const rejected = results.find((result) => result.status === "rejected");
      expect(
        rejected && "reason" in rejected ? rejected.reason : undefined,
      ).toMatchObject({ code: "STALE_GOVERNANCE_VERSION" });
      expect(await database.workflowAuditEvent.count()).toBe(1);
      expect(
        (
          await database.casino.findUniqueOrThrow({
            where: { id: ids.casinoA },
          })
        ).governance_version,
      ).toBe(1);
    });
  },
  60_000,
);
