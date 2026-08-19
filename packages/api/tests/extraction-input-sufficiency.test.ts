import { describe, expect, it } from "vitest";
import {
  BONUS_EXTRACTION_SIGNALS,
  ExtractionInputRejectedError,
  MIN_EXTRACTION_INPUT_LENGTH,
  SIGNAL_PROXIMITY_WINDOW,
  evaluateExtractionInputSufficiency,
  hasBonusExtractionSignal,
  normalizeExtractionInput,
} from "../src/services/extraction-input-sufficiency";
import { CONTEXT_TERMS } from "../src/constants/ingestion-task-context";

/**
 * Global site chrome with no offer content — the shape of rendered text that
 * reached Gemini in the production incident. Reproduced from the readable text
 * of a stored sparse snapshot; it is representative, not a capture of the
 * exact production payload.
 */
const chromeOnlyContent =
  "SportsCasinoLive CasinoBingoPokerHelp|About Us|Safer Gambling|Apps|Blog| " +
  "Fair Gaming Policy|Unibet CommunityHomeSportsRacingCasinoLive " +
  "CasinoBingoPokerPromotionsHelpAbout UsSafer GamblingAppsBlog Fair Gaming " +
  "PolicyUnibet CommunitySportsSports lobbyVirtual SportsSponsorsBetting " +
  "GuideRacingRacing rulesRacing guidesCasinoCasino lobbyTournamentsCasino " +
  "guidesLive CasinoLive Casino GuidesBingoBingo LobbyBingo " +
  "TournamentsBingoWheelJackpotsPokerPoker LobbyLive eventsUnibet Poker " +
  "LoyaltyTournamentsLog inCreate account";

describe("extraction-input sufficiency policy", () => {
  describe("Insufficient input", () => {
    it("rejects empty text", () => {
      expect(
        evaluateExtractionInputSufficiency({ content: "", taskContext: "BONUS" }),
      ).toEqual({
        sufficient: false,
        category: "INSUFFICIENT_CONTENT",
        reason: expect.any(String),
      });
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["whitespace only", "   \t\n\n \t "],
    ])("rejects %s content", (_label, content) => {
      const result = evaluateExtractionInputSufficiency({
        content,
        taskContext: "BONUS",
      });
      expect(result.sufficient).toBe(false);
    });

    it("rejects generic chrome-only navigation text", () => {
      expect(chromeOnlyContent.length).toBeGreaterThan(
        MIN_EXTRACTION_INPUT_LENGTH,
      );

      const result = evaluateExtractionInputSufficiency({
        content: chromeOnlyContent,
        taskContext: "BONUS",
      });

      expect(result).toEqual({
        sufficient: false,
        category: "INSUFFICIENT_CONTENT",
        reason: expect.any(String),
      });
    });

    it("rejects long text that carries no requested task-context terms", () => {
      const longUnrelatedText =
        "About our company. Careers. Press enquiries. Investor relations. " +
        "Cookie preferences. Accessibility statement. Modern slavery act. ".repeat(
          10,
        );

      expect(longUnrelatedText.length).toBeGreaterThan(500);
      expect(
        evaluateExtractionInputSufficiency({
          content: longUnrelatedText,
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);
    });

    it("rejects text whose only task-context term is too short to extract from", () => {
      expect(
        evaluateExtractionInputSufficiency({
          content: "Bonus",
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);
    });
  });

  describe("Generic navigation vocabulary is not extraction evidence", () => {
    const bonus = (content: string) =>
      evaluateExtractionInputSufficiency({ content, taskContext: "BONUS" });

    it("rejects space-separated casino navigation containing \"Promotions\"", () => {
      const nav =
        "Home Sports Casino Live Casino Bingo Poker Promotions Help " +
        "About Us Apps Blog Log in Create account";

      // The eligibility vocabulary matches this text; extraction evidence must not.
      expect(CONTEXT_TERMS.BONUS.test(nav)).toBe(true);
      expect(bonus(nav).sufficient).toBe(false);
    });

    it("rejects navigation containing only \"Bonuses\"", () => {
      const nav =
        "Home Sports Casino Bonuses Help About Us Apps Blog Log in Create account";

      expect(CONTEXT_TERMS.BONUS.test(nav)).toBe(true);
      expect(bonus(nav).sufficient).toBe(false);
    });

    it("rejects generic chrome containing both \"Promotions\" and \"Bonuses\"", () => {
      const nav =
        "Home Sports Casino Live Casino Promotions Bonuses Help About Us " +
        "Apps Blog Log in Create account";

      expect(CONTEXT_TERMS.BONUS.test(nav)).toBe(true);
      expect(bonus(nav).sufficient).toBe(false);
    });

    it("rejects footer legal boilerplate", () => {
      expect(
        bonus(
          "Gambling can be addictive. Play responsibly. Safer Gambling " +
            "Terms and Conditions Privacy Notice Cookies Help Our Partners",
        ).sufficient,
      ).toBe(false);
    });
  });

  describe("Bare numeric values are not extraction evidence", () => {
    const bonus = (content: string) =>
      evaluateExtractionInputSufficiency({ content, taskContext: "BONUS" });

    // Padding keeps every fixture above the length floor, so each case fails on
    // the signal rule rather than trivially on length.
    const pad = " New customers only. Terms and conditions apply to this page.";

    it.each([
      ["monetary amount beside a nav label", "Balance £0.00 Promotions"],
      ["percentage beside a nav label", "Slots RTP 96% Bonuses"],
      ["multiplier beside a nav label", "2x Jackpots Promotions"],
      ["large jackpot figure beside a nav label", "£1,000,000 Jackpot Bonuses"],
    ])("rejects %s", (_label, fragment) => {
      const content = fragment + pad;
      expect(content.length).toBeGreaterThan(MIN_EXTRACTION_INPUT_LENGTH);
      expect(bonus(content).sufficient).toBe(false);
    });

    it("rejects a long casino navigation containing all of those fragments", () => {
      const nav =
        "Home Sports Casino Live Casino Bingo Poker Promotions Bonuses Help " +
        "About Us Apps Blog Balance £0.00 Slots RTP 96% 2x Jackpots " +
        "£1,000,000 Jackpot Log in Create account";

      expect(bonus(nav).sufficient).toBe(false);
    });

    it("rejects an RTP percentage, which is never offer semantics", () => {
      expect(
        bonus("Slots RTP is 96% across the lobby this month for all players")
          .sufficient,
      ).toBe(false);
    });

    it("rejects a bare multiplier with no wagering semantics nearby", () => {
      expect(
        bonus("2x Jackpots and 5x Multipliers on the reels every day").sufficient,
      ).toBe(false);
    });

    it("pairs a value with bonus vocabulary only inside the proximity window", () => {
      // "bonus funds" is proximity-only vocabulary: it is not an independently
      // strong phrase, so this isolates the window itself.
      const near = "Balance £0.00 credited as bonus funds on this account";
      const far =
        "Balance £0.00" + " filler".repeat(20) + " credited as bonus funds";

      expect(near.indexOf("bonus funds") - near.indexOf("£0.00")).toBeLessThan(
        SIGNAL_PROXIMITY_WINDOW,
      );
      expect(far.indexOf("bonus funds") - far.indexOf("£0.00")).toBeGreaterThan(
        SIGNAL_PROXIMITY_WINDOW,
      );

      expect(bonus(near).sufficient).toBe(true);
      expect(bonus(far).sufficient).toBe(false);
    });
  });

  describe("Offer-detail evidence is sufficient", () => {
    const bonus = (content: string) =>
      evaluateExtractionInputSufficiency({ content, taskContext: "BONUS" });

    it.each([
      ["rich free-spins offer", "Get 300 FREE SPINS when you play £30 on slots"],
      ["deposit-match offer", "100% deposit match up to $500"],
      [
        "no-deposit offer",
        "Claim your no deposit bonus today, new players only",
      ],
      [
        "wagering multiplier",
        "Winnings from free spins carry a 35x wagering multiplier",
      ],
      [
        "wagering-requirement phrase",
        "Bonus funds are subject to wagering requirements before withdrawal",
      ],
      ["cashback offer", "Get 10 percent cashback on losses every Monday"],
      ["percentage next to deposit match", "100% deposit match up to £500"],
      [
        "monetary value next to a free-spins award",
        "Deposit £10 and get 100 free spins",
      ],
      [
        "multiplier before wagering semantics",
        "35x wagering requirement applies to this offer",
      ],
      [
        "multiplier after wagering semantics",
        "Wagering requirement of 35x applies to this offer",
      ],
      ["maximum cashout terms", "Maximum cashout is £100 for this promotion"],
      ["no-deposit availability", "No deposit bonus available to new players"],
      ["percentage qualified by \"up to\"", "Welcome bonus 100% up to £200"],
      [
        "percentage beside a qualified welcome bonus",
        "Exclusive 100% Welcome Bonus up to $500",
      ],
      [
        "match bonus with a wagering multiplier",
        "100% Match Bonus up to $1000 with 30x Wagering",
      ],
      [
        "minimum-deposit terms",
        "New customers only. Minimum deposit required to claim this reward.",
      ],
      [
        "max-conversion terms",
        "Free spin winnings are credited with a maximum conversion applied",
      ],
    ])("accepts %s", (_label, content) => {
      expect(bonus(content)).toEqual({ sufficient: true });
    });

    it("declares operator-neutral signals with unique names and stateless patterns", () => {
      const names = BONUS_EXTRACTION_SIGNALS.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);

      for (const { pattern } of BONUS_EXTRACTION_SIGNALS) {
        // A `g` flag would make `.test()` stateful and order-dependent.
        expect(pattern.flags).not.toContain("g");
      }

      // No signal encodes a brand or operator name.
      const source = BONUS_EXTRACTION_SIGNALS.map((s) => s.pattern.source).join(" ");
      for (const brand of ["betmgm", "unibet", "askgamblers", "gambling.com"]) {
        expect(source.toLowerCase()).not.toContain(brand);
      }
    });

    it("exposes the signal check independently of the length floor", () => {
      // A multiplier only counts once wagering semantics are nearby.
      expect(hasBonusExtractionSignal("35x")).toBe(false);
      expect(hasBonusExtractionSignal("35x wagering")).toBe(true);
      expect(hasBonusExtractionSignal("Promotions Bonuses Offers")).toBe(false);
      // ...and text carrying a signal still fails the evaluator on length.
      expect(
        evaluateExtractionInputSufficiency({
          content: "35x wager",
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);
    });
  });

  describe("Sufficient input", () => {
    it("accepts a real free-spins promotion headline for BONUS", () => {
      expect(
        evaluateExtractionInputSufficiency({
          content: "Get 300 FREE SPINS when you play £30 on slots",
          taskContext: "BONUS",
        }),
      ).toEqual({ sufficient: true });
    });

    it("accepts a terse but real deposit offer for BONUS", () => {
      const terseOffer = "100% deposit match up to $500";
      expect(terseOffer.length).toBeGreaterThanOrEqual(
        MIN_EXTRACTION_INPUT_LENGTH,
      );

      expect(
        evaluateExtractionInputSufficiency({
          content: terseOffer,
          taskContext: "BONUS",
        }),
      ).toEqual({ sufficient: true });
    });
  });

  describe("Task-context vocabulary", () => {
    it("evaluates GAME_LIST against its own vocabulary, not the BONUS one", () => {
      const gameLobbyText =
        "Browse the full casino lobby with slots and live casino tables";

      expect(
        evaluateExtractionInputSufficiency({
          content: gameLobbyText,
          taskContext: "GAME_LIST",
        }),
      ).toEqual({ sufficient: true });

      // Purely bonus vocabulary is not game-list evidence.
      const bonusOnlyText = "100% deposit match up to $500 welcome bonus offer";
      expect(
        evaluateExtractionInputSufficiency({
          content: bonusOnlyText,
          taskContext: "GAME_LIST",
        }).sufficient,
      ).toBe(false);
      expect(
        evaluateExtractionInputSufficiency({
          content: bonusOnlyText,
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(true); // carries "100% ... deposit match" offer detail

      // ...and the reverse: a lobby listing is not BONUS evidence.
      const lobbyOnlyText = "Live casino tables and jackpots in the game lobby";
      expect(
        evaluateExtractionInputSufficiency({
          content: lobbyOnlyText,
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);
    });
  });

  describe("Whitespace normalization", () => {
    it("does not count tabs or repeated spaces as extractable signal", () => {
      const padded = `\t\t${" ".repeat(200)}\n\n\t bonus \t\n`;
      expect(padded.length).toBeGreaterThan(MIN_EXTRACTION_INPUT_LENGTH);

      expect(normalizeExtractionInput(padded)).toBe("bonus");
      expect(
        evaluateExtractionInputSufficiency({
          content: padded,
          taskContext: "BONUS",
        }).sufficient,
      ).toBe(false);
    });

    it("preserves separation between text blocks", () => {
      expect(normalizeExtractionInput("Welcome offer\n\n\t100%  match")).toBe(
        "Welcome offer\n100% match",
      );
    });
  });

  describe("Bounded, secret-safe rejection", () => {
    it("carries no raw body text, URL, or credential-like material", () => {
      const sensitive =
        "https://admin:super-secret-password@casino.example.com/x?api_key=secret-key-123#frag";
      const rejection = evaluateExtractionInputSufficiency({
        content: sensitive,
        taskContext: "BONUS",
      });
      expect(rejection.sufficient).toBe(false);
      if (rejection.sufficient) return;

      const error = new ExtractionInputRejectedError(rejection);
      const serialized = `${error.message} ${error.name} ${error.category} ${error.reason}`;

      for (const secret of [
        "super-secret-password",
        "api_key",
        "secret-key-123",
        "casino.example.com",
        "https://",
        "frag",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it("uses a stable bounded reason and a machine-readable category", () => {
      const rejection = evaluateExtractionInputSufficiency({
        content: "",
        taskContext: "BONUS",
      });
      if (rejection.sufficient) throw new Error("expected rejection");

      expect(rejection.category).toBe("INSUFFICIENT_CONTENT");
      expect(rejection.reason.length).toBeLessThanOrEqual(200);

      const error = new ExtractionInputRejectedError(rejection);
      expect(error.name).toBe("ExtractionInputRejectedError");
      expect(error.message.startsWith("EXTRACTION_INPUT_REJECTED ")).toBe(true);
      expect(
        JSON.parse(error.message.replace("EXTRACTION_INPUT_REJECTED ", "")),
      ).toEqual({
        category: "INSUFFICIENT_CONTENT",
        reason: rejection.reason,
      });
    });
  });
});
