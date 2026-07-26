import { AdminRole } from "@savvyedge/database";

export const ADMIN_ACTIONS = [
  "VIEW_REVIEW_QUEUE",
  "VIEW_DETAILS",
  "VIEW_AUDIT",
  "BEGIN_REVIEW",
  "REJECT_REVIEW",
  "APPROVE_REVIEW",
  "CLEAR_QUARANTINE",
  "PUBLISH",
  "UNPUBLISH",
  "MANAGE_ADMIN_USERS",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminAction>> = {
  REVIEWER: new Set<AdminAction>([
    "VIEW_REVIEW_QUEUE",
    "VIEW_DETAILS",
    "VIEW_AUDIT",
    "BEGIN_REVIEW",
    "REJECT_REVIEW",
  ]),
  SENIOR_REVIEWER: new Set<AdminAction>([
    "VIEW_REVIEW_QUEUE",
    "VIEW_DETAILS",
    "VIEW_AUDIT",
    "BEGIN_REVIEW",
    "REJECT_REVIEW",
    "APPROVE_REVIEW",
    "CLEAR_QUARANTINE",
  ]),
  PUBLISHER: new Set<AdminAction>([
    "VIEW_REVIEW_QUEUE",
    "VIEW_DETAILS",
    "VIEW_AUDIT",
    "PUBLISH",
    "UNPUBLISH",
  ]),
  ADMIN: new Set<AdminAction>([
    "VIEW_REVIEW_QUEUE",
    "VIEW_DETAILS",
    "VIEW_AUDIT",
    "BEGIN_REVIEW",
    "REJECT_REVIEW",
    "APPROVE_REVIEW",
    "CLEAR_QUARANTINE",
    "PUBLISH",
    "UNPUBLISH",
    "MANAGE_ADMIN_USERS",
  ]),
};

export function canPerformAdminAction(
  role: string | null | undefined,
  action: AdminAction,
): boolean {
  if (!role) {
    return false;
  }
  const normalizedRole = role.toUpperCase() as AdminRole;
  const permissions = ROLE_PERMISSIONS[normalizedRole];
  if (!permissions) {
    return false;
  }
  return permissions.has(action);
}
