/**
 * Canonical Bonus source-identity key syntax.
 *
 * Deliberately its own module with **zero imports**. The sibling
 * key-constructing module in this directory depends on the database package,
 * whose entrypoint instantiates a Prisma client and reads environment variables
 * at module load. The pure production audit boundary needs this predicate but
 * must not pull that in, so the shared definition lives here and both sides
 * import it. Keep this file dependency-free.
 */

/**
 * Validates the exact canonical source-offer-key format. Performs no
 * normalization: callers must supply the exact stored/generated key.
 */
export const BONUS_SOURCE_KEY_VERSION = "bonus-url-v1";
const BONUS_SOURCE_KEY_PATTERN = new RegExp(
  `^${BONUS_SOURCE_KEY_VERSION}:[0-9a-f]{64}$`,
);

export function isBonusSourceOfferKey(value: unknown): boolean {
  return typeof value === "string" && BONUS_SOURCE_KEY_PATTERN.test(value);
}
