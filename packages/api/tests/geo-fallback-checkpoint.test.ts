import { describe, expect, it } from "vitest";
import {
  GeoFallbackCheckpointError,
  MAX_GEO_FALLBACK_CHECKPOINT_BYTES,
  createGeoFallbackCheckpoint,
  parseGeoFallbackCheckpoint,
} from "@savvyedge/types";

const HASH = "a".repeat(64);

describe("geo fallback checkpoint contract", () => {
  it("round-trips a strict versioned AVAILABLE checkpoint", () => {
    const checkpoint = createGeoFallbackCheckpoint({
      version: 1,
      state: "AVAILABLE",
      locator: `supabase://evidence/v1/observations/2026/08/19/example.com/20260819T102030456Z_job_geo_fallback_${HASH}.html`,
      htmlHash: HASH,
      contentHash: "b".repeat(64),
      observedAt: "2026-08-19T10:20:30.456Z",
    });
    expect(parseGeoFallbackCheckpoint(checkpoint)).toEqual(checkpoint);
  });

  it("round-trips strict artifact-bearing recovery and rejection checkpoints", () => {
    const artifact = {
      locator: `supabase://evidence/v1/observations/2026/08/19/example.com/20260819T102030456Z_job_geo_fallback_${HASH}.html`,
      htmlHash: HASH,
      contentHash: "b".repeat(64),
      observedAt: "2026-08-19T10:20:30.456Z",
    };
    const recovered = createGeoFallbackCheckpoint({
      version: 1,
      state: "LOCAL_RECOVERED",
      ...artifact,
    });
    const rejected = createGeoFallbackCheckpoint({
      version: 1,
      state: "EXTRACTION_REJECTED",
      ...artifact,
      reason: "EXTRACTION_INPUT_INSUFFICIENT",
    });

    expect(parseGeoFallbackCheckpoint(recovered)).toEqual(recovered);
    expect(parseGeoFallbackCheckpoint(rejected)).toEqual(rejected);
  });

  it.each([
    { version: 2, state: "REQUEST_CLAIMED" },
    { version: 1, state: "UNKNOWN" },
    { version: 1, state: "REQUEST_CLAIMED", rawHtml: "forbidden" },
    { version: 1, state: "REQUEST_CLAIMED", apiKey: "forbidden" },
    { version: 1, state: "REQUEST_CLAIMED", cookies: ["forbidden"] },
    {
      version: 1,
      state: "AVAILABLE",
      locator: "https://api.scrapingant.com/v2/general?x-api-key=secret",
      htmlHash: HASH,
      contentHash: HASH,
      observedAt: "2026-08-19T10:20:30.456Z",
    },
    {
      version: 1,
      state: "EXTRACTION_REJECTED",
      locator: `supabase://evidence/v1/observations/2026/08/19/example.com/20260819T102030456Z_job_geo_fallback_${HASH}.html`,
      htmlHash: HASH,
      contentHash: HASH,
      observedAt: "2026-08-19T10:20:30.456Z",
      reason: "SOURCE_PAGE_REJECTED",
    },
  ])("fails closed on malformed checkpoint %#", (checkpoint) => {
    expect(() => parseGeoFallbackCheckpoint(checkpoint)).toThrow(
      GeoFallbackCheckpointError,
    );
  });

  it("fails closed before parsing an oversized checkpoint", () => {
    const oversized = {
      version: 1,
      state: "REQUEST_CLAIMED",
      padding: "x".repeat(MAX_GEO_FALLBACK_CHECKPOINT_BYTES),
    };
    expect(() => parseGeoFallbackCheckpoint(oversized)).toThrow(
      GeoFallbackCheckpointError,
    );
  });
});
