import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";

export async function GET() {
  try {
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

    const slots = rawSlots
      .filter((s) => PublicationGateService.isSlotPubliclyEligible(s))
      .slice(0, 50);

    const data = slots.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      provider_name: s.provider.name,
      rtp_current: s.rtp_current,
      volatility: s.volatility,
      max_win: s.max_win,
      wagering_contribution_pct: s.wagering_contribution_pct,
      rtp_history: s.rtp_history.map((h) => h.rtp_value),
    }));

    return NextResponse.json(data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API /api/slots] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
