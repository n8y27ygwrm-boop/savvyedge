import { PublicationStatus, ReviewStatus, prisma } from "@savvyedge/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BonusService } from "../src/services/bonus.service";
import { IngestionService } from "../src/services/ingestion.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";

const URL = "https://casino.example/promotions/welcome";
const CASINO_ID = "casino-governed";
const BONUS_ID = "bonus-governed";
const SCRAPE_JOB_ID = "scrape-governed";
const OBSERVED_AT = "2026-09-16T12:00:00.000Z";

const internals = IngestionService as unknown as {
  bonusAgent: { run(input: unknown): Promise<unknown> };
  casinoResolutionAgent: { run(input: unknown): Promise<unknown> };
  performExtraction(input: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    observedAt: string;
  }): Promise<unknown>;
  runGovernedPersistenceTransaction<T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T>;
};

function governedBonus(
  reviewStatus: ReviewStatus,
  publicationStatus?: PublicationStatus,
) {
  return {
    id: BONUS_ID,
    casino_id: CASINO_ID,
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 1000,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
    verified_at: new Date("2026-09-15T12:00:00.000Z"),
    source_offer_key: "bonus-url-v1:test",
    review_status: reviewStatus,
    publication_status:
      publicationStatus ??
      (reviewStatus === ReviewStatus.APPROVED
        ? PublicationStatus.PUBLISHED
        : PublicationStatus.UNPUBLISHED),
    governance_version: 7,
  };
}

function arrange(
  reviewStatus: ReviewStatus,
  publicationStatus?: PublicationStatus,
) {
  const bonus = governedBonus(reviewStatus, publicationStatus);
  const scrapeJob = {
    id: SCRAPE_JOB_ID,
    data_source_id: "source-1",
    canonical_url: URL,
    snapshot_path: "test://ingestion/governed.html",
    html_hash: "a".repeat(64),
    content_hash: "b".repeat(64),
  };
  const transaction = {
    reviewActor: {
      upsert: vi.fn().mockResolvedValue({ id: "actor-ingestion" }),
    },
    scrapeJob: {
      findUnique: vi.fn().mockResolvedValue(scrapeJob),
      update: vi.fn().mockResolvedValue({}),
    },
    evidenceRecord: {
      create: vi.fn().mockResolvedValue({ id: "evidence-new" }),
    },
    bonusEvidenceClaim: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: `claim-${data.field}`,
      })),
    },
    activeExtractionPointer: {
      upsert: vi.fn().mockResolvedValue({ id: "pointer-1" }),
    },
  };

  vi.spyOn(prisma.casino, "findUnique").mockResolvedValue({
    id: CASINO_ID,
    name: "Governed Casino",
    website_url: "https://casino.example",
    license_info: null,
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    governance_version: 4,
  } as never);
  vi.spyOn(prisma.scrapeJob, "findUnique").mockResolvedValue(
    scrapeJob as never,
  );
  vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(bonus as never);
  vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([bonus] as never);
  vi.spyOn(internals.bonusAgent, "run").mockResolvedValue({
    casino_id: CASINO_ID,
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 1000,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
  });
  vi.spyOn(BonusService, "saveGovernedBonus").mockResolvedValue({
    bonus,
    isNew: false,
    isApprovedOrPublished: false,
    hasFieldDiffs: false,
  } as never);
  vi.spyOn(internals, "runGovernedPersistenceTransaction").mockImplementation(
    (operation) => operation(transaction),
  );

  return { bonus, transaction };
}

async function extract(casinoId: string | null = CASINO_ID) {
  return internals.performExtraction({
    scrapeJobId: SCRAPE_JOB_ID,
    url: URL,
    casinoId: casinoId ?? undefined,
    scrapedContent: "Get 100% up to £200. 35x wagering.",
    observedAt: OBSERVED_AT,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ordinary ingestion active-evidence governance", () => {
  it.each([PublicationStatus.PUBLISHED, PublicationStatus.UNPUBLISHED])(
    "invalidates approval for unchanged new evidence while %s",
    async (publicationStatus) => {
      const { transaction } = arrange(ReviewStatus.APPROVED, publicationStatus);
      const transition = vi
        .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
        .mockResolvedValue({
          subjectId: BONUS_ID,
          workflowEventId: "workflow-1",
          reviewStatus: ReviewStatus.AWAITING_REVIEW,
          publicationStatus: PublicationStatus.UNPUBLISHED,
          governanceVersion: 8,
        });

      const result = (await extract()) as {
        bonus: {
          review_status: ReviewStatus;
          publication_status: PublicationStatus;
          governance_version: number;
        };
      };

      expect(transition).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: BONUS_ID,
          expectedVersion: 7,
          toStatus: ReviewStatus.AWAITING_REVIEW,
        }),
      );
      expect(transaction.activeExtractionPointer.upsert).toHaveBeenCalledOnce();
      expect(result.bonus).toMatchObject({
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 8,
      });
    },
  );

  it.each([ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW])(
    "refuses %s before evidence or pointer mutation",
    async (reviewStatus) => {
      const { transaction } = arrange(reviewStatus);

      await expect(extract()).rejects.toMatchObject({
        code: "HUMAN_REVIEW_PENDING",
        reviewStatus,
      });

      expect(transaction.evidenceRecord.create).not.toHaveBeenCalled();
      expect(transaction.bonusEvidenceClaim.create).not.toHaveBeenCalled();
      expect(transaction.activeExtractionPointer.upsert).not.toHaveBeenCalled();
    },
  );

  it("rolls back when human approval wins during machine extraction", async () => {
    const { bonus, transaction } = arrange(ReviewStatus.REJECTED);
    vi.mocked(BonusService.saveGovernedBonus).mockResolvedValue({
      bonus: {
        ...bonus,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: bonus.governance_version + 1,
      },
      isNew: false,
      isApprovedOrPublished: true,
      hasFieldDiffs: false,
    } as never);

    await expect(extract()).rejects.toMatchObject({
      code: "STALE_GOVERNANCE_VERSION",
    });

    expect(transaction.evidenceRecord.create).not.toHaveBeenCalled();
    expect(transaction.bonusEvidenceClaim.create).not.toHaveBeenCalled();
    expect(transaction.activeExtractionPointer.upsert).not.toHaveBeenCalled();
  });

  it("treats a Bonus absent from the pre-extraction snapshot as stale when one appears", async () => {
    const { bonus, transaction } = arrange(ReviewStatus.REJECTED);
    vi.mocked(prisma.bonus.findUnique).mockResolvedValue(null);
    vi.mocked(BonusService.saveGovernedBonus).mockResolvedValue({
      bonus: {
        ...bonus,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: bonus.governance_version + 1,
      },
      isNew: false,
      isApprovedOrPublished: true,
      hasFieldDiffs: false,
    } as never);

    await expect(extract()).rejects.toMatchObject({
      code: "STALE_GOVERNANCE_VERSION",
    });
    expect(transaction.evidenceRecord.create).not.toHaveBeenCalled();
    expect(transaction.activeExtractionPointer.upsert).not.toHaveBeenCalled();
  });

  it("captures authority for discovery ingestion without a supplied casinoId", async () => {
    const { bonus, transaction } = arrange(ReviewStatus.REJECTED);
    vi.spyOn(internals.casinoResolutionAgent, "run").mockResolvedValue({
      name: "Governed Casino",
      slug: "governed-casino",
      domain: "casino.example",
      website_url: "https://casino.example",
      license_info: null,
    });
    vi.spyOn(prisma.casino, "findFirst").mockResolvedValue({
      id: CASINO_ID,
      name: "Governed Casino",
      slug: "governed-casino",
      website_url: "https://casino.example",
      license_info: null,
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
      governance_version: 4,
    } as never);
    vi.mocked(BonusService.saveGovernedBonus).mockResolvedValue({
      bonus: {
        ...bonus,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: bonus.governance_version + 1,
      },
      isNew: false,
      isApprovedOrPublished: true,
      hasFieldDiffs: false,
    } as never);

    await expect(extract(null)).rejects.toMatchObject({
      code: "STALE_GOVERNANCE_VERSION",
    });
    expect(internals.casinoResolutionAgent.run).toHaveBeenCalledOnce();
    expect(
      vi.mocked(prisma.bonus.findMany).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(internals.casinoResolutionAgent.run).mock
        .invocationCallOrder[0],
    );
    expect(transaction.evidenceRecord.create).not.toHaveBeenCalled();
    expect(transaction.activeExtractionPointer.upsert).not.toHaveBeenCalled();
  });
});
