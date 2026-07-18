import { NextResponse } from "next/server";
import { BonusService } from "@savvyedge/api";
import { CreateBonusInputSchema } from "@savvyedge/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await BonusService.getBonuses({ page, limit });
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
    
    // Convert date strings back to Date objects for validation if necessary,
    // but Zod handles this if we use .coerce.date() in the schema.
    // For now, let's assume body contains valid ISO date strings for date fields
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
