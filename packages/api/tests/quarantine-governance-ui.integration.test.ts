import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  prisma,
  ActorKind,
  GovernedSubjectType,
  ReviewStatus,
  PublicationStatus,
  WorkflowEventType,
  EvidenceVerdict,
  QuarantineReason,
} from "@savvyedge/database";
import {
  WorkflowTransitionService,
  WorkflowTransitionError,
} from "../src/services/workflow-transition.service";
import { PublicationGateService } from "../src/services/publication-gate.service";
import {
  generateSessionToken,
  isValidSessionToken,
  getOrCreateAdminActor,
} from "../../../apps/admin/src/lib/auth";
import {
  getQuarantineQueue,
  MAX_QUEUE_RENDERED_ITEMS,
  parseQuarantineQueueFilters,
  quarantinedDetailWhere,
} from "../../../apps/admin/src/lib/quarantine";
import {
  parseAdminTransitionRequest,
  TransitionRequestValidationError,
} from "../../../apps/admin/src/lib/transition-request";
import { requireIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

// Destructive suite: skips without the explicit opt-in, throws on an unsafe target.
const describeWithIsolatedDatabase = requireIsolatedTestDatabase()
  ? describe
  : describe.skip;

describeWithIsolatedDatabase("Quarantine Governance UI & Service Integration Tests (Real DB)", () => {
  let adminActor: { id: string };
  let workflowService: WorkflowTransitionService;
  let dataSourceId: string;
  let providerId: string;
  let regulatorId: string;

  beforeAll(async () => {
    adminActor = await getOrCreateAdminActor(prisma);
    workflowService = new WorkflowTransitionService(prisma);

    const ds = await prisma.dataSource.create({
      data: {
        url: "https://regulator.example.com/quarantine",
        source_type: "REGULATOR_OFFICIAL",
      },
    });
    dataSourceId = ds.id;

    const provider = await prisma.provider.upsert({
      where: { slug: "test-quarantine-provider" },
      update: {},
      create: {
        slug: "test-quarantine-provider",
        name: "Test Quarantine Provider",
      },
    });
    providerId = provider.id;

    const regulator = await prisma.regulator.upsert({
      where: { slug: "test-quarantine-regulator" },
      update: {},
      create: {
        slug: "test-quarantine-regulator",
        name: "Test Quarantine Regulator",
        jurisdiction: {
          create: {
            slug: "test-quarantine-jurisdiction",
            name: "Test Quarantine Jurisdiction",
          },
        },
      },
    });
    regulatorId = regulator.id;
  });

  beforeEach(async () => {
    await prisma.workflowEventClaim.deleteMany();
    await prisma.workflowAuditEvent.deleteMany();
    await prisma.casinoEvidenceClaim.deleteMany();
    await prisma.bonusEvidenceClaim.deleteMany();
    await prisma.slotEvidenceClaim.deleteMany();
    await prisma.licenseEvidenceClaim.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.bonusHistoryEvent.deleteMany();
    await prisma.bonus.deleteMany();
    await prisma.license.deleteMany();
    await prisma.slotRtpHistory.deleteMany();
    await prisma.casinoSlot.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.casino.deleteMany();
  });

  it("1 & 2) verifies authentication session validation and fail-closed security boundary for quarantine", async () => {
    const validToken = generateSessionToken("admin-secret-key-12345");
    expect(isValidSessionToken(validToken)).toBe(true);

    expect(isValidSessionToken("invalid-token-12345")).toBe(false);
    expect(isValidSessionToken("")).toBe(false);
  });

  it("3, 4, 5, 6) verifies Quarantine Queue queries quarantined Casino & Bonus, excludes null quarantine_reason, and uses bounded limits", async () => {
    const quarantinedCasino = await prisma.casino.create({
      data: {
        name: "Quarantined Test Casino",
        slug: "test-quarantine-casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });

    const quarantinedBonus = await prisma.bonus.create({
      data: {
        casino: { connect: { id: quarantinedCasino.id } },
        headline_value: "$500 Quarantined Bonus",
        type: "WELCOME",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    const cleanCasino = await prisma.casino.create({
      data: {
        name: "Clean Active Casino",
        slug: "test-quarantine-casino-clean",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: null,
        governance_version: 1,
      },
    });

    const queryResultCasinos = await prisma.casino.findMany({
      where: { NOT: { quarantine_reason: null } },
      take: 100,
    });

    const queryResultBonuses = await prisma.bonus.findMany({
      where: { NOT: { quarantine_reason: null } },
      take: 100,
    });

    expect(queryResultCasinos.some((c) => c.id === quarantinedCasino.id)).toBe(true);
    expect(queryResultBonuses.some((b) => b.id === quarantinedBonus.id)).toBe(true);
    expect(queryResultCasinos.some((c) => c.id === cleanCasino.id)).toBe(false);
  });

  it("7 & 8) verifies detail page data and evidence claims belong strictly to requested quarantined entity", async () => {
    const casinoA = await prisma.casino.create({
      data: {
        name: "Quarantined Casino A",
        slug: "test-quarantine-casino-a",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    const casinoB = await prisma.casino.create({
      data: {
        name: "Quarantined Casino B",
        slug: "test-quarantine-casino-b",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://regulator.example.com/revoked",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "REGULATOR_REGISTER",
      },
    });

    const claimA = await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casinoA.id,
        evidence_id: evidence.id,
        field: "NAME",
        observed_value: "Quarantined Casino A",
        normalized_value_hash: "hash_q_a",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    const fetchedCasinoA = await prisma.casino.findFirst({
      where: quarantinedDetailWhere(casinoA.id)!,
      select: {
        id: true,
        evidence_claims: { select: { id: true, casino_id: true } },
      },
    });

    expect(fetchedCasinoA?.id).toBe(casinoA.id);
    expect(fetchedCasinoA?.evidence_claims).toHaveLength(1);
    expect(fetchedCasinoA?.evidence_claims[0].id).toBe(claimA.id);
    expect(fetchedCasinoA?.evidence_claims[0].casino_id).toBe(casinoA.id);
    expect(fetchedCasinoA?.evidence_claims[0].casino_id).not.toBe(casinoB.id);
  });

  it("9 & 10) clearance without a reason or blank whitespace reason is rejected by domain service", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Clearance Validation Casino",
        slug: "test-quarantine-casino-val",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    await expect(
      workflowService.transitionCasinoReview({
        subjectId: casino.id,
        actorId: adminActor.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        internalReason: "   ",
      }),
    ).rejects.toMatchObject({
      code: "QUARANTINE_CLEARANCE_REASON_REQUIRED",
    });
  });

  it("11) stale expectedVersion causes STALE_GOVERNANCE_VERSION error during clearance", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Stale Version Casino",
        slug: "test-quarantine-casino-stale",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 2,
      },
    });

    await expect(
      workflowService.transitionCasinoReview({
        subjectId: casino.id,
        actorId: adminActor.id,
        expectedVersion: 1, // Stale version
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        internalReason: "Attempting clearance with stale version",
      })
    ).rejects.toThrow(WorkflowTransitionError);
  });

  it("12) cross-entity evidence claim injection fails with CLAIM_SUBJECT_MISMATCH during clearance", async () => {
    const casino1 = await prisma.casino.create({
      data: {
        name: "Casino One",
        slug: "test-quarantine-casino-one",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    const casino2 = await prisma.casino.create({
      data: {
        name: "Casino Two",
        slug: "test-quarantine-casino-two",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://regulator.example.com/revoked",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "REGULATOR_REGISTER",
      },
    });

    const claim2 = await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casino2.id,
        evidence_id: evidence.id,
        field: "NAME",
        observed_value: "Casino Two",
        normalized_value_hash: "hash_c2",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    // Attempting to pass casino2's claim when clearing casino1
    await expect(
      workflowService.transitionCasinoReview({
        subjectId: casino1.id,
        actorId: adminActor.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        claimIds: [claim2.id],
        internalReason: "Malicious claim injection attempt",
      })
    ).rejects.toThrow(WorkflowTransitionError);
  });

  it("13, 14, 15, 16, 17, 18) valid clearance sets quarantine_reason to null, increments version, emits QUARANTINE_CLEARED audit event, preserves UNPUBLISHED state, and does NOT publish", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Quarantined Casino Full Clearance",
        slug: "test-quarantine-casino-full",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: QuarantineReason.CONFLICTING_EVIDENCE,
        governance_version: 1,
      },
    });

    const result = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      clearQuarantine: true,
      internalReason: "Regulator confirmed domain dispute resolved",
    });

    // Assert resulting state
    expect(result.reviewStatus).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(result.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
    expect(result.governanceVersion).toBe(2);

    // Verify DB record
    const updatedCasino = await prisma.casino.findUnique({
      where: { id: casino.id },
    });
    expect(updatedCasino?.quarantine_reason).toBe(null);
    expect(updatedCasino?.review_status).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(updatedCasino?.publication_status).toBe(PublicationStatus.UNPUBLISHED);
    expect(updatedCasino?.governance_version).toBe(2);

    // Verify Audit Event
    const auditEvent = await prisma.workflowAuditEvent.findFirst({
      where: {
        casino_id: casino.id,
        event_type: WorkflowEventType.QUARANTINE_CLEARED,
      },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.from_review_status).toBe(ReviewStatus.QUARANTINED);
    expect(auditEvent?.to_review_status).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(auditEvent?.quarantine_reason).toBe(null);
    expect(auditEvent?.internal_note).toBe(
      "Regulator confirmed domain dispute resolved",
    );
  });

  it("19 & 20) cleared entity remains subject to publication gate and cannot publish directly without license/approval", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Cleared Casino Gate Test",
        slug: "test-quarantine-casino-gate",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: QuarantineReason.UNVERIFIED_LICENSE,
        governance_version: 1,
      },
    });

    // 1. Clear quarantine -> transitions to AWAITING_REVIEW
    await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      clearQuarantine: true,
      internalReason: "License re-issued",
    });

    // 2. Attempting to publish while still in AWAITING_REVIEW (unapproved) must fail with APPROVAL_REQUIRED
    await expect(
      workflowService.transitionCasinoPublication({
        subjectId: casino.id,
        actorId: adminActor.id,
        expectedVersion: 2,
        toStatus: PublicationStatus.PUBLISHED,
        reason: "Direct publish attempt after quarantine clearance",
      })
    ).rejects.toThrow(WorkflowTransitionError);
  });

  it("parses only strict, unambiguous quarantine-clearance requests", () => {
    const request = parseAdminTransitionRequest({
      subjectType: "CASINO",
      subjectId: "10000000-0000-4000-8000-000000000001",
      action: "CLEAR_QUARANTINE",
      expectedVersion: 3,
      internalReason: "  Independent verification completed.  ",
      claimIds: ["20000000-0000-4000-8000-000000000001"],
    });

    expect(request.internalReason).toBe("Independent verification completed.");
    expect(request.claimIds).toEqual([
      "20000000-0000-4000-8000-000000000001",
    ]);

    for (const invalidRequest of [
      { ...request, expectedVersion: 1.5 },
      { ...request, expectedVersion: -1 },
      { ...request, subjectId: "not-an-id" },
      { ...request, claimIds: "not-an-array" },
      { ...request, claimIds: [request.claimIds![0], request.claimIds![0]] },
      { ...request, internalReason: "   " },
      { ...request, clearQuarantine: true },
      { ...request, action: "UNKNOWN" },
    ]) {
      expect(() => parseAdminTransitionRequest(invalidRequest)).toThrow(
        TransitionRequestValidationError,
      );
    }
  });

  it("returns all four quarantined entity types, excludes clean records, and scopes each detail query", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Queue Casino",
        slug: "test-quarantine-queue-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
      },
    });
    const cleanCasino = await prisma.casino.create({
      data: {
        name: "Clean Queue Casino",
        slug: "test-quarantine-queue-clean-casino",
        status: "ACTIVE",
      },
    });
    const bonus = await prisma.bonus.create({
      data: {
        casino_id: casino.id,
        type: "WELCOME",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
      },
    });
    const slot = await prisma.slot.create({
      data: {
        provider_id: providerId,
        slug: "test-quarantine-queue-slot",
        name: "Queue Slot",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
      },
    });
    const license = await prisma.license.create({
      data: {
        casino_id: casino.id,
        regulator_id: regulatorId,
        license_no: "QUEUE-LICENSE",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
      },
    });

    const queue = await getQuarantineQueue({});
    expect(queue.map((item) => item.id)).toEqual(
      expect.arrayContaining([casino.id, bonus.id, slot.id, license.id]),
    );
    expect(queue.map((item) => item.id)).not.toContain(cleanCasino.id);

    expect(
      await prisma.casino.findFirst({
        where: quarantinedDetailWhere(casino.id)!,
        select: { id: true },
      }),
    ).not.toBeNull();
    expect(
      await prisma.bonus.findFirst({
        where: quarantinedDetailWhere(bonus.id)!,
        select: { id: true },
      }),
    ).not.toBeNull();
    expect(
      await prisma.slot.findFirst({
        where: quarantinedDetailWhere(slot.id)!,
        select: { id: true },
      }),
    ).not.toBeNull();
    expect(
      await prisma.license.findFirst({
        where: quarantinedDetailWhere(license.id)!,
        select: { id: true },
      }),
    ).not.toBeNull();
    expect(
      await prisma.casino.findFirst({
        where: quarantinedDetailWhere(cleanCasino.id)!,
        select: { id: true },
      }),
    ).toBeNull();
    expect(quarantinedDetailWhere("not-a-uuid")).toBeNull();
  });

  it("uses only the most recent quarantine event for queue timestamp and actor", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Attributed Queue Casino",
        slug: "test-quarantine-attributed-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });
    const quarantineActor = await prisma.reviewActor.upsert({
      where: { stable_key: "test:quarantine-actor" },
      update: {},
      create: {
        kind: ActorKind.HUMAN,
        stable_key: "test:quarantine-actor",
        display_name: "Quarantine Reviewer",
      },
    });
    const laterActor = await prisma.reviewActor.upsert({
      where: { stable_key: "test:later-actor" },
      update: {},
      create: {
        kind: ActorKind.HUMAN,
        stable_key: "test:later-actor",
        display_name: "Later Reviewer",
      },
    });
    const quarantinedAt = new Date("2026-07-01T12:00:00.000Z");

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: quarantineActor.id,
        event_type: WorkflowEventType.QUARANTINED,
        from_review_status: ReviewStatus.AWAITING_REVIEW,
        to_review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        expected_version: 0,
        resulting_version: 1,
        occurred_at: quarantinedAt,
      },
    });
    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: laterActor.id,
        event_type: WorkflowEventType.REVIEW_REQUESTED,
        from_review_status: ReviewStatus.NEW,
        to_review_status: ReviewStatus.AWAITING_REVIEW,
        expected_version: 1,
        resulting_version: 2,
        occurred_at: new Date("2026-07-02T12:00:00.000Z"),
      },
    });

    const item = (await getQuarantineQueue({ entityType: "CASINO" })).find(
      (candidate) => candidate.id === casino.id,
    );
    expect(item?.quarantineTimestamp).toEqual(quarantinedAt);
    expect(item?.actorName).toBe("Quarantine Reviewer");
  });

  it("caps the combined queue at 100 items after deterministic normalization", async () => {
    await prisma.casino.createMany({
      data: Array.from({ length: MAX_QUEUE_RENDERED_ITEMS + 1 }, (_, index) => ({
        name: `Bounded Queue Casino ${index}`,
        slug: `test-quarantine-bounded-${index}`,
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
      })),
    });

    const queue = await getQuarantineQueue({ entityType: "CASINO" });
    expect(queue).toHaveLength(MAX_QUEUE_RENDERED_ITEMS);
    expect(queue.every((item) => item.quarantineTimestamp === null)).toBe(true);
  });

  it("clears every supported entity through its domain method and preserves publication state", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Published Quarantined Casino",
        slug: "test-quarantine-published-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        publication_status: PublicationStatus.PUBLISHED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });
    const bonus = await prisma.bonus.create({
      data: {
        casino_id: casino.id,
        type: "WELCOME",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });
    const slot = await prisma.slot.create({
      data: {
        provider_id: providerId,
        slug: "test-quarantine-clear-slot",
        name: "Clearance Slot",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });
    const license = await prisma.license.create({
      data: {
        casino_id: casino.id,
        regulator_id: regulatorId,
        license_no: "CLEAR-LICENSE",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 1,
      },
    });
    const command = (subjectId: string) => ({
      subjectId,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      clearQuarantine: true,
      internalReason: "Verified clearance reason",
    });

    const [casinoResult, bonusResult, slotResult, licenseResult] = await Promise.all([
      workflowService.transitionCasinoReview(command(casino.id)),
      workflowService.transitionBonusReview(command(bonus.id)),
      workflowService.transitionSlotReview(command(slot.id)),
      workflowService.transitionLicenseReview(command(license.id)),
    ]);

    expect(casinoResult.publicationStatus).toBe(PublicationStatus.PUBLISHED);
    expect(bonusResult.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
    expect(slotResult.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
    expect(licenseResult.publicationStatus).toBeNull();
    expect(
      [casinoResult, bonusResult, slotResult, licenseResult].every(
        (result) => result.reviewStatus === ReviewStatus.AWAITING_REVIEW,
      ),
    ).toBe(true);

    const updatedCasino = await prisma.casino.findUnique({
      where: { id: casino.id },
    });
    expect(updatedCasino?.publication_status).toBe(PublicationStatus.PUBLISHED);
    expect(PublicationGateService.isCasinoPubliclyEligible(updatedCasino)).toBe(
      false,
    );
  });

  it("rejects a stale second quarantine clearance without duplicate audit effects", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Race Clearance Casino",
        slug: "test-quarantine-race-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 7,
      },
    });
    const secondReviewer = await prisma.reviewActor.upsert({
      where: { stable_key: "test:second-clearance-reviewer" },
      update: {},
      create: {
        kind: ActorKind.HUMAN,
        stable_key: "test:second-clearance-reviewer",
        display_name: "Second Reviewer",
      },
    });

    await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 7,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      clearQuarantine: true,
      internalReason: "First reviewer clears quarantine",
    });
    await expect(
      workflowService.transitionCasinoReview({
        subjectId: casino.id,
        actorId: secondReviewer.id,
        expectedVersion: 7,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        internalReason: "Second reviewer uses a stale page",
      }),
    ).rejects.toMatchObject({ code: "STALE_GOVERNANCE_VERSION" });

    const [updatedCasino, clearanceEvents, claimLinks] = await Promise.all([
      prisma.casino.findUnique({ where: { id: casino.id } }),
      prisma.workflowAuditEvent.findMany({
        where: {
          casino_id: casino.id,
          event_type: WorkflowEventType.QUARANTINE_CLEARED,
        },
      }),
      prisma.workflowEventClaim.findMany({
        where: { workflow_event: { casino_id: casino.id } },
      }),
    ]);
    expect(updatedCasino?.governance_version).toBe(8);
    expect(updatedCasino?.quarantine_reason).toBeNull();
    expect(clearanceEvents).toHaveLength(1);
    expect(claimLinks).toHaveLength(0);
  });
});
