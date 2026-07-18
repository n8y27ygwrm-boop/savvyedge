import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";

export async function GET() {
  try {
    const casinos = await prisma.casino.findMany({
      take: 50,
      orderBy: { name: "asc" },
      include: {
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
