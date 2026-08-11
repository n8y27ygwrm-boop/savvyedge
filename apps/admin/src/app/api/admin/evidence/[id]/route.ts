import {
  EvidenceArtifactRetrievalError,
  type EvidenceArtifactRetrievalErrorCode,
} from "@savvyedge/api";
import { verifyAdminSession } from "../../../../../lib/auth";
import { canPerformAdminAction } from "../../../../../lib/permissions";
import {
  AdminEvidenceRetrievalError,
  retrieveGovernedAdminEvidence,
  type AdminEvidenceRetrievalResult,
} from "../../../../../lib/evidence-retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

interface RouteSession {
  authenticated: boolean;
  user?: { role: string };
}

export interface AdminEvidenceRouteDependencies {
  verifySession: (request: Request) => Promise<RouteSession>;
  canViewDetails: (role: string) => boolean;
  retrieveEvidence: (
    evidenceId: string,
  ) => Promise<AdminEvidenceRetrievalResult>;
}

function responseHeaders(evidenceId?: string): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  });
  if (evidenceId) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="evidence-${evidenceId}.json"`,
    );
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  evidenceId?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(evidenceId),
  });
}

function retrievalErrorStatus(code: EvidenceArtifactRetrievalErrorCode): number {
  if (code === "ARTIFACT_NOT_AVAILABLE") return 404;
  if (code === "UNSUPPORTED_ARTIFACT_LOCATOR") return 422;
  if (code === "ARTIFACT_INTEGRITY_FAILED") return 409;
  return 502;
}

function evidenceArtifactErrorCode(
  error: unknown,
): EvidenceArtifactRetrievalErrorCode | null {
  if (!(error instanceof Error) || error.name !== "EvidenceArtifactRetrievalError") {
    return null;
  }
  const code = (error as Error & { code?: unknown }).code;
  return [
    "ARTIFACT_NOT_AVAILABLE",
    "UNSUPPORTED_ARTIFACT_LOCATOR",
    "ARTIFACT_INTEGRITY_FAILED",
    "ARTIFACT_READ_FAILED",
  ].includes(String(code))
    ? (code as EvidenceArtifactRetrievalErrorCode)
    : null;
}

const defaultDependencies: AdminEvidenceRouteDependencies = {
  verifySession: (request) => verifyAdminSession(request),
  canViewDetails: (role) => canPerformAdminAction(role, "VIEW_DETAILS"),
  retrieveEvidence: (evidenceId) =>
    retrieveGovernedAdminEvidence(evidenceId),
};

export function createAdminEvidenceGetHandler(
  dependencies: AdminEvidenceRouteDependencies = defaultDependencies,
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const session = await dependencies.verifySession(request);
    if (!session.authenticated || !session.user) {
      return jsonResponse(
        { success: false, error: "Unauthorized access" },
        401,
      );
    }
    if (!dependencies.canViewDetails(session.user.role)) {
      return jsonResponse(
        {
          success: false,
          error: "Forbidden: Insufficient permissions for this action",
        },
        403,
      );
    }

    const { id } = await params;
    try {
      const evidence = await dependencies.retrieveEvidence(id);
      return jsonResponse(
        { success: true, evidence },
        200,
        evidence.id,
      );
    } catch (error: unknown) {
      if (error instanceof AdminEvidenceRetrievalError) {
        return jsonResponse(
          {
            success: false,
            errorCode: error.code,
            error: "Governed evidence was not found",
          },
          404,
        );
      }
      const artifactErrorCode = evidenceArtifactErrorCode(error);
      if (
        error instanceof EvidenceArtifactRetrievalError ||
        artifactErrorCode
      ) {
        const code =
          artifactErrorCode ??
          (error as EvidenceArtifactRetrievalError).code;
        return jsonResponse(
          {
            success: false,
            errorCode: code,
            error: "Evidence artifact could not be retrieved",
          },
          retrievalErrorStatus(code),
        );
      }
      return jsonResponse(
        {
          success: false,
          errorCode: "ARTIFACT_READ_FAILED",
          error: "Evidence artifact could not be retrieved",
        },
        502,
      );
    }
  };
}

export const GET = createAdminEvidenceGetHandler();
