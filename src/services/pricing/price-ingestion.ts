import "server-only";

import type { Address, PublicClient } from "viem";

import { logError, logInfo } from "@/lib/logger";
import { createPublicClientForChain } from "@/services/chains/public-client";
import {
  fetchOnchainPulseXPrice,
  type FetchOnchainPriceArgs,
  type FetchOnchainPriceResult,
} from "@/services/pricing/fetchers/onchain-pulsex-fetcher";
import { persistPriceObservations } from "@/services/pricing/price-store";
import type { PriceObservationDraft } from "@/services/pricing/types";

export type PriceIngestAsset = {
  assetId: string;
  tokenAddress: Address;
  tokenDecimals: number;
  quoteAsset: string;
};

export type PriceIngestionDependencies = {
  publicClient?: PublicClient;
  fetchPrice?: (args: FetchOnchainPriceArgs) => Promise<FetchOnchainPriceResult>;
  persistObservations?: typeof persistPriceObservations;
};

export type PriceIngestionResult = {
  chainId: number;
  blockNumber: bigint;
  observedAt: Date;
  fetchedCount: number;
  persistedCount: number;
  failedCount: number;
  failedAssets: readonly string[];
  /** Assets skipped for an expected, non-error reason (e.g. pDAI routing reference). */
  skippedCount: number;
  skippedAssets: readonly string[];
};

export async function runPriceIngestion(
  args: {
    chainId: number;
    blockNumber: bigint;
    observedAt: Date;
    assets: readonly PriceIngestAsset[];
  },
  dependencies: PriceIngestionDependencies = {},
): Promise<PriceIngestionResult> {
  const publicClient = dependencies.publicClient ?? createPublicClientForChain();
  const fetchPrice = dependencies.fetchPrice ?? fetchOnchainPulseXPrice;
  const persist = dependencies.persistObservations ?? persistPriceObservations;

  const drafts: PriceObservationDraft[] = [];
  const failedAssets: string[] = [];
  const skippedAssets: string[] = [];

  for (const asset of args.assets) {
    const result = await fetchPrice({
      publicClient,
      chainId: args.chainId,
      assetId: asset.assetId,
      tokenAddress: asset.tokenAddress,
      tokenDecimals: asset.tokenDecimals,
      quoteAsset: asset.quoteAsset,
      blockNumber: args.blockNumber,
      observedAt: args.observedAt,
    });

    if (result.ok) {
      drafts.push(result.draft);
    } else if (result.reason === "pdai_routing_reference") {
      // pDAI is the routing leg — pricing it is circular and fabricating price:"1"
      // violates the project guardrail. This is an expected skip, not an error.
      logInfo("Skipping pDAI price ingestion — pDAI is the routing reference asset", {
        assetId: asset.assetId,
        chainId: args.chainId,
      });
      skippedAssets.push(asset.assetId);
    } else {
      logError("Price fetch failed during ingestion", {
        assetId: asset.assetId,
        chainId: args.chainId,
        reason: result.reason,
      });
      failedAssets.push(asset.assetId);
    }
  }

  const fetchedCount = drafts.length;
  let persistedCount = 0;

  if (fetchedCount > 0) {
    const persisted = await persist(drafts);
    persistedCount = persisted.createdCount;

    logInfo("Price ingestion persisted observations", {
      chainId: args.chainId,
      blockNumber: args.blockNumber.toString(),
      fetchedCount,
      persistedCount,
    });
  }

  return {
    chainId: args.chainId,
    blockNumber: args.blockNumber,
    observedAt: args.observedAt,
    fetchedCount,
    persistedCount,
    failedCount: failedAssets.length,
    failedAssets,
    skippedCount: skippedAssets.length,
    skippedAssets,
  };
}
