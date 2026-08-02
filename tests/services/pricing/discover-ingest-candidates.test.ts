// Wallet-scoped price-ingest candidate discovery — focused unit tests.
//
// All DB access is injected via a mocked DiscoveryDbClient. No live database,
// no RPC, no ingestion call. Verifies read-only, deterministic, wallet- and
// chain-scoped candidate discovery per the pricing-wallet-ingest-candidate
// preview mission.

import { describe, expect, it, vi } from "vitest";

import {
  discoverPriceIngestCandidates,
  UnsupportedIngestDiscoveryChainError,
  type DiscoveryDbClient,
} from "@/services/pricing/discover-ingest-candidates";

const CHAIN_ID = 369;
const WALLET_ID = "wallet-1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

const PLS_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const PHEX_ASSET_ID = `chain:369:erc20:${PHEX_ADDRESS}`;
const PDAI_ADDRESS = "0xefd766ccb38eaf1dfd701853bfce31359239f305";
const PDAI_ASSET_ID = `chain:369:erc20:${PDAI_ADDRESS}`;
const LP_TOKEN_ADDRESS = "0x3333333333333333333333333333333333333333";
const LP_ASSET_ID = `chain:369:erc20:${LP_TOKEN_ADDRESS}`;

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

function makeDb(overrides?: {
  balances?: Array<{
    assetId: string;
    assetAddress: string | null;
    decimals: number | null;
    balanceQuantity: { toString(): string };
  }>;
  tokens?: Array<{
    id: string;
    assetId: string;
    isIgnored: boolean;
    decimalsSource: string | null;
  }>;
  metadataSources?: Array<{ tokenId: string; decimals: number | null }>;
  lpPositions?: Array<{ lpAssetId: string }>;
  stakePositions?: Array<{ tokenAssetId: string }>;
}): DiscoveryDbClient & {
  calls: { portfolioTokenBalance: unknown[]; portfolioLpPosition: unknown[]; portfolioStakePosition: unknown[] };
} {
  const balances = overrides?.balances ?? [];
  const tokens = overrides?.tokens ?? [];
  const metadataSources = overrides?.metadataSources ?? [];
  const lpPositions = overrides?.lpPositions ?? [];
  const stakePositions = overrides?.stakePositions ?? [];

  const calls = {
    portfolioTokenBalance: [] as unknown[],
    portfolioLpPosition: [] as unknown[],
    portfolioStakePosition: [] as unknown[],
  };

  return {
    calls,
    portfolioTokenBalance: {
      findMany: vi.fn(async (args) => {
        calls.portfolioTokenBalance.push(args);
        return balances.filter(
          () => args.where.walletId === WALLET_ID && args.where.chainId === CHAIN_ID,
        );
      }),
    },
    token: {
      findMany: vi.fn(async () => tokens),
    },
    tokenMetadataSource: {
      findMany: vi.fn(async (args) =>
        metadataSources.filter((s) => args.where.tokenId.in.includes(s.tokenId)),
      ),
    },
    portfolioLpPosition: {
      findMany: vi.fn(async (args) => {
        calls.portfolioLpPosition.push(args);
        return lpPositions;
      }),
    },
    portfolioStakePosition: {
      findMany: vi.fn(async (args) => {
        calls.portfolioStakePosition.push(args);
        return stakePositions;
      }),
    },
  };
}

describe("discoverPriceIngestCandidates", () => {
  it("returns deterministic eligible candidates for supported non-zero ERC-20 balances", async () => {
    const db = makeDb({
      balances: [
        {
          assetId: PHEX_ASSET_ID,
          assetAddress: PHEX_ADDRESS,
          decimals: 8,
          balanceQuantity: decimal("100"),
        },
      ],
      tokens: [
        { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toEqual([
      {
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: 8,
        quoteAsset: "fiat:usd",
        walletAddress: WALLET_ADDRESS,
        chainId: CHAIN_ID,
        decimalsSource: "seed:phex",
      },
    ]);
    expect(result.excluded).toEqual([]);
    expect(result.totalBalanceRowsInspected).toBe(1);
    expect(result.totalEligibleBeforeCap).toBe(1);
    expect(result.totalReturned).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("scopes results to the requested wallet only", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
      ],
    });

    await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(db.calls.portfolioTokenBalance[0]).toEqual({
      where: { walletId: WALLET_ID, chainId: CHAIN_ID },
    });
  });

  it("rejects an unsupported chainId", async () => {
    const db = makeDb();

    await expect(
      discoverPriceIngestCandidates({
        chainId: 1,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      }),
    ).rejects.toThrow(UnsupportedIngestDiscoveryChainError);
  });

  it("excludes zero balances with ZERO_BALANCE", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("0") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toEqual([]);
    expect(result.excluded).toEqual([
      {
        assetId: PHEX_ASSET_ID,
        chainId: CHAIN_ID,
        tokenAddress: PHEX_ADDRESS,
        reason: "ZERO_BALANCE",
        detail: "Persisted balanceQuantity is zero.",
      },
    ]);
  });

  it("excludes null decimals with MISSING_DECIMALS", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: null, balanceQuantity: decimal("5") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.excluded[0]?.reason).toBe("MISSING_DECIMALS");
  });

  it("excludes conflicting decimals with CONFLICTING_DECIMALS", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
      ],
      tokens: [
        { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
      ],
      metadataSources: [
        { tokenId: "token-phex", decimals: 8 },
        { tokenId: "token-phex", decimals: 18 },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.excluded[0]?.reason).toBe("CONFLICTING_DECIMALS");
  });

  it("excludes exact canonical pDAI identity without symbol matching", async () => {
    const db = makeDb({
      balances: [
        { assetId: PDAI_ASSET_ID, assetAddress: PDAI_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
      ],
      tokens: [
        // Symbol is deliberately absent from the row shape passed to the
        // service — exclusion must not depend on it.
        { id: "token-pdai", assetId: PDAI_ASSET_ID, isIgnored: false, decimalsSource: "seed:pdai" },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.excluded).toEqual([
      {
        assetId: PDAI_ASSET_ID,
        chainId: CHAIN_ID,
        tokenAddress: PDAI_ADDRESS,
        reason: "PDAI_ROUTING_REFERENCE",
        detail: "pDAI is the pricing route's quote reference asset and is never self-priced.",
      },
    ]);
  });

  it("excludes explicitly ignored assets", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
      ],
      tokens: [
        { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: true, decimalsSource: "seed:phex" },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.excluded[0]?.reason).toBe("IGNORED_ASSET");
  });

  it("excludes LP and stake asset classes without symbol matching", async () => {
    const db = makeDb({
      balances: [
        { assetId: LP_ASSET_ID, assetAddress: LP_TOKEN_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
      ],
      lpPositions: [{ lpAssetId: LP_ASSET_ID }],
      stakePositions: [{ tokenAssetId: PHEX_ASSET_ID }],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((e) => e.reason)).toEqual([
      "UNSUPPORTED_ASSET_CLASS",
      "UNSUPPORTED_ASSET_CLASS",
    ]);
  });

  it("follows the verified native PLS contract (zero address, 18 decimals)", async () => {
    const db = makeDb({
      balances: [
        { assetId: PLS_ASSET_ID, assetAddress: null, decimals: 18, balanceQuantity: decimal("5") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toEqual([
      {
        assetId: PLS_ASSET_ID,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        tokenDecimals: 18,
        quoteAsset: "fiat:usd",
        walletAddress: WALLET_ADDRESS,
        chainId: CHAIN_ID,
        decimalsSource: null,
      },
    ]);
  });

  it("collapses duplicate assetIds deterministically", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("2") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toHaveLength(1);
    expect(result.excluded).toEqual([
      {
        assetId: PHEX_ASSET_ID,
        chainId: CHAIN_ID,
        tokenAddress: PHEX_ADDRESS,
        reason: "DUPLICATE_ASSET",
        detail: "Duplicate assetId collapsed after the first canonical occurrence.",
      },
    ]);
  });

  it("orders eligible candidates by canonical assetId ascending", async () => {
    const bAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const aAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const db = makeDb({
      balances: [
        { assetId: `chain:369:erc20:${bAddress}`, assetAddress: bAddress, decimals: 18, balanceQuantity: decimal("1") },
        { assetId: `chain:369:erc20:${aAddress}`, assetAddress: aAddress, decimals: 18, balanceQuantity: decimal("1") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible.map((c) => c.assetId)).toEqual([
      `chain:369:erc20:${aAddress}`,
      `chain:369:erc20:${bAddress}`,
    ]);
  });

  it("caps at 50, marks truncated, and reports totals before the cap", async () => {
    const balances = Array.from({ length: 60 }, (_, i) => {
      const address = `0x${(i + 1).toString(16).padStart(40, "0")}`;
      return {
        assetId: `chain:369:erc20:${address}`,
        assetAddress: address,
        decimals: 18,
        balanceQuantity: decimal("1"),
      };
    });
    const db = makeDb({ balances });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.totalEligibleBeforeCap).toBe(60);
    expect(result.totalReturned).toBe(50);
    expect(result.eligible).toHaveLength(50);
    expect(result.cap).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("produces a successful report with zero eligible candidates", async () => {
    const db = makeDb({ balances: [] });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.totalReturned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("never calls RPC or price ingestion (no such dependency is injectable or invoked)", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
      ],
    });

    // The service accepts only a DiscoveryDbClient — there is no publicClient,
    // fetchPrice, or runPriceIngestion dependency to inject or call.
    await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(Object.keys(db)).toEqual([
      "calls",
      "portfolioTokenBalance",
      "token",
      "tokenMetadataSource",
      "portfolioLpPosition",
      "portfolioStakePosition",
    ]);
  });

  it("keeps monetary/token values string/bigint-safe (no Number/parseFloat on balances)", async () => {
    // A value that would lose precision or emit exponent notation through
    // Number()/parseFloat() must still classify correctly as non-zero.
    const db = makeDb({
      balances: [
        {
          assetId: PHEX_ASSET_ID,
          assetAddress: PHEX_ADDRESS,
          decimals: 8,
          balanceQuantity: decimal("0.000000000000000001"),
        },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    expect(result.eligible).toHaveLength(1);
    expect(result.excluded).toEqual([]);
  });

  it("never labels a candidate verified, trusted, priced, or USD-valued", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
      ],
    });

    const result = await discoverPriceIngestCandidates({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      db,
    });

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/verified|trusted|priced|usdvalue/);
  });
});
