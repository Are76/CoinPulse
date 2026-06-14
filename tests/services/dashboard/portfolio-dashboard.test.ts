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

describe("assemblePortfolioDashboard", () => {
  it("assembles a portfolio with a priced token position", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            decimalsSource: "RPC",
            metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-05-08T11:59:00.000Z") }],
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.summary.totalValueQuote).toBe("10");
    expect(result.summary.valuationStatus).toBe("available");
    expect(result.summary.valuationCoverage).toEqual({
      totalPositions: 1,
      valuedPositions: 1,
      unvaluedPositions: 0,
    });
    expect(result.tokenPositions).toEqual([
      expect.objectContaining({
        assetId: TOKEN_ASSET,
        balanceQuantity: "5",
        metadataProvenance: {
          status: "observed",
          source: "chain",
          observedAt: "2026-05-08T11:59:00.000Z",
          confidence: "medium",
          conflictReason: null,
        },
        valuation: expect.objectContaining({
          status: "available",
          valueQuote: "10",
        }),
        pricing: expect.objectContaining({
          status: "available",
          sourceType: "ONCHAIN_POOL",
          confidence: "0.91",
        }),
        pnl: expect.objectContaining({
          status: "available",
          unrealizedPnl: "2.5",
          warnings: [],
        }),
      }),
    ]);
    expect(result.pnlCoverage).toEqual({
      status: "valued",
      reasons: [],
      affectedSections: [],
      pricedPositionsCount: 1,
      unpricedPositionsCount: 0,
      unsupportedPositionsCount: 0,
      incompleteBasisPositionsCount: 0,
      stalePricePositionsCount: 0,
      sourceDisabledPositionsCount: 0,
      asOf: "2026-05-08T12:04:00.000Z",
    });
    expect(typeof result.pnlCoverage.asOf).toBe("string");
    expect(Array.isArray(result.pnlCoverage.reasons)).toBe(true);
    expect(Array.isArray(result.pnlCoverage.affectedSections)).toBe(true);
    expect(typeof result.pnlCoverage.pricedPositionsCount).toBe("number");
    expect(typeof result.pnlCoverage.unpricedPositionsCount).toBe("number");
    expect(typeof result.pnlCoverage.unsupportedPositionsCount).toBe("number");
    expect(typeof result.pnlCoverage.incompleteBasisPositionsCount).toBe("number");
    expect(typeof result.pnlCoverage.stalePricePositionsCount).toBe("number");
    expect(typeof result.pnlCoverage.sourceDisabledPositionsCount).toBe("number");
    expect(result.materialization).toEqual({
      status: null,
      completedSuccessfully: null,
      lastAttemptedAt: null,
      latestMaterializedAt: null,
      updatedFromBlock: null,
      updatedToBlock: null,
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 0,
      warnings: [],
      errorMessage: null,
      hasNegativeBalances: false,
      negativeBalances: [],
      freshness: {
        status: "unknown",
        reason: "No materialization record exists.",
        lastMaterializedAt: null,
        staleAfterSeconds: null,
      },
    });
  });

  it("uses unknown metadata provenance when persisted token metadata is missing", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.tokenPositions[0].metadataProvenance).toEqual({
      status: "unknown",
      source: "unknown",
      observedAt: null,
      confidence: "unknown",
      conflictReason: null,
    });
    expect(result.tokenPositions[0]).not.toHaveProperty("tokenOrigin");
  });

  it("does not promote unknown token metadata from pricing availability or pricing confidence", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () =>
        createResolvedPrice({
          selected: createPriceObservation({
            confidence: "0.99",
            sourceType: "DEXSCREENER",
            sourceId: "dexscreener:pulsechain:0xpair",
          }),
        }),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.tokenPositions[0]).toMatchObject({
      metadataProvenance: {
        status: "unknown",
        source: "unknown",
        observedAt: null,
        confidence: "unknown",
        conflictReason: null,
      },
      pricing: {
        status: "available",
        sourceType: "DEXSCREENER",
        sourceId: "dexscreener:pulsechain:0xpair",
        confidence: "0.99",
      },
    });
    expect(result.tokenPositions[0]).not.toHaveProperty("tokenOrigin");
    expect(result.tokenPositions[0]).not.toHaveProperty("bridgeClassification");
  });

  it("keeps stablecoin-like unsupported metadata evidence unknown without origin or peg inference", async () => {
    const stablecoinLikeAsset = "chain:369:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: stablecoinLikeAsset,
            assetAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            balanceQuantity: "5",
            decimals: 6,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: stablecoinLikeAsset,
            decimalsSource: "SYMBOL:USDC",
            metadataSources: [
              {
                sourceKind: "SYMBOL:USDC",
                observedAt: new Date("2026-05-08T11:59:00.000Z"),
              },
            ],
          },
        ],
      }) as never,
      resolvePrice: async (args) =>
        createResolvedPrice({
          selected: createPriceObservation({
            assetId: args.assetId,
            assetAddress: args.assetId.split(":").at(-1) ?? null,
          }),
        }),
      calculatePnl: async (args) => createPnlResult({ assetId: args.assetId }),
    });

    expect(result.tokenPositions[0]).toMatchObject({
      assetId: stablecoinLikeAsset,
      assetAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      metadataProvenance: {
        status: "unknown",
        source: "unknown",
        observedAt: null,
        confidence: "unknown",
        conflictReason: null,
      },
    });
    // Metadata status values currently include verified/conflicting/stale/unknown/observed,
    // but no rejected/native/bridged/wrapped/canonical/trusted/origin status exists yet.
    expect(result.tokenPositions[0]).not.toHaveProperty("tokenOrigin");
    expect(result.tokenPositions[0]).not.toHaveProperty("bridgeClassification");
    expect(result.tokenPositions[0]).not.toHaveProperty("peg");
  });

  it("includes persisted materialization metadata when provenance exists", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.materialization).toEqual({
      status: "COMPLETED",
      completedSuccessfully: true,
      lastAttemptedAt: "2026-05-08T12:03:00.000Z",
      latestMaterializedAt: "2026-05-08T12:03:30.000Z",
      updatedFromBlock: "100",
      updatedToBlock: "120",
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 0,
      warnings: [],
      errorMessage: null,
      hasNegativeBalances: false,
      negativeBalances: [],
      freshness: {
        status: "fresh",
        reason: null,
        lastMaterializedAt: "2026-05-08T12:03:30.000Z",
        staleAfterSeconds: 900,
      },
    });
  });

  it("surfaces failed materialization status, warnings, and error without changing portfolio numbers", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: "chain:369:native:PLS",
            assetAddress: null,
            balanceQuantity: "-0.25",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "FAILED",
            completedSuccessfully: false,
            lastAttemptedAt: new Date("2026-05-08T12:04:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 2,
            warningDetails: [
              "negative-token-balance:chain:369:native:PLS:-0.25",
              "stake-key-missing:null",
            ],
            errorMessage: "materialization exploded",
          },
        ],
      }) as never,
      resolvePrice: async ({ assetId }) =>
        assetId === TOKEN_ASSET
          ? createResolvedPrice()
          : createResolvedPrice({
              selected: createPriceObservation({
                assetId: "chain:369:native:PLS",
                assetAddress: null,
                price: "1",
              }),
            }),
      calculatePnl: async (args) =>
        createPnlResult({
          assetId: args.assetId,
          holdingsQuantity: args.assetId === TOKEN_ASSET ? "5" : "-0.25",
          markPrice: args.assetId === TOKEN_ASSET ? "2" : "1",
          unrealizedPnl: args.assetId === TOKEN_ASSET ? "2.5" : "-0.25",
        }),
    });

    expect(result.summary.totalValueQuote).toBe("9.75");
    expect(result.materialization).toEqual({
      status: "FAILED",
      completedSuccessfully: false,
      lastAttemptedAt: "2026-05-08T12:04:00.000Z",
      latestMaterializedAt: "2026-05-08T12:03:30.000Z",
      updatedFromBlock: "100",
      updatedToBlock: "120",
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 2,
      warnings: [
        {
          code: "negative_token_balance",
          message: "Negative materialized token balance for chain:369:native:PLS: -0.25",
        },
        {
          code: "generic_persisted_warning",
          message: "stake-key-missing:null",
        },
      ],
      errorMessage: "materialization exploded",
      hasNegativeBalances: true,
      negativeBalances: [
        {
          assetId: "chain:369:native:PLS",
          assetAddress: null,
          balanceQuantity: "-0.25",
          decimals: 18,
        },
      ],
      freshness: {
        status: "fresh",
        reason: null,
        lastMaterializedAt: "2026-05-08T12:03:30.000Z",
        staleAfterSeconds: 900,
      },
    });
  });

  it("preserves separate token rows, pricing, PnL, and decimals for same-symbol asset variants", async () => {
    const sameSymbolAlpha = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sameSymbolBeta = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const resolvedPriceAssets: string[] = [];
    const pnlAssets: string[] = [];

    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolAlpha,
            assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            balanceQuantity: "3",
            decimals: 6,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolBeta,
            assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            balanceQuantity: "1",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async (args) => {
        resolvedPriceAssets.push(args.assetId);
        return createResolvedPrice({
          selected: createPriceObservation({
            id: args.assetId === sameSymbolAlpha ? "alpha-price" : "beta-price",
            assetId: args.assetId,
            assetAddress:
              args.assetId === sameSymbolAlpha
                ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            price: args.assetId === sameSymbolAlpha ? "5" : "2",
            sourceId: args.assetId === sameSymbolAlpha ? "pulsex:pair:alpha" : "pulsex:pair:beta",
            confidence: args.assetId === sameSymbolAlpha ? "0.91" : "0.89",
          }),
        });
      },
      calculatePnl: async (args) => {
        pnlAssets.push(args.assetId);
        return createPnlResult({
          assetId: args.assetId,
          holdingsQuantity: args.assetId === sameSymbolAlpha ? "3" : "1",
          averageCost: args.assetId === sameSymbolAlpha ? "4" : "1.5",
          unrealizedPnl: args.assetId === sameSymbolAlpha ? "3" : "0.5",
          markPrice: args.assetId === sameSymbolAlpha ? "5" : "2",
          totalAcquiredQuantity: args.assetId === sameSymbolAlpha ? "3" : "1",
        });
      },
    });

    expect(result.tokenPositions).toHaveLength(2);
    expect(result.tokenPositions.map((position) => position.assetId)).toEqual([
      sameSymbolAlpha,
      sameSymbolBeta,
    ]);
    expect(result.tokenPositions.map((position) => position.decimals)).toEqual([6, 18]);
    expect(result.tokenPositions.map((position) => position.metadataProvenance.status)).toEqual(["unknown", "unknown"]);
    expect(result.tokenPositions[0]).not.toHaveProperty("tokenOrigin");
    expect(result.tokenPositions.map((position) => position.valuation.valueQuote)).toEqual(["15", "2"]);
    expect(result.tokenPositions.map((position) => position.pricing.sourceId)).toEqual([
      "pulsex:pair:alpha",
      "pulsex:pair:beta",
    ]);
    expect(result.tokenPositions.map((position) => position.pnl.unrealizedPnl)).toEqual(["3", "0.5"]);
    expect(result.summary.totalValueQuote).toBe("17");
    expect(resolvedPriceAssets).toEqual([sameSymbolAlpha, sameSymbolBeta]);
    expect(pnlAssets).toEqual([sameSymbolAlpha, sameSymbolBeta]);
  });

  it("keeps native and ERC20 display-equivalent assets separate by explicit asset identity", async () => {
    const wrappedPlsAsset = "chain:369:erc20:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const resolvedPriceAssets: string[] = [];

    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: NATIVE_ASSET,
            assetAddress: null,
            balanceQuantity: "2",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: wrappedPlsAsset,
            assetAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            balanceQuantity: "4",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async (args) => {
        resolvedPriceAssets.push(args.assetId);
        return createResolvedPrice({
          selected: createPriceObservation({
            id: args.assetId === NATIVE_ASSET ? "native-pls-price" : "erc20-pls-price",
            assetId: args.assetId,
            assetAddress:
              args.assetId === NATIVE_ASSET
                ? null
                : "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            price: args.assetId === NATIVE_ASSET ? "1" : "3",
            sourceId:
              args.assetId === NATIVE_ASSET
                ? "native:oracle:pls"
                : "pulsex:pair:wrapped-pls",
          }),
        });
      },
      calculatePnl: async (args) =>
        createPnlResult({
          assetId: args.assetId,
          holdingsQuantity: args.assetId === NATIVE_ASSET ? "2" : "4",
          markPrice: args.assetId === NATIVE_ASSET ? "1" : "3",
          unrealizedPnl: args.assetId === NATIVE_ASSET ? "1" : "8",
        }),
    });

    expect(result.tokenPositions).toEqual([
      expect.objectContaining({
        assetId: NATIVE_ASSET,
        assetAddress: null,
        decimals: 18,
        valuation: expect.objectContaining({ valueQuote: "2" }),
        pricing: expect.objectContaining({ sourceId: "native:oracle:pls" }),
      }),
      expect.objectContaining({
        assetId: wrappedPlsAsset,
        assetAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        decimals: 18,
        valuation: expect.objectContaining({ valueQuote: "12" }),
        pricing: expect.objectContaining({ sourceId: "pulsex:pair:wrapped-pls" }),
      }),
    ]);
    expect(result.summary.totalValueQuote).toBe("14");
    expect(resolvedPriceAssets).toEqual([NATIVE_ASSET, wrappedPlsAsset]);
  });

  it("returns an explicit unpriced token position status", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: null,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({ selected: null, rejected: [] }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [createPnlWarning()],
        }),
    });

    expect(result.summary.totalValueQuote).toBeNull();
    expect(result.summary.valuationStatus).toBe("unavailable");
    expect(result.tokenPositions[0]).toMatchObject({
      assetId: TOKEN_ASSET,
      decimals: null,
      pricing: { status: "unavailable" },
      valuation: { status: "unavailable", valueQuote: null },
      pnl: {
        status: "unavailable",
        unrealizedPnl: null,
        markPrice: null,
      },
    });
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: ["unpriced"],
      affectedSections: ["summary", "tokens"],
      pricedPositionsCount: 0,
      unpricedPositionsCount: 1,
      unsupportedPositionsCount: 0,
      incompleteBasisPositionsCount: 0,
      stalePricePositionsCount: 0,
      sourceDisabledPositionsCount: 0,
      asOf: "2026-05-08T12:04:00.000Z",
    });
  });

  it("surfaces stale price status explicitly", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [{ id: "obs-1", reason: "STALE" }],
      }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [createPnlWarning()],
        }),
    });

    expect(result.tokenPositions[0]?.pricing.status).toBe("stale_price");
  });

  it("surfaces low-confidence price status explicitly", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [{ id: "obs-1", reason: "LOW_CONFIDENCE" }],
      }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [createPnlWarning()],
        }),
    });

    expect(result.tokenPositions[0]?.pricing.status).toBe("low_confidence_price");
  });

  it("propagates stale mark price conditions to token pnl status without zero coercion", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [{ id: "obs-stale", reason: "STALE" }],
      }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "MARK_PRICE_UNAVAILABLE",
              detail: "Mark price is stale and unavailable for dashboard PnL.",
            }),
          ],
        }),
    });

    expect(result.tokenPositions[0]?.pricing).toMatchObject({
      status: "stale_price",
      rejectedReasons: ["STALE"],
    });
    expect(result.tokenPositions[0]?.valuation).toEqual({ status: "stale_price", valueQuote: null });
    expect(result.tokenPositions[0]?.pnl).toMatchObject({
      status: "stale_price",
      unrealizedPnl: null,
      markPrice: null,
      warnings: [expect.objectContaining({ code: "MARK_PRICE_UNAVAILABLE" })],
    });
    expect(result.summary.warnings).toEqual([
      `pnl-warning:MARK_PRICE_UNAVAILABLE`,
      `pricing-unavailable:${TOKEN_ASSET}:stale_price`,
    ]);
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: ["unpriced", "stale_price"],
      affectedSections: ["summary", "tokens"],
      unpricedPositionsCount: 1,
      stalePricePositionsCount: 1,
    });
  });

  it("propagates low-confidence mark price conditions to token pnl status without zero coercion", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [{ id: "obs-low-confidence", reason: "LOW_CONFIDENCE" }],
      }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "MARK_PRICE_UNAVAILABLE",
              detail: "Mark price was rejected below confidence threshold.",
            }),
          ],
        }),
    });

    expect(result.tokenPositions[0]?.pricing).toMatchObject({
      status: "low_confidence_price",
      rejectedReasons: ["LOW_CONFIDENCE"],
    });
    expect(result.tokenPositions[0]?.valuation).toEqual({ status: "low_confidence_price", valueQuote: null });
    expect(result.tokenPositions[0]?.pnl).toMatchObject({
      status: "low_confidence_price",
      unrealizedPnl: null,
      markPrice: null,
      warnings: [expect.objectContaining({ code: "MARK_PRICE_UNAVAILABLE" })],
    });
    expect(result.summary.warnings).toEqual([
      `pnl-warning:MARK_PRICE_UNAVAILABLE`,
      `pricing-unavailable:${TOKEN_ASSET}:low_confidence_price`,
    ]);
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: ["unpriced"],
      affectedSections: ["summary", "tokens"],
      unpricedPositionsCount: 1,
      stalePricePositionsCount: 0,
    });
  });


  it("aggregates summary warnings by backend code and asset identity instead of display symbol", async () => {
    const sameSymbolAlpha = "chain:369:erc20:0xcccccccccccccccccccccccccccccccccccccccc";
    const sameSymbolBeta = "chain:369:erc20:0xdddddddddddddddddddddddddddddddddddddddd";

    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolAlpha,
            assetAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
            balanceQuantity: "10",
            decimals: 6,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolBeta,
            assetAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
            balanceQuantity: "7",
            decimals: 6,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        // Dashboard DTOs intentionally do not expose symbol/name fields. These two
        // balances model display-equivalent token records by sharing metadata provenance
        // evidence while keeping distinct asset ids and contract addresses.
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: sameSymbolAlpha,
            decimalsSource: "RPC",
            metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-05-08T11:59:00.000Z") }],
          },
          {
            chainId: CHAIN_ID,
            assetId: sameSymbolBeta,
            decimalsSource: "RPC",
            metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-05-08T11:59:30.000Z") }],
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [],
      }),
      calculatePnl: async (args) =>
        createPnlResult({
          assetId: args.assetId,
          holdingsQuantity: args.assetId === sameSymbolAlpha ? "10" : "7",
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "MARK_PRICE_UNAVAILABLE",
              detail: `Mark price unavailable for ${args.assetId}.`,
            }),
          ],
        }),
    });

    expect(result.tokenPositions.map((position) => position.assetId)).toEqual([sameSymbolAlpha, sameSymbolBeta]);
    expect(result.tokenPositions.map((position) => position.assetAddress)).toEqual([
      "0xcccccccccccccccccccccccccccccccccccccccc",
      "0xdddddddddddddddddddddddddddddddddddddddd",
    ]);
    expect(result.tokenPositions.map((position) => position.metadataProvenance)).toEqual([
      {
        status: "observed",
        source: "chain",
        observedAt: "2026-05-08T11:59:00.000Z",
        confidence: "medium",
        conflictReason: null,
      },
      {
        status: "observed",
        source: "chain",
        observedAt: "2026-05-08T11:59:30.000Z",
        confidence: "medium",
        conflictReason: null,
      },
    ]);
    expect(result.summary.warnings).toEqual([
      "pnl-warning:MARK_PRICE_UNAVAILABLE",
      `pricing-unavailable:${sameSymbolAlpha}:unavailable`,
      `pricing-unavailable:${sameSymbolBeta}:unavailable`,
    ]);
    expect(JSON.stringify(result.summary.warnings)).not.toMatch(/USDC|USD Coin|symbol|name/i);
  });

  it("keeps materialization warning aggregation keyed by backend code and asset identity", async () => {
    const sameSymbolAlpha = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sameSymbolBeta = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolAlpha,
            assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            balanceQuantity: "-1",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolBeta,
            assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            balanceQuantity: "-1",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: 100n,
            sourceLedgerToBlock: 120n,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 2,
            warningDetails: [
              `negative-token-balance:${sameSymbolAlpha}:-1`,
              `negative-token-balance:${sameSymbolBeta}:-1`,
            ],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async (args) =>
        createResolvedPrice({
          selected: createPriceObservation({
            assetId: args.assetId,
            assetAddress: args.assetId === sameSymbolAlpha
              ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
              : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            price: "1",
          }),
        }),
      calculatePnl: async (args) =>
        createPnlResult({
          assetId: args.assetId,
          holdingsQuantity: "-1",
          markPrice: "1",
          unrealizedPnl: "-1",
        }),
    });

    expect(result.materialization.warnings).toHaveLength(2);
    expect(result.materialization.warnings).toEqual(
      expect.arrayContaining([
        {
          code: "negative_token_balance",
          message: `Negative materialized token balance for ${sameSymbolAlpha}: -1`,
        },
        {
          code: "negative_token_balance",
          message: `Negative materialized token balance for ${sameSymbolBeta}: -1`,
        },
      ]),
    );
    const negativeBalanceAssetIds =
      result.materialization.negativeBalances.map(
        (balance) => balance.assetId,
      );

    expect(negativeBalanceAssetIds).toHaveLength(2);

    expect(negativeBalanceAssetIds).toEqual(
      expect.arrayContaining([
        sameSymbolAlpha,
        sameSymbolBeta,
      ]),
    );
    expect(result.materialization.warningCount).toBe(2);
  });

  it("preserves current PnL contract fields without exposing unsafe percentage metrics", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: 50n,
            sourceLedgerToBlock: 200n,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          averageCost: "0",
          realizedPnl: "0",
          unrealizedPnl: "10",
          markPrice: "2",
          totalAcquiredQuantity: "5",
          totalDisposedQuantity: "0",
        }),
    });

    const token = result.tokenPositions[0];
    expect(token).toMatchObject({
      pricing: {
        status: "available",
        sourceType: "ONCHAIN_POOL",
        sourceId: "pulsex:pair:0xpair",
        confidence: "0.91",
        observedAt: "2026-05-08T12:00:00.000Z",
        staleAfterSeconds: 300,
        rejectedReasons: [],
      },
      valuation: { status: "available", valueQuote: "10" },
      pnl: {
        status: "available",
        holdingsQuantity: "5",
        averageCost: "0",
        realizedPnl: "0",
        unrealizedPnl: "10",
        markPrice: "2",
        totalAcquiredQuantity: "5",
        totalDisposedQuantity: "0",
        warnings: [],
      },
    });
    expect(token?.pnl).not.toHaveProperty("pnlPercent");
    expect(token?.pnl).not.toHaveProperty("roi");
    expect(result.materialization.freshness).toEqual({
      status: "fresh",
      reason: null,
      lastMaterializedAt: "2026-05-08T12:03:30.000Z",
      staleAfterSeconds: 900,
    });
    expect(result.ledgerCoverage).toEqual({
      status: "covered",
      fromBlock: "50",
      toBlock: "200",
      sourceFamilies: [],
      reason: null,
    });
  });

  it("maps insufficient cost basis warnings to incomplete basis without fake PnL values", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          averageCost: "0",
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "INSUFFICIENT_COST_BASIS",
              detail: "Disposition exceeds tracked holdings and was skipped.",
            }),
          ],
        }),
    });

    expect(result.tokenPositions[0]?.pnl).toMatchObject({
      status: "incomplete_basis",
      averageCost: "0",
      unrealizedPnl: null,
      markPrice: null,
      warnings: [expect.objectContaining({ code: "INSUFFICIENT_COST_BASIS" })],
    });
    expect(result.tokenPositions[0]?.pnl.realizedPnl).not.toBe("0");
    expect(result.tokenPositions[0]?.pnl.unrealizedPnl).toBeNull();
    expect(result.tokenPositions[0]?.pnl.markPrice).toBeNull();
    expect(result.tokenPositions[0]?.valuation.valueQuote).toBe("10");
    expect(result.tokenPositions[0]?.pnl).not.toHaveProperty("pnlPercent");
    expect(result.tokenPositions[0]?.pnl).not.toHaveProperty("roi");
    expect(result.tokenPositions[0]?.pnl).not.toHaveProperty("nativePnl");
    expect(result.summary.warnings).toContain("pnl-warning:INSUFFICIENT_COST_BASIS");
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: ["insufficient_cost_basis"],
      incompleteBasisPositionsCount: 1,
    });
  });


  it("surfaces pnl warnings in the token dto", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          warnings: [
            createPnlWarning({
              code: "MARK_PRICE_UNAVAILABLE",
              detail: "resolved mark price unavailable",
            }),
          ],
          unrealizedPnl: null,
          markPrice: null,
        }),
    });

    expect(result.tokenPositions[0]?.pnl).toMatchObject({
      status: "unavailable",
      warnings: [
        expect.objectContaining({
          code: "MARK_PRICE_UNAVAILABLE",
        }),
      ],
    });
    expect(result.summary.warnings).toContain("pnl-warning:MARK_PRICE_UNAVAILABLE");
  });

  it("keeps unsupported action group warnings explicit without fabricated token PnL", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "UNSUPPORTED_ACTION_GROUP",
              detail: "Unsupported action group cannot be converted into deterministic PnL.",
            }),
          ],
        }),
    });

    expect(result.tokenPositions[0]?.pnl).toMatchObject({
      status: "incomplete_basis",
      holdingsQuantity: "5",
      unrealizedPnl: null,
      markPrice: null,
      warnings: [
        {
          code: "UNSUPPORTED_ACTION_GROUP",
          detail: "Unsupported action group cannot be converted into deterministic PnL.",
        },
      ],
    });
    expect(result.summary.warnings).toEqual(["pnl-warning:UNSUPPORTED_ACTION_GROUP"]);
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: ["insufficient_cost_basis"],
      incompleteBasisPositionsCount: 1,
      pricedPositionsCount: 0,
    });
  });

  it("keeps pnl warning summary aggregation stable and de-duplicated by warning code", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({ code: "MARK_PRICE_UNAVAILABLE", detail: "mark unavailable one" }),
            createPnlWarning({ code: "INSUFFICIENT_COST_BASIS", detail: "basis incomplete" }),
            createPnlWarning({ code: "MARK_PRICE_UNAVAILABLE", detail: "mark unavailable two" }),
          ],
        }),
    });

    expect(result.tokenPositions[0]?.pnl.warnings.map((warning) => warning.code)).toEqual([
      "MARK_PRICE_UNAVAILABLE",
      "INSUFFICIENT_COST_BASIS",
      "MARK_PRICE_UNAVAILABLE",
    ]);
    expect(result.summary.warnings).toEqual([
      "pnl-warning:INSUFFICIENT_COST_BASIS",
      "pnl-warning:MARK_PRICE_UNAVAILABLE",
    ]);
  });

  it("includes lp and stake positions without fabricating valuation", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "1",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        lpPositions: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            lpAssetId: LP_ASSET,
            lpTokenAddress: LP_ADDRESS,
            lpTokenQuantity: "0.5",
            token0AssetId: TOKEN_ASSET,
            token0Address: TOKEN_ADDRESS,
            token1AssetId: "chain:369:erc20:0xother",
            token1Address: "0xother",
            token0NetQuantity: "1",
            token1NetQuantity: "2",
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        stakePositions: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            stakeKey: "42",
            tokenAssetId: STAKE_ASSET,
            tokenAddress: STAKE_ADDRESS,
            principalQuantity: "100",
            returnedQuantity: "0",
            yieldQuantity: null,
            penaltyQuantity: null,
            status: "ACTIVE",
            startBlock: null,
            endBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice({ selected: createPriceObservation({ price: "3" }) }),
      calculatePnl: async () => createPnlResult({ holdingsQuantity: "1", markPrice: "3", unrealizedPnl: "1.5" }),
    });

    expect(result.summary.valuationStatus).toBe("partial");
    expect(result.lpPositions[0]).toMatchObject({
      valuation: { status: "unsupported", valueQuote: null },
      pnl: {
        status: "unsupported",
        holdingsQuantity: null,
        averageCost: null,
        realizedPnl: null,
        unrealizedPnl: null,
        markPrice: null,
        totalAcquiredQuantity: null,
        totalDisposedQuantity: null,
      },
    });
    expect(result.stakePositions[0]).toMatchObject({
      valuation: { status: "unsupported", valueQuote: null },
      pnl: {
        status: "unsupported",
        holdingsQuantity: null,
        averageCost: null,
        realizedPnl: null,
        unrealizedPnl: null,
        markPrice: null,
        totalAcquiredQuantity: null,
        totalDisposedQuantity: null,
      },
    });
    expect(result.pnlCoverage).toMatchObject({
      status: "partial",
      reasons: ["unsupported_position_type"],
      affectedSections: ["summary", "lpPositions", "stakePositions"],
      pricedPositionsCount: 1,
      unsupportedPositionsCount: 2,
    });
  });

  it("assembles without rpc usage or unexpected dependencies", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "1",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
        ledgerEntries: [
          {
            id: "entry-1",
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            entryType: "SWAP_IN",
            actionType: "SWAP",
            direction: "IN",
            quantity: "1",
            occurredAt: new Date("2026-05-08T12:00:00.000Z"),
            actionGroupId: "group-1",
            txHash: "0xtx",
            sourceLogKey: "log:0xtx:0",
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.schemaVersion).toBe("v1");
  });

  it("keeps the dashboard module backend-only with no ui directives", () => {
    const source = readFileSync(
      join(process.cwd(), "src/services/dashboard/portfolio-dashboard.ts"),
      "utf8",
    );

    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("React");
    expect(source).not.toContain("return (");
  });

  it("ledgerCoverage is unknown when no materialization state exists", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb() as never,
      resolvePrice: async () => createResolvedPrice({ selected: null, rejected: [] }),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.ledgerCoverage).toEqual({
      status: "unknown",
      fromBlock: null,
      toBlock: null,
      sourceFamilies: [],
      reason: "No materialization record exists.",
    });
  });

  it("ledgerCoverage is unknown when materialization exists but sourceLedger blocks are null", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice({ selected: null, rejected: [] }),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.ledgerCoverage).toEqual({
      status: "unknown",
      fromBlock: null,
      toBlock: null,
      sourceFamilies: [],
      reason: "No block range recorded in persisted materialization state.",
    });
  });

  it("ledgerCoverage is covered when both sourceLedgerFromBlock and sourceLedgerToBlock are present", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: 50n,
            sourceLedgerToBlock: 200n,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice({ selected: null, rejected: [] }),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.ledgerCoverage).toEqual({
      status: "covered",
      fromBlock: "50",
      toBlock: "200",
      sourceFamilies: [],
      reason: null,
    });
  });

  it("ledgerCoverage is partial when only sourceLedgerFromBlock is present", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "RUNNING",
            completedSuccessfully: false,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: null,
            sourceLedgerFromBlock: 50n,
            sourceLedgerToBlock: null,
            updatedFromBlock: null,
            updatedToBlock: null,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice({ selected: null, rejected: [] }),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.ledgerCoverage).toEqual({
      status: "partial",
      fromBlock: "50",
      toBlock: null,
      sourceFamilies: [],
      reason: "Only a partial block range is recorded in persisted materialization state.",
    });
  });

  it("existing materialization.freshness is unchanged after ledgerCoverage addition", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: 50n,
            sourceLedgerToBlock: 200n,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    expect(result.materialization.freshness).toEqual({
      status: "fresh",
      reason: null,
      lastMaterializedAt: "2026-05-08T12:03:30.000Z",
      staleAfterSeconds: 900,
    });
    expect(result.ledgerCoverage.status).toBe("covered");
    expect(result.ledgerCoverage.fromBlock).toBe("50");
    expect(result.ledgerCoverage.toBlock).toBe("200");
  });

  it("records source_disabled in pnlCoverage when the only available observation is from a disabled source", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({
        selected: null,
        rejected: [{ id: "obs-1", reason: "SOURCE_DISABLED" }],
      }),
      calculatePnl: async () =>
        createPnlResult({
          unrealizedPnl: null,
          markPrice: null,
          warnings: [createPnlWarning()],
        }),
    });

    expect(result.tokenPositions[0]?.pricing.status).toBe("unavailable");
    expect(result.tokenPositions[0]?.pricing.rejectedReasons).toContain("SOURCE_DISABLED");
    expect(result.pnlCoverage).toMatchObject({
      status: "unavailable",
      reasons: expect.arrayContaining(["source_disabled"]),
      affectedSections: expect.arrayContaining(["tokens", "summary"]),
      sourceDisabledPositionsCount: 1,
    });
  });

  it("does not produce partial_history or missing_disposal_events even when a token has insufficient cost basis warnings", async () => {
    // INSUFFICIENT_COST_BASIS (disposal > tracked holdings) is the scenario most
    // adjacent to partial history / missing disposal events. Neither deferred reason
    // should appear; the current contract maps this to insufficient_cost_basis only.
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () =>
        createPnlResult({
          averageCost: "0",
          unrealizedPnl: null,
          markPrice: null,
          warnings: [
            createPnlWarning({
              code: "INSUFFICIENT_COST_BASIS",
              detail: "Disposition exceeds tracked holdings and was skipped.",
            }),
          ],
        }),
    });

    expect(result.pnlCoverage.reasons).toContain("insufficient_cost_basis");
    expect(result.pnlCoverage.reasons).not.toContain("partial_history");
    expect(result.pnlCoverage.reasons).not.toContain("missing_disposal_events");
  });

  it("does not produce missing_native_price_history for a native-asset token balance", async () => {
    // Native-asset balance (chain:369:native:PLS) is the scenario most adjacent to
    // missing_native_price_history. The current contract does not emit that reason
    // regardless of position type or pricing state.
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T12:04:00.000Z"),
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: NATIVE_ASSET,
            assetAddress: null,
            balanceQuantity: "1000",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
          },
        ],
      }) as never,
      resolvePrice: async () => ({ selected: null, rejected: [] }),
      calculatePnl: async () =>
        createPnlResult({
          assetId: NATIVE_ASSET,
          unrealizedPnl: null,
          markPrice: null,
          warnings: [createPnlWarning()],
        }),
    });

    expect(result.pnlCoverage.reasons).not.toContain("missing_native_price_history");
  });
});
