import { NextResponse } from "next/server";
import { verifyAdminSession, getOrCreateAdminActor } from "@/lib/auth";
import {
  WorkflowTransitionService,
  WorkflowTransitionError,
} from "@savvyedge/api";
import {
  prisma,
  ReviewStatus,
  PublicationStatus,
} from "@savvyedge/database";

export async function POST(request: Request) {
  // 1. Authenticate Admin Session
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    return NextResponse.json(
      { success: false, error: "Unauthorized access" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const {
      subjectType,
      subjectId,
      action,
      expectedVersion,
      reason,
      claimIds,
    } = body || {};

    // 2. Validate input parameters
    if (!subjectType || !["CASINO", "BONUS"].includes(subjectType)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing subjectType" },
        { status: 400 }
      );
    }

    if (!subjectId || typeof subjectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid or missing subjectId" },
        { status: 400 }
      );
    }

    if (typeof expectedVersion !== "number" || isNaN(expectedVersion)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing expectedVersion" },
        { status: 400 }
      );
    }

    if (action === "REJECT") {
      if (!reason || typeof reason !== "string" || reason.trim() === "") {
        return NextResponse.json(
          { success: false, error: "Rejection requires a non-empty reason" },
          { status: 400 }
        );
      }
    }

    // 3. Resolve Admin ReviewActor
    const adminActor = await getOrCreateAdminActor(prisma);
    const workflowService = new WorkflowTransitionService(prisma);

    let result;

    // 4. Dispatch Domain Transition via WorkflowTransitionService
    if (action === "BEGIN_REVIEW") {
      if (subjectType === "CASINO") {
        result = await workflowService.transitionCasinoReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.IN_REVIEW,
        });
      } else {
        result = await workflowService.transitionBonusReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.IN_REVIEW,
        });
      }
    } else if (action === "APPROVE") {
      // Look up claims for subject if claimIds not explicitly passed
      let effectiveClaimIds: string[] = Array.isArray(claimIds) ? claimIds : [];
      if (effectiveClaimIds.length === 0) {
        if (subjectType === "CASINO") {
          const claims = await prisma.casinoEvidenceClaim.findMany({
            where: { casino_id: subjectId },
            select: { id: true },
          });
          effectiveClaimIds = claims.map((c) => c.id);
        } else {
          const claims = await prisma.bonusEvidenceClaim.findMany({
            where: { bonus_id: subjectId },
            select: { id: true },
          });
          effectiveClaimIds = claims.map((c) => c.id);
        }
      }

      if (subjectType === "CASINO") {
        result = await workflowService.transitionCasinoReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.APPROVED,
          claimIds: effectiveClaimIds,
        });
      } else {
        result = await workflowService.transitionBonusReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.APPROVED,
          claimIds: effectiveClaimIds,
        });
      }
    } else if (action === "REJECT") {
      if (subjectType === "CASINO") {
        result = await workflowService.transitionCasinoReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.REJECTED,
          internalReason: reason,
        });
      } else {
        result = await workflowService.transitionBonusReview({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: ReviewStatus.REJECTED,
          internalReason: reason,
        });
      }
    } else if (action === "PUBLISH") {
      let effectiveClaimIds: string[] = Array.isArray(claimIds) ? claimIds : [];
      if (effectiveClaimIds.length === 0) {
        if (subjectType === "CASINO") {
          const claims = await prisma.casinoEvidenceClaim.findMany({
            where: { casino_id: subjectId },
            select: { id: true },
          });
          effectiveClaimIds = claims.map((c) => c.id);
        } else {
          const claims = await prisma.bonusEvidenceClaim.findMany({
            where: { bonus_id: subjectId },
            select: { id: true },
          });
          effectiveClaimIds = claims.map((c) => c.id);
        }
      }

      if (subjectType === "CASINO") {
        result = await workflowService.transitionCasinoPublication({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: effectiveClaimIds,
          reason,
        });
      } else {
        result = await workflowService.transitionBonusPublication({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: PublicationStatus.PUBLISHED,
          claimIds: effectiveClaimIds,
          reason,
        });
      }
    } else if (action === "UNPUBLISH") {
      if (subjectType === "CASINO") {
        result = await workflowService.transitionCasinoPublication({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: PublicationStatus.UNPUBLISHED,
          reason,
        });
      } else {
        result = await workflowService.transitionBonusPublication({
          subjectId,
          actorId: adminActor.id,
          expectedVersion,
          toStatus: PublicationStatus.UNPUBLISHED,
          reason,
        });
      }
    } else {
      return NextResponse.json(
        { success: false, error: `Unsupported transition action: ${action}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      const code = error.code;
      if (
        code === "SAME_STATE_CONFLICT" ||
        code === "STALE_GOVERNANCE_VERSION" ||
        code === "PUBLICATION_BLOCKED" ||
        code === "QUARANTINE_CLEARANCE_REQUIRED"
      ) {
        return NextResponse.json(
          {
            success: false,
            errorCode: code,
            error: `State Conflict: ${error.message}`,
          },
          { status: 409 }
        );
      }

      if (code === "EVIDENCE_INELIGIBLE" || code === "EVIDENCE_CONTRADICTORY" || code === "EVIDENCE_EXPIRED") {
        return NextResponse.json(
          {
            success: false,
            errorCode: code,
            error: `Evidence Error: ${error.message}`,
          },
          { status: 422 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          errorCode: code,
          error: error.message,
        },
        { status: 400 }
      );
    }

    console.error("[Admin Transition Handler Error]", error);
    const message = error instanceof Error ? error.message : "Internal server error during workflow transition";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
