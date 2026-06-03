import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PublicClient, Address } from "viem";

import {
  fetchOnchainPulseXPrice,
  confidenceFromLiquidityUsd,
  WPLS_ADDRESS,
  PDAI_ADDRESS,
  PULSEX_V1_ROUTER_ADDRESS,
  PULSEX_V2_ROUTER_ADDRESS,
} from "@/services/pricing/fetchers/onchain-pulsex-fetcher";
import { Decimal } from "@/lib/decimal";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CHAIN_ID = 369;
const BLOCK_NUMBER = 21_000_000n;
const QUOTE_ASSET = "fiat:usd";

const PHEX_ADDRESS: Address = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const PHEX_DECIMALS = 8;
const PHEX_ASSET_ID = `chain:369:erc20:${PHEX_ADDRESS}`;

const PLS_ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const PLS_ASSET_ID = "chain:369:native:PLS";
const PLS_DECIMALS = 18;

const MOCK_FACTORY_V1: Address = "0x1715a3E4A142d8b698131108995174F37aEBA10D";
const MOCK_PAIR_ADDRESS: Address = "0xaAbBcCdDeEfF00112233445566778899aAbBcCdD";

// 1 pHEX (1e8) → amounts through [pHEX, WPLS, pDAI]: simulate price of ~0.021 USD
// pDAI has 18 decimals: 0.021 * 1e18 = 21_000_000_000_000_000n
const PHEX_AMOUNTS_OUT: readonly bigint[] = [
  100_000_000n, // 1 pHEX in
  2_500_000_000_000_000_000n, // intermediate WPLS amount
  21_000_000_000_000_000n, // ~0.021 pDAI out
];

// 1 WPLS (1e18) → [WPLS, pDAI]: simulate price of ~0.000085 USD
// 0.000085 * 1e18 = 85_000_000_000_000n
const WPLS_AMOUNTS_OUT: readonly bigint[] = [
  1_000_000_000_000_000_000n,
  85_000_000_000_000n,
];

// getReserves: [reserve0, reserve1, blockTimestampLast]
// Large reserves → high confidence
const HIGH_LIQUIDITY_RESERVES = [
  500_000_000_000_000_000_000_000n, // reserve0 (token, normalises to 5M)
  300_000_000_000_000_000_000_000n, // reserve1
  1_000_000n,
] as const;

// ─── Mock public client builder ───────────────────────────────────────────────

function buildMockClient(
  readContractImpl: (args: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
  }) => unknown,
): PublicClient {
  return {
    readContract: vi.fn().mockImplementation(readContractImpl),
  } as unknown as PublicClient;
}

/** Standard happy-path mock: V1 succeeds for pHEX */
function buildHappyV1Client(overrides?: {
  amountsOut?: readonly bigint[];
  reserves?: readonly [bigint, bigint, number | bigint];
  token0?: Address;
}): PublicClient {
  const amountsOut = overrides?.amountsOut ?? PHEX_AMOUNTS_OUT;
  const reserves = overrides?.reserves ?? HIGH_LIQUIDITY_RESERVES;
  const token0 = overrides?.token0 ?? PHEX_ADDRESS;

  return buildMockClient(({ address, functionName }) => {
    if (
      address === PULSEX_V1_ROUTER_ADDRESS &&
      functionName === "getAmountsOut"
    ) {
      return amountsOut;
    }
    if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
      return MOCK_FACTORY_V1;
    }
    if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
      return MOCK_PAIR_ADDRESS;
    }
    if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
      return reserves;
    }
    if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
      return token0;
    }
    throw new Error(`Unexpected readContract call: ${address} ${functionName}`);
  });
}

// ─── fetchOnchainPulseXPrice ──────────────────────────────────────────────────

describe("fetchOnchainPulseXPrice", () => {
  describe("V1 happy path — pHEX (8 decimals)", () => {
    it("returns a well-formed ONCHAIN_POOL draft when V1 succeeds", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { draft } = result;
      expect(draft.sourceType).toBe("ONCHAIN_POOL");
      expect(draft.chainId).toBe(CHAIN_ID);
      expect(draft.assetId).toBe(PHEX_ASSET_ID);
      expect(draft.assetAddress).toBe(PHEX_ADDRESS);
      expect(draft.quoteAsset).toBe(QUOTE_ASSET);
      expect(draft.blockNumber).toBe(BLOCK_NUMBER);
      expect(draft.staleAfterSeconds).toBe(120);
    });

    it("computes the correct USD price from getAmountsOut", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 21_000_000_000_000_000 / 1e18 = 0.021
      expect(result.draft.price).toBe("0.021");
    });

    it("includes a route through WPLS and pDAI for non-WPLS tokens", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const path = result.draft.routeMetadata?.path as Address[];
      expect(path).toHaveLength(3);
      expect(path[0].toLowerCase()).toBe(PHEX_ADDRESS.toLowerCase());
      expect(path[1].toLowerCase()).toBe(WPLS_ADDRESS.toLowerCase());
      expect(path[2].toLowerCase()).toBe(PDAI_ADDRESS.toLowerCase());
    });

    it("sets sourceId that contains the router label and route", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.sourceId).toMatch(/^pulsex:pulsex_v1:route:/);
    });

    it("persists liquidity and factory address in routeMetadata", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.routeMetadata?.factoryAddress).toBe(MOCK_FACTORY_V1);
      expect(result.draft.routeMetadata?.pairAddress).toBe(MOCK_PAIR_ADDRESS);
      expect(result.draft.routeMetadata?.router).toBe("pulsex_v1");
    });
  });

  describe("V1 happy path — native PLS (zero address)", () => {
    it("routes PLS through WPLS without a two-hop intermediary", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return WPLS_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          return MOCK_PAIR_ADDRESS;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
          return HIGH_LIQUIDITY_RESERVES;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
          return WPLS_ADDRESS;
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PLS_ASSET_ID,
        tokenAddress: PLS_ZERO_ADDRESS,
        tokenDecimals: PLS_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Route is [WPLS, pDAI] — only 2 hops
      const path = result.draft.routeMetadata?.path as Address[];
      expect(path).toHaveLength(2);
      expect(path[0].toLowerCase()).toBe(WPLS_ADDRESS.toLowerCase());
      expect(path[1].toLowerCase()).toBe(PDAI_ADDRESS.toLowerCase());
    });

    it("does not set assetAddress for native PLS", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return WPLS_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          return MOCK_PAIR_ADDRESS;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
          return HIGH_LIQUIDITY_RESERVES;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
          return WPLS_ADDRESS;
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PLS_ASSET_ID,
        tokenAddress: PLS_ZERO_ADDRESS,
        tokenDecimals: PLS_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.assetAddress).toBeNull();
    });
  });

  describe("V1 fails → V2 fallback", () => {
    it("falls back to V2 when V1 returns zero amountsOut", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        // V1: returns zero amounts — triggers fallback
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return [100_000_000n, 0n, 0n];
        }
        // V2: returns valid amounts
        if (
          address === PULSEX_V2_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V2_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          return MOCK_PAIR_ADDRESS;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
          return HIGH_LIQUIDITY_RESERVES;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
          return PHEX_ADDRESS;
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.sourceId).toMatch(/pulsex_v2/);
      expect(result.draft.routeMetadata?.router).toBe("pulsex_v2");
    });

    it("falls back to V2 when V1 readContract throws", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          throw new Error("execution reverted");
        }
        if (
          address === PULSEX_V2_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V2_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          return MOCK_PAIR_ADDRESS;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
          return HIGH_LIQUIDITY_RESERVES;
        }
        if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
          return PHEX_ADDRESS;
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.sourceId).toMatch(/pulsex_v2/);
    });
  });

  describe("both V1 and V2 fail", () => {
    it("returns ok: false without writing any observation", async () => {
      const client = buildMockClient(({ functionName }) => {
        if (functionName === "getAmountsOut") {
          throw new Error("timeout");
        }
        throw new Error(`Unexpected: ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toContain("V1:");
      expect(result.reason).toContain("V2:");
    });

    it("includes the underlying error text in the reason string", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        if (functionName === "getAmountsOut") {
          if (address === PULSEX_V1_ROUTER_ADDRESS)
            throw new Error("v1 rpc timeout");
          if (address === PULSEX_V2_ROUTER_ADDRESS)
            throw new Error("v2 execution reverted");
        }
        throw new Error(`Unexpected: ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toContain("v1 rpc timeout");
      expect(result.reason).toContain("v2 execution reverted");
    });
  });

  describe("getReserves failure is non-fatal", () => {
    it("returns ok: true with null liquidityUsd when getPair throws", async () => {
      const client = buildMockClient(({ address, functionName }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        // Simulate factory failing to return pair
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          throw new Error("rpc error");
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.liquidityUsd).toBeNull();
      // Confidence falls back to 0.50 when liquidity is unknown
      expect(result.draft.confidence).toBe("0.5");
    });

    it("returns ok: true when pair address is the null address", async () => {
      const NULL_PAIR: Address = "0x0000000000000000000000000000000000000000";

      const client = buildMockClient(({ address, functionName }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          return NULL_PAIR;
        }
        throw new Error(`Unexpected: ${address} ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.liquidityUsd).toBeNull();
    });
  });

  describe("reserve-side identification", () => {
    it("uses reserve1 when the target token is token1 in the pair", async () => {
      // Make pHEX be token1 in the pair (token0 is WPLS)
      const client = buildHappyV1Client({ token0: WPLS_ADDRESS });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      // Should still succeed — reserve1 used instead of reserve0
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.price).toBe("0.021");
    });
  });

  describe("draft conforms to PriceObservationDraft contract", () => {
    it("has all required fields present and non-null where expected", async () => {
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { draft } = result;
      expect(typeof draft.chainId).toBe("number");
      expect(typeof draft.assetId).toBe("string");
      expect(typeof draft.quoteAsset).toBe("string");
      expect(typeof draft.price).toBe("string");
      expect(draft.price).not.toBe("0");
      expect(draft.price).not.toBe("");
      expect(draft.sourceType).toBe("ONCHAIN_POOL");
      expect(typeof draft.sourceId).toBe("string");
      expect(draft.blockNumber).toBe(BLOCK_NUMBER);
      expect(draft.staleAfterSeconds).toBeGreaterThan(0);
      expect(draft.observedAt).toBeInstanceOf(Date);
      expect(typeof draft.confidence).toBe("string");
      expect(Number(draft.confidence)).toBeGreaterThan(0);
      expect(Number(draft.confidence)).toBeLessThanOrEqual(1);
    });
  });
});

// ─── confidenceFromLiquidityUsd ───────────────────────────────────────────────

describe("confidenceFromLiquidityUsd", () => {
  it("returns 0.50 for null liquidity", () => {
    expect(confidenceFromLiquidityUsd(null).toString()).toBe("0.5");
  });

  it("returns 0.30 for sub-$1k liquidity", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("500")).toString()).toBe("0.3");
  });

  it("returns 0.55 for $1k–$10k liquidity", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("5000")).toString()).toBe("0.55");
  });

  it("returns 0.70 for $10k–$100k liquidity", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("50000")).toString()).toBe("0.7");
  });

  it("returns 0.85 for $100k–$1M liquidity", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("500000")).toString()).toBe("0.85");
  });

  it("returns 0.95 for $1M+ liquidity", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("2000000")).toString()).toBe("0.95");
  });

  it("applies boundary at exactly $1M", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("1000000")).toString()).toBe("0.95");
  });

  it("applies boundary at exactly $100k", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("100000")).toString()).toBe("0.85");
  });

  it("applies boundary at exactly $10k", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("10000")).toString()).toBe("0.7");
  });

  it("applies boundary at exactly $1k", () => {
    expect(confidenceFromLiquidityUsd(new Decimal("1000")).toString()).toBe("0.55");
  });

  it("returns confidence within [0, 1] for all tier values", () => {
    const inputs = [null, new Decimal("1"), new Decimal("500"), new Decimal("5000"),
      new Decimal("50000"), new Decimal("500000"), new Decimal("5000000")];

    for (const input of inputs) {
      const conf = confidenceFromLiquidityUsd(input);
      expect(conf.gte(0)).toBe(true);
      expect(conf.lte(1)).toBe(true);
    }
  });
});
