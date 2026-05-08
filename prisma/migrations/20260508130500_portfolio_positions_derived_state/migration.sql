-- CreateTable
CREATE TABLE "PortfolioTokenBalance" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetAddress" TEXT,
    "balanceQuantity" DECIMAL(65,18) NOT NULL,
    "decimals" INTEGER,
    "updatedFromBlock" BIGINT,
    "updatedToBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioTokenBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioLpPosition" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lpAssetId" TEXT NOT NULL,
    "lpTokenAddress" TEXT,
    "lpTokenQuantity" DECIMAL(65,18) NOT NULL,
    "token0AssetId" TEXT,
    "token0Address" TEXT,
    "token1AssetId" TEXT,
    "token1Address" TEXT,
    "token0NetQuantity" DECIMAL(65,18),
    "token1NetQuantity" DECIMAL(65,18),
    "updatedFromBlock" BIGINT,
    "updatedToBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioLpPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioStakePosition" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "stakeKey" TEXT NOT NULL,
    "tokenAssetId" TEXT NOT NULL,
    "tokenAddress" TEXT,
    "principalQuantity" DECIMAL(65,18) NOT NULL,
    "returnedQuantity" DECIMAL(65,18) NOT NULL,
    "yieldQuantity" DECIMAL(65,18),
    "penaltyQuantity" DECIMAL(65,18),
    "status" TEXT NOT NULL,
    "startBlock" BIGINT,
    "endBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioStakePosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioTokenBalance_walletId_chainId_assetId_key" ON "PortfolioTokenBalance"("walletId", "chainId", "assetId");

-- CreateIndex
CREATE INDEX "PortfolioTokenBalance_chainId_walletAddress_idx" ON "PortfolioTokenBalance"("chainId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLpPosition_walletId_chainId_lpAssetId_key" ON "PortfolioLpPosition"("walletId", "chainId", "lpAssetId");

-- CreateIndex
CREATE INDEX "PortfolioLpPosition_chainId_walletAddress_idx" ON "PortfolioLpPosition"("chainId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioStakePosition_walletId_chainId_stakeKey_key" ON "PortfolioStakePosition"("walletId", "chainId", "stakeKey");

-- CreateIndex
CREATE INDEX "PortfolioStakePosition_chainId_walletAddress_idx" ON "PortfolioStakePosition"("chainId", "walletAddress");

-- AddForeignKey
ALTER TABLE "PortfolioTokenBalance" ADD CONSTRAINT "PortfolioTokenBalance_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTokenBalance" ADD CONSTRAINT "PortfolioTokenBalance_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLpPosition" ADD CONSTRAINT "PortfolioLpPosition_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioLpPosition" ADD CONSTRAINT "PortfolioLpPosition_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioStakePosition" ADD CONSTRAINT "PortfolioStakePosition_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioStakePosition" ADD CONSTRAINT "PortfolioStakePosition_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
