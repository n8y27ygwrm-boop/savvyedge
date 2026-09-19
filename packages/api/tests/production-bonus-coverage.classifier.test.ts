import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyProductionBonusCoverage,
  classifyPublicationGovernance,
  classifyReverificationReadiness,
  reconcileProductionBonusCoverage,
} from "../src/audits/production-bonus-coverage.classifier";
import { type ProductionBonusCoverageReconciliationInput } from "../src/audits/production-bonus-coverage.contract";
import { isBonusSourceOfferKey } from "../src/utils/bonus-source-offer-key";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";

const KEY_A = `bonus-url-v1:${"a".repeat(64)}`;
const KEY_B = `bonus-url-v1:${"b".repeat(64)}`;

describe("production Bonus coverage source identity", () => {
  it.each([
    [KEY_A, true],
    [null, false],
    [undefined, false],
    ["", false],
    ["   ", false],
    [` ${KEY_A}`, false],
    [`${KEY_A} `, false],
    [`bonus-url-v1:${"A".repeat(64)}`, false],
    [`bonus-url-v2:${"a".repeat(64)}`, false],
    [`bonus-url-v1:${"a".repeat(63)}`, false],
    [`bonus-url-v1:${"a".repeat(65)}`, false],
    ["https://operator.example.test/bonus", false],
    [{ toString: () => KEY_A }, false],
  ])("validates exact source-offer-key syntax for %j", (value, expected) => {
    expect(isBonusSourceOfferKey(value)).toBe(expected);
  });

  it("allows an identity-derivable active pointer when the stored key is missing", () => {
    expect(
      classifyReverificationReadiness({
        sourceResolution: "ACTIVE_POINTER",
        sourceOfferKey: null,
        resolvedCanonicalSourceOfferKey: KEY_A,
      }),
    ).toEqual({
      readiness: "READY",
      sourceResolution: "ACTIVE_POINTER",
      sourceOfferKeySyntax: "MISSING",
      canonicalIdentityDerivability: "DERIVABLE",
      canonicalIdentityEquality: "NOT_COMPARABLE",
      canonicalIdentityStatus: "DERIVABLE",
    });
  });

  it("allows legacy evidence only with a canonical matching stored identity", () => {
    expect(
      classifyReverificationReadiness({
        sourceResolution: "LEGACY_EVIDENCE",
        sourceOfferKey: KEY_A,
        resolvedCanonicalSourceOfferKey: KEY_A,
      }),
    ).toMatchObject({
      readiness: "READY",
      sourceOfferKeySyntax: "CANONICAL",
      canonicalIdentityEquality: "MATCH",
      canonicalIdentityStatus: "VERIFIED",
    });
  });

  it.each([
    ["missing", undefined, "MISSING"],
    ["empty", "", "MISSING"],
    ["whitespace-only", "   ", "WHITESPACE_PADDED"],
    ["whitespace-padded", ` ${KEY_A}`, "WHITESPACE_PADDED"],
    ["malformed", "bonus-url-v1:not-a-hash", "MALFORMED"],
  ] as const)(
    "rejects a %s stored key for legacy evidence",
    (_label, sourceOfferKey, expectedSyntax) => {
      expect(
        classifyReverificationReadiness({
          sourceResolution: "LEGACY_EVIDENCE",
          sourceOfferKey,
          resolvedCanonicalSourceOfferKey: KEY_A,
        }),
      ).toMatchObject({
        readiness: "NOT_READY",
        sourceOfferKeySyntax: expectedSyntax,
      });
    },
  );

  it("rejects a URL-only legacy bootstrap", () => {
    const urlOnlyInput = {
      sourceResolution: "LEGACY_EVIDENCE" as const,
      resolvedSourceUrl: "https://operator.example.test/bonus",
    };

    expect(classifyReverificationReadiness(urlOnlyInput)).toMatchObject({
      readiness: "NOT_READY",
      sourceOfferKeySyntax: "MISSING",
      canonicalIdentityDerivability: "UNVERIFIABLE",
    });
  });

  it("rejects canonical identity mismatch and unresolved sources", () => {
    expect(
      classifyReverificationReadiness({
        sourceResolution: "ACTIVE_POINTER",
        sourceOfferKey: KEY_A,
        resolvedCanonicalSourceOfferKey: KEY_B,
      }),
    ).toMatchObject({
      readiness: "NOT_READY",
      canonicalIdentityEquality: "MISMATCH",
      canonicalIdentityStatus: "MISMATCH",
    });

    expect(
      classifyReverificationReadiness({
        sourceResolution: "UNRESOLVED",
        sourceOfferKey: KEY_A,
        resolvedCanonicalSourceOfferKey: KEY_A,
      }),
    ).toMatchObject({
      readiness: "NOT_READY",
      sourceResolution: "UNRESOLVED",
    });
  });

  it("fails closed when an active pointer's canonical identity is unverifiable", () => {
    expect(
      classifyReverificationReadiness({
        sourceResolution: "ACTIVE_POINTER",
        sourceOfferKey: null,
        resolvedCanonicalSourceOfferKey: "not-canonical",
      }),
    ).toMatchObject({
      readiness: "NOT_READY",
      canonicalIdentityDerivability: "UNVERIFIABLE",
      canonicalIdentityStatus: "UNVERIFIABLE",
    });
  });
});

describe("production Bonus coverage governance", () => {
  const consistentClaim = {
    subjectBonusIdMatches: true,
    verdict: "SUPPORTS",
    resolvesToActiveEvidence: true,
  } as const;

  it("classifies every governance outcome", () => {
    expect(
      classifyPublicationGovernance({
        currentPublicationEventAvailable: true,
        activeEvidenceAvailable: true,
        reliedUponClaims: [consistentClaim],
      }),
    ).toEqual({ assessment: "CONSISTENT", diagnostics: [] });

    expect(
      classifyPublicationGovernance({
        currentPublicationEventAvailable: true,
        activeEvidenceAvailable: true,
        reliedUponClaims: [],
      }),
    ).toEqual({
      assessment: "INCONSISTENT",
      diagnostics: ["MISSING_RELIED_UPON_PUBLICATION_CLAIMS"],
    });

    expect(
      classifyPublicationGovernance({
        currentPublicationEventAvailable: false,
        activeEvidenceAvailable: false,
        reliedUponClaims: [consistentClaim],
      }),
    ).toEqual({
      assessment: "NOT_ASSESSABLE",
      diagnostics: [
        "MISSING_CURRENT_PUBLICATION_EVENT",
        "ACTIVE_EVIDENCE_UNAVAILABLE",
      ],
    });
  });

  it("reports all assessable claim inconsistencies without changing dimensions", () => {
    expect(
      classifyPublicationGovernance({
        currentPublicationEventAvailable: true,
        activeEvidenceAvailable: true,
        reliedUponClaims: [
          {
            subjectBonusIdMatches: false,
            verdict: "CONTRADICTS",
            resolvesToActiveEvidence: false,
          },
        ],
      }),
    ).toEqual({
      assessment: "INCONSISTENT",
      diagnostics: [
        "PUBLICATION_CLAIM_SUBJECT_MISMATCH",
        "PUBLICATION_CLAIM_NOT_SUPPORTS",
        "PUBLICATION_CLAIM_NOT_ACTIVE_EVIDENCE",
      ],
    });
  });

  it("keeps governance independent of active-observation compliance", () => {
    const result = classifyProductionBonusCoverage(
      {
        activeObservation: { bonus: { id: "bonus-without-pointer" } },
        reverificationReadiness: {
          sourceResolution: "UNRESOLVED",
        },
        publicationGovernance: {
          currentPublicationEventAvailable: true,
          activeEvidenceAvailable: true,
          reliedUponClaims: [consistentClaim],
        },
      },
      new Date("2026-08-10T12:00:00.000Z"),
    );

    expect(result.activeObservation).toMatchObject({
      activeObservationCompliant: false,
      activeObservationPrimaryFailure: "MISSING_ACTIVE_POINTER",
    });
    expect(result.publicationGovernance.assessment).toBe("CONSISTENT");
  });
});

describe("production Bonus coverage reconciliation", () => {
  const balanced: ProductionBonusCoverageReconciliationInput = {
    publishedApprovedActive: 10,
    activeObservationCompliant: 6,
    activeObservationNonCompliant: 4,
    activeObservationPrimaryFailureCounts: {
      MISSING_ACTIVE_POINTER: 2,
      STALE_OBSERVATION: 2,
    },
    reverificationReady: 7,
    reverificationNotReady: 3,
    governanceConsistent: 5,
    governanceInconsistent: 3,
    governanceNotAssessable: 2,
  };

  it("accepts all four exact equations", () => {
    expect(reconcileProductionBonusCoverage(balanced)).toEqual({
      valid: true,
      issues: [],
      totals: { activeObservationPrimaryFailures: 4 },
      equations: {
        activeObservation: true,
        activeObservationPrimaryFailures: true,
        reverificationReadiness: true,
        publicationGovernance: true,
      },
    });
  });

  it.each([
    ["activeObservationCompliant", 5, "ACTIVE_OBSERVATION_TOTAL_MISMATCH"],
    [
      "activeObservationNonCompliant",
      3,
      "ACTIVE_OBSERVATION_PRIMARY_FAILURE_TOTAL_MISMATCH",
    ],
    ["reverificationReady", 6, "REVERIFICATION_TOTAL_MISMATCH"],
    ["governanceConsistent", 4, "GOVERNANCE_TOTAL_MISMATCH"],
  ] as const)("rejects a broken %s equation", (field, value, issueCode) => {
    const result = reconcileProductionBonusCoverage({
      ...balanced,
      [field]: value,
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: issueCode }),
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid count %s without throwing",
    (invalidCount) => {
      expect(
        reconcileProductionBonusCoverage({
          ...balanced,
          publishedApprovedActive: invalidCount,
        }),
      ).toMatchObject({
        valid: false,
        issues: [{ code: "INVALID_COUNT", field: "publishedApprovedActive" }],
      });
    },
  );

  const ALL_EQUATIONS_FALSE = {
    activeObservation: false,
    activeObservationPrimaryFailures: false,
    reverificationReadiness: false,
    publicationGovernance: false,
  } as const;

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "not-a-reconciliation-input"],
    ["a number", 7],
    ["a boolean", true],
    ["a function", () => balanced],
  ])("fails closed for %s input without throwing", (_label, malformed) => {
    const reconcile = () =>
      reconcileProductionBonusCoverage(
        malformed as unknown as ProductionBonusCoverageReconciliationInput,
      );

    expect(reconcile).not.toThrow();
    expect(reconcile()).toEqual({
      valid: false,
      issues: [{ code: "INVALID_COUNT", field: "input" }],
      totals: { activeObservationPrimaryFailures: null },
      equations: ALL_EQUATIONS_FALSE,
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "STALE_OBSERVATION"],
    ["a number", 7],
    ["a boolean", true],
    ["a function", () => 4],
  ])(
    "fails closed for %s primary-failure map without throwing",
    (_label, malformedCounts) => {
      const reconcile = () =>
        reconcileProductionBonusCoverage({
          ...balanced,
          activeObservationPrimaryFailureCounts:
            malformedCounts as unknown as ProductionBonusCoverageReconciliationInput["activeObservationPrimaryFailureCounts"],
        });

      expect(reconcile).not.toThrow();
      const result = reconcile();

      // Exactly one issue, naming the container rather than any key, and the
      // other three equations stay independently true.
      expect(result).toEqual({
        valid: false,
        issues: [
          {
            code: "INVALID_COUNT",
            field: "activeObservationPrimaryFailureCounts",
          },
        ],
        totals: { activeObservationPrimaryFailures: null },
        equations: {
          activeObservation: true,
          activeObservationPrimaryFailures: false,
          reverificationReadiness: true,
          publicationGovernance: true,
        },
      });
    },
  );

  it("never reports an unusable primary-failure map as balanced at zero", () => {
    // The dangerous case: enumerating an unusable map would sum to 0, which
    // equals a zero non-compliant count and would look reconciled.
    const zeroNonCompliant: ProductionBonusCoverageReconciliationInput = {
      ...balanced,
      activeObservationCompliant: 10,
      activeObservationNonCompliant: 0,
      activeObservationPrimaryFailureCounts:
        undefined as unknown as ProductionBonusCoverageReconciliationInput["activeObservationPrimaryFailureCounts"],
    };

    expect(reconcileProductionBonusCoverage(zeroNonCompliant)).toMatchObject({
      valid: false,
      totals: { activeObservationPrimaryFailures: null },
      equations: { activeObservationPrimaryFailures: false },
      issues: [
        {
          code: "INVALID_COUNT",
          field: "activeObservationPrimaryFailureCounts",
        },
      ],
    });
  });

  it("still accepts an empty primary-failure map with no non-compliant bonuses", () => {
    expect(
      reconcileProductionBonusCoverage({
        ...balanced,
        activeObservationCompliant: 10,
        activeObservationNonCompliant: 0,
        activeObservationPrimaryFailureCounts: {},
      }),
    ).toEqual({
      valid: true,
      issues: [],
      totals: { activeObservationPrimaryFailures: 0 },
      equations: {
        activeObservation: true,
        activeObservationPrimaryFailures: true,
        reverificationReadiness: true,
        publicationGovernance: true,
      },
    });
  });

  it("rejects invalid and cross-dimension primary failure entries", () => {
    const invalidCounts = {
      ...balanced,
      activeObservationPrimaryFailureCounts: {
        STALE_OBSERVATION: -1,
        REVERIFICATION_NOT_READY: 5,
      },
    } as unknown as ProductionBonusCoverageReconciliationInput;

    expect(reconcileProductionBonusCoverage(invalidCounts)).toMatchObject({
      valid: false,
      totals: { activeObservationPrimaryFailures: null },
      equations: { activeObservationPrimaryFailures: false },
      issues: expect.arrayContaining([
        {
          code: "INVALID_COUNT",
          field: "activeObservationPrimaryFailureCounts.STALE_OBSERVATION",
        },
        {
          code: "UNKNOWN_ACTIVE_OBSERVATION_PRIMARY_FAILURE",
          field:
            "activeObservationPrimaryFailureCounts.REVERIFICATION_NOT_READY",
        },
      ]),
    });
  });
});

describe("production Bonus coverage purity and import boundary", () => {
  it("is deterministic and does not mutate inputs", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const input = {
      activeObservation: {
        bonus: {
          id: "bonus-pure",
          verified_at: new Date(now),
          active_extractions: activeBonusEvidence({
            bonusId: "bonus-pure",
            observedAt: new Date(now),
            extractedAt: new Date(now),
          }),
        },
      },
      reverificationReadiness: {
        sourceResolution: "ACTIVE_POINTER" as const,
        sourceOfferKey: null,
        resolvedCanonicalSourceOfferKey: KEY_A,
      },
      publicationGovernance: {
        currentPublicationEventAvailable: true,
        activeEvidenceAvailable: true,
        reliedUponClaims: [
          {
            subjectBonusIdMatches: true,
            verdict: "SUPPORTS",
            resolvesToActiveEvidence: true,
          },
        ],
      },
    };
    const before = structuredClone(input);

    const first = classifyProductionBonusCoverage(input, now);
    const second = classifyProductionBonusCoverage(input, now);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first).toMatchObject({
      activeObservation: { activeObservationCompliant: true },
      reverificationReadiness: { readiness: "READY" },
      publicationGovernance: { assessment: "CONSISTENT" },
    });
  });

  it("keeps production audit modules inside the pure import boundary", () => {
    const moduleUrls = [
      new URL(
        "../src/audits/production-bonus-coverage.contract.ts",
        import.meta.url,
      ),
      new URL(
        "../src/audits/production-bonus-coverage.classifier.ts",
        import.meta.url,
      ),
      // The classifier imports this shared predicate, so it is part of the
      // boundary: it must stay dependency-free rather than reaching the
      // Prisma-bearing bonus-source-identity module.
      new URL("../src/utils/bonus-source-offer-key.ts", import.meta.url),
    ];
    const sources = moduleUrls.map((url) =>
      readFileSync(fileURLToPath(url), "utf8"),
    );
    const forbidden = [
      /from\s+["'][^"']*bonus-source-identity["']/,
      /from\s+["'][^"']*(?:database|prisma|config|ingestion|queue|workflow-transition|bonus-reverification|publication-gate)[^"']*["']/i,
      /from\s+["'](?:node:)?(?:fs|http|https|net|tls)["']/i,
      /process\.env/,
      /new\s+PrismaClient\s*\(/,
    ];

    for (const source of sources) {
      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
