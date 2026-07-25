import { describe, it, expect } from "vitest";
import { ReviewStatus, PublicationStatus } from "@savvyedge/database";
import { PublicationGateService } from "../src/services/publication-gate.service";
import { BonusService } from "../src/services/bonus.service";

describe("Ingestion Governance Contract Tests", () => {
  it("verifies ambiguous monetary caps are identified as AMBIGUOUS_CAPS so false SUPPORTS claims are excluded", () => {
    const ambiguousHeadline = "100% up to $500 + 50 free spins up to $100";
    const parseResult = PublicationGateService.parseStructuredMonetaryCap(ambiguousHeadline);
    expect(parseResult.status).not.toBe("VALID");
  });

  it("verifies valid unambiguous monetary caps parse cleanly", () => {
    const validHeadline = "100% up to $500";
    const parseResult = PublicationGateService.parseStructuredMonetaryCap(validHeadline);
    expect(parseResult.status).toBe("VALID");
    if (parseResult.status === "VALID") {
      expect(parseResult.value).toBe(500);
    }
  });

  it("verifies TrueValueScore calculation does not invent values for uncalculable headlines", () => {
    const invalidHeadline = "Free bonus package for new players!";
    const score = BonusService.calculateTrueValueScore(invalidHeadline, 35, null);
    expect(score).toBe(0);
  });
});
