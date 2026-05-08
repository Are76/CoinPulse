import "server-only";

import { listPriceObservations } from "@/services/pricing/price-store";
import type {
  PersistedPriceObservation,
  PriceSourceType,
  ResolveBestPriceResult,
} from "@/services/pricing/types";

type PriceResolverClient = {
  priceObservation: {
    findMany:
      NonNullable<
        Parameters<typeof listPriceObservations>[1]
      >["priceObservation"]["findMany"];
  };
};

const DEFAULT_MINIMUM_CONFIDENCE = "0.5";
const DISALLOWED_PRIMARY_SOURCES = new Set<PriceSourceType>(["DEXSCREENER"]);
const SOURCE_PRIORITY: Record<PriceSourceType, number> = {
  ONCHAIN_POOL: 5,
  ONCHAIN_ROUTE: 4,
  ORACLE: 3,
  MANUAL: 2,
  DEXSCREENER: 0,
};

export function resolveBestPriceObservation(args: {
  chainId: number;
  assetId: string;
  quoteAsset: string;
  observations: readonly PersistedPriceObservation[];
  observedAt: Date;
  minimumConfidence?: string;
}): ResolveBestPriceResult {
  const minimumConfidence = Number(args.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE);
  const rejected: ResolveBestPriceResult["rejected"] = [];
  const accepted: PersistedPriceObservation[] = [];

  for (const observation of args.observations) {
    if (
      observation.chainId !== args.chainId ||
      observation.assetId !== args.assetId ||
      observation.quoteAsset !== args.quoteAsset
    ) {
      continue;
    }

    if (DISALLOWED_PRIMARY_SOURCES.has(observation.sourceType)) {
      rejected.push({ id: observation.id, reason: "SOURCE_DISABLED" });
      continue;
    }

    const staleAt =
      observation.observedAt.getTime() + observation.staleAfterSeconds * 1000;
    if (staleAt < args.observedAt.getTime()) {
      rejected.push({ id: observation.id, reason: "STALE" });
      continue;
    }

    if (Number(observation.confidence) < minimumConfidence) {
      rejected.push({ id: observation.id, reason: "LOW_CONFIDENCE" });
      continue;
    }

    accepted.push(observation);
  }

  accepted.sort((left, right) => {
    const sourcePriorityDelta =
      SOURCE_PRIORITY[right.sourceType] - SOURCE_PRIORITY[left.sourceType];
    if (sourcePriorityDelta !== 0) {
      return sourcePriorityDelta;
    }

    const confidenceDelta = Number(right.confidence) - Number(left.confidence);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    const observedAtDelta = right.observedAt.getTime() - left.observedAt.getTime();
    if (observedAtDelta !== 0) {
      return observedAtDelta;
    }

    return Number(right.liquidityUsd ?? "0") - Number(left.liquidityUsd ?? "0");
  });

  return {
    selected: accepted[0] ?? null,
    rejected,
  };
}

export async function resolveBestPriceFromStore(
  args: {
    chainId: number;
    assetId: string;
    quoteAsset: string;
  },
  options: {
    db?: PriceResolverClient;
    observedAt: Date;
    minimumConfidence?: string;
  },
) {
  const observations = await listPriceObservations(args, options.db as never);
  return resolveBestPriceObservation({
    chainId: args.chainId,
    assetId: args.assetId,
    quoteAsset: args.quoteAsset,
    observations,
    observedAt: options.observedAt,
    minimumConfidence: options.minimumConfidence,
  });
}
