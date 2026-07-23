import { NextResponse } from "next/server";
import { OrchestratorService, verifyApiAuthorization } from "@savvyedge/api";

export async function GET(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 }
    );
  }

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
