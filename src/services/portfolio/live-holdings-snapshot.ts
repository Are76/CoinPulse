import "server-only";

import Decimal from "decimal.js";
import type { PublicClient } from "viem";

import { getDb } from "@/lib/db";
import { CORE_ASSETS } from "@/config/assets";
import { createPublicClientForChain } from "@/services/chains/public-client";
import { resolveBestPriceFromStore } from "@/services/pricing/price-resolver";
import type { ResolveBestPriceResult } from "@/services/pricing/types";
import type { LiveHoldingsSnapshotDto, LiveSnapshotAssetDto } from "@/services/portfolio/live-snapshot-types";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type LiveSnapshotDbClient = {
  token: {
    findMany(args: {
      where: { chainId: number; isIgnored: boolean };
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

export async function assembleLiveHoldingsSnapshot(args: {
  wallet: { address: string; chainId: number };
  quoteAsset: string;
  asOf: Date;
  db?: LiveSnapshotDbClient;
  publicClient?: Pick<PublicClient, "getBalance" | "getBlockNumber" | "readContract">;
  resolvePrice?: LiveSnapshotPriceResolver;
}): Promise<LiveHoldingsSnapshotDto> {
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

  const [knownTokens, nativeBalance, observedBlock] = await Promise.all([
    db.token.findMany({
      where: { chainId: args.wallet.chainId, isIgnored: false },
      select: { assetId: true, address: true, decimals: true, symbol: true },
    }),
    publicClient.getBalance({ address: walletAddress }),
    publicClient.getBlockNumber(),
  ]);

  const warnings: string[] = [];

  const tokenBalances = await Promise.all(
    knownTokens.map(async (token) => {
      try {
        const balance = await publicClient.readContract({
          address: token.address as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [walletAddress],
        });
        return { token, balance: balance as bigint };
      } catch {
        warnings.push(`balance-read-failed:${token.assetId}`);
        return null;
      }
    }),
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
