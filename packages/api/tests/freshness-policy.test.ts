import { describe, expect, it } from "vitest";
import {
  DEFAULT_BONUS_FRESHNESS_POLICY,
  isBonusFresh,
} from "../src/services/freshness.policy";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { PublicationStatus, ReviewStatus } from "@savvyedge/database";

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
    const freshBoundary = new Date(FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS - 1));
    expect(isBonusFresh(freshBoundary, FIXED_NOW)).toBe(true);
  });

  it("5. accepts verified_at at exactly 72h old", () => {
    const exactBoundary = new Date(FIXED_NOW.getTime() - SEVENTY_TWO_HOURS_MS);
    expect(isBonusFresh(exactBoundary, FIXED_NOW)).toBe(true);
  });

  it("6. rejects verified_at at 72h + 1ms old", () => {
    const staleBoundary = new Date(FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS + 1));
    expect(isBonusFresh(staleBoundary, FIXED_NOW)).toBe(false);
  });

  it("11. supports deterministic custom policy threshold overrides", () => {
    const customPolicy = { maxAgeMs: 24 * 60 * 60 * 1000 }; // 24h
    const twentyFiveHoursAgo = new Date(FIXED_NOW.getTime() - 25 * 60 * 60 * 1000);
    const twentyThreeHoursAgo = new Date(FIXED_NOW.getTime() - 23 * 60 * 60 * 1000);

    // Default policy (72h) accepts both
    expect(isBonusFresh(twentyFiveHoursAgo, FIXED_NOW)).toBe(true);
    expect(isBonusFresh(twentyThreeHoursAgo, FIXED_NOW)).toBe(true);

    // Custom 24h policy rejects 25h and accepts 23h
    expect(isBonusFresh(twentyFiveHoursAgo, FIXED_NOW, customPolicy)).toBe(false);
    expect(isBonusFresh(twentyThreeHoursAgo, FIXED_NOW, customPolicy)).toBe(true);
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

  const createBaseBonus = (verifiedAt: Date, validUntil: Date | null = null) => ({
    id: "b-freshness-1",
    headline_value: "100% Match up to £200",
    publication_status: PublicationStatus.PUBLISHED,
    review_status: ReviewStatus.APPROVED,
    quarantine_reason: null,
    status: "ACTIVE",
    data_source_type: "SCRAPED",
    verified_at: verifiedAt,
    valid_until: validUntil,
    casino: validCasino,
    history_events: [
      {
        field_changed: "verified_at",
        source_url: "https://freshcasino.test/terms",
        changed_at: verifiedAt,
      },
    ],
  });

  it("7. proves stale Bonus (ACTIVE, APPROVED, PUBLISHED) fails isBonusPubliclyEligible", () => {
    const seventyThreeHoursAgo = new Date(FIXED_NOW.getTime() - (SEVENTY_TWO_HOURS_MS + 60 * 60 * 1000));
    const staleBonus = createBaseBonus(seventyThreeHoursAgo);

    expect(staleBonus.status).toBe("ACTIVE");
    expect(staleBonus.review_status).toBe(ReviewStatus.APPROVED);
    expect(staleBonus.publication_status).toBe(PublicationStatus.PUBLISHED);

    expect(PublicationGateService.isBonusPubliclyEligible(staleBonus, validCasino, FIXED_NOW)).toBe(false);
  });

  it("8. proves fresh Bonus with all gate requirements satisfied passes isBonusPubliclyEligible", () => {
    const twelveHoursAgo = new Date(FIXED_NOW.getTime() - 12 * 60 * 60 * 1000);
    const freshBonus = createBaseBonus(twelveHoursAgo);

    expect(PublicationGateService.isBonusPubliclyEligible(freshBonus, validCasino, FIXED_NOW)).toBe(true);
  });

  it("9. proves valid_until expiration continues to fail independently of freshness", () => {
    const oneHourAgo = new Date(FIXED_NOW.getTime() - 1 * 60 * 60 * 1000); // very fresh
    const expiredValidUntil = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000); // expired 5 mins ago

    const expiredBonus = createBaseBonus(oneHourAgo, expiredValidUntil);
    expect(PublicationGateService.isBonusPubliclyEligible(expiredBonus, validCasino, FIXED_NOW)).toBe(false);
  });

  it("10. verifies whereBonusPublic lower bound corresponds exactly to the 72h policy", () => {
    const whereClause = PublicationGateService.whereBonusPublic(FIXED_NOW);

    expect(whereClause.publication_status).toBe(PublicationStatus.PUBLISHED);
    expect(whereClause.review_status).toBe(ReviewStatus.APPROVED);
    expect(whereClause.quarantine_reason).toBeNull();
    expect(whereClause.status).toBe("ACTIVE");

    const expectedMinVerifiedAt = new Date(FIXED_NOW.getTime() - DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs);
    expect(whereClause.verified_at).toEqual({
      gte: expectedMinVerifiedAt,
      lte: FIXED_NOW,
    });
  });

  it("10b. verifies whereBonusPublic respects custom policy thresholds and evaluation time", () => {
    const customPolicy = { maxAgeMs: 12 * 60 * 60 * 1000 };
    const whereClause = PublicationGateService.whereBonusPublic(FIXED_NOW, customPolicy);

    const expectedMinVerifiedAt = new Date(FIXED_NOW.getTime() - 12 * 60 * 60 * 1000);
    expect(whereClause.verified_at).toEqual({
      gte: expectedMinVerifiedAt,
      lte: FIXED_NOW,
    });
  });
});
