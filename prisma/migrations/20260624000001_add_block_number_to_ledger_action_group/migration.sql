-- Add blockNumber to LedgerActionGroup so the canonical ledger
-- can surface block context without joining raw ingestion tables.
-- Nullable to preserve existing rows without a backfill.
ALTER TABLE "LedgerActionGroup" ADD COLUMN "blockNumber" BIGINT;
