-- Persist START-time HEX stake evidence (stakeShares, lockedDay) that stake
-- ingestion already reads from stakeLists but previously discarded. Both columns
-- are nullable to preserve existing rows without a backfill: END rows and any
-- historical START rows read back as NULL. stakeShares uses Decimal(78, 0) to
-- match the other large on-chain integer columns on this table (uint72 fits).
ALTER TABLE "RawStakeAction" ADD COLUMN "lockedDay" INTEGER;
ALTER TABLE "RawStakeAction" ADD COLUMN "stakeShares" DECIMAL(78,0);
