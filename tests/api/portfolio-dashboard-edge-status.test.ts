/**
 * Route contract tests for GET /api/portfolio/dashboard under PnL/pricing edge status conditions.
 *
 * This file targets the gaps listed in docs/v1-remaining-guardrail-checklist.md §2:
 *   - low-confidence price PnL status
 *   - summary warning aggregation stability (multiple tokens, no duplicate warnings)
 *
 * The stale-price, source-disabled, and INSUFFICIENT_COST_BASIS cases are already
 * covered in tests/api/portfolio-dashboard-route-contract.test.ts.
 *
 * Only test code is in this file. No production code, schema, routes, services,
 * pricing/PnL/accounting logic, or DTO contracts are changed here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersistedPriceObservation } from "@/services/pricing/types";

const WALLET_ID = "wallet-edge-1";
const WALLET_ADDRESS = "0x2222222222222222222222222222222222222222";
const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const TOKEN_ASSET_A = "chain:369:erc20:0xaaaa";
const TOKEN_ASSET_B = "chain:369:erc20:0xbbbb";
const TOKEN_ADDRESS_A = "0xaaaa";
const TOKEN_ADDRESS_B = "0xbbbb";

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
    id: "obs-edge-1",
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET_A,
    assetAddress: TOKEN_ADDRESS_A,
    quoteAsset: QUOTE_ASSET,
    price: "5",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpairA",
    routeMetadata: null,
    liquidityUsd: "50000",
    confidence: "0.91",
    observedAt: new Date("2026-05-08T12:00:00.000Z"),
    blockNumber: 200n,
    staleAfterSeconds: 300,
    createdAt: new Date("2026-05-08T12:00:00.000Z"),
    updatedAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

function createDefaultMaterializationState(
  overrides: Partial<MaterializationStateRecord> = {},
): MaterializationStateRecord {
  return {
    walletId: WALLET_ID,
    chainId: CHAIN_ID,
    status: "COMPLETED",
    completedSuccessfully: true,
    lastAttemptedAt: new Date("2026-05-08T12:03:00.000Z"),
    latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
    sourceLedgerFromBlock: null,
    sourceLedgerToBlock: null,
    updatedFromBlock: 100n,
    updatedToBlock: 200n,
    warningCount: 0,
    warningDetails: [],
    errorMessage: null,
    ...overrides,
  };
}

function createMemoryDb(overrides?: {
  wallets?: WalletRecord[];
  tokenBalances?: TokenBalanceRecord[];
  materializationStates?: MaterializationStateRecord[];
  priceObservations?: PersistedPriceObservation[];
}) {
  const wallets = overrides?.wallets ?? [];
  const tokenBalances = overrides?.tokenBalances ?? [];
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
        async findMany() {
          return [];
        },
      },
      token: {
        async findMany() {
          return [];
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

describe("GET /api/portfolio/dashboard — PnL/pricing edge status contracts", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("pricing.status is low_confidence_price and pnl.status is low_confidence_price when confidence falls below minimum", async () => {
    // confidence "0.3" is below the default minimum of "0.5" in the price resolver.
    // The observation is NOT stale and NOT source-disabled, so the only rejection reason is LOW_CONFIDENCE.
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
            assetId: TOKEN_ASSET_A,
            assetAddress: TOKEN_ADDRESS_A,
            balanceQuantity: "10",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 200n,
          },
        ],
        materializationStates: [createDefaultMaterializationState()],
        priceObservations: [
          createPriceObservation({
            confidence: "0.3",
            // observedAt is fresh relative to asOf (2026-05-08T12:04:00.000Z): 4 min < 300s stale window
            observedAt: new Date("2026-05-08T12:00:00.000Z"),
            staleAfterSeconds: 300,
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

    // Pricing must report low_confidence_price — not coerced to available or zero
    expect(body.data.tokenPositions[0].pricing.status).toBe("low_confidence_price");
    expect(body.data.tokenPositions[0].pricing.rejectedReasons).toContain("LOW_CONFIDENCE");
    // No price was selected; these fields must be null
    expect(body.data.tokenPositions[0].pricing.sourceType).toBeNull();
    expect(body.data.tokenPositions[0].pricing.sourceId).toBeNull();
    expect(body.data.tokenPositions[0].pricing.confidence).toBeNull();
    expect(body.data.tokenPositions[0].pricing.observedAt).toBeNull();

    // Valuation status mirrors pricing.status — both are low_confidence_price; valueQuote is null
    expect(body.data.tokenPositions[0].valuation.status).toBe("low_confidence_price");
    expect(body.data.tokenPositions[0].valuation.valueQuote).toBeNull();

    // PnL status inherits low_confidence_price (toPnlDto propagates valuationStatus when MARK_PRICE_UNAVAILABLE)
    expect(body.data.tokenPositions[0].pnl.status).toBe("low_confidence_price");
    // markPrice must remain null — not coerced to zero
    expect(body.data.tokenPositions[0].pnl.markPrice).toBeNull();
    // unrealizedPnl must remain null — not coerced to zero
    expect(body.data.tokenPositions[0].pnl.unrealizedPnl).toBeNull();

    // pnlCoverage classifies this as unpriced (low_confidence_price triggers hasUnpricedPnl)
    expect(body.data.pnlCoverage).toMatchObject({
      unpricedPositionsCount: 1,
      reasons: expect.arrayContaining(["unpriced"]),
      affectedSections: expect.arrayContaining(["tokens", "summary"]),
    });

    // Summary reflects low_confidence_price — no price was selected so totalValueQuote is null
    expect(body.data.summary.totalValueQuote).toBeNull();
    // valuationStatus mirrors the single position's valuation.status
    expect(body.data.summary.valuationStatus).toBe("low_confidence_price");
  });

  it("summary.warnings has no duplicate entries when multiple token positions emit the same warning code", async () => {
    // Two positions, both unpriced — each independently emits pricing-unavailable and pnl-warning codes.
    // summaryWarnings is a Set internally so the serialized array must contain no duplicates.
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
            assetId: TOKEN_ASSET_A,
            assetAddress: TOKEN_ADDRESS_A,
            balanceQuantity: "5",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 200n,
          },
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: TOKEN_ASSET_B,
            assetAddress: TOKEN_ADDRESS_B,
            balanceQuantity: "3",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 200n,
          },
        ],
        materializationStates: [createDefaultMaterializationState()],
        // No price observations — both positions are unpriced, generating the same pnl-warning code
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

    // Both positions must be unpriced
    expect(body.data.tokenPositions).toHaveLength(2);
    expect(body.data.tokenPositions[0].pricing.status).toBe("unavailable");
    expect(body.data.tokenPositions[1].pricing.status).toBe("unavailable");

    const warnings: string[] = body.data.summary.warnings;

    // No duplicate entries — the Set contract must hold
    const unique = [...new Set(warnings)];
    expect(warnings).toEqual(unique);

    // Per-asset pricing warnings are keyed by assetId so each appears exactly once
    const pricingWarnA = `pricing-unavailable:${TOKEN_ASSET_A}:unavailable`;
    const pricingWarnB = `pricing-unavailable:${TOKEN_ASSET_B}:unavailable`;
    expect(warnings.filter((w) => w === pricingWarnA)).toHaveLength(1);
    expect(warnings.filter((w) => w === pricingWarnB)).toHaveLength(1);

    // The shared pnl-warning key must appear at most once even though two positions emit it
    const pnlWarnCount = warnings.filter((w) => w === "pnl-warning:MARK_PRICE_UNAVAILABLE").length;
    expect(pnlWarnCount).toBeLessThanOrEqual(1);

    // Summary valuation is unavailable — not coerced to zero
    expect(body.data.summary.totalValueQuote).toBeNull();
    expect(body.data.summary.valuationStatus).toBe("unavailable");

    // pnlCoverage tracks both unpriced positions
    expect(body.data.pnlCoverage).toMatchObject({
      unpricedPositionsCount: 2,
      reasons: expect.arrayContaining(["unpriced"]),
    });
  });
});
