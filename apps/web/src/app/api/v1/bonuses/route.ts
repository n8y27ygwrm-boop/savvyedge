import { NextResponse } from "next/server";
import { BonusService, PublicationGateService, verifyApiAuthorization } from "@savvyedge/api";
import { CreateBonusInputSchema } from "@savvyedge/types";
import { prisma } from "@savvyedge/database";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const skip = (page - 1) * limit;

    const whereClause = PublicationGateService.whereBonusPublic();

    const rawBonuses = await prisma.bonus.findMany({
      where: whereClause,
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

    const eligibleBonuses = rawBonuses.filter((b) =>
      PublicationGateService.isBonusPubliclyEligible(b)
    );

    const total = eligibleBonuses.length;
    const bonuses = eligibleBonuses.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit) || 1;

    return NextResponse.json({
      data: bonuses,
      meta: { page, limit, total, totalPages },
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 }
    );
  }

  try {
    const body = await request.json();

    const parsed = CreateBonusInputSchema.safeParse({
      ...body,
      valid_from: body.valid_from ? new Date(body.valid_from) : null,
      valid_until: body.valid_until ? new Date(body.valid_until) : null,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Validation error", details: parsed.error.format() } },
        { status: 400 }
      );
    }

    const bonus = await BonusService.createBonus(parsed.data);
    return NextResponse.json({ data: bonus, meta: null, error: null }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
