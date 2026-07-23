import { NextResponse } from "next/server";
import { DiscoveryService, verifyApiAuthorization } from "@savvyedge/api";

export async function GET(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await DiscoveryService.getDiscoveredUrls({ page, limit });
    return NextResponse.json({ data: result.data, meta: result.meta, error: null });
  } catch (error: any) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Internal server error" } },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 }
    );
  }

  try {
    const body = await request.json();
    const seedUrls = body.seedUrls;

    if (!Array.isArray(seedUrls) || seedUrls.length === 0) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "seedUrls must be a non-empty array of strings" } },
        { status: 400 }
      );
    }

    const result = await DiscoveryService.discoverAndEnqueue(seedUrls);
    return NextResponse.json({ data: result, meta: null, error: null }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Internal server error" } },
      { status: 500 }
    );
  }
}
