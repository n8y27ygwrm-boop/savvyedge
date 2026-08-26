import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api/publication-gate";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const slug = (await params).slug;
    const now = new Date();
    const casino = await prisma.casino.findUnique({
      where: { slug },
      include: {
        bonuses: {
          where: PublicationGateService.whereBonusPublic(now),
          include: { history_events: true },
        },
        licenses: true,
        history_events: true,
      },
    });

    if (!casino || !PublicationGateService.isCasinoPubliclyEligible(casino)) {
      return NextResponse.json(
        {
          data: null,
          meta: null,
          error: { message: "Casino not found", code: "NOT_FOUND" },
        },
        { status: 404 },
      );
    }

    const bonuses = casino.bonuses
      .filter((bonus) =>
        PublicationGateService.isBonusPubliclyEligible(bonus, casino, now),
      )
      .map(({ history_events: _evidenceHistory, ...bonus }) => bonus);

    return NextResponse.json({
      data: { ...casino, bonuses },
      meta: null,
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 },
    );
  }
}
