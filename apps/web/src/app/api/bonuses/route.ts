import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api/publication-gate";

export async function GET() {
  try {
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

    const bonuses = rawBonuses
      .filter((b) =>
        PublicationGateService.isBonusPubliclyEligible(b, b.casino, now),
      )
      .slice(0, 50);

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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
