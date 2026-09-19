import { NextResponse } from "next/server";
import { CasinoService } from "@savvyedge/api/casino-service";
import { PublicationGateService } from "@savvyedge/api/publication-gate";
import { verifyApiAuthorization } from "@savvyedge/api/auth";
import { CreateCasinoInputSchema } from "@savvyedge/types";
import { prisma } from "@savvyedge/database";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const skip = (page - 1) * limit;

    // One request-scoped clock for both the query predicate and the runtime gate.
    const now = new Date();
    const whereClause = PublicationGateService.whereCasinoPublic();

    const rawCasinos = await prisma.casino.findMany({
      where: whereClause,
      orderBy: { name: "asc" },
      include: {
        history_events: true,
        bonuses: {
          where: PublicationGateService.whereBonusPublic(now),
          // Validation input for the runtime freshness gate only.
          include: PublicationGateService.bonusActiveEvidenceInclude(),
        },
        licenses: {
          include: {
            regulator: {
              include: {
                jurisdiction: true,
              },
            },
          },
        },
      },
    });

    const eligibleCasinos = rawCasinos.filter((c) =>
      PublicationGateService.isCasinoPubliclyEligible(c),
    );

    const total = eligibleCasinos.length;
    const casinos = eligibleCasinos.slice(skip, skip + limit).map((casino) => ({
      ...casino,
      bonuses: casino.bonuses
        .filter((bonus) =>
          PublicationGateService.isBonusPubliclyEligible(bonus, casino, now),
        )
        .map((bonus) => PublicationGateService.toPublicBonus(bonus)),
    }));
    const totalPages = Math.ceil(total / limit) || 1;

    return NextResponse.json({
      data: casinos,
      meta: { page, limit, total, totalPages },
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 },
    );
  }

  try {
    const body = await request.json();
    const parsed = CreateCasinoInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          data: null,
          meta: null,
          error: {
            message: "Validation error",
            details: parsed.error.format(),
          },
        },
        { status: 400 },
      );
    }

    const casino = await CasinoService.createCasino(parsed.data);
    return NextResponse.json(
      { data: casino, meta: null, error: null },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        data: null,
        meta: null,
        error: { message: error.message || "Internal server error" },
      },
      { status: 500 },
    );
  }
}
