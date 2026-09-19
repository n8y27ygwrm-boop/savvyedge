import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api/publication-gate";
import BonusesClient from "./BonusesClient";

export const metadata = {
  title: "Bonus Intelligence | SavvyEdge",
  description:
    "Compare online casino bonuses with True Value Scores that account for wagering requirements, caps, and time limits.",
};

export default async function BonusesPage() {
  // One request-scoped clock for both the query predicate and the runtime gate.
  const now = new Date();
  const rawBonuses = await prisma.bonus.findMany({
    where: PublicationGateService.whereBonusPublic(now),
    orderBy: { true_value_score: "desc" },
    include: {
      history_events: true,
      ...PublicationGateService.bonusActiveEvidenceInclude(),
      casino: {
        include: {
          history_events: true,
          licenses: true,
        },
      },
    },
  });

  const eligibleBonuses = rawBonuses
    .filter((b) =>
      PublicationGateService.isBonusPubliclyEligible(b, b.casino, now),
    )
    .slice(0, 50)
    .map((b) => ({
      // Internal validation relations never cross into client props.
      ...PublicationGateService.toPublicBonus(b),
      is_verified: PublicationGateService.isVerificationBadgeEligible(b),
    }));

  return <BonusesClient bonuses={eligibleBonuses} />;
}
