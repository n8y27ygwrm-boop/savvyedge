-- Phase 2 Slice 2.1A: additive evidence and governance foundation.
-- This migration intentionally creates no actors, evidence, claims, workflow events,
-- or CasinoDomain rows. Existing Phase 1 records remain NEW and UNPUBLISHED.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM (
    'NEW',
    'AWAITING_REVIEW',
    'IN_REVIEW',
    'APPROVED',
    'REJECTED',
    'QUARANTINED',
    'SUPERSEDED'
);

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM (
    'UNPUBLISHED',
    'PUBLISHED',
    'WITHDRAWN'
);

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM (
    'HUMAN',
    'SERVICE',
    'SYSTEM',
    'MIGRATION'
);

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM (
    'OPERATOR_PAGE',
    'REGULATOR_REGISTER',
    'PROVIDER_PAGE',
    'TEST_LAB_REPORT',
    'FIRST_PARTY_API',
    'LEGACY_HISTORY_PROXY'
);

-- CreateEnum
CREATE TYPE "EvidenceVerdict" AS ENUM (
    'SUPPORTS',
    'CONTRADICTS',
    'INCONCLUSIVE'
);

-- CreateEnum
CREATE TYPE "QuarantineReason" AS ENUM (
    'DEV_MOCK',
    'AGGREGATOR_IDENTITY',
    'UNKNOWN_SOURCE',
    'INVALID_IDENTITY',
    'DUPLICATE',
    'CONFLICTING_EVIDENCE',
    'EXPIRED_EVIDENCE',
    'UNVERIFIED_LICENSE',
    'MANUAL_HOLD'
);

-- CreateEnum
CREATE TYPE "WorkflowEventType" AS ENUM (
    'INGESTED',
    'REVIEW_REQUESTED',
    'REVIEW_STARTED',
    'APPROVED',
    'REJECTED',
    'QUARANTINED',
    'QUARANTINE_CLEARED',
    'MATERIAL_CHANGE_DETECTED',
    'PUBLISHED',
    'UNPUBLISHED',
    'WITHDRAWN',
    'SUPERSEDED',
    'MERGED'
);

-- CreateEnum
CREATE TYPE "GovernedSubjectType" AS ENUM (
    'CASINO',
    'BONUS',
    'SLOT',
    'LICENSE'
);

-- CreateEnum
CREATE TYPE "CasinoEvidenceField" AS ENUM (
    'NAME',
    'WEBSITE_HOST',
    'LICENSE_ASSOCIATION'
);

-- CreateEnum
CREATE TYPE "BonusEvidenceField" AS ENUM (
    'TYPE',
    'HEADLINE_VALUE',
    'WAGERING_REQUIREMENT',
    'MAX_CONVERSION',
    'VALID_FROM',
    'VALID_UNTIL'
);

-- CreateEnum
CREATE TYPE "SlotEvidenceField" AS ENUM (
    'NAME',
    'PROVIDER',
    'RTP',
    'VOLATILITY',
    'MAX_WIN',
    'RELEASE_DATE',
    'CASINO_AVAILABILITY'
);

-- CreateEnum
CREATE TYPE "LicenseEvidenceField" AS ENUM (
    'LICENSE_NUMBER',
    'STATUS',
    'REGULATOR',
    'CASINO_ASSOCIATION',
    'VALID_UNTIL'
);

-- AlterTable
ALTER TABLE "Casino"
    ADD COLUMN "review_status" "ReviewStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "publication_status" "PublicationStatus" NOT NULL DEFAULT 'UNPUBLISHED',
    ADD COLUMN "quarantine_reason" "QuarantineReason",
    ADD COLUMN "governance_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "duplicate_of_id" TEXT;

-- AlterTable
ALTER TABLE "Bonus"
    ADD COLUMN "source_offer_key" TEXT,
    ADD COLUMN "review_status" "ReviewStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "publication_status" "PublicationStatus" NOT NULL DEFAULT 'UNPUBLISHED',
    ADD COLUMN "quarantine_reason" "QuarantineReason",
    ADD COLUMN "governance_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "duplicate_of_id" TEXT;

-- AlterTable
ALTER TABLE "Slot"
    ADD COLUMN "review_status" "ReviewStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "publication_status" "PublicationStatus" NOT NULL DEFAULT 'UNPUBLISHED',
    ADD COLUMN "quarantine_reason" "QuarantineReason",
    ADD COLUMN "governance_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "duplicate_of_id" TEXT;

-- AlterTable
ALTER TABLE "License"
    ADD COLUMN "normalized_license_no" TEXT,
    ADD COLUMN "review_status" "ReviewStatus" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "quarantine_reason" "QuarantineReason",
    ADD COLUMN "governance_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "duplicate_of_id" TEXT;

-- AlterTable
ALTER TABLE "DataSource"
    ADD COLUMN "normalized_url" TEXT;

-- CreateTable
CREATE TABLE "ReviewActor" (
    "id" TEXT NOT NULL,
    "kind" "ActorKind" NOT NULL,
    "stable_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "external_subject" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewActor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "scrape_job_id" TEXT,
    "evidence_type" "EvidenceType" NOT NULL,
    "source_url" TEXT NOT NULL,
    "snapshot_path" TEXT,
    "html_hash" TEXT,
    "content_hash" TEXT,
    "extraction_key" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "extracted_at" TIMESTAMP(3) NOT NULL,
    "valid_from" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoEvidenceClaim" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "field" "CasinoEvidenceField" NOT NULL,
    "observed_value" TEXT NOT NULL,
    "normalized_value_hash" TEXT NOT NULL,
    "verdict" "EvidenceVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoEvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusEvidenceClaim" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "bonus_id" TEXT NOT NULL,
    "field" "BonusEvidenceField" NOT NULL,
    "observed_value" TEXT NOT NULL,
    "normalized_value_hash" TEXT NOT NULL,
    "verdict" "EvidenceVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusEvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotEvidenceClaim" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "field" "SlotEvidenceField" NOT NULL,
    "observed_value" TEXT NOT NULL,
    "normalized_value_hash" TEXT NOT NULL,
    "verdict" "EvidenceVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotEvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseEvidenceClaim" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "field" "LicenseEvidenceField" NOT NULL,
    "observed_value" TEXT NOT NULL,
    "normalized_value_hash" TEXT NOT NULL,
    "verdict" "EvidenceVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseEvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- CasinoDomain is a candidate identity structure only. Its presence does not
-- establish review approval and it is not used by public eligibility in this slice.
CREATE TABLE "CasinoDomain" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "normalized_host" TEXT NOT NULL,
    "evidence_claim_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAuditEvent" (
    "id" TEXT NOT NULL,
    "subject_type" "GovernedSubjectType" NOT NULL,
    "casino_id" TEXT,
    "bonus_id" TEXT,
    "slot_id" TEXT,
    "license_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "event_type" "WorkflowEventType" NOT NULL,
    "from_review_status" "ReviewStatus",
    "to_review_status" "ReviewStatus",
    "from_publication_status" "PublicationStatus",
    "to_publication_status" "PublicationStatus",
    "quarantine_reason" "QuarantineReason",
    "expected_version" INTEGER NOT NULL,
    "internal_note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEventClaim" (
    "id" TEXT NOT NULL,
    "workflow_event_id" TEXT NOT NULL,
    "casino_evidence_claim_id" TEXT,
    "bonus_evidence_claim_id" TEXT,
    "slot_evidence_claim_id" TEXT,
    "license_evidence_claim_id" TEXT,

    CONSTRAINT "WorkflowEventClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewActor_stable_key_key" ON "ReviewActor"("stable_key");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewActor_external_subject_key" ON "ReviewActor"("external_subject");

-- CreateIndex
CREATE INDEX "ReviewActor_kind_active_idx" ON "ReviewActor"("kind", "active");

-- CreateIndex
CREATE INDEX "EvidenceRecord_data_source_id_observed_at_idx" ON "EvidenceRecord"("data_source_id", "observed_at");

-- CreateIndex
CREATE INDEX "EvidenceRecord_scrape_job_id_idx" ON "EvidenceRecord"("scrape_job_id");

-- CreateIndex
CREATE INDEX "EvidenceRecord_expires_at_idx" ON "EvidenceRecord"("expires_at");

-- CreateIndex
CREATE INDEX "EvidenceRecord_content_hash_idx" ON "EvidenceRecord"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoEvidenceClaim_evidence_id_casino_id_field_key" ON "CasinoEvidenceClaim"("evidence_id", "casino_id", "field");

-- CreateIndex
CREATE INDEX "CasinoEvidenceClaim_casino_id_field_verdict_idx" ON "CasinoEvidenceClaim"("casino_id", "field", "verdict");

-- CreateIndex
CREATE INDEX "CasinoEvidenceClaim_normalized_value_hash_idx" ON "CasinoEvidenceClaim"("normalized_value_hash");

-- CreateIndex
CREATE UNIQUE INDEX "BonusEvidenceClaim_evidence_id_bonus_id_field_key" ON "BonusEvidenceClaim"("evidence_id", "bonus_id", "field");

-- CreateIndex
CREATE INDEX "BonusEvidenceClaim_bonus_id_field_verdict_idx" ON "BonusEvidenceClaim"("bonus_id", "field", "verdict");

-- CreateIndex
CREATE INDEX "BonusEvidenceClaim_normalized_value_hash_idx" ON "BonusEvidenceClaim"("normalized_value_hash");

-- CreateIndex
CREATE UNIQUE INDEX "SlotEvidenceClaim_evidence_id_slot_id_field_key" ON "SlotEvidenceClaim"("evidence_id", "slot_id", "field");

-- CreateIndex
CREATE INDEX "SlotEvidenceClaim_slot_id_field_verdict_idx" ON "SlotEvidenceClaim"("slot_id", "field", "verdict");

-- CreateIndex
CREATE INDEX "SlotEvidenceClaim_normalized_value_hash_idx" ON "SlotEvidenceClaim"("normalized_value_hash");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseEvidenceClaim_evidence_id_license_id_field_key" ON "LicenseEvidenceClaim"("evidence_id", "license_id", "field");

-- CreateIndex
CREATE INDEX "LicenseEvidenceClaim_license_id_field_verdict_idx" ON "LicenseEvidenceClaim"("license_id", "field", "verdict");

-- CreateIndex
CREATE INDEX "LicenseEvidenceClaim_normalized_value_hash_idx" ON "LicenseEvidenceClaim"("normalized_value_hash");

-- CreateIndex
CREATE INDEX "CasinoDomain_casino_id_idx" ON "CasinoDomain"("casino_id");

-- CreateIndex
CREATE INDEX "CasinoDomain_normalized_host_idx" ON "CasinoDomain"("normalized_host");

-- CreateIndex
CREATE INDEX "CasinoDomain_evidence_claim_id_idx" ON "CasinoDomain"("evidence_claim_id");

-- CreateIndex
CREATE INDEX "WorkflowAuditEvent_casino_id_occurred_at_idx" ON "WorkflowAuditEvent"("casino_id", "occurred_at");

-- CreateIndex
CREATE INDEX "WorkflowAuditEvent_bonus_id_occurred_at_idx" ON "WorkflowAuditEvent"("bonus_id", "occurred_at");

-- CreateIndex
CREATE INDEX "WorkflowAuditEvent_slot_id_occurred_at_idx" ON "WorkflowAuditEvent"("slot_id", "occurred_at");

-- CreateIndex
CREATE INDEX "WorkflowAuditEvent_license_id_occurred_at_idx" ON "WorkflowAuditEvent"("license_id", "occurred_at");

-- CreateIndex
CREATE INDEX "WorkflowAuditEvent_actor_id_occurred_at_idx" ON "WorkflowAuditEvent"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "WorkflowEventClaim_workflow_event_id_idx" ON "WorkflowEventClaim"("workflow_event_id");

-- CreateIndex
CREATE INDEX "WorkflowEventClaim_casino_evidence_claim_id_idx" ON "WorkflowEventClaim"("casino_evidence_claim_id");

-- CreateIndex
CREATE INDEX "WorkflowEventClaim_bonus_evidence_claim_id_idx" ON "WorkflowEventClaim"("bonus_evidence_claim_id");

-- CreateIndex
CREATE INDEX "WorkflowEventClaim_slot_evidence_claim_id_idx" ON "WorkflowEventClaim"("slot_evidence_claim_id");

-- CreateIndex
CREATE INDEX "WorkflowEventClaim_license_evidence_claim_id_idx" ON "WorkflowEventClaim"("license_evidence_claim_id");

-- CreateIndex
CREATE INDEX "Casino_review_status_publication_status_idx" ON "Casino"("review_status", "publication_status");

-- CreateIndex
CREATE INDEX "Casino_duplicate_of_id_idx" ON "Casino"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "Bonus_source_offer_key_idx" ON "Bonus"("source_offer_key");

-- CreateIndex
CREATE INDEX "Bonus_review_status_publication_status_idx" ON "Bonus"("review_status", "publication_status");

-- CreateIndex
CREATE INDEX "Bonus_duplicate_of_id_idx" ON "Bonus"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "Slot_review_status_publication_status_idx" ON "Slot"("review_status", "publication_status");

-- CreateIndex
CREATE INDEX "Slot_duplicate_of_id_idx" ON "Slot"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "License_normalized_license_no_idx" ON "License"("normalized_license_no");

-- CreateIndex
CREATE INDEX "License_review_status_idx" ON "License"("review_status");

-- CreateIndex
CREATE INDEX "License_duplicate_of_id_idx" ON "License"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "DataSource_normalized_url_idx" ON "DataSource"("normalized_url");

-- AddForeignKey
ALTER TABLE "Casino" ADD CONSTRAINT "Casino_duplicate_of_id_fkey"
    FOREIGN KEY ("duplicate_of_id") REFERENCES "Casino"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_duplicate_of_id_fkey"
    FOREIGN KEY ("duplicate_of_id") REFERENCES "Bonus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_duplicate_of_id_fkey"
    FOREIGN KEY ("duplicate_of_id") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_duplicate_of_id_fkey"
    FOREIGN KEY ("duplicate_of_id") REFERENCES "License"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_data_source_id_fkey"
    FOREIGN KEY ("data_source_id") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_scrape_job_id_fkey"
    FOREIGN KEY ("scrape_job_id") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "ReviewActor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoEvidenceClaim" ADD CONSTRAINT "CasinoEvidenceClaim_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "EvidenceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoEvidenceClaim" ADD CONSTRAINT "CasinoEvidenceClaim_casino_id_fkey"
    FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusEvidenceClaim" ADD CONSTRAINT "BonusEvidenceClaim_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "EvidenceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusEvidenceClaim" ADD CONSTRAINT "BonusEvidenceClaim_bonus_id_fkey"
    FOREIGN KEY ("bonus_id") REFERENCES "Bonus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotEvidenceClaim" ADD CONSTRAINT "SlotEvidenceClaim_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "EvidenceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotEvidenceClaim" ADD CONSTRAINT "SlotEvidenceClaim_slot_id_fkey"
    FOREIGN KEY ("slot_id") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvidenceClaim" ADD CONSTRAINT "LicenseEvidenceClaim_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "EvidenceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvidenceClaim" ADD CONSTRAINT "LicenseEvidenceClaim_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoDomain" ADD CONSTRAINT "CasinoDomain_casino_id_fkey"
    FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoDomain" ADD CONSTRAINT "CasinoDomain_evidence_claim_id_fkey"
    FOREIGN KEY ("evidence_claim_id") REFERENCES "CasinoEvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_casino_id_fkey"
    FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_bonus_id_fkey"
    FOREIGN KEY ("bonus_id") REFERENCES "Bonus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_slot_id_fkey"
    FOREIGN KEY ("slot_id") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "License"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "ReviewActor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_workflow_event_id_fkey"
    FOREIGN KEY ("workflow_event_id") REFERENCES "WorkflowAuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_casino_evidence_claim_id_fkey"
    FOREIGN KEY ("casino_evidence_claim_id") REFERENCES "CasinoEvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_bonus_evidence_claim_id_fkey"
    FOREIGN KEY ("bonus_evidence_claim_id") REFERENCES "BonusEvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_slot_evidence_claim_id_fkey"
    FOREIGN KEY ("slot_evidence_claim_id") REFERENCES "SlotEvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_license_evidence_claim_id_fkey"
    FOREIGN KEY ("license_evidence_claim_id") REFERENCES "LicenseEvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing rows satisfy these checks through NEW/UNPUBLISHED/null defaults.
ALTER TABLE "Casino" ADD CONSTRAINT "Casino_quarantine_state_check"
    CHECK (
        ("review_status" = 'QUARANTINED' AND "quarantine_reason" IS NOT NULL)
        OR ("review_status" <> 'QUARANTINED' AND "quarantine_reason" IS NULL)
    );

ALTER TABLE "Casino" ADD CONSTRAINT "Casino_superseded_duplicate_check"
    CHECK (
        ("review_status" = 'SUPERSEDED' AND "duplicate_of_id" IS NOT NULL)
        OR ("review_status" <> 'SUPERSEDED' AND "duplicate_of_id" IS NULL)
    );

ALTER TABLE "Casino" ADD CONSTRAINT "Casino_no_self_duplicate_check"
    CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");

ALTER TABLE "Casino" ADD CONSTRAINT "Casino_publication_state_check"
    CHECK (
        "publication_status" <> 'PUBLISHED'
        OR (
            "review_status" = 'APPROVED'
            AND "quarantine_reason" IS NULL
            AND "duplicate_of_id" IS NULL
        )
    );

ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_quarantine_state_check"
    CHECK (
        ("review_status" = 'QUARANTINED' AND "quarantine_reason" IS NOT NULL)
        OR ("review_status" <> 'QUARANTINED' AND "quarantine_reason" IS NULL)
    );

ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_superseded_duplicate_check"
    CHECK (
        ("review_status" = 'SUPERSEDED' AND "duplicate_of_id" IS NOT NULL)
        OR ("review_status" <> 'SUPERSEDED' AND "duplicate_of_id" IS NULL)
    );

ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_no_self_duplicate_check"
    CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");

ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_publication_state_check"
    CHECK (
        "publication_status" <> 'PUBLISHED'
        OR (
            "review_status" = 'APPROVED'
            AND "quarantine_reason" IS NULL
            AND "duplicate_of_id" IS NULL
        )
    );

ALTER TABLE "Slot" ADD CONSTRAINT "Slot_quarantine_state_check"
    CHECK (
        ("review_status" = 'QUARANTINED' AND "quarantine_reason" IS NOT NULL)
        OR ("review_status" <> 'QUARANTINED' AND "quarantine_reason" IS NULL)
    );

ALTER TABLE "Slot" ADD CONSTRAINT "Slot_superseded_duplicate_check"
    CHECK (
        ("review_status" = 'SUPERSEDED' AND "duplicate_of_id" IS NOT NULL)
        OR ("review_status" <> 'SUPERSEDED' AND "duplicate_of_id" IS NULL)
    );

ALTER TABLE "Slot" ADD CONSTRAINT "Slot_no_self_duplicate_check"
    CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");

ALTER TABLE "Slot" ADD CONSTRAINT "Slot_publication_state_check"
    CHECK (
        "publication_status" <> 'PUBLISHED'
        OR (
            "review_status" = 'APPROVED'
            AND "quarantine_reason" IS NULL
            AND "duplicate_of_id" IS NULL
        )
    );

ALTER TABLE "License" ADD CONSTRAINT "License_quarantine_state_check"
    CHECK (
        ("review_status" = 'QUARANTINED' AND "quarantine_reason" IS NOT NULL)
        OR ("review_status" <> 'QUARANTINED' AND "quarantine_reason" IS NULL)
    );

ALTER TABLE "License" ADD CONSTRAINT "License_superseded_duplicate_check"
    CHECK (
        ("review_status" = 'SUPERSEDED' AND "duplicate_of_id" IS NOT NULL)
        OR ("review_status" <> 'SUPERSEDED' AND "duplicate_of_id" IS NULL)
    );

ALTER TABLE "License" ADD CONSTRAINT "License_no_self_duplicate_check"
    CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");

ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_one_subject_check"
    CHECK (num_nonnulls("casino_id", "bonus_id", "slot_id", "license_id") = 1);

ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_subject_type_check"
    CHECK (
        ("subject_type" = 'CASINO' AND "casino_id" IS NOT NULL)
        OR ("subject_type" = 'BONUS' AND "bonus_id" IS NOT NULL)
        OR ("subject_type" = 'SLOT' AND "slot_id" IS NOT NULL)
        OR ("subject_type" = 'LICENSE' AND "license_id" IS NOT NULL)
    );

ALTER TABLE "WorkflowAuditEvent" ADD CONSTRAINT "WorkflowAuditEvent_quarantine_state_check"
    CHECK (
        ("to_review_status" = 'QUARANTINED' AND "quarantine_reason" IS NOT NULL)
        OR ("to_review_status" IS DISTINCT FROM 'QUARANTINED' AND "quarantine_reason" IS NULL)
    );

ALTER TABLE "WorkflowEventClaim" ADD CONSTRAINT "WorkflowEventClaim_one_claim_check"
    CHECK (
        num_nonnulls(
            "casino_evidence_claim_id",
            "bonus_evidence_claim_id",
            "slot_evidence_claim_id",
            "license_evidence_claim_id"
        ) = 1
    );

-- Workflow audit rows and their exact evidence-claim links are append-only.
CREATE FUNCTION "prevent_workflow_audit_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "WorkflowAuditEvent_append_only"
    BEFORE UPDATE OR DELETE ON "WorkflowAuditEvent"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_workflow_audit_mutation"();

CREATE TRIGGER "WorkflowEventClaim_append_only"
    BEFORE UPDATE OR DELETE ON "WorkflowEventClaim"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_workflow_audit_mutation"();
