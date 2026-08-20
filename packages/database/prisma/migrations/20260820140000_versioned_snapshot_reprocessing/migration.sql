-- VERSIONED BONUS SNAPSHOT REPROCESSING V1
--
-- Duplicate preflight. This block is intentionally the first executable
-- statement: duplicate non-NULL identities abort the migration before any DDL
-- can change the schema. Legacy NULL keys need no backfill because PostgreSQL
-- treats NULL values as distinct in a unique index.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "EvidenceRecord"
        WHERE "extraction_key" IS NOT NULL
        GROUP BY "data_source_id", "extraction_key"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'versioned snapshot reprocessing preflight found duplicate extraction identities';
    END IF;
END
$$;

-- 1. Reprocessing provenance on the execution record.
ALTER TABLE "ScrapeJob" ADD COLUMN "reprocessed_from_id" TEXT;
ALTER TABLE "ScrapeJob" ADD COLUMN "extraction_version" TEXT;

CREATE INDEX "ScrapeJob_reprocessed_from_id_idx"
    ON "ScrapeJob"("reprocessed_from_id");

ALTER TABLE "ScrapeJob" ADD CONSTRAINT "ScrapeJob_reprocessed_from_id_fkey"
    FOREIGN KEY ("reprocessed_from_id") REFERENCES "ScrapeJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Provenance-scoped extraction identity.
--    Deliberately NOT a global UNIQUE(extraction_key): two data sources
--    publishing identical text must retain independent evidence.
CREATE UNIQUE INDEX "EvidenceRecord_data_source_id_extraction_key_key"
    ON "EvidenceRecord"("data_source_id", "extraction_key");

-- 3. Explicit active-extraction pointer.
--    Historical evidence and claims are never mutated; a record becomes
--    historical purely by no longer being referenced here.
CREATE TABLE "ActiveExtractionPointer" (
    "id" TEXT NOT NULL,
    "bonus_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "extraction_context" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "extraction_key" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveExtractionPointer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActiveExtractionPointer_bonus_id_extraction_context_key"
    ON "ActiveExtractionPointer"("bonus_id", "extraction_context");

CREATE INDEX "ActiveExtractionPointer_evidence_id_idx"
    ON "ActiveExtractionPointer"("evidence_id");

CREATE INDEX "ActiveExtractionPointer_data_source_id_idx"
    ON "ActiveExtractionPointer"("data_source_id");

ALTER TABLE "ActiveExtractionPointer"
    ADD CONSTRAINT "ActiveExtractionPointer_bonus_id_fkey"
    FOREIGN KEY ("bonus_id") REFERENCES "Bonus"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActiveExtractionPointer"
    ADD CONSTRAINT "ActiveExtractionPointer_data_source_id_fkey"
    FOREIGN KEY ("data_source_id") REFERENCES "DataSource"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActiveExtractionPointer"
    ADD CONSTRAINT "ActiveExtractionPointer_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "EvidenceRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
