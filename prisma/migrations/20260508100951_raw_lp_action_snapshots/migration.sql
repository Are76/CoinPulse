-- AlterEnum
ALTER TYPE "SourceFamily" ADD VALUE 'LP';

-- CreateTable
CREATE TABLE "RawLpAction" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "initiatorAddress" TEXT NOT NULL,
    "counterpartyAddress" TEXT,
    "token0Address" TEXT NOT NULL,
    "token0AssetIdSnapshot" TEXT NOT NULL,
    "token0DecimalsSnapshot" INTEGER NOT NULL,
    "token0AmountRaw" DECIMAL(65,0) NOT NULL,
    "token1Address" TEXT NOT NULL,
    "token1AssetIdSnapshot" TEXT NOT NULL,
    "token1DecimalsSnapshot" INTEGER NOT NULL,
    "token1AmountRaw" DECIMAL(65,0) NOT NULL,
    "lpTokenAddress" TEXT NOT NULL,
    "lpAssetIdSnapshot" TEXT NOT NULL,
    "lpDecimalsSnapshot" INTEGER NOT NULL,
    "lpAmountRaw" DECIMAL(65,0) NOT NULL,
    "feeAssetIdSnapshot" TEXT NOT NULL,
    "feeDecimalsSnapshot" INTEGER NOT NULL,
    "feeAmountRaw" DECIMAL(65,0) NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawLpAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawLpAction_chainId_initiatorAddress_blockNumber_idx" ON "RawLpAction"("chainId", "initiatorAddress", "blockNumber");

-- CreateIndex
CREATE INDEX "RawLpAction_chainId_lpAssetIdSnapshot_blockNumber_idx" ON "RawLpAction"("chainId", "lpAssetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE INDEX "RawLpAction_chainId_token0AssetIdSnapshot_blockNumber_idx" ON "RawLpAction"("chainId", "token0AssetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE INDEX "RawLpAction_chainId_token1AssetIdSnapshot_blockNumber_idx" ON "RawLpAction"("chainId", "token1AssetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawLpAction_chainId_txHash_logIndex_blockHash_key" ON "RawLpAction"("chainId", "txHash", "logIndex", "blockHash");

-- AddForeignKey
ALTER TABLE "RawLpAction" ADD CONSTRAINT "RawLpAction_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
