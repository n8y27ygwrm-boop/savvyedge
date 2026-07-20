-- CreateTable
CREATE TABLE "Casino" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "license_info" TEXT,
    "status" TEXT NOT NULL,
    "website_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "Casino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website_url" TEXT,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "rtp_current" DOUBLE PRECISION,
    "volatility" TEXT,
    "max_win" DOUBLE PRECISION,
    "release_date" TIMESTAMP(3),
    "wagering_contribution_pct" DOUBLE PRECISION NOT NULL DEFAULT 100,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotRtpHistory" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "rtp_value" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_url" TEXT,

    CONSTRAINT "SlotRtpHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "headline_value" TEXT,
    "wagering_requirement" DOUBLE PRECISION,
    "max_conversion" DOUBLE PRECISION,
    "true_value_score" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusHistoryEvent" (
    "id" TEXT NOT NULL,
    "bonus_id" TEXT NOT NULL,
    "field_changed" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_url" TEXT,

    CONSTRAINT "BonusHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoHistoryEvent" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_url" TEXT,

    CONSTRAINT "CasinoHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "author_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "methodology_version" TEXT,
    "published_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "last_scraped_at" TIMESTAMP(3),
    "reliability_score" DOUBLE PRECISION,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error_log" TEXT,
    "snapshot_path" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "html_hash" TEXT,
    "content_hash" TEXT,
    "canonical_url" TEXT,

    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regulator" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "website_url" TEXT,

    CONSTRAINT "Regulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "regulator_id" TEXT NOT NULL,
    "license_no" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerNode" (
    "id" TEXT NOT NULL,
    "worker_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "active_jobs" INTEGER NOT NULL DEFAULT 0,
    "last_heartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobQueue" (
    "id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "domain" TEXT,
    "worker_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "error_log" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredUrl" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "source_seed" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filter_reason" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredUrl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Casino_slug_key" ON "Casino"("slug");

-- CreateIndex
CREATE INDEX "Casino_slug_idx" ON "Casino"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider"("slug");

-- CreateIndex
CREATE INDEX "Provider_slug_idx" ON "Provider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_slug_key" ON "Slot"("slug");

-- CreateIndex
CREATE INDEX "Slot_slug_idx" ON "Slot"("slug");

-- CreateIndex
CREATE INDEX "Slot_provider_id_idx" ON "Slot"("provider_id");

-- CreateIndex
CREATE INDEX "SlotRtpHistory_slot_id_idx" ON "SlotRtpHistory"("slot_id");

-- CreateIndex
CREATE INDEX "SlotRtpHistory_slot_id_recorded_at_idx" ON "SlotRtpHistory"("slot_id", "recorded_at");

-- CreateIndex
CREATE INDEX "Bonus_casino_id_idx" ON "Bonus"("casino_id");

-- CreateIndex
CREATE INDEX "BonusHistoryEvent_bonus_id_idx" ON "BonusHistoryEvent"("bonus_id");

-- CreateIndex
CREATE INDEX "BonusHistoryEvent_bonus_id_changed_at_idx" ON "BonusHistoryEvent"("bonus_id", "changed_at");

-- CreateIndex
CREATE INDEX "CasinoHistoryEvent_casino_id_idx" ON "CasinoHistoryEvent"("casino_id");

-- CreateIndex
CREATE INDEX "CasinoHistoryEvent_casino_id_occurred_at_idx" ON "CasinoHistoryEvent"("casino_id", "occurred_at");

-- CreateIndex
CREATE INDEX "Review_casino_id_idx" ON "Review"("casino_id");

-- CreateIndex
CREATE INDEX "ScrapeJob_data_source_id_idx" ON "ScrapeJob"("data_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_slug_key" ON "Jurisdiction"("slug");

-- CreateIndex
CREATE INDEX "Jurisdiction_slug_idx" ON "Jurisdiction"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Regulator_slug_key" ON "Regulator"("slug");

-- CreateIndex
CREATE INDEX "Regulator_slug_idx" ON "Regulator"("slug");

-- CreateIndex
CREATE INDEX "Regulator_jurisdiction_id_idx" ON "Regulator"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "License_casino_id_idx" ON "License"("casino_id");

-- CreateIndex
CREATE INDEX "License_regulator_id_idx" ON "License"("regulator_id");

-- CreateIndex
CREATE INDEX "License_license_no_idx" ON "License"("license_no");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerNode_worker_name_key" ON "WorkerNode"("worker_name");

-- CreateIndex
CREATE INDEX "WorkerNode_status_last_heartbeat_idx" ON "WorkerNode"("status", "last_heartbeat");

-- CreateIndex
CREATE INDEX "JobQueue_queue_name_status_run_at_idx" ON "JobQueue"("queue_name", "status", "run_at");

-- CreateIndex
CREATE INDEX "JobQueue_queue_name_status_priority_run_at_idx" ON "JobQueue"("queue_name", "status", "priority", "run_at");

-- CreateIndex
CREATE INDEX "JobQueue_domain_status_idx" ON "JobQueue"("domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredUrl_url_key" ON "DiscoveredUrl"("url");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredUrl_normalized_url_key" ON "DiscoveredUrl"("normalized_url");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_domain_idx" ON "DiscoveredUrl"("domain");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_status_idx" ON "DiscoveredUrl"("status");

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRtpHistory" ADD CONSTRAINT "SlotRtpHistory_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_casino_id_fkey" FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusHistoryEvent" ADD CONSTRAINT "BonusHistoryEvent_bonus_id_fkey" FOREIGN KEY ("bonus_id") REFERENCES "Bonus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoHistoryEvent" ADD CONSTRAINT "CasinoHistoryEvent_casino_id_fkey" FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_casino_id_fkey" FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeJob" ADD CONSTRAINT "ScrapeJob_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Regulator" ADD CONSTRAINT "Regulator_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_casino_id_fkey" FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_regulator_id_fkey" FOREIGN KEY ("regulator_id") REFERENCES "Regulator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

