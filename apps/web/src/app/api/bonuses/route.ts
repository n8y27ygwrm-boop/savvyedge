import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";

export async function GET() {
  try {
    const bonuses = await prisma.bonus.findMany({
      take: 50,
      orderBy: { true_value_score: "desc" },
      include: {
        casino: true,
      },
    });

    const data = bonuses.map((b) => ({
      id: b.id,
      casino_name: b.casino.name,
      casino_slug: b.casino.slug,
      type: b.type,
      headline_value: b.headline_value,
      wagering_requirement: b.wagering_requirement,
      max_conversion: b.max_conversion,
      true_value_score: b.true_value_score,
      status: b.status,
      valid_until: b.valid_until,
      verified_at: b.verified_at,
    }));

    return NextResponse.json(data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API /api/bonuses] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
