-- Enforce canonical identity for RawEndedHexStakeObservation at the database
-- level. Native pHEX Phase 1 (D-032) defines the canonical identity of
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

-- Safety check 1 of 2: mixed-case walletAddress rows.
--
-- The application persists walletAddress lowercased and looks up by lowercase,
-- but this DB unique index is case-sensitive at the storage level. A row
-- persisted with mixed case (e.g., a manual write or a legacy backfill from
-- before the store lowercased) would satisfy the case-sensitive constraint
-- yet also allow a second lowercase row for the same EVM wallet + stakeId to
-- be created later — silently breaking the canonical-identity invariant the
-- app relies on. Fail closed here so the operator can normalize before the
-- constraint locks in. This migration is deliberately additive (no cleanup
-- UPDATE/DELETE) — the operator resolves any nonzero result manually and
-- re-runs.
DO $$
DECLARE mixed_case_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mixed_case_count
    FROM "RawEndedHexStakeObservation"
    WHERE "walletAddress" <> lower("walletAddress");
    IF mixed_case_count > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % ended-stake observation row(s) have a '
            'mixed-case walletAddress. Normalize to lowercase before running this '
            'migration so the canonical-identity unique constraint matches the '
            'application''s lowercase lookup contract.', mixed_case_count;
    END IF;
END $$;

-- Safety check 2 of 2: duplicate observations under canonical identity.
-- Mirrors the pattern used in
-- 20260703000002_harden_raw_hsi_stake_observation_identity. The check groups
-- by lower("walletAddress") so a duplicate that would collapse under the
-- application's lowercase lookup is caught even if safety check 1 above is
-- ever relaxed in the future.
DO $$
DECLARE dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT "chainId", lower("walletAddress") AS wa, "stakeId"
        FROM "RawEndedHexStakeObservation"
        GROUP BY "chainId", lower("walletAddress"), "stakeId"
        HAVING COUNT(*) > 1
    ) AS dups;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % duplicate ended-stake observation row(s) '
            'found under canonical identity (chainId, lowercase walletAddress, stakeId). '
            'Resolve duplicates manually before running this migration.', dup_count;
    END IF;
END $$;

-- DropIndex: redundant non-unique index superseded by the unique index below.
DROP INDEX "RawEndedHexStakeObservation_chainId_walletAddress_stakeId_idx";

-- CreateIndex: canonical identity uniqueness.
CREATE UNIQUE INDEX "RawEndedHexStakeObservation_chainId_walletAddress_stakeId_key"
    ON "RawEndedHexStakeObservation"("chainId", "walletAddress", "stakeId");

-- Persistent lowercase invariant.
--
-- The unique index above is storage-level case-sensitive; without this CHECK,
-- an out-of-band write (manual SQL, a future service that forgets to
-- lowercase, a backfill script) could insert a mixed-case row that satisfies
-- the unique index and then silently collide with the application's
-- lowercase lookup — allowing two canonical rows for the same EVM wallet +
-- stake. This CHECK closes that gap permanently at the database boundary
-- and pairs with safety check 1 above: pre-migration proves no existing row
-- violates the invariant, then this CHECK stops any future row from doing so.
--
-- Prisma has no native syntax for CHECK constraints; it tolerates them as
-- unmodeled DB objects (same as functional indexes). The application's
-- persist path already lowercases before every write, so this CHECK never
-- fires in normal operation — it exists exclusively as defence-in-depth
-- against out-of-band writers.
ALTER TABLE "RawEndedHexStakeObservation"
    ADD CONSTRAINT "RawEndedHexStakeObs_walletAddress_lowercase_check"
    CHECK ("walletAddress" = lower("walletAddress"));
