import {
  prisma,
  PublicationStatus,
  QuarantineReason,
  ReviewStatus,
  WorkflowEventType,
  type PrismaClient,
} from "@savvyedge/database";

export const QUARANTINE_ENTITY_TYPES = [
  "CASINO",
  "BONUS",
  "SLOT",
  "LICENSE",
] as const;

export type QuarantineEntityType = (typeof QUARANTINE_ENTITY_TYPES)[number];

export const MAX_QUEUE_CANDIDATES_PER_ENTITY = 100;
export const MAX_QUEUE_RENDERED_ITEMS = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface QuarantineQueueFilters {
  entityType?: QuarantineEntityType;
  quarantineReason?: QuarantineReason;
  reviewStatus?: ReviewStatus;
  publicationStatus?: PublicationStatus;
}

export interface QuarantineQueueItem {
  id: string;
  nameOrHeadline: string;
  entityType: QuarantineEntityType;
  quarantineReason: QuarantineReason;
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus | null;
  governanceVersion: number;
  quarantineTimestamp: Date | null;
  actorName: string;
  detailUrl: string;
}

interface QuarantineAuditEvent {
  occurred_at: Date;
  actor: { display_name: string; stable_key: string } | null;
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

export function parseQuarantineQueueFilters(input: {
  type?: string;
  reason?: string;
  status?: string;
  publication?: string;
}): QuarantineQueueFilters {
  return {
    entityType: enumValue(input.type, QUARANTINE_ENTITY_TYPES),
    quarantineReason: enumValue(
      input.reason,
      Object.values(QuarantineReason),
    ),
    reviewStatus: enumValue(input.status, Object.values(ReviewStatus)),
    publicationStatus: enumValue(
      input.publication,
      Object.values(PublicationStatus),
    ),
  };
}

export function isGovernedEntityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function quarantinedDetailWhere(id: string) {
  if (!isGovernedEntityId(id)) {
    return null;
  }
  return {
    id,
    quarantine_reason: { not: null },
  };
}

function quarantineAuditContext(events: QuarantineAuditEvent[]) {
  const event = events[0];
  return {
    quarantineTimestamp: event?.occurred_at ?? null,
    actorName:
      event?.actor?.display_name ??
      event?.actor?.stable_key ??
      "No quarantine audit event",
  };
}

function quarantineEventSelection() {
  return {
    where: { event_type: WorkflowEventType.QUARANTINED },
    orderBy: { occurred_at: "desc" as const },
    take: 1,
    select: {
      occurred_at: true,
      actor: {
        select: { display_name: true, stable_key: true },
      },
    },
  };
}

function sortQuarantineItems(
  left: QuarantineQueueItem,
  right: QuarantineQueueItem,
): number {
  if (left.quarantineTimestamp && right.quarantineTimestamp) {
    const timestampDifference =
      left.quarantineTimestamp.getTime() - right.quarantineTimestamp.getTime();
    if (timestampDifference !== 0) {
      return timestampDifference;
    }
  } else if (left.quarantineTimestamp) {
    return -1;
  } else if (right.quarantineTimestamp) {
    return 1;
  }

  const typeDifference = left.entityType.localeCompare(right.entityType);
  return typeDifference !== 0 ? typeDifference : left.id.localeCompare(right.id);
}

export async function getQuarantineQueue(
  filters: QuarantineQueueFilters,
  database: PrismaClient = prisma,
): Promise<QuarantineQueueItem[]> {
  const appliesTo = (entityType: QuarantineEntityType) =>
    !filters.entityType || filters.entityType === entityType;
  const commonWhere = {
    quarantine_reason: { not: null },
    ...(filters.quarantineReason
      ? { quarantine_reason: filters.quarantineReason }
      : {}),
    ...(filters.reviewStatus ? { review_status: filters.reviewStatus } : {}),
  };
  const publishableWhere = {
    ...commonWhere,
    ...(filters.publicationStatus
      ? { publication_status: filters.publicationStatus }
      : {}),
  };

  const [casinos, bonuses, slots, licenses] = await Promise.all([
    appliesTo("CASINO")
      ? database.casino.findMany({
          where: publishableWhere,
          take: MAX_QUEUE_CANDIDATES_PER_ENTITY,
          select: {
            id: true,
            name: true,
            quarantine_reason: true,
            review_status: true,
            publication_status: true,
            governance_version: true,
            workflow_events: quarantineEventSelection(),
          },
        })
      : [],
    appliesTo("BONUS")
      ? database.bonus.findMany({
          where: publishableWhere,
          take: MAX_QUEUE_CANDIDATES_PER_ENTITY,
          select: {
            id: true,
            headline_value: true,
            type: true,
            quarantine_reason: true,
            review_status: true,
            publication_status: true,
            governance_version: true,
            workflow_events: quarantineEventSelection(),
          },
        })
      : [],
    appliesTo("SLOT")
      ? database.slot.findMany({
          where: publishableWhere,
          take: MAX_QUEUE_CANDIDATES_PER_ENTITY,
          select: {
            id: true,
            name: true,
            quarantine_reason: true,
            review_status: true,
            publication_status: true,
            governance_version: true,
            workflow_events: quarantineEventSelection(),
          },
        })
      : [],
    appliesTo("LICENSE") && !filters.publicationStatus
      ? database.license.findMany({
          where: commonWhere,
          take: MAX_QUEUE_CANDIDATES_PER_ENTITY,
          select: {
            id: true,
            license_no: true,
            quarantine_reason: true,
            review_status: true,
            governance_version: true,
            workflow_events: quarantineEventSelection(),
          },
        })
      : [],
  ]);

  const items: QuarantineQueueItem[] = [
    ...casinos.flatMap((casino) => {
      if (!casino.quarantine_reason) return [];
      return [
        {
          id: casino.id,
          nameOrHeadline: casino.name,
          entityType: "CASINO" as const,
          quarantineReason: casino.quarantine_reason,
          reviewStatus: casino.review_status,
          publicationStatus: casino.publication_status,
          governanceVersion: casino.governance_version,
          ...quarantineAuditContext(casino.workflow_events),
          detailUrl: `/quarantine/casino/${casino.id}`,
        },
      ];
    }),
    ...bonuses.flatMap((bonus) => {
      if (!bonus.quarantine_reason) return [];
      return [
        {
          id: bonus.id,
          nameOrHeadline: bonus.headline_value ?? `${bonus.type} Bonus`,
          entityType: "BONUS" as const,
          quarantineReason: bonus.quarantine_reason,
          reviewStatus: bonus.review_status,
          publicationStatus: bonus.publication_status,
          governanceVersion: bonus.governance_version,
          ...quarantineAuditContext(bonus.workflow_events),
          detailUrl: `/quarantine/bonus/${bonus.id}`,
        },
      ];
    }),
    ...slots.flatMap((slot) => {
      if (!slot.quarantine_reason) return [];
      return [
        {
          id: slot.id,
          nameOrHeadline: slot.name,
          entityType: "SLOT" as const,
          quarantineReason: slot.quarantine_reason,
          reviewStatus: slot.review_status,
          publicationStatus: slot.publication_status,
          governanceVersion: slot.governance_version,
          ...quarantineAuditContext(slot.workflow_events),
          detailUrl: `/quarantine/slot/${slot.id}`,
        },
      ];
    }),
    ...licenses.flatMap((license) => {
      if (!license.quarantine_reason) return [];
      return [
        {
          id: license.id,
          nameOrHeadline: `License ${license.license_no}`,
          entityType: "LICENSE" as const,
          quarantineReason: license.quarantine_reason,
          reviewStatus: license.review_status,
          publicationStatus: null,
          governanceVersion: license.governance_version,
          ...quarantineAuditContext(license.workflow_events),
          detailUrl: `/quarantine/license/${license.id}`,
        },
      ];
    }),
  ];

  return items.sort(sortQuarantineItems).slice(0, MAX_QUEUE_RENDERED_ITEMS);
}
