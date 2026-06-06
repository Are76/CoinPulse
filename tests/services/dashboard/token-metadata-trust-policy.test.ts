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
  metadataSources?: Array<{ sourceKind: string; observedAt: Date | null; decimals?: number | null }>;
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

  it("conflictReason is null when multiple sources have different kinds but agree on decimals", async () => {
    // Different source kinds (RPC vs SEED) do not constitute a conflict.
    // Conflict detection is based on persisted decimals values disagreeing across sources.
    // When decimals are null in both sources, no conflict is detected.
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z"), decimals: null },
        { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z"), decimals: null },
      ],
    });

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

// ─── Stale metadata status ─────────────────────────────────────────────────────

// AS_OF is 2026-06-04T12:00:00.000Z (30+ days after the stale threshold boundary).
// STALE_OBSERVED_AT is 60 days before AS_OF.
const STALE_OBSERVED_AT = new Date("2026-04-05T12:00:00.000Z"); // 60 days before AS_OF

describe("token metadata trust policy — stale status computation", () => {
  it("returns stale status when RPC observation is older than threshold", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: STALE_OBSERVED_AT }],
    });

    expect(provenance?.status).toBe("stale");
    expect(provenance?.source).toBe("chain");
    expect(provenance?.confidence).toBe("medium");
    expect(provenance?.conflictReason).toBeNull();
    // observedAt is still exposed so operators can see when metadata was last observed
    expect(provenance?.observedAt).toBe(STALE_OBSERVED_AT.toISOString());
  });

  it("returns stale status when SEED observation is older than threshold", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "SEED",
      metadataSources: [{ sourceKind: "SEED", observedAt: STALE_OBSERVED_AT }],
    });

    expect(provenance?.status).toBe("stale");
    expect(provenance?.source).toBe("derived");
    expect(provenance?.confidence).toBe("low");
  });

  it("returns observed (not stale) for a recent observation", async () => {
    const recentObservedAt = new Date("2026-06-04T11:00:00.000Z"); // 1 hour before AS_OF
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: recentObservedAt }],
    });

    expect(provenance?.status).toBe("observed");
  });

  it("returns observed (not stale) when observedAt is null — null means no evidence, not stale", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [{ sourceKind: "RPC", observedAt: null }],
    });

    expect(provenance?.status).toBe("observed");
  });

  it("null observedAt does not win over stale observedAt when selecting latest source", async () => {
    // Regression: null observedAt must be treated as oldest (epoch 0), not newest.
    // The stale source has a real timestamp and must be selected as latest,
    // making the status "stale" rather than "observed".
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: null },
        { sourceKind: "RPC", observedAt: STALE_OBSERVED_AT },
      ],
    });

    expect(provenance?.status).toBe("stale");
    expect(provenance?.source).toBe("chain");
    expect(provenance?.confidence).toBe("medium");
  });
});

// ─── Conflicting metadata status ───────────────────────────────────────────────

describe("token metadata trust policy — conflicting status computation", () => {
  it("returns conflicting status when two sources have different decimals", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z"), decimals: 18 },
        { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z"), decimals: 8 },
      ],
    });

    expect(provenance?.status).toBe("conflicting");
    expect(provenance?.conflictReason).toBe("decimals-mismatch");
    // source is still populated from the latest source for operator observability
    expect(provenance?.source).toBe("chain");
  });

  it("returns observed when two sources agree on the same decimals", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z"), decimals: 18 },
        { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z"), decimals: 18 },
      ],
    });

    expect(provenance?.status).toBe("observed");
    expect(provenance?.conflictReason).toBeNull();
  });

  it("conflict takes priority over stale — conflicting returned even when observation is old", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: STALE_OBSERVED_AT, decimals: 18 },
        { sourceKind: "SEED", observedAt: new Date("2026-04-01T00:00:00.000Z"), decimals: 8 },
      ],
    });

    expect(provenance?.status).toBe("conflicting");
    expect(provenance?.conflictReason).toBe("decimals-mismatch");
  });

  it("returns observed when sources have no persisted decimals — absence is not a conflict", async () => {
    const provenance = await getProvenance({
      chainId: CHAIN_ID,
      assetId: TOKEN_ASSET,
      decimalsSource: "RPC",
      metadataSources: [
        { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z"), decimals: null },
        { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z"), decimals: null },
      ],
    });

    expect(provenance?.status).toBe("observed");
    expect(provenance?.conflictReason).toBeNull();
  });

  it("metadataProvenance status does not affect token balanceQuantity or decimals fields", async () => {
    // Conflicting metadata status is advisory/observability only — it must not change
    // the token position's decimals or balanceQuantity fields.
    const result = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: createDb({
        chainId: CHAIN_ID,
        assetId: TOKEN_ASSET,
        decimalsSource: "RPC",
        metadataSources: [
          { sourceKind: "RPC", observedAt: new Date("2026-06-04T11:00:00.000Z"), decimals: 18 },
          { sourceKind: "SEED", observedAt: new Date("2026-06-03T10:00:00.000Z"), decimals: 8 },
        ],
      }) as never,
      resolvePrice: async () => createResolvedPrice(),
      calculatePnl: async () => createPnlResult(),
    });

    const position = result.tokenPositions[0];
    expect(position?.metadataProvenance.status).toBe("conflicting");
    // Token decimals and balance come from the canonical ledger, not from metadata sources
    expect(position?.decimals).toBe(18); // from portfolioTokenBalance fixture
    expect(position?.balanceQuantity).toBe("1");
  });
});
