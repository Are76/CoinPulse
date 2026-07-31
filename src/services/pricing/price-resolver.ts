import "server-only";

import { CORE_ASSETS } from "@/config/assets";
import { Decimal } from "@/lib/decimal";
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

// Canonical, chain-aware pDAI identity — the same registry entry the
// PulseX fetcher's routing target is derived from (src/config/assets.ts).
// Never inferred from a symbol or ticker.
const PDAI_QUOTE_ASSET_ID = CORE_ASSETS.pdai.assetId.toLowerCase();

// `fetchOnchainPulseXPrice` always routes token -> WPLS -> pDAI and persists
// the resulting pDAI-denominated amount under whatever quoteAsset the caller
// requested (src/services/pricing/fetchers/onchain-pulsex-fetcher.ts). This
// sourceId shape has been stable since the fetcher's introduction (PR #150)
// through the pdaiParAssumption marker added in PR #274, so — unlike that
// marker — it also identifies pre-#274 legacy rows that never got the flag.
const PULSEX_ROUTE_SOURCE_ID_PATTERN = /^pulsex:(pulsex_v1|pulsex_v2):route:/;

// The pre-#274 producer's fabricated "pDAI is always $1" observation,
// removed in PR #274 (`buildPdaiParDraft`, sourceId "pulsex:pdai:par",
// price "1"). Historical rows may still be persisted and reachable by
// average-cost PnL's historical-timestamp resolution — reject them
// unconditionally rather than relying on freshness/confidence to exclude
// them.
const LEGACY_FABRICATED_PDAI_PAR_SOURCE_ID = "pulsex:pdai:par";

/**
 * An observation is an unverified pDAI-routing assumption when it was
 * produced by the PulseX token -> WPLS -> pDAI route (or the legacy
 * fabricated pDAI-par shortcut it replaced) and is requested/persisted under
 * any quote asset other than the exact canonical pDAI identity. Detection is
 * by provenance (`sourceId`), not the `routeMetadata.pdaiParAssumption` flag,
 * so it also catches legacy rows that predate that flag. Exported so other
 * pricing-health consumers (e.g. the operator status report) can apply the
 * same rule without duplicating it.
 */
export function isUnverifiedPulseXQuoteAssumption(observation: {
  sourceId: string;
  quoteAsset: string;
}): boolean {
  if (observation.sourceId === LEGACY_FABRICATED_PDAI_PAR_SOURCE_ID) {
    return true;
  }

  return (
    PULSEX_ROUTE_SOURCE_ID_PATTERN.test(observation.sourceId) &&
    observation.quoteAsset.toLowerCase() !== PDAI_QUOTE_ASSET_ID
  );
}

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
  const minimumConfidence = new Decimal(args.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE);
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

    if (isUnverifiedPulseXQuoteAssumption(observation)) {
      rejected.push({ id: observation.id, reason: "UNVERIFIED_QUOTE_ASSUMPTION" });
      continue;
    }

    const staleAt =
      observation.observedAt.getTime() + observation.staleAfterSeconds * 1000;
    if (staleAt < args.observedAt.getTime()) {
      rejected.push({ id: observation.id, reason: "STALE" });
      continue;
    }

    if (new Decimal(observation.confidence).lessThan(minimumConfidence)) {
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

    const confidenceDelta = new Decimal(right.confidence).comparedTo(left.confidence);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    const observedAtDelta = right.observedAt.getTime() - left.observedAt.getTime();
    if (observedAtDelta !== 0) {
      return observedAtDelta;
    }

    return new Decimal(right.liquidityUsd ?? "0").comparedTo(left.liquidityUsd ?? "0");
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
