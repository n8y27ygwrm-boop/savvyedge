import { NextResponse } from "next/server";
import { CasinoService } from "@savvyedge/api";
import { CreateCasinoInputSchema } from "@savvyedge/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await CasinoService.getCasinos({ page, limit });
    return NextResponse.json({ data: result.data, meta: result.meta, error: null });
  } catch (error) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateCasinoInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Validation error", details: parsed.error.format() } },
        { status: 400 }
      );
    }

    const casino = await CasinoService.createCasino(parsed.data);
    return NextResponse.json({ data: casino, meta: null, error: null }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
