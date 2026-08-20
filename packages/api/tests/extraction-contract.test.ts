import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EXTRACTION_CONTRACT_VERSION,
  ExtractionContractError,
  artifactIdentity,
  bonusExtractionKey,
  normalizeBonusExtraction,
} from "@savvyedge/ai-agents";
import type { CreateBonusInput } from "@savvyedge/types";

const LOCATOR_A =
  "supabase://savvyedge-evidence/v1/observations/2026/08/20/www.betmgm.co.uk/" +
  "20260820T111816311Z_afb542e0-56cc-44c3-bf20-27b2b251651d_geo_fallback_" +
  "a4d6539888c0d9ec47149d05d2203a017249fb401912e9cee0298035c81a40ed.html";
const LOCATOR_B = LOCATOR_A.replace("111816311Z", "121816311Z");

const HTML_HASH_A =
  "a4d6539888c0d9ec47149d05d2203a017249fb401912e9cee0298035c81a40ed";
const HTML_HASH_B =
  "b4d6539888c0d9ec47149d05d2203a017249fb401912e9cee0298035c81a40ed";
const CONTENT_HASH =
  "e303cbd3d0c055a25134a89f1afaddc068bf732288d145cc1f11e08826b1717a";

function extracted(overrides: Partial<CreateBonusInput> = {}): CreateBonusInput {
  return {
    casino_id: "00000000-0000-4000-8000-000000000001",
    type: "FREE_SPINS",
    headline_value: "placeholder",
    wagering_requirement: 99,
    max_conversion: 99,
    valid_from: null,
    valid_until: null,
    status: "ACTIVE",
    ...overrides,
  } as CreateBonusInput;
}

describe("extraction contract identity", () => {
  it("pins the manually owned contract version", () => {
    expect(EXTRACTION_CONTRACT_VERSION).toBe("extraction-v2");
  });

  it("produces the documented key shape without leaking the locator", () => {
    const key = bonusExtractionKey({
      snapshotLocator: LOCATOR_A,
      htmlHash: HTML_HASH_A,
      contentHash: CONTENT_HASH,
    });

    const [version, context, identity, content] = key.split(":");
    expect(version).toBe("extraction-v2");
    expect(context).toBe("BONUS");
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(content).toBe(CONTENT_HASH);

    // The locator is secret-adjacent and must survive only as hash input.
    expect(key).not.toContain("supabase://");
    expect(key).not.toContain("savvyedge-evidence");
    expect(key).not.toContain("betmgm");
    expect(key.split(":")).toHaveLength(4);
  });

  it("is deterministic for the same artifact", () => {
    const once = bonusExtractionKey({
      snapshotLocator: LOCATOR_A,
      htmlHash: HTML_HASH_A,
      contentHash: CONTENT_HASH,
    });
    const twice = bonusExtractionKey({
      snapshotLocator: LOCATOR_A,
      htmlHash: HTML_HASH_A,
      contentHash: CONTENT_HASH,
    });
    expect(once).toBe(twice);
  });

  it("changes identity when only the html hash changes", () => {
    expect(artifactIdentity({ snapshotLocator: LOCATOR_A, htmlHash: HTML_HASH_A })).not.toBe(
      artifactIdentity({ snapshotLocator: LOCATOR_A, htmlHash: HTML_HASH_B }),
    );
  });

  it("changes identity when only the snapshot locator changes", () => {
    expect(artifactIdentity({ snapshotLocator: LOCATOR_A, htmlHash: HTML_HASH_A })).not.toBe(
      artifactIdentity({ snapshotLocator: LOCATOR_B, htmlHash: HTML_HASH_A }),
    );
  });

  it("gives identical content at two distinct artifacts distinct keys", () => {
    // A later real reverification persists a new artifact for unchanged
    // content: a new observation, therefore a new extraction identity.
    const first = bonusExtractionKey({
      snapshotLocator: LOCATOR_A,
      htmlHash: HTML_HASH_A,
      contentHash: CONTENT_HASH,
    });
    const second = bonusExtractionKey({
      snapshotLocator: LOCATOR_B,
      htmlHash: HTML_HASH_B,
      contentHash: CONTENT_HASH,
    });
    expect(first).not.toBe(second);
    expect(first.endsWith(CONTENT_HASH)).toBe(true);
    expect(second.endsWith(CONTENT_HASH)).toBe(true);
  });

  it.each([
    ["empty locator", { snapshotLocator: "  ", htmlHash: HTML_HASH_A, contentHash: CONTENT_HASH }],
    ["bad html hash", { snapshotLocator: LOCATOR_A, htmlHash: "nope", contentHash: CONTENT_HASH }],
    ["bad content hash", { snapshotLocator: LOCATOR_A, htmlHash: HTML_HASH_A, contentHash: "nope" }],
  ])("rejects %s rather than fabricating identity", (_label, input) => {
    expect(() => bonusExtractionKey(input as never)).toThrow(
      ExtractionContractError,
    );
  });
});

/**
 * Golden corpus.
 *
 * A behaviour change without a version bump changes this digest and fails here,
 * naming the constant. This is the strongest practical guard, not a proof: it
 * only covers inputs the corpus contains, so extending the corpus is part of
 * changing extraction semantics.
 */
describe("extraction contract golden corpus", () => {
  const CORPUS: Array<[string, string]> = [
    [
      "betmgm-wager-20-incident",
      "Opt in, wager £20+ on eligible games Mon 00:01 - Thurs 23:59 for 10 Free Spins worth 10p each",
    ],
    ["explicit-10x", "Get 50 free spins, wager winnings 10x to withdraw"],
    ["explicit-10-times", "Get 50 free spins, wager winnings 10 times to withdraw"],
    [
      "free-spin-winnings-scope",
      "Get 300 FREE SPINS when you play £30 on slots\nWager winnings from Free Spins 10 times to receive Cash",
    ],
    ["absent-wagering", "Get 100 free spins when you deposit £20"],
    ["monetary-qualifying-spend", "Spend £25 on any slot to receive 20 free spins"],
  ];

  const results = CORPUS.map(([name, source]) => {
    const out = normalizeBonusExtraction(source, extracted());
    return {
      name,
      type: out.bonus.type,
      headline_value: out.bonus.headline_value,
      wagering_requirement: out.bonus.wagering_requirement,
      max_conversion: out.bonus.max_conversion,
      wagering: out.semantics.wagering,
      qualifyingPlaySpend: out.semantics.qualifyingPlaySpend,
      freeSpinCount: out.semantics.freeSpinCount,
    };
  });

  it("holds the incident case at null wagering", () => {
    const incident = results.find((r) => r.name === "betmgm-wager-20-incident")!;
    expect(incident.wagering_requirement).toBeNull();
    expect(incident.qualifyingPlaySpend).toMatchObject({ amount: 20, currency: "£" });
  });

  it.each(["explicit-10x", "explicit-10-times"])(
    "keeps %s as a real multiplier",
    (name) => {
      expect(results.find((r) => r.name === name)!.wagering_requirement).toBe(10);
    },
  );

  it("keeps the free-spin-winnings scope", () => {
    const scoped = results.find((r) => r.name === "free-spin-winnings-scope")!;
    expect(scoped.wagering).toMatchObject({ scope: "FREE_SPIN_WINNINGS", multiplier: 10 });
  });

  it("leaves absent wagering and monetary qualifying spend unfabricated", () => {
    expect(results.find((r) => r.name === "absent-wagering")!.wagering_requirement).toBeNull();
    expect(
      results.find((r) => r.name === "monetary-qualifying-spend")!.wagering_requirement,
    ).toBeNull();
  });

  it("fails when extraction output drifts without a contract bump", () => {
    const digest = createHash("sha256")
      .update(JSON.stringify(results))
      .digest("hex");

    // If this fails, extraction behaviour changed. Either revert it, or bump
    // EXTRACTION_CONTRACT_VERSION in
    // packages/ai-agents/src/utils/extraction-contract.ts and update this
    // digest in the same change.
    expect({ version: EXTRACTION_CONTRACT_VERSION, digest }).toEqual({
      version: "extraction-v2",
      digest: "7aa5d434e5f3a7d86d026320c5254a45b241eafb9de8715a08544e1f201ddec7",
    });
  });
});
