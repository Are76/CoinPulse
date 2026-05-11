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
  actionType?: string;
  actionGroup?: { actionType: string };
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
}) {
  const wallets = overrides?.wallets ?? [];
  const tokenBalances = overrides?.tokenBalances ?? [];
  const ledgerEntries = overrides?.ledgerEntries ?? [];
  const materializationStates = overrides?.materializationStates ?? [];
  const priceObservations = overrides?.priceObservations ?? [];

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
        async findMany() {
          return [];
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
        async findMany(args: { where: { walletId: string; chainId: number } }) {
          return ledgerEntries.filter(
            (row) => row.walletId === args.where.walletId && row.chainId === args.where.chainId,
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
});
