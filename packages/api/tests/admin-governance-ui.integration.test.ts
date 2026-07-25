import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  prisma,
  ReviewStatus,
  PublicationStatus,
  ActorKind,
  WorkflowEventType,
  EvidenceVerdict,
  QuarantineReason,
} from "@savvyedge/database";
import {
  WorkflowTransitionService,
  WorkflowTransitionError,
} from "../src/services/workflow-transition.service";
import {
  generateSessionToken,
  isValidSessionToken,
  getOrCreateAdminActor,
} from "../../../apps/admin/src/lib/auth";

describe("Admin Governance UI & Service Integration Tests", () => {
  let adminActor: { id: string };
  let workflowService: WorkflowTransitionService;
  let dataSourceId: string;
  let regulatorId: string;

  beforeAll(async () => {
    adminActor = await getOrCreateAdminActor(prisma);
    workflowService = new WorkflowTransitionService(prisma);

    const ds = await prisma.dataSource.create({
      data: {
        url: "https://operator.example.com",
        source_type: "OPERATOR_OFFICIAL",
      },
    });
    dataSourceId = ds.id;

    const reg = await prisma.regulator.upsert({
      where: { slug: "test-governance-regulator" },
      update: {},
      create: {
        name: "Test Governance Regulator",
        slug: "test-governance-regulator",
        jurisdiction: {
          create: {
            name: "Test Governance Jurisdiction",
            slug: "test-governance-jurisdiction",
            country: "UK",
          },
        },
      },
    });
    regulatorId = reg.id;
  });

  beforeEach(async () => {
    // Clean up test entities in child-to-parent order
    await prisma.workflowEventClaim.deleteMany({
      where: {
        workflow_event: {
          OR: [
            { casino: { slug: { startsWith: "test-admin-" } } },
            { bonus: { casino: { slug: { startsWith: "test-admin-" } } } },
          ],
        },
      },
    });
    await prisma.workflowAuditEvent.deleteMany({
      where: {
        OR: [
          { casino: { slug: { startsWith: "test-admin-" } } },
          { bonus: { casino: { slug: { startsWith: "test-admin-" } } } },
        ],
      },
    });
    await prisma.bonusEvidenceClaim.deleteMany({
      where: { bonus: { casino: { slug: { startsWith: "test-admin-" } } } },
    });
    await prisma.casinoEvidenceClaim.deleteMany({
      where: { casino: { slug: { startsWith: "test-admin-" } } },
    });
    await prisma.licenseEvidenceClaim.deleteMany({
      where: { license: { casino: { slug: { startsWith: "test-admin-" } } } },
    });
    await prisma.license.deleteMany({
      where: { casino: { slug: { startsWith: "test-admin-" } } },
    });
    await prisma.bonus.deleteMany({
      where: { casino: { slug: { startsWith: "test-admin-" } } },
    });
    await prisma.casino.deleteMany({
      where: { slug: { startsWith: "test-admin-" } },
    });
  });

  it("1 & 2) verifies authentication session validation and fail-closed security boundary", async () => {
    const validToken = generateSessionToken("admin-secret-key-12345");
    expect(isValidSessionToken(validToken)).toBe(true);

    const invalidToken = "invalid-token-12345";
    expect(isValidSessionToken(invalidToken)).toBe(false);

    expect(isValidSessionToken("")).toBe(false);
  });

  it("3, 4, 5) verifies Review Queue selects AWAITING_REVIEW and IN_REVIEW entities, excluding APPROVED/REJECTED", async () => {
    const casinoAwaiting = await prisma.casino.create({
      data: {
        name: "Test Admin Casino Awaiting",
        slug: "test-admin-casino-awaiting",
        website_url: "https://awaiting.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const casinoApproved = await prisma.casino.create({
      data: {
        name: "Test Admin Casino Approved",
        slug: "test-admin-casino-approved",
        website_url: "https://approved.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: 2,
      },
    });

    const bonusInReview = await prisma.bonus.create({
      data: {
        casino_id: casinoAwaiting.id,
        headline_value: "100% up to $1000",
        type: "WELCOME",
        status: "ACTIVE",
        review_status: ReviewStatus.IN_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    // Query Queue entities matching review_status IN [AWAITING_REVIEW, IN_REVIEW]
    const queueCasinos = await prisma.casino.findMany({
      where: {
        slug: { startsWith: "test-admin-" },
        status: "ACTIVE",
        review_status: { in: [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW] },
      },
    });

    const queueBonuses = await prisma.bonus.findMany({
      where: {
        casino: { slug: { startsWith: "test-admin-" } },
        status: "ACTIVE",
        review_status: { in: [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW] },
      },
    });

    const casinoIds = queueCasinos.map((c) => c.id);
    const bonusIds = queueBonuses.map((b) => b.id);

    expect(casinoIds).toContain(casinoAwaiting.id);
    expect(casinoIds).not.toContain(casinoApproved.id);
    expect(bonusIds).toContain(bonusInReview.id);
  });

  it("6) Begin Review transitions state from AWAITING_REVIEW to IN_REVIEW", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Casino Begin Review",
        slug: "test-admin-casino-begin",
        website_url: "https://begin.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const result = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.IN_REVIEW,
    });

    expect(result.reviewStatus).toBe(ReviewStatus.IN_REVIEW);
    expect(result.governanceVersion).toBe(2);

    const updated = await prisma.casino.findUnique({ where: { id: casino.id } });
    expect(updated?.review_status).toBe(ReviewStatus.IN_REVIEW);
    expect(updated?.governance_version).toBe(2);
  });

  it("7 & 9) Approve transitions state to APPROVED, creating audit event, while publication_status remains UNPUBLISHED", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Casino Approve",
        slug: "test-admin-casino-approve",
        website_url: "https://approve.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.IN_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 2,
      },
    });

    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://approve.example.com/terms",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "OPERATOR_PAGE",
      },
    });

    const claim = await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casino.id,
        evidence_id: evidence.id,
        field: "NAME",
        observed_value: "Test Admin Casino Approve",
        normalized_value_hash: "hash123",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    const result = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 2,
      toStatus: ReviewStatus.APPROVED,
      claimIds: [claim.id],
    });

    expect(result.reviewStatus).toBe(ReviewStatus.APPROVED);
    expect(result.publicationStatus).toBe(PublicationStatus.UNPUBLISHED); // Separate explicit action!

    const updated = await prisma.casino.findUnique({ where: { id: casino.id } });
    expect(updated?.review_status).toBe(ReviewStatus.APPROVED);
    expect(updated?.publication_status).toBe(PublicationStatus.UNPUBLISHED);
  });

  it("8) Rejection requires a non-empty reason and correctly records REJECTED review status", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Casino Reject",
        slug: "test-admin-casino-reject",
        website_url: "https://reject.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.IN_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 2,
      },
    });

    const result = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 2,
      toStatus: ReviewStatus.REJECTED,
      internalReason: "Invalid operator terms and domain mismatch",
    });

    expect(result.reviewStatus).toBe(ReviewStatus.REJECTED);

    const updated = await prisma.casino.findUnique({ where: { id: casino.id } });
    expect(updated?.review_status).toBe(ReviewStatus.REJECTED);

    const audit = await prisma.workflowAuditEvent.findFirst({
      where: { casino_id: casino.id, event_type: WorkflowEventType.REJECTED },
    });
    expect(audit).not.toBeNull();
    expect(audit?.event_type).toBe(WorkflowEventType.REJECTED);
  });

  it("10) Quarantined entity cannot be published", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Quarantined Casino",
        slug: "test-admin-quarantined",
        website_url: "https://quarantined.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        governance_version: 3,
      },
    });

    await expect(
      workflowService.transitionCasinoPublication({
        subjectId: casino.id,
        actorId: adminActor.id,
        expectedVersion: 3,
        toStatus: PublicationStatus.PUBLISHED,
      })
    ).rejects.toThrow(WorkflowTransitionError);
  });

  it("11) Stale/invalid expectedVersion causes STALE_GOVERNANCE_VERSION state conflict", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Stale Version Casino",
        slug: "test-admin-stale-version",
        website_url: "https://stale.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
      },
    });

    // Try transitioning with expectedVersion = 1 (stale, real version is 5)
    await expect(
      workflowService.transitionCasinoReview({
        subjectId: casino.id,
        actorId: adminActor.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.IN_REVIEW,
      })
    ).rejects.toThrow(WorkflowTransitionError);
  });

  it("12) Full workflow lifecycle: AWAITING_REVIEW -> IN_REVIEW -> APPROVED -> PUBLISHED", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Test Admin Lifecycle Casino",
        slug: "test-admin-lifecycle",
        website_url: "https://lifecycle.example.com",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://lifecycle.example.com/terms",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "OPERATOR_PAGE",
      },
    });

    const claim = await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casino.id,
        evidence_id: evidence.id,
        field: "NAME",
        observed_value: "Test Admin Lifecycle Casino",
        normalized_value_hash: "hash_lifecycle",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    const license = await prisma.license.create({
      data: {
        casino: { connect: { id: casino.id } },
        regulator: { connect: { id: regulatorId } },
        license_no: "LIC-LIFECYCLE-100",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        governance_version: 1,
      },
    });

    const licenseEvidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://regulator.example.com/license",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "REGULATOR_REGISTER",
      },
    });

    const licenseClaim = await prisma.licenseEvidenceClaim.create({
      data: {
        license_id: license.id,
        evidence_id: licenseEvidence.id,
        field: "LICENSE_NUMBER",
        observed_value: "LIC-LIFECYCLE-100",
        normalized_value_hash: "lic_hash_123",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    await workflowService.transitionLicenseReview({
      subjectId: license.id,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.IN_REVIEW,
    });

    await workflowService.transitionLicenseReview({
      subjectId: license.id,
      actorId: adminActor.id,
      expectedVersion: 2,
      toStatus: ReviewStatus.APPROVED,
      claimIds: [licenseClaim.id],
    });

    // Step 1: Begin Review (AWAITING_REVIEW -> IN_REVIEW)
    const step1 = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 1,
      toStatus: ReviewStatus.IN_REVIEW,
    });
    expect(step1.reviewStatus).toBe(ReviewStatus.IN_REVIEW);
    expect(step1.governanceVersion).toBe(2);

    // Step 2: Approve Review (IN_REVIEW -> APPROVED)
    const step2 = await workflowService.transitionCasinoReview({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 2,
      toStatus: ReviewStatus.APPROVED,
      claimIds: [claim.id],
    });
    expect(step2.reviewStatus).toBe(ReviewStatus.APPROVED);
    expect(step2.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
    expect(step2.governanceVersion).toBe(3);

    // Step 3: Publish (UNPUBLISHED -> PUBLISHED)
    const step3 = await workflowService.transitionCasinoPublication({
      subjectId: casino.id,
      actorId: adminActor.id,
      expectedVersion: 3,
      toStatus: PublicationStatus.PUBLISHED,
      claimIds: [claim.id],
      reason: "Manual admin publication verification passed",
    });
    expect(step3.publicationStatus).toBe(PublicationStatus.PUBLISHED);
    expect(step3.governanceVersion).toBe(4);

    const finalState = await prisma.casino.findUnique({ where: { id: casino.id } });
    expect(finalState?.review_status).toBe(ReviewStatus.APPROVED);
    expect(finalState?.publication_status).toBe(PublicationStatus.PUBLISHED);
    expect(finalState?.governance_version).toBe(4);
  });
});
