import { describe, expect, it } from "vitest";
import { classifyActiveObservation } from "../src/audits/production-bonus-coverage.classifier";
import {
  DEFAULT_BONUS_FRESHNESS_POLICY,
  evaluateActiveObservationFreshness,
  type ActiveObservationFreshnessDecision,
  type ActiveObservationFreshnessInput,
} from "../src/services/freshness.policy";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";

const AUDIT_NOW = new Date("2026-08-10T12:00:00.000Z");
const BONUS_ID = "bonus-audit-parity";

function freshBonus(
  observedAt: Date = AUDIT_NOW,
): ActiveObservationFreshnessInput {
  return {
    id: BONUS_ID,
    verified_at: observedAt,
    active_extractions: activeBonusEvidence({
      bonusId: BONUS_ID,
      observedAt,
      extractedAt: AUDIT_NOW,
    }),
  };
}

function mutateFreshBonus(
  mutate: (bonus: any) => void,
): ActiveObservationFreshnessInput {
  const bonus = freshBonus();
  mutate(bonus);
  return bonus;
}

interface ParityCase {
  label: string;
  input: ActiveObservationFreshnessInput;
  expected: ActiveObservationFreshnessDecision;
}

const exactBoundary = new Date(
  AUDIT_NOW.getTime() - DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs,
);
const staleBoundary = new Date(exactBoundary.getTime() - 1);

const cases: ParityCase[] = [
  {
    label: "fresh",
    input: freshBonus(),
    expected: {
      status: "FRESH",
      evidenceId: `evidence-active-${BONUS_ID}`,
      observedAt: AUDIT_NOW,
    },
  },
  {
    label: "exactly 72 hours",
    input: freshBonus(exactBoundary),
    expected: {
      status: "FRESH",
      evidenceId: `evidence-active-${BONUS_ID}`,
      observedAt: exactBoundary,
    },
  },
  {
    label: "matching malformed extraction identity",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].extraction_key = "active-extraction";
      bonus.active_extractions[0].evidence.extraction_key = "active-extraction";
    }),
    expected: { status: "REJECTED", code: "INVALID_EXTRACTION_IDENTITY" },
  },
  {
    label: "missing extraction contract version",
    input: mutateFreshBonus((bonus) => {
      delete bonus.active_extractions[0].contract_version;
    }),
    expected: { status: "REJECTED", code: "INVALID_EXTRACTION_IDENTITY" },
  },
  {
    label: "72 hours plus 1ms",
    input: freshBonus(staleBoundary),
    expected: { status: "REJECTED", code: "STALE_OBSERVATION" },
  },
  {
    label: "timezone-equivalent projection",
    input: mutateFreshBonus((bonus) => {
      bonus.verified_at = "2026-08-10T14:00:00.000+02:00";
      bonus.active_extractions[0].evidence.observed_at =
        "2026-08-10T12:00:00.000Z";
    }),
    expected: {
      status: "FRESH",
      evidenceId: `evidence-active-${BONUS_ID}`,
      observedAt: AUDIT_NOW,
    },
  },
  {
    label: "future observation",
    input: mutateFreshBonus((bonus) => {
      const future = new Date(AUDIT_NOW.getTime() + 1);
      bonus.verified_at = future;
      bonus.active_extractions[0].evidence.observed_at = future;
    }),
    expected: { status: "REJECTED", code: "FUTURE_OBSERVATION" },
  },
  {
    label: "invalid observation",
    input: mutateFreshBonus((bonus) => {
      bonus.verified_at = "not-a-date";
      bonus.active_extractions[0].evidence.observed_at = "not-a-date";
    }),
    expected: { status: "REJECTED", code: "INVALID_OBSERVATION" },
  },
  {
    label: "invalid extraction timestamp",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].evidence.extracted_at = "not-a-date";
    }),
    expected: { status: "REJECTED", code: "INVALID_OBSERVATION" },
  },
  {
    label: "future extraction timestamp",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].evidence.extracted_at = new Date(
        AUDIT_NOW.getTime() + 1,
      );
    }),
    expected: { status: "REJECTED", code: "FUTURE_OBSERVATION" },
  },
  {
    label: "premature evidence",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].evidence.valid_from = new Date(
        AUDIT_NOW.getTime() + 1,
      );
    }),
    expected: { status: "REJECTED", code: "PREMATURE_EVIDENCE" },
  },
  {
    label: "expired evidence",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].evidence.expires_at = new Date(
        AUDIT_NOW.getTime() - 1,
      );
    }),
    expected: { status: "REJECTED", code: "EXPIRED_EVIDENCE" },
  },
  {
    label: "expiry equal to auditNow",
    input: mutateFreshBonus((bonus) => {
      bonus.active_extractions[0].evidence.expires_at = AUDIT_NOW;
    }),
    expected: { status: "REJECTED", code: "EXPIRED_EVIDENCE" },
  },
  {
    label: "projection mismatch",
    input: mutateFreshBonus((bonus) => {
      bonus.verified_at = new Date(AUDIT_NOW.getTime() - 1);
    }),
    expected: { status: "REJECTED", code: "PROJECTION_MISMATCH" },
  },
  {
    label: "missing pointer",
    input: { id: BONUS_ID, verified_at: AUDIT_NOW, active_extractions: [] },
    expected: { status: "REJECTED", code: "MISSING_ACTIVE_POINTER" },
  },
  {
    label: "multiple pointers",
    input: {
      ...freshBonus(),
      active_extractions: [
        ...activeBonusEvidence({ bonusId: BONUS_ID, observedAt: AUDIT_NOW }),
        ...activeBonusEvidence({
          bonusId: BONUS_ID,
          observedAt: AUDIT_NOW,
          evidenceId: "evidence-second",
          extractionKey: "extraction-second",
        }),
      ],
    },
    expected: { status: "REJECTED", code: "AMBIGUOUS_ACTIVE_POINTER" },
  },
  {
    label: "missing active evidence",
    input: {
      ...freshBonus(),
      active_extractions: activeBonusEvidence({
        bonusId: BONUS_ID,
        observedAt: AUDIT_NOW,
        withoutEvidence: true,
      }),
    },
    expected: { status: "REJECTED", code: "MISSING_ACTIVE_EVIDENCE" },
  },
  {
    label: "pointer/evidence identity mismatch",
    input: {
      ...freshBonus(),
      active_extractions: activeBonusEvidence({
        bonusId: BONUS_ID,
        observedAt: AUDIT_NOW,
        pointerEvidenceId: "evidence-foreign",
      }),
    },
    expected: { status: "REJECTED", code: "ACTIVE_EVIDENCE_MISMATCH" },
  },
  {
    label: "missing same-Bonus SUPPORTS claim",
    input: {
      ...freshBonus(),
      active_extractions: activeBonusEvidence({
        bonusId: BONUS_ID,
        observedAt: AUDIT_NOW,
        claimBonusId: "bonus-foreign",
      }),
    },
    expected: { status: "REJECTED", code: "MISSING_SUPPORTING_CLAIM" },
  },
  {
    label: "invalid evidence source",
    input: {
      ...freshBonus(),
      active_extractions: activeBonusEvidence({
        bonusId: BONUS_ID,
        observedAt: AUDIT_NOW,
        sourceUrl: "file:///private/offer",
      }),
    },
    expected: { status: "REJECTED", code: "INVALID_EVIDENCE_SOURCE" },
  },
];

describe("production Bonus coverage non-default policy parity", () => {
  // M5: the audit must measure the window it is told to, and must still match
  // the canonical evaluator under that window rather than the default.
  const SHORT_POLICY = { maxAgeMs: 60 * 60 * 1000 }; // 1 hour
  const twoHoursAgo = new Date(AUDIT_NOW.getTime() - 2 * 60 * 60 * 1000);

  it("stays fresh under the default window and stale under a shorter one", () => {
    const bonus = freshBonus(twoHoursAgo);

    const canonicalDefault = evaluateActiveObservationFreshness(
      bonus,
      AUDIT_NOW,
    );
    const canonicalShort = evaluateActiveObservationFreshness(
      bonus,
      AUDIT_NOW,
      SHORT_POLICY,
    );

    expect(canonicalDefault).toEqual({
      status: "FRESH",
      evidenceId: `evidence-active-${BONUS_ID}`,
      observedAt: twoHoursAgo,
    });
    expect(canonicalShort).toEqual({
      status: "REJECTED",
      code: "STALE_OBSERVATION",
    });

    // The classifier reproduces each canonical decision exactly.
    expect(
      classifyActiveObservation({ bonus }, AUDIT_NOW).activeObservationDecision,
    ).toEqual(canonicalDefault);
    expect(
      classifyActiveObservation({ bonus }, AUDIT_NOW, SHORT_POLICY)
        .activeObservationDecision,
    ).toEqual(canonicalShort);
  });

  it("treats an omitted policy as the canonical default", () => {
    const bonus = freshBonus(twoHoursAgo);

    expect(classifyActiveObservation({ bonus }, AUDIT_NOW)).toEqual(
      classifyActiveObservation({ bonus }, AUDIT_NOW, {
        maxAgeMs: DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs,
      }),
    );
  });
});

describe("production Bonus coverage canonical evaluator parity", () => {
  it.each(cases)(
    "preserves the canonical $label decision",
    ({ input, expected }) => {
      const canonicalDecision = evaluateActiveObservationFreshness(
        input,
        AUDIT_NOW,
      );
      const audit = classifyActiveObservation({ bonus: input }, AUDIT_NOW);

      expect(canonicalDecision).toEqual(expected);
      expect(audit.activeObservationDecision).toEqual(canonicalDecision);
      expect(audit.activeObservationCompliant).toBe(
        canonicalDecision.status === "FRESH",
      );
      expect(audit.activeObservationPrimaryFailure).toBe(
        canonicalDecision.status === "REJECTED" ? canonicalDecision.code : null,
      );
    },
  );
});
