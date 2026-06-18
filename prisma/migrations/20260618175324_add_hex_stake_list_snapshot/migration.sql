-- CreateTable
CREATE TABLE "HexStakeListSnapshot" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "payloadVersion" TEXT NOT NULL DEFAULT 'v1',
    "canonicalPayload" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "staleAfterSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HexStakeListSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HexStakeListSnapshot_chainId_walletAddress_idx" ON "HexStakeListSnapshot"("chainId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "HexStakeListSnapshot_walletAddress_chainId_key" ON "HexStakeListSnapshot"("walletAddress", "chainId");

-- RenameForeignKey
ALTER TABLE "RawHexDailyDataObservationInvalidation" RENAME CONSTRAINT "RawHexDailyDataObservationInvalidation_supersededByObservationI" TO "RawHexDailyDataObservationInvalidation_supersededByObserva_fkey";

-- AddForeignKey
ALTER TABLE "HexStakeListSnapshot" ADD CONSTRAINT "HexStakeListSnapshot_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "RawHexDailyDataObservation_chainId_rangeStartDay_rangeEndDay_ob" RENAME TO "RawHexDailyDataObservation_chainId_rangeStartDay_rangeEndDa_idx";

-- RenameIndex
ALTER INDEX "RawHexDailyDataObservationInvalidation_supersededByObservationI" RENAME TO "RawHexDailyDataObservationInvalidation_supersededByObservat_idx";
