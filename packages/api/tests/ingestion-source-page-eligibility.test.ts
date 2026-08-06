import { describe, expect, it } from "vitest";
import {
  evaluateSourcePageEligibility,
  hostsAreRelated,
  SourcePageRejectedError,
} from "../src/services/source-page-eligibility";

describe("source-page eligibility policy (Boundary B1)", () => {
  describe("Accepted Cases", () => {
    it("1. accepts a valid BONUS page", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome-bonus/",
        finalUrl: "https://casino.example.com/promotions/welcome-bonus/",
        title: "Welcome Bonus - 100% Match",
        content: "Get up to $500 welcome deposit bonus with 30x wagering.",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("2. accepts a valid GAME_LIST page", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/casino/slots/",
        finalUrl: "https://casino.example.com/casino/slots/",
        title: "Online Slots & Casino Games",
        content: "Browse our lobby of popular slot games and live dealers.",
        taskContext: "GAME_LIST",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("3. recognizes www.example.com as related to example.com", () => {
      expect(hostsAreRelated("www.example.com", "example.com")).toBe(true);
    });

    it("4. recognizes m.example.com as related to example.com", () => {
      expect(hostsAreRelated("m.example.com", "example.com")).toBe(true);
    });

    it("5. recognizes locale subdomain such as en.example.com as related to example.com", () => {
      expect(hostsAreRelated("en.example.com", "example.com")).toBe(true);
    });

    it("6. recognizes promo.example.co.uk as related to example.co.uk", () => {
      expect(hostsAreRelated("promo.example.co.uk", "example.co.uk")).toBe(true);
    });

    it("7. accepts same-site HTTPS redirect", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "http://www.casino.example.com/promotions/welcome",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        title: "Welcome Offer",
        content: "Bonus offer terms",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("8. accepts trailing slash differences", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        title: "Welcome Offer",
        content: "Bonus offer terms",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("9. handles missing title safely", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        title: null,
        content: "Exclusive welcome bonus up to $200",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("10. handles missing canonical URL safely", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        canonicalUrl: undefined,
        title: "Welcome Offer",
        content: "Deposit bonus details",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("11. handles empty content without throwing", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        content: "",
        title: "Welcome Bonus",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("12. handles small valid content without throwing", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        content: "Short promo text",
        title: "Welcome Bonus",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });

    it("13. ignores malformed optional canonical URL and leaves valid final URL eligible", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        canonicalUrl: "ht://invalid-canonical-url",
        title: "Welcome Bonus",
        content: "Deposit bonus details",
        taskContext: "BONUS",
      });
      expect(result).toEqual({ eligible: true });
    });
  });

  describe("Conservative Host Relatedness", () => {
    it("14. example.gov.uk and other.gov.uk are unrelated", () => {
      expect(hostsAreRelated("example.gov.uk", "other.gov.uk")).toBe(false);
    });

    it("15. example.co.za and other.co.za are unrelated", () => {
      expect(hostsAreRelated("example.co.za", "other.co.za")).toBe(false);
    });

    it("16. identical IPv4 hosts are related", () => {
      expect(hostsAreRelated("192.168.1.1", "192.168.1.1")).toBe(true);
    });

    it("17. different IPv4 hosts sharing final octets are unrelated", () => {
      expect(hostsAreRelated("192.168.1.1", "10.0.1.1")).toBe(false);
    });

    it("18. IPv4 address and DNS hostname are unrelated", () => {
      expect(hostsAreRelated("127.0.0.1", "localhost")).toBe(false);
      expect(hostsAreRelated("192.168.1.1", "example.com")).toBe(false);
    });

    it("19. identical IPv6 hosts are related", () => {
      expect(hostsAreRelated("::1", "::1")).toBe(true);
      expect(hostsAreRelated("[2001:db8::1]", "[2001:db8::1]")).toBe(true);
    });

    it("20. different IPv6 hosts are unrelated", () => {
      expect(hostsAreRelated("2001:db8::1", "2001:db8::2")).toBe(false);
    });

    it("21. identical localhost hosts are related", () => {
      expect(hostsAreRelated("localhost", "localhost")).toBe(true);
    });

    it("22. localhost and external hostname are unrelated", () => {
      expect(hostsAreRelated("localhost", "example.com")).toBe(false);
    });

    it("23. en.example.com remains related to example.com", () => {
      expect(hostsAreRelated("en.example.com", "example.com")).toBe(true);
    });

    it("24. promo.example.co.uk remains related to example.co.uk", () => {
      expect(hostsAreRelated("promo.example.co.uk", "example.co.uk")).toBe(true);
    });

    it("25. evil-example.co.uk remains unrelated to example.co.uk", () => {
      expect(hostsAreRelated("evil-example.co.uk", "example.co.uk")).toBe(false);
    });

    it("26. example.com.evil.tld remains unrelated to example.com", () => {
      expect(hostsAreRelated("example.com.evil.tld", "example.com")).toBe(false);
    });

    it("27. unsupported suffixes cannot create sibling-domain relationships", () => {
      expect(hostsAreRelated("sub1.example.co.za", "sub2.example.co.za")).toBe(false);
    });

    it("28. sibling subdomains without parent relationship are fail-closed rejected", () => {
      expect(hostsAreRelated("promo.example.com", "casino.example.com")).toBe(false);
    });
  });

  describe("Rejected Cases", () => {
    it("29. rejects anti-bot challenge as ANTI_BOT", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        title: "Just a moment...",
        content: "Checking your browser before accessing the site. Cloudflare Ray ID: 87123",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "ANTI_BOT",
        reason: "The rendered page is an anti-bot or browser challenge page.",
      });
    });

    it("30. rejects geo-restricted page as GEO_RESTRICTED", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        title: "Services Unavailable in Your Location",
        content: "Not available in your country or region.",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "GEO_RESTRICTED",
        reason: "The rendered page reports location-based unavailability.",
      });
    });

    it("31. rejects support/help path as UNRELATED_PATH", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/help/support-faq/",
        title: "Customer Support & Help Center",
        content: "Frequently asked questions",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "UNRELATED_PATH",
        reason: "The page destination path is a help or support path.",
      });
    });

    it("32. rejects login/restricted path as RESTRICTED_ACCESS", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/login/",
        title: "Sign In Required",
        content: "Please log in to your account.",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "RESTRICTED_ACCESS",
        reason: "The page destination path or title identifies a login or restricted-access page.",
      });
    });

    it("33. rejects same-site homepage redirect losing BONUS context as CONTEXT_MISMATCH", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome-offer/",
        finalUrl: "https://casino.example.com/en/",
        title: "Casino Home",
        content: "Play online games",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "CONTEXT_MISMATCH",
        reason: "The final page has no matching ingestion context for the requested URL.",
      });
    });

    it("34. rejects GAME_LIST request losing game-list context as CONTEXT_MISMATCH", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/slots/all-games/",
        finalUrl: "https://casino.example.com/about-us/",
        title: "About Our Casino Company",
        content: "Our corporate history",
        taskContext: "GAME_LIST",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "CONTEXT_MISMATCH",
      });
    });

    it("35. rejects invalid requested URL as INVALID_DESTINATION", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "ht://invalid-url-format",
        finalUrl: "https://casino.example.com/promotions/",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "INVALID_DESTINATION",
        reason: "The requested or final browser URL could not be parsed.",
      });
    });

    it("36. rejects invalid final URL as INVALID_DESTINATION", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/",
        finalUrl: "not-a-valid-url",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "INVALID_DESTINATION",
      });
    });

    it("37. rejects cross-domain canonical as UNRELATED_HOST", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://casino.example.com/promotions/welcome/",
        canonicalUrl: "https://attacker.com/fake-canonical",
        title: "Welcome Bonus",
        content: "100% deposit match",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "UNRELATED_HOST",
        reason: "The page destination host is unrelated to the requested domain.",
      });
    });

    it("38. rejects cross-domain final URL as UNRELATED_HOST", () => {
      const result = evaluateSourcePageEligibility({
        requestedUrl: "https://casino.example.com/promotions/welcome/",
        finalUrl: "https://othercasino.com/promotions/welcome/",
        title: "Welcome Bonus",
        content: "100% deposit match",
        taskContext: "BONUS",
      });
      expect(result).toMatchObject({
        eligible: false,
        category: "UNRELATED_HOST",
      });
    });
  });

  describe("Sensitive-Data Safety", () => {
    const sensitiveInput = {
      requestedUrl: "https://admin:super-secret@example.com/bonus?token=abc123&email=user@example.com#private",
      finalUrl: "https://admin:super-secret@example.com/login?session=9999#token",
      canonicalUrl: "https://admin:super-secret@example.com/help?auth=secret#fragment",
      title: "Secret Admin Login Page",
      content: "Sensitive inner body text containing secret API keys",
      taskContext: "BONUS" as const,
    };

    it("39. rejection error message does not contain username, password, query params, fragments, titles, or raw body text", () => {
      const eligibility = evaluateSourcePageEligibility(sensitiveInput);
      expect(eligibility.eligible).toBe(false);

      if (!eligibility.eligible) {
        const error = new SourcePageRejectedError(sensitiveInput, eligibility);
        const serialized = error.message;

        expect(serialized).not.toContain("admin");
        expect(serialized).not.toContain("super-secret");
        expect(serialized).not.toContain("abc123");
        expect(serialized).not.toContain("token");
        expect(serialized).not.toContain("email");
        expect(serialized).not.toContain("user@example.com");
        expect(serialized).not.toContain("private");
        expect(serialized).not.toContain("session");
        expect(serialized).not.toContain("fragment");
        expect(serialized).not.toContain("Secret Admin Login Page");
        expect(serialized).not.toContain("Sensitive inner body text");
      }
    });

    it("40. rejection reason is bounded and stable", () => {
      const eligibility = evaluateSourcePageEligibility(sensitiveInput);
      expect(eligibility.eligible).toBe(false);
      if (!eligibility.eligible) {
        expect(eligibility.reason).toBe(
          "The page destination path or title identifies a login or restricted-access page.",
        );
      }
    });

    it("41. error serialization exposes only stable error code, category, and bounded reason", () => {
      const rejection = {
        eligible: false as const,
        category: "RESTRICTED_ACCESS" as const,
        reason: "The page destination path or title identifies a login or restricted-access page.",
      };
      const error = new SourcePageRejectedError(sensitiveInput, rejection);
      expect(error.message).toBe(
        `SOURCE_PAGE_REJECTED ${JSON.stringify({
          category: "RESTRICTED_ACCESS",
          reason: "The page destination path or title identifies a login or restricted-access page.",
        })}`,
      );
    });
  });
});
