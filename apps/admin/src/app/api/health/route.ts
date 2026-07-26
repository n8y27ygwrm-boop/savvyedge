import { NextResponse } from "next/server";
import { prisma } from "@savvyedge/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const envName = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.SAVVY_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();

  const timestamp = new Date().toISOString();

  try {
    // Lightweight read-only database query ping
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        environment: envName,
        timestamp,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        environment: envName,
        timestamp,
      },
      { status: 503 }
    );
  }
}
