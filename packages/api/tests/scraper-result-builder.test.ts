import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ScraperOutputSchema,
  buildScrapeResultFromHtml,
} from "@savvyedge/ai-agents";

describe("shared HTML scrape-result builder", () => {
  it("derives deterministic content, metadata, canonical URL and hashes", () => {
    const rawHtml = `
      <html><head>
        <title>Welcome Offer</title>
        <link rel="canonical" href="/promotions/canonical">
        <meta property="og:title" content="300 Free Spins">
        <meta name="description" content="Offer description">
      </head><body><main>Get 300 FREE SPINS when you play £30</main></body></html>
    `;
    const timestamp = new Date("2026-08-19T10:20:30.456Z");
    const first = buildScrapeResultFromHtml({
      url: "https://casino.example.com/promotions/welcome",
      finalUrl: "https://casino.example.com/en/promotions/welcome",
      rawHtml,
      timestamp,
      httpStatus: 451,
    });
    const second = buildScrapeResultFromHtml({
      url: first.url,
      finalUrl: first.finalUrl,
      rawHtml,
      timestamp,
      httpStatus: 451,
    });

    expect(second).toEqual(first);
    expect(first.httpStatus).toBe(451);
    expect(first.title).toBe("Welcome Offer");
    expect(first.metadata.title).toBe("300 Free Spins");
    expect(first.canonicalUrl).toBe(
      "https://casino.example.com/promotions/canonical",
    );
    expect(first.content).toBe("Get 300 FREE SPINS when you play £30");
    expect(first.htmlHash).toBe(
      createHash("sha256").update(rawHtml).digest("hex"),
    );
  });

  it("preserves optional httpStatus through ScraperOutputSchema", () => {
    const result = buildScrapeResultFromHtml({
      url: "https://casino.example.com/offer",
      finalUrl: "https://casino.example.com/offer",
      rawHtml: "<html><body>100% deposit match up to £500</body></html>",
      timestamp: new Date("2026-08-19T10:20:30.456Z"),
      httpStatus: 200,
    });
    expect(ScraperOutputSchema.parse(result).httpStatus).toBe(200);
  });

  it("keeps primary-agent metadata identical to the shared HTML builder", () => {
    const rawHtml = `<html><head>
      <title>Welcome Offer</title>
      <meta name="description" content="Description">
      <meta property="og:title" content="Primary title">
      <meta property="og:description" content="Primary description">
      <meta property="og:image" content="https://cdn.example.com/offer.png">
      <meta property="og:site_name" content="Example Casino">
      <meta property="og:type" content="website">
      <meta property="og:url" content="https://casino.example.com/promotions/welcome">
    </head><body>Get a 100% deposit match up to £500.</body></html>`;
    const built = buildScrapeResultFromHtml({
      url: "https://casino.example.com/promotions/welcome",
      finalUrl: "https://casino.example.com/promotions/welcome",
      rawHtml,
      timestamp: new Date("2026-08-19T10:20:30.456Z"),
      httpStatus: 200,
    });

    const primaryAgentOutput = ScraperOutputSchema.parse(built);

    expect(primaryAgentOutput.metadata).toEqual(built.metadata);
    expect(primaryAgentOutput.metadata).toMatchObject({
      ogSiteName: "Example Casino",
      ogType: "website",
      ogUrl: "https://casino.example.com/promotions/welcome",
    });
  });
});
