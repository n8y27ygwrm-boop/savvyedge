import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slugsParam = searchParams.get("slugs");

    if (!slugsParam) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Missing 'slugs' query parameter" } },
        { status: 400 }
      );
    }

    const slugs = slugsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (slugs.length < 2 || slugs.length > 3) {
      return NextResponse.json(
        {
          data: null,
          meta: null,
          error: { message: "Please provide between 2 and 3 casino slugs for comparison" },
        },
        { status: 400 }
      );
    }

    const publicCasinoWhere = PublicationGateService.whereCasinoPublic();

    // Database predicates reduce the candidate set; runtime predicates remain authoritative.
    const candidateCasinos = await prisma.casino.findMany({
      where: {
        AND: [{ slug: { in: slugs } }, publicCasinoWhere],
      },
      include: {
        history_events: true,
        licenses: {
          include: {
            regulator: {
              include: {
                jurisdiction: true,
              },
            },
          },
        },
        bonuses: {
          where: PublicationGateService.whereBonusPublic(),
          orderBy: { created_at: "desc" },
          include: {
            history_events: true,
          },
        },
      },
    });

    const casinos = candidateCasinos.filter((casino) =>
      PublicationGateService.isCasinoPubliclyEligible(casino)
    );

    if (casinos.length < 2) {
      return NextResponse.json(
        {
          data: null,
          meta: null,
          error: {
            message: "Fewer than two requested casinos are currently eligible for comparison",
          },
        },
        { status: 400 }
      );
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const formattedData = await Promise.all(
      casinos.map(async (casino) => {
        const bonusChangeCount = await prisma.bonusHistoryEvent.count({
          where: {
            bonus: { casino_id: casino.id },
            changed_at: { gte: ninetyDaysAgo },
          },
        });

        const activeLicense = casino.licenses.find(
          (license) => license.status === "ACTIVE" && license.verified_at !== null
        );
        let licensePayload = null;
        if (activeLicense) {
          licensePayload = {
            regulator_name: activeLicense.regulator.name,
            jurisdiction_name: activeLicense.regulator.jurisdiction.name,
            country: activeLicense.regulator.jurisdiction.country,
            license_no: activeLicense.license_no,
            status: activeLicense.status,
          };
        }

        const activeBonus = casino.bonuses.find((bonus) =>
          PublicationGateService.isBonusPubliclyEligible(bonus, casino)
        );
        let activeBonusPayload = null;
        if (activeBonus) {
          activeBonusPayload = {
            headline_value: activeBonus.headline_value,
            wagering_requirement: activeBonus.wagering_requirement,
            max_conversion: activeBonus.max_conversion,
            valid_until: activeBonus.valid_until,
            trueValueScore:
              activeBonus.true_value_score !== null && activeBonus.true_value_score <= 100
                ? activeBonus.true_value_score
                : null,
          };
        }

        return {
          slug: casino.slug,
          name: casino.name,
          website_url: casino.website_url,
          verified_at: casino.verified_at,
          license: licensePayload,
          activeBonus: activeBonusPayload,
          bonusChangeCount,
        };
      })
    );

    // Keep the order of returned casinos same as requested slugs
    const orderedData = slugs.flatMap((slug) => {
      const casino = formattedData.find(
        (candidate) => candidate.slug.toLowerCase() === slug.toLowerCase()
      );
      return casino ? [casino] : [];
    });

    return NextResponse.json({ data: orderedData, meta: null, error: null });
  } catch (error) {
    console.error("[API /api/v1/casinos/compare] Error:", error);
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
