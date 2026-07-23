import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";
import SlotsClient from "./SlotsClient";

export const metadata = {
  title: "Live RTP Tracker | SavvyEdge",
  description:
    "Monitor real-time Return to Player percentages for popular online slots. Independently verified RTP data updated every 6 hours.",
};

export default async function SlotsPage() {
  const rawSlots = await prisma.slot.findMany({
    where: PublicationGateService.whereSlotPublic(),
    orderBy: { rtp_current: "desc" },
    include: {
      provider: true,
      rtp_history: {
        orderBy: { recorded_at: "asc" },
      },
      casino_slots: {
        include: {
          casino: {
            include: {
              history_events: true,
              licenses: true,
            },
          },
        },
      },
    },
  });

  const eligibleSlots = rawSlots
    .filter((s) => PublicationGateService.isSlotPubliclyEligible(s))
    .slice(0, 50);

  return <SlotsClient slots={eligibleSlots} />;
}
