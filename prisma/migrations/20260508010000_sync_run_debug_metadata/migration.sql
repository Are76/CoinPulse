-- AlterTable
ALTER TABLE "SyncRun"
ADD COLUMN "warningDetails" JSONB,
ADD COLUMN "failedSourceFamily" "SourceFamily",
ADD COLUMN "failedFromBlock" BIGINT,
ADD COLUMN "failedToBlock" BIGINT;
