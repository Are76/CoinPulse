/**
 * Unit tests for the token metadata status computation helpers.
 *
 * These functions are pure and deterministic — all tests exercise the helper
 * directly without database mocks or dashboard assembly overhead.
 */

import { describe, expect, it } from "vitest";

import {
  METADATA_STALE_AFTER_SECONDS,
  computeTokenMetadataStatus,
  detectDecimalsConflict,
  isMetadataStale,
} from "@/services/dashboard/token-metadata-status";
import type {
  DashboardMetadataProvenanceSource,
  DashboardMetadataProvenanceStatus,
} from "@/services/dashboard/types";

// ─── isMetadataStale ──────────────────────────────────────────────────────────

describe("isMetadataStale", () => {
  const THRESHOLD = METADATA_STALE_AFTER_SECONDS;

  it("returns false when observation is exactly at the threshold boundary", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const observedAt = new Date(asOf.getTime() - THRESHOLD * 1_000);
    expect(isMetadataStale(observedAt, asOf)).toBe(false);
  });

  it("returns false when observation is recent (1 day old)", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const observedAt = new Date(asOf.getTime() - 24 * 60 * 60 * 1_000);
    expect(isMetadataStale(observedAt, asOf)).toBe(false);
  });

  it("returns true when observation is one millisecond past the threshold", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const observedAt = new Date(asOf.getTime() - THRESHOLD * 1_000 - 1);
    expect(isMetadataStale(observedAt, asOf)).toBe(true);
  });

  it("returns true when observation is 60 days old", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const observedAt = new Date(asOf.getTime() - 60 * 24 * 60 * 60 * 1_000);
    expect(isMetadataStale(observedAt, asOf)).toBe(true);
  });

  it("returns false when the observation timestamp is in the future relative to asOf", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const observedAt = new Date(asOf.getTime() + 24 * 60 * 60 * 1_000); // 1 day "ahead" of asOf
    expect(isMetadataStale(observedAt, asOf)).toBe(false);
  });

  it("accepts a custom threshold and uses it correctly", () => {
    const asOf = new Date("2026-06-05T00:00:00.000Z");
    const tenMinutesAgo = new Date(asOf.getTime() - 10 * 60 * 1_000);
    expect(isMetadataStale(tenMinutesAgo, asOf, 5 * 60)).toBe(true);
    expect(isMetadataStale(tenMinutesAgo, asOf, 15 * 60)).toBe(false);
  });
});

// ─── detectDecimalsConflict ───────────────────────────────────────────────────

describe("detectDecimalsConflict", () => {
  it("returns false for an empty source list", () => {
    expect(detectDecimalsConflict([])).toBe(false);
  });

  it("returns false for a single source", () => {
    expect(detectDecimalsConflict([{ decimals: 18 }])).toBe(false);
  });

  it("returns false when all sources have the same decimals", () => {
    expect(detectDecimalsConflict([
      { decimals: 18 },
      { decimals: 18 },
      { decimals: 18 },
    ])).toBe(false);
  });

  it("returns true when two sources have different decimals", () => {
    expect(detectDecimalsConflict([
      { decimals: 18 },
      { decimals: 8 },
    ])).toBe(true);
  });

  it("returns true when the first differs from any later source", () => {
    expect(detectDecimalsConflict([
      { decimals: 18 },
      { decimals: 18 },
      { decimals: 6 },
    ])).toBe(true);
  });

  it("returns false when all non-null values agree, some are null", () => {
    expect(detectDecimalsConflict([
      { decimals: 18 },
      { decimals: null },
      { decimals: 18 },
    ])).toBe(false);
  });

  it("returns false when all sources have null decimals (no evidence to conflict)", () => {
    expect(detectDecimalsConflict([
      { decimals: null },
      { decimals: null },
    ])).toBe(false);
  });

  it("returns false when only one source has non-null decimals", () => {
    expect(detectDecimalsConflict([
      { decimals: 18 },
      { decimals: null },
    ])).toBe(false);
  });
});

// ─── computeTokenMetadataStatus ──────────────────────────────────────────────

const AS_OF = new Date("2026-06-05T00:00:00.000Z");
const RECENT = new Date(AS_OF.getTime() - 1 * 24 * 60 * 60 * 1_000); // 1 day ago
const STALE = new Date(AS_OF.getTime() - 60 * 24 * 60 * 60 * 1_000); // 60 days ago

describe("computeTokenMetadataStatus", () => {
  it("returns unknown when source is unknown, regardless of other inputs", () => {
    const result = computeTokenMetadataStatus({
      source: "unknown",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    });
    expect(result).toEqual({ status: "unknown", conflictReason: null });
  });

  it("returns unknown when source is unknown, even when evidence would otherwise be stale", () => {
    // Highest-priority rule: an unknown source short-circuits before staleness
    // is ever evaluated, not just before conflict detection.
    const result = computeTokenMetadataStatus({
      source: "unknown",
      latestObservedAt: STALE,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }],
    });
    expect(result).toEqual({ status: "unknown", conflictReason: null });
  });

  it("returns unknown when source is unknown, with both conflicting decimals and stale evidence present", () => {
    // Combines both lower-priority triggers (conflict, stale) to prove unknown
    // truly wins over every other rule, not just each one individually.
    const result = computeTokenMetadataStatus({
      source: "unknown",
      latestObservedAt: STALE,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    });
    expect(result).toEqual({ status: "unknown", conflictReason: null });
  });

  it("returns observed for a fresh single-source token", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }],
    });
    expect(result).toEqual({ status: "observed", conflictReason: null });
  });

  it("returns observed when latestObservedAt is null and no conflict exists", () => {
    const result = computeTokenMetadataStatus({
      source: "derived",
      latestObservedAt: null,
      asOf: AS_OF,
      allSources: [{ decimals: 8 }],
    });
    expect(result).toEqual({ status: "observed", conflictReason: null });
  });

  it("returns stale when observation is past the threshold", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: STALE,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }],
    });
    expect(result).toEqual({ status: "stale", conflictReason: null });
  });

  it("returns conflicting with decimals-mismatch reason when sources disagree on decimals", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    });
    expect(result).toEqual({ status: "conflicting", conflictReason: "decimals-mismatch" });
  });

  it("conflict takes priority over stale — conflicting even when observation is old", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: STALE,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    });
    expect(result).toEqual({ status: "conflicting", conflictReason: "decimals-mismatch" });
  });

  it("returns observed when multiple sources agree on decimals and data is fresh", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }, { decimals: 18 }],
    });
    expect(result).toEqual({ status: "observed", conflictReason: null });
  });

  it("returns observed when sources have null decimals — no conflict without evidence", () => {
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources: [{ decimals: null }, { decimals: null }],
    });
    expect(result).toEqual({ status: "observed", conflictReason: null });
  });

  it("conflictReason is null for all non-conflicting statuses", () => {
    const cases = [
      { source: "unknown" as const, latestObservedAt: RECENT, allSources: [{ decimals: 18 }] },
      { source: "chain" as const, latestObservedAt: RECENT, allSources: [{ decimals: 18 }] },
      { source: "chain" as const, latestObservedAt: STALE, allSources: [{ decimals: 18 }] },
    ];

    for (const params of cases) {
      const result = computeTokenMetadataStatus({ ...params, asOf: AS_OF });
      expect(result.conflictReason).toBeNull();
    }
  });

  it("returns observed (not stale) when the latest observation is timestamped in the future", () => {
    const future = new Date(AS_OF.getTime() + 24 * 60 * 60 * 1_000);
    const result = computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: future,
      asOf: AS_OF,
      allSources: [{ decimals: 18 }],
    });
    expect(result).toEqual({ status: "observed", conflictReason: null });
  });
});

// ─── Purity and determinism ──────────────────────────────────────────────────

describe("computeTokenMetadataStatus — purity and determinism", () => {
  it("returns deep-equal output for equivalent-but-distinct input objects/arrays", () => {
    const paramsA = {
      source: "chain" as const,
      latestObservedAt: new Date(STALE.getTime()),
      asOf: new Date(AS_OF.getTime()),
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    };
    const paramsB = {
      source: "chain" as const,
      latestObservedAt: new Date(STALE.getTime()),
      asOf: new Date(AS_OF.getTime()),
      allSources: [{ decimals: 18 }, { decimals: 8 }],
    };

    expect(paramsA).not.toBe(paramsB);
    expect(computeTokenMetadataStatus(paramsA)).toEqual(computeTokenMetadataStatus(paramsB));
  });

  it("does not mutate the allSources array or its entries", () => {
    const allSources = [{ decimals: 18 }, { decimals: 8 }];
    const snapshot = JSON.parse(JSON.stringify(allSources));

    computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt: RECENT,
      asOf: AS_OF,
      allSources,
    });

    expect(allSources).toEqual(snapshot);
    expect(allSources.length).toBe(2);
  });

  it("does not mutate the asOf or latestObservedAt Date inputs", () => {
    const asOf = new Date(AS_OF.getTime());
    const latestObservedAt = new Date(STALE.getTime());
    const asOfBefore = asOf.getTime();
    const observedBefore = latestObservedAt.getTime();

    computeTokenMetadataStatus({
      source: "chain",
      latestObservedAt,
      asOf,
      allSources: [{ decimals: 18 }],
    });

    expect(asOf.getTime()).toBe(asOfBefore);
    expect(latestObservedAt.getTime()).toBe(observedBefore);
  });
});

// ─── Canonical runtime status vocabulary ─────────────────────────────────────
//
// `DashboardMetadataProvenanceStatus` (src/services/dashboard/types.ts) declares
// five members: "verified", "observed", "conflicting", "stale", "unknown".
// `computeTokenMetadataStatus` is the only branching source of that status in
// production (the sole other producer, `UNKNOWN_METADATA_PROVENANCE` in
// portfolio-dashboard.ts, is a hardcoded "unknown" literal). Its return
// statements only ever produce four of the five declared members — "verified"
// has no reachable code path today.
//
// The tests above prove specific behaviors per scenario; none of them assert
// the *closed set* of reachable outputs. This block adds that guard: it sweeps
// the input space and asserts every result stays inside the reachable set, so
// a future change that quietly adds a "verified"-producing branch fails a test
// instead of silently expanding the runtime contract.

describe("computeTokenMetadataStatus — canonical runtime vocabulary", () => {
  const REACHABLE_STATUSES: readonly DashboardMetadataProvenanceStatus[] = [
    "observed",
    "conflicting",
    "stale",
    "unknown",
  ];

  const ALL_SOURCES: readonly DashboardMetadataProvenanceSource[] = [
    "chain",
    "scanner",
    "manual",
    "derived",
    "unknown",
  ];

  const OBSERVED_AT_CASES: ReadonlyArray<Date | null> = [
    null,
    RECENT,
    STALE,
    new Date(AS_OF.getTime() + 24 * 60 * 60 * 1_000), // future-timestamped
  ];

  const ALL_SOURCES_EVIDENCE_CASES: ReadonlyArray<ReadonlyArray<{ decimals?: number | null }>> = [
    [],
    [{ decimals: 18 }],
    [{ decimals: 18 }, { decimals: 18 }],
    [{ decimals: 18 }, { decimals: 8 }],
    [{ decimals: null }, { decimals: null }],
    [{ decimals: 18 }, { decimals: null }],
  ];

  it("never returns a status outside the reachable canonical set, across the full branch matrix", () => {
    for (const source of ALL_SOURCES) {
      for (const latestObservedAt of OBSERVED_AT_CASES) {
        for (const allSources of ALL_SOURCES_EVIDENCE_CASES) {
          const { status } = computeTokenMetadataStatus({
            source,
            latestObservedAt,
            asOf: AS_OF,
            allSources,
          });
          expect(REACHABLE_STATUSES).toContain(status);
        }
      }
    }
  });

  it("never returns 'verified', though the type declares it as a valid status", () => {
    for (const source of ALL_SOURCES) {
      for (const latestObservedAt of OBSERVED_AT_CASES) {
        for (const allSources of ALL_SOURCES_EVIDENCE_CASES) {
          const { status } = computeTokenMetadataStatus({
            source,
            latestObservedAt,
            asOf: AS_OF,
            allSources,
          });
          expect(status).not.toBe("verified");
        }
      }
    }
  });

  it("documents the declared-vs-reachable gap: the type union has five members, only four are reachable", () => {
    const declaredVocabulary: readonly DashboardMetadataProvenanceStatus[] = [
      "verified",
      "observed",
      "conflicting",
      "stale",
      "unknown",
    ];

    expect(declaredVocabulary).toHaveLength(5);
    expect(REACHABLE_STATUSES).toHaveLength(4);
    expect(declaredVocabulary).toContain("verified");
    expect(REACHABLE_STATUSES).not.toContain("verified");
  });
});
