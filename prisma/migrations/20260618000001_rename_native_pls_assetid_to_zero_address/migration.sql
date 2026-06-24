-- Rename native PLS assetId from symbol-based to zero-address format.
-- Old: chain:369:native:PLS
-- New: chain:369:native:0x0000000000000000000000000000000000000000
--
-- Raw audit tables (RawTokenTransfer.feeAssetIdSnapshot, RawDexSwap.feeAssetIdSnapshot,
-- RawLpAction.feeAssetIdSnapshot, etc.) are intentionally excluded — raw audit data is
-- immutable evidence. The normalization layer translates the old ID at read time via
-- canonicalizeSnapshotAssetId() so that rebuild remains idempotent.
--
-- LedgerEntry.dedupeKey is a SHA-256 hash that embeds assetId. Recomputing it in SQL
-- would require matching JavaScript's JSON.stringify format exactly, which is not
-- feasible. After applying this migration, run a full rebuild to regenerate dedupeKey
-- values for native PLS ledger entries with the new assetId.

-- Delete PriceObservation rows whose id is a SHA-256 of the old assetId first.
-- They will be re-ingested with the correct id on the next pricing run.
DELETE FROM "PriceObservation" WHERE "assetId" = 'chain:369:native:PLS';

-- Translate old assetId strings embedded in warningDetails JSON arrays.
UPDATE "PortfolioMaterializationState"
SET "warningDetails" = (
  SELECT jsonb_agg(
    replace(
      elem::text,
      'chain:369:native:PLS',
      'chain:369:native:0x0000000000000000000000000000000000000000'
    )::jsonb
  )
  FROM jsonb_array_elements("warningDetails"::jsonb) AS elem
)
WHERE "warningDetails"::text LIKE '%chain:369:native:PLS%';

UPDATE "Token"
SET "assetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "assetId" = 'chain:369:native:PLS';

UPDATE "Chain"
SET "nativeAssetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "nativeAssetId" = 'chain:369:native:PLS';

UPDATE "LedgerEntry"
SET "assetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "assetId" = 'chain:369:native:PLS';

UPDATE "PortfolioTokenBalance"
SET "assetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "assetId" = 'chain:369:native:PLS';

UPDATE "PortfolioLpPosition"
SET "token0AssetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "token0AssetId" = 'chain:369:native:PLS';

UPDATE "PortfolioLpPosition"
SET "token1AssetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "token1AssetId" = 'chain:369:native:PLS';
