-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'IMPORT', 'REBUILD');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('RECEIVE', 'SEND', 'SWAP_IN', 'SWAP_OUT', 'FEE', 'LP_ADD_IN', 'LP_ADD_OUT', 'LP_REMOVE_IN', 'LP_REMOVE_OUT', 'STAKE_LOCK', 'STAKE_UNLOCK', 'STAKE_REWARD', 'INTERNAL_TRANSFER', 'APPROVAL_IGNORE');

-- CreateEnum
CREATE TYPE "RawRecordStatus" AS ENUM ('ACTIVE', 'REORGED');

-- CreateEnum
CREATE TYPE "SourceFamily" AS ENUM ('TRANSFERS', 'DEX', 'STAKING', 'NATIVE');

-- CreateEnum
CREATE TYPE "TokenMetadataSourceKind" AS ENUM ('SEED', 'RPC', 'MANUAL');

-- CreateTable
CREATE TABLE "Chain" (
    "id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rpcUrl" TEXT NOT NULL,
    "nativeAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "addressLower" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "addressLower" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "decimalsSource" TEXT NOT NULL,
    "isNative" BOOLEAN NOT NULL DEFAULT false,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenMetadataSource" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "sourceKind" "TokenMetadataSourceKind" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenMetadataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "safeStartBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetFlag" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "chainId" INTEGER NOT NULL,
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'MANUAL',
    "status" "SyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "stage" TEXT NOT NULL,
    "sourceFamilies" "SourceFamily"[],
    "startBlock" BIGINT NOT NULL,
    "endBlock" BIGINT,
    "latestSafeBlock" BIGINT,
    "policyLabel" TEXT NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "sourceFamily" "SourceFamily" NOT NULL,
    "fromBlock" BIGINT NOT NULL,
    "toBlock" BIGINT NOT NULL,
    "blockHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RpcRequestLog" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fromBlock" BIGINT,
    "toBlock" BIGINT,
    "statusCode" INTEGER,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RpcRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorgEvent" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "fromBlock" BIGINT NOT NULL,
    "toBlock" BIGINT NOT NULL,
    "canonicalBlockHash" TEXT NOT NULL,
    "observedBlockHash" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReorgEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawBlock" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "parentHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTransaction" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT,
    "valueRaw" DECIMAL(65,0) NOT NULL,
    "gasPriceRaw" DECIMAL(65,0),
    "gasUsedRaw" DECIMAL(65,0),
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawLog" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "transactionId" TEXT,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "topic0" TEXT,
    "topic1" TEXT,
    "topic2" TEXT,
    "topic3" TEXT,
    "data" TEXT NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTokenTransfer" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amountRaw" DECIMAL(65,0) NOT NULL,
    "status" "RawRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTokenTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerActionGroup" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "actionGroupKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerActionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "walletId" TEXT NOT NULL,
    "actionGroupId" TEXT NOT NULL,
    "tokenId" TEXT,
    "txHash" TEXT NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" DECIMAL(65,18) NOT NULL,
    "valueUsd" DECIMAL(65,18),
    "direction" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceLogIndex" INTEGER,
    "sourceLogKey" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chain_slug_key" ON "Chain"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Chain_nativeAssetId_key" ON "Chain"("nativeAssetId");

-- CreateIndex
CREATE INDEX "Wallet_chainId_addressLower_idx" ON "Wallet"("chainId", "addressLower");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_chainId_addressLower_key" ON "Wallet"("chainId", "addressLower");

-- CreateIndex
CREATE UNIQUE INDEX "Token_assetId_key" ON "Token"("assetId");

-- CreateIndex
CREATE INDEX "Token_chainId_addressLower_idx" ON "Token"("chainId", "addressLower");

-- CreateIndex
CREATE UNIQUE INDEX "Token_chainId_addressLower_key" ON "Token"("chainId", "addressLower");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMetadataSource_tokenId_sourceKind_sourceRef_key" ON "TokenMetadataSource"("tokenId", "sourceKind", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_chainId_slug_key" ON "Protocol"("chainId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AssetFlag_tokenId_flag_source_key" ON "AssetFlag"("tokenId", "flag", "source");

-- CreateIndex
CREATE INDEX "SyncRun_chainId_createdAt_idx" ON "SyncRun"("chainId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SyncRun_walletId_createdAt_idx" ON "SyncRun"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_walletId_chainId_sourceFamily_key" ON "SyncCursor"("walletId", "chainId", "sourceFamily");

-- CreateIndex
CREATE UNIQUE INDEX "RpcRequestLog_requestKey_key" ON "RpcRequestLog"("requestKey");

-- CreateIndex
CREATE INDEX "RawBlock_chainId_blockNumber_idx" ON "RawBlock"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawBlock_chainId_blockNumber_blockHash_key" ON "RawBlock"("chainId", "blockNumber", "blockHash");

-- CreateIndex
CREATE INDEX "RawTransaction_chainId_txHash_idx" ON "RawTransaction"("chainId", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "RawTransaction_chainId_txHash_blockHash_key" ON "RawTransaction"("chainId", "txHash", "blockHash");

-- CreateIndex
CREATE INDEX "RawLog_chainId_address_blockNumber_idx" ON "RawLog"("chainId", "address", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawLog_chainId_txHash_logIndex_blockHash_key" ON "RawLog"("chainId", "txHash", "logIndex", "blockHash");

-- CreateIndex
CREATE INDEX "RawTokenTransfer_chainId_tokenId_blockNumber_idx" ON "RawTokenTransfer"("chainId", "tokenId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RawTokenTransfer_chainId_txHash_logIndex_blockHash_key" ON "RawTokenTransfer"("chainId", "txHash", "logIndex", "blockHash");

-- CreateIndex
CREATE INDEX "LedgerActionGroup_walletId_occurredAt_idx" ON "LedgerActionGroup"("walletId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerActionGroup_chainId_walletId_actionGroupKey_key" ON "LedgerActionGroup"("chainId", "walletId", "actionGroupKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_assetId_occurredAt_idx" ON "LedgerEntry"("walletId", "assetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_chainId_walletId_dedupeKey_key" ON "LedgerEntry"("chainId", "walletId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenMetadataSource" ADD CONSTRAINT "TokenMetadataSource_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFlag" ADD CONSTRAINT "AssetFlag_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RpcRequestLog" ADD CONSTRAINT "RpcRequestLog_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorgEvent" ADD CONSTRAINT "ReorgEvent_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBlock" ADD CONSTRAINT "RawBlock_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawTransaction" ADD CONSTRAINT "RawTransaction_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLog" ADD CONSTRAINT "RawLog_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLog" ADD CONSTRAINT "RawLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "RawTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawTokenTransfer" ADD CONSTRAINT "RawTokenTransfer_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawTokenTransfer" ADD CONSTRAINT "RawTokenTransfer_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerActionGroup" ADD CONSTRAINT "LedgerActionGroup_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerActionGroup" ADD CONSTRAINT "LedgerActionGroup_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_actionGroupId_fkey" FOREIGN KEY ("actionGroupId") REFERENCES "LedgerActionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
