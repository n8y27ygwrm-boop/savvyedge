import { NextResponse } from "next/server";
import {
  getOrCreateAdminActor,
  verifyAdminSession,
} from "../../../../lib/auth";
import { canPerformAdminAction } from "../../../../lib/permissions";
import {
  SnapshotReprocessingError,
  requestSnapshotReprocessing,
} from "@savvyedge/api/snapshot-reprocessing";

/**
 * Queue a versioned reprocessing run for one stored authoritative snapshot.
 *
 * The caller supplies only sourceScrapeJobId. Every other value — the new
 * ScrapeJob, data source, URL, snapshot locator, hashes, task context,
 * extraction version and source observation time — is derived server-side from
 * persisted state, so a caller cannot direct the run at a different artifact,
 * data source or contract version.
 *
 * V1 is BONUS only, one snapshot per request. There is no bulk endpoint.
 */
export async function POST(request: Request) {
  const session = await verifyAdminSession(request);
  if (!session.authenticated || !session.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized access" },
      { status: 401 },
    );
  }

  if (!canPerformAdminAction(session.user.role, "REPROCESS_SNAPSHOT")) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const sourceScrapeJobId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).sourceScrapeJobId
      : undefined;

  if (typeof sourceScrapeJobId !== "string" || !sourceScrapeJobId.trim()) {
    return NextResponse.json(
      { success: false, error: "sourceScrapeJobId is required" },
      { status: 400 },
    );
  }

  // Establishes the acting admin identity for audit parity with transitions.
  await getOrCreateAdminActor();

  try {
    const plan = await requestSnapshotReprocessing({
      sourceScrapeJobId: sourceScrapeJobId.trim(),
    });

    return NextResponse.json({
      success: true,
      scrapeJobId: plan.scrapeJobId,
      sourceScrapeJobId: plan.sourceScrapeJobId,
      extractionVersion: plan.extractionVersion,
    });
  } catch (error) {
    if (error instanceof SnapshotReprocessingError) {
      const status =
        error.code === "SOURCE_JOB_NOT_FOUND"
          ? 404
          : error.code === "ALREADY_PROCESSED"
            ? 409
            : error.code === "SOURCE_SNAPSHOT_NOT_CURRENT"
              ? 409
              : 422;
      return NextResponse.json(
        { success: false, errorCode: error.code, error: error.message },
        { status },
      );
    }
    return NextResponse.json(
      { success: false, error: "Snapshot reprocessing could not be queued" },
      { status: 500 },
    );
  }
}
