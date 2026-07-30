import { GovernedSubjectType } from "@savvyedge/database";

export function governanceDetailUrl(
  subjectType: GovernedSubjectType | string,
  subjectId: string,
): string | null {
  const encodedId = encodeURIComponent(subjectId);

  if (subjectType === GovernedSubjectType.CASINO) {
    return `/review/casino/${encodedId}`;
  }
  if (subjectType === GovernedSubjectType.BONUS) {
    return `/review/bonus/${encodedId}`;
  }
  if (subjectType === GovernedSubjectType.SLOT) {
    return `/quarantine/slot/${encodedId}`;
  }
  if (subjectType === GovernedSubjectType.LICENSE) {
    return `/quarantine/license/${encodedId}`;
  }
  return null;
}
