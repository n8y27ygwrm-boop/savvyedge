import { prisma } from "@savvyedge/database";
import SlotsClient from "./SlotsClient";

export const metadata = {
  title: "Live RTP Tracker | SavvyEdge",
  description:
    "Monitor real-time Return to Player percentages for popular online slots. Independently verified RTP data updated every 6 hours.",
};

export default async function SlotsPage() {
  const slots = await prisma.slot.findMany({
    take: 50,
    orderBy: { rtp_current: "desc" },
    include: {
      provider: true,
      rtp_history: {
        orderBy: { recorded_at: "asc" },
      },
    },
  });

  return <SlotsClient slots={slots} />;
}
