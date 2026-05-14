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
}) {
  const tokenBalances = overrides?.tokenBalances ?? [];
  const lpPositions = overrides?.lpPositions ?? [];
  const stakePositions = overrides?.stakePositions ?? [];
  const ledgerEntries = overrides?.ledgerEntries ?? [];
  const materializationStates = overrides?.materializationStates ?? [];

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
      pricing: { status: "unavailable" },
      valuation: { status: "unavailable", valueQuote: null },
      pnl: { status: "unavailable" },
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
    expect(result.tokenPositions[0]?.pnl).not.toHaveProperty("pnlPercent");
    expect(result.tokenPositions[0]?.pnl).not.toHaveProperty("roi");
    expect(result.summary.warnings).toContain("pnl-warning:INSUFFICIENT_COST_BASIS");
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
    });
    expect(result.stakePositions[0]).toMatchObject({
      valuation: { status: "unsupported", valueQuote: null },
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

    expect(source).not.toContain("\"use client\"");
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
});
