-- CreateTable
CREATE TABLE "RawHsiStakeObservation" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "sourceFamily" "SourceFamily" NOT NULL DEFAULT 'HEXMINING',
    "walletAddress" TEXT NOT NULL,
    "hsiTokenId" BIGINT NOT NULL,
    "hsiAddress" TEXT NOT NULL,
    "stakeId" TEXT,
    "stakeIndex" INTEGER,
    "stakedDays" INTEGER,
    "lockedDay" INTEGER,
    "stakeShares" TEXT,
    "principalHex" TEXT,
    "observedAtBlock" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawHsiStakeObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawHsiStakeObservation_chainId_walletAddress_idx" ON "RawHsiStakeObservation"("chainId", "walletAddress");

-- CreateIndex
CREATE INDEX "RawHsiStakeObservation_chainId_walletAddress_hsiTokenId_idx" ON "RawHsiStakeObservation"("chainId", "walletAddress", "hsiTokenId");

-- CreateIndex
CREATE INDEX "RawHsiStakeObservation_chainId_sourceFamily_idx" ON "RawHsiStakeObservation"("chainId", "sourceFamily");

-- AddForeignKey
ALTER TABLE "RawHsiStakeObservation" ADD CONSTRAINT "RawHsiStakeObservation_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
