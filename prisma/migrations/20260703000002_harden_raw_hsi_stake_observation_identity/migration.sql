-- AlterTable: change hsiTokenId from BIGINT to TEXT so it can hold uint256-sized
-- ERC-721 token IDs without truncation.
ALTER TABLE "RawHsiStakeObservation"
    ALTER COLUMN "hsiTokenId" TYPE TEXT USING "hsiTokenId"::TEXT;

-- Drop the old non-unique index on (chainId, walletAddress, hsiTokenId) because
-- the new unique constraint below supersedes it.
DROP INDEX "RawHsiStakeObservation_chainId_walletAddress_hsiTokenId_idx";

-- Backfill: normalize hsiAddress to lowercase so the new unique constraint uses
-- the same case convention as the new store code. The old store persisted
-- hsiAddress as-is (mixed-case), while the new store always lowercases before write.
UPDATE "RawHsiStakeObservation"
    SET "hsiAddress" = lower("hsiAddress")
    WHERE "hsiAddress" <> lower("hsiAddress");

-- Safety check: fail fast if duplicate observations exist that would prevent
-- the unique index from being created. The old store had no DB-level uniqueness,
-- so concurrent writes could in theory have produced duplicates. An explicit
-- assertion here causes the migration to abort with a clear error rather than
-- silently rolling back or leaving the index uncreated.
DO $$
DECLARE dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT "chainId", "walletAddress", "hsiAddress", "hsiTokenId", "observedAtBlock"
        FROM "RawHsiStakeObservation"
        GROUP BY "chainId", "walletAddress", "hsiAddress", "hsiTokenId", "observedAtBlock"
        HAVING COUNT(*) > 1
    ) AS dups;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % duplicate HSI observation row(s) found. '
            'Resolve duplicates manually before running this migration.', dup_count;
    END IF;
END $$;

-- AddUniqueConstraint: full dedupe tuple includes hsiAddress so that the same
-- token ID at the same block on two different Hedron contracts creates separate rows.
-- Short name used because the auto-generated 86-byte name exceeds PostgreSQL's
-- 63-byte identifier limit and would be silently truncated.
CREATE UNIQUE INDEX "RawHsiStakeObs_identity_key"
    ON "RawHsiStakeObservation"("chainId", "walletAddress", "hsiAddress", "hsiTokenId", "observedAtBlock");
