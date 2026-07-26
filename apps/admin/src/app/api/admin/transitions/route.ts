import { NextResponse } from "next/server";
import { getOrCreateAdminActor, verifyAdminSession } from "../../../../lib/auth";
import { canPerformAdminAction, type AdminAction } from "../../../../lib/permissions";
import {
  parseAdminTransitionRequest,
  TransitionRequestValidationError,
  type AdminTransitionRequest,
} from "../../../../lib/transition-request";
import {
  WorkflowTransitionError,
  WorkflowTransitionService,
  type PublicationTransitionCommand,
  type ReviewTransitionCommand,
} from "@savvyedge/api";
import { prisma, PublicationStatus, ReviewStatus } from "@savvyedge/database";

async function loadClaimIds(
  request: AdminTransitionRequest,
): Promise<string[]> {
  if (request.claimIds && request.claimIds.length > 0) {
    return request.claimIds;
  }

  if (request.subjectType === "CASINO") {
    return (
      await prisma.casinoEvidenceClaim.findMany({
        where: { casino_id: request.subjectId },
        select: { id: true },
      })
    ).map((claim) => claim.id);
  }
  if (request.subjectType === "BONUS") {
    return (
      await prisma.bonusEvidenceClaim.findMany({
        where: { bonus_id: request.subjectId },
        select: { id: true },
      })
    ).map((claim) => claim.id);
  }
  if (request.subjectType === "SLOT") {
    return (
      await prisma.slotEvidenceClaim.findMany({
        where: { slot_id: request.subjectId },
        select: { id: true },
      })
    ).map((claim) => claim.id);
  }
  return (
    await prisma.licenseEvidenceClaim.findMany({
      where: { license_id: request.subjectId },
      select: { id: true },
    })
  ).map((claim) => claim.id);
}

function transitionReview(
  service: WorkflowTransitionService,
  request: AdminTransitionRequest,
  command: ReviewTransitionCommand,
) {
  if (request.subjectType === "CASINO") {
    return service.transitionCasinoReview(command);
  }
  if (request.subjectType === "BONUS") {
    return service.transitionBonusReview(command);
  }
  if (request.subjectType === "SLOT") {
    return service.transitionSlotReview(command);
  }
  return service.transitionLicenseReview(command);
}

function transitionPublication(
  service: WorkflowTransitionService,
  request: AdminTransitionRequest,
  command: PublicationTransitionCommand,
) {
  if (request.subjectType === "CASINO") {
    return service.transitionCasinoPublication(command);
  }
  if (request.subjectType === "BONUS") {
    return service.transitionBonusPublication(command);
  }
  if (request.subjectType === "SLOT") {
    return service.transitionSlotPublication(command);
  }
  throw new TransitionRequestValidationError();
}

function workflowErrorResponse(error: WorkflowTransitionError) {
  const evidenceErrors = new Set([
    "EVIDENCE_INELIGIBLE",
    "EVIDENCE_CONTRADICTORY",
    "EVIDENCE_EXPIRED",
  ]);
  const conflictErrors = new Set([
    "SAME_STATE_CONFLICT",
    "STALE_GOVERNANCE_VERSION",
    "PUBLICATION_BLOCKED",
    "QUARANTINE_CLEARANCE_REQUIRED",
    "QUARANTINE_CLEARANCE_REASON_REQUIRED",
    "INVALID_TRANSITION",
  ]);
  const status =
    error.code === "SUBJECT_NOT_FOUND"
      ? 404
      : evidenceErrors.has(error.code)
        ? 422
        : conflictErrors.has(error.code)
          ? 409
          : 400;

  return NextResponse.json(
    { success: false, errorCode: error.code, error: error.message },
    { status },
  );
}

const ACTION_PERMISSION_MAP: Record<string, AdminAction> = {
  BEGIN_REVIEW: "BEGIN_REVIEW",
  APPROVE: "APPROVE_REVIEW",
  REJECT: "REJECT_REVIEW",
  CLEAR_QUARANTINE: "CLEAR_QUARANTINE",
  PUBLISH: "PUBLISH",
  UNPUBLISH: "UNPUBLISH",
};

export async function POST(request: Request) {
  const session = await verifyAdminSession(request);
  if (!session.authenticated || !session.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized access" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid transition request." },
      { status: 400 },
    );
  }

  try {
    const parsed = parseAdminTransitionRequest(body);

    const requiredAction = ACTION_PERMISSION_MAP[parsed.action];
    if (!requiredAction || !canPerformAdminAction(session.user.role, requiredAction)) {
      return NextResponse.json(
        { success: false, error: "Forbidden: Insufficient permissions for this action" },
        { status: 403 },
      );
    }

    const actorId = session.user.actorId || (await getOrCreateAdminActor(prisma)).id;
    const workflowService = new WorkflowTransitionService(prisma);
    const baseCommand = {
      subjectId: parsed.subjectId,
      actorId,
      expectedVersion: parsed.expectedVersion,
    };

    let result;
    if (parsed.action === "BEGIN_REVIEW") {
      result = await transitionReview(workflowService, parsed, {
        ...baseCommand,
        toStatus: ReviewStatus.IN_REVIEW,
      });
    } else if (parsed.action === "APPROVE") {
      result = await transitionReview(workflowService, parsed, {
        ...baseCommand,
        toStatus: ReviewStatus.APPROVED,
        claimIds: await loadClaimIds(parsed),
      });
    } else if (parsed.action === "REJECT") {
      result = await transitionReview(workflowService, parsed, {
        ...baseCommand,
        toStatus: ReviewStatus.REJECTED,
        internalReason: parsed.internalReason,
      });
    } else if (parsed.action === "CLEAR_QUARANTINE") {
      result = await transitionReview(workflowService, parsed, {
        ...baseCommand,
        toStatus: ReviewStatus.AWAITING_REVIEW,
        clearQuarantine: true,
        internalReason: parsed.internalReason,
        claimIds: parsed.claimIds ?? [],
      });
    } else if (parsed.action === "PUBLISH") {
      result = await transitionPublication(workflowService, parsed, {
        ...baseCommand,
        toStatus: PublicationStatus.PUBLISHED,
        claimIds: await loadClaimIds(parsed),
        reason: parsed.reason,
      });
    } else if (parsed.action === "UNPUBLISH") {
      result = await transitionPublication(workflowService, parsed, {
        ...baseCommand,
        toStatus: PublicationStatus.UNPUBLISHED,
        reason: parsed.reason,
      });
    } else {
      throw new TransitionRequestValidationError();
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TransitionRequestValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof WorkflowTransitionError) {
      return workflowErrorResponse(error);
    }

    console.error("[Admin Transition Handler Error]", error);
    return NextResponse.json(
      { success: false, error: "Unable to process the transition." },
      { status: 500 },
    );
  }
}
