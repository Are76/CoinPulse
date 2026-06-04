import { describe, expect, it, vi } from "vitest";
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
const OBSERVED_AT = new Date("2026-06-01T12:00:00.000Z");

const PHEX_ADDRESS: Address = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const PHEX_DECIMALS = 8;
const PHEX_ASSET_ID = `chain:369:erc20:${PHEX_ADDRESS}`;

const PLS_ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const PLS_ASSET_ID = "chain:369:native:PLS";
const PLS_DECIMALS = 18;

// These should not be the real factory addresses — using distinct mock values
// so any test that receives a real address instead of a mock will throw.
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
  /** Expected [amountIn, path] for getAmountsOut. Defaults to pHEX values. */
  expectedGetAmountsOutArgs?: readonly [bigint, readonly Address[]];
  /** Expected [tokenA, tokenB] for getPair. Defaults to [PHEX, WPLS]. */
  expectedGetPairArgs?: readonly [Address, Address];
}): PublicClient {
  const amountsOut = overrides?.amountsOut ?? PHEX_AMOUNTS_OUT;
  const reserves = overrides?.reserves ?? HIGH_LIQUIDITY_RESERVES;
  const token0 = overrides?.token0 ?? PHEX_ADDRESS;
  const expectedGetAmountsOutArgs = overrides?.expectedGetAmountsOutArgs ??
    ([100_000_000n, [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS]] as const);
  const expectedGetPairArgs = overrides?.expectedGetPairArgs ??
    ([PHEX_ADDRESS, WPLS_ADDRESS] as const);

  return buildMockClient(({ address, functionName, args }) => {
    if (
      address === PULSEX_V1_ROUTER_ADDRESS &&
      functionName === "getAmountsOut"
    ) {
      expect(args).toEqual(expectedGetAmountsOutArgs);
      return amountsOut;
    }
    if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
      return MOCK_FACTORY_V1;
    }
    if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
      expect(args).toEqual(expectedGetPairArgs);
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

/** Happy-path mock for native PLS: routes WPLS → pDAI via V1. */
function buildHappyV1PlsClient(): PublicClient {
  return buildMockClient(({ address, functionName, args }) => {
    if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "getAmountsOut") {
      expect(args).toEqual([1_000_000_000_000_000_000n, [WPLS_ADDRESS, PDAI_ADDRESS]]);
      return WPLS_AMOUNTS_OUT;
    }
    if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
      return MOCK_FACTORY_V1;
    }
    if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
      expect(args).toEqual([WPLS_ADDRESS, PDAI_ADDRESS]);
      return MOCK_PAIR_ADDRESS;
    }
    if (address === MOCK_PAIR_ADDRESS && functionName === "getReserves") {
      return HIGH_LIQUIDITY_RESERVES;
    }
    if (address === MOCK_PAIR_ADDRESS && functionName === "token0") {
      return WPLS_ADDRESS;
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
      const result = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1PlsClient(),
        chainId: CHAIN_ID,
        assetId: PLS_ASSET_ID,
        tokenAddress: PLS_ZERO_ADDRESS,
        tokenDecimals: PLS_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
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
      const result = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1PlsClient(),
        chainId: CHAIN_ID,
        assetId: PLS_ASSET_ID,
        tokenAddress: PLS_ZERO_ADDRESS,
        tokenDecimals: PLS_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.assetAddress).toBeNull();
    });
  });

  describe("V1 fails → V2 fallback", () => {
    it("falls back to V2 when V1 returns zero amountsOut", async () => {
      const expectedPath = [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS] as const;
      const client = buildMockClient(({ address, functionName, args }) => {
        // V1: returns zero amounts — triggers fallback
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, expectedPath]);
          return [100_000_000n, 0n, 0n];
        }
        // V2: returns valid amounts
        if (
          address === PULSEX_V2_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, expectedPath]);
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V2_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          expect(args).toEqual([PHEX_ADDRESS, WPLS_ADDRESS]);
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.sourceId).toMatch(/pulsex_v2/);
      expect(result.draft.routeMetadata?.router).toBe("pulsex_v2");
    });

    it("falls back to V2 when V1 readContract throws", async () => {
      const expectedPath = [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS] as const;
      const client = buildMockClient(({ address, functionName, args }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, expectedPath]);
          throw new Error("execution reverted");
        }
        if (
          address === PULSEX_V2_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, expectedPath]);
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V2_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          expect(args).toEqual([PHEX_ADDRESS, WPLS_ADDRESS]);
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.sourceId).toMatch(/pulsex_v2/);
    });
  });

  describe("input validation guards", () => {
    it("returns ok: false for a non-PulseChain chain ID", async () => {
      const result = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1Client(),
        chainId: 1, // Ethereum mainnet
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("unsupported_chain_id");
    });

    it("returns ok: false for a negative tokenDecimals value", async () => {
      const client = buildMockClient(({ functionName }) => {
        if (functionName === "getAmountsOut") throw new Error("should not be called");
        throw new Error(`Unexpected: ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: -1,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("invalid_token_decimals");
    });

    it("returns ok: false for a non-integer tokenDecimals value", async () => {
      const result = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1Client(),
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: 8.5,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("invalid_token_decimals");
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toContain("v1 rpc timeout");
      expect(result.reason).toContain("v2 execution reverted");
    });
  });

  describe("getReserves failure is non-fatal", () => {
    it("returns ok: true with null liquidityUsd when getPair throws", async () => {
      const client = buildMockClient(({ address, functionName, args }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS]]);
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.draft.liquidityUsd).toBeNull();
      // Confidence falls back to 0.50 when liquidity is unknown
      expect(result.draft.confidence).toBe("0.5");
    });

    it("returns ok: true when pair address is the null address", async () => {
      const NULL_PAIR: Address = "0x0000000000000000000000000000000000000000";

      const client = buildMockClient(({ address, functionName, args }) => {
        if (
          address === PULSEX_V1_ROUTER_ADDRESS &&
          functionName === "getAmountsOut"
        ) {
          expect(args).toEqual([100_000_000n, [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS]]);
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          return MOCK_FACTORY_V1;
        }
        if (address === MOCK_FACTORY_V1 && functionName === "getPair") {
          expect(args).toEqual([PHEX_ADDRESS, WPLS_ADDRESS]);
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
        observedAt: OBSERVED_AT,
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
      // observedAt must equal the caller-supplied value (not wall-clock time)
      expect(draft.observedAt).toBe(OBSERVED_AT);
      expect(typeof draft.confidence).toBe("string");
      expect(Number(draft.confidence)).toBeGreaterThan(0);
      expect(Number(draft.confidence)).toBeLessThanOrEqual(1);
    });
  });

  describe("determinism — observedAt propagated from caller", () => {
    it("sets observedAt to the caller-supplied timestamp, not wall-clock time", async () => {
      const stableTimestamp = new Date("2026-01-15T08:30:00.000Z");
      const client = buildHappyV1Client();

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: stableTimestamp,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The draft must carry back exactly the caller's Date instance.
      // persistPriceObservations() hashes observedAt into the observation ID,
      // so using the same block+timestamp on rebuild must produce the same ID.
      expect(result.draft.observedAt).toBe(stableTimestamp);
      expect(result.draft.observedAt.toISOString()).toBe(
        "2026-01-15T08:30:00.000Z",
      );
    });

    it("two calls with the same observedAt produce identical observation inputs", async () => {
      const stableTimestamp = new Date("2026-01-15T08:30:00.000Z");

      const args = {
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        tokenAddress: PHEX_ADDRESS,
        tokenDecimals: PHEX_DECIMALS,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: stableTimestamp,
      };

      const r1 = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1Client(),
        ...args,
      });
      const r2 = await fetchOnchainPulseXPrice({
        publicClient: buildHappyV1Client(),
        ...args,
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      // Same inputs → same observation ID inputs → idempotent persistence
      expect(r1.draft.observedAt.toISOString()).toBe(
        r2.draft.observedAt.toISOString(),
      );
      expect(r1.draft.price).toBe(r2.draft.price);
      expect(r1.draft.sourceId).toBe(r2.draft.sourceId);
    });
  });

  describe("pDAI par observation", () => {
    const PDAI_ASSET_ID = `chain:369:erc20:${PDAI_ADDRESS.toLowerCase()}`;

    it("returns ok: true with price 1 without any RPC calls", async () => {
      // Client that throws on any call — should never be invoked for pDAI
      const client = buildMockClient(({ functionName }) => {
        throw new Error(`Unexpected RPC call for pDAI: ${functionName}`);
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PDAI_ASSET_ID,
        tokenAddress: PDAI_ADDRESS,
        tokenDecimals: 18,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.price).toBe("1");
    });

    it("uses ORACLE sourceType and pulsex:pdai:par sourceId", async () => {
      const client = buildMockClient(() => {
        throw new Error("should not be called");
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PDAI_ASSET_ID,
        tokenAddress: PDAI_ADDRESS,
        tokenDecimals: 18,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.sourceType).toBe("ORACLE");
      expect(result.draft.sourceId).toBe("pulsex:pdai:par");
    });

    it("sets assetAddress to PDAI_ADDRESS and preserves observedAt and blockNumber", async () => {
      const client = buildMockClient(() => {
        throw new Error("should not be called");
      });

      const result = await fetchOnchainPulseXPrice({
        publicClient: client,
        chainId: CHAIN_ID,
        assetId: PDAI_ASSET_ID,
        tokenAddress: PDAI_ADDRESS,
        tokenDecimals: 18,
        quoteAsset: QUOTE_ASSET,
        blockNumber: BLOCK_NUMBER,
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.assetAddress).toBe(PDAI_ADDRESS);
      expect(result.draft.observedAt).toBe(OBSERVED_AT);
      expect(result.draft.blockNumber).toBe(BLOCK_NUMBER);
      expect(result.draft.confidence).toBe("1");
    });
  });

  describe("factory() failure is non-fatal", () => {
    it("returns a valid price draft when factory() throws after a successful getAmountsOut", async () => {
      const client = buildMockClient(({ address, functionName, args }) => {
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "getAmountsOut") {
          expect(args).toEqual([100_000_000n, [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS]]);
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          throw new Error("rpc: factory() timeout");
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Price must still be correct
      expect(result.draft.price).toBe("0.021");
      // Liquidity degrades to null → confidence falls back to 0.50
      expect(result.draft.liquidityUsd).toBeNull();
      expect(result.draft.confidence).toBe("0.5");
    });

    it("does NOT fall back to V2 when only factory() fails — V2 is reserved for quote failure", async () => {
      let v2Calls = 0;
      const client = buildMockClient(({ address, functionName, args }) => {
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "getAmountsOut") {
          expect(args).toEqual([100_000_000n, [PHEX_ADDRESS, WPLS_ADDRESS, PDAI_ADDRESS]]);
          return PHEX_AMOUNTS_OUT;
        }
        if (address === PULSEX_V1_ROUTER_ADDRESS && functionName === "factory") {
          throw new Error("factory timeout");
        }
        if (address === PULSEX_V2_ROUTER_ADDRESS) {
          v2Calls++;
          throw new Error("should not reach V2");
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
        observedAt: OBSERVED_AT,
      });

      expect(result.ok).toBe(true);
      expect(v2Calls).toBe(0);
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
