-- CreateTable
CREATE TABLE "RawDexSwap" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "initiatorAddress" TEXT NOT NULL,
    "counterpartyAddress" TEXT,
    "soldTokenAddress" TEXT NOT NULL,
    "soldAssetIdSnapshot" TEXT NOT NULL,
    "soldDecimalsSnapshot" INTEGER NOT NULL,
    "soldAmountRaw" DECIMAL(65,0) NOT NULL,
    "boughtTokenAddress" TEXT NOT NULL,
    "boughtAssetIdSnapshot" TEXT NOT NULL,
    "boughtDecimalsSnapshot" INTEGER NOT NULL,
    "boughtAmountRaw" DECIMAL(65,0) NOT NULL,
    "feeAssetIdSnapshot" TEXT NOT NULL,
    "feeDecimalsSnapshot" INTEGER NOT NULL,
    "feeAmountRaw" DECIMAL(65,0) NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawDexSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawDexSwap_chainId_initiatorAddress_blockNumber_idx" ON "RawDexSwap"("chainId", "initiatorAddress", "blockNumber");

-- CreateIndex
CREATE INDEX "RawDexSwap_chainId_soldAssetIdSnapshot_blockNumber_idx" ON "RawDexSwap"("chainId", "soldAssetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE INDEX "RawDexSwap_chainId_boughtAssetIdSnapshot_blockNumber_idx" ON "RawDexSwap"("chainId", "boughtAssetIdSnapshot", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawDexSwap_chainId_txHash_logIndex_blockHash_key" ON "RawDexSwap"("chainId", "txHash", "logIndex", "blockHash");

-- AddForeignKey
ALTER TABLE "RawDexSwap" ADD CONSTRAINT "RawDexSwap_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
