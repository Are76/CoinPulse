import type {
  DashboardMetadataProvenanceSource,
  DashboardMetadataProvenanceStatus,
} from "@/services/dashboard/types";

/**
 * Conservative staleness threshold for token metadata.
 * Metadata (decimals, symbol, name) rarely changes, so 30 days gives ample
 * freshness without triggering spurious stale warnings on seeded core tokens.
 */
export const METADATA_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Returns true when the most recent metadata observation is older than the
 * configured threshold relative to the dashboard's asOf timestamp.
 */
export function isMetadataStale(
  observedAt: Date,
  asOf: Date,
  thresholdSeconds = METADATA_STALE_AFTER_SECONDS,
): boolean {
  const ageMs = asOf.getTime() - observedAt.getTime();
  return ageMs > thresholdSeconds * 1_000;
}

/**
 * Returns true when two or more metadata sources have persisted non-null
 * decimals values that disagree. Decimals disagreement is high-risk because
 * it directly affects quantity interpretation and must surface as a warning.
 *
 * Symbol and name disagreement is display-risk only and is not surfaced here.
 */
export function detectDecimalsConflict(
  sources: ReadonlyArray<{ decimals?: number | null }>,
): boolean {
  if (sources.length < 2) return false;
  const known = sources
    .map((s) => s.decimals ?? null)
    .filter((d): d is number => d !== null);
  if (known.length < 2) return false;
  const first = known[0];
  return known.some((d) => d !== first);
}

/**
 * Computes the authoritative metadata status from persisted evidence.
 * Priority (highest → lowest): unknown → conflicting → stale → observed.
 *
 * Rules:
 * - unknown source → status: "unknown" (no evidence to evaluate)
 * - decimals conflict across sources → status: "conflicting", conflictReason set
 * - latest observedAt past stale threshold → status: "stale"
 * - otherwise → status: "observed"
 *
 * This function is pure and deterministic given the same inputs.
 */
export function computeTokenMetadataStatus(params: {
  source: DashboardMetadataProvenanceSource;
  latestObservedAt: Date | null;
  asOf: Date;
  allSources: ReadonlyArray<{ decimals?: number | null }>;
}): { status: DashboardMetadataProvenanceStatus; conflictReason: string | null } {
  if (params.source === "unknown") {
    return { status: "unknown", conflictReason: null };
  }

  if (detectDecimalsConflict(params.allSources)) {
    return { status: "conflicting", conflictReason: "decimals-mismatch" };
  }

  if (params.latestObservedAt !== null && isMetadataStale(params.latestObservedAt, params.asOf)) {
    return { status: "stale", conflictReason: null };
  }

  return { status: "observed", conflictReason: null };
}
