import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceVerdict,
  Prisma,
  PublicationStatus,
  ReviewStatus,
  WorkflowEventType,
  prisma,
} from "@savvyedge/database";
import { BonusReverificationService } from "../src/services/bonus-reverification.service";
import { OrchestratorService } from "../src/services/orchestrator.service";
import { ScraperAgent } from "@savvyedge/ai-agents";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { WorkflowTransitionService } from "../src/services/workflow-transition.service";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";
import { EvidenceArtifactStorageService } from "../src/services/evidence-artifact-storage.service";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";

describe("D3B BonusReverificationService (Deterministic True Re-Verification)", () => {
  const FIXED_NOW_T1 = new Date("2026-08-10T10:00:00.000Z");
  const FIXED_NOW_T2 = new Date("2026-08-10T14:00:00.000Z");
  const SOURCE_URL = "https://apexcasino.example.test/welcome-terms";
  const REQUESTED_SOURCE_URL =
    "https://apexcasino.example.test/go/welcome-terms";
  const SOURCE_OFFER_KEY = createBonusSourceOfferKey(SOURCE_URL);
  const TEST_HTML_HASH = "a".repeat(64);
  const TEST_CONTENT_HASH = "b".repeat(64);

  const activePointerTx = () => ({
    activeExtractionPointer: {
      upsert: vi.fn().mockResolvedValue({ id: "active-pointer" }),
    },
  });

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
          content_hash: TEST_CONTENT_HASH,
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
    vi.spyOn(
      EvidenceArtifactStorageService,
      "persistObservation",
    ).mockResolvedValue({
      locator: "supabase://savvyedge-evidence/v1/d3b-observation.html",
      htmlHash: TEST_HTML_HASH,
      byteSize: 256,
    });

    // Mock license assertion to succeed by default
    vi.spyOn(
      WorkflowTransitionService.prototype,
      "assertCasinoHasOneEligibleLicense",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. UNCHANGED SOURCE: projects scraper observed_at rather than later extraction time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_T1);
    const initialBonus = createMockApprovedBonus({
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: new Date("2026-08-01T00:00:00.000Z"),
        sourceUrl: REQUESTED_SOURCE_URL,
        scrapeJobId: "scrape-initial-canonical",
        canonicalUrl: SOURCE_URL,
      }),
    });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    const transitionBonusReview = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockResolvedValue({
        subjectId: initialBonus.id,
        workflowEventId: "workflow-review-required",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
        publicationStatus: PublicationStatus.UNPUBLISHED,
        governanceVersion: 3,
      });

    let updatedBonusData: any = null;
    let createdHistoryData: any = null;
    let createdEvidenceData: any = null;
    let activePointerInput: any = null;
    let bonusCasWhere: any = null;
    const createdClaims: any[] = [];

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          ...activePointerTx(),
          activeExtractionPointer: {
            upsert: vi.fn().mockImplementation(async (input: any) => {
              activePointerInput = input;
              return { id: "active-pointer" };
            }),
          },
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
            findUnique: vi.fn().mockResolvedValue(initialBonus),
            updateMany: vi
              .fn()
              .mockImplementation(async ({ where, data }: any) => {
                bonusCasWhere = where;
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
      run: vi.fn().mockImplementation(async () => {
        // Extraction finishes four hours after the live page was observed.
        vi.setSystemTime(FIXED_NOW_T2);
        return {
          url: SOURCE_URL,
          finalUrl: SOURCE_URL,
          title: "Apex Casino Welcome Bonus Offer",
          content:
            "Get 100% up to £200 on first deposit. 35x wagering applies. Max conversion £1000.",
          contentHash: TEST_CONTENT_HASH,
          htmlHash: TEST_HTML_HASH,
          timestamp: FIXED_NOW_T1,
        };
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
      },
    );

    expect(result.status).toBe("VERIFIED_UNCHANGED");
    if (result.status === "VERIFIED_UNCHANGED") {
      expect(result.verifiedAt).toEqual(FIXED_NOW_T1);
      expect(result.evidenceRecordId).toBe("ev-fresh-1");
      expect(result).toMatchObject({
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
        publicationStatus: PublicationStatus.UNPUBLISHED,
        governanceVersion: 3,
        humanApprovalRequired: true,
      });
    }

    expect(transitionBonusReview).toHaveBeenCalledWith({
      subjectId: initialBonus.id,
      actorId: "actor-service-reverification",
      expectedVersion: 2,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      claimIds: createdClaims.map((_claim, index) => `claim-${index + 1}`),
      internalReason:
        "A fresh automated observation requires renewed human approval",
    });

    // 1. Bonus.verified_at projects observation time, while updated_at records
    // the later extraction/commit instant.
    expect(updatedBonusData).toBeDefined();
    expect(updatedBonusData.verified_at).toEqual(FIXED_NOW_T1);
    expect(updatedBonusData.updated_at).toEqual(FIXED_NOW_T2);
    expect(updatedBonusData.status).toBeUndefined();
    expect(updatedBonusData.review_status).toBeUndefined();
    expect(updatedBonusData.publication_status).toBeUndefined();
    expect(updatedBonusData.source_offer_key).toBeUndefined();
    expect(bonusCasWhere.source_offer_key).toBe(SOURCE_OFFER_KEY);
    expect(bonusCasWhere).toMatchObject({
      governance_version: 3,
      review_status: ReviewStatus.AWAITING_REVIEW,
      publication_status: PublicationStatus.UNPUBLISHED,
    });
    expect(mockScraper.run).toHaveBeenCalledWith({ url: SOURCE_URL });
    expect(updatedBonusData.governance_version).toBeUndefined();

    // 2. Fresh EvidenceRecord created with exact snapshot
    expect(createdEvidenceData).toBeDefined();
    expect(createdEvidenceData.source_url).toBe(SOURCE_URL);
    expect(createdEvidenceData.content_hash).toBe(TEST_CONTENT_HASH);
    expect(createdEvidenceData.snapshot_path).toBe(
      "supabase://savvyedge-evidence/v1/d3b-observation.html",
    );
    expect(createdEvidenceData.html_hash).toBe(TEST_HTML_HASH);
    expect(createdEvidenceData.observed_at).toEqual(FIXED_NOW_T1);
    expect(createdEvidenceData.extracted_at).toEqual(FIXED_NOW_T2);
    expect(activePointerInput).toMatchObject({
      where: {
        bonus_id_extraction_context: {
          bonus_id: initialBonus.id,
          extraction_context: "BONUS",
        },
      },
      create: {
        bonus_id: initialBonus.id,
        data_source_id: "ds-1",
        evidence_id: "ev-fresh-1",
        activated_at: FIXED_NOW_T2,
      },
    });

    // 3. verified_at BonusHistoryEvent created
    expect(createdHistoryData).toBeDefined();
    expect(createdHistoryData.field_changed).toBe("verified_at");
    expect(createdHistoryData.new_value).toBe(FIXED_NOW_T1.toISOString());
    expect(createdHistoryData.changed_at).toEqual(FIXED_NOW_T2);
    expect(createdHistoryData.source_url).toBe(SOURCE_URL);

    // 4. The new observation is fresh, but cannot stay publicly eligible on
    //    the authority of the old approval/publication decision.
    const postReverificationBonus = {
      ...initialBonus,
      verified_at: FIXED_NOW_T1,
      review_status: ReviewStatus.AWAITING_REVIEW,
      publication_status: PublicationStatus.UNPUBLISHED,
      governance_version: 3,
      active_extractions: activeBonusEvidence({
        bonusId: initialBonus.id,
        observedAt: FIXED_NOW_T1,
        extractedAt: FIXED_NOW_T2,
        sourceUrl: SOURCE_URL,
        evidenceId: "ev-fresh-1",
        extractionKey: activePointerInput.create.extraction_key,
      }),
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
        FIXED_NOW_T2,
      ),
    ).toBe(false);
  });

  it.each([
    ["published", PublicationStatus.PUBLISHED],
    ["already unpublished", PublicationStatus.UNPUBLISHED],
  ] as const)(
    "2. MATERIAL WAGERING CHANGE (%s): preserves approved values and atomically ends AWAITING_REVIEW + UNPUBLISHED",
    async (_label, initialPublicationStatus) => {
      const initialBonus = createMockApprovedBonus({
        wagering_requirement: 35,
        publication_status: initialPublicationStatus,
        active_extractions: activeBonusEvidence({
          bonusId: "bonus-rev-1",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceUrl: REQUESTED_SOURCE_URL,
          scrapeJobId: "scrape-material-canonical",
          canonicalUrl: SOURCE_URL,
        }),
      });

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(
        initialBonus as any,
      );

      const createdHistoryDiffs: any[] = [];
      const createdClaims: any[] = [];
      let createdEvidenceData: any = null;
      let activePointerInput: any = null;
      let reviewCasWhere: any = null;
      const workflowAuditEvents: any[] = [];
      const workflowClaimLinks: any[] = [];
      const governedState = { ...initialBonus };
      const historicalMutationSpies = {
        evidenceUpdate: vi.fn(),
        evidenceDelete: vi.fn(),
        claimUpdate: vi.fn(),
        claimDelete: vi.fn(),
        historyUpdate: vi.fn(),
        historyDelete: vi.fn(),
        auditUpdate: vi.fn(),
        auditDelete: vi.fn(),
      };

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
            activeExtractionPointer: {
              upsert: vi.fn().mockImplementation(async (input: any) => {
                activePointerInput = input;
                return { id: "active-pointer" };
              }),
            },
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
              create: vi.fn().mockImplementation(async ({ data }: any) => {
                createdEvidenceData = data;
                return evidence;
              }),
              findMany: vi.fn().mockResolvedValue([evidence]),
              update: historicalMutationSpies.evidenceUpdate,
              delete: historicalMutationSpies.evidenceDelete,
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
                  createdClaims.filter((claim) =>
                    where.id.in.includes(claim.id),
                  ),
                ),
              update: historicalMutationSpies.claimUpdate,
              delete: historicalMutationSpies.claimDelete,
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
                    governedState.publication_status !==
                      where.publication_status
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
                return {
                  id: `hist-diff-${createdHistoryDiffs.length}`,
                  ...data,
                };
              }),
              update: historicalMutationSpies.historyUpdate,
              delete: historicalMutationSpies.historyDelete,
            },
            workflowAuditEvent: {
              create: vi.fn().mockImplementation(async ({ data }: any) => {
                workflowAuditEvents.push(data);
                return { id: "wf-event-1" };
              }),
              update: historicalMutationSpies.auditUpdate,
              delete: historicalMutationSpies.auditDelete,
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
      expect(mockScraper.run).toHaveBeenCalledWith({ url: SOURCE_URL });
      if (result.status === "MATERIAL_CHANGE_DETECTED") {
        expect(result.diffs).toEqual([
          {
            field: "wagering_requirement",
            oldVal: "35",
            newVal: "40",
          },
        ]);
        expect(result.reviewStatus).toBe(ReviewStatus.AWAITING_REVIEW);
        expect(result.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
        expect(result.governanceVersion).toBe(3); // Incremented from 2 to 3
      }

      // 1. verified_at was NOT updated
      expect(governedState.wagering_requirement).toBe(35);
      expect(governedState.verified_at).toEqual(initialBonus.verified_at);
      expect(governedState.review_status).toBe(ReviewStatus.AWAITING_REVIEW);
      expect(governedState.publication_status).toBe(
        PublicationStatus.UNPUBLISHED,
      );
      expect(governedState.governance_version).toBe(3);

      // 2. New evidence, active pointer, claims and diff are all written in the transaction.
      expect(createdEvidenceData).toMatchObject({
        source_url: SOURCE_URL,
        observed_at: FIXED_NOW_T1,
        extracted_at: FIXED_NOW_T1,
      });
      expect(activePointerInput).toMatchObject({
        create: {
          bonus_id: initialBonus.id,
          evidence_id: "ev-diff-1",
        },
        update: {
          evidence_id: "ev-diff-1",
        },
      });
      expect(createdClaims.length).toBeGreaterThan(0);
      expect(createdHistoryDiffs.length).toBe(1);
      expect(createdHistoryDiffs[0].field_changed).toBe("wagering_requirement");
      expect(createdHistoryDiffs[0].old_value).toBe("35");
      expect(createdHistoryDiffs[0].new_value).toBe("40");

      // 3. One CAS changes both states and advances governance exactly once.
      expect(reviewCasWhere).toMatchObject({
        id: initialBonus.id,
        governance_version: 2,
        review_status: ReviewStatus.APPROVED,
        publication_status: initialPublicationStatus,
      });
      expect(workflowAuditEvents).toHaveLength(1);
      expect(workflowAuditEvents[0]).toMatchObject({
        bonus_id: initialBonus.id,
        event_type: WorkflowEventType.MATERIAL_CHANGE_DETECTED,
        expected_version: 2,
        resulting_version: 3,
        from_review_status: ReviewStatus.APPROVED,
        to_review_status: ReviewStatus.AWAITING_REVIEW,
        from_publication_status: initialPublicationStatus,
        to_publication_status: PublicationStatus.UNPUBLISHED,
      });
      expect(
        workflowClaimLinks.map((link) => link.bonus_evidence_claim_id),
      ).toEqual(createdClaims.map((claim) => claim.id));
      expect(
        workflowClaimLinks.some(
          (link) =>
            link.bonus_evidence_claim_id === initialBonus.evidence_claims[0].id,
        ),
      ).toBe(false);

      // 4. No historical evidence, claims, history or audit rows are mutated.
      for (const mutation of Object.values(historicalMutationSpies)) {
        expect(mutation).not.toHaveBeenCalled();
      }
      expect(initialBonus.evidence_claims[0].id).toBe("claim-1");

      // 5. The corrected state satisfies PUBLISHED => APPROVED by construction
      // and is immediately rejected by the public gate.
      expect(
        governedState.publication_status !== PublicationStatus.PUBLISHED ||
          governedState.review_status === ReviewStatus.APPROVED,
      ).toBe(true);
      expect(
        PublicationGateService.isBonusPubliclyEligible(
          governedState,
          baseCasino,
          FIXED_NOW_T1,
        ),
      ).toBe(false);
    },
  );

  it("3. OFFER BECOMES INACTIVE: does not silently overwrite approved status, transitions to AWAITING_REVIEW", async () => {
    const initialBonus = createMockApprovedBonus();
    const bonusUpdate = vi.fn();
    const bonusUpdateMany = vi.fn();

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

    let transitionCommand: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          ...activePointerTx(),
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
            findUnique: vi.fn().mockResolvedValue(initialBonus),
            update: bonusUpdate,
            updateMany: bonusUpdateMany,
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
            publicationStatus: PublicationStatus.UNPUBLISHED,
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
    if (result.status === "OFFER_INACTIVE") {
      expect(result.publicationStatus).toBe(PublicationStatus.UNPUBLISHED);
    }
    expect(transitionCommand).toBeDefined();
    expect(transitionCommand.toStatus).toBe(ReviewStatus.AWAITING_REVIEW);
    expect(bonusUpdate).not.toHaveBeenCalled();
    expect(bonusUpdateMany).not.toHaveBeenCalled();

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

  it("8. REPEAT IDENTICAL REVERIFICATION: records one observation, then pauses while renewed human approval is pending", async () => {
    const initialBonus = createMockApprovedBonus();

    vi.spyOn(prisma.bonus, "findUnique")
      .mockResolvedValueOnce(initialBonus as any)
      .mockResolvedValueOnce({
        ...initialBonus,
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 3,
        verified_at: FIXED_NOW_T1,
      } as any);

    const transitionBonusReview = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockResolvedValue({
        subjectId: initialBonus.id,
        workflowEventId: "workflow-review-required",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
        publicationStatus: PublicationStatus.UNPUBLISHED,
        governanceVersion: 3,
      });

    const verifiedAtTimestamps: Date[] = [];
    const evidenceIds: string[] = [];

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          ...activePointerTx(),
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
            findUnique: vi.fn().mockResolvedValue(initialBonus),
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
    expect(res2).toMatchObject({
      status: "HUMAN_REVIEW_PENDING",
      reviewStatus: ReviewStatus.AWAITING_REVIEW,
      governanceVersion: 3,
    });

    expect(verifiedAtTimestamps).toEqual([FIXED_NOW_T1]);
    expect(evidenceIds).toEqual(["ev-seq-1"]);
    expect(mockScraper.run).toHaveBeenCalledOnce();
    expect(mockBonusAgent.run).toHaveBeenCalledOnce();
    expect(transitionBonusReview).toHaveBeenCalledOnce();
  });

  it("9. CONCURRENT GOVERNANCE VERSION CHANGE: fails CAS safely during material-change transition", async () => {
    const initialBonus = createMockApprovedBonus({ governance_version: 2 });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const stagedWrites: string[] = [];
    const committedWrites: string[] = [];
    const createdClaims: any[] = [];
    let casWhere: any = null;
    const auditCreate = vi.fn();
    const linkCreate = vi.fn();

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const evidence = {
          id: "ev-conflict",
          source_url: SOURCE_URL,
          observed_at: FIXED_NOW_T1,
          extracted_at: FIXED_NOW_T1,
          valid_from: null,
          expires_at: null,
        };
        const mockTx: any = {
          activeExtractionPointer: {
            upsert: vi.fn().mockImplementation(async () => {
              stagedWrites.push("active-pointer");
              return { id: "active-pointer" };
            }),
          },
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
            create: vi.fn().mockImplementation(async () => {
              stagedWrites.push("evidence");
              return evidence;
            }),
            findMany: vi.fn().mockResolvedValue([evidence]),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              const claim = {
                id: `claim-conflict-${createdClaims.length + 1}`,
                ...data,
              };
              createdClaims.push(claim);
              stagedWrites.push(claim.id);
              return claim;
            }),
            findMany: vi
              .fn()
              .mockImplementation(async ({ where }: any) =>
                createdClaims.filter((claim) => where.id.in.includes(claim.id)),
              ),
          },
          bonus: {
            findUnique: vi.fn().mockResolvedValue(initialBonus),
            updateMany: vi.fn().mockImplementation(async ({ where }: any) => {
              casWhere = where;
              return { count: 0 };
            }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockImplementation(async () => {
              stagedWrites.push("history-diff");
              return { id: "hist-conflict" };
            }),
          },
          workflowAuditEvent: {
            create: auditCreate,
          },
          workflowEventClaim: {
            create: linkCreate,
          },
        };

        const result = await callback(mockTx);
        committedWrites.push(...stagedWrites);
        return result;
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

    expect(casWhere).toMatchObject({
      id: initialBonus.id,
      governance_version: 2,
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
    });
    expect(stagedWrites).toEqual(
      expect.arrayContaining(["evidence", "active-pointer", "history-diff"]),
    );
    expect(committedWrites).toEqual([]);
    expect(auditCreate).not.toHaveBeenCalled();
    expect(linkCreate).not.toHaveBeenCalled();
    expect(initialBonus).toMatchObject({
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
      governance_version: 2,
      wagering_requirement: 35,
    });
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

  it("11. missing-pointer legacy fallback remains deterministic and identity checked", () => {
    const olderUrl = "https://apexcasino.example.test/older-offer";
    const newestUrl = SOURCE_URL;
    const sourceKey = createBonusSourceOfferKey(newestUrl);

    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl({
      id: "bonus-rev-1",
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

  it("11a. rejects explicit legacy fallback without a trustworthy stored identity", () => {
    for (const sourceOfferKey of [null, "", "not-a-source-offer-key"]) {
      expect(
        BonusReverificationService.resolveAuthoritativeSourceUrl(
          {
            id: "bonus-rev-1",
            source_offer_key: sourceOfferKey,
          },
          SOURCE_URL,
        ),
      ).toEqual({
        error: "NO_AUTHORITATIVE_SOURCE_URL",
        reason:
          "Legacy source bootstrap requires a valid stored source_offer_key",
      });
    }
  });

  it("11b. rejects historical legacy fallback without a trustworthy stored identity", () => {
    expect(
      BonusReverificationService.resolveAuthoritativeSourceUrl({
        id: "bonus-rev-1",
        source_offer_key: null,
        evidence_claims: [
          {
            id: "claim-historical",
            verdict: EvidenceVerdict.SUPPORTS,
            evidence: {
              id: "evidence-historical",
              source_url: SOURCE_URL,
              observed_at: FIXED_NOW_T1,
            },
          },
        ],
        history_events: [
          {
            id: "history-historical",
            field_changed: "verified_at",
            source_url: SOURCE_URL,
            changed_at: FIXED_NOW_T1,
          },
        ],
      }),
    ).toEqual({
      error: "NO_AUTHORITATIVE_SOURCE_URL",
      reason:
        "Legacy source bootstrap requires a valid stored source_offer_key",
    });
  });

  it("11c. direct active source without canonical provenance outranks override and history", () => {
    const activeUrl = SOURCE_URL;
    const historicalUrl = "https://apexcasino.example.test/historical-offer";
    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl(
      {
        id: "bonus-rev-1",
        source_offer_key: createBonusSourceOfferKey(activeUrl),
        active_extractions: activeBonusEvidence({
          bonusId: "bonus-rev-1",
          observedAt: FIXED_NOW_T1,
          sourceUrl: activeUrl,
        }),
        evidence_claims: [
          {
            id: "claim-newer-history",
            verdict: EvidenceVerdict.SUPPORTS,
            created_at: FIXED_NOW_T2,
            evidence: {
              id: "evidence-newer-history",
              source_url: historicalUrl,
              observed_at: FIXED_NOW_T2,
            },
          },
        ],
      },
      historicalUrl,
    );

    expect(resolved).toEqual({ url: activeUrl });
  });

  it("11d. unrelated canonical provenance and active source fail closed without fallback", () => {
    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl(
      {
        id: "bonus-rev-1",
        source_offer_key: SOURCE_OFFER_KEY,
        active_extractions: activeBonusEvidence({
          bonusId: "bonus-rev-1",
          observedAt: FIXED_NOW_T1,
          sourceUrl: "https://unrelated-request.example.test/offer",
          scrapeJobId: "scrape-unrelated",
          canonicalUrl: "https://unrelated-canonical.example.test/offer",
        }),
        evidence_claims: [
          {
            id: "historical-matching-claim",
            verdict: EvidenceVerdict.SUPPORTS,
            evidence: {
              id: "historical-matching-evidence",
              source_url: SOURCE_URL,
              observed_at: FIXED_NOW_T2,
            },
          },
        ],
      },
      SOURCE_URL,
    );

    expect(resolved).toEqual({
      error: "SOURCE_IDENTITY_MISMATCH",
      reason:
        "Neither the active extraction canonical URL nor its source URL matches the stored source_offer_key",
    });
  });

  it("11e. canonical provenance from a different data source is not trusted", () => {
    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl({
      id: "bonus-rev-1",
      source_offer_key: SOURCE_OFFER_KEY,
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: REQUESTED_SOURCE_URL,
        scrapeJobId: "scrape-foreign-source",
        scrapeJobDataSourceId: "foreign-data-source",
        canonicalUrl: SOURCE_URL,
      }),
    });

    expect(resolved).toMatchObject({ error: "SOURCE_IDENTITY_MISMATCH" });
  });

  it.each([
    [
      "identity-mismatched URL",
      activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: "https://different.example.test/offer",
      }),
      "SOURCE_IDENTITY_MISMATCH",
    ],
    [
      "pointer/evidence mismatch",
      activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: SOURCE_URL,
        pointerEvidenceId: "different-evidence",
      }),
      "NO_AUTHORITATIVE_SOURCE_URL",
    ],
    [
      "pointer/evidence data-source mismatch",
      activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: SOURCE_URL,
        pointerDataSourceId: "different-data-source",
      }),
      "NO_AUTHORITATIVE_SOURCE_URL",
    ],
    [
      "pointer Bonus mismatch",
      activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: SOURCE_URL,
        pointerBonusId: "bonus-foreign",
      }),
      "NO_AUTHORITATIVE_SOURCE_URL",
    ],
    [
      "foreign-Bonus SUPPORTS claim",
      activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: FIXED_NOW_T1,
        sourceUrl: SOURCE_URL,
        claimBonusId: "bonus-foreign",
      }),
      "NO_AUTHORITATIVE_SOURCE_URL",
    ],
  ] as const)(
    "11f. invalid active %s fails closed without history fallback",
    (_label, activeExtractions, error) => {
      const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl(
        {
          id: "bonus-rev-1",
          source_offer_key: SOURCE_OFFER_KEY,
          active_extractions: activeExtractions,
          evidence_claims: [
            {
              id: "historical-fallback",
              verdict: EvidenceVerdict.SUPPORTS,
              evidence: {
                id: "historical-evidence",
                source_url: SOURCE_URL,
                observed_at: FIXED_NOW_T2,
              },
            },
          ],
        },
      );

      expect(resolved).toMatchObject({ error });
    },
  );

  // Equivalence guard for the canonical-predicate swap: the legacy bootstrap
  // gate used to carry its own /^bonus-url-v1:[a-f0-9]{64}$/ literal and now
  // calls isBonusSourceOfferKey. Every shape the old literal accepted or
  // rejected must still resolve identically.
  it.each([
    ["canonical key", SOURCE_OFFER_KEY, true],
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["whitespace only", "   ", false],
    ["leading whitespace", ` ${SOURCE_OFFER_KEY}`, false],
    ["trailing whitespace", `${SOURCE_OFFER_KEY} `, false],
    ["uppercase hex", `bonus-url-v1:${"A".repeat(64)}`, false],
    ["63 hex digits", `bonus-url-v1:${"a".repeat(63)}`, false],
    ["65 hex digits", `bonus-url-v1:${"a".repeat(65)}`, false],
    ["wrong version prefix", `bonus-url-v2:${"a".repeat(64)}`, false],
    ["non-hex body", "bonus-url-v1:not-a-hash", false],
    ["raw URL", SOURCE_URL, false],
    ["non-string", { toString: () => SOURCE_OFFER_KEY }, false],
  ] as const)(
    "11g. legacy bootstrap gate treats a %s key exactly as the canonical predicate does",
    (_label, sourceOfferKey, opensLegacyBootstrap) => {
      const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl(
        {
          id: "bonus-rev-1",
          source_offer_key: sourceOfferKey as never,
          active_extractions: [],
          evidence_claims: [
            {
              id: "legacy-claim",
              verdict: EvidenceVerdict.SUPPORTS,
              evidence: {
                id: "legacy-evidence",
                source_url: SOURCE_URL,
                observed_at: FIXED_NOW_T2,
              },
            },
          ],
        },
      );

      if (opensLegacyBootstrap) {
        // A trustworthy identity opens the gate and the canonical URL resolves.
        expect(resolved).toEqual({ url: SOURCE_URL });
        return;
      }

      // Anything else fails closed at the gate, before any candidate is read.
      expect(resolved).toEqual({
        error: "NO_AUTHORITATIVE_SOURCE_URL",
        reason:
          "Legacy source bootstrap requires a valid stored source_offer_key",
      });
    },
  );

  it("12. rejects a stale scraper timestamp before opening a write transaction", async () => {
    const initialBonus = createMockApprovedBonus({
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-rev-1",
        observedAt: new Date("2026-08-01T00:00:00.000Z"),
        sourceUrl: SOURCE_URL,
      }),
    });
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
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        initialBonus,
        baseCasino,
        FIXED_NOW_T2,
      ),
    ).toBe(false);
    expect(initialBonus.verified_at).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  it("13. unchanged renewal uses a governed-state CAS and fails safely on conflict", async () => {
    const initialBonus = createMockApprovedBonus();
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const historyCreate = vi.fn();
    const transitionBonusReview = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockRejectedValue(
        new Error(
          "The governed subject changed before this transition could be applied.",
        ),
      );

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) =>
      callback({
        ...activePointerTx(),
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
          findUnique: vi.fn().mockResolvedValue(initialBonus),
          updateMany: vi.fn(),
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

    expect(transitionBonusReview).toHaveBeenCalledWith({
      subjectId: initialBonus.id,
      actorId: "actor-service-reverification",
      expectedVersion: 2,
      toStatus: ReviewStatus.AWAITING_REVIEW,
      claimIds: expect.any(Array),
      internalReason:
        "A fresh automated observation requires renewed human approval",
    });
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it("14. leaves evidence untouched while a human review is awaiting assignment", async () => {
    const initialBonus = createMockApprovedBonus({
      review_status: ReviewStatus.AWAITING_REVIEW,
      governance_version: 3,
    });
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transitionSpy = vi.spyOn(
      WorkflowTransitionService.prototype,
      "transitionBonusReview",
    );
    const transaction = vi.spyOn(prisma, "$transaction");
    const scraperRun = vi.fn();
    const bonusAgentRun = vi.fn();

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: {
          run: scraperRun,
        },
        bonusAgent: {
          run: bonusAgentRun,
        },
        now: FIXED_NOW_T1,
      },
    );

    expect(result).toMatchObject({
      status: "HUMAN_REVIEW_PENDING",
      reviewStatus: ReviewStatus.AWAITING_REVIEW,
      governanceVersion: 3,
    });
    expect(scraperRun).not.toHaveBeenCalled();
    expect(bonusAgentRun).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("15. cannot replace evidence beneath an in-progress human review", async () => {
    const initialBonus = createMockApprovedBonus({
      review_status: ReviewStatus.IN_REVIEW,
      governance_version: 7,
    });
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transaction = vi.spyOn(prisma, "$transaction");
    const scraperRun = vi.fn();
    const bonusAgentRun = vi.fn();

    const result = await BonusReverificationService.reverifyBonus(
      initialBonus.id,
      {
        scraperAgent: { run: scraperRun },
        bonusAgent: { run: bonusAgentRun },
        now: FIXED_NOW_T1,
      },
    );

    expect(result).toMatchObject({
      status: "HUMAN_REVIEW_PENDING",
      reviewStatus: ReviewStatus.IN_REVIEW,
      governanceVersion: 7,
    });
    expect(scraperRun).not.toHaveBeenCalled();
    expect(bonusAgentRun).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed persisted hash before any governed mutation", async () => {
    const initialBonus = createMockApprovedBonus();
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transaction = vi.spyOn(prisma, "$transaction");
    const persistObservation = vi.fn().mockResolvedValue({
      locator: "supabase://savvyedge-evidence/v1/malformed-observation.html",
      htmlHash: "not-a-sha256",
      byteSize: 128,
    });

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Apex Casino Welcome Bonus Offer",
            content: "Get 100% up to £200. Wagering is 35x.",
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
        artifactStore: { persistObservation },
        now: FIXED_NOW_T1,
      }),
    ).rejects.toMatchObject({
      name: "ExtractionContractError",
      code: "INVALID_HTML_HASH",
    });

    expect(persistObservation).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("15. unchanged-path upload failure throws before extraction or governed mutation", async () => {
    const initialBonus = createMockApprovedBonus();
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    vi.mocked(
      EvidenceArtifactStorageService.persistObservation,
    ).mockRejectedValueOnce(new Error("durable observation unavailable"));
    const bonusAgent = vi.fn().mockResolvedValue({
      headline_value: initialBonus.headline_value,
      type: initialBonus.type,
      wagering_requirement: initialBonus.wagering_requirement,
      max_conversion: initialBonus.max_conversion,
      status: initialBonus.status,
    });
    const transaction = vi.spyOn(prisma, "$transaction");

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Apex Casino Welcome Bonus Offer",
            content: "Get 100% up to £200. Wagering is 35x.",
            rawHtml: "<html>Get 100% up to £200. Wagering is 35x.</html>",
            htmlHash: "a".repeat(64),
            timestamp: FIXED_NOW_T1,
          }),
        },
        bonusAgent: { run: bonusAgent },
        now: FIXED_NOW_T1,
      }),
    ).rejects.toThrow("durable observation unavailable");

    expect(bonusAgent).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("16. material-path upload failure throws with zero governed mutation", async () => {
    const initialBonus = createMockApprovedBonus({ wagering_requirement: 35 });
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    vi.mocked(
      EvidenceArtifactStorageService.persistObservation,
    ).mockRejectedValueOnce(new Error("durable observation unavailable"));
    const bonusAgent = vi.fn().mockResolvedValue({
      headline_value: initialBonus.headline_value,
      type: initialBonus.type,
      wagering_requirement: 50,
      max_conversion: initialBonus.max_conversion,
      status: initialBonus.status,
    });
    const transaction = vi.spyOn(prisma, "$transaction");

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Changed Apex offer terms",
            content: "Get 100% up to £200. Wagering is now 50x.",
            rawHtml: "<html>Get 100% up to £200. Wagering is now 50x.</html>",
            htmlHash: "b".repeat(64),
            timestamp: FIXED_NOW_T1,
          }),
        },
        bonusAgent: { run: bonusAgent },
        now: FIXED_NOW_T1,
      }),
    ).rejects.toThrow("durable observation unavailable");

    expect(bonusAgent).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("17. material observation followed by DB rollback never reports or mutates governed success", async () => {
    const initialBonus = createMockApprovedBonus({ wagering_requirement: 35 });
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    vi.spyOn(prisma, "$transaction").mockRejectedValue(
      new Error("database transaction rolled back"),
    );

    await expect(
      BonusReverificationService.reverifyBonus(initialBonus.id, {
        scraperAgent: {
          run: vi.fn().mockResolvedValue({
            url: SOURCE_URL,
            finalUrl: SOURCE_URL,
            title: "Changed Apex offer terms",
            content: "Get 100% up to £200. Wagering is now 50x.",
            rawHtml: "<html>Get 100% up to £200. Wagering is now 50x.</html>",
            htmlHash: "c".repeat(64),
            timestamp: FIXED_NOW_T1,
          }),
        },
        bonusAgent: {
          run: vi.fn().mockResolvedValue({
            headline_value: initialBonus.headline_value,
            type: initialBonus.type,
            wagering_requirement: 50,
            max_conversion: initialBonus.max_conversion,
            valid_from: null,
            valid_until: null,
            status: initialBonus.status,
          }),
        },
        now: FIXED_NOW_T1,
      }),
    ).rejects.toThrow("database transaction rolled back");

    expect(
      EvidenceArtifactStorageService.persistObservation,
    ).toHaveBeenCalledOnce();
    expect(initialBonus).toMatchObject({
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
      governance_version: 2,
      wagering_requirement: 35,
      verified_at: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("18. PUBLICATION QUEUE: renews an APPROVED + UNPUBLISHED bonus without any service change", async () => {
    // Requirement check for the sweep widening: BonusReverificationService has
    // no publication_status precondition. An APPROVED bonus still sitting in
    // the publication queue reverifies exactly like a published one, so the
    // deadlock fix needs no change here.
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_T1);
    const initialBonus = createMockApprovedBonus({
      id: "bonus-publication-queue",
      publication_status: PublicationStatus.UNPUBLISHED,
      governance_version: 8,
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-publication-queue",
        observedAt: new Date("2026-08-01T00:00:00.000Z"),
        sourceUrl: SOURCE_URL,
      }),
    });

    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
    const transitionBonusReview = vi
      .spyOn(WorkflowTransitionService.prototype, "transitionBonusReview")
      .mockResolvedValue({
        subjectId: initialBonus.id,
        workflowEventId: "workflow-review-required",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
        publicationStatus: PublicationStatus.UNPUBLISHED,
        governanceVersion: 9,
      });

    let updatedBonusData: any = null;
    let activePointerInput: any = null;
    let casWhere: any = null;

    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: any) => {
        const mockTx: any = {
          activeExtractionPointer: {
            upsert: vi.fn().mockImplementation(async (input: any) => {
              activePointerInput = input;
              return { id: "active-pointer" };
            }),
          },
          reviewActor: {
            upsert: vi
              .fn()
              .mockResolvedValue({ id: "actor-service-reverification" }),
          },
          dataSource: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "ds-queue", url: SOURCE_URL }),
            create: vi.fn(),
          },
          evidenceRecord: {
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              id: "ev-queue-fresh",
              ...data,
            })),
          },
          bonusEvidenceClaim: {
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              id: "claim-queue",
              ...data,
            })),
          },
          bonus: {
            findUnique: vi.fn().mockResolvedValue(initialBonus),
            updateMany: vi
              .fn()
              .mockImplementation(async ({ where, data }: any) => {
                casWhere = where;
                updatedBonusData = data;
                return { count: 1 };
              }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockResolvedValue({ id: "hist-queue" }),
          },
        };
        return callback(mockTx);
      },
    );

    const mockScraper = {
      run: vi.fn().mockImplementation(async () => {
        vi.setSystemTime(FIXED_NOW_T2);
        return {
          url: SOURCE_URL,
          finalUrl: SOURCE_URL,
          title: "Apex Casino Welcome Bonus Offer",
          content:
            "Get 100% up to \u00a3200 on first deposit. 35x wagering applies. Max conversion \u00a31000.",
          contentHash: TEST_CONTENT_HASH,
          htmlHash: TEST_HTML_HASH,
          timestamp: FIXED_NOW_T1,
        };
      }),
    };

    const mockBonusAgent = {
      run: vi.fn().mockResolvedValue({
        headline_value: "100% up to \u00a3200",
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
      { scraperAgent: mockScraper, bonusAgent: mockBonusAgent },
    );

    expect(result.status).toBe("VERIFIED_UNCHANGED");

    // The projection is repaired to the exact observation instant, which is
    // what clears both STALE_OBSERVATION and PROJECTION_MISMATCH.
    expect(updatedBonusData.verified_at).toEqual(FIXED_NOW_T1);
    expect(updatedBonusData.updated_at).toEqual(FIXED_NOW_T2);

    // The scalar write remains limited to freshness, while the canonical
    // workflow invalidates the earlier approval and advances its version.
    expect(updatedBonusData.review_status).toBeUndefined();
    expect(updatedBonusData.publication_status).toBeUndefined();
    expect(updatedBonusData.governance_version).toBeUndefined();
    expect(casWhere).toMatchObject({
      publication_status: PublicationStatus.UNPUBLISHED,
      review_status: ReviewStatus.AWAITING_REVIEW,
      governance_version: 9,
    });
    expect(transitionBonusReview).toHaveBeenCalledOnce();

    // The fresh observation becomes authoritative via the pointer.
    expect(activePointerInput.update).toMatchObject({
      evidence_id: "ev-queue-fresh",
      activated_at: FIXED_NOW_T2,
    });
  });
});
