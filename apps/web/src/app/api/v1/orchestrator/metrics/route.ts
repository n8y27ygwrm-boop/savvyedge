import { NextResponse } from "next/server";
import { OrchestratorService } from "@savvyedge/api";

export async function GET() {
  try {
    const metrics = await OrchestratorService.getMetrics();
    return NextResponse.json({ data: metrics, meta: null, error: null }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
