import { describe, expect, it } from "vitest";
import {
  DEFAULT_BONUS_FRESHNESS_POLICY,
  evaluateActiveObservationFreshness,
  isBonusFresh,
} from "../src/services/freshness.policy";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { PublicationStatus, ReviewStatus } from "@savvyedge/database";
import {
  activeBonusEvidence,
  activeBonusExtractionKey,
} from "./helpers/active-bonus-evidence.fixture";

describe("D3A Bonus Freshness Policy (Pure Predicates)", () => {
  const FIXED_NOW = new Date("2026-08-10T12:00:00.000Z");
  const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

  it("1. rejects null or undefined verified_at", () => {
    expect(isBonusFresh(null, FIXED_NOW)).toBe(false);
    expect(isBonusFresh(undefined, FIXED_NOW)).toBe(false);
    expect(isBonusFresh("", FIXED_NOW)).toBe(false);
  });

  it("2. rejects invalid date timestamps", () => {
    expect(isBonusFresh("invalid-date-string", FIXED_NOW)).toBe(false);
    expect(isBonusFresh(new Date(NaN), FIXED_NOW)).toBe(false);
  });

  it("3. rejects verified_at strictly in the future", () => {
    const futureDate = new Date(FIXED_NOW.getTime() + 1000); // 1s in future
    expect(isBonusFresh(futureDate, FIXED_NOW)).toBe(false);

    const farFutureDate = new Date("2027-01-01T00:00:00.000Z");
    expect(isBonusFresh(farFutureDate, FIXED_NOW)).toBe(false);
  });

  it("4. accepts verified_at at 71h 59m 59.999s old", () => {
    const freshBoundary = new Date(
      FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS - 1),
    );
    expect(isBonusFresh(freshBoundary, FIXED_NOW)).toBe(true);
  });

  it("5. accepts verified_at at exactly 72h old", () => {
    const exactBoundary = new Date(FIXED_NOW.getTime() - SEVENTY_TWO_HOURS_MS);
    expect(isBonusFresh(exactBoundary, FIXED_NOW)).toBe(true);
  });

  it("6. rejects verified_at at 72h + 1ms old", () => {
    const staleBoundary = new Date(
      FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS + 1),
    );
    expect(isBonusFresh(staleBoundary, FIXED_NOW)).toBe(false);
  });

  it("11. supports deterministic custom policy threshold overrides", () => {
    const customPolicy = { maxAgeMs: 24 * 60 * 60 * 1000 }; // 24h
    const twentyFiveHoursAgo = new Date(
      FIXED_NOW.getTime() - 25 * 60 * 60 * 1000,
    );
    const twentyThreeHoursAgo = new Date(
      FIXED_NOW.getTime() - 23 * 60 * 60 * 1000,
    );

    // Default policy (72h) accepts both
    expect(isBonusFresh(twentyFiveHoursAgo, FIXED_NOW)).toBe(true);
    expect(isBonusFresh(twentyThreeHoursAgo, FIXED_NOW)).toBe(true);

    // Custom 24h policy rejects 25h and accepts 23h
    expect(isBonusFresh(twentyFiveHoursAgo, FIXED_NOW, customPolicy)).toBe(
      false,
    );
    expect(isBonusFresh(twentyThreeHoursAgo, FIXED_NOW, customPolicy)).toBe(
      true,
    );
  });
});

describe("D3C Active-Observation Freshness Authority", () => {
  const NOW = new Date("2026-08-10T12:00:00.000Z");
  const MAX_AGE_MS = DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs;

  function makeActiveBonus(
    observedAt: Date,
    overrides: Record<string, unknown> = {},
  ) {
    const id = "bonus-active-authority";
    return {
      id,
      verified_at: observedAt,
      active_extractions: activeBonusEvidence({
        bonusId: id,
        observedAt,
        extractedAt: NOW,
      }),
      ...overrides,
    };
  }

  it("accepts exactly 72 hours and rejects 72 hours plus 1ms", () => {
    const exactBoundary = new Date(NOW.getTime() - MAX_AGE_MS);
    const oneMillisecondStale = new Date(exactBoundary.getTime() - 1);

    expect(
      evaluateActiveObservationFreshness(makeActiveBonus(exactBoundary), NOW),
    ).toMatchObject({ status: "FRESH", observedAt: exactBoundary });
    expect(
      evaluateActiveObservationFreshness(
        makeActiveBonus(oneMillisecondStale),
        NOW,
      ),
    ).toEqual({ status: "REJECTED", code: "STALE_OBSERVATION" });
  });

  it("supports a custom max age without introducing another threshold", () => {
    const observedAt = new Date(NOW.getTime() - 60_001);
    expect(
      evaluateActiveObservationFreshness(makeActiveBonus(observedAt), NOW, {
        maxAgeMs: 60_000,
      }),
    ).toEqual({ status: "REJECTED", code: "STALE_OBSERVATION" });
  });

  it.each([
    [null, "INVALID_OBSERVATION"],
    ["not-a-date", "INVALID_OBSERVATION"],
    [new Date(NOW.getTime() + 1), "FUTURE_OBSERVATION"],
  ] as const)(
    "rejects an invalid or future observed_at (%s)",
    (value, code) => {
      const bonus = makeActiveBonus(NOW) as any;
      bonus.active_extractions[0].evidence.observed_at = value;
      bonus.verified_at = value;

      expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
        status: "REJECTED",
        code,
      });
    },
  );

  it("rejects an absent or invalid extraction timestamp as ineligible evidence", () => {
    for (const value of [null, "not-a-date"]) {
      const bonus = makeActiveBonus(NOW) as any;
      bonus.active_extractions[0].evidence.extracted_at = value;
      expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
        status: "REJECTED",
        code: "INVALID_OBSERVATION",
      });
    }
  });

  it("uses observed_at for age even when extraction completed recently", () => {
    const staleObservedAt = new Date(NOW.getTime() - MAX_AGE_MS - 1);
    const bonus = makeActiveBonus(staleObservedAt);
    expect((bonus.active_extractions[0].evidence as any).extracted_at).toEqual(
      NOW,
    );
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "STALE_OBSERVATION",
    });
  });

  it.each([
    [NOW, "equal to now"],
    [new Date(NOW.getTime() - 1), "earlier than now"],
  ])("rejects evidence expiring %s (%s)", (expiresAt) => {
    const bonus = makeActiveBonus(NOW) as any;
    bonus.active_extractions[0].evidence.expires_at = expiresAt;
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "EXPIRED_EVIDENCE",
    });
  });

  it.each([
    ["missing pointer", { active_extractions: [] }, "MISSING_ACTIVE_POINTER"],
    [
      "missing evidence",
      {
        active_extractions: activeBonusEvidence({
          bonusId: "bonus-active-authority",
          observedAt: NOW,
          withoutEvidence: true,
        }),
      },
      "MISSING_ACTIVE_EVIDENCE",
    ],
    [
      "ambiguous pointer",
      {
        active_extractions: [
          ...activeBonusEvidence({
            bonusId: "bonus-active-authority",
            observedAt: NOW,
          }),
          ...activeBonusEvidence({
            bonusId: "bonus-active-authority",
            observedAt: NOW,
            evidenceId: "evidence-second",
            extractionKey: "extraction-second",
          }),
        ],
      },
      "AMBIGUOUS_ACTIVE_POINTER",
    ],
  ] as const)("fails closed for %s", (_label, overrides, code) => {
    expect(
      evaluateActiveObservationFreshness(makeActiveBonus(NOW, overrides), NOW),
    ).toEqual({ status: "REJECTED", code });
  });

  it("rejects historical-only SUPPORTS claims", () => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        withoutClaims: true,
      }),
      evidence_claims: [
        {
          bonus_id: "bonus-active-authority",
          verdict: "SUPPORTS",
          evidence_id: "historical-evidence",
        },
      ],
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "MISSING_SUPPORTING_CLAIM",
    });
  });

  it("rejects a SUPPORTS claim owned by a different Bonus", () => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        claimBonusId: "bonus-foreign",
      }),
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "MISSING_SUPPORTING_CLAIM",
    });
  });

  it("rejects a verified_at projection mismatch", () => {
    const observedAt = new Date(NOW.getTime() - 1_000);
    const bonus = makeActiveBonus(observedAt, { verified_at: NOW });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "PROJECTION_MISMATCH",
    });
  });

  it("compares timezone-equivalent verified_at and observed_at values by epoch", () => {
    const bonus = makeActiveBonus(NOW) as any;
    bonus.verified_at = "2026-08-10T14:00:00.000+02:00";
    bonus.active_extractions[0].evidence.observed_at =
      "2026-08-10T12:00:00.000Z";

    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "FRESH",
      evidenceId: "evidence-active-bonus-active-authority",
      observedAt: NOW,
    });
  });

  it("rejects a non-HTTP(S) active evidence source", () => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        sourceUrl: "file:///tmp/bonus.html",
      }),
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "INVALID_EVIDENCE_SOURCE",
    });
  });

  it.each([
    ["pointer Bonus id", { pointerBonusId: "bonus-foreign" }],
    ["pointer data source id", { pointerDataSourceId: "source-foreign" }],
    ["pointer evidence id", { pointerEvidenceId: "different-evidence" }],
    [
      "pointer extraction key",
      {
        pointerExtractionKey: activeBonusExtractionKey(
          "different-pointer-extraction",
        ),
      },
    ],
    ["missing pointer evidence id", { pointerEvidenceId: "" }],
    ["missing pointer Bonus id", { pointerBonusId: "" }],
    [
      "whitespace-padded pointer Bonus id",
      { pointerBonusId: "bonus-active-authority " },
    ],
    ["missing pointer data source id", { pointerDataSourceId: "" }],
    ["whitespace pointer data source id", { pointerDataSourceId: " " }],
    ["missing evidence data source id", { dataSourceId: "" }],
  ])("rejects a mismatched or absent %s", (_label, options) => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        ...options,
      }),
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "ACTIVE_EVIDENCE_MISMATCH",
    });
  });

  it.each([
    ["matching arbitrary key", { extractionKey: "active-extraction" }],
    ["missing evidence extraction key", { extractionKey: "" }],
    ["missing contract version", { contractVersion: null }],
    ["unsupported contract version", { contractVersion: "extraction-v3" }],
    ["padded contract version", { contractVersion: " extraction-v2" }],
    ["wrong extraction context", { extractionContext: "CASINO" }],
  ])("rejects %s as an invalid extraction identity", (_label, options) => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        ...options,
      }),
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "INVALID_EXTRACTION_IDENTITY",
    });
  });

  it("rejects different canonical pointer and evidence extraction keys", () => {
    const bonus = makeActiveBonus(NOW, {
      active_extractions: activeBonusEvidence({
        bonusId: "bonus-active-authority",
        observedAt: NOW,
        pointerExtractionKey: activeBonusExtractionKey("different-pointer"),
      }),
    });
    expect(evaluateActiveObservationFreshness(bonus, NOW)).toEqual({
      status: "REJECTED",
      code: "ACTIVE_EVIDENCE_MISMATCH",
    });
  });

  it("accepts a fresh, unexpired HTTP(S) active observation with an exact projection", () => {
    const observedAt = new Date(NOW.getTime() - 30_000);
    expect(
      evaluateActiveObservationFreshness(makeActiveBonus(observedAt), NOW),
    ).toEqual({
      status: "FRESH",
      evidenceId: "evidence-active-bonus-active-authority",
      observedAt,
    });
  });
});

describe("D3A PublicationGate Integration (Bonus Freshness Kill Switch)", () => {
  const FIXED_NOW = new Date("2026-08-10T12:00:00.000Z");
  const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

  const validCasino = {
    id: "c-freshness-1",
    name: "Fresh Casino",
    slug: "fresh-casino",
    website_url: "https://freshcasino.test",
    publication_status: PublicationStatus.PUBLISHED,
    review_status: ReviewStatus.APPROVED,
    quarantine_reason: null,
    status: "ACTIVE",
    data_source_type: "SCRAPED",
    verified_at: FIXED_NOW,
    licenses: [
      {
        status: "ACTIVE",
        verified_at: FIXED_NOW,
        license_no: "LIC-FRESH-1",
      },
    ],
    history_events: [
      {
        event_type: "VERIFICATION",
        source_url: "https://regulator.example.test/register",
        occurred_at: FIXED_NOW,
      },
    ],
  };

  const createBaseBonus = (
    verifiedAt: Date,
    validUntil: Date | null = null,
  ) => ({
    id: "b-freshness-1",
    type: "WELCOME",
    headline_value: "100% Match up to £200",
    wagering_requirement: 35,
    publication_status: PublicationStatus.PUBLISHED,
    review_status: ReviewStatus.APPROVED,
    quarantine_reason: null,
    status: "ACTIVE",
    data_source_type: "SCRAPED",
    verified_at: verifiedAt,
    valid_until: validUntil,
    casino: validCasino,
    // D3C: verified_at only projects this active observation.
    active_extractions: activeBonusEvidence({
      bonusId: "b-freshness-1",
      observedAt: verifiedAt,
    }),
    history_events: [
      {
        field_changed: "verified_at",
        source_url: "https://freshcasino.test/terms",
        changed_at: verifiedAt,
      },
    ],
  });

  it("7. proves stale Bonus (ACTIVE, APPROVED, PUBLISHED) fails isBonusPubliclyEligible", () => {
    const seventyThreeHoursAgo = new Date(
      FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS + 60 * 60 * 1000),
    );
    const staleBonus = createBaseBonus(seventyThreeHoursAgo);

    expect(staleBonus.status).toBe("ACTIVE");
    expect(staleBonus.review_status).toBe(ReviewStatus.APPROVED);
    expect(staleBonus.publication_status).toBe(PublicationStatus.PUBLISHED);

    expect(
      PublicationGateService.isBonusPubliclyEligible(
        staleBonus,
        validCasino,
        FIXED_NOW,
      ),
    ).toBe(false);
  });

  it("8. proves fresh Bonus with all gate requirements satisfied passes isBonusPubliclyEligible", () => {
    const twelveHoursAgo = new Date(FIXED_NOW.getTime() - 12 * 60 * 60 * 1000);
    const freshBonus = createBaseBonus(twelveHoursAgo);

    expect(
      PublicationGateService.isBonusPubliclyEligible(
        freshBonus,
        validCasino,
        FIXED_NOW,
      ),
    ).toBe(true);
  });

  it("9. proves valid_until expiration continues to fail independently of freshness", () => {
    const oneHourAgo = new Date(FIXED_NOW.getTime() - 1 * 60 * 60 * 1000); // very fresh
    const expiredValidUntil = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000); // expired 5 mins ago

    const expiredBonus = createBaseBonus(oneHourAgo, expiredValidUntil);
    expect(
      PublicationGateService.isBonusPubliclyEligible(
        expiredBonus,
        validCasino,
        FIXED_NOW,
      ),
    ).toBe(false);
  });

  it("10. verifies whereBonusPublic lower bound corresponds exactly to the 72h policy", () => {
    const whereClause = PublicationGateService.whereBonusPublic(FIXED_NOW);

    expect(whereClause.publication_status).toBe(PublicationStatus.PUBLISHED);
    expect(whereClause.review_status).toBe(ReviewStatus.APPROVED);
    expect(whereClause.quarantine_reason).toBeNull();
    expect(whereClause.status).toBe("ACTIVE");

    const expectedMinVerifiedAt = new Date(
      FIXED_NOW.getTime() - DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs,
    );
    expect(whereClause.verified_at).toEqual({
      gte: expectedMinVerifiedAt,
      lte: FIXED_NOW,
    });
    expect(whereClause.history_events).toBeUndefined();
    expect(whereClause.active_extractions).toEqual({
      some: {
        extraction_context: "BONUS",
        evidence: {
          observed_at: { gte: expectedMinVerifiedAt, lte: FIXED_NOW },
          OR: [{ expires_at: null }, { expires_at: { gt: FIXED_NOW } }],
        },
      },
    });
  });

  it("10b. verifies whereBonusPublic respects custom policy thresholds and evaluation time", () => {
    const customPolicy = { maxAgeMs: 12 * 60 * 60 * 1000 };
    const whereClause = PublicationGateService.whereBonusPublic(
      FIXED_NOW,
      customPolicy,
    );

    const expectedMinVerifiedAt = new Date(
      FIXED_NOW.getTime() - 12 * 60 * 60 * 1000,
    );
    expect(whereClause.verified_at).toEqual({
      gte: expectedMinVerifiedAt,
      lte: FIXED_NOW,
    });
  });

  it("rejects stale or missing-active-evidence bonuses in calculator validation", () => {
    const staleAt = new Date(
      FIXED_NOW.getTime() - DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs - 1,
    );
    const staleBonus = createBaseBonus(staleAt);
    const missingPointerBonus = {
      ...createBaseBonus(FIXED_NOW),
      active_extractions: [],
    };

    expect(
      PublicationGateService.validateCalculatorEligibility(
        staleBonus,
        validCasino,
        FIXED_NOW,
      ).status,
    ).toBe("INELIGIBLE_BONUS");
    expect(
      PublicationGateService.validateCalculatorEligibility(
        missingPointerBonus,
        validCasino,
        FIXED_NOW,
      ).status,
    ).toBe("INELIGIBLE_BONUS");
  });
});
