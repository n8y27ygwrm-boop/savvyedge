import { NextResponse } from "next/server";
import { IngestionService } from "@savvyedge/api";
import { z } from "zod";

const IngestRequestBodySchema = z.object({
  url: z.string().url(),
  casino_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = IngestRequestBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { data: null, meta: null, error: { message: "Validation error", details: parsed.error.format() } },
        { status: 400 }
      );
    }

    const result = await IngestionService.ingestBonusFromUrl(parsed.data);
    return NextResponse.json({ data: result.bonus, meta: { scrapeJob: result.scrapeJob, ...result.meta }, error: null }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/v1/bonuses/ingest] Error:", error);
    return NextResponse.json(
      { data: null, meta: null, error: { message: error.message || "Ingestion pipeline failure" } },
      { status: 500 }
    );
  }
}
