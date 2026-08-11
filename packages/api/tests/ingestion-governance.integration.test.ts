import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  PrismaClient,
  ActorKind,
  ReviewStatus,
  PublicationStatus,
  EvidenceType,
  EvidenceVerdict,
  CasinoEvidenceField,
  BonusEvidenceField,
  WorkflowEventType,
} from "@savvyedge/database";
import { IngestionService } from "../src/services/ingestion.service";
import { CasinoService } from "../src/services/casino.service";
import { BonusService } from "../src/services/bonus.service";

const testDbUrl =
  process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL ||
  "postgresql://localhost:5432/savvyedge_test";

describe("Ingestion Governance Integration Tests (Real DB)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: { db: { url: testDbUrl } },
    });
    await db.$connect();
  });

  beforeEach(async () => {
    await db.workflowEventClaim.deleteMany();
    await db.workflowAuditEvent.deleteMany();
    await db.bonusEvidenceClaim.deleteMany();
    await db.casinoEvidenceClaim.deleteMany();
    await db.licenseEvidenceClaim.deleteMany();
    await db.evidenceRecord.deleteMany();
    await db.bonusHistoryEvent.deleteMany();
    await db.bonus.deleteMany();
    await db.license.deleteMany();
    await db.casino.deleteMany();
    await db.scrapeJob.deleteMany();
    await db.dataSource.deleteMany();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates governed Casino and Bonus with EvidenceRecord, claims, and AWAITING_REVIEW status", async () => {
    const url = "https://example-casino-ingest.com/promo";
    const scrapedContent = "100% Match Bonus up to $500. 30x wagering requirement. Max cashout $1000.";

    await IngestionService.handleExtraction({
      url,
      scrapedContent,
      scrapedMetadata: { title: "Example Casino Promo" },
      observedAt: "2026-08-11T10:20:30.456Z",
    });

    const casino = await db.casino.findFirst({
      where: { website_url: { contains: "example-casino-ingest.com" } },
    });

    expect(casino).not.toBeNull();
    expect(casino!.review_status).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(casino!.publication_status).toBe(PublicationStatus.UNPUBLISHED);
    expect(casino!.verified_at).toBeNull();
    expect(casino!.governance_version).toBe(1);

    const bonus = await db.bonus.findFirst({
      where: { casino_id: casino!.id },
    });

    expect(bonus).not.toBeNull();
    expect(bonus!.review_status).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(bonus!.publication_status).toBe(PublicationStatus.UNPUBLISHED);
    expect(bonus!.verified_at).toBeNull();
    expect(bonus!.governance_version).toBe(1);

    const evidence = await db.evidenceRecord.findFirst({
      where: { source_url: url },
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence_type).toBe(EvidenceType.OPERATOR_PAGE);
    expect(evidence!.observed_at).toEqual(
      new Date("2026-08-11T10:20:30.456Z"),
    );

    const casinoClaims = await db.casinoEvidenceClaim.findMany({
      where: { casino_id: casino!.id },
    });
    expect(casinoClaims.length).toBeGreaterThan(0);

    const bonusClaims = await db.bonusEvidenceClaim.findMany({
      where: { bonus_id: bonus!.id },
    });
    expect(bonusClaims.length).toBeGreaterThan(0);

    const casinoAuditEvents = await db.workflowAuditEvent.findMany({
      where: { casino_id: casino!.id },
    });
    expect(casinoAuditEvents.length).toBe(1);
    expect(casinoAuditEvents[0].event_type).toBe(WorkflowEventType.REVIEW_REQUESTED);
    expect(casinoAuditEvents[0].from_review_status).toBe(ReviewStatus.NEW);
    expect(casinoAuditEvents[0].to_review_status).toBe(ReviewStatus.AWAITING_REVIEW);

    const bonusAuditEvents = await db.workflowAuditEvent.findMany({
      where: { bonus_id: bonus!.id },
    });
    expect(bonusAuditEvents.length).toBe(1);
    expect(bonusAuditEvents[0].event_type).toBe(WorkflowEventType.REVIEW_REQUESTED);
    expect(bonusAuditEvents[0].from_review_status).toBe(ReviewStatus.NEW);
    expect(bonusAuditEvents[0].to_review_status).toBe(ReviewStatus.AWAITING_REVIEW);
  });

  it("P0: preserves approved/published values and transitions review_status to AWAITING_REVIEW (MATERIAL_CHANGE_DETECTED) on re-ingestion with changed fields", async () => {
    const url = "https://approved-casino-reingest.com/promo";

    // 1. Create Casino and Bonus in APPROVED & PUBLISHED state
    const { casino } = await CasinoService.resolveOrCreateCasino({
      name: "Approved Casino Brand",
      slug: "approved-casino-brand",
      domain: "approved-casino-reingest.com",
      website_url: "https://approved-casino-reingest.com",
    });

    await db.casino.update({
      where: { id: casino.id },
      data: {
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: 1,
      },
    });

    const initialBonus = await db.bonus.create({
      data: {
        casino_id: casino.id,
        type: "MATCH",
        headline_value: "€500",
        wagering_requirement: 35,
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // 2. Simulate re-ingestion with new evidence: headline_value = "€300", wagering_requirement = 50
    const newScrapedContent = "Special Offer: 100% up to €300 with 50x wagering requirement.";

    await IngestionService.handleExtraction({
      url,
      casinoId: casino.id,
      scrapedContent: newScrapedContent,
      observedAt: "2026-08-11T10:21:30.456Z",
    });

    // 3. Verify Bonus state after re-ingestion
    const reingestedBonus = await db.bonus.findUnique({
      where: { id: initialBonus.id },
    });

    expect(reingestedBonus).not.toBeNull();
    // a. Public fields STAY at old approved values
    expect(reingestedBonus!.headline_value).toBe("€500");
    expect(reingestedBonus!.wagering_requirement).toBe(35);

    // b. publication_status STAYS PUBLISHED
    expect(reingestedBonus!.publication_status).toBe(PublicationStatus.PUBLISHED);

    // c. review_status IS NOW AWAITING_REVIEW
    expect(reingestedBonus!.review_status).toBe(ReviewStatus.AWAITING_REVIEW);

    // d. governance_version incremented from 1 to 2
    expect(reingestedBonus!.governance_version).toBe(2);

    // e. WorkflowAuditEvent created with event_type = MATERIAL_CHANGE_DETECTED
    const auditEvent = await db.workflowAuditEvent.findFirst({
      where: {
        bonus_id: initialBonus.id,
        event_type: WorkflowEventType.MATERIAL_CHANGE_DETECTED,
      },
      include: {
        evidence_claims: true,
      },
    });

    expect(auditEvent).not.toBeNull();
    expect(auditEvent!.from_review_status).toBe(ReviewStatus.APPROVED);
    expect(auditEvent!.to_review_status).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(auditEvent!.expected_version).toBe(1);
    expect(auditEvent!.resulting_version).toBe(2);

    // f. New claims (€300, wagering 50) exist and are linked to the new evidence_id
    const newEvidenceRecord = await db.evidenceRecord.findFirst({
      where: { source_url: url },
    });
    expect(newEvidenceRecord).not.toBeNull();

    const newBonusClaims = await db.bonusEvidenceClaim.findMany({
      where: {
        bonus_id: initialBonus.id,
        evidence_id: newEvidenceRecord!.id,
      },
    });

    expect(newBonusClaims.length).toBeGreaterThan(0);
    const headlineClaim = newBonusClaims.find(
      (c) => c.field === BonusEvidenceField.HEADLINE_VALUE
    );
    const wageringClaim = newBonusClaims.find(
      (c) => c.field === BonusEvidenceField.WAGERING_REQUIREMENT
    );

    expect(headlineClaim).toBeDefined();
    expect(headlineClaim!.observed_value).toContain("300");

    expect(wageringClaim).toBeDefined();
    expect(wageringClaim!.observed_value).toBe("50");
  });
});
