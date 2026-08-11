import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceVerdict,
  Prisma,
  PublicationStatus,
  ReviewStatus,
  prisma,
} from "@savvyedge/database";
import { BonusReverificationService } from "../src/services/bonus-reverification.service";
import { OrchestratorService } from "../src/services/orchestrator.service";
import { ScraperAgent } from "@savvyedge/ai-agents";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";
import { WorkflowTransitionError } from "../src/services/workflow-transition.errors";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";

describe("D3B BonusReverificationService (Deterministic True Re-Verification)", () => {
  const FIXED_NOW_T1 = new Date("2026-08-10T10:00:00.000Z");
  const FIXED_NOW_T2 = new Date("2026-08-10T14:00:00.000Z");
  const SOURCE_URL = "https://apexcasino.example.test/welcome-terms";
  const SOURCE_OFFER_KEY = createBonusSourceOfferKey(SOURCE_URL);

  const baseCasino = {
    id: "casino-rev-1",
    slug: "apex-casino",
    name: "Apex Casino",
    website_url: "https://apexcasino.example.test",
    status: "ACTIVE",
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    governance_version: 2,
    verified_at: FIXED_NOW_T1,
    licenses: [
      {
        id: "lic-rev-1",
        status: "ACTIVE",
        verified_at: FIXED_NOW_T1,
        license_no: "LIC-APEX-1",
        review_status: ReviewStatus.APPROVED,
      },
    ],
    history_events: [
      {
        event_type: "VERIFICATION",
        source_url: "https://regulator.example.test/apex",
        occurred_at: FIXED_NOW_T1,
      },
    ],
  };

  const createMockApprovedBonus = (overrides?: Partial<any>) => ({
    id: "bonus-rev-1",
    casino_id: baseCasino.id,
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 1000,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
    source_offer_key: SOURCE_OFFER_KEY,
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    governance_version: 2,
    verified_at: new Date("2026-08-01T00:00:00.000Z"), // Stale verified_at (> 72h ago)
    casino: baseCasino,
    evidence_claims: [
      {
        id: "claim-1",
        field: "HEADLINE_VALUE",
        observed_value: "100% up to £200",
        verdict: EvidenceVerdict.SUPPORTS,
        created_at: new Date("2026-08-01T00:00:00.000Z"),
        evidence: {
          id: "ev-1",
          source_url: SOURCE_URL,
          content_hash: "hash-initial",
          observed_at: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
    ],
    history_events: [
      {
        id: "hist-1",
        field_changed: "verified_at",
        old_value: null,
        new_value: "2026-08-01T00:00:00.000Z",
        changed_at: new Date("2026-08-01T00:00:00.000Z"),
        source_url: SOURCE_URL,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Mock license assertion to succeed by default
    vi.spyOn(
      WorkflowTransitionService.prototype,
      "assertCasinoHasOneEligibleLicense",
    ).mockResolvedValue(undefined);
  });

  it("1. UNCHANGED SOURCE: renews verified_at, preserves governance, creates evidence and history", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    let updatedBonusData: any = null;
    let createdHistoryData: any = null;
    let createdEvidenceData: any = null;
    const createdClaims: any[] = [];

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdEvidenceData = data;
              return { id: "ev-fresh-1", ...data };
            }),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdClaims.push(data);
              return { id: `claim-${createdClaims.length}`, ...data };
            }),
          },
          bonus: {
            updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
              updatedBonusData = data;
              return { count: 1 };
            }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdHistoryData = data;
              return { id: "hist-fresh-1", ...data };
            }),
          },
        };
        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: SOURCE_URL,
        title: "Apex Casino Welcome Bonus Offer",
        content:
          "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
        contentHash: "hash-matching-content",
        htmlHash: "hash-matching-html",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to £200",
        type: "WELCOME",
        wagering_requirement: 35,
        max_conversion: 1000,
        valid_from: null,
        valid_until: null,
        status: "ACTIVE",
      }),
    };

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("VERIFIED_UNCHANGED");
    if (result.status === "VERIFIED_UNCHANGED") {
      expect(result.verifiedAt).toEqual(FIXED_NOW_T1);
      expect(result.evidenceRecordId).toBe("ev-fresh-1");
    }

    // 1. Bonus.verified_at updated to evaluation now
    expect(updatedBonusData).toBeDefined();
    expect(updatedBonusData.verified_at).toEqual(FIXED_NOW_T1);
    expect(updatedBonusData.status).toBeUndefined();
    expect(updatedBonusData.review_status).toBeUndefined();
    expect(updatedBonusData.publication_status).toBeUndefined();
    expect(updatedBonusData.governance_version).toBeUndefined();

    // 2. Fresh EvidenceRecord created with exact snapshot
    expect(createdEvidenceData).toBeDefined();
    expect(createdEvidenceData.source_url).toBe(SOURCE_URL);
    expect(createdEvidenceData.content_hash).toBe("hash-matching-content");

    // 3. verified_at BonusHistoryEvent created
    expect(createdHistoryData).toBeDefined();
    expect(createdHistoryData.field_changed).toBe("verified_at");
    expect(createdHistoryData.new_value).toBe(FIXED_NOW_T1.toISOString());
    expect(createdHistoryData.source_url).toBe(SOURCE_URL);

    // 4. PublicationGate passes with renewed verified_at and fresh history event
    const postReverificationBonus = {
      ...initialBonus,
      verified_at: FIXED_NOW_T1,
      history_events: [
        {
          id: "hist-fresh-1",
          field_changed: "verified_at",
          old_value: initialBonus.verified_at.toISOString(),
          new_value: FIXED_NOW_T1.toISOString(),
          changed_at: FIXED_NOW_T1,
          source_url: SOURCE_URL,
        },
      ],
    };
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        postReverificationBonus,
        baseCasino,
        FIXED_NOW_T1,
      ),
    ).toBe(true);
  });

  it("2. MATERIAL WAGERING CHANGE: does not advance verified_at, preserves governed terms, transitions to AWAITING_REVIEW", async () => {
    const initialBonus = createMockApprovedBonus({ wagering_requirement: 35 });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    const createdHistoryDiffs: any[] = [];
    const createdClaims: any[] = [];
    let reviewCasWhere: any = null;
    let workflowAuditData: any = null;
    const workflowClaimLinks: any[] = [];
    const governedState = { ...initialBonus };

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const evidence = {
          id: "ev-diff-1",
          source_url: SOURCE_URL,
          observed_at: FIXED_NOW_T1,
          extracted_at: FIXED_NOW_T1,
          valid_from: null,
          expires_at: null,
        };
        const mockTx: any = {
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
            findUnique: vi.fn().mockResolvedValue({
              id: "actor-service-reverification",
              kind: "SERVICE",
              active: true,
            }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockResolvedValue(evidence),
            findMany: vi.fn().mockResolvedValue([evidence]),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              const claim = {
                id: `claim-diff-${createdClaims.length + 1}`,
                ...data,
              };
              createdClaims.push(claim);
              return claim;
            }),
            findMany: vi
              .fn()
              .mockImplementation(async ({ where }: any) =>
                createdClaims.filter((claim) => where.id.in.includes(claim.id)),
              ),
          },
          bonus: {
            findUnique: vi.fn().mockImplementation(async () => governedState),
            updateMany: vi
              .fn()
              .mockImplementation(async ({ where, data }: any) => {
                reviewCasWhere = where;
                if (
                  governedState.governance_version !==
                    where.governance_version ||
                  governedState.review_status !== where.review_status ||
                  governedState.publication_status !== where.publication_status
                ) {
                  return { count: 0 };
                }
                governedState.review_status = data.review_status;
                governedState.publication_status = data.publication_status;
                governedState.governance_version +=
                  data.governance_version.increment;
                return { count: 1 };
              }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              createdHistoryDiffs.push(data);
              return { id: `hist-diff-${createdHistoryDiffs.length}`, ...data };
            }),
          },
          workflowAuditEvent: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              workflowAuditData = data;
              return { id: "wf-event-1" };
            }),
          },
          workflowEventClaim: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              workflowClaimLinks.push(data);
              return data;
            }),
          },
        };

        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: SOURCE_URL,
        title: "Apex Casino Welcome Bonus Offer",
        content:
          "Get 100% up to £200 on first deposit. Wagering requirement is now 40x. Max conversion £1000.",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to £200",
        type: "WELCOME",
        wagering_requirement: 40, // Changed from 35 to 40!
        max_conversion: 1000,
        valid_from: null,
        valid_until: null,
        status: "ACTIVE",
      }),
    };

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("MATERIAL_CHANGE_DETECTED");
    if (result.status === "MATERIAL_CHANGE_DETECTED") {
      expect(result.diffs).toEqual([
        {
          field: "wagering_requirement",
          oldVal: "35",
          newVal: "40",
        },
      ]);
      expect(result.reviewStatus).toBe(ReviewStatus.AWAITING_REVIEW);
      expect(result.governanceVersion).toBe(3); // Incremented from 2 to 3
    }

    // 1. verified_at was NOT updated
    expect(governedState.wagering_requirement).toBe(35);
    expect(governedState.verified_at).toEqual(initialBonus.verified_at);
    expect(governedState.publication_status).toBe(PublicationStatus.PUBLISHED);

    // 2. Diff recorded in BonusHistoryEvent
    expect(createdHistoryDiffs.length).toBe(1);
    expect(createdHistoryDiffs[0].field_changed).toBe("wagering_requirement");
    expect(createdHistoryDiffs[0].old_value).toBe("35");
    expect(createdHistoryDiffs[0].new_value).toBe("40");

    // 3. Actual WorkflowTransitionService semantics executed with CAS and audit links
    expect(reviewCasWhere).toMatchObject({
      id: initialBonus.id,
      governance_version: 2,
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
    });
    expect(workflowAuditData).toMatchObject({
      bonus_id: initialBonus.id,
      expected_version: 2,
      resulting_version: 3,
      from_review_status: ReviewStatus.APPROVED,
      to_review_status: ReviewStatus.AWAITING_REVIEW,
      from_publication_status: PublicationStatus.PUBLISHED,
      to_publication_status: PublicationStatus.PUBLISHED,
    });
    expect(workflowClaimLinks).toHaveLength(createdClaims.length);

    // 4. PublicationGate fails closed because review_status is AWAITING_REVIEW
    const postTransitionBonus = {
      ...initialBonus,
      review_status: ReviewStatus.AWAITING_REVIEW,
      governance_version: 3,
    };
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        postTransitionBonus,
        baseCasino,
        FIXED_NOW_T1,
      ),
    ).toBe(false);
  });

  it("3. OFFER BECOMES INACTIVE: does not silently overwrite approved status, transitions to AWAITING_REVIEW", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    let transitionCommand: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockResolvedValue({ id: "ev-inactive-1" }),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockResolvedValue({ id: "claim-inactive-1" }),
          },
          bonus: {
            update: vi.fn(),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockResolvedValue({ id: "hist-inactive-1" }),
          },
        };

        vi.spyOn(
          WorkflowTransitionService.prototype,
          "transitionBonusReview",
        ).mockImplementation(async (cmd) => {
          transitionCommand = cmd;
          return {
            subjectId: cmd.subjectId,
            workflowEventId: "wf-event-2",
            reviewStatus: ReviewStatus.AWAITING_REVIEW,
            publicationStatus: PublicationStatus.PUBLISHED,
            governanceVersion: cmd.expectedVersion + 1,
          };
        });

        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: SOURCE_URL,
        title: "Promotion Ended",
        content:
          "This promotional bonus offer has expired and is no longer available.",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to £200",
        type: "WELCOME",
        wagering_requirement: 35,
        max_conversion: 1000,
        valid_from: null,
        valid_until: null,
        status: "INACTIVE", // Source indicates offer is inactive
      }),
    };

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("OFFER_INACTIVE");
    expect(transitionCommand).toBeDefined();
    expect(transitionCommand.toStatus).toBe(ReviewStatus.AWAITING_REVIEW);

    // PublicationGate immediately fails closed
    const inactiveAwaitingBonus = {
      ...initialBonus,
      review_status: ReviewStatus.AWAITING_REVIEW,
    };
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        inactiveAwaitingBonus,
        baseCasino,
        FIXED_NOW_T1,
      ),
    ).toBe(false);
  });

  it("4. SOURCE PAGE REJECTED: anti-bot/geo-block fails closed without mutating verified_at or governance", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const txSpy = vi.spyOn(prisma, "$transaction");

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: "https://apexcasino.example.test/restricted",
        title: "Access Denied - Cloudflare Ray ID",
        content:
          "Attention Required! Cloudflare verify that you are human to continue.",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("SOURCE_REJECTED");
    if (result.status === "SOURCE_REJECTED") {
      expect(result.category).toBe("ANTI_BOT");
    }

    // Zero database mutations
    expect(txSpy).not.toHaveBeenCalled();
  });

  it("5. EXTRACTION FAILURE: fails closed without touching verified_at", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const txSpy = vi.spyOn(prisma, "$transaction");

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: SOURCE_URL,
        title: "Apex Casino Promotions",
        content: "Welcome to Apex Casino. Terms apply.",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const mockFailingAgent = {
      run: vi.fn().mockRejectedValue(new Error("LLM Rate Limit Exceeded")),
    };

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockFailingAgent,
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("EXTRACTION_FAILED");
    expect(txSpy).not.toHaveBeenCalled();
  });

  it("6. NO AUTHORITATIVE SOURCE URL: fails closed if no URL can be recovered", async () => {
    const bonusNoUrl = createMockApprovedBonus({
      source_offer_key: null,
      evidence_claims: [],
      history_events: [],
    });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(bonusNoUrl as any);

    const result = await BonusReverificationService.reverifyBonus(
      bonusNoUrl.id,
      {
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("NO_AUTHORITATIVE_SOURCE_URL");
  });

  it("7. WRONG / MISMATCHED SOURCE URL: rejects URL that does not match stored source_offer_key", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        overrideSourceUrl: "https://fraudulent-source.example.test/bonus",
        now: FIXED_NOW_T1,
      },
    );

    expect(result.status).toBe("SOURCE_IDENTITY_MISMATCH");
  });

  it("8. REPEAT IDENTICAL REVERIFICATION: advances verified_at at T1 and T2 with separate immutable records", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    const verifiedAtTimestamps: Date[] = [];
    const evidenceIds: string[] = [];

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockImplementation(async () => {
              const id = `ev-seq-${evidenceIds.length + 1}`;
              evidenceIds.push(id);
              return { id };
            }),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockResolvedValue({ id: "claim-1" }),
          },
          bonus: {
            updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
              verifiedAtTimestamps.push(data.verified_at);
              return { count: 1 };
            }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockResolvedValue({ id: "hist-1" }),
          },
        };
        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          url: SOURCE_URL,
          finalUrl: SOURCE_URL,
          title: "Apex Casino Welcome Bonus Offer",
          content:
            "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
          timestamp: FIXED_NOW_T1,
        })
        .mockResolvedValueOnce({
          url: SOURCE_URL,
          finalUrl: SOURCE_URL,
          title: "Apex Casino Welcome Bonus Offer",
          content:
            "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
          timestamp: FIXED_NOW_T2,
        }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to £200",
        type: "WELCOME",
        wagering_requirement: 35,
        max_conversion: 1000,
        valid_from: null,
        valid_until: null,
        status: "ACTIVE",
      }),
    };

    // First verification at T1
    const res1 = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T1,
      },
    );
    expect(res1.status).toBe("VERIFIED_UNCHANGED");

    // Second verification at T2
    const res2 = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T2,
      },
    );
    expect(res2.status).toBe("VERIFIED_UNCHANGED");

    // Both evaluations succeeded deterministically at distinct instants
    expect(verifiedAtTimestamps).toEqual([FIXED_NOW_T1, FIXED_NOW_T2]);
    expect(evidenceIds).toEqual(["ev-seq-1", "ev-seq-2"]);
  });

  it("9. CONCURRENT GOVERNANCE VERSION CHANGE: fails CAS safely during material-change transition", async () => {
    const initialBonus = createMockApprovedBonus({ governance_version: 2 });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockResolvedValue({ id: "ev-1" }),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockResolvedValue({ id: "claim-1" }),
          },
          bonus: {
            update: vi.fn(),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockResolvedValue({ id: "hist-1" }),
          },
        };

        // Mock CAS concurrency failure
        vi.spyOn(
          WorkflowTransitionService.prototype,
          "transitionBonusReview",
        ).mockRejectedValue(
          new WorkflowTransitionError("STALE_GOVERNANCE_VERSION"),
        );

        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi.fn().mockResolvedValue({
        url: SOURCE_URL,
        finalUrl: SOURCE_URL,
        title: "Changed Terms",
        content: "Now 50x wagering applies.",
        timestamp: FIXED_NOW_T1,
      }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to £200",
        type: "WELCOME",
        wagering_requirement: 50,
        max_conversion: 1000,
        valid_from: null,
        valid_until: null,
        status: "ACTIVE",
      }),
    };

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: mockScraper,
        bonusAgent: mockBonusAgent,
        now: FIXED_NOW_T1,
      }),
    ).rejects.toThrow(
      "The governed subject changed before this transition could be applied.",
    );
  });

  it("10. FALSE-FRESHNESS REGRESSION: production VALIDATE_BONUS cannot advance verified_at without observing live source", async () => {
    const staleBonus = createMockApprovedBonus({
      verified_at: new Date("2026-07-01T00:00:00.000Z"), // Very stale
    });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(staleBonus as any);
    const updateSpy = vi.spyOn(prisma.bonus, "update");
    const updateManySpy = vi.spyOn(prisma.bonus, "updateMany");
    const transactionSpy = vi.spyOn(prisma, "$transaction");

    const scrapeSpy = vi
      .spyOn(ScraperAgent.prototype, "run")
      .mockRejectedValue(new Error("ETIMEDOUT"));

    const handlers = OrchestratorService.getQueueHandlers([]);
    await handlers.VALIDATE_BONUS({
      bonusId: staleBonus.id,
      url: SOURCE_URL,
    });

    expect(scrapeSpy).toHaveBeenCalledWith({ url: SOURCE_URL });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(updateManySpy).not.toHaveBeenCalled();

    // Bonus remains stale and fails publication gate
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        staleBonus,
        baseCasino,
        FIXED_NOW_T1,
      ),
    ).toBe(false);
  });

  it("11. resolves the newest matching supporting evidence deterministically and ignores unverified history", () => {
    const olderUrl = "https://apexcasino.example.test/older-offer";
    const newestUrl = SOURCE_URL;
    const sourceKey = createBonusSourceOfferKey(newestUrl);

    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl({
      source_offer_key: sourceKey,
      evidence_claims: [
        {
          id: "claim-newest",
          verdict: EvidenceVerdict.SUPPORTS,
          created_at: new Date("2026-08-09T00:00:00.000Z"),
          evidence: {
            id: "evidence-newest",
            source_url: newestUrl,
            observed_at: new Date("2026-08-09T00:00:00.000Z"),
          },
        },
        {
          id: "claim-mismatched",
          verdict: EvidenceVerdict.SUPPORTS,
          created_at: new Date("2026-08-10T00:00:00.000Z"),
          evidence: {
            id: "evidence-mismatched",
            source_url: olderUrl,
            observed_at: new Date("2026-08-10T00:00:00.000Z"),
          },
        },
      ],
      history_events: [
        {
          id: "history-diff",
          field_changed: "wagering_requirement",
          source_url: olderUrl,
          changed_at: new Date("2026-08-11T00:00:00.000Z"),
        },
      ],
    });

    expect(resolved).toEqual({ url: newestUrl });
  });

  it("12. rejects a stale scraper timestamp before opening a write transaction", async () => {
    const initialBonus = createMockApprovedBonus();
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transactionSpy = vi.spyOn(prisma, "$transaction");

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Apex Casino Welcome Bonus Offer",
            content: "Get 100% up to £200. 35x wagering applies.",
            timestamp: FIXED_NOW_T1,
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
        now: FIXED_NOW_T2,
      },
    );

    expect(result.status).toBe("SOURCE_REJECTED");
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("13. unchanged renewal uses a governed-state CAS and fails safely on conflict", async () => {
    const initialBonus = createMockApprovedBonus();
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    let casWhere: any = null;
    const historyCreate = vi.fn();

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) =>
      callback({
        reviewActor: {
          upsert: vi
            .fn()
            .mockResolvedValue({ id: "actor-service-reverification" }),
        },
        dataSource: {
          findFirst: vi.fn().mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
        },
        evidenceRecord: {
          create: vi.fn().mockResolvedValue({ id: "evidence-conflict" }),
        },
        bonusEvidenceClaim: {
          create: vi.fn().mockResolvedValue({ id: "claim-conflict" }),
        },
        bonus: {
          updateMany: vi.fn().mockImplementation(async ({ where }: any) => {
            casWhere = where;
            return { count: 0 };
          }),
        },
        bonusHistoryEvent: { create: historyCreate },
      }),
    );

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Apex Casino Welcome Bonus Offer",
            content: "Get 100% up to £200. 35x wagering applies.",
            timestamp: FIXED_NOW_T1,
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
        now: FIXED_NOW_T1,
      }),
    ).rejects.toThrow(
      "The governed subject changed before this transition could be applied.",
    );

    expect(casWhere).toMatchObject({
      id: initialBonus.id,
      governance_version: 2,
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
      wagering_requirement: 35,
      verified_at: initialBonus.verified_at,
    });
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it("14. repeated material observation while already awaiting review records evidence without a duplicate transition", async () => {
    const initialBonus = createMockApprovedBonus({
      review_status: ReviewStatus.AWAITING_REVIEW,
      governance_version: 3,
    });
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transitionSpy = vi.spyOn(
      WorkflowTransitionService.prototype,
      "transitionBonusReview",
    );
    let repeatedCasData: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) =>
      callback({
        reviewActor: {
          upsert: vi
            .fn()
            .mockResolvedValue({ id: "actor-service-reverification" }),
        },
        dataSource: {
          findFirst: vi.fn().mockResolvedValue({ id: "ds-1", url: SOURCE_URL }),
        },
        evidenceRecord: {
          create: vi.fn().mockResolvedValue({ id: "evidence-repeat-change" }),
        },
        bonusEvidenceClaim: {
          create: vi.fn().mockResolvedValue({ id: "claim-repeat-change" }),
        },
        bonusHistoryEvent: {
          create: vi.fn().mockResolvedValue({ id: "history-repeat-change" }),
        },
        bonus: {
          updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
            repeatedCasData = data;
            return { count: 1 };
          }),
        },
      }),
    );

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Changed offer terms",
            content: "Get 100% up to £200. Wagering is now 40x.",
            timestamp: FIXED_NOW_T1,
          }),
        },
        bonusAgent: {
          run: vi.fn().mockResolvedValue({
            headline_value: "100% up to £200",
            type: "WELCOME",
            wagering_requirement: 40,
            max_conversion: 1000,
            valid_from: null,
            valid_until: null,
            status: "ACTIVE",
          }),
        },
        now: FIXED_NOW_T1,
      },
    );

    expect(result).toMatchObject({
      status: "MATERIAL_CHANGE_DETECTED",
      reviewStatus: ReviewStatus.AWAITING_REVIEW,
      governanceVersion: 3,
    });
    expect(transitionSpy).not.toHaveBeenCalled();
    expect(repeatedCasData).toEqual({ updated_at: FIXED_NOW_T1 });
  });
});
