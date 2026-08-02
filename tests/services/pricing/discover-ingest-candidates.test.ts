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
const UNRELATED_ADDRESS = "0x9999999999999999999999999999999999999999";
const UNRELATED_ASSET_ID = `chain:369:erc20:${UNRELATED_ADDRESS}`;

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
}): DiscoveryDbClient & {
  calls: {
    portfolioTokenBalance: unknown[];
    token: unknown[];
    tokenMetadataSource: unknown[];
    portfolioLpPosition: unknown[];
  };
} {
  const balances = overrides?.balances ?? [];
  const tokens = overrides?.tokens ?? [];
  const metadataSources = overrides?.metadataSources ?? [];
  const lpPositions = overrides?.lpPositions ?? [];

  const calls = {
    portfolioTokenBalance: [] as unknown[],
    token: [] as unknown[],
    tokenMetadataSource: [] as unknown[],
    portfolioLpPosition: [] as unknown[],
  };

  return {
    calls,
    portfolioTokenBalance: {
      findMany: vi.fn(async (args) => {
        calls.portfolioTokenBalance.push(args);
        if (args.where.walletId !== WALLET_ID || args.where.chainId !== CHAIN_ID) return [];
        return balances;
      }),
    },
    token: {
      findMany: vi.fn(async (args) => {
        calls.token.push(args);
        // Faithfully emulates a real `assetId: { in: [...] }` + chainId filter —
        // a token outside the requested set (or on another chain) is never
        // returned, matching how Prisma itself would filter the query.
        const allowed = new Set<string>(args.where.assetId.in);
        return tokens.filter(
          (token) => allowed.has(token.assetId) && args.where.chainId === CHAIN_ID,
        );
      }),
    },
    tokenMetadataSource: {
      findMany: vi.fn(async (args) => {
        calls.tokenMetadataSource.push(args);
        return metadataSources.filter((s) => args.where.tokenId.in.includes(s.tokenId));
      }),
    },
    portfolioLpPosition: {
      findMany: vi.fn(async (args) => {
        calls.portfolioLpPosition.push(args);
        return lpPositions;
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

  it("excludes the LP asset class via canonical PortfolioLpPosition.lpAssetId, without symbol matching", async () => {
    const db = makeDb({
      balances: [
        { assetId: LP_ASSET_ID, assetAddress: LP_TOKEN_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
      ],
      lpPositions: [{ lpAssetId: LP_ASSET_ID }],
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
        assetId: LP_ASSET_ID,
        chainId: CHAIN_ID,
        tokenAddress: LP_TOKEN_ADDRESS,
        reason: "UNSUPPORTED_ASSET_CLASS",
        detail: "assetId matches a canonical LP position identity for this wallet.",
      },
    ]);
  });

  // Regression for a fixed blocker: PortfolioStakePosition.tokenAssetId is the
  // underlying normal token identity (e.g. pHEX), not a distinct receipt/share
  // asset. A wallet can hold both an active pHEX stake AND a liquid pHEX
  // balance at the same time — the liquid balance must remain a normal,
  // eligible pricing candidate. There is no separate canonical stake-receipt
  // asset identity in PortfolioTokenBalance to exclude against, so no
  // PortfolioStakePosition query exists in this service at all.
  it("does not exclude a liquid token balance merely because its assetId is used as a stake's underlying tokenAssetId", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
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
    // No portfolioStakePosition query exists on the DiscoveryDbClient contract
    // at all — asserted at the type level (DiscoveryDbClient has no such key)
    // and confirmed here at the mock level.
    expect(Object.keys(db)).not.toContain("portfolioStakePosition");
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

    // Behavioral, not insertion-order: exactly the expected read-only calls
    // happened, and nothing RPC/ingestion-shaped exists on the client at all.
    expect(db.portfolioTokenBalance.findMany).toHaveBeenCalledTimes(1);
    expect(db.token.findMany).toHaveBeenCalledTimes(1);
    expect(db.portfolioLpPosition.findMany).toHaveBeenCalledTimes(1);
    expect(db).not.toHaveProperty("publicClient");
    expect(db).not.toHaveProperty("runPriceIngestion");
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

  describe("wallet-scoped Token/TokenMetadataSource queries (never a chain-wide registry scan)", () => {
    it("queries Token narrowed to chainId plus the wallet's own discovered assetIds", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
          // Present in the chain's token registry but not held by this wallet.
          { id: "token-unrelated", assetId: UNRELATED_ASSET_ID, isIgnored: false, decimalsSource: "seed:unrelated" },
        ],
      });

      await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(db.calls.token).toEqual([
        { where: { chainId: CHAIN_ID, assetId: { in: [PHEX_ASSET_ID] } } },
      ]);
    });

    it("never requests or consumes an unrelated chain-registry token's metadata", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
          { id: "token-unrelated", assetId: UNRELATED_ASSET_ID, isIgnored: false, decimalsSource: "seed:unrelated" },
        ],
        metadataSources: [
          { tokenId: "token-phex", decimals: 8 },
          { tokenId: "token-unrelated", decimals: 18 },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      // Unrelated token never queried, so its metadata source could not have
      // been fetched or consumed either.
      expect(db.calls.tokenMetadataSource).toEqual([{ where: { tokenId: { in: ["token-phex"] } } }]);
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
    });

    it("skips Token and TokenMetadataSource queries entirely when the wallet has no balance rows", async () => {
      const db = makeDb({ balances: [] });

      await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(db.token.findMany).not.toHaveBeenCalled();
      expect(db.tokenMetadataSource.findMany).not.toHaveBeenCalled();
    });
  });

  describe("canonical identity validation (proves consistency, never guesses)", () => {
    it("excludes a row whose embedded chain does not match the requested chainId", async () => {
      const db = makeDb({
        balances: [
          {
            assetId: `chain:1:erc20:${PHEX_ADDRESS}`,
            assetAddress: PHEX_ADDRESS,
            decimals: 8,
            balanceQuantity: decimal("5"),
          },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_CANONICAL_IDENTITY");
      expect(result.excluded[0]?.detail).toMatch(/embeds chainId 1/);
    });

    it("excludes a row whose assetId address does not match the persisted assetAddress", async () => {
      const addressA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const addressB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const db = makeDb({
        balances: [
          {
            assetId: `chain:369:erc20:${addressA}`,
            assetAddress: addressB,
            decimals: 18,
            balanceQuantity: decimal("5"),
          },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_CANONICAL_IDENTITY");
      expect(result.excluded[0]?.detail).toMatch(/does not match the persisted assetAddress/);
    });

    it("excludes an ERC-20 assetId with a null persisted assetAddress", async () => {
      const db = makeDb({
        balances: [
          {
            assetId: PHEX_ASSET_ID,
            assetAddress: null,
            decimals: 8,
            balanceQuantity: decimal("5"),
          },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_CANONICAL_IDENTITY");
      expect(result.excluded[0]?.detail).toMatch(/no persisted assetAddress/);
    });

    it("excludes a native identity with an address other than the canonical native token address", async () => {
      const fakeNativeAddress = `0x${"0".repeat(36)}dead`;
      const db = makeDb({
        balances: [
          {
            assetId: `chain:369:native:${fakeNativeAddress}`,
            assetAddress: null,
            decimals: 18,
            balanceQuantity: decimal("5"),
          },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_CANONICAL_IDENTITY");
      expect(result.excluded[0]?.detail).toMatch(/canonical PulseChain native asset identity/);
    });

    it("accepts a valid canonical ERC-20 identity whose assetId address matches assetAddress exactly", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discoverPriceIngestCandidates({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        db,
      });

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenAddress).toBe(PHEX_ADDRESS);
    });

    it("accepts the valid canonical native PLS identity", async () => {
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

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenAddress).toBe(
        "0x0000000000000000000000000000000000000000",
      );
    });
  });
});
