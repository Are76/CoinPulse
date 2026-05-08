-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_START';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_END';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_PRINCIPAL_LOCKED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_PRINCIPAL_RETURNED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_YIELD_RECEIVED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_PENALTY';

-- CreateTable
CREATE TABLE "RawStakeAction" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "initiatorAddress" TEXT NOT NULL,
    "stakeId" BIGINT,
    "stakeIndex" INTEGER,
    "stakedDays" INTEGER,
    "tokenAddress" TEXT NOT NULL,
    "assetIdSnapshot" TEXT NOT NULL,
    "decimalsSnapshot" INTEGER NOT NULL,
    "principalLockedRaw" DECIMAL(65,0),
    "totalReturnedRaw" DECIMAL(65,0),
    "principalReturnedRaw" DECIMAL(65,0),
    "yieldRaw" DECIMAL(65,0),
    "penaltyRaw" DECIMAL(65,0),
    "feeAssetIdSnapshot" TEXT NOT NULL,
    "feeDecimalsSnapshot" INTEGER NOT NULL,
    "feeAmountRaw" DECIMAL(65,0) NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawStakeAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawStakeAction_chainId_initiatorAddress_blockNumber_idx" ON "RawStakeAction"("chainId", "initiatorAddress", "blockNumber");

-- CreateIndex
CREATE INDEX "RawStakeAction_chainId_stakeId_blockNumber_idx" ON "RawStakeAction"("chainId", "stakeId", "blockNumber");

-- CreateIndex
CREATE INDEX "RawStakeAction_chainId_assetIdSnapshot_blockNumber_idx" ON "RawStakeAction"("chainId", "assetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawStakeAction_chainId_txHash_actionKind_actionIndex_blockH_key" ON "RawStakeAction"("chainId", "txHash", "actionKind", "actionIndex", "blockHash");

-- AddForeignKey
ALTER TABLE "RawStakeAction" ADD CONSTRAINT "RawStakeAction_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
