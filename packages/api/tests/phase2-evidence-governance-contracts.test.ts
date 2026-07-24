import { describe, expect, it } from "vitest";
import {
  ActorKind as PrismaActorKind,
  BonusEvidenceField as PrismaBonusEvidenceField,
  CasinoEvidenceField as PrismaCasinoEvidenceField,
  EvidenceType as PrismaEvidenceType,
  EvidenceVerdict as PrismaEvidenceVerdict,
  GovernedSubjectType as PrismaGovernedSubjectType,
  LicenseEvidenceField as PrismaLicenseEvidenceField,
  PublicationStatus as PrismaPublicationStatus,
  QuarantineReason as PrismaQuarantineReason,
  ReviewStatus as PrismaReviewStatus,
  SlotEvidenceField as PrismaSlotEvidenceField,
  WorkflowEventType as PrismaWorkflowEventType,
} from "@savvyedge/database";
import * as publicContracts from "@savvyedge/types";
import {
  ActorKindSchema,
  ActorKindValues,
  BonusEvidenceClaimSchema,
  BonusEvidenceFieldSchema,
  BonusEvidenceFieldValues,
  BonusGovernanceStateSchema,
  BonusSchema,
  CasinoDomainSchema,
  CasinoEvidenceClaimSchema,
  CasinoEvidenceFieldSchema,
  CasinoEvidenceFieldValues,
  CasinoGovernanceStateSchema,
  CasinoSchema,
  CreateBonusEvidenceClaimInputSchema,
  CreateCasinoDomainCandidateInputSchema,
  CreateCasinoEvidenceClaimInputSchema,
  CreateEvidenceRecordInputSchema,
  CreateLicenseEvidenceClaimInputSchema,
  CreateReviewActorInputSchema,
  CreateSlotEvidenceClaimInputSchema,
  EvidenceRecordSchema,
  EvidenceTypeSchema,
  EvidenceTypeValues,
  EvidenceVerdictSchema,
  EvidenceVerdictValues,
  GovernedSubjectTypeSchema,
  GovernedSubjectTypeValues,
  LicenseEvidenceClaimSchema,
  LicenseEvidenceFieldSchema,
  LicenseEvidenceFieldValues,
  LicenseGovernanceStateSchema,
  PublicationStatusSchema,
  PublicationStatusValues,
  QuarantineReasonSchema,
  QuarantineReasonValues,
  ReviewActorSchema,
  ReviewStatusSchema,
  ReviewStatusValues,
  SlotEvidenceClaimSchema,
  SlotEvidenceFieldSchema,
  SlotEvidenceFieldValues,
  SlotGovernanceStateSchema,
  WorkflowAuditEventSchema,
  WorkflowEventClaimSchema,
  WorkflowEventTypeSchema,
  WorkflowEventTypeValues,
} from "@savvyedge/types";

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  evidence: "22222222-2222-4222-8222-222222222222",
  dataSource: "33333333-3333-4333-8333-333333333333",
  scrapeJob: "44444444-4444-4444-8444-444444444444",
  casino: "55555555-5555-4555-8555-555555555555",
  bonus: "66666666-6666-4666-8666-666666666666",
  slot: "77777777-7777-4777-8777-777777777777",
  license: "88888888-8888-4888-8888-888888888888",
  claim: "99999999-9999-4999-8999-999999999999",
  workflowEvent: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workflowClaim: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  domain: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const now = new Date("2026-07-24T00:00:00.000Z");
const sha256 = "a".repeat(64);

const validActor = {
  id: ids.actor,
  kind: "HUMAN",
  stable_key: "human:reviewer",
  display_name: "Review Operator",
  external_subject: null,
  active: true,
  created_at: now,
} as const;

const validCreateActor = {
  kind: "SERVICE",
  stable_key: "service:ingestion",
  display_name: "Ingestion Service",
  external_subject: null,
} as const;

const validEvidence = {
  id: ids.evidence,
  data_source_id: ids.dataSource,
  scrape_job_id: ids.scrapeJob,
  evidence_type: "OPERATOR_PAGE",
  source_url: "https://casino.example/terms",
  snapshot_path: "/snapshots/casino-terms.html",
  html_hash: sha256,
  content_hash: sha256.toUpperCase(),
  extraction_key: null,
  observed_at: now,
  extracted_at: now,
  valid_from: null,
  expires_at: null,
  created_by_id: ids.actor,
  created_at: now,
} as const;

const validCreateEvidence = {
  data_source_id: ids.dataSource,
  scrape_job_id: null,
  evidence_type: "REGULATOR_REGISTER",
  source_url: "https://regulator.example/license/123",
  snapshot_path: null,
  html_hash: sha256,
  content_hash: null,
  extraction_key: null,
  observed_at: now,
  extracted_at: now,
  valid_from: null,
  expires_at: null,
  created_by_id: ids.actor,
} as const;

const claimReadBase = {
  id: ids.claim,
  evidence_id: ids.evidence,
  observed_value: "Observed value",
  normalized_value_hash: "normalizer-v1:value",
  verdict: "SUPPORTS",
  created_at: now,
} as const;

const claimCreateBase = {
  evidence_id: ids.evidence,
  observed_value: "Observed value",
  normalized_value_hash: "normalizer-v1:value",
  verdict: "SUPPORTS",
} as const;

const validCasinoClaim = {
  ...claimReadBase,
  casino_id: ids.casino,
  field: "WEBSITE_HOST",
} as const;

const validBonusClaim = {
  ...claimReadBase,
  bonus_id: ids.bonus,
  field: "HEADLINE_VALUE",
} as const;

const validSlotClaim = {
  ...claimReadBase,
  slot_id: ids.slot,
  field: "RTP",
} as const;

const validLicenseClaim = {
  ...claimReadBase,
  license_id: ids.license,
  field: "LICENSE_NUMBER",
} as const;

const validWorkflowEvent = {
  id: ids.workflowEvent,
  subject_type: "CASINO",
  casino_id: ids.casino,
  bonus_id: null,
  slot_id: null,
  license_id: null,
  actor_id: ids.actor,
  event_type: "REVIEW_STARTED",
  from_review_status: "AWAITING_REVIEW",
  to_review_status: "IN_REVIEW",
  from_publication_status: "UNPUBLISHED",
  to_publication_status: "UNPUBLISHED",
  quarantine_reason: null,
  expected_version: 0,
  internal_note: null,
  occurred_at: now,
} as const;

const validWorkflowClaim = {
  id: ids.workflowClaim,
  workflow_event_id: ids.workflowEvent,
  casino_evidence_claim_id: ids.claim,
  bonus_evidence_claim_id: null,
  slot_evidence_claim_id: null,
  license_evidence_claim_id: null,
} as const;

describe("Phase 2.1B enum contracts", () => {
  const parityCases = [
    ["ReviewStatus", ReviewStatusValues, Object.values(PrismaReviewStatus)],
    [
      "PublicationStatus",
      PublicationStatusValues,
      Object.values(PrismaPublicationStatus),
    ],
    ["ActorKind", ActorKindValues, Object.values(PrismaActorKind)],
    ["EvidenceType", EvidenceTypeValues, Object.values(PrismaEvidenceType)],
    [
      "EvidenceVerdict",
      EvidenceVerdictValues,
      Object.values(PrismaEvidenceVerdict),
    ],
    [
      "QuarantineReason",
      QuarantineReasonValues,
      Object.values(PrismaQuarantineReason),
    ],
    [
      "WorkflowEventType",
      WorkflowEventTypeValues,
      Object.values(PrismaWorkflowEventType),
    ],
    [
      "GovernedSubjectType",
      GovernedSubjectTypeValues,
      Object.values(PrismaGovernedSubjectType),
    ],
    [
      "CasinoEvidenceField",
      CasinoEvidenceFieldValues,
      Object.values(PrismaCasinoEvidenceField),
    ],
    [
      "BonusEvidenceField",
      BonusEvidenceFieldValues,
      Object.values(PrismaBonusEvidenceField),
    ],
    [
      "SlotEvidenceField",
      SlotEvidenceFieldValues,
      Object.values(PrismaSlotEvidenceField),
    ],
    [
      "LicenseEvidenceField",
      LicenseEvidenceFieldValues,
      Object.values(PrismaLicenseEvidenceField),
    ],
  ] as const;

  it.each(parityCases)(
    "%s matches the generated Prisma enum",
    (_name, contractValues, prismaValues) => {
      expect([...contractValues].sort()).toEqual([...prismaValues].sort());
    },
  );

  const enumSchemas = [
    ["ReviewStatus", ReviewStatusSchema],
    ["PublicationStatus", PublicationStatusSchema],
    ["ActorKind", ActorKindSchema],
    ["EvidenceType", EvidenceTypeSchema],
    ["EvidenceVerdict", EvidenceVerdictSchema],
    ["QuarantineReason", QuarantineReasonSchema],
    ["WorkflowEventType", WorkflowEventTypeSchema],
    ["GovernedSubjectType", GovernedSubjectTypeSchema],
    ["CasinoEvidenceField", CasinoEvidenceFieldSchema],
    ["BonusEvidenceField", BonusEvidenceFieldSchema],
    ["SlotEvidenceField", SlotEvidenceFieldSchema],
    ["LicenseEvidenceField", LicenseEvidenceFieldSchema],
  ] as const;

  it.each(enumSchemas)("%s rejects unknown values", (_name, schema) => {
    expect(schema.safeParse("NOT_A_REAL_VALUE").success).toBe(false);
  });
});

describe("Phase 2.1B persisted and create contracts", () => {
  const representativeReadContracts = [
    ["ReviewActor", ReviewActorSchema, validActor],
    ["EvidenceRecord", EvidenceRecordSchema, validEvidence],
    ["CasinoEvidenceClaim", CasinoEvidenceClaimSchema, validCasinoClaim],
    ["BonusEvidenceClaim", BonusEvidenceClaimSchema, validBonusClaim],
    ["SlotEvidenceClaim", SlotEvidenceClaimSchema, validSlotClaim],
    ["LicenseEvidenceClaim", LicenseEvidenceClaimSchema, validLicenseClaim],
    ["WorkflowAuditEvent", WorkflowAuditEventSchema, validWorkflowEvent],
    ["WorkflowEventClaim", WorkflowEventClaimSchema, validWorkflowClaim],
    [
      "CasinoGovernanceState",
      CasinoGovernanceStateSchema,
      {
        id: ids.casino,
        review_status: "NEW",
        publication_status: "UNPUBLISHED",
        quarantine_reason: null,
        governance_version: 0,
        duplicate_of_id: null,
      },
    ],
    [
      "BonusGovernanceState",
      BonusGovernanceStateSchema,
      {
        id: ids.bonus,
        review_status: "APPROVED",
        publication_status: "PUBLISHED",
        quarantine_reason: null,
        governance_version: 4,
        duplicate_of_id: null,
      },
    ],
    [
      "SlotGovernanceState",
      SlotGovernanceStateSchema,
      {
        id: ids.slot,
        review_status: "QUARANTINED",
        publication_status: "WITHDRAWN",
        quarantine_reason: "CONFLICTING_EVIDENCE",
        governance_version: 2,
        duplicate_of_id: null,
      },
    ],
    [
      "LicenseGovernanceState",
      LicenseGovernanceStateSchema,
      {
        id: ids.license,
        review_status: "AWAITING_REVIEW",
        quarantine_reason: null,
        governance_version: 1,
        duplicate_of_id: null,
      },
    ],
    [
      "CasinoDomain",
      CasinoDomainSchema,
      {
        id: ids.domain,
        casino_id: ids.casino,
        normalized_host: "casino.example",
        evidence_claim_id: null,
        created_at: now,
      },
    ],
  ] as const;

  it.each(representativeReadContracts)(
    "%s accepts a representative Prisma-shaped record",
    (_name, schema, record) => {
      expect(schema.safeParse(record).success).toBe(true);
    },
  );

  const representativeCreateContracts = [
    ["CreateReviewActorInput", CreateReviewActorInputSchema, validCreateActor],
    [
      "CreateEvidenceRecordInput",
      CreateEvidenceRecordInputSchema,
      validCreateEvidence,
    ],
    [
      "CreateCasinoEvidenceClaimInput",
      CreateCasinoEvidenceClaimInputSchema,
      { ...claimCreateBase, casino_id: ids.casino, field: "NAME" },
    ],
    [
      "CreateBonusEvidenceClaimInput",
      CreateBonusEvidenceClaimInputSchema,
      { ...claimCreateBase, bonus_id: ids.bonus, field: "TYPE" },
    ],
    [
      "CreateSlotEvidenceClaimInput",
      CreateSlotEvidenceClaimInputSchema,
      { ...claimCreateBase, slot_id: ids.slot, field: "PROVIDER" },
    ],
    [
      "CreateLicenseEvidenceClaimInput",
      CreateLicenseEvidenceClaimInputSchema,
      { ...claimCreateBase, license_id: ids.license, field: "STATUS" },
    ],
    [
      "CreateCasinoDomainCandidateInput",
      CreateCasinoDomainCandidateInputSchema,
      {
        casino_id: ids.casino,
        normalized_host: "candidate.example",
        evidence_claim_id: null,
      },
    ],
  ] as const;

  it.each(representativeCreateContracts)(
    "%s accepts a representative input",
    (_name, schema, input) => {
      expect(schema.safeParse(input).success).toBe(true);
    },
  );

  it("rejects evidence fields belonging to another subject type", () => {
    expect(
      CasinoEvidenceClaimSchema.safeParse({
        ...validCasinoClaim,
        field: "HEADLINE_VALUE",
      }).success,
    ).toBe(false);
    expect(
      BonusEvidenceClaimSchema.safeParse({ ...validBonusClaim, field: "RTP" })
        .success,
    ).toBe(false);
    expect(
      SlotEvidenceClaimSchema.safeParse({
        ...validSlotClaim,
        field: "LICENSE_NUMBER",
      }).success,
    ).toBe(false);
    expect(
      LicenseEvidenceClaimSchema.safeParse({
        ...validLicenseClaim,
        field: "WEBSITE_HOST",
      }).success,
    ).toBe(false);
  });

  it("requires actor, source, creator, and evidence identifiers", () => {
    const { stable_key: _stableKey, ...actorWithoutStableKey } =
      validCreateActor;
    const { data_source_id: _dataSourceId, ...evidenceWithoutSource } =
      validCreateEvidence;
    const { created_by_id: _createdById, ...evidenceWithoutActor } =
      validCreateEvidence;
    const { evidence_id: _evidenceId, ...claimWithoutEvidence } =
      claimCreateBase;

    expect(
      CreateReviewActorInputSchema.safeParse(actorWithoutStableKey).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse(evidenceWithoutSource).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse(evidenceWithoutActor).success,
    ).toBe(false);
    expect(
      CreateCasinoEvidenceClaimInputSchema.safeParse({
        ...claimWithoutEvidence,
        casino_id: ids.casino,
        field: "NAME",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid source URLs and malformed SHA-256 hashes", () => {
    expect(
      CreateEvidenceRecordInputSchema.safeParse({
        ...validCreateEvidence,
        source_url: "not-a-url",
      }).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse({
        ...validCreateEvidence,
        source_url: "ftp://casino.example/terms",
      }).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse({
        ...validCreateEvidence,
        html_hash: "a".repeat(63),
      }).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse({
        ...validCreateEvidence,
        content_hash: "g".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("models nullable database fields as present-and-null on persisted records", () => {
    expect(
      EvidenceRecordSchema.safeParse({
        ...validEvidence,
        scrape_job_id: null,
        snapshot_path: null,
        html_hash: null,
        content_hash: null,
        extraction_key: null,
        valid_from: null,
        expires_at: null,
      }).success,
    ).toBe(true);

    const {
      snapshot_path: _snapshotPath,
      ...evidenceMissingPersistedNullableField
    } = validEvidence;
    expect(
      EvidenceRecordSchema.safeParse(evidenceMissingPersistedNullableField)
        .success,
    ).toBe(false);
    expect(
      ReviewActorSchema.safeParse({ ...validActor, external_subject: null })
        .success,
    ).toBe(true);
    expect(
      CasinoDomainSchema.safeParse({
        ...representativeReadContracts[12][2],
        evidence_claim_id: null,
      }).success,
    ).toBe(true);
    expect(
      CasinoEvidenceClaimSchema.safeParse({
        ...validCasinoClaim,
        observed_value: null,
      }).success,
    ).toBe(false);
  });

  it("allows nullable create fields to be omitted but requires explicit extraction timestamps", () => {
    const minimalCreateEvidence = {
      data_source_id: ids.dataSource,
      evidence_type: "OPERATOR_PAGE",
      source_url: "https://casino.example/terms",
      observed_at: now,
      extracted_at: now,
      created_by_id: ids.actor,
    };
    expect(
      CreateEvidenceRecordInputSchema.safeParse(minimalCreateEvidence).success,
    ).toBe(true);

    const { extracted_at: _extractedAt, ...withoutExtractionTimestamp } =
      minimalCreateEvidence;
    expect(
      CreateEvidenceRecordInputSchema.safeParse(withoutExtractionTimestamp)
        .success,
    ).toBe(false);
    expect(
      EvidenceRecordSchema.safeParse({
        ...validEvidence,
        observed_at: now.toISOString(),
      }).success,
    ).toBe(false);
  });

  it("rejects database-generated IDs and timestamps in create contracts", () => {
    expect(
      CreateReviewActorInputSchema.safeParse({
        ...validCreateActor,
        id: ids.actor,
      }).success,
    ).toBe(false);
    expect(
      CreateReviewActorInputSchema.safeParse({
        ...validCreateActor,
        created_at: now,
      }).success,
    ).toBe(false);
    expect(
      CreateEvidenceRecordInputSchema.safeParse({
        ...validCreateEvidence,
        id: ids.evidence,
      }).success,
    ).toBe(false);
    expect(
      CreateCasinoEvidenceClaimInputSchema.safeParse({
        ...claimCreateBase,
        casino_id: ids.casino,
        field: "NAME",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(
      CreateCasinoDomainCandidateInputSchema.safeParse({
        casino_id: ids.casino,
        normalized_host: "casino.example",
        id: ids.domain,
      }).success,
    ).toBe(false);
  });

  it("validates normalized hosts without granting approval semantics", () => {
    expect(
      CreateCasinoDomainCandidateInputSchema.safeParse({
        casino_id: ids.casino,
        normalized_host: "Casino.Example",
      }).success,
    ).toBe(false);
    expect(
      CreateCasinoDomainCandidateInputSchema.safeParse({
        casino_id: ids.casino,
        normalized_host: "https://casino.example/path",
      }).success,
    ).toBe(false);
  });
});

describe("Phase 2.1B public package boundary", () => {
  it("exports the contracts from @savvyedge/types without an arbitrary workflow mutation schema", () => {
    expect(publicContracts.WorkflowAuditEventSchema).toBe(
      WorkflowAuditEventSchema,
    );
    expect(publicContracts.WorkflowEventClaimSchema).toBe(
      WorkflowEventClaimSchema,
    );
    expect(publicContracts).not.toHaveProperty(
      "CreateWorkflowAuditEventInputSchema",
    );
    expect(publicContracts).not.toHaveProperty(
      "CreateWorkflowEventClaimInputSchema",
    );
  });

  it("does not change existing shared schema behavior", () => {
    expect(
      CasinoSchema.safeParse({
        id: ids.casino,
        slug: "existing-casino",
        name: "Existing Casino",
        license_info: null,
        status: "ACTIVE",
        website_url: null,
        created_at: now,
        updated_at: now,
        verified_at: null,
      }).success,
    ).toBe(true);

    expect(
      BonusSchema.safeParse({
        id: ids.bonus,
        casino_id: ids.casino,
        type: "WELCOME",
        headline_value: null,
        wagering_requirement: null,
        max_conversion: null,
        true_value_score: null,
        valid_from: null,
        valid_until: null,
        status: "ACTIVE",
      }).success,
    ).toBe(true);
  });
});
