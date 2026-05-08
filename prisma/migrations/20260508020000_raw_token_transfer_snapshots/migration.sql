DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RawTokenTransfer" LIMIT 1) THEN
    RAISE EXCEPTION
      'Cannot add RawTokenTransfer snapshot columns with existing rows. Rebuild or backfill raw token transfers deterministically before applying migration 20260508020000_raw_token_transfer_snapshots.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "RawTokenTransfer"
ADD COLUMN "tokenAddress" TEXT NOT NULL,
ADD COLUMN "assetIdSnapshot" TEXT NOT NULL,
ADD COLUMN "decimalsSnapshot" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "RawTokenTransfer_chainId_assetIdSnapshot_blockNumber_idx"
ON "RawTokenTransfer"("chainId", "assetIdSnapshot", "blockNumber");
