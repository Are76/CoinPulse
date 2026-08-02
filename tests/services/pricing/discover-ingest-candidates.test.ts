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
  type DiscoverIngestCandidatesArgs,
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

// The one and only safe quoteAsset value — see the service's module
// docstring and Finding 1 of the blocker fix pass. Never "fiat:usd".
const EXPECTED_QUOTE_ASSET = PDAI_ASSET_ID;

const ASOF = new Date("2026-08-02T00:00:00.000Z");
// 60s before ASOF — well inside the 900s freshness threshold.
const FRESH_MATERIALIZED_AT = new Date(ASOF.getTime() - 60_000);
// 2000s before ASOF — outside the 900s freshness threshold.
const STALE_MATERIALIZED_AT = new Date(ASOF.getTime() - 2_000_000);

const HEALTHY_MATERIALIZATION_STATE = {
  status: "COMPLETED" as const,
  completedSuccessfully: true,
  latestMaterializedAt: FRESH_MATERIALIZED_AT,
  warningCount: 0,
  errorMessage: null,
};

function decimal(value: string): { toString(): string } {
  return { toString: () => value };
}

type MaterializationStateOverride = {
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  latestMaterializedAt: Date | null;
  warningCount: number;
  errorMessage: string | null;
} | null;

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
  /** Defaults to a healthy COMPLETED/fresh/zero-warning row. Pass null for "no record". */
  materializationState?: MaterializationStateOverride;
}): DiscoveryDbClient & {
  calls: {
    portfolioTokenBalance: unknown[];
    token: unknown[];
    tokenMetadataSource: unknown[];
    portfolioLpPosition: unknown[];
    portfolioMaterializationState: unknown[];
  };
} {
  const balances = overrides?.balances ?? [];
  const tokens = overrides?.tokens ?? [];
  const metadataSources = overrides?.metadataSources ?? [];
  const lpPositions = overrides?.lpPositions ?? [];
  const materializationState =
    overrides?.materializationState === undefined
      ? HEALTHY_MATERIALIZATION_STATE
      : overrides.materializationState;

  const calls = {
    portfolioTokenBalance: [] as unknown[],
    token: [] as unknown[],
    tokenMetadataSource: [] as unknown[],
    portfolioLpPosition: [] as unknown[],
    portfolioMaterializationState: [] as unknown[],
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
        if (args.where.walletId !== WALLET_ID || args.where.chainId !== CHAIN_ID) return [];
        return lpPositions;
      }),
    },
    portfolioMaterializationState: {
      findUnique: vi.fn(async (args) => {
        calls.portfolioMaterializationState.push(args);
        if (
          args.where.walletId_chainId.walletId !== WALLET_ID ||
          args.where.walletId_chainId.chainId !== CHAIN_ID
        ) {
          return null;
        }
        return materializationState;
      }),
    },
  };
}

/** Wraps discoverPriceIngestCandidates with the shared default args + fixed asOf. */
function discover(
  db: DiscoveryDbClient,
  overrides?: Partial<DiscoverIngestCandidatesArgs>,
) {
  return discoverPriceIngestCandidates({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    walletAddress: WALLET_ADDRESS,
    asOf: ASOF,
    db,
    ...overrides,
  });
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

    const result = await discover(db);

    expect(result.eligible).toEqual([
      {
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: 8,
        quoteAsset: EXPECTED_QUOTE_ASSET,
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
    expect(result.materializationHealth.healthy).toBe(true);
  });

  it("scopes results to the requested wallet only", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
      ],
    });

    await discover(db);

    expect(db.calls.portfolioTokenBalance[0]).toEqual({
      where: { walletId: WALLET_ID, chainId: CHAIN_ID },
    });
  });

  it("rejects an unsupported chainId", async () => {
    const db = makeDb();

    await expect(discover(db, { chainId: 1 })).rejects.toThrow(
      UnsupportedIngestDiscoveryChainError,
    );
  });

  it("excludes zero balances with ZERO_BALANCE", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("0") },
      ],
    });

    const result = await discover(db);

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

    const result = await discover(db);

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

    const result = await discover(db);

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

    const result = await discover(db);

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

    const result = await discover(db);

    expect(result.excluded[0]?.reason).toBe("IGNORED_ASSET");
  });

  it("excludes the LP asset class via canonical PortfolioLpPosition.lpAssetId, without symbol matching", async () => {
    const db = makeDb({
      balances: [
        { assetId: LP_ASSET_ID, assetAddress: LP_TOKEN_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
      ],
      lpPositions: [{ lpAssetId: LP_ASSET_ID }],
    });

    const result = await discover(db);

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

    const result = await discover(db);

    expect(result.eligible).toEqual([
      {
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: 8,
        quoteAsset: EXPECTED_QUOTE_ASSET,
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

    const result = await discover(db);

    expect(result.eligible).toEqual([
      {
        assetId: PLS_ASSET_ID,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        tokenDecimals: 18,
        quoteAsset: EXPECTED_QUOTE_ASSET,
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

    const result = await discover(db);

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

    const result = await discover(db);

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

    const result = await discover(db);

    expect(result.totalEligibleBeforeCap).toBe(60);
    expect(result.totalReturned).toBe(50);
    expect(result.eligible).toHaveLength(50);
    expect(result.cap).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("produces a successful report with zero eligible candidates", async () => {
    const db = makeDb({ balances: [] });

    const result = await discover(db);

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
    await discover(db);

    // Behavioral, not insertion-order: exactly the expected read-only calls
    // happened, and nothing RPC/ingestion-shaped exists on the client at all.
    expect(db.portfolioTokenBalance.findMany).toHaveBeenCalledTimes(1);
    expect(db.token.findMany).toHaveBeenCalledTimes(1);
    expect(db.portfolioLpPosition.findMany).toHaveBeenCalledTimes(1);
    expect(db.portfolioMaterializationState.findUnique).toHaveBeenCalledTimes(1);
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

    const result = await discover(db);

    expect(result.eligible).toHaveLength(1);
    expect(result.excluded).toEqual([]);
  });

  it("never labels a candidate verified, trusted, priced, or USD-valued", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
      ],
    });

    const result = await discover(db);

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/verified|trusted|priced|usdvalue/);
  });

  it("never emits fiat:usd as a quoteAsset for a pDAI-routed ingestion candidate", async () => {
    const db = makeDb({
      balances: [
        { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("1") },
        { assetId: PLS_ASSET_ID, assetAddress: null, decimals: 18, balanceQuantity: decimal("1") },
      ],
    });

    const result = await discover(db);

    expect(result.eligible.length).toBeGreaterThan(0);
    for (const candidate of result.eligible) {
      expect(candidate.quoteAsset).toBe(EXPECTED_QUOTE_ASSET);
      expect(candidate.quoteAsset).not.toBe("fiat:usd");
    }
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

      await discover(db);

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

      const result = await discover(db);

      // Unrelated token never queried, so its metadata source could not have
      // been fetched or consumed either.
      expect(db.calls.tokenMetadataSource).toEqual([{ where: { tokenId: { in: ["token-phex"] } } }]);
      expect(result.eligible).toEqual([
        {
          assetId: PHEX_ASSET_ID,
          tokenAddress: PHEX_ADDRESS,
          tokenDecimals: 8,
          quoteAsset: EXPECTED_QUOTE_ASSET,
          walletAddress: WALLET_ADDRESS,
          chainId: CHAIN_ID,
          decimalsSource: "seed:phex",
        },
      ]);
    });

    it("skips Token and TokenMetadataSource queries entirely when the wallet has no balance rows", async () => {
      const db = makeDb({ balances: [] });

      await discover(db);

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

      const result = await discover(db);

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

      const result = await discover(db);

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

      const result = await discover(db);

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

      const result = await discover(db);

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

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenAddress).toBe(PHEX_ADDRESS);
    });

    it("accepts the valid canonical native PLS identity", async () => {
      const db = makeDb({
        balances: [
          { assetId: PLS_ASSET_ID, assetAddress: null, decimals: 18, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenAddress).toBe(
        "0x0000000000000000000000000000000000000000",
      );
    });

    it("normalizes a mixed-case persisted assetAddress to lowercase in the emitted tokenAddress", async () => {
      const mixedCaseAddress = "0x2B591E99afe9F32EAA6214f7B7629768C40Eeb39";
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: mixedCaseAddress, decimals: 8, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenAddress).toBe(PHEX_ADDRESS);
    });
  });

  describe("materialization health gates eligibility", () => {
    it("healthy COMPLETED/fresh/zero-warning materialization allows normal classification", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.materializationHealth).toEqual({
        healthy: true,
        status: "COMPLETED",
        completedSuccessfully: true,
        freshnessStatus: "fresh",
        freshnessReason: null,
        latestMaterializedAt: FRESH_MATERIALIZED_AT.toISOString(),
        warningCount: 0,
        errorMessage: null,
      });
      expect(result.eligible).toHaveLength(1);
    });

    it("failed materialization refuses eligible output and returns zero candidates", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: {
          status: "FAILED",
          completedSuccessfully: false,
          latestMaterializedAt: FRESH_MATERIALIZED_AT,
          warningCount: 0,
          errorMessage: "sync interrupted",
        },
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded).toEqual([]);
      expect(result.materializationHealth.healthy).toBe(false);
      expect(result.materializationHealth.status).toBe("FAILED");
      expect(result.materializationHealth.errorMessage).toBe("sync interrupted");
      expect(result.totalBalanceRowsInspected).toBe(1);
    });

    it("incomplete materialization (RUNNING) refuses eligible output", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: {
          status: "RUNNING",
          completedSuccessfully: false,
          latestMaterializedAt: FRESH_MATERIALIZED_AT,
          warningCount: 0,
          errorMessage: null,
        },
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.materializationHealth.healthy).toBe(false);
      expect(result.materializationHealth.status).toBe("RUNNING");
    });

    it("stale materialization (older than the repository's 900s threshold) refuses eligible output", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: {
          status: "COMPLETED",
          completedSuccessfully: true,
          latestMaterializedAt: STALE_MATERIALIZED_AT,
          warningCount: 0,
          errorMessage: null,
        },
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.materializationHealth.healthy).toBe(false);
      expect(result.materializationHealth.freshnessStatus).toBe("stale");
    });

    it("material integrity warnings (warningCount > 0) refuse eligible output", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: {
          status: "COMPLETED",
          completedSuccessfully: true,
          latestMaterializedAt: FRESH_MATERIALIZED_AT,
          warningCount: 1,
          errorMessage: null,
        },
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.materializationHealth.healthy).toBe(false);
      expect(result.materializationHealth.warningCount).toBe(1);
    });

    it("no materialization record at all refuses eligible output", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: null,
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.materializationHealth).toEqual({
        healthy: false,
        status: null,
        completedSuccessfully: null,
        freshnessStatus: "unknown",
        freshnessReason: "No materialization record exists.",
        latestMaterializedAt: null,
        warningCount: 0,
        errorMessage: null,
      });
    });

    it("does not query Token/TokenMetadataSource when materialization is unhealthy", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        materializationState: null,
      });

      await discover(db);

      expect(db.token.findMany).not.toHaveBeenCalled();
      expect(db.tokenMetadataSource.findMany).not.toHaveBeenCalled();
    });
  });

  describe("decimals conflict includes the persisted balance decimals", () => {
    it("balance 8 + metadata 18 is a conflict", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
        ],
        metadataSources: [{ tokenId: "token-phex", decimals: 18 }],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("CONFLICTING_DECIMALS");
      expect(result.excluded[0]?.detail).toMatch(/PortfolioTokenBalance\.decimals/);
    });

    it("balance 18 + metadata 18 is allowed", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
        ],
        metadataSources: [{ tokenId: "token-phex", decimals: 18 }],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible).toHaveLength(1);
    });

    it("multiple metadata values all agreeing with the balance are allowed", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
        ],
        metadataSources: [
          { tokenId: "token-phex", decimals: 8 },
          { tokenId: "token-phex", decimals: 8 },
        ],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible).toHaveLength(1);
    });

    it("metadata sources conflicting with each other remain excluded regardless of balance", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8, balanceQuantity: decimal("5") },
        ],
        tokens: [
          { id: "token-phex", assetId: PHEX_ASSET_ID, isIgnored: false, decimalsSource: "seed:phex" },
        ],
        metadataSources: [
          { tokenId: "token-phex", decimals: 8 },
          { tokenId: "token-phex", decimals: 6 },
        ],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("CONFLICTING_DECIMALS");
    });
  });

  describe("accepted decimals range (matches priceIngestRequestSchema: integer 0-18)", () => {
    it("accepts the minimum boundary (0)", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 0, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenDecimals).toBe(0);
    });

    it("accepts the maximum boundary (18)", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 18, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.excluded).toEqual([]);
      expect(result.eligible[0]?.tokenDecimals).toBe(18);
    });

    it("excludes below the minimum (-1) with INVALID_DECIMALS", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: -1, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_DECIMALS");
    });

    it("excludes above the maximum (19) with INVALID_DECIMALS", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 19, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_DECIMALS");
    });

    it("excludes a non-integer decimals value with INVALID_DECIMALS", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 8.5, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      expect(result.excluded[0]?.reason).toBe("INVALID_DECIMALS");
    });

    it("does not silently clamp or normalize an invalid decimals value", async () => {
      const db = makeDb({
        balances: [
          { assetId: PHEX_ASSET_ID, assetAddress: PHEX_ADDRESS, decimals: 19, balanceQuantity: decimal("5") },
        ],
      });

      const result = await discover(db);

      expect(result.eligible).toEqual([]);
      // No eligible row with a clamped decimals value (e.g. 18) exists.
      expect(result.eligible.some((c) => c.tokenDecimals === 18)).toBe(false);
    });
  });

  describe("native PLS remains reachable past the 50-item cap", () => {
    it("returns native PLS plus 49 ERC-20s (not the 50 lexicographically-first ERC-20s) when 50+ ERC-20 balances plus PLS are eligible", async () => {
      const erc20Balances = Array.from({ length: 55 }, (_, i) => {
        const address = `0x${(i + 1).toString(16).padStart(40, "0")}`;
        return {
          assetId: `chain:369:erc20:${address}`,
          assetAddress: address,
          decimals: 18,
          balanceQuantity: decimal("1"),
        };
      });
      const db = makeDb({
        balances: [
          ...erc20Balances,
          { assetId: PLS_ASSET_ID, assetAddress: null, decimals: 18, balanceQuantity: decimal("1") },
        ],
      });

      const result = await discover(db);

      expect(result.totalEligibleBeforeCap).toBe(56);
      expect(result.truncated).toBe(true);
      expect(result.eligible).toHaveLength(50);
      expect(result.eligible[0]?.assetId).toBe(PLS_ASSET_ID);
      expect(result.eligible.map((c) => c.assetId)).toContain(PLS_ASSET_ID);
    });

    it("keeps a pure-ascending order among non-priority assets when no priority asset is present", async () => {
      const bAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const aAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const db = makeDb({
        balances: [
          { assetId: `chain:369:erc20:${bAddress}`, assetAddress: bAddress, decimals: 18, balanceQuantity: decimal("1") },
          { assetId: `chain:369:erc20:${aAddress}`, assetAddress: aAddress, decimals: 18, balanceQuantity: decimal("1") },
        ],
      });

      const result = await discover(db);

      expect(result.eligible.map((c) => c.assetId)).toEqual([
        `chain:369:erc20:${aAddress}`,
        `chain:369:erc20:${bAddress}`,
      ]);
    });
  });
});
