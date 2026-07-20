-- AlterTable
ALTER TABLE "Bonus" ADD COLUMN     "data_source_type" TEXT NOT NULL DEFAULT 'SCRAPED';

-- AlterTable
ALTER TABLE "Casino" ADD COLUMN     "data_source_type" TEXT NOT NULL DEFAULT 'SCRAPED';
