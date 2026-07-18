import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";

export async function GET() {
  try {
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

    const data = slots.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      provider_name: s.provider.name,
      rtp_current: s.rtp_current,
      volatility: s.volatility,
      max_win: s.max_win,
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
