import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  ActorKind,
  ReviewStatus,
  PublicationStatus,
  EvidenceType,
  EvidenceVerdict,
  CasinoEvidenceField,
  BonusEvidenceField,
  WorkflowEventType,
  prisma as db,
} from "@savvyedge/database";
import { IngestionService } from "../src/services/ingestion.service";
import { CasinoService } from "../src/services/casino.service";
import { BonusService } from "../src/services/bonus.service";
import {
  ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE,
  ISOLATED_TEST_DATABASE_RUNTIME_TARGET_VARIABLES,
  requireConfiguredIsolatedTestDatabase,
} from "./helpers/isolated-test-database-guard";

/**
 * Destructive suite: `beforeEach` empties whole governance tables. There is no
 * fallback URL — without the explicit opt-in the suite skips without issuing a
 * single query, and an explicit-but-unsafe configuration throws here, at module
 * scope, before any hook or test callback exists.
 *
 * `IngestionService`, `CasinoService`, and `BonusService` write through the
 * shared Prisma singleton, so cleanup and assertions use that same singleton:
 * there is no second client that could target a different database. The guard
 * proves `DATABASE_URL`/`DIRECT_URL` (what the singleton connects through)
 * resolve to the same isolated target as the opt-in, and `beforeAll` confirms
 * the live connection identity before anything is deleted.
 */
const guardDecision = requireConfiguredIsolatedTestDatabase({
  optInVariable: ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE,
  targets: ISOLATED_TEST_DATABASE_RUNTIME_TARGET_VARIABLES,
});
const describeWithDatabase =
  guardDecision.status === "enabled" ? describe : describe.skip;
const approvedDatabaseName =
  guardDecision.status === "enabled" ? guardDecision.databaseName : "";

describeWithDatabase("Ingestion Governance Integration Tests (Real DB)", () => {
  beforeAll(async () => {
    await db.$connect();

    const [{ current_database: connectedDatabase }] = await db.$queryRawUnsafe<
      Array<{ current_database: string }>
    >("SELECT current_database() as current_database");
    if (
      connectedDatabase?.toLowerCase() !== approvedDatabaseName.toLowerCase()
    ) {
      throw new Error(
        "Refusing to run destructive ingestion governance tests: the shared Prisma client is connected to a database other than the approved isolated test database.",
      );
    }
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
    await db.$disconnect();
  });

  it("creates governed Casino and Bonus with EvidenceRecord, claims, and AWAITING_REVIEW status", async () => {
    const url = "https://example-casino-ingest.com/promo";
    const scrapedContent =
      "100% Match Bonus up to $500. 30x wagering requirement. Max cashout $1000.";

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
    expect(evidence!.observed_at).toEqual(new Date("2026-08-11T10:20:30.456Z"));

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
    expect(casinoAuditEvents[0].event_type).toBe(
      WorkflowEventType.REVIEW_REQUESTED,
    );
    expect(casinoAuditEvents[0].from_review_status).toBe(ReviewStatus.NEW);
    expect(casinoAuditEvents[0].to_review_status).toBe(
      ReviewStatus.AWAITING_REVIEW,
    );

    const bonusAuditEvents = await db.workflowAuditEvent.findMany({
      where: { bonus_id: bonus!.id },
    });
    expect(bonusAuditEvents.length).toBe(1);
    expect(bonusAuditEvents[0].event_type).toBe(
      WorkflowEventType.REVIEW_REQUESTED,
    );
    expect(bonusAuditEvents[0].from_review_status).toBe(ReviewStatus.NEW);
    expect(bonusAuditEvents[0].to_review_status).toBe(
      ReviewStatus.AWAITING_REVIEW,
    );
  });

  it("P0: preserves approved values and atomically unpublishes while transitioning to AWAITING_REVIEW on material re-ingestion", async () => {
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
    const newScrapedContent =
      "Special Offer: 100% up to €300 with 50x wagering requirement.";

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

    // b. publication_status is atomically demoted with review status
    expect(reingestedBonus!.publication_status).toBe(
      PublicationStatus.UNPUBLISHED,
    );

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
    expect(auditEvent!.from_publication_status).toBe(
      PublicationStatus.PUBLISHED,
    );
    expect(auditEvent!.to_publication_status).toBe(
      PublicationStatus.UNPUBLISHED,
    );
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
      (c) => c.field === BonusEvidenceField.HEADLINE_VALUE,
    );
    const wageringClaim = newBonusClaims.find(
      (c) => c.field === BonusEvidenceField.WAGERING_REQUIREMENT,
    );

    expect(headlineClaim).toBeDefined();
    expect(headlineClaim!.observed_value).toContain("300");

    expect(wageringClaim).toBeDefined();
    expect(wageringClaim!.observed_value).toBe("50");
  });
});
