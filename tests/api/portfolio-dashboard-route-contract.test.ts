import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersistedPriceObservation } from "@/services/pricing/types";

const WALLET_ID = "wallet-1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const TOKEN_ASSET = "chain:369:erc20:0xtoken";
const TOKEN_ADDRESS = "0xtoken";
const NATIVE_ASSET = "chain:369:native:PLS";

type WalletRecord = {
  id: string;
  address: string;
  addressLower: string;
  chainId: number;
};

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

type LedgerEntryRecord = {
  id: string;
  chainId: number;
  walletId: string;
  assetId: string;
  entryType: string;
  direction: string;
  quantity: string;
  occurredAt: Date;
  actionGroupId: string;
  txHash: string;
  sourceLogKey: string | null;
  actionGroup: { actionType: string };
};

type TokenRecord = {
  chainId: number;
  assetId: string;
  decimalsSource: string | null;
  metadataSources?: Array<{ sourceKind: "SEED" | "RPC" | "MANUAL" | string; observedAt: Date | null }>;
};

type LpPositionRecord = {
  walletId: string;
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

function createMemoryDb(overrides?: {
  wallets?: WalletRecord[];
  tokenBalances?: TokenBalanceRecord[];
  ledgerEntries?: LedgerEntryRecord[];
  materializationStates?: MaterializationStateRecord[];
  priceObservations?: PersistedPriceObservation[];
  tokens?: TokenRecord[];
  lpPositions?: LpPositionRecord[];
}) {
  const wallets = overrides?.wallets ?? [];
  const tokenBalances = overrides?.tokenBalances ?? [];
  const ledgerEntries = overrides?.ledgerEntries ?? [];
  const materializationStates = overrides?.materializationStates ?? [];
  const priceObservations = overrides?.priceObservations ?? [];
  const tokens = overrides?.tokens ?? [];
  const lpPositions = overrides?.lpPositions ?? [];

  return new Proxy(
    {
      wallet: {
        async findUnique(args: {
          where: { chainId_addressLower: { chainId: number; addressLower: string } };
        }) {
          return (
            wallets.find(
              (row) =>
                row.chainId === args.where.chainId_addressLower.chainId &&
                row.addressLower === args.where.chainId_addressLower.addressLower,
            ) ?? null
          );
        },
      },
      portfolioTokenBalance: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return tokenBalances.filter(
            (row) => row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      portfolioLpPosition: {
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return lpPositions.filter(
            (row) => row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );
        },
      },
      portfolioStakePosition: {
        async findMany() {
          return [];
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
      ledgerEntry: {
        async findMany(args: {
          where: { walletId: string; chainId: number };
          include?: { actionGroup: { select: { actionType: true } } };
        }) {
          const rows = ledgerEntries.filter(
            (row) => row.walletId === args.where.walletId && row.chainId === args.where.chainId,
          );

          if (args.include?.actionGroup.select.actionType) {
            return rows;
          }

          return rows.map(({ actionGroup, ...row }) => {
            void actionGroup;
            return row;
          });
        },
      },
      token: {
        async findMany(args: { where: { chainId: number; assetId: { in: string[] } } }) {
          return tokens.filter(
            (row) => row.chainId === args.where.chainId && args.where.assetId.in.includes(row.assetId),
          );
        },
      },
      priceObservation: {
        async findMany(args: {
          where?: {
            chainId?: number;
            assetId?: string;
            quoteAsset?: string;
          };
        }) {
          return priceObservations.filter((row) => {
            const where = args.where ?? {};
            return (
              (where.chainId === undefined || row.chainId === where.chainId) &&
              (where.assetId === undefined || row.assetId === where.assetId) &&
              (where.quoteAsset === undefined || row.quoteAsset === where.quoteAsset)
            );
          });
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

const getDb = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb,
}));

describe("GET /api/portfolio/dashboard route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns materialization metadata from persisted provenance without changing dashboard numbers", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [createPriceObservation()],
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            decimalsSource: "RPC",
            metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-05-08T11:59:00.000Z") }],
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        wallet: {
          id: WALLET_ID,
          address: WALLET_ADDRESS,
          chainId: CHAIN_ID,
        },
        summary: {
          totalValueQuote: "10",
          valuationStatus: "available",
        },
        tokenPositions: [
          expect.objectContaining({
            assetId: TOKEN_ASSET,
            metadataProvenance: {
              status: "observed",
              source: "chain",
              observedAt: "2026-05-08T11:59:00.000Z",
              confidence: "medium",
              conflictReason: null,
            },
          }),
        ],
        materialization: {
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
        },
      },
    });
  });

  it("preserves separate token rows for same-symbol different-contract assets", async () => {
    const sameSymbolAlpha = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sameSymbolBeta = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolAlpha,
            assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            balanceQuantity: "3",
            decimals: 6,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: sameSymbolBeta,
            assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            balanceQuantity: "1",
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
        priceObservations: [
          createPriceObservation({
            id: "alpha-price",
            assetId: sameSymbolAlpha,
            assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            price: "5",
            sourceId: "pulsex:pair:alpha",
          }),
          createPriceObservation({
            id: "beta-price",
            assetId: sameSymbolBeta,
            assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            price: "2",
            sourceId: "pulsex:pair:beta",
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.tokenPositions).toEqual([
      expect.objectContaining({
        assetId: sameSymbolAlpha,
        assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        balanceQuantity: "3",
        decimals: 6,
        metadataProvenance: expect.objectContaining({ status: "unknown" }),
        pricing: expect.objectContaining({ sourceId: "pulsex:pair:alpha" }),
        valuation: expect.objectContaining({ valueQuote: "15" }),
      }),
      expect.objectContaining({
        assetId: sameSymbolBeta,
        assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        balanceQuantity: "1",
        decimals: 18,
        metadataProvenance: expect.objectContaining({ status: "unknown" }),
        pricing: expect.objectContaining({ sourceId: "pulsex:pair:beta" }),
        valuation: expect.objectContaining({ valueQuote: "2" }),
      }),
    ]);
    expect(body.data.tokenPositions[0]).not.toHaveProperty("tokenOrigin");
    expect(body.data.tokenPositions[1]).not.toHaveProperty("tokenOrigin");
    expect(body.data.summary).toMatchObject({
      totalValueQuote: "17",
      valuationCoverage: { totalPositions: 2, valuedPositions: 2, unvaluedPositions: 0 },
    });
  });

  it("preserves backend-computed PnL fields and pricing provenance in the response envelope", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "6",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        ledgerEntries: [
          {
            id: "buy-target",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: TOKEN_ASSET,
            entryType: "SWAP_IN",
            direction: "IN",
            quantity: "10",
            occurredAt: new Date("2026-05-08T12:00:00.000Z"),
            actionGroupId: "group-1",
            txHash: "0xtx-1",
            sourceLogKey: "log:0xtx-1:0",
            actionGroup: { actionType: "SWAP" },
          },
          {
            id: "buy-pls",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: NATIVE_ASSET,
            entryType: "SWAP_OUT",
            direction: "OUT",
            quantity: "100",
            occurredAt: new Date("2026-05-08T12:00:00.000Z"),
            actionGroupId: "group-1",
            txHash: "0xtx-1",
            sourceLogKey: "log:0xtx-1:1",
            actionGroup: { actionType: "SWAP" },
          },
          {
            id: "sell-target",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: TOKEN_ASSET,
            entryType: "SWAP_OUT",
            direction: "OUT",
            quantity: "4",
            occurredAt: new Date("2026-05-08T13:00:00.000Z"),
            actionGroupId: "group-2",
            txHash: "0xtx-2",
            sourceLogKey: "log:0xtx-2:0",
            actionGroup: { actionType: "SWAP" },
          },
          {
            id: "sell-pls",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: NATIVE_ASSET,
            entryType: "SWAP_IN",
            direction: "IN",
            quantity: "60",
            occurredAt: new Date("2026-05-08T13:00:00.000Z"),
            actionGroupId: "group-2",
            txHash: "0xtx-2",
            sourceLogKey: "log:0xtx-2:1",
            actionGroup: { actionType: "SWAP" },
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T13:59:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T13:59:30.000Z"),
            sourceLedgerFromBlock: 50n,
            sourceLedgerToBlock: 200n,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
        priceObservations: [
          createPriceObservation({
            id: "pls-buy",
            assetId: NATIVE_ASSET,
            assetAddress: null,
            price: "1",
            observedAt: new Date("2026-05-08T12:00:00.000Z"),
          }),
          createPriceObservation({
            id: "pls-sell",
            assetId: NATIVE_ASSET,
            assetAddress: null,
            price: "1",
            observedAt: new Date("2026-05-08T13:00:00.000Z"),
          }),
          createPriceObservation({
            id: "target-mark",
            price: "15",
            confidence: "0.95",
            observedAt: new Date("2026-05-08T14:00:00.000Z"),
            staleAfterSeconds: 300,
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T14:00:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        summary: {
          totalValueQuote: "90",
          valuationStatus: "available",
          warnings: [],
        },
        tokenPositions: [
          {
            assetId: TOKEN_ASSET,
            balanceQuantity: "6",
            pricing: {
              status: "available",
              sourceType: "ONCHAIN_POOL",
              sourceId: "pulsex:pair:0xpair",
              confidence: "0.95",
              observedAt: "2026-05-08T14:00:00.000Z",
              staleAfterSeconds: 300,
              rejectedReasons: [],
            },
            valuation: {
              status: "available",
              valueQuote: "90",
            },
            pnl: {
              status: "available",
              holdingsQuantity: "6",
              averageCost: "10",
              realizedPnl: "20",
              unrealizedPnl: "30",
              markPrice: "15",
              totalAcquiredQuantity: "10",
              totalDisposedQuantity: "4",
              warnings: [],
            },
          },
        ],
        materialization: {
          freshness: {
            status: "fresh",
            reason: null,
            lastMaterializedAt: "2026-05-08T13:59:30.000Z",
            staleAfterSeconds: 900,
          },
        },
        ledgerCoverage: {
          status: "covered",
          fromBlock: "50",
          toBlock: "200",
          sourceFamilies: [],
          reason: null,
        },
        pnlCoverage: {
          status: "valued",
          reasons: [],
          affectedSections: [],
          pricedPositionsCount: 1,
          unpricedPositionsCount: 0,
          unsupportedPositionsCount: 0,
          incompleteBasisPositionsCount: 0,
          stalePricePositionsCount: 0,
          sourceDisabledPositionsCount: 0,
          asOf: "2026-05-08T14:00:00.000Z",
        },
      },
    });
    expect(typeof body.data.pnlCoverage.asOf).toBe("string");
    expect(Array.isArray(body.data.pnlCoverage.reasons)).toBe(true);
    expect(Array.isArray(body.data.pnlCoverage.affectedSections)).toBe(true);
    expect(typeof body.data.pnlCoverage.pricedPositionsCount).toBe("number");
    expect(typeof body.data.pnlCoverage.unpricedPositionsCount).toBe("number");
    expect(typeof body.data.pnlCoverage.unsupportedPositionsCount).toBe("number");
    expect(typeof body.data.pnlCoverage.incompleteBasisPositionsCount).toBe("number");
    expect(typeof body.data.pnlCoverage.stalePricePositionsCount).toBe("number");
    expect(typeof body.data.pnlCoverage.sourceDisabledPositionsCount).toBe("number");
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("pnlPercent");
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("roi");
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("nativePnl");
    expect(body.data.summary).not.toHaveProperty("nativePnl");
  });

  it("keeps unpriced PnL unavailable instead of returning misleading zero values", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            assetAddress: TOKEN_ADDRESS,
            balanceQuantity: "10",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
        ledgerEntries: [
          {
            id: "airdrop-target",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: TOKEN_ASSET,
            entryType: "RECEIVE",
            direction: "IN",
            quantity: "10",
            occurredAt: new Date("2026-05-08T12:00:00.000Z"),
            actionGroupId: "group-airdrop",
            txHash: "0xtx-airdrop",
            sourceLogKey: "log:0xtx-airdrop:0",
            actionGroup: { actionType: "TRANSFER" },
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
            sourceLedgerToBlock: null,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
        priceObservations: [],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        summary: {
          totalValueQuote: null,
          valuationStatus: "unavailable",
          warnings: [
            "pnl-warning:MARK_PRICE_UNAVAILABLE",
            `pricing-unavailable:${TOKEN_ASSET}:unavailable`,
          ],
        },
        tokenPositions: [
          {
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: [],
            },
            valuation: {
              status: "unavailable",
              valueQuote: null,
            },
            pnl: {
              status: "unavailable",
              holdingsQuantity: "10",
              averageCost: "0",
              realizedPnl: "0",
              unrealizedPnl: null,
              markPrice: null,
              totalAcquiredQuantity: "10",
              totalDisposedQuantity: "0",
              warnings: [expect.objectContaining({ code: "MARK_PRICE_UNAVAILABLE" })],
            },
          },
        ],
        materialization: {
          freshness: {
            status: "fresh",
            reason: null,
            lastMaterializedAt: "2026-05-08T12:03:30.000Z",
            staleAfterSeconds: 900,
          },
        },
        ledgerCoverage: {
          status: "partial",
          fromBlock: "50",
          toBlock: null,
          sourceFamilies: [],
          reason: "Only a partial block range is recorded in persisted materialization state.",
        },
        pnlCoverage: {
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
        },
      },
    });
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("pnlPercent");
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("roi");
    expect(body.data.tokenPositions[0].pnl).not.toHaveProperty("nativePnl");
  });


  it("returns failed materialization metadata, warnings, and negative balances from persisted state", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
            assetId: NATIVE_ASSET,
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
        priceObservations: [
          createPriceObservation(),
          createPriceObservation({
            id: "obs-native",
            assetId: NATIVE_ASSET,
            assetAddress: null,
            price: "1",
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        summary: {
          totalValueQuote: "9.75",
        },
        materialization: {
          status: "FAILED",
          completedSuccessfully: false,
          lastAttemptedAt: "2026-05-08T12:04:00.000Z",
          latestMaterializedAt: "2026-05-08T12:03:30.000Z",
          updatedFromBlock: "100",
          updatedToBlock: "120",
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
              assetId: NATIVE_ASSET,
              assetAddress: null,
              balanceQuantity: "-0.25",
              decimals: 18,
            },
          ],
        },
      },
    });
  });

  it("handles missing provenance safely with null and empty metadata", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [createPriceObservation()],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        summary: {
          totalValueQuote: "10",
        },
        tokenPositions: [
          expect.objectContaining({
            metadataProvenance: {
              status: "unknown",
              source: "unknown",
              observedAt: null,
              confidence: "unknown",
              conflictReason: null,
            },
          }),
        ],
        materialization: {
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
        },
      },
    });
  });

  it("freshness status is fresh when latestMaterializedAt is within threshold", async () => {
    // asOf is 2026-05-08T12:04:00.000Z, latestMaterializedAt is 30 seconds earlier — well within 900s
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
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
            updatedFromBlock: null,
            updatedToBlock: null,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        materialization: {
          freshness: {
            status: "fresh",
            reason: null,
            lastMaterializedAt: "2026-05-08T12:03:30.000Z",
            staleAfterSeconds: 900,
          },
        },
      },
    });
  });

  it("freshness status is stale when latestMaterializedAt is older than threshold", async () => {
    // asOf is 2026-05-08T12:04:00.000Z, latestMaterializedAt is 30 minutes earlier — exceeds 900s
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-08T11:33:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T11:33:30.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: null,
            updatedToBlock: null,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        materialization: {
          freshness: {
            status: "stale",
            lastMaterializedAt: "2026-05-08T11:33:30.000Z",
            staleAfterSeconds: 900,
          },
        },
      },
    });
  });

  it("freshness status is unknown when materialization failed with no prior successful run", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "FAILED",
            completedSuccessfully: false,
            lastAttemptedAt: new Date("2026-05-08T12:04:00.000Z"),
            latestMaterializedAt: null,
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: null,
            updatedToBlock: null,
            warningCount: 0,
            warningDetails: [],
            errorMessage: "sync exploded on first run",
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        materialization: {
          freshness: {
            status: "unknown",
            reason: "Materialization failed: sync exploded on first run",
            lastMaterializedAt: null,
            staleAfterSeconds: 900,
          },
        },
      },
    });
  });

  it("freshness status is stale when materialization failed but prior successful run is older than threshold", async () => {
    // latestMaterializedAt is 2 hours old, status FAILED — stale
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "FAILED",
            completedSuccessfully: false,
            lastAttemptedAt: new Date("2026-05-08T12:04:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T10:00:00.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: null,
            updatedToBlock: null,
            warningCount: 0,
            warningDetails: [],
            errorMessage: "materialization failed with stale prior data",
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        materialization: {
          freshness: {
            status: "stale",
            reason: "Materialization failed: materialization failed with stale prior data",
            lastMaterializedAt: "2026-05-08T10:00:00.000Z",
            staleAfterSeconds: 900,
          },
        },
      },
    });
  });

  it("existing dashboard valuation and position fields are unchanged after freshness addition", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [createPriceObservation()],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.summary.totalValueQuote).toBe("10");
    expect(body.data.summary.valuationStatus).toBe("available");
    expect(body.data.tokenPositions).toHaveLength(1);
    expect(body.data.tokenPositions[0].assetId).toBe(TOKEN_ASSET);
    expect(body.data.tokenPositions[0].valuation.valueQuote).toBe("10");
  });

  it("ledgerCoverage is unknown when no materialization state exists", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
        priceObservations: [],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ledgerCoverage: {
          status: "unknown",
          fromBlock: null,
          toBlock: null,
          sourceFamilies: [],
          reason: "No materialization record exists.",
        },
      },
    });
  });

  it("ledgerCoverage is covered when both sourceLedger blocks are persisted", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
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
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ledgerCoverage: {
          status: "covered",
          fromBlock: "50",
          toBlock: "200",
          sourceFamilies: [],
          reason: null,
        },
      },
    });
  });

  it("ledgerCoverage is unknown when materialization exists but sourceLedger blocks are null", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
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
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ledgerCoverage: {
          status: "unknown",
          fromBlock: null,
          toBlock: null,
          sourceFamilies: [],
          reason: "No block range recorded in persisted materialization state.",
        },
      },
    });
  });

  it("ledgerCoverage is partial when only sourceLedgerFromBlock is persisted", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
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
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ledgerCoverage: {
          status: "partial",
          fromBlock: "50",
          toBlock: null,
          sourceFamilies: [],
          reason: "Only a partial block range is recorded in persisted materialization state.",
        },
      },
    });
  });

  it("existing materialization.freshness is unchanged after ledgerCoverage addition", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        tokenBalances: [],
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
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        materialization: {
          freshness: {
            status: "fresh",
            reason: null,
            lastMaterializedAt: "2026-05-08T12:03:30.000Z",
            staleAfterSeconds: 900,
          },
        },
        ledgerCoverage: {
          status: "covered",
          fromBlock: "50",
          toBlock: "200",
        },
      },
    });
  });

  it("pnlCoverage records stale_price when the only available observation is past its staleAfterSeconds window", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [
          createPriceObservation({
            observedAt: new Date("2026-05-08T11:50:00.000Z"),
            staleAfterSeconds: 120,
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokenPositions[0].pricing.status).toBe("stale_price");
    expect(body.data.tokenPositions[0].pricing.rejectedReasons).toContain("STALE");
    expect(body.data.pnlCoverage).toMatchObject({
      stalePricePositionsCount: 1,
      reasons: expect.arrayContaining(["stale_price"]),
      affectedSections: expect.arrayContaining(["tokens", "summary"]),
    });
  });

  it("pnlCoverage records source_disabled when the only available observation is from a disabled source", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [
          createPriceObservation({
            sourceType: "DEXSCREENER",
            sourceId: "dexscreener:pulsechain:0xpair",
            confidence: "0.99",
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokenPositions[0].pricing.status).toBe("unavailable");
    expect(body.data.tokenPositions[0].pricing.rejectedReasons).toContain("SOURCE_DISABLED");
    expect(body.data.pnlCoverage).toMatchObject({
      sourceDisabledPositionsCount: 1,
      reasons: expect.arrayContaining(["source_disabled"]),
      affectedSections: expect.arrayContaining(["tokens", "summary"]),
    });
  });

  it("pnlCoverage records insufficient_cost_basis when a disposal exceeds tracked holdings", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        ledgerEntries: [
          {
            id: "sell-no-basis",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            assetId: TOKEN_ASSET,
            entryType: "SWAP_OUT",
            direction: "OUT",
            quantity: "10",
            occurredAt: new Date("2026-05-08T12:00:00.000Z"),
            actionGroupId: "group-sell",
            txHash: "0xtx-sell",
            sourceLogKey: null,
            actionGroup: { actionType: "SWAP" },
          },
        ],
        priceObservations: [
          createPriceObservation({
            price: "2",
            confidence: "0.91",
          }),
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokenPositions[0].pnl.status).toBe("incomplete_basis");
    expect(body.data.tokenPositions[0].pnl.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INSUFFICIENT_COST_BASIS" })]),
    );
    expect(body.data.pnlCoverage).toMatchObject({
      incompleteBasisPositionsCount: 1,
      reasons: expect.arrayContaining(["insufficient_cost_basis"]),
      affectedSections: expect.arrayContaining(["tokens", "summary"]),
    });
  });

  it("pnlCoverage records unsupported_position_type and status unsupported when only LP positions are present", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
        lpPositions: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            lpAssetId: "chain:369:erc20:0xlp",
            lpTokenAddress: "0xlp",
            lpTokenQuantity: "100",
            token0AssetId: TOKEN_ASSET,
            token0Address: TOKEN_ADDRESS,
            token1AssetId: NATIVE_ASSET,
            token1Address: null,
            token0NetQuantity: "50",
            token1NetQuantity: "200",
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.lpPositions[0].pnl.status).toBe("unsupported");
    expect(body.data.pnlCoverage).toMatchObject({
      status: "unsupported",
      unsupportedPositionsCount: 1,
      pricedPositionsCount: 0,
      reasons: ["unsupported_position_type"],
      affectedSections: expect.arrayContaining(["summary", "lpPositions"]),
    });
  });

  it("token metadata provenance maps SEED source kind to derived with low confidence", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [createPriceObservation()],
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            decimalsSource: "SEED",
            metadataSources: [{ sourceKind: "SEED", observedAt: new Date("2026-05-08T11:00:00.000Z") }],
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokenPositions[0].metadataProvenance).toEqual({
      status: "observed",
      source: "derived",
      observedAt: "2026-05-08T11:00:00.000Z",
      confidence: "low",
      conflictReason: null,
    });
  });

  it("token metadata provenance maps MANUAL source kind to manual with medium confidence", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        wallets: [
          {
            id: WALLET_ID,
            address: WALLET_ADDRESS,
            addressLower: WALLET_ADDRESS.toLowerCase(),
            chainId: CHAIN_ID,
          },
        ],
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
        priceObservations: [createPriceObservation()],
        tokens: [
          {
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET,
            decimalsSource: "MANUAL",
            metadataSources: [{ sourceKind: "MANUAL", observedAt: new Date("2026-05-08T10:00:00.000Z") }],
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        `http://localhost/api/portfolio/dashboard?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}&quoteAsset=${encodeURIComponent(QUOTE_ASSET)}&asOf=2026-05-08T12:04:00.000Z`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokenPositions[0].metadataProvenance).toEqual({
      status: "observed",
      source: "manual",
      observedAt: "2026-05-08T10:00:00.000Z",
      confidence: "medium",
      conflictReason: null,
    });
  });
});
