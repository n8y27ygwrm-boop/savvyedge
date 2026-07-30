import {
  prisma,
  GovernedSubjectType,
  WorkflowEventType,
  ReviewStatus,
  PublicationStatus,
  QuarantineReason,
  type PrismaClient,
  type Prisma,
} from "@savvyedge/database";
import { governanceDetailUrl } from "./governance-links";

export const AUDIT_SUBJECT_TYPES = [
  "CASINO",
  "BONUS",
  "SLOT",
  "LICENSE",
] as const;

export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number];

export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_PAGE_SIZE = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuditQueueFilters {
  eventType?: WorkflowEventType;
  subjectType?: AuditSubjectType;
  actorId?: string;
  subjectId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  isDateRangeInvalid?: boolean;
}

export interface AuditPaginationParams {
  page: number;
  limit: number;
}

export interface AuditQueueItem {
  id: string;
  occurredAt: Date;
  eventType: WorkflowEventType;
  subjectType: AuditSubjectType;
  subjectId: string;
  entityLabel: string;
  entityUnavailable: boolean;
  actorName: string;
  actorKind: string;
  actorId: string;
  fromReviewStatus: ReviewStatus | null;
  toReviewStatus: ReviewStatus | null;
  fromPublicationStatus: PublicationStatus | null;
  toPublicationStatus: PublicationStatus | null;
  quarantineReason: QuarantineReason | null;
  resultingVersion: number;
  hasInternalNote: boolean;
  detailUrl: string;
  subjectDetailUrl: string | null;
}

export interface AuditQueueResult {
  items: AuditQueueItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface AuditEventDetailClaim {
  id: string;
  claimId: string;
  subjectType: AuditSubjectType;
  subjectId: string;
  field: string;
  observedValue: string;
  verdict: string;
  evidenceId: string;
  sourceUrl: string;
  observedAt: Date;
  extractedAt: Date;
  evidenceType: string;
  isSafeSourceUrl: boolean;
  isSubjectMismatch: boolean;
}

export interface AuditEventDetailData {
  id: string;
  occurredAt: Date;
  eventType: WorkflowEventType;
  subjectType: AuditSubjectType;
  subjectId: string;
  entityLabel: string;
  entityUnavailable: boolean;
  actorName: string;
  actorKind: string;
  actorStableKey: string;
  actorId: string;
  fromReviewStatus: ReviewStatus | null;
  toReviewStatus: ReviewStatus | null;
  fromPublicationStatus: PublicationStatus | null;
  toPublicationStatus: PublicationStatus | null;
  quarantineReason: QuarantineReason | null;
  expectedVersion: number;
  resultingVersion: number;
  canonicalTargetId: string | null;
  canonicalTargetLabel: string | null;
  internalNote: string | null;
  claims: AuditEventDetailClaim[];
  reviewDetailUrl: string | null;
  quarantineDetailUrl: string | null;
}

function enumValue<T extends string>(
  value: string | undefined,
  values: readonly T[],
): T | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return values.includes(normalized as T) ? (normalized as T) : undefined;
}

export function isGovernedEntityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isSafeUrl(urlStr: string | null | undefined): boolean {
  if (!urlStr) {
    return false;
  }
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseAuditQueueFilters(input: {
  eventType?: string;
  subjectType?: string;
  actorId?: string;
  subjectId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): AuditQueueFilters {
  const eventType = enumValue(
    input.eventType,
    Object.values(WorkflowEventType),
  );
  const subjectType = enumValue(input.subjectType, AUDIT_SUBJECT_TYPES);

  const actorId =
    input.actorId && isGovernedEntityId(input.actorId)
      ? input.actorId
      : undefined;

  const subjectId =
    input.subjectId && isGovernedEntityId(input.subjectId)
      ? input.subjectId
      : undefined;

  let search = input.search ? input.search.trim() : undefined;
  if (search && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(search)) {
    search = undefined;
  }

  let dateFrom: Date | undefined = undefined;
  if (input.dateFrom) {
    const d = new Date(input.dateFrom);
    if (!isNaN(d.getTime())) {
      dateFrom = d;
    }
  }

  let dateTo: Date | undefined = undefined;
  if (input.dateTo) {
    const d = new Date(input.dateTo);
    if (!isNaN(d.getTime())) {
      dateTo = d;
    }
  }

  let isDateRangeInvalid = false;
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    isDateRangeInvalid = true;
  }

  return {
    eventType,
    subjectType,
    actorId,
    subjectId,
    search,
    dateFrom,
    dateTo,
    isDateRangeInvalid,
  };
}

export function parseAuditPagination(input: {
  page?: string | number;
  limit?: string | number;
}): AuditPaginationParams {
  let page =
    typeof input.page === "number"
      ? input.page
      : parseInt(String(input.page || 1), 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  let limit =
    typeof input.limit === "number"
      ? input.limit
      : parseInt(String(input.limit || DEFAULT_AUDIT_PAGE_SIZE), 10);
  if (isNaN(limit) || limit < 1) {
    limit = DEFAULT_AUDIT_PAGE_SIZE;
  }
  if (limit > MAX_AUDIT_PAGE_SIZE) {
    limit = MAX_AUDIT_PAGE_SIZE;
  }

  return { page, limit };
}

export interface EntityLabelMap {
  casinos: Map<
    string,
    {
      label: string;
      reviewStatus: ReviewStatus;
      publicationStatus: PublicationStatus;
      quarantineReason: QuarantineReason | null;
    }
  >;
  bonuses: Map<
    string,
    {
      label: string;
      reviewStatus: ReviewStatus;
      publicationStatus: PublicationStatus;
      quarantineReason: QuarantineReason | null;
    }
  >;
  slots: Map<
    string,
    {
      label: string;
      reviewStatus: ReviewStatus;
      publicationStatus: PublicationStatus;
      quarantineReason: QuarantineReason | null;
    }
  >;
  licenses: Map<
    string,
    {
      label: string;
      reviewStatus: ReviewStatus;
      quarantineReason: QuarantineReason | null;
    }
  >;
}

export async function resolveAuditEntityLabels(
  events: Array<{
    subject_type: GovernedSubjectType;
    casino_id: string | null;
    bonus_id: string | null;
    slot_id: string | null;
    license_id: string | null;
  }>,
  database: PrismaClient = prisma,
): Promise<EntityLabelMap> {
  const casinoIds = new Set<string>();
  const bonusIds = new Set<string>();
  const slotIds = new Set<string>();
  const licenseIds = new Set<string>();

  for (const event of events) {
    if (event.subject_type === GovernedSubjectType.CASINO && event.casino_id) {
      casinoIds.add(event.casino_id);
    } else if (
      event.subject_type === GovernedSubjectType.BONUS &&
      event.bonus_id
    ) {
      bonusIds.add(event.bonus_id);
    } else if (
      event.subject_type === GovernedSubjectType.SLOT &&
      event.slot_id
    ) {
      slotIds.add(event.slot_id);
    } else if (
      event.subject_type === GovernedSubjectType.LICENSE &&
      event.license_id
    ) {
      licenseIds.add(event.license_id);
    }
  }

  const [casinos, bonuses, slots, licenses] = await Promise.all([
    casinoIds.size > 0
      ? database.casino.findMany({
          where: { id: { in: Array.from(casinoIds) } },
          select: {
            id: true,
            name: true,
            review_status: true,
            publication_status: true,
            quarantine_reason: true,
          },
        })
      : [],
    bonusIds.size > 0
      ? database.bonus.findMany({
          where: { id: { in: Array.from(bonusIds) } },
          select: {
            id: true,
            headline_value: true,
            type: true,
            review_status: true,
            publication_status: true,
            quarantine_reason: true,
          },
        })
      : [],
    slotIds.size > 0
      ? database.slot.findMany({
          where: { id: { in: Array.from(slotIds) } },
          select: {
            id: true,
            name: true,
            review_status: true,
            publication_status: true,
            quarantine_reason: true,
          },
        })
      : [],
    licenseIds.size > 0
      ? database.license.findMany({
          where: { id: { in: Array.from(licenseIds) } },
          select: {
            id: true,
            license_no: true,
            review_status: true,
            quarantine_reason: true,
            casino: { select: { name: true } },
            regulator: { select: { name: true } },
          },
        })
      : [],
  ]);

  return {
    casinos: new Map(
      casinos.map((c) => [
        c.id,
        {
          label: c.name,
          reviewStatus: c.review_status,
          publicationStatus: c.publication_status,
          quarantineReason: c.quarantine_reason,
        },
      ]),
    ),
    bonuses: new Map(
      bonuses.map((b) => [
        b.id,
        {
          label: b.headline_value ?? `${b.type} Bonus`,
          reviewStatus: b.review_status,
          publicationStatus: b.publication_status,
          quarantineReason: b.quarantine_reason,
        },
      ]),
    ),
    slots: new Map(
      slots.map((s) => [
        s.id,
        {
          label: s.name,
          reviewStatus: s.review_status,
          publicationStatus: s.publication_status,
          quarantineReason: s.quarantine_reason,
        },
      ]),
    ),
    licenses: new Map(
      licenses.map((l) => [
        l.id,
        {
          label: `License ${l.license_no} (${l.casino.name} - ${l.regulator.name})`,
          reviewStatus: l.review_status,
          quarantineReason: l.quarantine_reason,
        },
      ]),
    ),
  };
}

export async function getAuditQueue(
  filters: AuditQueueFilters,
  pagination: AuditPaginationParams,
  database: PrismaClient = prisma,
): Promise<AuditQueueResult> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  if (filters.isDateRangeInvalid) {
    return {
      items: [],
      page,
      limit,
      totalCount: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: page > 1,
    };
  }

  const where: Prisma.WorkflowAuditEventWhereInput = {};

  if (filters.eventType) {
    where.event_type = filters.eventType;
  }

  if (filters.subjectType) {
    where.subject_type = filters.subjectType;
  }

  if (filters.actorId) {
    where.actor_id = filters.actorId;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.occurred_at = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  if (filters.subjectId) {
    where.OR = [
      { casino_id: filters.subjectId },
      { bonus_id: filters.subjectId },
      { slot_id: filters.subjectId },
      { license_id: filters.subjectId },
    ];
  } else if (filters.search) {
    const queryStr = filters.search;
    if (isGovernedEntityId(queryStr)) {
      where.OR = [
        { id: queryStr },
        { casino_id: queryStr },
        { bonus_id: queryStr },
        { slot_id: queryStr },
        { license_id: queryStr },
      ];
    } else {
      const [matchedCasinos, matchedBonuses, matchedSlots, matchedLicenses] =
        await Promise.all([
          database.casino.findMany({
            where: { name: { contains: queryStr, mode: "insensitive" } },
            select: { id: true },
            take: 50,
          }),
          database.bonus.findMany({
            where: {
              headline_value: { contains: queryStr, mode: "insensitive" },
            },
            select: { id: true },
            take: 50,
          }),
          database.slot.findMany({
            where: { name: { contains: queryStr, mode: "insensitive" } },
            select: { id: true },
            take: 50,
          }),
          database.license.findMany({
            where: {
              OR: [
                { license_no: { contains: queryStr, mode: "insensitive" } },
                {
                  normalized_license_no: {
                    contains: queryStr,
                    mode: "insensitive",
                  },
                },
              ],
            },
            select: { id: true },
            take: 50,
          }),
        ]);

      const casinoIds = matchedCasinos.map((c) => c.id);
      const bonusIds = matchedBonuses.map((b) => b.id);
      const slotIds = matchedSlots.map((s) => s.id);
      const licenseIds = matchedLicenses.map((l) => l.id);

      if (
        casinoIds.length === 0 &&
        bonusIds.length === 0 &&
        slotIds.length === 0 &&
        licenseIds.length === 0
      ) {
        return {
          items: [],
          page,
          limit,
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: page > 1,
        };
      }

      where.OR = [
        ...(casinoIds.length > 0 ? [{ casino_id: { in: casinoIds } }] : []),
        ...(bonusIds.length > 0 ? [{ bonus_id: { in: bonusIds } }] : []),
        ...(slotIds.length > 0 ? [{ slot_id: { in: slotIds } }] : []),
        ...(licenseIds.length > 0 ? [{ license_id: { in: licenseIds } }] : []),
      ];
    }
  }

  const [totalCount, rawEvents] = await Promise.all([
    database.workflowAuditEvent.count({ where }),
    database.workflowAuditEvent.findMany({
      where,
      orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      select: {
        id: true,
        occurred_at: true,
        event_type: true,
        subject_type: true,
        casino_id: true,
        bonus_id: true,
        slot_id: true,
        license_id: true,
        actor_id: true,
        from_review_status: true,
        to_review_status: true,
        from_publication_status: true,
        to_publication_status: true,
        quarantine_reason: true,
        resulting_version: true,
        internal_note: true,
        actor: {
          select: {
            id: true,
            display_name: true,
            stable_key: true,
            kind: true,
          },
        },
      },
    }),
  ]);

  const labelMaps = await resolveAuditEntityLabels(rawEvents, database);

  const items: AuditQueueItem[] = rawEvents.map((event) => {
    let subjectId = "";
    let entityLabel = "";
    let entityUnavailable = false;

    if (event.subject_type === GovernedSubjectType.CASINO) {
      subjectId = event.casino_id ?? "Unknown";
      const resolved = labelMaps.casinos.get(subjectId);
      if (resolved) {
        entityLabel = resolved.label;
      } else {
        entityLabel = `Casino ${subjectId}`;
        entityUnavailable = true;
      }
    } else if (event.subject_type === GovernedSubjectType.BONUS) {
      subjectId = event.bonus_id ?? "Unknown";
      const resolved = labelMaps.bonuses.get(subjectId);
      if (resolved) {
        entityLabel = resolved.label;
      } else {
        entityLabel = `Bonus ${subjectId}`;
        entityUnavailable = true;
      }
    } else if (event.subject_type === GovernedSubjectType.SLOT) {
      subjectId = event.slot_id ?? "Unknown";
      const resolved = labelMaps.slots.get(subjectId);
      if (resolved) {
        entityLabel = resolved.label;
      } else {
        entityLabel = `Slot ${subjectId}`;
        entityUnavailable = true;
      }
    } else {
      subjectId = event.license_id ?? "Unknown";
      const resolved = labelMaps.licenses.get(subjectId);
      if (resolved) {
        entityLabel = resolved.label;
      } else {
        entityLabel = `License ${subjectId}`;
        entityUnavailable = true;
      }
    }

    const actorName =
      event.actor?.display_name || event.actor?.stable_key || "Unknown actor";

    return {
      id: event.id,
      occurredAt: event.occurred_at,
      eventType: event.event_type,
      subjectType: event.subject_type as AuditSubjectType,
      subjectId,
      entityLabel,
      entityUnavailable,
      actorName,
      actorKind: event.actor?.kind ?? "UNKNOWN",
      actorId: event.actor_id,
      fromReviewStatus: event.from_review_status,
      toReviewStatus: event.to_review_status,
      fromPublicationStatus: event.from_publication_status,
      toPublicationStatus: event.to_publication_status,
      quarantineReason: event.quarantine_reason,
      resultingVersion: event.resulting_version,
      hasInternalNote: Boolean(event.internal_note),
      detailUrl: `/audit/${event.id}`,
      subjectDetailUrl: entityUnavailable
        ? null
        : governanceDetailUrl(event.subject_type, subjectId),
    };
  });

  const totalPages = Math.ceil(totalCount / limit);

  return {
    items,
    page,
    limit,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export async function getAuditEventDetail(
  id: string,
  database: PrismaClient = prisma,
): Promise<AuditEventDetailData | null> {
  if (!isGovernedEntityId(id)) {
    return null;
  }

  const event = await database.workflowAuditEvent.findUnique({
    where: { id },
    select: {
      id: true,
      occurred_at: true,
      event_type: true,
      subject_type: true,
      casino_id: true,
      bonus_id: true,
      slot_id: true,
      license_id: true,
      actor_id: true,
      from_review_status: true,
      to_review_status: true,
      from_publication_status: true,
      to_publication_status: true,
      quarantine_reason: true,
      expected_version: true,
      resulting_version: true,
      canonical_casino_id: true,
      canonical_bonus_id: true,
      canonical_slot_id: true,
      canonical_license_id: true,
      internal_note: true,
      actor: {
        select: {
          id: true,
          display_name: true,
          stable_key: true,
          kind: true,
        },
      },
      evidence_claims: {
        select: {
          id: true,
          casino_evidence_claim_id: true,
          bonus_evidence_claim_id: true,
          slot_evidence_claim_id: true,
          license_evidence_claim_id: true,
          casino_evidence_claim: {
            select: {
              id: true,
              casino_id: true,
              field: true,
              observed_value: true,
              verdict: true,
              evidence: {
                select: {
                  id: true,
                  source_url: true,
                  observed_at: true,
                  extracted_at: true,
                  evidence_type: true,
                },
              },
            },
          },
          bonus_evidence_claim: {
            select: {
              id: true,
              bonus_id: true,
              field: true,
              observed_value: true,
              verdict: true,
              evidence: {
                select: {
                  id: true,
                  source_url: true,
                  observed_at: true,
                  extracted_at: true,
                  evidence_type: true,
                },
              },
            },
          },
          slot_evidence_claim: {
            select: {
              id: true,
              slot_id: true,
              field: true,
              observed_value: true,
              verdict: true,
              evidence: {
                select: {
                  id: true,
                  source_url: true,
                  observed_at: true,
                  extracted_at: true,
                  evidence_type: true,
                },
              },
            },
          },
          license_evidence_claim: {
            select: {
              id: true,
              license_id: true,
              field: true,
              observed_value: true,
              verdict: true,
              evidence: {
                select: {
                  id: true,
                  source_url: true,
                  observed_at: true,
                  extracted_at: true,
                  evidence_type: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!event) {
    return null;
  }

  const labelMaps = await resolveAuditEntityLabels([event], database);

  let subjectId = "";
  let entityLabel = "";
  let entityUnavailable = false;
  let currentReviewStatus: ReviewStatus | null = null;
  let currentQuarantineReason: QuarantineReason | null = null;

  if (event.subject_type === GovernedSubjectType.CASINO) {
    subjectId = event.casino_id ?? "Unknown";
    const resolved = labelMaps.casinos.get(subjectId);
    if (resolved) {
      entityLabel = resolved.label;
      currentReviewStatus = resolved.reviewStatus;
      currentQuarantineReason = resolved.quarantineReason;
    } else {
      entityLabel = `Casino ${subjectId}`;
      entityUnavailable = true;
    }
  } else if (event.subject_type === GovernedSubjectType.BONUS) {
    subjectId = event.bonus_id ?? "Unknown";
    const resolved = labelMaps.bonuses.get(subjectId);
    if (resolved) {
      entityLabel = resolved.label;
      currentReviewStatus = resolved.reviewStatus;
      currentQuarantineReason = resolved.quarantineReason;
    } else {
      entityLabel = `Bonus ${subjectId}`;
      entityUnavailable = true;
    }
  } else if (event.subject_type === GovernedSubjectType.SLOT) {
    subjectId = event.slot_id ?? "Unknown";
    const resolved = labelMaps.slots.get(subjectId);
    if (resolved) {
      entityLabel = resolved.label;
      currentReviewStatus = resolved.reviewStatus;
      currentQuarantineReason = resolved.quarantineReason;
    } else {
      entityLabel = `Slot ${subjectId}`;
      entityUnavailable = true;
    }
  } else {
    subjectId = event.license_id ?? "Unknown";
    const resolved = labelMaps.licenses.get(subjectId);
    if (resolved) {
      entityLabel = resolved.label;
      currentReviewStatus = resolved.reviewStatus;
      currentQuarantineReason = resolved.quarantineReason;
    } else {
      entityLabel = `License ${subjectId}`;
      entityUnavailable = true;
    }
  }

  let canonicalTargetId: string | null = null;
  let canonicalTargetLabel: string | null = null;
  if (event.canonical_casino_id) {
    canonicalTargetId = event.canonical_casino_id;
    canonicalTargetLabel =
      labelMaps.casinos.get(canonicalTargetId)?.label ?? canonicalTargetId;
  } else if (event.canonical_bonus_id) {
    canonicalTargetId = event.canonical_bonus_id;
    canonicalTargetLabel =
      labelMaps.bonuses.get(canonicalTargetId)?.label ?? canonicalTargetId;
  } else if (event.canonical_slot_id) {
    canonicalTargetId = event.canonical_slot_id;
    canonicalTargetLabel =
      labelMaps.slots.get(canonicalTargetId)?.label ?? canonicalTargetId;
  } else if (event.canonical_license_id) {
    canonicalTargetId = event.canonical_license_id;
    canonicalTargetLabel =
      labelMaps.licenses.get(canonicalTargetId)?.label ?? canonicalTargetId;
  }

  const claims: AuditEventDetailClaim[] = event.evidence_claims.flatMap(
    (link): AuditEventDetailClaim[] => {
      if (
        event.subject_type === GovernedSubjectType.CASINO &&
        link.casino_evidence_claim
      ) {
        const claim = link.casino_evidence_claim;
        const isMismatch = claim.casino_id !== subjectId;
        return [
          {
            id: link.id,
            claimId: claim.id,
            subjectType: "CASINO",
            subjectId: claim.casino_id,
            field: claim.field,
            observedValue: claim.observed_value,
            verdict: claim.verdict,
            evidenceId: claim.evidence.id,
            sourceUrl: claim.evidence.source_url,
            observedAt: claim.evidence.observed_at,
            extractedAt: claim.evidence.extracted_at,
            evidenceType: claim.evidence.evidence_type,
            isSafeSourceUrl: isSafeUrl(claim.evidence.source_url),
            isSubjectMismatch: isMismatch,
          },
        ];
      }
      if (
        event.subject_type === GovernedSubjectType.BONUS &&
        link.bonus_evidence_claim
      ) {
        const claim = link.bonus_evidence_claim;
        const isMismatch = claim.bonus_id !== subjectId;
        return [
          {
            id: link.id,
            claimId: claim.id,
            subjectType: "BONUS",
            subjectId: claim.bonus_id,
            field: claim.field,
            observedValue: claim.observed_value,
            verdict: claim.verdict,
            evidenceId: claim.evidence.id,
            sourceUrl: claim.evidence.source_url,
            observedAt: claim.evidence.observed_at,
            extractedAt: claim.evidence.extracted_at,
            evidenceType: claim.evidence.evidence_type,
            isSafeSourceUrl: isSafeUrl(claim.evidence.source_url),
            isSubjectMismatch: isMismatch,
          },
        ];
      }
      if (
        event.subject_type === GovernedSubjectType.SLOT &&
        link.slot_evidence_claim
      ) {
        const claim = link.slot_evidence_claim;
        const isMismatch = claim.slot_id !== subjectId;
        return [
          {
            id: link.id,
            claimId: claim.id,
            subjectType: "SLOT",
            subjectId: claim.slot_id,
            field: claim.field,
            observedValue: claim.observed_value,
            verdict: claim.verdict,
            evidenceId: claim.evidence.id,
            sourceUrl: claim.evidence.source_url,
            observedAt: claim.evidence.observed_at,
            extractedAt: claim.evidence.extracted_at,
            evidenceType: claim.evidence.evidence_type,
            isSafeSourceUrl: isSafeUrl(claim.evidence.source_url),
            isSubjectMismatch: isMismatch,
          },
        ];
      }
      if (
        event.subject_type === GovernedSubjectType.LICENSE &&
        link.license_evidence_claim
      ) {
        const claim = link.license_evidence_claim;
        const isMismatch = claim.license_id !== subjectId;
        return [
          {
            id: link.id,
            claimId: claim.id,
            subjectType: "LICENSE",
            subjectId: claim.license_id,
            field: claim.field,
            observedValue: claim.observed_value,
            verdict: claim.verdict,
            evidenceId: claim.evidence.id,
            sourceUrl: claim.evidence.source_url,
            observedAt: claim.evidence.observed_at,
            extractedAt: claim.evidence.extracted_at,
            evidenceType: claim.evidence.evidence_type,
            isSafeSourceUrl: isSafeUrl(claim.evidence.source_url),
            isSubjectMismatch: isMismatch,
          },
        ];
      }

      return [];
    },
  );

  let reviewDetailUrl: string | null = null;
  if (!entityUnavailable) {
    if (event.subject_type === GovernedSubjectType.CASINO) {
      reviewDetailUrl = `/review/casino/${subjectId}`;
    } else if (event.subject_type === GovernedSubjectType.BONUS) {
      reviewDetailUrl = `/review/bonus/${subjectId}`;
    }
  }

  let quarantineDetailUrl: string | null = null;
  if (
    !entityUnavailable &&
    (currentReviewStatus === ReviewStatus.QUARANTINED ||
      currentQuarantineReason !== null)
  ) {
    if (event.subject_type === GovernedSubjectType.CASINO) {
      quarantineDetailUrl = `/quarantine/casino/${subjectId}`;
    } else if (event.subject_type === GovernedSubjectType.BONUS) {
      quarantineDetailUrl = `/quarantine/bonus/${subjectId}`;
    } else if (event.subject_type === GovernedSubjectType.SLOT) {
      quarantineDetailUrl = `/quarantine/slot/${subjectId}`;
    } else if (event.subject_type === GovernedSubjectType.LICENSE) {
      quarantineDetailUrl = `/quarantine/license/${subjectId}`;
    }
  }

  const actorName =
    event.actor?.display_name || event.actor?.stable_key || "Unknown actor";

  return {
    id: event.id,
    occurredAt: event.occurred_at,
    eventType: event.event_type,
    subjectType: event.subject_type as AuditSubjectType,
    subjectId,
    entityLabel,
    entityUnavailable,
    actorName,
    actorKind: event.actor?.kind ?? "UNKNOWN",
    actorStableKey: event.actor?.stable_key ?? "unknown",
    actorId: event.actor_id,
    fromReviewStatus: event.from_review_status,
    toReviewStatus: event.to_review_status,
    fromPublicationStatus: event.from_publication_status,
    toPublicationStatus: event.to_publication_status,
    quarantineReason: event.quarantine_reason,
    expectedVersion: event.expected_version,
    resultingVersion: event.resulting_version,
    canonicalTargetId,
    canonicalTargetLabel,
    internalNote: event.internal_note,
    claims,
    reviewDetailUrl,
    quarantineDetailUrl,
  };
}
