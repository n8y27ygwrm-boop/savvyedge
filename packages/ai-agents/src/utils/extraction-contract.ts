import { createHash } from "crypto";

/**
 * Manually owned semantic version of BONUS extraction.
 *
 * BUMP when a fixed input can produce different normalized extraction output —
 * any change to bonus-semantics.ts, the BonusAgent prompt, or extractReadableText
 * that alters what a given source text yields.
 *
 * DO NOT BUMP for comments, logging, or behaviour-preserving refactors.
 *
 * v1 -> v2 was the `wager £20` incident: a currency-prefixed qualifying spend
 * was read as a wagering multiplier. Fixed in 67291b8.
 *
 * This is a human convention. The golden-corpus guard in
 * packages/api/tests/extraction-contract.test.ts makes a forgotten bump fail
 * CI, but it can only detect drift for inputs the corpus actually covers — a
 * behaviour change outside the corpus still ships silently. Extending the
 * corpus is part of changing extraction semantics.
 */
export const EXTRACTION_CONTRACT_VERSION = "extraction-v2";

/** V1 supports BONUS only. */
export type ExtractionContext = "BONUS";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export class ExtractionContractError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_SNAPSHOT_LOCATOR"
      | "INVALID_HTML_HASH"
      | "INVALID_CONTENT_HASH",
  ) {
    super(`Extraction contract input rejected (${code})`);
    this.name = "ExtractionContractError";
  }
}

/**
 * Identity of one persisted authoritative observation.
 *
 * Derived from the canonical storage locator and the *verified* html hash of
 * the bytes at that locator, so it names a specific persisted artifact rather
 * than the content it happens to carry. Two reverifications of byte-identical
 * content persist two distinct artifacts and therefore hold two distinct
 * observation identities; re-reading the same stored artifact always yields
 * the same one.
 *
 * The locator is secret-adjacent (it addresses evidence storage), so it is
 * consumed only as hash input and never returned, logged or embedded in the
 * key in raw form.
 */
export function artifactIdentity(input: {
  snapshotLocator: string;
  htmlHash: string;
}): string {
  const locator =
    typeof input.snapshotLocator === "string" ? input.snapshotLocator.trim() : "";
  if (!locator) {
    throw new ExtractionContractError("INVALID_SNAPSHOT_LOCATOR");
  }
  const htmlHash =
    typeof input.htmlHash === "string" ? input.htmlHash.trim().toLowerCase() : "";
  if (!SHA256_PATTERN.test(htmlHash)) {
    throw new ExtractionContractError("INVALID_HTML_HASH");
  }

  return createHash("sha256").update(`${locator}\n${htmlHash}`).digest("hex");
}

/**
 * Deterministic extraction identity.
 *
 *   extraction-v2:BONUS:<64-char artifact digest>:<64-char content hash>
 *
 * The unit of idempotency is (data source, authoritative artifact, context,
 * contract version) — enforced together with EvidenceRecord.data_source_id by
 * the composite unique index. It is deliberately *not* "one evidence record
 * for this content forever": a later real observation is a new artifact and
 * must remain independently evidenced.
 */
export function bonusExtractionKey(input: {
  snapshotLocator: string;
  htmlHash: string;
  contentHash: string;
  contractVersion?: string;
}): string {
  const contentHash =
    typeof input.contentHash === "string"
      ? input.contentHash.trim().toLowerCase()
      : "";
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new ExtractionContractError("INVALID_CONTENT_HASH");
  }

  const identity = artifactIdentity(input);
  const version = input.contractVersion || EXTRACTION_CONTRACT_VERSION;

  return `${version}:BONUS:${identity}:${contentHash}`;
}
