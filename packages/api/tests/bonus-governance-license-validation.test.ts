import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  GovernedSubjectType,
  ReviewStatus,
  WorkflowEventType,
  EvidenceVerdict,
  prisma,
  PublicationStatus,
} from "@savvyedge/database";
import {
  WorkflowTransitionService,
  WorkflowTransitionError,
  OrchestratorService,
} from "../src";

describe("Bonus Validation Governance License Hardening", () => {
  const createMockDb = () => {
    const licenses: any[] = [];
    const workflowAuditEvents: any[] = [];
    const licenseEvidenceClaims: any[] = [];
    const evidenceRecords: any[] = [];
    const bonuses: any[] = [];

    const mockDb: any = {
      license: {
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          return licenses.filter((lic) => {
            if (where.casino_id && lic.casino_id !== where.casino_id) return false;
            if (where.status && lic.status !== where.status) return false;
            if (where.review_status && lic.review_status !== where.review_status) return false;
            if (where.quarantine_reason === null && lic.quarantine_reason !== null) return false;
            if (where.duplicate_of_id === null && lic.duplicate_of_id !== null) return false;
            return true;
          });
        }),
      },
      workflowAuditEvent: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return (
            workflowAuditEvents.find((evt) => {
              if (where.subject_type && evt.subject_type !== where.subject_type) return false;
              if (where.license_id && evt.license_id !== where.license_id) return false;
              if (where.event_type && evt.event_type !== where.event_type) return false;
              if (where.to_review_status && evt.to_review_status !== where.to_review_status) return false;
              if (where.expected_version !== undefined && evt.expected_version !== where.expected_version) return false;
              if (where.resulting_version !== undefined && evt.resulting_version !== where.resulting_version) return false;
              return true;
            }) || null
          );
        }),
      },
      licenseEvidenceClaim: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          return licenseEvidenceClaims.find((c) => c.id === where.id) || null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.id?.in) {
            return licenseEvidenceClaims.filter((c) => where.id.in.includes(c.id));
          }
          return licenseEvidenceClaims;
        }),
      },
      evidenceRecord: {
        findMany: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.id?.in) {
            return evidenceRecords.filter((r) => where.id.in.includes(r.id));
          }
          return evidenceRecords;
        }),
      },
      casinoEvidenceClaim: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      bonusEvidenceClaim: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      slotEvidenceClaim: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      bonus: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          return bonuses.find((b) => b.id === where.id) || null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const idx = bonuses.findIndex((b) => b.id === where.id);
          if (idx !== -1) {
            bonuses[idx] = { ...bonuses[idx], ...data };
            return bonuses[idx];
          }
          return { id: where.id, ...data };
        }),
      },
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        return callback(mockDb);
      }),
    };

    return {
      mockDb,
      state: {
        licenses,
        workflowAuditEvents,
        licenseEvidenceClaims,
        evidenceRecords,
        bonuses,
      },
    };
  };

  describe("1. WorkflowTransitionService.assertCasinoHasOneEligibleLicense", () => {
    it("fails closed with ELIGIBLE_LICENSE_REQUIRED when casino has no licenses at all", async () => {
      const { mockDb } = createMockDb();
      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-no-lic"),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));
    });

    it("fails closed with ELIGIBLE_LICENSE_REQUIRED when license is ACTIVE but review_status is AWAITING_REVIEW", async () => {
      const { mockDb, state } = createMockDb();
      state.licenses.push({
        id: "lic-awaiting",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 1,
      });

      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-1"),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));
    });

    it("fails closed with ELIGIBLE_LICENSE_REQUIRED when license is APPROVED but has no valid audit event for current version", async () => {
      const { mockDb, state } = createMockDb();
      state.licenses.push({
        id: "lic-unbacked",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 2,
      });

      // Audit event exists but for old version 1, not current version 2
      state.workflowAuditEvents.push({
        id: "event-old",
        subject_type: GovernedSubjectType.LICENSE,
        license_id: "lic-unbacked",
        event_type: WorkflowEventType.APPROVED,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: [],
      });

      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-1"),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));
    });

    it("fails closed with ELIGIBLE_LICENSE_REQUIRED when license is APPROVED but linked evidence is expired", async () => {
      const { mockDb, state } = createMockDb();
      const now = new Date("2026-08-09T20:00:00Z");

      state.licenses.push({
        id: "lic-expired-ev",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 1,
      });

      state.evidenceRecords.push({
        id: "ev-rec-1",
        source_url: "https://www.gamblingcommission.gov.uk/downloads/licences.csv",
        observed_at: new Date("2026-07-01T00:00:00Z"),
        extracted_at: new Date("2026-07-01T00:00:00Z"),
        valid_from: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-08-01T00:00:00Z"), // Expired before now (2026-08-09)
      });

      state.licenseEvidenceClaims.push({
        id: "claim-1",
        license_id: "lic-expired-ev",
        evidence_id: "ev-rec-1",
        verdict: EvidenceVerdict.SUPPORTS,
      });


      state.workflowAuditEvents.push({
        id: "event-app-1",
        subject_type: GovernedSubjectType.LICENSE,
        license_id: "lic-expired-ev",
        event_type: WorkflowEventType.APPROVED,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: [{ license_evidence_claim_id: "claim-1" }],
      });

      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-1", now),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));
    });

    it("succeeds when casino has exactly one fully governance-eligible approved license with valid evidence", async () => {
      const { mockDb, state } = createMockDb();
      const now = new Date("2026-08-09T20:00:00Z");

      state.licenses.push({
        id: "lic-valid",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 1,
      });

      state.evidenceRecords.push({
        id: "ev-rec-valid",
        source_url: "https://www.gamblingcommission.gov.uk/downloads/licences.csv",
        observed_at: new Date("2026-08-09T00:00:00Z"),
        extracted_at: new Date("2026-08-09T00:00:00Z"),
        valid_from: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-11-09T00:00:00Z"), // Valid 90 days
      });

      state.licenseEvidenceClaims.push({
        id: "claim-valid",
        license_id: "lic-valid",
        evidence_id: "ev-rec-valid",
        verdict: EvidenceVerdict.SUPPORTS,
      });

      state.workflowAuditEvents.push({
        id: "event-valid",
        subject_type: GovernedSubjectType.LICENSE,
        license_id: "lic-valid",
        event_type: WorkflowEventType.APPROVED,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: [{ license_evidence_claim_id: "claim-valid" }],
      });

      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-1", now),
      ).resolves.toBeUndefined();
    });

    it("fails closed with ELIGIBLE_LICENSE_AMBIGUOUS when casino has multiple eligible approved licenses", async () => {
      const { mockDb, state } = createMockDb();
      const now = new Date("2026-08-09T20:00:00Z");

      state.evidenceRecords.push({
        id: "ev-rec-valid",
        source_url: "https://www.gamblingcommission.gov.uk/downloads/licences.csv",
        observed_at: new Date("2026-08-09T00:00:00Z"),
        extracted_at: new Date("2026-08-09T00:00:00Z"),
        valid_from: new Date("2026-01-01T00:00:00Z"),
        expires_at: new Date("2026-11-09T00:00:00Z"),
      });

      // License 1
      state.licenses.push({
        id: "lic-1",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 1,
      });
      state.licenseEvidenceClaims.push({
        id: "claim-1",
        license_id: "lic-1",
        evidence_id: "ev-rec-valid",
        verdict: EvidenceVerdict.SUPPORTS,
      });
      state.workflowAuditEvents.push({
        id: "event-1",
        subject_type: GovernedSubjectType.LICENSE,
        license_id: "lic-1",
        event_type: WorkflowEventType.APPROVED,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: [{ license_evidence_claim_id: "claim-1" }],
      });

      // License 2
      state.licenses.push({
        id: "lic-2",
        casino_id: "casino-1",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        quarantine_reason: null,
        duplicate_of_id: null,
        governance_version: 1,
      });
      state.licenseEvidenceClaims.push({
        id: "claim-2",
        license_id: "lic-2",
        evidence_id: "ev-rec-valid",
        verdict: EvidenceVerdict.SUPPORTS,
      });
      state.workflowAuditEvents.push({
        id: "event-2",
        subject_type: GovernedSubjectType.LICENSE,
        license_id: "lic-2",
        event_type: WorkflowEventType.APPROVED,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: [{ license_evidence_claim_id: "claim-2" }],
      });


      const service = new WorkflowTransitionService(mockDb);

      await expect(
        service.assertCasinoHasOneEligibleLicense("casino-1", now),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_AMBIGUOUS"));
    });
  });

  describe("2. Orchestrator VALIDATE_BONUS Handler Governance Enforcement", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    it("rejects bonus validation when casino license is only AWAITING_REVIEW", async () => {
      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
        id: "bonus-101",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: null,
        casino: { id: "casino-unapproved", name: "Unapproved Casino" },
      } as any);

      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockRejectedValue(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));

      const updateSpy = vi.spyOn(prisma.bonus, "update");
      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-101",
        url: "https://casino.example.com/promo",
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("rejects bonus validation when casino has ambiguous eligible licenses", async () => {
      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
        id: "bonus-102",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: null,
        casino: { id: "casino-ambiguous", name: "Ambiguous Casino" },
      } as any);

      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockRejectedValue(new WorkflowTransitionError("ELIGIBLE_LICENSE_AMBIGUOUS"));

      const updateSpy = vi.spyOn(prisma.bonus, "update");
      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-102",
        url: "https://casino.example.com/promo",
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("rejects bonus validation when bonus fields are invalid even if license is eligible", async () => {
      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
        id: "bonus-invalid-fields",
        headline_value: "", // Empty headline
        wagering_requirement: 150, // Invalid wagering > 100
        max_conversion: -5, // Invalid negative max_conversion
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      } as any);

      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockResolvedValue(undefined);

      const updateSpy = vi.spyOn(prisma.bonus, "update");
      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-invalid-fields",
        url: "https://casino.example.com/promo",
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("successfully sets verified_at and creates BonusHistoryEvent while preserving lifecycle status ACTIVE", async () => {
      const initialBonus = {
        id: "bonus-active-valid",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        status: "ACTIVE",
        verified_at: null,
        review_status: ReviewStatus.NEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 0,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      };

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);

      const licenseAssertionSpy = vi
        .spyOn(
          WorkflowTransitionService.prototype,
          "assertCasinoHasOneEligibleLicense",
        )
        .mockResolvedValue(undefined);

      let capturedBonusUpdateData: any = null;
      let capturedHistoryEventData: any = null;

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const mockTx: any = {
          bonus: {
            update: vi.fn().mockImplementation(async ({ where, data }: any) => {
              capturedBonusUpdateData = data;
              return { ...initialBonus, ...data };
            }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              capturedHistoryEventData = data;
              return { id: "event-1", ...data };
            }),
          },
        };
        return callback(mockTx);
      });

      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-active-valid",
        url: "https://casino.example.com/promo-terms",
      });

      expect(licenseAssertionSpy).toHaveBeenCalledWith("casino-eligible");

      // 1. Bonus update sets verified_at and does NOT mutate lifecycle status or governance fields
      expect(capturedBonusUpdateData).toBeDefined();
      expect(capturedBonusUpdateData.verified_at).toBeInstanceOf(Date);
      expect(capturedBonusUpdateData.status).toBeUndefined();
      expect(capturedBonusUpdateData.review_status).toBeUndefined();
      expect(capturedBonusUpdateData.publication_status).toBeUndefined();
      expect(capturedBonusUpdateData.governance_version).toBeUndefined();

      // 2. BonusHistoryEvent created with exact field_changed, timestamps, and source_url
      expect(capturedHistoryEventData).toBeDefined();
      expect(capturedHistoryEventData).toEqual({
        bonus_id: "bonus-active-valid",
        field_changed: "verified_at",
        old_value: null,
        new_value: capturedBonusUpdateData.verified_at.toISOString(),
        changed_at: capturedBonusUpdateData.verified_at,
        source_url: "https://casino.example.com/promo-terms",
      });
    });

    it("preserves INACTIVE status upon validation (does not force INACTIVE to ACTIVE)", async () => {
      const initialBonus = {
        id: "bonus-inactive-valid",
        headline_value: "50 FREE SPINS",
        wagering_requirement: 20,
        max_conversion: 100,
        status: "INACTIVE",
        verified_at: null,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      };

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockResolvedValue(undefined);

      let capturedBonusUpdateData: any = null;
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const mockTx: any = {
          bonus: {
            update: vi.fn().mockImplementation(async ({ data }: any) => {
              capturedBonusUpdateData = data;
              return { ...initialBonus, ...data };
            }),
          },
          bonusHistoryEvent: {
            create: vi.fn().mockResolvedValue({ id: "event-2" }),
          },
        };
        return callback(mockTx);
      });

      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-inactive-valid",
        url: "https://casino.example.com/expired-terms",
      });

      expect(capturedBonusUpdateData).toBeDefined();
      expect(capturedBonusUpdateData.verified_at).toBeInstanceOf(Date);
      expect(capturedBonusUpdateData.status).toBeUndefined();
    });

    it("records serialized previous verified_at in old_value on re-verification", async () => {
      const previousVerifiedAt = new Date("2026-08-01T12:00:00Z");
      const initialBonus = {
        id: "bonus-reverify",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        status: "ACTIVE",
        verified_at: previousVerifiedAt,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      };

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockResolvedValue(undefined);

      let capturedHistoryEventData: any = null;
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const mockTx: any = {
          bonus: { update: vi.fn() },
          bonusHistoryEvent: {
            create: vi.fn().mockImplementation(async ({ data }: any) => {
              capturedHistoryEventData = data;
              return { id: "event-3", ...data };
            }),
          },
        };
        return callback(mockTx);
      });

      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-reverify",
        url: "https://casino.example.com/promo-reverify",
      });

      expect(capturedHistoryEventData.old_value).toBe(previousVerifiedAt.toISOString());
    });

    it("ensures atomic persistence: if history-event creation fails, transaction rejects", async () => {
      const initialBonus = {
        id: "bonus-atomic-fail",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        status: "ACTIVE",
        verified_at: null,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      };

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockResolvedValue(undefined);

      const historyError = new Error("History event table locked");
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const mockTx: any = {
          bonus: { update: vi.fn() },
          bonusHistoryEvent: {
            create: vi.fn().mockRejectedValue(historyError),
          },
        };
        return callback(mockTx);
      });

      const handlers = OrchestratorService.getQueueHandlers([]);

      await expect(
        handlers.VALIDATE_BONUS({
          bonusId: "bonus-atomic-fail",
          url: "https://casino.example.com/promo-fail",
        }),
      ).rejects.toThrow("History event table locked");
    });

    it.each([
      ["empty URL", ""],
      ["whitespace URL", "   "],
      ["malformed URL", "not-a-valid-url"],
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/html,<html></html>"],
      ["file scheme", "file:///etc/passwd"],
      ["ftp scheme", "ftp://ftp.example.com/file"],
    ])("rejects validation without persisting verification when source URL is %s", async (_, invalidUrl) => {

      const initialBonus = {
        id: "bonus-url-invalid",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        status: "ACTIVE",
        verified_at: null,
        review_status: ReviewStatus.NEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 0,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      };

      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(initialBonus as any);
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockResolvedValue(undefined);

      const updateSpy = vi.spyOn(prisma.bonus, "update");
      const historyEventSpy = vi.spyOn(prisma.bonusHistoryEvent, "create");
      const transactionSpy = vi.spyOn(prisma, "$transaction");

      const handlers = OrchestratorService.getQueueHandlers([]);

      await handlers.VALIDATE_BONUS({
        bonusId: "bonus-url-invalid",
        url: invalidUrl,
      });

      expect(transactionSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(historyEventSpy).not.toHaveBeenCalled();
    });



    it("rethrows unexpected WorkflowTransitionError (e.g. STALE_GOVERNANCE_VERSION) and does not swallow it as validation failure", async () => {
      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
        id: "bonus-stale",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      } as any);

      const staleError = new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockRejectedValue(staleError);

      const updateSpy = vi.spyOn(prisma.bonus, "update");
      const handlers = OrchestratorService.getQueueHandlers([]);

      await expect(
        handlers.VALIDATE_BONUS({
          bonusId: "bonus-stale",
          url: "https://casino.example.com/promo",
        }),
      ).rejects.toThrowError(staleError);

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("rethrows unexpected database errors so queue retry/error handling sees them", async () => {
      vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue({
        id: "bonus-error",
        headline_value: "300 FREE SPINS",
        wagering_requirement: 10,
        max_conversion: 500,
        casino: { id: "casino-eligible", name: "Eligible Casino" },
      } as any);

      const dbError = new Error("Database connection lost");
      vi.spyOn(
        WorkflowTransitionService.prototype,
        "assertCasinoHasOneEligibleLicense",
      ).mockRejectedValue(dbError);

      const handlers = OrchestratorService.getQueueHandlers([]);

      await expect(
        handlers.VALIDATE_BONUS({
          bonusId: "bonus-error",
          url: "https://casino.example.com/promo",
        }),
      ).rejects.toThrow("Database connection lost");
    });
  });


  describe("3. Casino Publication Eligible License Invariant", () => {
    it("ensures casino publication continues to require exactly one eligible license via the same canonical logic", async () => {
      const { mockDb, state } = createMockDb();
      mockDb.casino = {
        findUnique: vi.fn().mockResolvedValue({
          id: "casino-pub-1",
          review_status: ReviewStatus.APPROVED,
          publication_status: PublicationStatus.UNPUBLISHED,
          quarantine_reason: null,
          duplicate_of_id: null,
          governance_version: 1,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };

      mockDb.reviewActor = {
        findUnique: vi.fn().mockResolvedValue({
          id: "human-1",
          kind: "HUMAN",
          active: true,
        }),
      };
      mockDb.casinoEvidenceClaim = {
        findUnique: vi.fn().mockResolvedValue({ id: "claim-pub-1" }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "claim-pub-1",
            casino_id: "casino-pub-1",
            evidence_id: "ev-pub-1",
            verdict: EvidenceVerdict.SUPPORTS,
          },
        ]),
      };
      mockDb.evidenceRecord = {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ev-pub-1",
            source_url: "https://casino.example.com",
            observed_at: new Date("2026-08-09T00:00:00Z"),
            extracted_at: new Date("2026-08-09T00:00:00Z"),
            valid_from: new Date("2026-01-01T00:00:00Z"),
            expires_at: new Date("2026-11-09T00:00:00Z"),
          },
        ]),
      };

      const service = new WorkflowTransitionService(mockDb);


      // Attempt casino publish with no eligible license
      await expect(
        service.transitionCasinoPublication({
          subjectId: "casino-pub-1",
          actorId: "human-1",
          expectedVersion: 1,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: ["claim-pub-1"],
        }),
      ).rejects.toThrowError(new WorkflowTransitionError("ELIGIBLE_LICENSE_REQUIRED"));
    });
  });

});
