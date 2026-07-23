import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";
import BonusesClient from "./BonusesClient";

export const metadata = {
  title: "Verified Bonus Intelligence | SavvyEdge",
  description:
    "Compare online casino bonuses with True Value Scores that account for wagering requirements, caps, and time limits.",
};

export default async function BonusesPage() {
  const rawBonuses = await prisma.bonus.findMany({
    where: PublicationGateService.whereBonusPublic(),
    orderBy: { true_value_score: "desc" },
    include: {
      history_events: true,
      casino: {
        include: {
          history_events: true,
          licenses: true,
        },
      },
    },
  });

  const eligibleBonuses = rawBonuses
    .filter((b) => PublicationGateService.isBonusPubliclyEligible(b))
    .slice(0, 50)
    .map((b) => ({
      ...b,
      is_verified: PublicationGateService.isVerificationBadgeEligible(b),
    }));

  return <BonusesClient bonuses={eligibleBonuses} />;
}
