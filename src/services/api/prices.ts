import "server-only";

import { getDb } from "@/lib/db";
import type { PriceSourceType } from "@/services/pricing/types";

// Matches DISALLOWED_PRIMARY_SOURCES in price-resolver.ts
const DISABLED_SOURCE_TYPES = new Set<PriceSourceType>(["DEXSCREENER"]);
// Matches DEFAULT_MINIMUM_CONFIDENCE in price-resolver.ts
const DEFAULT_MINIMUM_CONFIDENCE = 0.5;

export type PricingStatusSourceItem = {
  sourceType: string;
  status: "ok" | "degraded" | "disabled" | "unknown";
  latestObservedAt: string | null;
  staleAfterSeconds: number | null;
  observationsCount: number;
  rejectedCount: number;
  reason: string | null;
};

export type PricingStatusReport = {
  schemaVersion: "v1";
  status: "ok" | "degraded" | "unknown";
  asOf: string;
  sources: PricingStatusSourceItem[];
};

type PriceObservationRow = {
  sourceType: string;
  observedAt: Date;
  staleAfterSeconds: number;
  confidence: string;
};

type PricingStatusDbClient = {
  priceObservation: {
    findMany(args: {
      select: {
        sourceType: true;
        observedAt: true;
        staleAfterSeconds: true;
        confidence: true;
      };
      orderBy?: { observedAt: "asc" | "desc" };
    }): Promise<PriceObservationRow[]>;
  };
};

type PricingStatusDependencies = {
  now?: Date;
  db?: PricingStatusDbClient;
};

export async function getPricingStatusReport(
  dependencies: PricingStatusDependencies = {},
): Promise<PricingStatusReport> {
  const now = dependencies.now ?? new Date();
  const db = (dependencies.db ?? getDb()) as unknown as PricingStatusDbClient;

  const observations = await db.priceObservation.findMany({
    select: {
      sourceType: true,
      observedAt: true,
      staleAfterSeconds: true,
      confidence: true,
    },
    orderBy: { observedAt: "desc" },
  });

  const sources = buildSourceItems(observations, now);

  return {
    schemaVersion: "v1",
    status: aggregateStatus(sources),
    asOf: now.toISOString(),
    sources,
  };
}

function buildSourceItems(
  observations: PriceObservationRow[],
  now: Date,
): PricingStatusSourceItem[] {
  const bySourceType = new Map<string, PriceObservationRow[]>();

  for (const obs of observations) {
    const bucket = bySourceType.get(obs.sourceType) ?? [];
    bucket.push(obs);
    bySourceType.set(obs.sourceType, bucket);
  }

  return Array.from(bySourceType.entries()).map(([sourceType, rows]) =>
    buildSourceItem(sourceType, rows, now),
  );
}

function buildSourceItem(
  sourceType: string,
  rows: PriceObservationRow[],
  now: Date,
): PricingStatusSourceItem {
  const isDisabled = DISABLED_SOURCE_TYPES.has(sourceType as PriceSourceType);
  const observationsCount = rows.length;

  // Most recent first (findMany already orders desc, but guard regardless)
  const sorted = rows.slice().sort(
    (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
  );
  const latest = sorted[0] ?? null;
  const latestObservedAt = latest?.observedAt.toISOString() ?? null;
  const staleAfterSeconds = latest?.staleAfterSeconds ?? null;

  if (isDisabled) {
    return {
      sourceType,
      status: "disabled",
      latestObservedAt,
      staleAfterSeconds,
      observationsCount,
      rejectedCount: observationsCount,
      reason: "source_disabled",
    };
  }

  if (observationsCount === 0 || latest === null) {
    return {
      sourceType,
      status: "unknown",
      latestObservedAt: null,
      staleAfterSeconds: null,
      observationsCount: 0,
      rejectedCount: 0,
      reason: "no_observations",
    };
  }

  const rejectedCount = rows.filter((obs) => {
    const staleAt = obs.observedAt.getTime() + obs.staleAfterSeconds * 1000;
    const isStale = staleAt < now.getTime();
    const isLowConfidence = Number(obs.confidence) < DEFAULT_MINIMUM_CONFIDENCE;
    return isStale || isLowConfidence;
  }).length;

  const latestStaleAt = latest.observedAt.getTime() + latest.staleAfterSeconds * 1000;
  const latestIsStale = latestStaleAt < now.getTime();

  if (latestIsStale) {
    return {
      sourceType,
      status: "degraded",
      latestObservedAt,
      staleAfterSeconds,
      observationsCount,
      rejectedCount,
      reason: "latest_observation_stale",
    };
  }

  return {
    sourceType,
    status: "ok",
    latestObservedAt,
    staleAfterSeconds,
    observationsCount,
    rejectedCount,
    reason: null,
  };
}

function aggregateStatus(
  sources: PricingStatusSourceItem[],
): "ok" | "degraded" | "unknown" {
  const enabledSources = sources.filter((s) => s.status !== "disabled");

  if (enabledSources.length === 0) {
    return "unknown";
  }

  const hasOk = enabledSources.some((s) => s.status === "ok");
  if (hasOk) {
    return "ok";
  }

  const hasAnyObservations = enabledSources.some((s) => s.observationsCount > 0);
  if (hasAnyObservations) {
    return "degraded";
  }

  return "unknown";
}
