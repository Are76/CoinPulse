-- Enforce canonical identity for RawEndedHexStakeObservation at the database
-- level. Native pHEX Phase 1 (D-032, D-033) defines the canonical identity of
-- an ended stake as (chainId, walletAddress-lowercase, stakeId). Only one
-- canonical row per ended stake per wallet per chain is permitted; other
-- persisted columns (endBlockNumber, endTxHash, discoveryMethod, stakeIndex,
-- recovery provenance, completion fields) are evidence/attributes, not identity.
--
-- The existing non-unique btree on the same (chainId, walletAddress, stakeId)
-- tuple is dropped because the new unique index fully covers those lookups —
-- keeping both would only add write overhead and confuse EXPLAIN plans.
--
-- This migration is intentionally additive at the row level: no UPDATE or
-- DELETE is issued, and no existing column, index (aside from the redundant
-- one being replaced), or FK is touched. The read-only pre-migration audit
-- proved zero duplicates under the canonical tuple, but the defensive check
-- below fails the migration closed rather than silently rolling back if any
-- duplicate slipped in between audit time and migration application.

-- Safety check: fail fast if duplicate observations exist that would prevent
-- the unique index from being created. Mirrors the pattern used in
-- 20260703000002_harden_raw_hsi_stake_observation_identity.
DO $$
DECLARE dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT "chainId", "walletAddress", "stakeId"
        FROM "RawEndedHexStakeObservation"
        GROUP BY "chainId", "walletAddress", "stakeId"
        HAVING COUNT(*) > 1
    ) AS dups;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % duplicate ended-stake observation row(s) '
            'found under canonical identity (chainId, walletAddress, stakeId). '
            'Resolve duplicates manually before running this migration.', dup_count;
    END IF;
END $$;

-- DropIndex: redundant non-unique index superseded by the unique index below.
DROP INDEX "RawEndedHexStakeObservation_chainId_walletAddress_stakeId_idx";

-- CreateIndex: canonical identity uniqueness.
CREATE UNIQUE INDEX "RawEndedHexStakeObservation_chainId_walletAddress_stakeId_key"
    ON "RawEndedHexStakeObservation"("chainId", "walletAddress", "stakeId");
