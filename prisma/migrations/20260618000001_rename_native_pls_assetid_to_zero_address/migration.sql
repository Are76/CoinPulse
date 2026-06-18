-- Rename native PLS assetId from symbol-based to zero-address format.
-- Old: chain:369:native:PLS
-- New: chain:369:native:0x0000000000000000000000000000000000000000
--
-- Only canonical and derived tables are updated. Raw audit tables
-- (RawTokenTransfer.feeAssetIdSnapshot, RawDexSwap.feeAssetIdSnapshot,
-- RawLpAction.feeAssetIdSnapshot, etc.) are intentionally excluded —
-- raw audit data is immutable evidence.

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

UPDATE "PriceObservation"
SET "assetId" = 'chain:369:native:0x0000000000000000000000000000000000000000'
WHERE "assetId" = 'chain:369:native:PLS';
