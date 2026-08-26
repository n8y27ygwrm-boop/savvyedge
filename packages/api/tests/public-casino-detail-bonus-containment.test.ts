import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationStatus, ReviewStatus, prisma } from "@savvyedge/database";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { GET as getCasinoBySlugV1 } from "../../../apps/web/src/app/api/v1/casinos/[slug]/route";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FRESH_AT = new Date("2026-08-26T11:00:00.000Z");
const SOURCE_URL = "https://public-casino.example.test/bonus-terms";

function makeBonus(overrides: Record<string, unknown> = {}) {
  return {
    id: "bonus-fresh",
    casino_id: "casino-public",
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 500,
    true_value_score: 72,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
    created_at: new Date("2026-08-20T00:00:00.000Z"),
    updated_at: FRESH_AT,
    verified_at: FRESH_AT,
    data_source_type: "SCRAPED",
    source_offer_key: "public-casino.example.test/bonus-terms",
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    governance_version: 2,
    duplicate_of_id: null,
    history_events: [
      {
        id: "bonus-verification-event",
        bonus_id: "bonus-fresh",
        field_changed: "verified_at",
        old_value: null,
        new_value: FRESH_AT.toISOString(),
        changed_at: FRESH_AT,
        source_url: SOURCE_URL,
      },
    ],
    ...overrides,
  };
}

function makeCasino(bonuses: unknown[] = [makeBonus()], overrides = {}) {
  return {
    id: "casino-public",
    name: "Public Casino",
    slug: "public-casino",
    website_url: "https://public-casino.example.test",
    license_info: "GB-123",
    status: "ACTIVE",
    created_at: new Date("2026-08-01T00:00:00.000Z"),
    updated_at: FRESH_AT,
    verified_at: FRESH_AT,
    data_source_type: "MANUAL_AUDIT",
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    governance_version: 2,
    duplicate_of_id: null,
    bonuses,
    licenses: [
      {
        id: "license-active",
        casino_id: "casino-public",
        regulator_id: "regulator-test",
        license_no: "GB-123",
        status: "ACTIVE",
        verified_at: FRESH_AT,
      },
    ],
    history_events: [
      {
        id: "casino-verification-event",
        casino_id: "casino-public",
        event_type: "VERIFICATION",
        description: "License verification completed",
        source_url: "https://regulator.example.test/register/GB-123",
        occurred_at: FRESH_AT,
      },
    ],
    ...overrides,
  };
}

async function requestCasino() {
  return getCasinoBySlugV1(
    new Request("http://localhost/api/v1/casinos/public-casino"),
    { params: Promise.resolve({ slug: "public-casino" }) },
  );
}

describe("D3A public v1 casino-detail nested BONUS containment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("applies the canonical request-clock BONUS predicate at query time", async () => {
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
      makeCasino() as never,
    );

    const response = await requestCasino();

    expect(response.status).toBe(200);
    const query = vi.mocked(prisma.casino.findUnique).mock.calls[0][0] as any;
    expect(query.where).toEqual({ slug: "public-casino" });
    expect(query.include.bonuses).not.toBe(true);
    expect(query.include.bonuses.where).toEqual(
      PublicationGateService.whereBonusPublic(NOW),
    );
    expect(query.include.bonuses.where.verified_at).toEqual({
      gte: new Date("2026-08-23T12:00:00.000Z"),
      lte: NOW,
    });
    expect(query.include.bonuses.include.history_events).toBe(true);
  });

  it("keeps fresh eligible bonuses in database order and preserves their public shape", async () => {
    const first = makeBonus({ id: "bonus-first" });
    const second = makeBonus({ id: "bonus-second" });
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
      makeCasino([first, second]) as never,
    );

    const response = await requestCasino();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data.website_url).toBe("https://public-casino.example.test");
    expect(body.data.bonuses.map((bonus: { id: string }) => bonus.id)).toEqual([
      "bonus-first",
      "bonus-second",
    ]);
    expect(body.data.bonuses[0]).not.toHaveProperty("history_events");
    expect(body.data.bonuses[0]).toMatchObject({
      id: "bonus-first",
      headline_value: "100% up to £200",
      publication_status: PublicationStatus.PUBLISHED,
      review_status: ReviewStatus.APPROVED,
      status: "ACTIVE",
    });
  });

  it.each([
    [
      "stale",
      {
        verified_at: new Date("2026-08-23T11:59:59.999Z"),
      },
    ],
    ["missing verified_at", { verified_at: null }],
    ["unpublished", { publication_status: PublicationStatus.UNPUBLISHED }],
    ["quarantined", { quarantine_reason: "EXPIRED_EVIDENCE" }],
    ["inactive", { status: "INACTIVE" }],
    ["expired", { valid_until: new Date("2026-08-26T11:59:59.999Z") }],
    ["future-dated", { verified_at: new Date("2026-08-26T12:00:00.001Z") }],
  ])(
    "removes a %s bonus returned by a drifting database mock",
    async (_label, overrides) => {
      vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
        makeCasino([makeBonus(overrides)]) as never,
      );

      const response = await requestCasino();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.bonuses).toEqual([]);
    },
  );

  it("runtime-filters malformed evidence even when scalar fields pass the query predicate", async () => {
    const queryEligibleButRuntimeIneligible = makeBonus({
      history_events: [
        {
          id: "unrelated-event",
          bonus_id: "bonus-fresh",
          field_changed: "status",
          old_value: "INACTIVE",
          new_value: "ACTIVE",
          changed_at: FRESH_AT,
          source_url: SOURCE_URL,
        },
      ],
    });
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
      makeCasino([queryEligibleButRuntimeIneligible]) as never,
    );

    const response = await requestCasino();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.bonuses).toEqual([]);
  });

  it("returns a public casino normally with an empty bonuses collection", async () => {
    vi.spyOn(prisma.casino, "findUnique").mockResolvedValue(
      makeCasino([]) as never,
    );

    const response = await requestCasino();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        id: "casino-public",
        bonuses: [],
      },
      meta: null,
      error: null,
    });
  });

  it("preserves 404 behavior for missing or runtime-ineligible parent casinos", async () => {
    const lookup = vi.spyOn(prisma.casino, "findUnique");
    lookup.mockResolvedValueOnce(null);

    const missingResponse = await requestCasino();
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      data: null,
      meta: null,
      error: { message: "Casino not found", code: "NOT_FOUND" },
    });

    lookup.mockResolvedValueOnce(
      makeCasino([], {
        publication_status: PublicationStatus.UNPUBLISHED,
      }) as never,
    );
    const ineligibleResponse = await requestCasino();
    expect(ineligibleResponse.status).toBe(404);
    expect(await ineligibleResponse.json()).toEqual({
      data: null,
      meta: null,
      error: { message: "Casino not found", code: "NOT_FOUND" },
    });
  });

  it("contains no unconditional nested-bonus or generic-service path", () => {
    const source = readFileSync(
      new URL(
        "../../../apps/web/src/app/api/v1/casinos/[slug]/route.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toMatch(/bonuses\s*:\s*true/);
    expect(source).not.toContain("CasinoService.getCasinoBySlug");
    expect(source).toContain("PublicationGateService.whereBonusPublic(now)");
    expect(source).toContain("PublicationGateService.isBonusPubliclyEligible");
  });
});
