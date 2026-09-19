import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActorKind,
  EvidenceVerdict,
  GovernedSubjectType,
  PublicationStatus,
  ReviewStatus,
} from "@savvyedge/database";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";
import {
  activeBonusEvidence,
  activeBonusExtractionKey,
} from "./helpers/active-bonus-evidence.fixture";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const BONUS_ID = "bonus-publication-authority";
const ACTOR_ID = "human-reviewer";
const ACTIVE_EVIDENCE_ID = "active-evidence";
const ACTIVE_EXTRACTION_KEY = activeBonusExtractionKey(
  `${BONUS_ID}:${ACTIVE_EVIDENCE_ID}`,
);
const ACTIVE_CLAIM_ID = "active-claim";

type BonusDbOptions = {
  observedAt?: Date;
  verifiedAt?: Date | null;
  extractedAt?: Date | null;
  expiresAt?: Date | null;
  sourceUrl?: string;
  pointers?: any[];
  activeVerdict?: EvidenceVerdict;
  suppliedClaimEvidenceId?: string;
};

function bonusPublicationDb(options: BonusDbOptions = {}) {
  const observedAt = options.observedAt ?? new Date(NOW.getTime() - 60_000);
  const verifiedAt =
    options.verifiedAt === undefined ? observedAt : options.verifiedAt;
  const extractedAt =
    options.extractedAt === undefined ? observedAt : options.extractedAt;
  const sourceUrl =
    options.sourceUrl ?? "https://operator.example.test/bonus-terms";
  const suppliedClaimEvidenceId =
    options.suppliedClaimEvidenceId ?? ACTIVE_EVIDENCE_ID;
  const pointer = activeBonusEvidence({
    bonusId: BONUS_ID,
    observedAt,
    extractedAt: extractedAt ?? observedAt,
    expiresAt: options.expiresAt,
    sourceUrl,
    evidenceId: ACTIVE_EVIDENCE_ID,
    extractionKey: ACTIVE_EXTRACTION_KEY,
    verdict: options.activeVerdict ?? EvidenceVerdict.SUPPORTS,
  })[0];
  if (extractedAt === null) {
    pointer.evidence!.extracted_at = null as never;
  }

  const claim = {
    id: ACTIVE_CLAIM_ID,
    bonus_id: BONUS_ID,
    evidence_id: suppliedClaimEvidenceId,
    verdict: EvidenceVerdict.SUPPORTS,
  };
  const claimEvidence = {
    id: suppliedClaimEvidenceId,
    source_url: sourceUrl,
    observed_at: observedAt,
    extracted_at: extractedAt ?? observedAt,
    valid_from: null,
    expires_at: options.expiresAt ?? null,
  };

  const db: any = {
    reviewActor: {
      findUnique: vi.fn().mockResolvedValue({
        id: ACTOR_ID,
        kind: ActorKind.HUMAN,
        active: true,
      }),
    },
    bonus: {
      findUnique: vi.fn().mockResolvedValue({
        id: BONUS_ID,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: null,
        governance_version: 7,
        duplicate_of_id: null,
        verified_at: verifiedAt,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bonusEvidenceClaim: {
      findMany: vi.fn().mockResolvedValue([claim]),
      findUnique: vi.fn(),
    },
    casinoEvidenceClaim: { findUnique: vi.fn() },
    slotEvidenceClaim: { findUnique: vi.fn() },
    licenseEvidenceClaim: { findUnique: vi.fn() },
    evidenceRecord: {
      findMany: vi.fn().mockResolvedValue([claimEvidence]),
    },
    activeExtractionPointer: {
      findMany: vi.fn().mockResolvedValue(options.pointers ?? [pointer]),
    },
    workflowAuditEvent: {
      create: vi.fn().mockResolvedValue({ id: "publication-event" }),
    },
    workflowEventClaim: {
      create: vi.fn().mockResolvedValue({ id: "publication-event-link" }),
    },
  };
  return { db, pointer };
}

async function publishBonus(db: any) {
  const service = new WorkflowTransitionService(db);
  return service.transitionBonusPublication({
    subjectId: BONUS_ID,
    actorId: ACTOR_ID,
    expectedVersion: 7,
    toStatus: PublicationStatus.PUBLISHED,
    claimIds: [ACTIVE_CLAIM_ID],
  });
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({
    name: "WorkflowTransitionError",
    code,
  });
}

describe("D3C WorkflowTransitionService BONUS publication authority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["missing pointer", { pointers: [] }, "EVIDENCE_INELIGIBLE"],
    [
      "missing evidence",
      {
        pointers: activeBonusEvidence({
          bonusId: BONUS_ID,
          observedAt: NOW,
          evidenceId: ACTIVE_EVIDENCE_ID,
          extractionKey: ACTIVE_EXTRACTION_KEY,
          withoutEvidence: true,
        }),
      },
      "EVIDENCE_RECORD_NOT_FOUND",
    ],
    [
      "mismatched pointer and evidence identities",
      {
        pointers: activeBonusEvidence({
          bonusId: BONUS_ID,
          observedAt: NOW,
          evidenceId: ACTIVE_EVIDENCE_ID,
          extractionKey: ACTIVE_EXTRACTION_KEY,
          pointerEvidenceId: "different-evidence",
        }),
      },
      "EVIDENCE_RECORD_NOT_FOUND",
    ],
    [
      "mismatched pointer and evidence data-source identities",
      {
        pointers: activeBonusEvidence({
          bonusId: BONUS_ID,
          observedAt: NOW,
          evidenceId: ACTIVE_EVIDENCE_ID,
          extractionKey: ACTIVE_EXTRACTION_KEY,
          pointerDataSourceId: "different-data-source",
        }),
      },
      "EVIDENCE_RECORD_NOT_FOUND",
    ],
    [
      "foreign-Bonus pointer identity",
      {
        pointers: activeBonusEvidence({
          bonusId: BONUS_ID,
          observedAt: NOW,
          evidenceId: ACTIVE_EVIDENCE_ID,
          extractionKey: ACTIVE_EXTRACTION_KEY,
          pointerBonusId: "bonus-foreign",
        }),
      },
      "EVIDENCE_RECORD_NOT_FOUND",
    ],
    [
      "ambiguous active pointers",
      {
        pointers: [
          ...activeBonusEvidence({
            bonusId: BONUS_ID,
            observedAt: NOW,
            evidenceId: ACTIVE_EVIDENCE_ID,
            extractionKey: ACTIVE_EXTRACTION_KEY,
          }),
          ...activeBonusEvidence({
            bonusId: BONUS_ID,
            observedAt: NOW,
            evidenceId: "second-evidence",
            extractionKey: "second-extraction",
          }),
        ],
      },
      "EVIDENCE_INELIGIBLE",
    ],
    [
      "stale observation",
      { observedAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000 - 1) },
      "EVIDENCE_INELIGIBLE",
    ],
    [
      "future observation",
      { observedAt: new Date(NOW.getTime() + 1) },
      "EVIDENCE_INELIGIBLE",
    ],
    ["expired evidence", { expiresAt: NOW }, "EVIDENCE_EXPIRED"],
    [
      "historical-only support",
      { activeVerdict: EvidenceVerdict.CONTRADICTS },
      "EVIDENCE_INELIGIBLE",
    ],
    [
      "projection mismatch",
      { verifiedAt: new Date(NOW.getTime() - 2_000) },
      "EVIDENCE_INELIGIBLE",
    ],
    [
      "invalid source",
      { sourceUrl: "file:///tmp/bonus.html" },
      "EVIDENCE_INELIGIBLE",
    ],
  ] as const)("rejects %s", async (_label, options, code) => {
    const { db } = bonusPublicationDb(options);
    await expectCode(publishBonus(db), code);
    expect(db.bonus.updateMany).not.toHaveBeenCalled();
    expect(db.workflowAuditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a relied-upon historical claim even when active evidence is fresh", async () => {
    const { db } = bonusPublicationDb({
      suppliedClaimEvidenceId: "historical-evidence",
    });
    await expectCode(publishBonus(db), "EVIDENCE_INELIGIBLE");
    expect(db.bonus.updateMany).not.toHaveBeenCalled();
  });

  it("rejects approval of a claim superseded by the active extraction", async () => {
    const { db } = bonusPublicationDb({
      suppliedClaimEvidenceId: "historical-evidence",
    });
    db.bonus.findUnique.mockResolvedValue({
      id: BONUS_ID,
      review_status: ReviewStatus.IN_REVIEW,
      publication_status: PublicationStatus.UNPUBLISHED,
      quarantine_reason: null,
      governance_version: 7,
      duplicate_of_id: null,
    });

    const service = new WorkflowTransitionService(db);
    await expectCode(
      service.transitionBonusReview({
        subjectId: BONUS_ID,
        actorId: ACTOR_ID,
        expectedVersion: 7,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [ACTIVE_CLAIM_ID],
      }),
      "EVIDENCE_INELIGIBLE",
    );

    expect(db.bonus.updateMany).not.toHaveBeenCalled();
    expect(db.workflowAuditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a matching but malformed extraction identity before publication", async () => {
    const { db, pointer } = bonusPublicationDb();
    pointer.contract_version = "extraction-v2";
    pointer.extraction_key = "active-extraction";
    pointer.evidence!.extraction_key = "active-extraction";

    await expectCode(publishBonus(db), "EVIDENCE_INELIGIBLE");
    expect(db.bonus.updateMany).not.toHaveBeenCalled();
    expect(db.workflowAuditEvent.create).not.toHaveBeenCalled();
    expect(db.workflowEventClaim.create).not.toHaveBeenCalled();
  });

  it("publishes with one active observation, an exact projection, and active claims", async () => {
    const { db } = bonusPublicationDb();
    const result = await publishBonus(db);

    expect(result).toMatchObject({
      subjectId: BONUS_ID,
      reviewStatus: ReviewStatus.APPROVED,
      publicationStatus: PublicationStatus.PUBLISHED,
      governanceVersion: 8,
    });
    expect(db.activeExtractionPointer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bonus_id: BONUS_ID,
          extraction_context: "BONUS",
        },
      }),
    );
    const pointerSelect = vi.mocked(db.activeExtractionPointer.findMany).mock
      .calls[0][0].select;
    expect(pointerSelect).toMatchObject({
      extraction_context: true,
      bonus_id: true,
      data_source_id: true,
      evidence_id: true,
      extraction_key: true,
      contract_version: true,
      evidence: { select: { id: true, data_source_id: true } },
    });
    expect(db.bonus.updateMany).toHaveBeenCalledOnce();
    expect(db.workflowAuditEvent.create).toHaveBeenCalledOnce();
    expect(db.workflowEventClaim.create).toHaveBeenCalledOnce();
  });
});

describe("D3C non-BONUS publication semantics remain unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [GovernedSubjectType.CASINO, "casino", "casinoEvidenceClaim"],
    [GovernedSubjectType.SLOT, "slot", "slotEvidenceClaim"],
  ] as const)(
    "publishes an eligible %s without consulting BONUS pointers",
    async (subjectType, subjectClient, claimClient) => {
      const subjectId = `${subjectType.toLowerCase()}-subject`;
      const claimId = `${subjectType.toLowerCase()}-claim`;
      const db: any = {
        reviewActor: {
          findUnique: vi.fn().mockResolvedValue({
            id: ACTOR_ID,
            kind: ActorKind.HUMAN,
            active: true,
          }),
        },
        [subjectClient]: {
          findUnique: vi.fn().mockResolvedValue({
            id: subjectId,
            review_status: ReviewStatus.APPROVED,
            publication_status: PublicationStatus.UNPUBLISHED,
            quarantine_reason: null,
            governance_version: 3,
            duplicate_of_id: null,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        [claimClient]: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: claimId,
              [`${subjectClient}_id`]: subjectId,
              evidence_id: "shared-evidence",
              verdict: EvidenceVerdict.SUPPORTS,
            },
          ]),
        },
        evidenceRecord: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "shared-evidence",
              source_url: "https://operator.example.test/evidence",
              observed_at: NOW,
              extracted_at: NOW,
              valid_from: null,
              expires_at: null,
            },
          ]),
        },
        activeExtractionPointer: {
          findMany: vi.fn(() => {
            throw new Error("BONUS active evidence must not be consulted");
          }),
        },
        workflowAuditEvent: {
          create: vi.fn().mockResolvedValue({ id: "publication-event" }),
        },
        workflowEventClaim: {
          create: vi.fn().mockResolvedValue({ id: "publication-link" }),
        },
      };
      const service = new WorkflowTransitionService(db);
      if (subjectType === GovernedSubjectType.CASINO) {
        vi.spyOn(
          service as any,
          "requireOneEligibleCasinoLicense",
        ).mockResolvedValue(undefined);
      }

      const result =
        subjectType === GovernedSubjectType.CASINO
          ? await service.transitionCasinoPublication({
              subjectId,
              actorId: ACTOR_ID,
              expectedVersion: 3,
              toStatus: PublicationStatus.PUBLISHED,
              claimIds: [claimId],
            })
          : await service.transitionSlotPublication({
              subjectId,
              actorId: ACTOR_ID,
              expectedVersion: 3,
              toStatus: PublicationStatus.PUBLISHED,
              claimIds: [claimId],
            });

      expect(result.publicationStatus).toBe(PublicationStatus.PUBLISHED);
      expect(db.activeExtractionPointer.findMany).not.toHaveBeenCalled();
    },
  );
});
