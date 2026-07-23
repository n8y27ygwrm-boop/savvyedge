import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (slug) {
      const casino = await prisma.casino.findUnique({
        where: { slug },
        include: {
          history_events: true,
          bonuses: {
            where: PublicationGateService.whereBonusPublic(),
            include: { history_events: true },
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
          casino_slots: {
            include: {
              slot: {
                include: { provider: true },
              },
            },
          },
        },
      });

      if (!casino || !PublicationGateService.isCasinoPubliclyEligible(casino)) {
        return NextResponse.json(
          { error: "Casino not found" },
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const license = casino.licenses[0];
      const data = {
        id: casino.id,
        slug: casino.slug,
        name: casino.name,
        website_url: casino.website_url,
        status: casino.status,
        verified_at: casino.verified_at,
        is_verified: PublicationGateService.isVerificationBadgeEligible(casino),
        license: license
          ? {
              regulator_name: license.regulator.name,
              jurisdiction_name: license.regulator.jurisdiction.name,
              license_no: license.license_no,
            }
          : null,
        bonuses: casino.bonuses
          .filter((b) => PublicationGateService.isBonusPubliclyEligible(b, casino))
          .map((b) => ({
            id: b.id,
            type: b.type,
            headline_value: b.headline_value,
            wagering_requirement: b.wagering_requirement,
            max_conversion: b.max_conversion,
            true_value_score: b.true_value_score,
            status: b.status,
            valid_until: b.valid_until,
            verified_at: b.verified_at,
          })),
        games: casino.casino_slots.map((cs) => ({
          slot_name: cs.slot.name,
          provider_name: cs.slot.provider.name,
          rtp_current: cs.slot.rtp_current,
          volatility: cs.slot.volatility,
          verified_at: cs.verified_at,
        })),
      };

      return NextResponse.json(data, {
        headers: { "Content-Type": "application/json" },
      });
    }

    const rawCasinos = await prisma.casino.findMany({
      where: PublicationGateService.whereCasinoPublic(),
      orderBy: { name: "asc" },
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
      },
    });

    const casinos = rawCasinos
      .filter((c) => PublicationGateService.isCasinoPubliclyEligible(c))
      .slice(0, 50);

    const data = casinos.map((c) => {
      const license = c.licenses[0];
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        website_url: c.website_url,
        status: c.status,
        verified_at: c.verified_at,
        license: license
          ? {
              regulator_name: license.regulator.name,
              jurisdiction_name: license.regulator.jurisdiction.name,
              license_no: license.license_no,
            }
          : null,
      };
    });

    return NextResponse.json(data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API /api/casinos] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
