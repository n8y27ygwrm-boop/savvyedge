import { describe, expect, it } from "vitest";
import {
  GEO_BLOCK_SPARSE_CONTENT_THRESHOLD,
  classifyGeoBlock,
} from "../src/services/geo-block-classifier";

describe("credit-protective geo-block classifier", () => {
  it("recognizes the real sparse BetMGM production message", () => {
    expect(
      classifyGeoBlock({
        title: "Unavailable",
        content: "BetMGM.uk is not available at your location",
      }),
    ).toEqual({ blocked: true, code: "LOCATION_UNAVAILABLE_SPARSE" });
  });

  it.each([
    "This service is unavailable in your country",
    "Casino is not available for your region",
    "Sportsbook is not available at this location",
    "Services are unavailable in this country",
  ])("recognizes conservative location variant: %s", (content) => {
    expect(classifyGeoBlock({ content }).blocked).toBe(true);
  });

  it("accepts HTTP 451 only when location unavailability is also present", () => {
    expect(
      classifyGeoBlock({
        content: "BetMGM.uk is not available at your location",
        httpStatus: 451,
      }),
    ).toEqual({ blocked: true, code: "LOCATION_UNAVAILABLE_HTTP_451" });
    expect(
      classifyGeoBlock({
        content: "Unavailable for legal reasons",
        httpStatus: 451,
      }),
    ).toEqual({
      blocked: false,
      code: "NO_LOCATION_UNAVAILABILITY_SIGNAL",
    });
  });

  it.each([
    { content: "Access denied", httpStatus: 403 },
    { content: "Just a moment. Checking your browser", httpStatus: 403 },
    { content: "", httpStatus: undefined },
    { content: "short ordinary offer", httpStatus: undefined },
  ])("does not trigger on status, anti-bot or sparse text alone", (input) => {
    expect(classifyGeoBlock(input).blocked).toBe(false);
  });

  it("does not trigger on a rich legitimate page with incidental wording", () => {
    const content =
      "Welcome bonus 100% deposit match up to £500. " +
      "Our help article explains why a historical product was not available in your country. " +
      "Full promotion terms and wagering requirements apply. ".repeat(
        Math.ceil(GEO_BLOCK_SPARSE_CONTENT_THRESHOLD / 40),
      );
    expect(content.length).toBeGreaterThan(GEO_BLOCK_SPARSE_CONTENT_THRESHOLD);
    expect(classifyGeoBlock({ content })).toEqual({
      blocked: false,
      code: "LOCATION_SIGNAL_NOT_CORROBORATED",
    });
  });
});
