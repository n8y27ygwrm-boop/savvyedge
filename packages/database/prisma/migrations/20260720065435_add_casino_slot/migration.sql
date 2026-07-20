-- CreateTable
CREATE TABLE "CasinoSlot" (
    "id" TEXT NOT NULL,
    "casino_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "source_url" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CasinoSlot_casino_id_idx" ON "CasinoSlot"("casino_id");

-- CreateIndex
CREATE INDEX "CasinoSlot_slot_id_idx" ON "CasinoSlot"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoSlot_casino_id_slot_id_key" ON "CasinoSlot"("casino_id", "slot_id");

-- AddForeignKey
ALTER TABLE "CasinoSlot" ADD CONSTRAINT "CasinoSlot_casino_id_fkey" FOREIGN KEY ("casino_id") REFERENCES "Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoSlot" ADD CONSTRAINT "CasinoSlot_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
