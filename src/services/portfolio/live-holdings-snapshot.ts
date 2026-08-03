import "server-only";

import Decimal from "decimal.js";
import type { PublicClient } from "viem";

import { getDb } from "@/lib/db";
import { CORE_ASSETS } from "@/config/assets";
import { PULSECHAIN_CHAIN } from "@/config/chains";
import { createPublicClientForChain } from "@/services/chains/public-client";
import { resolveBestPriceFromStore } from "@/services/pricing/price-resolver";
import type { ResolveBestPriceResult } from "@/services/pricing/types";
import type {
  LiveHoldingsSnapshotDto,
  LiveSnapshotAssetDto,
  LiveSnapshotPriceProvenanceDto,
} from "@/services/portfolio/live-snapshot-types";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// CoinPulse Live Portfolio V1 is PulseChain-only. `createPublicClientForChain()`
// and `CORE_ASSETS.nativePls` are both hardcoded to chain 369 already — this
// guard makes that assumption explicit and fails loudly instead of silently
// returning chain-369 data under a mismatched `wallet.chainId` label.
export class UnsupportedChainError extends Error {
  code = "UNSUPPORTED_CHAIN" as const;

  constructor(chainId: number) {
    super(`Live holdings snapshot only supports chain ${PULSECHAIN_CHAIN.id}, received chainId ${chainId}.`);
    this.name = "UnsupportedChainError";
  }
}

// Caps concurrent per-token `balanceOf` RPC calls so a growing chain-wide
// token registry can't fan out into an unbounded burst of requests against
// the RPC provider on every snapshot request.
export const MAX_CONCURRENT_TOKEN_BALANCE_READS = 8;

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  fn: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

type LiveSnapshotDbClient = {
  token: {
    findMany(args: {
      where: { chainId: number; isIgnored: boolean; isNative: boolean };
      select: { assetId: true; address: true; decimals: true; symbol: true };
    }): Promise<Array<{ assetId: string; address: string; decimals: number; symbol: string | null }>>;
  };
  priceObservation?: {
    findMany: NonNullable<Parameters<typeof resolveBestPriceFromStore>[1]["db"]>["priceObservation"]["findMany"];
  };
};

type LiveSnapshotPriceResolver = (args: {
  chainId: number;
  assetId: string;
  quoteAsset: string;
  observedAt: Date;
}) => Promise<ResolveBestPriceResult>;

function toPriceProvenanceDto(result: ResolveBestPriceResult): LiveSnapshotPriceProvenanceDto {
  if (result.selected) {
    return {
      sourceType: result.selected.sourceType,
      sourceId: result.selected.sourceId,
      confidence: result.selected.confidence,
      observedAt: result.selected.observedAt.toISOString(),
      observedBlock: result.selected.blockNumber === null ? null : result.selected.blockNumber.toString(),
      staleAfterSeconds: result.selected.staleAfterSeconds,
      rejectedReasons: result.rejected.map((item) => item.reason),
    };
  }

  return {
    sourceType: null,
    sourceId: null,
    confidence: null,
    observedAt: null,
    observedBlock: null,
    staleAfterSeconds: null,
    rejectedReasons: result.rejected.map((item) => item.reason),
  };
}

export async function assembleLiveHoldingsSnapshot(args: {
  wallet: { address: string; chainId: number };
  quoteAsset: string;
  asOf: Date;
  db?: LiveSnapshotDbClient;
  publicClient?: Pick<PublicClient, "getBalance" | "getBlockNumber" | "readContract">;
  resolvePrice?: LiveSnapshotPriceResolver;
}): Promise<LiveHoldingsSnapshotDto> {
  if (args.wallet.chainId !== PULSECHAIN_CHAIN.id) {
    throw new UnsupportedChainError(args.wallet.chainId);
  }

  const db = args.db ?? ((getDb() as unknown) as LiveSnapshotDbClient);
  const publicClient = args.publicClient ?? createPublicClientForChain();
  const resolvePrice =
    args.resolvePrice ??
    (async (priceArgs) => {
      if (!db.priceObservation) {
        return { selected: null, rejected: [] } satisfies ResolveBestPriceResult;
      }
      return resolveBestPriceFromStore(
        { chainId: priceArgs.chainId, assetId: priceArgs.assetId, quoteAsset: priceArgs.quoteAsset },
        { db: { priceObservation: db.priceObservation } as never, observedAt: priceArgs.observedAt },
      );
    });

  const walletAddress = args.wallet.address as `0x${string}`;

  // Every balance in this snapshot must come from the SAME block, or the
  // "as of block X" label the DTO carries would be a lie. Fetch the block
  // first, then pin every native and token read to it explicitly.
  const [knownTokens, observedBlock] = await Promise.all([
    db.token.findMany({
      where: { chainId: args.wallet.chainId, isIgnored: false, isNative: false },
      select: { assetId: true, address: true, decimals: true, symbol: true },
    }),
    publicClient.getBlockNumber(),
  ]);

  const nativeBalance = await publicClient.getBalance({ address: walletAddress, blockNumber: observedBlock });

  const warnings: string[] = [];

  const tokenBalances = await mapWithConcurrencyLimit(
    knownTokens,
    MAX_CONCURRENT_TOKEN_BALANCE_READS,
    async (token) => {
      try {
        const balance = await publicClient.readContract({
          address: token.address as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [walletAddress],
          blockNumber: observedBlock,
        });
        return { token, balance: balance as bigint };
      } catch {
        warnings.push(`balance-read-failed:${token.assetId}`);
        return null;
      }
    },
  );

  const holdings: Array<{
    assetId: string;
    assetAddress: string | null;
    symbol: string | null;
    decimals: number;
    balance: bigint;
  }> = [];

  if (nativeBalance > 0n) {
    holdings.push({
      assetId: CORE_ASSETS.nativePls.assetId,
      assetAddress: null,
      symbol: CORE_ASSETS.nativePls.symbol,
      decimals: CORE_ASSETS.nativePls.decimals,
      balance: nativeBalance,
    });
  }

  for (const entry of tokenBalances) {
    if (entry === null) continue;
    if (entry.balance <= 0n) continue;
    holdings.push({
      assetId: entry.token.assetId,
      assetAddress: entry.token.address,
      symbol: entry.token.symbol,
      decimals: entry.token.decimals,
      balance: entry.balance,
    });
  }

  let totalValue = new Decimal(0);
  let valuedCount = 0;

  const assets: LiveSnapshotAssetDto[] = await Promise.all(
    holdings.map(async (holding) => {
      const priceResult = await resolvePrice({
        chainId: args.wallet.chainId,
        assetId: holding.assetId,
        quoteAsset: args.quoteAsset,
        observedAt: args.asOf,
      });

      const pricing = toPriceProvenanceDto(priceResult);

      if (priceResult.selected) {
        const valueQuote = new Decimal(holding.balance.toString())
          .div(new Decimal(10).pow(holding.decimals))
          .mul(priceResult.selected.price)
          .toFixed();
        totalValue = totalValue.plus(valueQuote);
        valuedCount += 1;
        return {
          assetId: holding.assetId,
          assetAddress: holding.assetAddress,
          symbol: holding.symbol,
          decimals: holding.decimals,
          balanceQuantity: holding.balance.toString(),
          priceStatus: "priced" as const,
          valueQuote,
          pricing,
        };
      }

      warnings.push(`pricing-unavailable:${holding.assetId}`);
      return {
        assetId: holding.assetId,
        assetAddress: holding.assetAddress,
        symbol: holding.symbol,
        decimals: holding.decimals,
        balanceQuantity: holding.balance.toString(),
        priceStatus: "unpriced" as const,
        valueQuote: null,
        pricing,
      };
    }),
  );

  const valuationStatus: LiveHoldingsSnapshotDto["valuationStatus"] =
    assets.length === 0
      ? "unavailable"
      : valuedCount === assets.length
        ? "available"
        : valuedCount === 0
          ? "unavailable"
          : "partial";

  return {
    schemaVersion: "v1",
    wallet: { address: args.wallet.address, chainId: args.wallet.chainId },
    quoteAsset: args.quoteAsset,
    asOf: args.asOf.toISOString(),
    sourceType: "LIVE_RPC_SNAPSHOT",
    observedBlock: observedBlock.toString(),
    coverage: "known_assets_only",
    coverageNote:
      "Shows native PLS plus tokens already registered for this chain. Tokens never seen by the backend before are not yet included. Full transaction history and PnL require the historical sync to complete.",
    pnlStatus: "unsupported",
    assets,
    totalValueQuote: valuedCount === 0 ? null : totalValue.toFixed(),
    valuationStatus,
    warnings,
  };
}
