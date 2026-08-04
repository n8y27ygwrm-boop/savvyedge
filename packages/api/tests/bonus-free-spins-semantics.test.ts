import { describe, expect, it } from "vitest";
import type { CreateBonusInput } from "@savvyedge/types";
import {
  analyzeBonusSourceSemantics,
  normalizeBonusExtraction,
} from "@savvyedge/ai-agents";
import { BonusService } from "../src/services/bonus.service";
import { resolveHeadlineEvidenceObservation } from "../src/services/ingestion.service";
import { PublicationGateService } from "../src/services/publication-gate.service";

const casinoId = "00000000-0000-4000-8000-000000000001";

function extracted(
  overrides: Partial<CreateBonusInput> = {},
): CreateBonusInput {
  return {
    casino_id: casinoId,
    type: "FREE_SPINS",
    headline_value: "£30",
    wagering_requirement: 10,
    max_conversion: 30,
    valid_from: new Date("2026-08-02T00:00:00.000Z"),
    valid_until: new Date("2026-12-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

describe("free-spins bonus semantics", () => {
  it("normalizes the exact Unibet offer without treating £30 as the offer or cap", () => {
    const source = [
      "Get 300 FREE SPINS when you play £30 on slots",
      "Wager winnings from Free Spins 10 times to receive Cash",
    ].join("\n");

    const result = normalizeBonusExtraction(source, extracted());

    expect(result.bonus).toMatchObject({
      type: "FREE_SPINS",
      headline_value: "300 FREE SPINS",
      wagering_requirement: 10,
      max_conversion: null,
      valid_from: null,
      valid_until: null,
    });
    expect(result.semantics).toMatchObject({
      headlineSourceText: "300 FREE SPINS",
      freeSpinCount: 300,
      freeSpinValue: null,
      qualifyingPlaySpend: {
        amount: 30,
        currency: "£",
        sourceText: "play £30",
      },
      depositRequirement: null,
      monetaryBonusCap: null,
      maxConversion: null,
      wagering: {
        multiplier: 10,
        scope: "FREE_SPIN_WINNINGS",
        sourceText: "Wager winnings from Free Spins 10 times to receive Cash",
      },
    });

    expect(
      PublicationGateService.parseStructuredMonetaryCap(source),
    ).toMatchObject({ status: "MISSING_CAP" });
    expect(
      PublicationGateService.parseStructuredMonetaryCap(
        result.bonus.headline_value!,
      ),
    ).toMatchObject({ status: "MISSING_CAP" });
    expect(
      BonusService.calculateTrueValueScore(
        result.bonus.headline_value,
        result.bonus.wagering_requirement,
        result.bonus.max_conversion,
      ),
    ).toBe(0);
    expect(
      resolveHeadlineEvidenceObservation(result.bonus, result.semantics),
    ).toBe("300 FREE SPINS");
  });

  it("keeps an explicit deposit condition separate from a 100-spin offer", () => {
    const source = "Get 100 free spins when you deposit £20";
    const result = normalizeBonusExtraction(source, extracted());

    expect(result.bonus).toMatchObject({
      type: "FREE_SPINS",
      headline_value: "100 free spins",
      wagering_requirement: null,
      max_conversion: null,
    });
    expect(result.semantics.freeSpinCount).toBe(100);
    expect(result.semantics.depositRequirement).toMatchObject({
      amount: 20,
      currency: "£",
      sourceText: "deposit £20",
    });
    expect(result.semantics.qualifyingPlaySpend).toBeNull();
    expect(result.semantics.monetaryBonusCap).toBeNull();
    expect(
      PublicationGateService.parseStructuredMonetaryCap(source),
    ).toMatchObject({ status: "MISSING_CAP" });
  });

  it("keeps per-spin value and free-spin-winnings wagering distinct", () => {
    const source = "50 free spins, £0.10 per spin, wager winnings 10x";
    const result = normalizeBonusExtraction(source, extracted());

    expect(result.bonus).toMatchObject({
      type: "FREE_SPINS",
      headline_value: "50 free spins, £0.10 per spin",
      wagering_requirement: 10,
      max_conversion: null,
    });
    expect(result.semantics.freeSpinCount).toBe(50);
    expect(result.semantics.freeSpinValue).toMatchObject({
      amount: 0.1,
      currency: "£",
      sourceText: "£0.10 per spin",
    });
    expect(result.semantics.wagering).toMatchObject({
      multiplier: 10,
      scope: "FREE_SPIN_WINNINGS",
    });
    expect(
      PublicationGateService.parseStructuredMonetaryCap(
        result.bonus.headline_value!,
      ),
    ).toMatchObject({ status: "MISSING_CAP" });
    expect(
      BonusService.calculateTrueValueScore(
        result.bonus.headline_value,
        result.bonus.wagering_requirement,
        result.bonus.max_conversion,
      ),
    ).toBe(0);
  });

  it("keeps a monetary cap distinct in a combined cash-and-spins offer", () => {
    const source = "100% up to £200 plus 50 free spins";
    const result = normalizeBonusExtraction(
      source,
      extracted({
        type: "FREE_SPINS",
        headline_value: "£200",
        wagering_requirement: null,
        max_conversion: 200,
      }),
    );

    expect(result.bonus).toMatchObject({
      type: "WELCOME_PACKAGE",
      headline_value: "100% up to £200 plus 50 free spins",
      wagering_requirement: null,
      max_conversion: null,
    });
    expect(result.semantics).toMatchObject({
      freeSpinCount: 50,
      freeSpinValue: null,
      depositRequirement: null,
      qualifyingPlaySpend: null,
      monetaryBonusCap: {
        amount: 200,
        currency: "£",
        sourceText: "up to £200",
      },
      isCombinedMonetaryAndFreeSpins: true,
    });
    expect(
      PublicationGateService.parseStructuredMonetaryCap(
        result.bonus.headline_value!,
      ),
    ).toMatchObject({ status: "VALID", value: 200 });
    expect(
      BonusService.calculateTrueValueScore(
        result.bonus.headline_value,
        result.bonus.wagering_requirement,
        result.bonus.max_conversion,
      ),
    ).toBe(0);
  });

  it("does not manufacture semantics absent from source text", () => {
    expect(analyzeBonusSourceSemantics("300 FREE SPINS")).toMatchObject({
      freeSpinCount: 300,
      qualifyingPlaySpend: null,
      depositRequirement: null,
      monetaryBonusCap: null,
      maxConversion: null,
      wagering: null,
    });
  });
});
