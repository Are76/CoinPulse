import { describe, expect, it } from "vitest";

import { getPricingStatusReport, type PricingStatusReport } from "@/services/api/prices";

type PriceObservationRow = {
  sourceType: string;
  observedAt: Date;
  staleAfterSeconds: number;
  confidence: string;
};

// Mirrors the where-clause shape used by getPricingStatusReport
type FindManyArgs = {
  where?: { observedAt?: { gte?: Date } };
};

function createDb(observations: PriceObservationRow[]) {
  return {
    priceObservation: {
      async findMany(args: FindManyArgs) {
        const cutoff = args.where?.observedAt?.gte;
        const filtered = cutoff
          ? observations.filter((o) => o.observedAt >= cutoff)
          : observations;
        return filtered.slice().sort(
          (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
        );
      },
    },
  };
}

const NOW = new Date("2026-05-11T12:00:00.000Z");

describe("getPricingStatusReport — status classification", () => {
  it("returns unknown when no observations exist", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    expect(report.status).toBe("unknown");
    // All known source types are surfaced even with zero observations
    expect(report.sources).toHaveLength(5);
    const sourceTypes = report.sources.map((s) => s.sourceType);
    expect(sourceTypes).toContain("ONCHAIN_POOL");
    expect(sourceTypes).toContain("ONCHAIN_ROUTE");
    expect(sourceTypes).toContain("ORACLE");
    expect(sourceTypes).toContain("MANUAL");
    expect(sourceTypes).toContain("DEXSCREENER");
  });

  it("returns ok for a fresh enabled observation", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]) as never,
    });

    expect(report.status).toBe("ok");
  });

  it("returns degraded when the latest observation is stale", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:50:00.000Z"), // 10 min ago
          staleAfterSeconds: 120, // stale after 2 min
          confidence: "0.90",
        },
      ]) as never,
    });

    expect(report.status).toBe("degraded");
  });

  it("returns unknown when only disabled source observations exist", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
      ]) as never,
    });

    expect(report.status).toBe("unknown");
  });

  it("returns ok when at least one enabled source is fresh", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
        {
          sourceType: "ONCHAIN_ROUTE",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.80",
        },
      ]) as never,
    });

    expect(report.status).toBe("ok");
  });

  it("returns degraded when enabled source has only stale observations", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:00:00.000Z"), // 60 min ago
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]) as never,
    });

    expect(report.status).toBe("degraded");
  });
});

describe("getPricingStatusReport — disabled/rejected source handling", () => {
  it("marks DEXSCREENER source as disabled", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
      ]) as never,
    });

    const dex = report.sources.find((s) => s.sourceType === "DEXSCREENER");
    expect(dex?.status).toBe("disabled");
    expect(dex?.reason).toBe("source_disabled");
    expect(dex?.rejectedCount).toBe(dex?.observationsCount);
  });

  it("counts stale observations as rejected", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:55:00.000Z"), // fresh
          staleAfterSeconds: 600,
          confidence: "0.80",
        },
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T10:00:00.000Z"), // stale
          staleAfterSeconds: 120,
          confidence: "0.80",
        },
      ]) as never,
    });

    const oracle = report.sources.find((s) => s.sourceType === "ORACLE");
    expect(oracle?.observationsCount).toBe(2);
    expect(oracle?.rejectedCount).toBe(1); // only the stale one
  });

  it("counts low-confidence observations as rejected", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 600,
          confidence: "0.30", // below 0.5 threshold
        },
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:58:00.000Z"),
          staleAfterSeconds: 600,
          confidence: "0.80",
        },
      ]) as never,
    });

    const oracle = report.sources.find((s) => s.sourceType === "ORACLE");
    expect(oracle?.rejectedCount).toBe(1);
  });

  it("does not double-count observations that are both stale and low-confidence", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T10:00:00.000Z"), // stale AND low confidence
          staleAfterSeconds: 120,
          confidence: "0.20",
        },
      ]) as never,
    });

    const oracle = report.sources.find((s) => s.sourceType === "ORACLE");
    expect(oracle?.observationsCount).toBe(1);
    expect(oracle?.rejectedCount).toBe(1); // counted only once
  });
});

describe("getPricingStatusReport — latestObservedAt selection", () => {
  it("selects the most recent observedAt per source type", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "MANUAL",
          observedAt: new Date("2026-05-11T11:50:00.000Z"),
          staleAfterSeconds: 3600,
          confidence: "0.90",
        },
        {
          sourceType: "MANUAL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"), // most recent
          staleAfterSeconds: 3600,
          confidence: "0.90",
        },
        {
          sourceType: "MANUAL",
          observedAt: new Date("2026-05-11T11:55:00.000Z"),
          staleAfterSeconds: 3600,
          confidence: "0.90",
        },
      ]) as never,
    });

    const manual = report.sources.find((s) => s.sourceType === "MANUAL");
    expect(manual?.latestObservedAt).toBe("2026-05-11T11:59:00.000Z");
  });

  it("reports null latestObservedAt when no observations for source", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    // All known sources appear; each enabled zero-obs source has null latestObservedAt
    const onchain = report.sources.find((s) => s.sourceType === "ONCHAIN_POOL");
    expect(onchain).toBeDefined();
    expect(onchain?.latestObservedAt).toBeNull();
  });

  it("uses staleAfterSeconds from the most recent observation per source type", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"), // most recent
          staleAfterSeconds: 180,
          confidence: "0.90",
        },
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:58:00.000Z"),
          staleAfterSeconds: 60, // older observation had shorter threshold
          confidence: "0.90",
        },
      ]) as never,
    });

    const source = report.sources.find((s) => s.sourceType === "ONCHAIN_POOL");
    expect(source?.staleAfterSeconds).toBe(180); // from most recent
  });
});

describe("getPricingStatusReport — DTO shape", () => {
  it("includes required envelope fields", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    expect(report.schemaVersion).toBe("v1");
    expect(typeof report.asOf).toBe("string");
    expect(new Date(report.asOf).toISOString()).toBe(report.asOf);
    expect(Array.isArray(report.sources)).toBe(true);
  });

  it("each source item includes all required fields", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_ROUTE",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]) as never,
    });

    const source = report.sources[0];
    expect(source).toBeDefined();
    const item = source as NonNullable<typeof source>;

    expect(typeof item.sourceType).toBe("string");
    expect(["ok", "degraded", "disabled", "unknown"]).toContain(item.status);
    expect(typeof item.observationsCount).toBe("number");
    expect(typeof item.rejectedCount).toBe("number");
    // latestObservedAt is string or null
    expect(item.latestObservedAt === null || typeof item.latestObservedAt === "string").toBe(true);
    // staleAfterSeconds is number or null
    expect(item.staleAfterSeconds === null || typeof item.staleAfterSeconds === "number").toBe(true);
    // reason is string or null
    expect(item.reason === null || typeof item.reason === "string").toBe(true);
  });

  it("returns separate source items per source type", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
        {
          sourceType: "MANUAL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 3600,
          confidence: "0.90",
        },
      ]) as never,
    });

    // All 5 known source types always appear; at least ONCHAIN_POOL and MANUAL are present
    const sourceTypes = report.sources.map((s) => s.sourceType);
    expect(sourceTypes).toContain("ONCHAIN_POOL");
    expect(sourceTypes).toContain("MANUAL");
  });
});

describe("getPricingStatusReport — asOf matches injected now", () => {
  it("sets asOf to the provided now value", async () => {
    const now = new Date("2026-05-11T10:30:00.000Z");
    const report = (await getPricingStatusReport({
      now,
      db: createDb([]) as never,
    })) as PricingStatusReport;

    expect(report.asOf).toBe("2026-05-11T10:30:00.000Z");
  });
});

describe("getPricingStatusReport — known zero-observation sources", () => {
  it("enabled source with no observations appears as unknown with reason no_observations", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    const onchain = report.sources.find((s) => s.sourceType === "ONCHAIN_POOL");
    expect(onchain).toBeDefined();
    expect(onchain?.status).toBe("unknown");
    expect(onchain?.observationsCount).toBe(0);
    expect(onchain?.rejectedCount).toBe(0);
    expect(onchain?.latestObservedAt).toBeNull();
    expect(onchain?.staleAfterSeconds).toBeNull();
    expect(onchain?.reason).toBe("no_observations");
  });

  it("disabled source with no observations appears as disabled with reason source_disabled", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    const dex = report.sources.find((s) => s.sourceType === "DEXSCREENER");
    expect(dex).toBeDefined();
    expect(dex?.status).toBe("disabled");
    expect(dex?.observationsCount).toBe(0);
    expect(dex?.rejectedCount).toBe(0);
    expect(dex?.latestObservedAt).toBeNull();
    expect(dex?.staleAfterSeconds).toBeNull();
    expect(dex?.reason).toBe("source_disabled");
  });

  it("overall status is unknown when all enabled sources have zero observations", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([]) as never,
    });

    expect(report.status).toBe("unknown");
  });

  it("disabled-only source does not make overall status ok", async () => {
    // Only DEXSCREENER has observations; all enabled sources have zero
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
      ]) as never,
    });

    expect(report.status).toBe("unknown");
    const dex = report.sources.find((s) => s.sourceType === "DEXSCREENER");
    expect(dex?.status).toBe("disabled");
  });
});

describe("getPricingStatusReport — bounded lookback window", () => {
  it("excludes observations older than the lookback window", async () => {
    // 8 days before NOW is outside the 7-day lookback
    const tooOld = new Date("2026-05-03T12:00:00.000Z");
    // 6 days before NOW is inside the 7-day lookback
    const withinWindow = new Date("2026-05-05T12:00:00.000Z");

    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: tooOld,
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
        {
          sourceType: "ORACLE",
          observedAt: withinWindow,
          staleAfterSeconds: 3600,
          confidence: "0.90",
        },
      ]) as never,
    });

    // The too-old observation is filtered out; ONCHAIN_POOL shows zero observations
    const onchain = report.sources.find((s) => s.sourceType === "ONCHAIN_POOL");
    expect(onchain?.observationsCount).toBe(0);
    expect(onchain?.status).toBe("unknown");

    // The within-window observation is retained
    const oracle = report.sources.find((s) => s.sourceType === "ORACLE");
    expect(oracle?.observationsCount).toBe(1);
  });

  it("fresh observation inside lookback produces overall ok", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"), // 60s ago, inside 7d window
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]) as never,
    });

    expect(report.status).toBe("ok");
  });

  it("stale observation inside lookback produces overall degraded", async () => {
    const report = await getPricingStatusReport({
      now: NOW,
      db: createDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-10T12:00:00.000Z"), // 24h ago, inside 7d window but stale
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]) as never,
    });

    expect(report.status).toBe("degraded");
  });
});
