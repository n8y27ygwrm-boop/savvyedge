import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const testDbUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;
const describeIntegration = testDbUrl ? describe : describe.skip;

describeIntegration("Ingestion Governance Integration Tests", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: { db: { url: testDbUrl } },
    });
    await db.$connect();
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

  it("does not regress existing APPROVED or AWAITING_REVIEW entities on re-ingestion", async () => {
    const url = "https://existing-casino-gov.com/promo";
    const { casino, isNew: isNewCasino } = await CasinoService.resolveOrCreateCasino({
      name: "Existing Gov Casino",
      slug: "existing-gov-casino",
      domain: "existing-casino-gov.com",
      website_url: "https://existing-casino-gov.com",
    });

    await db.casino.update({
      where: { id: casino.id },
      data: {
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: 5,
      },
    });

    await IngestionService.handleExtraction({
      url,
      casinoId: casino.id,
      scrapedContent: "Updated bonus offer 200% up to $1000",
    });

    const refreshedCasino = await db.casino.findUnique({ where: { id: casino.id } });
    expect(refreshedCasino!.review_status).toBe(ReviewStatus.APPROVED);
    expect(refreshedCasino!.publication_status).toBe(PublicationStatus.PUBLISHED);
    expect(refreshedCasino!.governance_version).toBe(5);
    expect(refreshedCasino!.verified_at).toBeNull();
  });
});
