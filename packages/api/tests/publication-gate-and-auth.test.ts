import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyApiAuthorization } from "../src/utils/auth.utils";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { BonusService } from "../src/services/bonus.service";
import { prisma } from "@savvyedge/database";
import VerificationBadge from "../../../apps/web/src/components/VerificationBadge";

// Import real route handlers for direct integration execution testing
import { POST as postCasinosV1, GET as getCasinosV1 } from "../../../apps/web/src/app/api/v1/casinos/route";
import { GET as getCasinoBySlugV1 } from "../../../apps/web/src/app/api/v1/casinos/[slug]/route";
import { POST as postBonusesV1, GET as getBonusesV1 } from "../../../apps/web/src/app/api/v1/bonuses/route";
import { POST as postIngestV1 } from "../../../apps/web/src/app/api/v1/bonuses/ingest/route";
import { GET as getDiscoveryV1, POST as postDiscoveryV1 } from "../../../apps/web/src/app/api/v1/discovery/route";
import { GET as getMetricsV1 } from "../../../apps/web/src/app/api/v1/orchestrator/metrics/route";
import { POST as calculateBonusV1 } from "../../../apps/web/src/app/api/v1/bonuses/[id]/calculate/route";
import { GET as getCasinoComparisonV1 } from "../../../apps/web/src/app/api/v1/casinos/compare/route";

describe("Phase 1: Real Protected Route Handler Auth Tests (Complete)", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-secret-12345";
  });

  afterEach(() => {
    process.env.INTERNAL_API_SECRET = originalSecret;
  });

  const protectedHandlers = [
    { name: "POST /api/v1/casinos", handler: (req: Request) => postCasinosV1(req) },
    { name: "POST /api/v1/bonuses", handler: (req: Request) => postBonusesV1(req) },
    { name: "POST /api/v1/bonuses/ingest", handler: (req: Request) => postIngestV1(req) },
    { name: "GET /api/v1/discovery", handler: (req: Request) => getDiscoveryV1(req) },
    { name: "POST /api/v1/discovery", handler: (req: Request) => postDiscoveryV1(req) },
    { name: "GET /api/v1/orchestrator/metrics", handler: (req: Request) => getMetricsV1(req) },
  ];

  for (const { name, handler } of protectedHandlers) {
    it(`${name} produces 503 Security Configuration Error when INTERNAL_API_SECRET is missing`, async () => {
      delete process.env.INTERNAL_API_SECRET;
      const req = new Request("http://localhost/api/v1/test", {
        method: name.startsWith("POST") ? "POST" : "GET",
        headers: { Authorization: "Bearer test-secret-12345" },
      });
      const res = await handler(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error.message).toContain("Security configuration error");
    });

    it(`${name} produces 401 Unauthorized when credentials header is missing`, async () => {
      const req = new Request("http://localhost/api/v1/test", {
        method: name.startsWith("POST") ? "POST" : "GET",
      });
      const res = await handler(req);
      expect(res.status).toBe(401);
    });

    it(`${name} produces 403 Forbidden when invalid Bearer token is provided`, async () => {
      const req = new Request("http://localhost/api/v1/test", {
        method: name.startsWith("POST") ? "POST" : "GET",
        headers: { Authorization: "Bearer wrong-secret" },
      });
      const res = await handler(req);
      expect(res.status).toBe(403);
    });

    it(`${name} allows valid Bearer token and reaches handler execution`, async () => {
      const req = new Request("http://localhost/api/v1/test", {
        method: name.startsWith("POST") ? "POST" : "GET",
        headers: { Authorization: "Bearer test-secret-12345" },
        body: name.startsWith("POST") ? JSON.stringify({}) : undefined,
      });
      const res = await handler(req);
      expect([200, 201, 400, 500]).toContain(res.status);
    });

    it(`${name} allows valid X-API-Key header and reaches handler execution`, async () => {
      const req = new Request("http://localhost/api/v1/test", {
        method: name.startsWith("POST") ? "POST" : "GET",
        headers: { "x-api-key": "test-secret-12345" },
        body: name.startsWith("POST") ? JSON.stringify({}) : undefined,
      });
      const res = await handler(req);
      expect([200, 201, 400, 500]).toContain(res.status);
    });
  }
});

describe("Phase 1: Malformed Explicit Monetary Candidate Parsing Tests", () => {
  it("distinguishes MISSING_CAP for headlines with no currency symbol ('100% bonus')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("100% bonus").status).toBe("MISSING_CAP");
  });

  it("returns INVALID_CAP for non-numeric explicit currency syntax ('€abc')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("€abc").status).toBe("INVALID_CAP");
  });

  it("returns INVALID_CAP for double minus symbols ('$--500')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("$--500").status).toBe("INVALID_CAP");
  });

  it("returns INVALID_CAP for EUR code with no numeric value ('EUR')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("EUR").status).toBe("INVALID_CAP");
  });

  it("returns MISSING_CAP for unsupported currency code ('500 EU')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("500 EU").status).toBe("MISSING_CAP");
  });

  it("returns INVALID_CAP for malformed double dot/comma separators ('$1..500')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("$1..500").status).toBe("INVALID_CAP");
  });

  it("returns INVALID_CAP for €NaN and €Infinity", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("€NaN").status).toBe("INVALID_CAP");
    expect(PublicationGateService.parseStructuredMonetaryCap("€Infinity").status).toBe("INVALID_CAP");
  });

  it("returns INVALID_CAP for zero monetary value ('€0')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("€0").status).toBe("INVALID_CAP");
  });

  it("returns INVALID_CAP for every negative format ('-€500', '€-500', '-500 EUR')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("-€500").status).toBe("INVALID_CAP");
    expect(PublicationGateService.parseStructuredMonetaryCap("€-500").status).toBe("INVALID_CAP");
    expect(PublicationGateService.parseStructuredMonetaryCap("-500 EUR").status).toBe("INVALID_CAP");
  });

  it("returns AMBIGUOUS_CAPS when multiple currency candidates exist ('€500 + $200')", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("€500 + $200").status).toBe("AMBIGUOUS_CAPS");
  });

  it("returns VALID for 'Up to 100% up to €500' with value 500", () => {
    const res = PublicationGateService.parseStructuredMonetaryCap("Up to 100% up to €500");
    expect(res.status).toBe("VALID");
    expect(res.value).toBe(500);
  });

  it("handles thousands separators and decimals ('$1,500.50')", () => {
    const res = PublicationGateService.parseStructuredMonetaryCap("100% up to $1,500.50");
    expect(res.status).toBe("VALID");
    expect(res.value).toBe(1500.5);
  });

  it("ignores free spin counts ('50 Free Spins') and wagering multipliers ('35x') as monetary caps", () => {
    expect(PublicationGateService.parseStructuredMonetaryCap("50 Free Spins").status).toBe("MISSING_CAP");
    expect(PublicationGateService.parseStructuredMonetaryCap("35x Wagering").status).toBe("MISSING_CAP");
  });
});

describe("Phase 1: Entity Source Evidence Predicates Tests", () => {
  const verifiedDate = new Date("2026-01-01T12:00:00Z");

  const baseCasino = {
    id: "c-100",
    name: "Apex Casino",
    slug: "apex-casino",
    website_url: "https://apexcasino.com",
    status: "ACTIVE",
    data_source_type: "MANUAL_AUDIT",
    verified_at: verifiedDate,
    licenses: [{ status: "ACTIVE", verified_at: verifiedDate, license_no: "LIC-100" }],
  };

  it("proves Casino verified_at without qualifying entity-linked evidence rejects", () => {
    const casinoNoEvidence = { ...baseCasino, history_events: [] };
    expect(PublicationGateService.getQualifyingCasinoEvidence(casinoNoEvidence)).toBeNull();
    expect(PublicationGateService.isCasinoPubliclyEligible(casinoNoEvidence)).toBe(false);
  });

  it("proves Bonus verified_at without its own qualifying evidence rejects", () => {
    const validCasino = {
      ...baseCasino,
      history_events: [{ event_type: "VERIFICATION", source_url: "https://ukgc.gov.uk/license/100", occurred_at: verifiedDate }],
    };
    const bonusNoEvidence = {
      id: "b-100",
      headline_value: "100% up to $500",
      status: "ACTIVE",
      verified_at: verifiedDate,
      casino: validCasino,
      history_events: [],
    };
    expect(PublicationGateService.getQualifyingBonusEvidence(bonusNoEvidence)).toBeNull();
    expect(PublicationGateService.isBonusPubliclyEligible(bonusNoEvidence)).toBe(false);
  });

  it("proves unrelated history/DataSource evidence (INGESTION, AUDIT, status=ACTIVE) rejects", () => {
    const casinoIngestion = {
      ...baseCasino,
      history_events: [{ event_type: "INGESTION", source_url: "https://apexcasino.com/chat", occurred_at: verifiedDate }],
    };
    expect(PublicationGateService.getQualifyingCasinoEvidence(casinoIngestion)).toBeNull();
    expect(PublicationGateService.isCasinoPubliclyEligible(casinoIngestion)).toBe(false);

    const bonusStatusActive = {
      id: "b-101",
      headline_value: "100% up to $500",
      status: "ACTIVE",
      verified_at: verifiedDate,
      casino: baseCasino,
      history_events: [{ field_changed: "status", new_value: "ACTIVE", source_url: "https://apexcasino.com/terms", changed_at: verifiedDate }],
    };
    expect(PublicationGateService.getQualifyingBonusEvidence(bonusStatusActive)).toBeNull();
    expect(PublicationGateService.isBonusPubliclyEligible(bonusStatusActive)).toBe(false);
  });

  it("proves missing required relations fail closed", () => {
    const bonusNoCasino = {
      id: "b-102",
      headline_value: "100% up to $500",
      status: "ACTIVE",
      verified_at: verifiedDate,
      casino: null,
      history_events: [{ field_changed: "verified_at", source_url: "https://apexcasino.com/terms", changed_at: verifiedDate }],
    };
    expect(PublicationGateService.isBonusPubliclyEligible(bonusNoCasino)).toBe(false);

    const casinoNoLicenses = {
      ...baseCasino,
      licenses: [],
      history_events: [{ event_type: "VERIFICATION", source_url: "https://ukgc.gov.uk/1", occurred_at: verifiedDate }],
    };
    expect(PublicationGateService.isCasinoPubliclyEligible(casinoNoLicenses)).toBe(false);
  });

  it("proves fully qualifying positive Casino and Bonus fixtures pass", () => {
    const validCasino = {
      ...baseCasino,
      history_events: [{ event_type: "VERIFICATION", source_url: "https://ukgc.gov.uk/license/100", occurred_at: verifiedDate }],
    };
    const validBonus = {
      id: "b-200",
      headline_value: "100% up to $500",
      status: "ACTIVE",
      verified_at: verifiedDate,
      casino: validCasino,
      history_events: [{ field_changed: "verified_at", source_url: "https://apexcasino.com/terms", changed_at: verifiedDate }],
    };

    expect(PublicationGateService.isCasinoPubliclyEligible(validCasino)).toBe(true);
    expect(PublicationGateService.isBonusPubliclyEligible(validBonus)).toBe(true);
  });
});

describe("Phase 1: Slot & CasinoSlot Safety Behavioral Tests (Complete)", () => {
  const verifiedDate = new Date("2026-01-01T12:00:00Z");

  const validCasino = {
    id: "c-101",
    name: "Royal Crown Casino",
    slug: "royal-crown-casino",
    website_url: "https://royalcrown.com",
    status: "ACTIVE",
    data_source_type: "MANUAL_AUDIT",
    verified_at: verifiedDate,
    licenses: [{ status: "ACTIVE", verified_at: verifiedDate, license_no: "LIC-101" }],
    history_events: [{ event_type: "VERIFICATION", source_url: "https://ukgc.gov.uk/license/101", occurred_at: verifiedDate }],
  };

  it("rejects Slot without casino_slots or empty casino_slots", () => {
    expect(PublicationGateService.isSlotPubliclyEligible({ id: "s-1", name: "Starburst", casino_slots: [] })).toBe(false);
    expect(PublicationGateService.isSlotPubliclyEligible({ id: "s-2", name: "Starburst", casino_slots: undefined })).toBe(false);
  });

  it("rejects Slot with casino_slots but missing Casino", () => {
    const slotNoCasino = {
      id: "s-3",
      name: "Starburst",
      casino_slots: [{ verified_at: verifiedDate, source_url: "https://royalcrown.com/game", casino: null }],
    };
    expect(PublicationGateService.isSlotPubliclyEligible(slotNoCasino)).toBe(false);
  });

  it("rejects CasinoSlot without verified_at", () => {
    const slotUnverifiedCS = {
      id: "s-4",
      name: "Book of Dead",
      casino_slots: [{ verified_at: null, source_url: "https://royalcrown.com/game", casino: validCasino }],
    };
    expect(PublicationGateService.isSlotPubliclyEligible(slotUnverifiedCS)).toBe(false);
  });

  it("rejects null, empty, whitespace, malformed, ftp, and javascript source_url", () => {
    const invalidUrls = [null, "", "   ", "malformed-url", "ftp://game.com", "javascript:alert(1)"];
    for (const url of invalidUrls) {
      const slotBadUrl = {
        id: "s-5",
        name: "Slot",
        casino_slots: [{ verified_at: verifiedDate, source_url: url, casino: validCasino }],
      };
      expect(PublicationGateService.isSlotPubliclyEligible(slotBadUrl)).toBe(false);
    }
  });

  it("proves rtp_current alone NEVER qualifies a Slot without verified_at and valid source_url", () => {
    const slotRtpOnly = {
      id: "s-6",
      name: "High RTP Slot",
      rtp_current: 99.0,
      casino_slots: [{ verified_at: null, source_url: null, casino: validCasino }],
    };
    expect(PublicationGateService.isSlotPubliclyEligible(slotRtpOnly)).toBe(false);
  });

  it("passes fully sourced and verified CasinoSlot with an eligible Casino", () => {
    const validSlot = {
      id: "s-7",
      name: "Book of Dead",
      casino_slots: [{ verified_at: verifiedDate, source_url: "https://royalcrown.com/games/book-of-dead", casino: validCasino }],
    };
    expect(PublicationGateService.isSlotPubliclyEligible(validSlot)).toBe(true);
  });
});

describe("Phase 1: Verification Badge Fail-Closed Presentation Policy Test", () => {
  it("proves isVerificationBadgeEligible returns false in Phase 1 for all entities", () => {
    const casino = { id: "c-1", verified_at: new Date() };
    const bonus = { id: "b-1", verified_at: new Date() };
    expect(PublicationGateService.isVerificationBadgeEligible(casino)).toBe(false);
    expect(PublicationGateService.isVerificationBadgeEligible(bonus)).toBe(false);
  });

  it("renders no Verified claim or green styling when centralized badge eligibility is false", () => {
    const eligible = PublicationGateService.isVerificationBadgeEligible({
      id: "c-public-surface",
      verified_at: new Date(),
    });
    const badge = VerificationBadge({ eligible }) as any;
    const renderedText = badge.props.children;

    expect(renderedText).toBe("Verification pending");
    expect(renderedText).not.toContain("Verified");
    expect(badge.props.className).not.toContain("#10b981");
  });
});

describe("Phase 1: Public Casino Comparison Runtime Gate Regression Tests", () => {
  const checkedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

  function makeCasino(slug: string) {
    return {
      id: `casino-${slug}`,
      slug,
      name: slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      website_url: `https://${slug}.example.com`,
      status: "ACTIVE",
      data_source_type: "MANUAL_AUDIT",
      verified_at: checkedAt,
      history_events: [
        {
          event_type: "VERIFICATION",
          source_url: `https://regulator.example.com/${slug}`,
          occurred_at: checkedAt,
        },
      ],
      licenses: [
        {
          status: "ACTIVE",
          verified_at: checkedAt,
          license_no: `LIC-${slug}`,
          regulator: {
            name: "Test Regulator",
            jurisdiction: {
              name: "Test Jurisdiction",
              country: "Test Country",
            },
          },
        },
      ],
      bonuses: [] as any[],
    };
  }

  function makeBonus(headline: string, eligible = true) {
    return {
      id: `bonus-${headline}`,
      headline_value: headline,
      wagering_requirement: 35,
      max_conversion: 500,
      true_value_score: 70,
      status: "ACTIVE",
      data_source_type: "MANUAL_AUDIT",
      valid_until: null,
      verified_at: checkedAt,
      created_at: checkedAt,
      history_events: [
        {
          field_changed: eligible ? "verified_at" : "status",
          new_value: eligible ? checkedAt.toISOString() : "ACTIVE",
          source_url: "https://operator.example.com/terms",
          changed_at: checkedAt,
        },
      ],
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("excludes prefilter-only casinos and ineligible bonuses while preserving eligible comparison data", async () => {
    const firstCasino = makeCasino("eligible-one");
    firstCasino.bonuses = [
      makeBonus("Ineligible newest bonus", false),
      makeBonus("Eligible older bonus"),
    ];
    const secondCasino = makeCasino("eligible-two");
    secondCasino.bonuses = [makeBonus("Second eligible bonus")];
    const prefilterOnlyCasino = {
      ...makeCasino("prefilter-only"),
      history_events: [
        {
          event_type: "INGESTION",
          source_url: "https://operator.example.com/import",
          occurred_at: checkedAt,
        },
      ],
    };

    const findMany = vi
      .spyOn(prisma.casino, "findMany")
      .mockResolvedValue([
        firstCasino,
        secondCasino,
        prefilterOnlyCasino,
      ] as never);
    vi.spyOn(prisma.bonusHistoryEvent, "count").mockResolvedValue(0);

    const response = await getCasinoComparisonV1(
      new Request(
        "http://localhost/api/v1/casinos/compare?slugs=eligible-one,eligible-two,prefilter-only"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((casino: any) => casino.slug)).toEqual([
      "eligible-one",
      "eligible-two",
    ]);
    expect(body.data[0].activeBonus.headline_value).toBe(
      "Eligible older bonus"
    );
    expect(
      body.data.some(
        (casino: any) =>
          casino.activeBonus?.headline_value === "Ineligible newest bonus"
      )
    ).toBe(false);

    const query = findMany.mock.calls[0][0] as any;
    expect(query.include.history_events).toBe(true);
    expect(query.include.licenses).toBeDefined();
    expect(query.include.bonuses.include.history_events).toBe(true);
  });

  it("fails safely when fewer than two requested casinos pass the runtime gate", async () => {
    const eligibleCasino = makeCasino("eligible-one");
    const prefilterOnlyCasino = {
      ...makeCasino("prefilter-only"),
      history_events: [],
    };

    vi.spyOn(prisma.casino, "findMany").mockResolvedValue([
      eligibleCasino,
      prefilterOnlyCasino,
    ] as never);

    const response = await getCasinoComparisonV1(
      new Request(
        "http://localhost/api/v1/casinos/compare?slugs=eligible-one,prefilter-only"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.message).toContain("Fewer than two");
  });
});

describe("Phase 1: Zero-Wagering Formula Safety Regression Test", () => {
  it("proves calculation succeeds safely when wagering_requirement is 0 for deposit match", () => {
    const output = BonusService.calculateBonusEV({
      depositAmount: 100,
      headlineValue: "100% up to $200",
      wageringRequirement: 0,
      maxConversion: null,
      validUntil: null,
      gameContributionPct: 100,
      slotRtp: 96.5,
    });

    expect(output.bonusAmount).toBe(100);
    expect(output.totalWageringRequired).toBe(0);
    expect(output.expectedValue).toBe(100);
    expect(output.isCalculable).toBe(true);
  });
});
