-- CreateEnum
CREATE TYPE "MaterializationStatus" AS ENUM ('RUNNING', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "PortfolioMaterializationState" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "status" "MaterializationStatus" NOT NULL,
    "completedSuccessfully" BOOLEAN NOT NULL DEFAULT false,
    "lastAttemptedAt" TIMESTAMP(3) NOT NULL,
    "latestMaterializedAt" TIMESTAMP(3),
    "sourceLedgerFromBlock" BIGINT,
    "sourceLedgerToBlock" BIGINT,
    "updatedFromBlock" BIGINT,
    "updatedToBlock" BIGINT,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "warningDetails" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioMaterializationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioMaterializationState_walletId_chainId_key" ON "PortfolioMaterializationState"("walletId", "chainId");

-- CreateIndex
CREATE INDEX "PortfolioMaterializationState_chainId_walletId_idx" ON "PortfolioMaterializationState"("chainId", "walletId");

-- AddForeignKey
ALTER TABLE "PortfolioMaterializationState" ADD CONSTRAINT "PortfolioMaterializationState_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioMaterializationState" ADD CONSTRAINT "PortfolioMaterializationState_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
