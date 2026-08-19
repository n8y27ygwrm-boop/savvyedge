import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GEO_BLOCK_SPARSE_CONTENT_THRESHOLD,
  classifyGeoBlock,
} from "../src/services/geo-block-classifier";

/**
 * Byte-exact readable text of production ScrapeJob
 * 2c5e2c59-3f50-4711-9593-5dc87389f2a7. Adjacent rendered block elements were
 * concatenated without whitespace, producing `locationIt`, which the classifier
 * scored NO_LOCATION_UNAVAILABILITY_SIGNAL.
 */
const PRODUCTION_CONCATENATED_CONTENT =
  "BetMGM.uk is not available at your locationIt seems that we cannot load " +
  "BetMGM.uk or there's something wrong with your internet proxy.";

const PRODUCTION_CONTENT_HASH =
  "b6adb60145a5c95156327eee3fc9af230a29de2289d07797637a62f688c771c6";

function richPageContaining(phrase: string): string {
  const filler =
    "Full promotion terms, wagering requirements and payment methods apply. ";
  return `${phrase} ${filler.repeat(
    Math.ceil(GEO_BLOCK_SPARSE_CONTENT_THRESHOLD / filler.length) + 1,
  )}`;
}

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

  it("classifies the exact production block-concatenated BetMGM snapshot", () => {
    expect(PRODUCTION_CONCATENATED_CONTENT).toHaveLength(134);
    expect(
      createHash("sha256").update(PRODUCTION_CONCATENATED_CONTENT).digest("hex"),
    ).toBe(PRODUCTION_CONTENT_HASH);

    expect(classifyGeoBlock({ content: PRODUCTION_CONCATENATED_CONTENT })).toEqual(
      { blocked: true, code: "LOCATION_UNAVAILABLE_SPARSE" },
    );
  });

  it.each([
    "This feature is not available at your locationized endpoint",
    "This feature is not available at your regional endpoint",
    "This feature is not available at your locationized endpointIt seems that we cannot load it",
  ])(
    "does not accept a lowercase continuation as a terminal boundary: %s",
    (content) => {
      expect(classifyGeoBlock({ content })).toEqual({
        blocked: false,
        code: "NO_LOCATION_UNAVAILABILITY_SIGNAL",
      });
    },
  );

  it("does not invent a location signal from unrelated concatenated blocks", () => {
    expect(
      classifyGeoBlock({
        content:
          "Welcome BonusIt seems that we cannot load the page or there's " +
          "something wrong with your internet proxy.",
      }),
    ).toEqual({ blocked: false, code: "NO_LOCATION_UNAVAILABILITY_SIGNAL" });
  });

  it("still requires corroboration when a rich page needed boundary repair", () => {
    const content = richPageContaining(PRODUCTION_CONCATENATED_CONTENT);
    expect(content.length).toBeGreaterThan(GEO_BLOCK_SPARSE_CONTENT_THRESHOLD);

    expect(classifyGeoBlock({ content })).toEqual({
      blocked: false,
      code: "LOCATION_SIGNAL_NOT_CORROBORATED",
    });
    expect(classifyGeoBlock({ content, httpStatus: 451 })).toEqual({
      blocked: true,
      code: "LOCATION_UNAVAILABLE_HTTP_451",
    });
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
