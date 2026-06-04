import "server-only";

import type { Address, PublicClient } from "viem";

import { Decimal } from "@/lib/decimal";
import { logError, logInfo } from "@/lib/logger";
import type { PriceObservationDraft } from "@/services/pricing/types";

// Wrapped PLS — used by PulseX router for native PLS routing
export const WPLS_ADDRESS: Address = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
// Bridged DAI on PulseChain — USD reference asset
export const PDAI_ADDRESS: Address = "0xefD766cCb38EaF1dfd701853BFCe31359239F305";
const PDAI_DECIMALS = 18;

export const PULSEX_V1_ROUTER_ADDRESS: Address =
  "0x165C3410fCFC25d20e313475ec53774f57C0f719";
export const PULSEX_V2_ROUTER_ADDRESS: Address =
  "0x85bc865A1CD0862024EAC574A9996F89df51Eca8";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const PULSECHAIN_CHAIN_ID = 369;

// On-chain pool observations are considered fresh for 2 minutes
const STALE_AFTER_SECONDS = 120;

// ─── ABIs (minimal surface — only what we call) ──────────────────────────────

const ROUTER_ABI = [
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "factory",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const FACTORY_ABI = [
  {
    name: "getPair",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const PAIR_ABI = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ─── Public API ───────────────────────────────────────────────────────────────

export type FetchOnchainPriceArgs = {
  publicClient: PublicClient;
  chainId: number;
  assetId: string;
  /** Use the zero address for native PLS. */
  tokenAddress: Address;
  tokenDecimals: number;
  quoteAsset: string;
  /** Block number recorded as the observation timestamp marker. */
  blockNumber: bigint;
  /**
   * Caller-supplied observation timestamp. Must be stable for the same block
   * so that the persisted observation ID (which hashes observedAt) is
   * deterministic across rebuilds and replays.
   */
  observedAt: Date;
};

export type FetchOnchainPriceResult =
  | { ok: true; draft: PriceObservationDraft }
  | { ok: false; reason: string };

/**
 * Fetches a USD spot price for a PulseChain token by routing through the
 * official PulseX V1 router, falling back to V2 if V1 returns zero or throws.
 *
 * Route: tokenAddress → WPLS → pDAI  (or WPLS → pDAI for native PLS)
 *
 * The observation is persisted as ONCHAIN_POOL with a confidence score derived
 * from the first-hop pair's reserve size.
 */
export async function fetchOnchainPulseXPrice(
  args: FetchOnchainPriceArgs,
): Promise<FetchOnchainPriceResult> {
  if (args.chainId !== PULSECHAIN_CHAIN_ID) {
    return { ok: false, reason: `unsupported_chain_id:${args.chainId}` };
  }

  // Native PLS has no contract — route via WPLS instead
  const routingAddress: Address =
    args.tokenAddress.toLowerCase() === NULL_ADDRESS
      ? WPLS_ADDRESS
      : args.tokenAddress;

  const v1Result = await tryFetchFromRouter({
    publicClient: args.publicClient,
    routerAddress: PULSEX_V1_ROUTER_ADDRESS,
    routerLabel: "pulsex_v1",
    tokenAddress: routingAddress,
    tokenDecimals: args.tokenDecimals,
  });

  if (v1Result.ok) {
    return buildDraft(args, v1Result);
  }

  logInfo("PulseX V1 price fetch failed, trying V2", {
    assetId: args.assetId,
    reason: v1Result.reason,
  });

  const v2Result = await tryFetchFromRouter({
    publicClient: args.publicClient,
    routerAddress: PULSEX_V2_ROUTER_ADDRESS,
    routerLabel: "pulsex_v2",
    tokenAddress: routingAddress,
    tokenDecimals: args.tokenDecimals,
  });

  if (v2Result.ok) {
    return buildDraft(args, v2Result);
  }

  logError("Both PulseX V1 and V2 price fetches failed — price unavailable", {
    assetId: args.assetId,
    v1Reason: v1Result.reason,
    v2Reason: v2Result.reason,
  });

  return {
    ok: false,
    reason: `V1: ${v1Result.reason} | V2: ${v2Result.reason}`,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type RouterFetchSuccess = {
  ok: true;
  routerLabel: string;
  priceUsd: Decimal;
  liquidityUsd: Decimal | null;
  routePath: readonly Address[];
  factoryAddress: Address;
  pairAddress: Address | null;
};

type RouterFetchResult = RouterFetchSuccess | { ok: false; reason: string };

/** Attempts a price quote against a single PulseX router, returning the USD price and liquidity on success. */
async function tryFetchFromRouter(args: {
  publicClient: PublicClient;
  routerAddress: Address;
  routerLabel: string;
  tokenAddress: Address;
  tokenDecimals: number;
}): Promise<RouterFetchResult> {
  try {
    if (!Number.isInteger(args.tokenDecimals) || args.tokenDecimals < 0) {
      return { ok: false, reason: "invalid_token_decimals" };
    }

    // 1 unit of the token in its smallest denomination — pure bigint
    // arithmetic avoids float precision loss for large decimal counts
    const amountIn = 10n ** BigInt(args.tokenDecimals);

    // WPLS itself is the entry to the pDAI market; everything else hops through WPLS first
    const routePath: readonly Address[] =
      args.tokenAddress.toLowerCase() === WPLS_ADDRESS.toLowerCase()
        ? ([WPLS_ADDRESS, PDAI_ADDRESS] as const)
        : ([args.tokenAddress, WPLS_ADDRESS, PDAI_ADDRESS] as const);

    const amounts = await args.publicClient.readContract({
      address: args.routerAddress,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, routePath as Address[]],
    });

    const rawAmountOut = amounts[amounts.length - 1];

    if (rawAmountOut === undefined || rawAmountOut === 0n) {
      return { ok: false, reason: "zero_amount_out" };
    }

    // pDAI has 18 decimals; result is price in USD for 1 token unit
    const priceUsd = new Decimal(rawAmountOut.toString()).div(
      new Decimal(10).pow(PDAI_DECIMALS),
    );

    if (priceUsd.lte(0)) {
      return { ok: false, reason: "non_positive_price" };
    }

    // Retrieve the factory address to look up pair reserves for confidence
    const factoryAddress = await args.publicClient.readContract({
      address: args.routerAddress,
      abi: ROUTER_ABI,
      functionName: "factory",
    });

    const liquidityResult = await tryGetLiquidityUsd({
      publicClient: args.publicClient,
      factoryAddress,
      firstHopToken: routePath[0] as Address,
      secondHopToken: routePath[1] as Address,
      tokenDecimals: args.tokenDecimals,
      priceUsd,
    });

    return {
      ok: true,
      routerLabel: args.routerLabel,
      priceUsd,
      liquidityUsd: liquidityResult.liquidityUsd,
      routePath,
      factoryAddress,
      pairAddress: liquidityResult.pairAddress,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

type LiquidityResult = {
  liquidityUsd: Decimal | null;
  pairAddress: Address | null;
};

/**
 * Looks up the first-hop pair on the factory, fetches its reserves, and returns
 * the total pool liquidity in USD (token side × 2 for the balanced pool assumption).
 * Returns `null` for both fields on any failure — liquidity is non-critical; the
 * caller falls back to a 0.50 confidence score.
 */
async function tryGetLiquidityUsd(args: {
  publicClient: PublicClient;
  factoryAddress: Address;
  firstHopToken: Address;
  secondHopToken: Address;
  tokenDecimals: number;
  priceUsd: Decimal;
}): Promise<LiquidityResult> {
  try {
    const pairAddress = await args.publicClient.readContract({
      address: args.factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getPair",
      args: [args.firstHopToken, args.secondHopToken],
    });

    if (pairAddress.toLowerCase() === NULL_ADDRESS) {
      return { liquidityUsd: null, pairAddress: null };
    }

    const [reserves, pairToken0] = await Promise.all([
      args.publicClient.readContract({
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: "getReserves",
      }),
      args.publicClient.readContract({
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: "token0",
      }),
    ]);

    const [reserve0, reserve1] = reserves;

    // Identify which reserve belongs to the first-hop token
    const isFirstHopToken0 =
      args.firstHopToken.toLowerCase() === pairToken0.toLowerCase();
    const tokenReserveRaw = isFirstHopToken0 ? reserve0 : reserve1;

    // Normalize reserve to token units, then multiply by USD price
    // Multiply by 2: both sides of a balanced pool have equal value
    const tokenReserveNormalized = new Decimal(tokenReserveRaw.toString()).div(
      new Decimal(10).pow(args.tokenDecimals),
    );
    const liquidityUsd = tokenReserveNormalized.mul(args.priceUsd).mul(2);

    return { liquidityUsd, pairAddress };
  } catch (error) {
    // Liquidity is non-critical — price fetch continues with unknown confidence.
    // Log the failure so operators can distinguish expected "no pair" cases from
    // RPC timeouts, reverts, or ABI mismatches that degrade confidence quality.
    logInfo("Liquidity reserve fetch failed — confidence falls back to 0.50", {
      factoryAddress: args.factoryAddress,
      firstHopToken: args.firstHopToken,
      secondHopToken: args.secondHopToken,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { liquidityUsd: null, pairAddress: null };
  }
}

/**
 * Maps pool liquidity in USD to a confidence score.
 *
 * Thresholds are intentionally conservative: shallow pools produce noisy
 * spot prices under real swap conditions.
 */
export function confidenceFromLiquidityUsd(liquidityUsd: Decimal | null): Decimal {
  if (liquidityUsd === null) {
    return new Decimal("0.50");
  }

  // Use Decimal comparisons throughout to preserve the project's 40-digit
  // precision — converting to Number first would drop precision near boundaries
  if (liquidityUsd.gte("1000000")) return new Decimal("0.95");
  if (liquidityUsd.gte("100000")) return new Decimal("0.85");
  if (liquidityUsd.gte("10000")) return new Decimal("0.70");
  if (liquidityUsd.gte("1000")) return new Decimal("0.55");
  return new Decimal("0.30");
}

/** Serialises a Decimal price to a compact string, stripping trailing zeros. */
function toObservationPrice(value: Decimal): string {
  return value.toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/**
 * Assembles a `PriceObservationDraft` from a successful router result, attaching
 * route metadata, liquidity, and a confidence score derived from pool depth.
 */
function buildDraft(
  args: FetchOnchainPriceArgs,
  result: RouterFetchSuccess,
): FetchOnchainPriceResult {
  const confidence = confidenceFromLiquidityUsd(result.liquidityUsd);

  const draft: PriceObservationDraft = {
    chainId: args.chainId,
    assetId: args.assetId,
    assetAddress:
      args.tokenAddress.toLowerCase() === NULL_ADDRESS ? null : args.tokenAddress,
    quoteAsset: args.quoteAsset,
    price: toObservationPrice(result.priceUsd),
    sourceType: "ONCHAIN_POOL",
    sourceId: `pulsex:${result.routerLabel}:route:${[...result.routePath]
      .map((a) => a.toLowerCase())
      .join("-")}`,
    routeMetadata: {
      router: result.routerLabel,
      routerAddress:
        result.routerLabel === "pulsex_v1"
          ? PULSEX_V1_ROUTER_ADDRESS
          : PULSEX_V2_ROUTER_ADDRESS,
      path: result.routePath,
      factoryAddress: result.factoryAddress,
      pairAddress: result.pairAddress,
    },
    liquidityUsd: result.liquidityUsd?.toFixed(2) ?? null,
    confidence: confidence.toString(),
    observedAt: args.observedAt,
    blockNumber: args.blockNumber,
    staleAfterSeconds: STALE_AFTER_SECONDS,
  };

  return { ok: true, draft };
}
