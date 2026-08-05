import { IngestionService, verifyApiAuthorization } from "@savvyedge/api";
import { NextResponse } from "next/server";
import { z } from "zod";

const IngestionJobRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => {
        const normalizedValue = value.toLowerCase();
        return (
          normalizedValue.startsWith("http://") ||
          normalizedValue.startsWith("https://")
        );
      }, "URL must use http or https"),
    casino_id: z.string().uuid().optional(),
    taskContext: z.enum(["BONUS", "GAME_LIST"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.taskContext === "GAME_LIST" && !value.casino_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["casino_id"],
        message: "casino_id is required for GAME_LIST ingestion",
      });
    }
  });

export async function POST(request: Request) {
  const auth = verifyApiAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { data: null, meta: null, error: { message: auth.errorMessage } },
      { status: auth.statusCode || 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        data: null,
        meta: null,
        error: { message: "Validation error", details: "Invalid JSON body" },
      },
      { status: 400 },
    );
  }

  const parsed = IngestionJobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        meta: null,
        error: {
          message: "Validation error",
          details: parsed.error.format(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const scrapeJob = await IngestionService.enqueueIngestion(parsed.data);

    return NextResponse.json(
      {
        data: { scrapeJob },
        meta: {
          accepted: true,
          execution: "asynchronous",
          queueTask: "CRAWL_URL",
        },
        error: null,
      },
      { status: 202 },
    );
  } catch {
    console.error(
      "[POST /api/v1/ingestion/jobs] Failed to enqueue asynchronous ingestion job",
    );
    return NextResponse.json(
      {
        data: null,
        meta: null,
        error: { message: "Internal server error" },
      },
      { status: 500 },
    );
  }
}
