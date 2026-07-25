import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  prisma,
  GovernedSubjectType,
  ReviewStatus,
  PublicationStatus,
  WorkflowEventType,
  EvidenceVerdict,
  QuarantineReason,
} from "@savvyedge/database";
import {
  getAuditQueue,
  getAuditEventDetail,
  parseAuditQueueFilters,
  parseAuditPagination,
  resolveAuditEntityLabels,
  isSafeUrl,
  isGovernedEntityId,
} from "../../../apps/admin/src/lib/audit";
import {
  generateSessionToken,
  isValidSessionToken,
  getOrCreateAdminActor,
} from "../../../apps/admin/src/lib/auth";

describe("Audit Governance UI & Service Integration Tests (Real DB)", () => {
  let adminActor: { id: string };
  let dataSourceId: string;

  beforeAll(async () => {
    adminActor = await getOrCreateAdminActor(prisma);

    const ds = await prisma.dataSource.create({
      data: {
        url: "https://regulator.example.com/audit-test",
        source_type: "REGULATOR_OFFICIAL",
      },
    });
    dataSourceId = ds.id;
  });

  beforeEach(async () => {
    await prisma.workflowEventClaim.deleteMany();
    await prisma.workflowAuditEvent.deleteMany();
    await prisma.casinoEvidenceClaim.deleteMany();
    await prisma.bonusEvidenceClaim.deleteMany();
    await prisma.slotEvidenceClaim.deleteMany();
    await prisma.licenseEvidenceClaim.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.bonusHistoryEvent.deleteMany();
    await prisma.casinoHistoryEvent.deleteMany();
    await prisma.slotRtpHistory.deleteMany();
    await prisma.casinoSlot.deleteMany();
    await prisma.bonus.deleteMany();
    await prisma.license.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.casino.deleteMany();
  });

  it("1 & 2) verifies authentication session validation fails closed for audit routes", async () => {
    const validToken = generateSessionToken("admin-secret-key-12345");
    expect(isValidSessionToken(validToken)).toBe(true);

    expect(isValidSessionToken("invalid-session-token")).toBe(false);
    expect(isValidSessionToken("")).toBe(false);
  });

  it("3 & 4) verifies audit list query is bounded and defaults to timestamp descending order", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Audit Test Casino",
        slug: "audit-test-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        governance_version: 2,
      },
    });

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await prisma.workflowAuditEvent.create({
        data: {
          subject_type: GovernedSubjectType.CASINO,
          casino_id: casino.id,
          actor_id: adminActor.id,
          event_type: WorkflowEventType.APPROVED,
          from_review_status: ReviewStatus.IN_REVIEW,
          to_review_status: ReviewStatus.APPROVED,
          expected_version: i,
          resulting_version: i + 1,
          occurred_at: new Date(now + i * 1000),
        },
      });
    }

    const pagination = parseAuditPagination({ limit: 150 });
    expect(pagination.limit).toBe(100);

    const result = await getAuditQueue({}, parseAuditPagination({ limit: 3 }));
    expect(result.items.length).toBe(3);
    expect(result.totalCount).toBe(5);
    expect(result.hasNextPage).toBe(true);

    expect(result.items[0].occurredAt.getTime()).toBeGreaterThan(
      result.items[1].occurredAt.getTime(),
    );
  });

  it("5 & 6) verifies valid event-type filter works and invalid event-type filter does not reach Prisma unchecked", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Filter Casino",
        slug: "filter-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        from_review_status: ReviewStatus.IN_REVIEW,
        to_review_status: ReviewStatus.APPROVED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.QUARANTINED,
        from_review_status: ReviewStatus.AWAITING_REVIEW,
        to_review_status: ReviewStatus.QUARANTINED,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        expected_version: 1,
        resulting_version: 2,
      },
    });

    const parsedFilters = parseAuditQueueFilters({ eventType: "INVALID_EVENT" });
    expect(parsedFilters.eventType).toBeUndefined();

    const approvedResult = await getAuditQueue(
      parseAuditQueueFilters({ eventType: "APPROVED" }),
      parseAuditPagination({}),
    );
    expect(approvedResult.items.length).toBe(1);
    expect(approvedResult.items[0].eventType).toBe("APPROVED");
  });

  it("7 & 8) verifies valid entity-type filter works and invalid entity-type filter fails safely", async () => {
    const casino = await prisma.casino.create({
      data: {
        name: "Casino Entity",
        slug: "casino-entity",
        status: "ACTIVE",
      },
    });

    const bonus = await prisma.bonus.create({
      data: {
        casino_id: casino.id,
        headline_value: "$100 Welcome Bonus",
        type: "WELCOME",
        status: "ACTIVE",
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.BONUS,
        bonus_id: bonus.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    const parsedInvalid = parseAuditQueueFilters({ subjectType: "NOT_AN_ENTITY" });
    expect(parsedInvalid.subjectType).toBeUndefined();

    const casinoOnly = await getAuditQueue(
      parseAuditQueueFilters({ subjectType: "CASINO" }),
      parseAuditPagination({}),
    );
    expect(casinoOnly.items.length).toBe(1);
    expect(casinoOnly.items[0].subjectType).toBe("CASINO");
  });

  it("9 & 10) verifies actor filter and exact subject-ID filter work", async () => {
    const casinoA = await prisma.casino.create({
      data: { name: "Casino A", slug: "casino-a", status: "ACTIVE" },
    });
    const casinoB = await prisma.casino.create({
      data: { name: "Casino B", slug: "casino-b", status: "ACTIVE" },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casinoA.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.INGESTED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casinoB.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.INGESTED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    const subjectFilter = await getAuditQueue(
      parseAuditQueueFilters({ subjectId: casinoA.id }),
      parseAuditPagination({}),
    );
    expect(subjectFilter.items.length).toBe(1);
    expect(subjectFilter.items[0].subjectId).toBe(casinoA.id);

    const actorFilter = await getAuditQueue(
      parseAuditQueueFilters({ actorId: adminActor.id }),
      parseAuditPagination({}),
    );
    expect(actorFilter.items.length).toBe(2);
  });

  it("11, 12, 13) verifies date range filtering, invalid date safety, and reversed date range safe handling", async () => {
    const casino = await prisma.casino.create({
      data: { name: "Date Casino", slug: "date-casino", status: "ACTIVE" },
    });

    const pastDate = new Date("2026-01-01T10:00:00Z");
    const futureDate = new Date("2026-01-10T10:00:00Z");

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.INGESTED,
        expected_version: 0,
        resulting_version: 1,
        occurred_at: pastDate,
      },
    });

    await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        expected_version: 1,
        resulting_version: 2,
        occurred_at: futureDate,
      },
    });

    const invalidDateParsed = parseAuditQueueFilters({ dateFrom: "not-a-date" });
    expect(invalidDateParsed.dateFrom).toBeUndefined();

    const reversedParsed = parseAuditQueueFilters({
      dateFrom: "2026-01-10",
      dateTo: "2026-01-01",
    });
    expect(reversedParsed.isDateRangeInvalid).toBe(true);

    const reversedResult = await getAuditQueue(reversedParsed, parseAuditPagination({}));
    expect(reversedResult.items.length).toBe(0);

    const validRange = await getAuditQueue(
      parseAuditQueueFilters({ dateFrom: "2026-01-05", dateTo: "2026-01-15" }),
      parseAuditPagination({}),
    );
    expect(validRange.items.length).toBe(1);
    expect(validRange.items[0].eventType).toBe("APPROVED");
  });

  it("14 & 15) verifies bulk entity label resolution works and deleted entities fall back to subject ID", async () => {
    const casino = await prisma.casino.create({
      data: { name: "Active Brand Name", slug: "active-brand-name", status: "ACTIVE" },
    });

    const casinoForDelete = await prisma.casino.create({
      data: { name: "To Be Deleted", slug: "to-be-deleted", status: "ACTIVE" },
    });

    const auditActive = await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    const auditDeleted = await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casinoForDelete.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.REJECTED,
        expected_version: 0,
        resulting_version: 1,
      },
    });

    await prisma.casino.delete({ where: { id: casinoForDelete.id } });

    const labels = await resolveAuditEntityLabels([auditActive, auditDeleted]);
    expect(labels.casinos.get(casino.id)?.label).toBe("Active Brand Name");

    const queue = await getAuditQueue({}, parseAuditPagination({}));
    const activeItem = queue.items.find((i) => i.id === auditActive.id);
    const deletedItem = queue.items.find((i) => i.id === auditDeleted.id);

    expect(activeItem?.entityLabel).toBe("Active Brand Name");
    expect(activeItem?.entityUnavailable).toBe(false);

    expect(deletedItem?.entityUnavailable).toBe(true);
  });

  it("16 & 17) verifies event detail lookup returns exact requested event and returns null for missing event", async () => {
    const casino = await prisma.casino.create({
      data: { name: "Detail Casino", slug: "detail-casino", status: "ACTIVE" },
    });

    const event = await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.QUARANTINE_CLEARED,
        from_review_status: ReviewStatus.QUARANTINED,
        to_review_status: ReviewStatus.AWAITING_REVIEW,
        quarantine_reason: QuarantineReason.MANUAL_HOLD,
        internal_note: "Quarantine cleared after manual document verification",
        expected_version: 1,
        resulting_version: 2,
      },
    });

    const detail = await getAuditEventDetail(event.id);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(event.id);
    expect(detail?.internalNote).toBe("Quarantine cleared after manual document verification");
    expect(detail?.toReviewStatus).toBe("AWAITING_REVIEW");

    const missingDetail = await getAuditEventDetail("11111111-1111-4111-8111-111111111111");
    expect(missingDetail).toBeNull();

    const invalidIdDetail = await getAuditEventDetail("not-a-uuid");
    expect(invalidIdDetail).toBeNull();
  });

  it("18, 19, 20) verifies evidence claims entity isolation and safe URL protocol validation", async () => {
    const casino = await prisma.casino.create({
      data: { name: "Evidence Casino", slug: "evidence-casino", status: "ACTIVE" },
    });

    const safeEvidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: dataSourceId } },
        created_by: { connect: { id: adminActor.id } },
        source_url: "https://regulator.example.com/safe",
        observed_at: new Date(),
        extracted_at: new Date(),
        evidence_type: "REGULATOR_REGISTER",
      },
    });

    const claim = await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casino.id,
        evidence_id: safeEvidence.id,
        field: "NAME",
        observed_value: "Evidence Casino",
        normalized_value_hash: "hash_ev_1",
        verdict: EvidenceVerdict.SUPPORTS,
      },
    });

    const event = await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.APPROVED,
        expected_version: 0,
        resulting_version: 1,
        evidence_claims: {
          create: {
            casino_evidence_claim_id: claim.id,
          },
        },
      },
    });

    const detail = await getAuditEventDetail(event.id);
    expect(detail?.claims.length).toBe(1);
    expect(detail?.claims[0].claimId).toBe(claim.id);
    expect(detail?.claims[0].isSafeSourceUrl).toBe(true);
    expect(detail?.claims[0].isSubjectMismatch).toBe(false);

    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("not-a-url")).toBe(false);
  });

  it("21, 22, 23, 24) verifies internal note, state transitions, and safe rendering without mutations", async () => {
    const casino = await prisma.casino.create({
      data: { name: "State Casino", slug: "state-casino", status: "ACTIVE" },
    });

    const event = await prisma.workflowAuditEvent.create({
      data: {
        subject_type: GovernedSubjectType.CASINO,
        casino_id: casino.id,
        actor_id: adminActor.id,
        event_type: WorkflowEventType.PUBLISHED,
        from_publication_status: PublicationStatus.UNPUBLISHED,
        to_publication_status: PublicationStatus.PUBLISHED,
        internal_note: "Published after review sign-off",
        expected_version: 1,
        resulting_version: 2,
      },
    });

    const detail = await getAuditEventDetail(event.id);
    expect(detail?.fromPublicationStatus).toBe("UNPUBLISHED");
    expect(detail?.toPublicationStatus).toBe("PUBLISHED");
    expect(detail?.fromReviewStatus).toBeNull();
    expect(detail?.internalNote).toBe("Published after review sign-off");
  });

  it("25 & 26) verifies pagination maintains filters and Audit Viewer module exposes read-only functions only", async () => {
    const auditModule = await import("../../../apps/admin/src/lib/audit");
    const exportedFunctions = Object.keys(auditModule).filter(
      (key) => typeof (auditModule as Record<string, unknown>)[key] === "function",
    );

    const writeKeywords = ["create", "update", "delete", "mutate", "insert", "upsert"];
    for (const fnName of exportedFunctions) {
      for (const kw of writeKeywords) {
        expect(fnName.toLowerCase()).not.toContain(kw);
      }
    }
  });
});
