-- Phase 2 Slice 2.2A: make workflow audit versions and canonical targets complete.
-- No workflow events or governed-domain records are created by this migration.
BEGIN;

-- Phase 2.1A did not persist canonical event-time targets. Current subject state,
-- including duplicate_of_id, is not authoritative historical evidence. Fail before
-- changing table shape if any event would require an unknowable target.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "WorkflowAuditEvent"
        WHERE "event_type" IN ('SUPERSEDED', 'MERGED')
    ) THEN
        RAISE EXCEPTION
            'Cannot migrate historical SUPERSEDED/MERGED WorkflowAuditEvent rows: canonical event-time targets cannot be reconstructed authoritatively';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "WorkflowAuditEvent"
        WHERE "expected_version" = 2147483647
    ) THEN
        RAISE EXCEPTION
            'Cannot backfill WorkflowAuditEvent.resulting_version: expected_version exceeds the supported incrementable range';
    END IF;
END;
$$;

ALTER TABLE "WorkflowAuditEvent"
    ADD COLUMN "resulting_version" INTEGER,
    ADD COLUMN "canonical_casino_id" TEXT,
    ADD COLUMN "canonical_bonus_id" TEXT,
    ADD COLUMN "canonical_slot_id" TEXT,
    ADD COLUMN "canonical_license_id" TEXT;

-- Existing ordinary immutable rows predate resulting_version. Temporarily suspend
-- only the UPDATE/DELETE guard so the migration can complete those rows
-- transactionally. INSERT remains unaffected, and rollback restores trigger state.
ALTER TABLE "WorkflowAuditEvent"
    DISABLE TRIGGER "WorkflowAuditEvent_append_only";

UPDATE "WorkflowAuditEvent"
SET "resulting_version" = ("expected_version"::BIGINT + 1)::INTEGER;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "WorkflowAuditEvent"
        WHERE "resulting_version" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot make WorkflowAuditEvent.resulting_version required: an existing row could not be backfilled';
    END IF;
END;
$$;

ALTER TABLE "WorkflowAuditEvent"
    ENABLE TRIGGER "WorkflowAuditEvent_append_only";

ALTER TABLE "WorkflowAuditEvent"
    ALTER COLUMN "resulting_version" SET NOT NULL;

CREATE INDEX "WorkflowAuditEvent_canonical_casino_id_idx"
    ON "WorkflowAuditEvent"("canonical_casino_id");

CREATE INDEX "WorkflowAuditEvent_canonical_bonus_id_idx"
    ON "WorkflowAuditEvent"("canonical_bonus_id");

CREATE INDEX "WorkflowAuditEvent_canonical_slot_id_idx"
    ON "WorkflowAuditEvent"("canonical_slot_id");

CREATE INDEX "WorkflowAuditEvent_canonical_license_id_idx"
    ON "WorkflowAuditEvent"("canonical_license_id");

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_casino_id_fkey"
    FOREIGN KEY ("canonical_casino_id") REFERENCES "Casino"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_bonus_id_fkey"
    FOREIGN KEY ("canonical_bonus_id") REFERENCES "Bonus"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_slot_id_fkey"
    FOREIGN KEY ("canonical_slot_id") REFERENCES "Slot"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_license_id_fkey"
    FOREIGN KEY ("canonical_license_id") REFERENCES "License"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_version_increment_check"
    CHECK ("resulting_version"::BIGINT = "expected_version"::BIGINT + 1);

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_cardinality_check"
    CHECK (
        (
            "event_type" IN ('SUPERSEDED', 'MERGED')
            AND num_nonnulls(
                "canonical_casino_id",
                "canonical_bonus_id",
                "canonical_slot_id",
                "canonical_license_id"
            ) = 1
        )
        OR (
            "event_type" NOT IN ('SUPERSEDED', 'MERGED')
            AND num_nonnulls(
                "canonical_casino_id",
                "canonical_bonus_id",
                "canonical_slot_id",
                "canonical_license_id"
            ) = 0
        )
    );

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_canonical_type_check"
    CHECK (
        (
            "subject_type" = 'CASINO'
            AND "canonical_bonus_id" IS NULL
            AND "canonical_slot_id" IS NULL
            AND "canonical_license_id" IS NULL
        )
        OR (
            "subject_type" = 'BONUS'
            AND "canonical_casino_id" IS NULL
            AND "canonical_slot_id" IS NULL
            AND "canonical_license_id" IS NULL
        )
        OR (
            "subject_type" = 'SLOT'
            AND "canonical_casino_id" IS NULL
            AND "canonical_bonus_id" IS NULL
            AND "canonical_license_id" IS NULL
        )
        OR (
            "subject_type" = 'LICENSE'
            AND "canonical_casino_id" IS NULL
            AND "canonical_bonus_id" IS NULL
            AND "canonical_slot_id" IS NULL
        )
    );

ALTER TABLE "WorkflowAuditEvent"
    ADD CONSTRAINT "WorkflowAuditEvent_no_self_canonical_check"
    CHECK (
        ("canonical_casino_id" IS NULL OR "canonical_casino_id" <> "casino_id")
        AND ("canonical_bonus_id" IS NULL OR "canonical_bonus_id" <> "bonus_id")
        AND ("canonical_slot_id" IS NULL OR "canonical_slot_id" <> "slot_id")
        AND ("canonical_license_id" IS NULL OR "canonical_license_id" <> "license_id")
    );

COMMIT;
