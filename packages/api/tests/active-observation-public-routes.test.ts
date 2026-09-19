import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationStatus, ReviewStatus, prisma } from "@savvyedge/database";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";
import { GET as getBonusesV1 } from "../../../apps/web/src/app/api/v1/bonuses/route";
import { GET as getCasinosV1 } from "../../../apps/web/src/app/api/v1/casinos/route";
import { POST as calculateBonusV1 } from "../../../apps/web/src/app/api/v1/bonuses/[id]/calculate/route";
import BonusesPage from "../../../apps/web/src/app/bonuses/page";

vi.mock("../../../apps/web/src/app/bonuses/BonusesClient", () => ({
  default: () => null,
}));

const NOW = new Date("2026-08-26T12:00:00.000Z");
const OBSERVED_AT = new Date("2026-08-26T11:00:00.000Z");
const BONUS_ID = "public-active-bonus";

function publicCasino() {
  return {
    id: "public-casino",
    name: "Public Casino",
    slug: "public-casino",
    website_url: "https://public-casino.example.test",
    status: "ACTIVE",
    data_source_type: "MANUAL_AUDIT",
    verified_at: OBSERVED_AT,
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    history_events: [
      {
        event_type: "VERIFICATION",
        source_url: "https://regulator.example.test/public-casino",
        occurred_at: OBSERVED_AT,
      },
    ],
    licenses: [
      {
        status: "ACTIVE",
        verified_at: OBSERVED_AT,
        license_no: "GB-PUBLIC",
      },
    ],
  };
}

function publicBonus(overrides: Record<string, unknown> = {}) {
  const casino = publicCasino();
  return {
    id: BONUS_ID,
    casino_id: casino.id,
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 500,
    true_value_score: 75,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
    data_source_type: "SCRAPED",
    verified_at: OBSERVED_AT,
    review_status: ReviewStatus.APPROVED,
    publication_status: PublicationStatus.PUBLISHED,
    quarantine_reason: null,
    governance_version: 2,
    active_extractions: activeBonusEvidence({
      bonusId: BONUS_ID,
      observedAt: OBSERVED_AT,
      extractedAt: NOW,
    }),
    history_events: [
      {
        field_changed: "verified_at",
        source_url: "https://operator.example.test/bonus-terms",
        changed_at: NOW,
      },
    ],
    casino,
    ...overrides,
  };
}

describe("D3C public BONUS loaders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses one request clock, loads minimum active evidence, and preserves the v1 bonus envelope", async () => {
    vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([
      publicBonus(),
    ] as never);

    const response = await getBonusesV1(
      new Request("http://localhost/api/v1/bonuses?page=1&limit=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      error: null,
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: BONUS_ID,
      headline_value: "100% up to £200",
      publication_status: PublicationStatus.PUBLISHED,
    });
    expect(body.data[0]).not.toHaveProperty("active_extractions");

    const query = vi.mocked(prisma.bonus.findMany).mock.calls[0][0] as any;
    expect(query.include.active_extractions).toBeDefined();
    const activeRelation =
      PublicationGateService.bonusActiveEvidenceInclude().active_extractions;
    const activeSelect = activeRelation.select.evidence.select;
    expect(activeRelation.select).toMatchObject({
      extraction_context: true,
      bonus_id: true,
      data_source_id: true,
      evidence_id: true,
      extraction_key: true,
      contract_version: true,
    });
    expect(activeSelect).toMatchObject({
      id: true,
      data_source_id: true,
      source_url: true,
      observed_at: true,
      extracted_at: true,
      expires_at: true,
      extraction_key: true,
      bonus_claims: { select: { bonus_id: true, verdict: true } },
    });
    expect(activeSelect).not.toHaveProperty("snapshot_path");
    expect(query.where).toEqual(PublicationGateService.whereBonusPublic(NOW));
  });

  it("filters a matching malformed extraction identity at the runtime gate", async () => {
    const malformed = publicBonus() as any;
    malformed.active_extractions[0].extraction_key = "active-extraction";
    malformed.active_extractions[0].evidence.extraction_key =
      "active-extraction";
    vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([malformed] as never);

    const response = await getBonusesV1(
      new Request("http://localhost/api/v1/bonuses?page=1&limit=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total: 0, totalPages: 1 });
    expect(
      PublicationGateService.evaluateBonusActiveFreshness(malformed, NOW),
    ).toEqual({
      status: "REJECTED",
      code: "INVALID_EXTRACTION_IDENTITY",
    });
  });

  it("v1 casino list omits nested bonuses without active evidence from its response", async () => {
    vi.spyOn(prisma.casino, "findMany").mockResolvedValue([
      {
        ...publicCasino(),
        bonuses: [publicBonus({ active_extractions: [] })],
      },
    ] as never);

    const response = await getCasinosV1(
      new Request("http://localhost/api/v1/casinos?page=1&limit=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].bonuses).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(BONUS_ID);
  });

  it("bonus server page passes only eligible public bonus data to client props", async () => {
    vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([
      publicBonus(),
      publicBonus({ id: "hidden-bonus", active_extractions: [] }),
    ] as never);

    const page = await BonusesPage();
    const clientBonuses = (page as { props: { bonuses: any[] } }).props.bonuses;

    expect(clientBonuses).toHaveLength(1);
    expect(clientBonuses[0]).toMatchObject({ id: BONUS_ID });
    expect(clientBonuses[0]).not.toHaveProperty("active_extractions");
    expect(JSON.stringify(clientBonuses)).not.toContain("hidden-bonus");
  });

  it("calculator returns the existing 403 envelope when active evidence is missing", async () => {
    vi.spyOn(prisma.bonus, "findUnique").mockResolvedValue(
      publicBonus({ active_extractions: [] }) as never,
    );

    const response = await calculateBonusV1(
      new Request(`http://localhost/api/v1/bonuses/${BONUS_ID}/calculate`, {
        method: "POST",
        body: JSON.stringify({ depositAmount: 100 }),
      }),
      { params: Promise.resolve({ id: BONUS_ID }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      data: null,
      meta: null,
      error: {
        message: "Bonus fails public data publication gate",
        code: "INELIGIBLE_BONUS",
      },
    });

    const query = vi.mocked(prisma.bonus.findUnique).mock.calls[0][0] as any;
    expect(query.include.active_extractions).toBeDefined();
  });
});

describe("D3C public surface inventory contract", () => {
  const gateReaders = [
    "../../../apps/web/src/app/api/bonuses/route.ts",
    "../../../apps/web/src/app/api/casinos/route.ts",
    "../../../apps/web/src/app/api/v1/bonuses/route.ts",
    "../../../apps/web/src/app/api/v1/casinos/[slug]/route.ts",
    "../../../apps/web/src/app/api/v1/casinos/compare/route.ts",
    "../../../apps/web/src/app/api/v1/casinos/route.ts",
    "../../../apps/web/src/app/bonuses/page.tsx",
    "../../../apps/web/src/app/casinos/page.tsx",
    "../../../apps/web/src/app/page.tsx",
  ] as const;

  it.each(gateReaders)(
    "%s loads active evidence and shares one now between query and runtime gates",
    (relative) => {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      const normalized = source.replace(/\s+/g, " ");

      expect(source.match(/const now = new Date\(\);/g)).toHaveLength(1);
      expect(normalized).toContain(
        "PublicationGateService.whereBonusPublic(now)",
      );
      expect(normalized).toContain(
        "PublicationGateService.bonusActiveEvidenceInclude()",
      );
      expect(normalized).toMatch(
        /PublicationGateService\.isBonusPubliclyEligible\([^)]*\bnow\b[^)]*\)/,
      );
    },
  );

  it("calculator loads active evidence and passes its request clock to validation", () => {
    const source = readFileSync(
      new URL(
        "../../../apps/web/src/app/api/v1/bonuses/[id]/calculate/route.ts",
        import.meta.url,
      ),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(source).toContain("const now = new Date();");
    expect(source).toContain(
      "PublicationGateService.bonusActiveEvidenceInclude()",
    );
    expect(source).toMatch(
      /PublicationGateService\.validateCalculatorEligibility\([^)]*\bnow\b[^)]*\)/,
    );
  });
});
