/**
 * Token metadata trust policy contract tests.
 *
 * These tests document the exact source-kind-to-provenance mapping rules and
 * guard against regressions where symbol/name/pricing data bleeds into metadata
 * trust decisions. Every assertion here reflects a non-negotiable rule from
 * docs/token-metadata-trust-source-policy.md.
 */

import { describe, expect, it } from "vitest";

import { assemblePortfolioDashboard } from "@/services/dashboard/portfolio-dashboard";
import type { PersistedPriceObservation, ResolveBestPriceResult } from "@/services/pricing/types";
import type { AverageCostPnlResult } from "@/services/pnl/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const WALLET_ID = "wallet-trust-test";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const TOKEN_ASSET = "chain:369:erc20:0xtoken";
const TOKEN_ADDRESS = "0xtoken";
const AS_OF = new Date("2026-06-04T12:00:00.000Z");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function createTokenBalance() {
  return {
    walletId: WALLET_ID,
    walletAddress: WALLET_ADDRESS,
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET,
    assetAddress: TOKEN_ADDRESS,
    balanceQuantity: "1",
    decimals: 18,
    updatedFromBlock: 100n,
    updatedToBlock: 120n,
  };
}

function createPriceObservation(): PersistedPriceObservation {
  return {
    id: "obs-trust-1",
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET,
    assetAddress: TOKEN_ADDRESS,
    quoteAsset: QUOTE_ASSET,
    price: "1",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpair",
    routeMetadata: null,
    liquidityUsd: "100000",
    confidence: "0.91",
    observedAt: new Date("2026-06-04T11:58:00.000Z"),
    blockNumber: 100n,
    staleAfterSeconds: 300,
    createdAt: new Date("2026-06-04T11:58:00.000Z"),
    updatedAt: new Date("2026-06-04T11:58:00.000Z"),
  };
}

function createResolvedPrice(): ResolveBestPriceResult {
  return { selected: createPriceObservation(), rejected: [] };
}

function createPnlResult(): AverageCostPnlResult {
  return {
    walletId: WALLET_ID,
    chainId: CHAIN_ID,
    assetId: TOKEN_ASSET,
    quoteAsset: QUOTE_ASSET,
    holdingsQuantity: "1",
    averageCost: "1",
    realizedPnl: "0",
    unrealizedPnl: "0",
    markPrice: "1",
    totalAcquiredQuantity: "1",
    totalDisposedQuantity: "0",
    warnings: [],
  };
}

type TokenRecord = {
  chainId: number;
  assetId: string;
  decimalsSource: string | null;
  metadataSources?: Array<{ sourceKind: string; observedAt: Date | null }>;
};

function createDb(token: TokenRecord | null) {
  const tokens = token ? [token] : [];
  return new Proxy(
    {
      portfolioTokenBalance: {
        async findMany() {
          return [createTokenBalance()];
        },
      },
      portfolioLpPosition: { async findMany() { return []; } },
      portfolioStakePosition: { async findMany() { return []; } },
      ledgerEntry: { async findMany() { return []; } },
      portfolioMaterializationState: { async findUnique() { return null; } },
      token: {
        async findMany(args: { where: { chainId: number; assetId: { in: string[] } } }) {
          return tokens.filter(
            (row) =>
              row.chainId === args.where.chainId &&
              args.where.assetId.in.includes(row.assetId),
          );
        },
      },
    },
    {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver);
        throw new Error(`unexpected-db-access:${String(property)}`);
      },
    },
  );
}

async function getProvenance(token: TokenRecord | null) {
  const result = await assemblePortfolioDashboard({
    wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
    quoteAsset: QUOTE_ASSET,
    asOf: AS_OF,
    db: createDb(token) as never,
    resolvePrice: async () => createResolvedPrice(),
    calculatePnl: async () => createPnlResult(),
  });
  return result.tokenPositions[0]?.metadataProvenance ?? null;
}

// ─── Source kind mapping ───────────────────────────────────────────────────────

describe("token metadata trust policy — source kind mapping", () => {
  it("RPC source kind maps to chain/medium/observed", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z") }],
    });

    expect(provenance).toEqual({
      status: "observed",
      source: "chain",
      observedAt: "2026-06-04T11:00:00.000Z",
      confidence: "medium",
      conflictReason: null,
    });
  });

  it("SEED source kind maps to derived/low/observed", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "SEED",
      metadataSources: [{ sourceKind: "SEED", observedAt: new Date("2026-06-04T10:00:00.000Z") }],
    });

    expect(provenance).toEqual({
      status: "observed",
      source: "derived",
      observedAt: "2026-06-04T10:00:00.000Z",
      confidence: "low",
      conflictReason: null,
    });
  });

  it("SEED:prefixed variant maps to derived/low (startsWith guard)", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "SEED:pulsechain-genesis",
      metadataSources: [{ sourceKind: "SEED:pulsechain-genesis", observedAt: new Date("2026-06-04T09:00:00.000Z") }],
    });

    expect(provenance?.source).toBe("derived");
    expect(provenance?.confidence).toBe("low");
    expect(provenance?.status).toBe("observed");
  });

  it("MANUAL source kind maps to manual/medium/observed", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "MANUAL",
      metadataSources: [{ sourceKind: "MANUAL", observedAt: new Date("2026-06-04T08:00:00.000Z") }],
    });

    expect(provenance).toEqual({
      status: "observed",
      source: "manual",
      observedAt: "2026-06-04T08:00:00.000Z",
      confidence: "medium",
      conflictReason: null,
    });
  });

  it("MANUAL:prefixed variant maps to manual/medium (startsWith guard)", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "MANUAL:operator-import",
      metadataSources: [{ sourceKind: "MANUAL:operator-import", observedAt: new Date("2026-06-04T07:00:00.000Z") }],
    });

    expect(provenance?.source).toBe("manual");
    expect(provenance?.confidence).toBe("medium");
    expect(provenance?.status).toBe("observed");
  });

  it("unrecognized source kind (e.g. BLOCKCHAIN) maps to unknown", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "BLOCKCHAIN",
      metadataSources: [{ sourceKind: "BLOCKCHAIN", observedAt: new Date("2026-06-04T06:00:00.000Z") }],
    });

    expect(provenance).toEqual({
      status: "unknown",
      source: "unknown",
      observedAt: null,
      confidence: "unknown",
      conflictReason: null,
    });
  });

  it("empty-string source kind maps to unknown", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: null,
      metadataSources: [{ sourceKind: "", observedAt: new Date("2026-06-04T05:00:00.000Z") }],
    });

    expect(provenance?.status).toBe("unknown");
    expect(provenance?.source).toBe("unknown");
  });
});

// ─── Fallback and null handling ────────────────────────────────────────────────

describe("token metadata trust policy — fallback and null handling", () => {
  it("falls back to decimalsSource when metadataSources is absent", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: undefined,
    });

    expect(provenance?.source).toBe("chain");
    expect(provenance?.status).toBe("observed");
    // observedAt is null because no metadataSource row is present
    expect(provenance?.observedAt).toBeNull();
  });

  it("falls back to decimalsSource when metadataSources is empty array", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "SEED",
      metadataSources: [],
    });

    expect(provenance?.source).toBe("derived");
    expect(provenance?.confidence).toBe("low");
    expect(provenance?.observedAt).toBeNull();
  });

  it("returns unknown when both decimalsSource and metadataSources are absent", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: null,
      metadataSources: [],
    });

    expect(provenance?.status).toBe("unknown");
    expect(provenance?.source).toBe("unknown");
    expect(provenance?.observedAt).toBeNull();
    expect(provenance?.conflictReason).toBeNull();
  });

  it("returns unknown when token record is missing entirely", async () => {
    const provenance = await getProvenance(null);

    expect(provenance).toEqual({
      status: "unknown",
      source: "unknown",
      observedAt: null,
      confidence: "unknown",
      conflictReason: null,
    });
  });

  it("returns null observedAt when the source observedAt is null", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: null }],
    });

    expect(provenance?.source).toBe("chain");
    expect(provenance?.observedAt).toBeNull();
  });
});

// ─── conflictReason invariant ──────────────────────────────────────────────────

describe("token metadata trust policy — conflictReason invariant", () => {
  it("conflictReason is always null for RPC-observed metadata (no conflict detection yet)", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z") }],
    });
    expect(provenance?.conflictReason).toBeNull();
  });

  it("conflictReason is null even with multiple sources of different kinds (multi-source not yet conflict-detected)", async () => {
    // Current behavior: uses latest source (index 0), does NOT detect conflict.
    // Status is "observed", not "conflicting". This test documents the limitation.
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z") },
        { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z") },
      ],
    });

    // Latest source wins; conflict is not computed in V1
    expect(provenance?.source).toBe("chain");
    expect(provenance?.status).toBe("observed");
    expect(provenance?.conflictReason).toBeNull();
  });

  it("conflictReason is null for unknown provenance", async () => {
    const provenance = await getProvenance(null);
    expect(provenance?.conflictReason).toBeNull();
  });
});

// ─── Symbol-not-identity guardrail ────────────────────────────────────────────

describe("token metadata trust policy — symbol-not-identity guardrail", () => {
  it("token position DTO has no symbol or name fields — identity is assetId only", async () => {
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: createDb({
        chainId: CHAIN_ID,
        assetId: TOKEN_ASSET,
        decimalsSource: "RPC",
        metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z") }],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    const position = result.tokenPositions[0];
    expect(position).toBeDefined();

    // Identity fields present
    expect(position?.assetId).toBe(TOKEN_ASSET);
    expect(position?.assetAddress).toBe(TOKEN_ADDRESS);

    // Symbol and name are NOT part of the DTO — no frontend inference possible
    expect(position).not.toHaveProperty("symbol");
    expect(position).not.toHaveProperty("name");
    expect(position).not.toHaveProperty("ticker");
  });

  it("pricing availability does not promote metadata trust — provenance stays independent", async () => {
    // A token with unknown metadata but a live price should still show unknown provenance.
    const provenance = await getProvenance(null);

    expect(provenance?.status).toBe("unknown");
    expect(provenance?.source).toBe("unknown");
    expect(provenance?.confidence).toBe("unknown");
  });

  it("metadataProvenance shape never carries pricing or PnL fields", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z") }],
    });

    expect(provenance).not.toHaveProperty("price");
    expect(provenance).not.toHaveProperty("pnl");
    expect(provenance).not.toHaveProperty("valuation");
    expect(provenance).not.toHaveProperty("sourceType");
    expect(provenance).not.toHaveProperty("liquidityUsd");
  });
});
