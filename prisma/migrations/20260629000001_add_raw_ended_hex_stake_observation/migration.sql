-- CreateTable
CREATE TABLE "RawEndedHexStakeObservation" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "sourceFamily" "SourceFamily" NOT NULL DEFAULT 'HEXMINING',
    "walletAddress" TEXT NOT NULL,
    "stakeId" TEXT NOT NULL,
    "stakeIndex" INTEGER,
    "stakedDays" INTEGER,
    "lockedDay" INTEGER,
    "stakeShares" TEXT,
    "principalHex" TEXT,
    "yieldHex" TEXT,
    "penaltyHex" TEXT,
    "endTxHash" TEXT NOT NULL,
    "endBlockNumber" BIGINT NOT NULL,
    "startTxHash" TEXT,
    "startBlockNumber" BIGINT,
    "discoveryMethod" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawEndedHexStakeObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawEndedHexStakeObservation_chainId_walletAddress_stakeId_idx" ON "RawEndedHexStakeObservation"("chainId", "walletAddress", "stakeId");

-- CreateIndex
CREATE INDEX "RawEndedHexStakeObservation_chainId_walletAddress_endBlockNumber_idx" ON "RawEndedHexStakeObservation"("chainId", "walletAddress", "endBlockNumber");

-- CreateIndex
CREATE INDEX "RawEndedHexStakeObservation_chainId_sourceFamily_idx" ON "RawEndedHexStakeObservation"("chainId", "sourceFamily");

-- AddForeignKey
ALTER TABLE "RawEndedHexStakeObservation" ADD CONSTRAINT "RawEndedHexStakeObservation_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
