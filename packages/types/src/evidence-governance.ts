import { z } from "zod";

export const ReviewStatusValues = [
  "NEW",
  "AWAITING_REVIEW",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "QUARANTINED",
  "SUPERSEDED",
] as const;
export const ReviewStatusSchema = z.enum(ReviewStatusValues);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const PublicationStatusValues = [
  "UNPUBLISHED",
  "PUBLISHED",
  "WITHDRAWN",
] as const;
export const PublicationStatusSchema = z.enum(PublicationStatusValues);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const ActorKindValues = [
  "HUMAN",
  "SERVICE",
  "SYSTEM",
  "MIGRATION",
] as const;
export const ActorKindSchema = z.enum(ActorKindValues);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const EvidenceTypeValues = [
  "OPERATOR_PAGE",
  "REGULATOR_REGISTER",
  "PROVIDER_PAGE",
  "TEST_LAB_REPORT",
  "FIRST_PARTY_API",
  "LEGACY_HISTORY_PROXY",
] as const;
export const EvidenceTypeSchema = z.enum(EvidenceTypeValues);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceVerdictValues = [
  "SUPPORTS",
  "CONTRADICTS",
  "INCONCLUSIVE",
] as const;
export const EvidenceVerdictSchema = z.enum(EvidenceVerdictValues);
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

export const QuarantineReasonValues = [
  "DEV_MOCK",
  "AGGREGATOR_IDENTITY",
  "UNKNOWN_SOURCE",
  "INVALID_IDENTITY",
  "DUPLICATE",
  "CONFLICTING_EVIDENCE",
  "EXPIRED_EVIDENCE",
  "UNVERIFIED_LICENSE",
  "MANUAL_HOLD",
] as const;
export const QuarantineReasonSchema = z.enum(QuarantineReasonValues);
export type QuarantineReason = z.infer<typeof QuarantineReasonSchema>;

export const WorkflowEventTypeValues = [
  "INGESTED",
  "REVIEW_REQUESTED",
  "REVIEW_STARTED",
  "APPROVED",
  "REJECTED",
  "QUARANTINED",
  "QUARANTINE_CLEARED",
  "MATERIAL_CHANGE_DETECTED",
  "PUBLISHED",
  "UNPUBLISHED",
  "WITHDRAWN",
  "SUPERSEDED",
  "MERGED",
] as const;
export const WorkflowEventTypeSchema = z.enum(WorkflowEventTypeValues);
export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>;

export const GovernedSubjectTypeValues = [
  "CASINO",
  "BONUS",
  "SLOT",
  "LICENSE",
] as const;
export const GovernedSubjectTypeSchema = z.enum(GovernedSubjectTypeValues);
export type GovernedSubjectType = z.infer<typeof GovernedSubjectTypeSchema>;

export const CasinoEvidenceFieldValues = [
  "NAME",
  "WEBSITE_HOST",
  "LICENSE_ASSOCIATION",
] as const;
export const CasinoEvidenceFieldSchema = z.enum(CasinoEvidenceFieldValues);
export type CasinoEvidenceField = z.infer<typeof CasinoEvidenceFieldSchema>;

export const BonusEvidenceFieldValues = [
  "TYPE",
  "HEADLINE_VALUE",
  "WAGERING_REQUIREMENT",
  "MAX_CONVERSION",
  "VALID_FROM",
  "VALID_UNTIL",
] as const;
export const BonusEvidenceFieldSchema = z.enum(BonusEvidenceFieldValues);
export type BonusEvidenceField = z.infer<typeof BonusEvidenceFieldSchema>;

export const SlotEvidenceFieldValues = [
  "NAME",
  "PROVIDER",
  "RTP",
  "VOLATILITY",
  "MAX_WIN",
  "RELEASE_DATE",
  "CASINO_AVAILABILITY",
] as const;
export const SlotEvidenceFieldSchema = z.enum(SlotEvidenceFieldValues);
export type SlotEvidenceField = z.infer<typeof SlotEvidenceFieldSchema>;

export const LicenseEvidenceFieldValues = [
  "LICENSE_NUMBER",
  "STATUS",
  "REGULATOR",
  "CASINO_ASSOCIATION",
  "VALID_UNTIL",
] as const;
export const LicenseEvidenceFieldSchema = z.enum(LicenseEvidenceFieldValues);
export type LicenseEvidenceField = z.infer<typeof LicenseEvidenceFieldSchema>;

export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "Expected a 64-character hexadecimal SHA-256 hash");

export const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Expected an HTTP or HTTPS URL" },
  );

export const NormalizedHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => value === value.trim().toLowerCase(), {
    message: "Expected a trimmed, lowercase host",
  })
  .refine(
    (value) =>
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        value,
      ),
    { message: "Expected a host without a protocol, path, query, or port" },
  );

const DatabaseIdSchema = z.string().uuid();
const OptionalNullableDatabaseIdSchema = DatabaseIdSchema.nullable().optional();
const OptionalNullableStringSchema = z.string().nullable().optional();
const NullableReviewStatusSchema = ReviewStatusSchema.nullable();
const NullablePublicationStatusSchema = PublicationStatusSchema.nullable();
const NullableQuarantineReasonSchema = QuarantineReasonSchema.nullable();

export const ReviewActorSchema = z
  .object({
    id: DatabaseIdSchema,
    kind: ActorKindSchema,
    stable_key: z.string().min(1),
    display_name: z.string().min(1),
    external_subject: z.string().min(1).nullable(),
    active: z.boolean(),
    created_at: z.date(),
  })
  .strict();
export type ReviewActor = z.infer<typeof ReviewActorSchema>;

export const CreateReviewActorInputSchema = z
  .object({
    kind: ActorKindSchema,
    stable_key: z.string().min(1),
    display_name: z.string().min(1),
    external_subject: z.string().min(1).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type CreateReviewActorInput = z.infer<
  typeof CreateReviewActorInputSchema
>;

export const EvidenceRecordSchema = z
  .object({
    id: DatabaseIdSchema,
    data_source_id: DatabaseIdSchema,
    scrape_job_id: DatabaseIdSchema.nullable(),
    evidence_type: EvidenceTypeSchema,
    source_url: HttpUrlSchema,
    snapshot_path: z.string().nullable(),
    html_hash: Sha256HexSchema.nullable(),
    content_hash: Sha256HexSchema.nullable(),
    extraction_key: z.string().nullable(),
    observed_at: z.date(),
    extracted_at: z.date(),
    valid_from: z.date().nullable(),
    expires_at: z.date().nullable(),
    created_by_id: DatabaseIdSchema,
    created_at: z.date(),
  })
  .strict();
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const CreateEvidenceRecordInputSchema = z
  .object({
    data_source_id: DatabaseIdSchema,
    scrape_job_id: OptionalNullableDatabaseIdSchema,
    evidence_type: EvidenceTypeSchema,
    source_url: HttpUrlSchema,
    snapshot_path: OptionalNullableStringSchema,
    html_hash: Sha256HexSchema.nullable().optional(),
    content_hash: Sha256HexSchema.nullable().optional(),
    extraction_key: OptionalNullableStringSchema,
    observed_at: z.date(),
    extracted_at: z.date(),
    valid_from: z.date().nullable().optional(),
    expires_at: z.date().nullable().optional(),
    created_by_id: DatabaseIdSchema,
  })
  .strict();
export type CreateEvidenceRecordInput = z.infer<
  typeof CreateEvidenceRecordInputSchema
>;

const EvidenceClaimReadFields = {
  id: DatabaseIdSchema,
  evidence_id: DatabaseIdSchema,
  observed_value: z.string(),
  normalized_value_hash: z.string(),
  verdict: EvidenceVerdictSchema,
  created_at: z.date(),
} as const;

const EvidenceClaimCreateFields = {
  evidence_id: DatabaseIdSchema,
  observed_value: z.string(),
  normalized_value_hash: z.string(),
  verdict: EvidenceVerdictSchema,
} as const;

export const CasinoEvidenceClaimSchema = z
  .object({
    ...EvidenceClaimReadFields,
    casino_id: DatabaseIdSchema,
    field: CasinoEvidenceFieldSchema,
  })
  .strict();
export type CasinoEvidenceClaim = z.infer<typeof CasinoEvidenceClaimSchema>;

export const CreateCasinoEvidenceClaimInputSchema = z
  .object({
    ...EvidenceClaimCreateFields,
    casino_id: DatabaseIdSchema,
    field: CasinoEvidenceFieldSchema,
  })
  .strict();
export type CreateCasinoEvidenceClaimInput = z.infer<
  typeof CreateCasinoEvidenceClaimInputSchema
>;

export const BonusEvidenceClaimSchema = z
  .object({
    ...EvidenceClaimReadFields,
    bonus_id: DatabaseIdSchema,
    field: BonusEvidenceFieldSchema,
  })
  .strict();
export type BonusEvidenceClaim = z.infer<typeof BonusEvidenceClaimSchema>;

export const CreateBonusEvidenceClaimInputSchema = z
  .object({
    ...EvidenceClaimCreateFields,
    bonus_id: DatabaseIdSchema,
    field: BonusEvidenceFieldSchema,
  })
  .strict();
export type CreateBonusEvidenceClaimInput = z.infer<
  typeof CreateBonusEvidenceClaimInputSchema
>;

export const SlotEvidenceClaimSchema = z
  .object({
    ...EvidenceClaimReadFields,
    slot_id: DatabaseIdSchema,
    field: SlotEvidenceFieldSchema,
  })
  .strict();
export type SlotEvidenceClaim = z.infer<typeof SlotEvidenceClaimSchema>;

export const CreateSlotEvidenceClaimInputSchema = z
  .object({
    ...EvidenceClaimCreateFields,
    slot_id: DatabaseIdSchema,
    field: SlotEvidenceFieldSchema,
  })
  .strict();
export type CreateSlotEvidenceClaimInput = z.infer<
  typeof CreateSlotEvidenceClaimInputSchema
>;

export const LicenseEvidenceClaimSchema = z
  .object({
    ...EvidenceClaimReadFields,
    license_id: DatabaseIdSchema,
    field: LicenseEvidenceFieldSchema,
  })
  .strict();
export type LicenseEvidenceClaim = z.infer<typeof LicenseEvidenceClaimSchema>;

export const CreateLicenseEvidenceClaimInputSchema = z
  .object({
    ...EvidenceClaimCreateFields,
    license_id: DatabaseIdSchema,
    field: LicenseEvidenceFieldSchema,
  })
  .strict();
export type CreateLicenseEvidenceClaimInput = z.infer<
  typeof CreateLicenseEvidenceClaimInputSchema
>;

export const WorkflowAuditEventSchema = z
  .object({
    id: DatabaseIdSchema,
    subject_type: GovernedSubjectTypeSchema,
    casino_id: DatabaseIdSchema.nullable(),
    bonus_id: DatabaseIdSchema.nullable(),
    slot_id: DatabaseIdSchema.nullable(),
    license_id: DatabaseIdSchema.nullable(),
    actor_id: DatabaseIdSchema,
    event_type: WorkflowEventTypeSchema,
    from_review_status: NullableReviewStatusSchema,
    to_review_status: NullableReviewStatusSchema,
    from_publication_status: NullablePublicationStatusSchema,
    to_publication_status: NullablePublicationStatusSchema,
    quarantine_reason: NullableQuarantineReasonSchema,
    expected_version: z.number().int(),
    internal_note: z.string().nullable(),
    occurred_at: z.date(),
  })
  .strict();
export type WorkflowAuditEvent = z.infer<typeof WorkflowAuditEventSchema>;

export const WorkflowEventClaimSchema = z
  .object({
    id: DatabaseIdSchema,
    workflow_event_id: DatabaseIdSchema,
    casino_evidence_claim_id: DatabaseIdSchema.nullable(),
    bonus_evidence_claim_id: DatabaseIdSchema.nullable(),
    slot_evidence_claim_id: DatabaseIdSchema.nullable(),
    license_evidence_claim_id: DatabaseIdSchema.nullable(),
  })
  .strict();
export type WorkflowEventClaim = z.infer<typeof WorkflowEventClaimSchema>;

export const CasinoGovernanceStateSchema = z
  .object({
    id: DatabaseIdSchema,
    review_status: ReviewStatusSchema,
    publication_status: PublicationStatusSchema,
    quarantine_reason: NullableQuarantineReasonSchema,
    governance_version: z.number().int(),
    duplicate_of_id: DatabaseIdSchema.nullable(),
  })
  .strict();
export type CasinoGovernanceState = z.infer<typeof CasinoGovernanceStateSchema>;

export const BonusGovernanceStateSchema = z
  .object({
    id: DatabaseIdSchema,
    review_status: ReviewStatusSchema,
    publication_status: PublicationStatusSchema,
    quarantine_reason: NullableQuarantineReasonSchema,
    governance_version: z.number().int(),
    duplicate_of_id: DatabaseIdSchema.nullable(),
  })
  .strict();
export type BonusGovernanceState = z.infer<typeof BonusGovernanceStateSchema>;

export const SlotGovernanceStateSchema = z
  .object({
    id: DatabaseIdSchema,
    review_status: ReviewStatusSchema,
    publication_status: PublicationStatusSchema,
    quarantine_reason: NullableQuarantineReasonSchema,
    governance_version: z.number().int(),
    duplicate_of_id: DatabaseIdSchema.nullable(),
  })
  .strict();
export type SlotGovernanceState = z.infer<typeof SlotGovernanceStateSchema>;

export const LicenseGovernanceStateSchema = z
  .object({
    id: DatabaseIdSchema,
    review_status: ReviewStatusSchema,
    quarantine_reason: NullableQuarantineReasonSchema,
    governance_version: z.number().int(),
    duplicate_of_id: DatabaseIdSchema.nullable(),
  })
  .strict();
export type LicenseGovernanceState = z.infer<
  typeof LicenseGovernanceStateSchema
>;

export const CasinoDomainSchema = z
  .object({
    id: DatabaseIdSchema,
    casino_id: DatabaseIdSchema,
    normalized_host: NormalizedHostSchema,
    evidence_claim_id: DatabaseIdSchema.nullable(),
    created_at: z.date(),
  })
  .strict();
export type CasinoDomain = z.infer<typeof CasinoDomainSchema>;

export const CreateCasinoDomainCandidateInputSchema = z
  .object({
    casino_id: DatabaseIdSchema,
    normalized_host: NormalizedHostSchema,
    evidence_claim_id: OptionalNullableDatabaseIdSchema,
  })
  .strict();
export type CreateCasinoDomainCandidateInput = z.infer<
  typeof CreateCasinoDomainCandidateInputSchema
>;
