import { prisma } from "@savvyedge/database";
import BonusesClient from "./BonusesClient";

export const metadata = {
  title: "Verified Bonus Intelligence | SavvyEdge",
  description:
    "Compare online casino bonuses with True Value Scores that account for wagering requirements, caps, and time limits.",
};

export default async function BonusesPage() {
  const bonuses = await prisma.bonus.findMany({
    take: 50,
    orderBy: { true_value_score: "desc" },
    include: {
      casino: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
    },
  });

  return <BonusesClient bonuses={bonuses} />;
}
