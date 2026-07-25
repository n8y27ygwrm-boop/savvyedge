import {
  QUARANTINE_ENTITY_TYPES,
  isGovernedEntityId,
  type QuarantineEntityType,
} from "./quarantine";

const TRANSITION_ACTIONS = [
  "BEGIN_REVIEW",
  "APPROVE",
  "REJECT",
  "CLEAR_QUARANTINE",
  "PUBLISH",
  "UNPUBLISH",
] as const;

const MAX_INTERNAL_REASON_LENGTH = 500;

export type AdminTransitionAction = (typeof TRANSITION_ACTIONS)[number];

export interface AdminTransitionRequest {
  subjectType: QuarantineEntityType;
  subjectId: string;
  action: AdminTransitionAction;
  expectedVersion: number;
  claimIds?: string[];
  internalReason?: string;
  reason?: string;
}

export class TransitionRequestValidationError extends Error {
  public constructor() {
    super("Invalid transition request.");
    this.name = "TransitionRequestValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

function parseReason(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TransitionRequestValidationError();
  }
  const normalized = value.trim();
  if (
    (required && normalized.length === 0) ||
    normalized.length > MAX_INTERNAL_REASON_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) {
    throw new TransitionRequestValidationError();
  }
  return normalized;
}

function parseClaimIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((claimId) => typeof claimId !== "string")) {
    throw new TransitionRequestValidationError();
  }
  if (!value.every(isGovernedEntityId)) {
    throw new TransitionRequestValidationError();
  }
  const claimIds = [...value].sort();
  if (new Set(claimIds).size !== claimIds.length) {
    throw new TransitionRequestValidationError();
  }
  return claimIds;
}

export function parseAdminTransitionRequest(
  body: unknown,
): AdminTransitionRequest {
  if (!isRecord(body) || "clearQuarantine" in body) {
    throw new TransitionRequestValidationError();
  }

  const subjectType = enumValue(body.subjectType, QUARANTINE_ENTITY_TYPES);
  const action = enumValue(body.action, TRANSITION_ACTIONS);
  if (
    !subjectType ||
    !action ||
    typeof body.subjectId !== "string" ||
    !isGovernedEntityId(body.subjectId)
  ) {
    throw new TransitionRequestValidationError();
  }
  if (
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion) ||
    body.expectedVersion < 0 ||
    body.expectedVersion >= 2_147_483_647
  ) {
    throw new TransitionRequestValidationError();
  }

  if (action === "CLEAR_QUARANTINE" || action === "REJECT") {
    return {
      subjectType,
      subjectId: body.subjectId,
      action,
      expectedVersion: body.expectedVersion,
      claimIds: parseClaimIds(body.claimIds),
      internalReason: parseReason(body.internalReason, true),
    };
  }

  if (body.internalReason !== undefined) {
    throw new TransitionRequestValidationError();
  }

  return {
    subjectType,
    subjectId: body.subjectId,
    action,
    expectedVersion: body.expectedVersion,
    claimIds: parseClaimIds(body.claimIds),
    reason: parseReason(body.reason, false),
  };
}
