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

  describe("a wagering multiplier requires explicit multiplier syntax", () => {
    // Production incident: ScrapeJob afb542e0-56cc-44c3-bf20-27b2b251651d
    // persisted wagering_requirement = 20 from "wager £20 or more", a
    // qualifying spend. The authoritative snapshot contains no multiplier.
    const AUTHORITATIVE_PHRASE =
      "Opt in, wager £20+ on eligible games Mon 00:01 - Thurs 23:59 " +
      "for 10 Free Spins worth 10p each";

    it("reads the incident phrase as a qualifying spend, never a multiplier", () => {
      const semantics = analyzeBonusSourceSemantics(AUTHORITATIVE_PHRASE);

      // "£" is this parser's GBP token.
      expect(semantics.qualifyingPlaySpend).toMatchObject({
        amount: 20,
        currency: "£",
      });
      expect(semantics.wagering).toBeNull();
    });

    it.each([null, 5, 20])(
      "discards an unsupported model multiplier (%s) for the incident phrase",
      (modelValue) => {
        const result = normalizeBonusExtraction(
          AUTHORITATIVE_PHRASE,
          extracted({ wagering_requirement: modelValue }),
        );

        expect(result.bonus.wagering_requirement).toBeNull();
        // ingestion.service.ts guards claim creation with
        // `wagering_requirement !== null && !== undefined`, so a null value
        // creates no BonusEvidenceClaim(WAGERING_REQUIREMENT) at all.
        expect(result.bonus.wagering_requirement === null).toBe(true);
      },
    );

    it.each([
      ["10x", "wager winnings 10x"],
      ["10 x", "wager winnings 10 x"],
      ["10 times", "wager winnings 10 times"],
    ])("accepts explicit %s syntax", (_label, source) => {
      expect(analyzeBonusSourceSemantics(source).wagering).toMatchObject({
        multiplier: 10,
      });
    });

    it("keeps the supported free-spin-winnings scope intact", () => {
      expect(
        analyzeBonusSourceSemantics(
          "Wager winnings from Free Spins 10 times to receive Cash",
        ).wagering,
      ).toMatchObject({ multiplier: 10, scope: "FREE_SPIN_WINNINGS" });
    });

    it.each([
      "wager £20",
      "wager $20",
      "wager €20",
      "wager GBP 20",
      "wager 20 GBP",
      "wager 20",
      "play £20",
      "spend £20",
      "stake £20",
      "wagering requirement 35",
      "Wager £20 or more during the promotional period on eligible casino games",
    ])("rejects %s as a multiplier", (source) => {
      expect(analyzeBonusSourceSemantics(source).wagering).toBeNull();
    });

    it("discards an unsupported model multiplier outside free-spins offers", () => {
      const source = "Deposit £100 and get a 100% match up to £200";
      const result = normalizeBonusExtraction(
        source,
        extracted({
          type: "WELCOME",
          headline_value: "100% up to £200",
          wagering_requirement: 35,
        }),
      );

      expect(result.semantics.freeSpinCount).toBeNull();
      expect(result.semantics.wagering).toBeNull();
      expect(result.bonus.wagering_requirement).toBeNull();
    });
  });
});
