export interface BonusFreshnessPolicy {
  maxAgeMs: number;
}

export const DEFAULT_BONUS_FRESHNESS_POLICY: BonusFreshnessPolicy = {
  maxAgeMs: 72 * 60 * 60 * 1000, // 72 hours
};

/**
 * Pure predicate to evaluate whether a Bonus machine/source verification timestamp is fresh.
 *
 * Rules:
 * - null, undefined, or missing => false
 * - invalid date timestamp => false
 * - verified_at strictly in the future (> now) => false
 * - age <= maxAgeMs (e.g. <= 72h) => true
 * - age > maxAgeMs (e.g. > 72h) => false
 */
export function isBonusFresh(
  verifiedAt: Date | string | null | undefined,
  now: Date,
  policy?: Partial<BonusFreshnessPolicy>,
): boolean {
  if (!verifiedAt) {
    return false;
  }

  const verifiedDate =
    typeof verifiedAt === "string" ? new Date(verifiedAt) : verifiedAt;
  const verifiedTime = verifiedDate.getTime();

  if (isNaN(verifiedTime)) {
    return false;
  }

  const nowTime = now.getTime();
  if (isNaN(nowTime)) {
    return false;
  }

  // Reject future timestamps
  if (verifiedTime > nowTime) {
    return false;
  }

  const maxAgeMs = policy?.maxAgeMs ?? DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs;
  const ageMs = nowTime - verifiedTime;

  return ageMs <= maxAgeMs;
}
