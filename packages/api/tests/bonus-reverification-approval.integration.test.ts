import { randomUUID } from "node:crypto";
import {
  ActorKind,
  BonusEvidenceField,
  EvidenceType,
  EvidenceVerdict,
  LicenseEvidenceField,
  PrismaClient,
  PublicationStatus,
  QuarantineReason,
  ReviewStatus,
  WorkflowEventType,
} from "@savvyedge/database";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  EXTRACTION_CONTRACT_VERSION,
  bonusExtractionKey,
} from "@savvyedge/ai-agents/extraction-contract";
import { BonusReverificationService } from "../src/services/bonus-reverification.service";
import { IngestionService } from "../src/services/ingestion.service";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";
import { BONUS_EXTRACTION_CONTEXT } from "../src/constants/extraction-context";
import { requireIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

declare const process: { env: Record<string, string | undefined> };

const databaseUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;
const describeWithDatabase = requireIsolatedTestDatabase()
  ? describe
  : describe.skip;

describeWithDatabase(
  "Finding #3: automated reverification approval binding",
  () => {
    let database: PrismaClient;

    beforeAll(() => {
      database = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
    });

    afterAll(async () => {
      await database?.$disconnect();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const seedGovernedBonus = async (publish: boolean) => {
      const suffix = randomUUID();
      const now = new Date();
      const observedAt = new Date(now.getTime() - 5 * 60 * 1000);
      const sourceUrl = `https://operator-${suffix}.example.test/welcome-terms`;
      const workflow = new WorkflowTransitionService(database);

      const human = await database.reviewActor.create({
        data: {
          kind: ActorKind.HUMAN,
          stable_key: `human:finding3:${suffix}`,
          display_name: "Finding 3 Reviewer",
          active: true,
        },
      });
      const service = await database.reviewActor.create({
        data: {
          kind: ActorKind.SERVICE,
          stable_key: `service:finding3-seed:${suffix}`,
          display_name: "Finding 3 Seed Service",
          active: true,
        },
      });
      const dataSource = await database.dataSource.create({
        data: {
          url: sourceUrl,
          normalized_url: sourceUrl,
          source_type: "CASINO_PROMOTION_PAGE",
          last_scraped_at: observedAt,
        },
      });
      const casino = await database.casino.create({
        data: {
          slug: `finding3-${suffix}`,
          name: "Finding 3 Casino",
          website_url: `https://casino-${suffix}.example.test`,
          status: "ACTIVE",
          verified_at: observedAt,
          review_status: ReviewStatus.APPROVED,
          publication_status: PublicationStatus.PUBLISHED,
          governance_version: 2,
        },
      });
      await database.casinoHistoryEvent.create({
        data: {
          casino_id: casino.id,
          event_type: "VERIFICATION",
          description: "License verification",
          occurred_at: observedAt,
          source_url: `https://regulator-${suffix}.example.test/register`,
        },
      });

      const jurisdiction = await database.jurisdiction.create({
        data: {
          slug: `finding3-jurisdiction-${suffix}`,
          name: "Finding 3 Jurisdiction",
          country: "GB",
        },
      });
      const regulator = await database.regulator.create({
        data: {
          slug: `finding3-regulator-${suffix}`,
          name: "Finding 3 Regulator",
          jurisdiction_id: jurisdiction.id,
        },
      });
      const license = await database.license.create({
        data: {
          casino_id: casino.id,
          regulator_id: regulator.id,
          license_no: `LIC-${suffix}`,
          normalized_license_no: `LIC-${suffix}`,
          status: "ACTIVE",
          verified_at: observedAt,
        },
      });
      const licenseEvidence = await database.evidenceRecord.create({
        data: {
          data_source_id: dataSource.id,
          evidence_type: EvidenceType.REGULATOR_REGISTER,
          source_url: `https://regulator-${suffix}.example.test/register`,
          observed_at: observedAt,
          extracted_at: observedAt,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          created_by_id: service.id,
        },
      });
      const licenseClaim = await database.licenseEvidenceClaim.create({
        data: {
          evidence_id: licenseEvidence.id,
          license_id: license.id,
          field: LicenseEvidenceField.LICENSE_NUMBER,
          observed_value: license.license_no,
          normalized_value_hash: `finding3-license:${suffix}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      await workflow.transitionLicenseReview({
        subjectId: license.id,
        actorId: service.id,
        expectedVersion: 0,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        claimIds: [licenseClaim.id],
      });
      await workflow.transitionLicenseReview({
        subjectId: license.id,
        actorId: human.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      const licenseApproval = await workflow.transitionLicenseReview({
        subjectId: license.id,
        actorId: human.id,
        expectedVersion: 2,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [licenseClaim.id],
      });

      const bonus = await database.bonus.create({
        data: {
          casino_id: casino.id,
          type: "WELCOME",
          headline_value: "100% up to £200",
          wagering_requirement: 35,
          max_conversion: 1000,
          status: "ACTIVE",
          verified_at: observedAt,
          source_offer_key: createBonusSourceOfferKey(sourceUrl),
        },
      });
      const oldSnapshotLocator = `test://finding3/${suffix}/old.html`;
      const oldHtmlHash = "a".repeat(64);
      const oldContentHash = "b".repeat(64);
      const oldExtractionKey = bonusExtractionKey({
        snapshotLocator: oldSnapshotLocator,
        htmlHash: oldHtmlHash,
        contentHash: oldContentHash,
      });
      const oldEvidence = await database.evidenceRecord.create({
        data: {
          data_source_id: dataSource.id,
          evidence_type: EvidenceType.OPERATOR_PAGE,
          source_url: sourceUrl,
          snapshot_path: oldSnapshotLocator,
          html_hash: oldHtmlHash,
          content_hash: oldContentHash,
          extraction_key: oldExtractionKey,
          observed_at: observedAt,
          extracted_at: observedAt,
          created_by_id: service.id,
        },
      });
      const oldClaim = await database.bonusEvidenceClaim.create({
        data: {
          evidence_id: oldEvidence.id,
          bonus_id: bonus.id,
          field: BonusEvidenceField.TYPE,
          observed_value: "WELCOME",
          normalized_value_hash: `finding3-bonus:${suffix}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      await database.activeExtractionPointer.create({
        data: {
          bonus_id: bonus.id,
          data_source_id: dataSource.id,
          extraction_context: BONUS_EXTRACTION_CONTEXT,
          evidence_id: oldEvidence.id,
          extraction_key: oldExtractionKey,
          contract_version: EXTRACTION_CONTRACT_VERSION,
          activated_at: observedAt,
        },
      });

      await workflow.transitionBonusReview({
        subjectId: bonus.id,
        actorId: service.id,
        expectedVersion: 0,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        claimIds: [oldClaim.id],
      });

      let bonusApprovalId: string | null = null;
      let bonusPublicationId: string | null = null;
      if (publish) {
        await workflow.transitionBonusReview({
          subjectId: bonus.id,
          actorId: human.id,
          expectedVersion: 1,
          toStatus: ReviewStatus.IN_REVIEW,
        });
        const approval = await workflow.transitionBonusReview({
          subjectId: bonus.id,
          actorId: human.id,
          expectedVersion: 2,
          toStatus: ReviewStatus.APPROVED,
          claimIds: [oldClaim.id],
        });
        const publication = await workflow.transitionBonusPublication({
          subjectId: bonus.id,
          actorId: human.id,
          expectedVersion: 3,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: [oldClaim.id],
        });
        bonusApprovalId = approval.workflowEventId;
        bonusPublicationId = publication.workflowEventId;
      }

      const licenseApprovalEvent = await database.workflowAuditEvent.findUnique(
        {
          where: { id: licenseApproval.workflowEventId },
          include: { evidence_claims: true },
        },
      );

      return {
        now,
        sourceUrl,
        workflow,
        human,
        dataSource,
        casino,
        license,
        licenseClaim,
        licenseApprovalEvent,
        bonus,
        oldEvidence,
        oldClaim,
        bonusApprovalId,
        bonusPublicationId,
      };
    };

    const ingestionInternals = IngestionService as unknown as {
      bonusAgent: { run(input: unknown): Promise<unknown> };
    };

    const createIngestionJob = async (
      dataSourceId: string,
      sourceUrl: string,
    ) => {
      const suffix = randomUUID();
      return database.scrapeJob.create({
        data: {
          data_source_id: dataSourceId,
          status: "PENDING",
          snapshot_path: `test://finding3-ingestion/${suffix}.html`,
          html_hash: "e".repeat(64),
          content_hash: suffix.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
          canonical_url: sourceUrl,
        },
      });
    };

    const unchangedIngestionResult = () => ({
      headline_value: "100% up to £200",
      type: "WELCOME",
      wagering_requirement: 35,
      max_conversion: 1000,
      valid_from: null,
      valid_until: null,
      status: "ACTIVE",
    });

    const reverificationOptions = (sourceUrl: string, now: Date) => ({
      now,
      scraperAgent: {
        run: vi.fn().mockResolvedValue({
          url: sourceUrl,
          finalUrl: sourceUrl,
          title: "Finding 3 Casino Welcome Bonus",
          content:
            "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
          rawHtml:
            "<html>Get 100% up to £200. 35x wagering. Max conversion £1000.</html>",
          htmlHash: "c".repeat(64),
          contentHash: "d".repeat(64),
          timestamp: now,
        }),
      },
      bonusAgent: {
        run: vi.fn().mockResolvedValue({
          headline_value: "100% up to £200",
          type: "WELCOME",
          wagering_requirement: 35,
          max_conversion: 1000,
          valid_from: null,
          valid_until: null,
          status: "ACTIVE",
        }),
      },
      artifactStore: {
        persistObservation: vi.fn().mockResolvedValue({
          locator: `test://finding3/${randomUUID()}/fresh.html`,
          htmlHash: "c".repeat(64),
          byteSize: 80,
        }),
      },
    });

    const freezeBonus = async (
      seeded: Awaited<ReturnType<typeof seedGovernedBonus>>,
      status: typeof ReviewStatus.QUARANTINED | typeof ReviewStatus.SUPERSEDED,
    ) => {
      const canonical =
        status === ReviewStatus.SUPERSEDED
          ? await seedGovernedBonus(true)
          : null;
      return seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: 4,
        toStatus: status,
        ...(status === ReviewStatus.QUARANTINED
          ? { quarantineReason: QuarantineReason.MANUAL_HOLD }
          : { canonicalTargetId: canonical!.bonus.id }),
      });
    };

    it.each([ReviewStatus.QUARANTINED, ReviewStatus.SUPERSEDED])(
      "refuses direct reverification of %s before scrape or authoritative write",
      async (status) => {
        const seeded = await seedGovernedBonus(true);
        await freezeBonus(seeded, status);
        const before = await database.bonus.findUniqueOrThrow({
          where: { id: seeded.bonus.id },
          include: { active_extractions: true },
        });
        const evidenceCount = await database.evidenceRecord.count();
        const claimCount = await database.bonusEvidenceClaim.count();
        const options = reverificationOptions(seeded.sourceUrl, seeded.now);

        await expect(
          BonusReverificationService.reverifyBonus(
            seeded.bonus.id,
            options,
            database,
          ),
        ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

        expect(options.scraperAgent.run).not.toHaveBeenCalled();
        expect(options.bonusAgent.run).not.toHaveBeenCalled();
        expect(options.artifactStore.persistObservation).not.toHaveBeenCalled();
        expect(
          await database.bonus.findUniqueOrThrow({
            where: { id: seeded.bonus.id },
            include: { active_extractions: true },
          }),
        ).toEqual(before);
        expect(await database.evidenceRecord.count()).toBe(evidenceCount);
        expect(await database.bonusEvidenceClaim.count()).toBe(claimCount);
      },
    );

    it.each([ReviewStatus.QUARANTINED, ReviewStatus.SUPERSEDED])(
      "refuses %s after a job starts and before evidence persistence",
      async (status) => {
        const seeded = await seedGovernedBonus(true);
        const options = reverificationOptions(seeded.sourceUrl, seeded.now);
        let releaseScrape!: () => void;
        const scrapeReleased = new Promise<void>((resolve) => {
          releaseScrape = resolve;
        });
        let signalScrape!: () => void;
        const scrapeEntered = new Promise<void>((resolve) => {
          signalScrape = resolve;
        });
        const originalScrape = options.scraperAgent.run;
        options.scraperAgent.run = vi.fn().mockImplementation(async (input) => {
          signalScrape();
          await scrapeReleased;
          return originalScrape(input);
        });

        const reverification = BonusReverificationService.reverifyBonus(
          seeded.bonus.id,
          options,
          database,
        );
        await scrapeEntered;
        await freezeBonus(seeded, status);
        const before = await database.bonus.findUniqueOrThrow({
          where: { id: seeded.bonus.id },
          include: { active_extractions: true },
        });
        const evidenceCount = await database.evidenceRecord.count();
        const claimCount = await database.bonusEvidenceClaim.count();
        releaseScrape();

        await expect(reverification).rejects.toMatchObject({
          code: "INVALID_TRANSITION",
        });
        expect(
          await database.bonus.findUniqueOrThrow({
            where: { id: seeded.bonus.id },
            include: { active_extractions: true },
          }),
        ).toEqual(before);
        expect(await database.evidenceRecord.count()).toBe(evidenceCount);
        expect(await database.bonusEvidenceClaim.count()).toBe(claimCount);
      },
    );

    it("invalidates prior authority atomically, preserves exact history, and permits fresh human approval", async () => {
      const seeded = await seedGovernedBonus(true);
      const evidenceCountBefore = await database.evidenceRecord.count();
      const approvalBefore = await database.workflowAuditEvent.findUnique({
        where: { id: seeded.bonusApprovalId! },
        include: { evidence_claims: true },
      });
      const publicationBefore = await database.workflowAuditEvent.findUnique({
        where: { id: seeded.bonusPublicationId! },
        include: { evidence_claims: true },
      });

      expect(seeded.licenseApprovalEvent).toMatchObject({
        event_type: WorkflowEventType.APPROVED,
        expected_version: 2,
        resulting_version: 3,
        evidence_claims: [
          { license_evidence_claim_id: seeded.licenseClaim.id },
        ],
      });

      const result = await BonusReverificationService.reverifyBonus(
        seeded.bonus.id,
        reverificationOptions(seeded.sourceUrl, seeded.now),
        database,
      );

      expect(result).toMatchObject({
        status: "VERIFIED_UNCHANGED",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
        publicationStatus: PublicationStatus.UNPUBLISHED,
        governanceVersion: 5,
        humanApprovalRequired: true,
      });
      if (result.status !== "VERIFIED_UNCHANGED") {
        throw new Error("Expected unchanged reverification result");
      }

      const afterReverification = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
      });
      expect(afterReverification).toMatchObject({
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
        verified_at: seeded.now,
      });
      expect(result.evidenceRecordId).not.toBe(seeded.oldEvidence.id);
      expect(await database.evidenceRecord.count()).toBe(
        evidenceCountBefore + 1,
      );
      expect(
        await database.evidenceRecord.findUnique({
          where: { id: seeded.oldEvidence.id },
        }),
      ).not.toBeNull();
      expect(
        await database.bonusEvidenceClaim.findUnique({
          where: { id: seeded.oldClaim.id },
        }),
      ).not.toBeNull();

      const approvalAfter = await database.workflowAuditEvent.findUnique({
        where: { id: seeded.bonusApprovalId! },
        include: { evidence_claims: true },
      });
      const publicationAfter = await database.workflowAuditEvent.findUnique({
        where: { id: seeded.bonusPublicationId! },
        include: { evidence_claims: true },
      });
      expect(approvalAfter).toEqual(approvalBefore);
      expect(publicationAfter).toEqual(publicationBefore);

      const invalidation = await database.workflowAuditEvent.findFirstOrThrow({
        where: {
          bonus_id: seeded.bonus.id,
          event_type: WorkflowEventType.MATERIAL_CHANGE_DETECTED,
          expected_version: 4,
          resulting_version: 5,
        },
        include: { evidence_claims: true },
      });
      expect(
        invalidation.evidence_claims
          .map((link) => link.bonus_evidence_claim_id)
          .sort(),
      ).toEqual([...result.claimIds].sort());
      expect(
        invalidation.evidence_claims.some(
          (link) => link.bonus_evidence_claim_id === seeded.oldClaim.id,
        ),
      ).toBe(false);

      const unpublishedBonus = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
        include: {
          ...PublicationGateService.bonusActiveEvidenceInclude(),
          casino: { include: { licenses: true, history_events: true } },
        },
      });
      expect(
        PublicationGateService.isBonusPubliclyEligible(
          unpublishedBonus,
          unpublishedBonus.casino,
          seeded.now,
        ),
      ).toBe(false);

      const inReview = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: 5,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      const approved = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: inReview.governanceVersion,
        toStatus: ReviewStatus.APPROVED,
        claimIds: result.claimIds,
      });
      const published = await seeded.workflow.transitionBonusPublication({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: approved.governanceVersion,
        toStatus: PublicationStatus.PUBLISHED,
        claimIds: result.claimIds,
      });
      expect(published).toMatchObject({
        reviewStatus: ReviewStatus.APPROVED,
        publicationStatus: PublicationStatus.PUBLISHED,
        governanceVersion: 8,
      });

      const republishedBonus = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
        include: {
          ...PublicationGateService.bonusActiveEvidenceInclude(),
          casino: { include: { licenses: true, history_events: true } },
        },
      });
      expect(
        PublicationGateService.isBonusPubliclyEligible(
          republishedBonus,
          republishedBonus.casino,
          seeded.now,
        ),
      ).toBe(true);
    });

    it("cannot replace evidence across a deterministic concurrent human approval", async () => {
      const seeded = await seedGovernedBonus(false);
      const reviewing = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      const rejected = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: reviewing.governanceVersion,
        toStatus: ReviewStatus.REJECTED,
      });
      const evidenceCountBefore = await database.evidenceRecord.count();
      let releaseScrape!: () => void;
      const scrapeReleased = new Promise<void>((resolve) => {
        releaseScrape = resolve;
      });
      let markScrapeEntered!: () => void;
      const scrapeEntered = new Promise<void>((resolve) => {
        markScrapeEntered = resolve;
      });
      const options = reverificationOptions(seeded.sourceUrl, seeded.now);
      options.scraperAgent.run = vi.fn().mockImplementation(async () => {
        markScrapeEntered();
        await scrapeReleased;
        return {
          url: seeded.sourceUrl,
          finalUrl: seeded.sourceUrl,
          title: "Finding 3 Casino Welcome Bonus",
          content:
            "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
          rawHtml: "<html>Finding 3 concurrent observation</html>",
          htmlHash: "e".repeat(64),
          contentHash: "f".repeat(64),
          timestamp: seeded.now,
        };
      });
      options.artifactStore.persistObservation = vi.fn().mockResolvedValue({
        locator: `test://finding3/${randomUUID()}/concurrent.html`,
        htmlHash: "e".repeat(64),
        byteSize: 46,
      });

      const reverification = BonusReverificationService.reverifyBonus(
        seeded.bonus.id,
        options,
        database,
      );
      await scrapeEntered;

      const awaiting = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: rejected.governanceVersion,
        toStatus: ReviewStatus.AWAITING_REVIEW,
      });
      const inReview = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: awaiting.governanceVersion,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: inReview.governanceVersion,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [seeded.oldClaim.id],
      });
      releaseScrape();

      await expect(reverification).rejects.toMatchObject({
        name: "WorkflowTransitionError",
        code: "STALE_GOVERNANCE_VERSION",
      });

      const afterRace = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
        include: {
          active_extractions: {
            where: { extraction_context: BONUS_EXTRACTION_CONTEXT },
          },
        },
      });
      expect(afterRace).toMatchObject({
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 6,
        verified_at: seeded.bonus.verified_at,
      });
      expect(afterRace.active_extractions).toHaveLength(1);
      expect(afterRace.active_extractions[0].evidence_id).toBe(
        seeded.oldEvidence.id,
      );
      expect(await database.evidenceRecord.count()).toBe(evidenceCountBefore);
    });

    it("does not replace the evidence snapshot held by an active reviewer", async () => {
      const seeded = await seedGovernedBonus(false);
      const inReview = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      const evidenceCountBefore = await database.evidenceRecord.count();
      const activePointerBefore =
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        });
      const options = reverificationOptions(seeded.sourceUrl, seeded.now);

      const result = await BonusReverificationService.reverifyBonus(
        seeded.bonus.id,
        options,
        database,
      );

      expect(result).toMatchObject({
        status: "HUMAN_REVIEW_PENDING",
        reviewStatus: ReviewStatus.IN_REVIEW,
        governanceVersion: inReview.governanceVersion,
      });
      expect(options.scraperAgent.run).not.toHaveBeenCalled();
      expect(options.bonusAgent.run).not.toHaveBeenCalled();
      expect(options.artifactStore.persistObservation).not.toHaveBeenCalled();
      expect(await database.evidenceRecord.count()).toBe(evidenceCountBefore);
      expect(
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        }),
      ).toEqual(activePointerBefore);

      const approved = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: inReview.governanceVersion,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [seeded.oldClaim.id],
      });
      expect(approved).toMatchObject({
        reviewStatus: ReviewStatus.APPROVED,
        governanceVersion: 3,
      });
    });

    it("ordinary ingestion invalidates published approval for unchanged new evidence", async () => {
      const seeded = await seedGovernedBonus(true);
      const job = await createIngestionJob(
        seeded.dataSource.id,
        seeded.sourceUrl,
      );
      vi.spyOn(ingestionInternals.bonusAgent, "run").mockResolvedValue(
        unchangedIngestionResult(),
      );

      const result = await IngestionService.handleExtraction({
        scrapeJobId: job.id,
        url: seeded.sourceUrl,
        casinoId: seeded.casino.id,
        scrapedContent:
          "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
        observedAt: seeded.now.toISOString(),
      });

      const after = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
        include: {
          active_extractions: {
            where: { extraction_context: BONUS_EXTRACTION_CONTEXT },
          },
        },
      });
      expect(result?.bonus).toMatchObject({
        id: seeded.bonus.id,
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
      });
      expect(after).toMatchObject({
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
        verified_at: seeded.bonus.verified_at,
      });
      expect(after.active_extractions).toHaveLength(1);
      expect(after.active_extractions[0].evidence_id).not.toBe(
        seeded.oldEvidence.id,
      );

      const invalidation = await database.workflowAuditEvent.findFirstOrThrow({
        where: {
          bonus_id: seeded.bonus.id,
          event_type: WorkflowEventType.MATERIAL_CHANGE_DETECTED,
          expected_version: 4,
          resulting_version: 5,
        },
        include: { evidence_claims: true },
      });
      const newClaimIds = await database.bonusEvidenceClaim.findMany({
        where: { evidence_id: after.active_extractions[0].evidence_id },
        select: { id: true },
      });
      expect(
        invalidation.evidence_claims
          .map((link) => link.bonus_evidence_claim_id)
          .sort(),
      ).toEqual(newClaimIds.map((claim) => claim.id).sort());
    });

    it("ordinary material-change ingestion preserves approved fields while invalidating their authority", async () => {
      const seeded = await seedGovernedBonus(true);
      const job = await createIngestionJob(
        seeded.dataSource.id,
        seeded.sourceUrl,
      );
      vi.spyOn(ingestionInternals.bonusAgent, "run").mockResolvedValue({
        ...unchangedIngestionResult(),
        headline_value: "100% up to £300",
        wagering_requirement: 50,
      });

      const result = await IngestionService.handleExtraction({
        scrapeJobId: job.id,
        url: seeded.sourceUrl,
        casinoId: seeded.casino.id,
        scrapedContent:
          "Get 100% up to £300 on first deposit. 50x wagering applies. Max conversion £1000.",
        observedAt: seeded.now.toISOString(),
      });

      const after = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
        include: {
          active_extractions: {
            where: { extraction_context: BONUS_EXTRACTION_CONTEXT },
          },
        },
      });
      expect(result?.bonus).toMatchObject({
        id: seeded.bonus.id,
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
      });
      expect(after).toMatchObject({
        headline_value: "100% up to £200",
        wagering_requirement: 35,
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 5,
      });
      expect(after.active_extractions).toHaveLength(1);
      expect(after.active_extractions[0].evidence_id).not.toBe(
        seeded.oldEvidence.id,
      );

      const newClaims = await database.bonusEvidenceClaim.findMany({
        where: { evidence_id: after.active_extractions[0].evidence_id },
      });
      expect(newClaims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: BonusEvidenceField.HEADLINE_VALUE,
            observed_value: "100% up to £300",
          }),
          expect.objectContaining({
            field: BonusEvidenceField.WAGERING_REQUIREMENT,
            observed_value: "50",
          }),
        ]),
      );
    });

    it.each([ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW])(
      "ordinary ingestion refuses %s without replacing evidence",
      async (reviewStatus) => {
        const seeded = await seedGovernedBonus(false);
        if (reviewStatus === ReviewStatus.IN_REVIEW) {
          await seeded.workflow.transitionBonusReview({
            subjectId: seeded.bonus.id,
            actorId: seeded.human.id,
            expectedVersion: 1,
            toStatus: ReviewStatus.IN_REVIEW,
          });
        }
        const before = await database.bonus.findUniqueOrThrow({
          where: { id: seeded.bonus.id },
        });
        const pointerBefore =
          await database.activeExtractionPointer.findUniqueOrThrow({
            where: {
              bonus_id_extraction_context: {
                bonus_id: seeded.bonus.id,
                extraction_context: BONUS_EXTRACTION_CONTEXT,
              },
            },
          });
        const evidenceCountBefore = await database.evidenceRecord.count();
        const job = await createIngestionJob(
          seeded.dataSource.id,
          seeded.sourceUrl,
        );
        vi.spyOn(ingestionInternals.bonusAgent, "run").mockResolvedValue(
          unchangedIngestionResult(),
        );

        await expect(
          IngestionService.handleExtraction({
            scrapeJobId: job.id,
            url: seeded.sourceUrl,
            casinoId: seeded.casino.id,
            scrapedContent: "Unchanged governed offer",
            observedAt: seeded.now.toISOString(),
          }),
        ).rejects.toMatchObject({
          code: "HUMAN_REVIEW_PENDING",
          reviewStatus,
        });

        expect(
          await database.bonus.findUniqueOrThrow({
            where: { id: seeded.bonus.id },
          }),
        ).toEqual(before);
        expect(
          await database.activeExtractionPointer.findUniqueOrThrow({
            where: {
              bonus_id_extraction_context: {
                bonus_id: seeded.bonus.id,
                extraction_context: BONUS_EXTRACTION_CONTEXT,
              },
            },
          }),
        ).toEqual(pointerBefore);
        expect(await database.evidenceRecord.count()).toBe(evidenceCountBefore);
      },
    );

    it("ordinary ingestion loses a deterministic race to human approval with no partial evidence", async () => {
      const seeded = await seedGovernedBonus(false);
      const reviewing = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: 1,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      const rejected = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: reviewing.governanceVersion,
        toStatus: ReviewStatus.REJECTED,
      });
      const pointerBefore =
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        });
      const evidenceCountBefore = await database.evidenceRecord.count();
      const job = await createIngestionJob(
        seeded.dataSource.id,
        seeded.sourceUrl,
      );
      let releaseExtraction!: () => void;
      const extractionReleased = new Promise<void>((resolve) => {
        releaseExtraction = resolve;
      });
      let signalExtraction!: () => void;
      const extractionEntered = new Promise<void>((resolve) => {
        signalExtraction = resolve;
      });
      vi.spyOn(ingestionInternals.bonusAgent, "run").mockImplementation(
        async () => {
          signalExtraction();
          await extractionReleased;
          return unchangedIngestionResult();
        },
      );

      const ingestion = IngestionService.handleExtraction({
        scrapeJobId: job.id,
        url: seeded.sourceUrl,
        casinoId: seeded.casino.id,
        scrapedContent: "Unchanged governed offer",
        observedAt: seeded.now.toISOString(),
      });
      await extractionEntered;

      const awaiting = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: rejected.governanceVersion,
        toStatus: ReviewStatus.AWAITING_REVIEW,
      });
      const inReview = await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: awaiting.governanceVersion,
        toStatus: ReviewStatus.IN_REVIEW,
      });
      await seeded.workflow.transitionBonusReview({
        subjectId: seeded.bonus.id,
        actorId: seeded.human.id,
        expectedVersion: inReview.governanceVersion,
        toStatus: ReviewStatus.APPROVED,
        claimIds: [seeded.oldClaim.id],
      });
      releaseExtraction();

      await expect(ingestion).rejects.toMatchObject({
        code: "STALE_GOVERNANCE_VERSION",
      });
      const after = await database.bonus.findUniqueOrThrow({
        where: { id: seeded.bonus.id },
      });
      expect(after).toMatchObject({
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 6,
        verified_at: seeded.bonus.verified_at,
      });
      expect(
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        }),
      ).toEqual(pointerBefore);
      expect(await database.evidenceRecord.count()).toBe(evidenceCountBefore);
    });

    it("failed ordinary extraction leaves pointer and freshness unchanged", async () => {
      const seeded = await seedGovernedBonus(true);
      const pointerBefore =
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        });
      const evidenceCountBefore = await database.evidenceRecord.count();
      const job = await createIngestionJob(
        seeded.dataSource.id,
        seeded.sourceUrl,
      );
      vi.spyOn(ingestionInternals.bonusAgent, "run").mockRejectedValue(
        new Error("deterministic extraction failure"),
      );

      await expect(
        IngestionService.handleExtraction({
          scrapeJobId: job.id,
          url: seeded.sourceUrl,
          casinoId: seeded.casino.id,
          scrapedContent: "invalid extraction",
          observedAt: seeded.now.toISOString(),
        }),
      ).rejects.toThrow("deterministic extraction failure");

      expect(
        await database.activeExtractionPointer.findUniqueOrThrow({
          where: {
            bonus_id_extraction_context: {
              bonus_id: seeded.bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
        }),
      ).toEqual(pointerBefore);
      expect(await database.evidenceRecord.count()).toBe(evidenceCountBefore);
      expect(
        await database.bonus.findUniqueOrThrow({
          where: { id: seeded.bonus.id },
          select: { verified_at: true },
        }),
      ).toEqual({ verified_at: seeded.bonus.verified_at });
    });
  },
  30_000,
);
