import { describe, expect, it } from "vitest";
import {
  NON_CONTENT_SELECTOR,
  extractReadableText,
} from "@savvyedge/ai-agents";

/**
 * Cleanup contract for the rendered-HTML -> readable-text step.
 *
 * Exercised through the exported pure helper so no browser is launched. The
 * governing rule: never delete semantic containers that legitimately carry
 * offer copy (`header`, `nav`, `button`), always delete non-content elements.
 */
describe("PlaywrightScraper readable-text cleanup", () => {
  describe("Content-bearing semantic containers survive", () => {
    it("keeps a promotion headline rendered inside a semantic <header>", () => {
      const text = extractReadableText(`
        <html><body>
          <header><h1>Get 300 FREE SPINS when you play £30 on slots</h1></header>
          <div>Terms apply.</div>
        </body></html>
      `);

      expect(text).toContain("Get 300 FREE SPINS when you play £30 on slots");
      expect(text).toContain("Terms apply.");
    });

    it("keeps offer copy inside <nav> and <button>", () => {
      const text = extractReadableText(`
        <html><body>
          <nav><a href="/promo">100% deposit match up to $500</a></nav>
          <button>Claim your welcome bonus</button>
        </body></html>
      `);

      expect(text).toContain("100% deposit match up to $500");
      expect(text).toContain("Claim your welcome bonus");
    });

    it("preserves the real h1 > span offer structure seen on operator pages", () => {
      const text = extractReadableText(`
        <html><body><div id="root"><div><div>
          <h1 class="css-53x59r"><span>Get 300 FREE SPINS when you play £30 on slots</span></h1>
        </div></div></div></body></html>
      `);

      expect(text).toBe("Get 300 FREE SPINS when you play £30 on slots");
    });

    it("tolerates navigation noise alongside legitimate offer content", () => {
      const text = extractReadableText(`
        <html><body>
          <nav>Sports Casino Live Casino Bingo Poker Help About Us</nav>
          <main><h1>Welcome offer: 100% deposit match up to $500</h1></main>
        </body></html>
      `);

      expect(text).toContain("Welcome offer: 100% deposit match up to $500");
      expect(text).toContain("Sports Casino Live Casino Bingo Poker Help About Us");
    });
  });

  describe("Non-content elements are excluded", () => {
    it("excludes script, style, svg, iframe, noscript and footer text", () => {
      const text = extractReadableText(`
        <html><body>
          <script>var offer = "SCRIPT_LEAK";</script>
          <style>.css-x { content: "STYLE_LEAK"; }</style>
          <svg><title>SVG_LEAK</title></svg>
          <iframe>IFRAME_LEAK</iframe>
          <noscript>NOSCRIPT_LEAK</noscript>
          <footer>FOOTER_LEAK © Copyright 2026</footer>
          <main>Welcome bonus details</main>
        </body></html>
      `);

      for (const leak of [
        "SCRIPT_LEAK",
        "STYLE_LEAK",
        "SVG_LEAK",
        "IFRAME_LEAK",
        "NOSCRIPT_LEAK",
        "FOOTER_LEAK",
      ]) {
        expect(text).not.toContain(leak);
      }
      expect(text).toBe("Welcome bonus details");
    });

    it("does not let CSS-in-JS style bodies inflate readable-text length", () => {
      const cssNoise = ".css-a{color:red;}".repeat(2000);
      const text = extractReadableText(
        `<html><head><style>${cssNoise}</style></head>` +
          `<body><style>${cssNoise}</style><main>Welcome bonus</main></body></html>`,
      );

      expect(cssNoise.length).toBeGreaterThan(30_000);
      expect(text).toBe("Welcome bonus");
      expect(text.length).toBeLessThan(50);
    });

    it("declares the exact non-content selector without duplicates", () => {
      const parts = NON_CONTENT_SELECTOR.split(",").map((s) => s.trim());
      expect(parts).toEqual([
        "script",
        "style",
        "iframe",
        "svg",
        "noscript",
        "footer",
      ]);
      expect(new Set(parts).size).toBe(parts.length);
      for (const kept of ["header", "nav", "button"]) {
        expect(parts).not.toContain(kept);
      }
    });
  });

  describe("Whitespace normalization", () => {
    it("collapses tabs and repeated spaces while separating text blocks", () => {
      const text = extractReadableText(
        "<html><body><div>\t\tWelcome    offer\t</div>\n\n<div>  100%   match  </div></body></html>",
      );

      expect(text).toBe("Welcome offer\n100% match");
      expect(text).not.toMatch(/\t/);
      expect(text).not.toMatch(/ {2}/);
      expect(text).not.toMatch(/^\s|\s$/);
    });

    it("drops empty lines produced by markup indentation", () => {
      const text = extractReadableText(`
        <html><body>

          <p>Welcome bonus</p>

          <p>Terms apply</p>

        </body></html>
      `);

      expect(text.split("\n").filter((l) => l.trim() === "")).toEqual([]);
      expect(text).toContain("Welcome bonus");
      expect(text).toContain("Terms apply");
    });
  });
});
