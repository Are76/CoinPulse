import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assemblePortfolioDashboard } from "@/services/dashboard/portfolio-dashboard";
import type { PersistedPriceObservation, ResolveBestPriceResult } from "@/services/pricing/types";
import type { AverageCostPnlResult, PnLWarning } from "@/services/pnl/types";

const WALLET_ID = "wallet-1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const TOKEN_ASSET = "chain:369:erc20:0xtoken";
const TOKEN_ADDRESS = "0xtoken";
const LP_ASSET = "chain:369:erc20:0xlp";
const LP_ADDRESS = "0xlp";
const STAKE_ASSET = "chain:369:erc20:0xphex";
const STAKE_ADDRESS = "0xphex";
const NATIVE_ASSET = "chain:369:native:PLS";

type TokenBalanceRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  assetId: string;
  assetAddress: string | null;
  balanceQuantity: string;
  decimals: number | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
};

type LpPositionRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  lpAssetId: string;
  lpTokenAddress: string | null;
  lpTokenQuantity: string;
  token0AssetId: string | null;
  token0Address: string | null;
  token1AssetId: string | null;
  token1Address: string | null;
  token0NetQuantity: string | null;
  token1NetQuantity: string | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
};

type StakePositionRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  stakeKey: string;
  tokenAssetId: string;
  tokenAddress: string | null;
  principalQuantity: string;
  returnedQuantity: string;
  yieldQuantity: string | null;
  penaltyQuantity: string | null;
  status: string;
  startBlock: bigint | null;
  endBlock: bigint | null;
};

type LedgerEntryRecord = {
  id: string;
  chainId: number;
  walletId: string;
  assetId: string;
  entryType: string;
  actionType: string;
  direction: string;
  quantity: string;
  occurredAt: Date;
  actionGroupId: string;
  txHash: string;
  sourceLogKey: string | null;
};

type TokenRecord = {
  chainId: number;
  assetId: string;
  decimalsSource: string | null;
  metadataSources?: Array<{ sourceKind: "SEED" | "RPC" | "MANUAL" | string; observedAt: Date | null }>;
};

type MaterializationStateRecord = {
  walletId: string;
  chainId: number;
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  lastAttemptedAt: Date;
  latestMaterializedAt: Date | null;
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  warningCount: number;
  warningDetails: unknown;
  errorMessage: string | null;
};

function createPriceObservation(
  overrides: Partial<PersistedPriceObservation> = {},
): PersistedPriceObservation {
  return {
    id: "obs-1",
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET,
    assetAddress: TOKEN_ADDRESS,
    quoteAsset: QUOTE_ASSET,
    price: "2",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpair",
    routeMetadata: null,
    liquidityUsd: "100000",
    confidence: "0.91",
    observedAt: new Date("2026-05-08T12:00:00.000Z"),
    blockNumber: 100n,
    staleAfterSeconds: 300,
    createdAt: new Date("2026-05-08T12:00:00.000Z"),
    updatedAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

function createResolvedPrice(
  overrides: Partial<ResolveBestPriceResult> & {
    selected?: PersistedPriceObservation | null;
  } = {},
): ResolveBestPriceResult {
  return {
    selected: createPriceObservation(),
    rejected: [],
    ...overrides,
  };
}

function createPnlWarning(overrides: Partial<PnLWarning> = {}): PnLWarning {
  return {
    code: "MARK_PRICE_UNAVAILABLE",
    detail: "mark unavailable",
    ...overrides,
  };
}

function createPnlResult(
  overrides: Partial<AverageCostPnlResult> = {},
): AverageCostPnlResult {
  return {
    walletId: WALLET_ID,
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET,
    quoteAsset: QUOTE_ASSET,
    holdingsQuantity: "5",
    averageCost: "1.5",
    realizedPnl: "0.5",
    unrealizedPnl: "2.5",
    markPrice: "2",
    totalAcquiredQuantity: "5",
    totalDisposedQuantity: "0",
    warnings: [],
    ...overrides,
  };
}

function createMemoryDb(overrides?: {
  tokenBalances?: TokenBalanceRecord[];
  lpPositions?: LpPositionRecord[];
  stakePositions?: StakePositionRecord[];
  ledgerEntries?: LedgerEntryRecord[];
  materializationStates?: MaterializationStateRecord[];
  tokens?: TokenRecord[];
}) {
  const tokenBalances = overrides?.tokenBalances ?? [];
  const lpPositions = overrides?.lpPositions ?? [];
  const stakePositions = overrides?.stakePositions ?? [];
  const ledgerEntries = overrides?.ledgerEntries ?? [];
  const materializationStates = overrides?.materializationStates ?? [];
  const tokens = overrides?.tokens ?? [];

  return new Proxy(
    {
      portfolioTokenBalance: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return tokenBalances.filter(
            (row) =>
              row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      portfolioLpPosition: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return lpPositions.filter(
            (row) =>
              row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      portfolioStakePosition: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return stakePositions.filter(
            (row) =>
              row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      ledgerEntry: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return ledgerEntries.filter(
            (row) =>
              row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      token: {
        async findMany(args: { where: { chainId: number; assetId: { in: string[] } } }) {
          return tokens.filter(
            (row) => row.chainId === args.where.chainId && args.where.assetId.in.includes(row.assetId),
          );
        },
      },
      portfolioMaterializationState: {
        async findUnique(args: {
          where: { walletId_chainId: { walletId: string; chainId: number } };
        }) {
          return (
            materializationStates.find(
              (row) =>
                row.walletId === args.where.walletId_chainId.walletId &&
                row.chainId === args.where.walletId_chainId.chainId,
            ) ?? null
          );
        },
      },
    },
    {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver);
        }
        throw new Error(`unexpected-db-access:${String(property)}`);
      },
    },
  );
}

