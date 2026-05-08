-- CreateEnum
CREATE TYPE "PriceSourceType" AS ENUM ('ONCHAIN_POOL', 'ONCHAIN_ROUTE', 'ORACLE', 'MANUAL', 'DEXSCREENER');

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetAddress" TEXT,
    "quoteAsset" TEXT NOT NULL,
    "price" DECIMAL(65,18) NOT NULL,
    "sourceType" "PriceSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "routeMetadata" JSONB,
    "liquidityUsd" DECIMAL(65,18),
    "confidence" DECIMAL(5,4) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT,
    "staleAfterSeconds" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceObservation_chainId_assetId_quoteAsset_observedAt_idx" ON "PriceObservation"("chainId", "assetId", "quoteAsset", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "PriceObservation_chainId_sourceType_observedAt_idx" ON "PriceObservation"("chainId", "sourceType", "observedAt" DESC);

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
