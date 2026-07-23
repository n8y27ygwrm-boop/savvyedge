import { NextResponse } from "next/server";
import { BonusService, PublicationGateService } from "@savvyedge/api";
import { prisma } from "@savvyedge/database";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const depositAmount = typeof body.depositAmount === "number" ? body.depositAmount : 0;
    const slotId = typeof body.slotId === "string" ? body.slotId : undefined;

    const bonus = await prisma.bonus.findUnique({
      where: { id },
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

    if (!bonus) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Bonus not found", code: "NOT_FOUND" } },
        { status: 404 }
      );
    }

    const validation = PublicationGateService.validateCalculatorEligibility(bonus, bonus.casino);
    if (validation.status !== "VALID") {
      const statusCode = validation.status === "INELIGIBLE_BONUS" ? 403 : 400;
      return NextResponse.json(
        {
          data: null,
          meta: null,
          error: { message: validation.reason || "Bonus is ineligible for public calculation", code: validation.status },
        },
        { status: statusCode }
      );
    }

    let gameContributionPct = 100;
    let slotRtp: number | null = null;

    if (slotId) {
      const slot = await prisma.slot.findUnique({
        where: { id: slotId },
        include: {
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

      if (!slot || !PublicationGateService.isSlotPubliclyEligible(slot)) {
        return NextResponse.json(
          {
            data: null,
            meta: null,
            error: { message: "Requested game is ineligible for public calculation", code: "INELIGIBLE_SLOT" },
          },
          { status: 403 }
        );
      }

      gameContributionPct = slot.wagering_contribution_pct;
      slotRtp = slot.rtp_current;
    }

    const result = BonusService.calculateBonusEV({
      depositAmount,
      headlineValue: bonus.headline_value,
      wageringRequirement: bonus.wagering_requirement,
      maxConversion: bonus.max_conversion,
      validUntil: bonus.valid_until,
      gameContributionPct,
      slotRtp,
    });

    return NextResponse.json({ data: result, meta: null, error: null });
  } catch (error) {
    console.error("[API /api/v1/bonuses/[id]/calculate] Error:", error);
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
