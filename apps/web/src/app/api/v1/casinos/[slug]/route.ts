import { NextResponse } from "next/server";
import { CasinoService } from "@savvyedge/api";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const slug = (await params).slug;
    const casino = await CasinoService.getCasinoBySlug(slug);

    if (!casino) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Casino not found", code: "NOT_FOUND" } },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: casino, meta: null, error: null });
  } catch (error) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
