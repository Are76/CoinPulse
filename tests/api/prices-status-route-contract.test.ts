import { afterEach, describe, expect, it, vi } from "vitest";

type PriceObservationRow = {
  sourceType: string;
  observedAt: Date;
  staleAfterSeconds: number;
  confidence: string;
};

// Mirrors the where clause shape used by getPricingStatusReport
type FindManyArgs = {
  where?: { observedAt?: { gte?: Date } };
};

function createMemoryDb(observations: PriceObservationRow[] = []) {
  return new Proxy(
    {
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
    },
    {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver);
        }
        throw new Error(`unexpected-db-access:${String(property)}`);
      },
    },
  );
}

const getDb = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb,
}));

describe("GET /api/prices/status route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns envelope with schemaVersion v1", async () => {
    getDb.mockReturnValue(createMemoryDb());

    const { GET } = await import("../../app/api/prices/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        schemaVersion: "v1",
        asOf: expect.any(String),
        status: expect.any(String),
        sources: expect.any(Array),
      },
    });
  });

  it("returns status unknown when no observations exist", async () => {
    getDb.mockReturnValue(createMemoryDb([]));

    const { GET } = await import("../../app/api/prices/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("unknown");
    // All 5 known source types appear even with zero observations
    expect(Array.isArray(body.data.sources)).toBe(true);
    expect(body.data.sources.length).toBe(5);
    const sourceTypes = body.data.sources.map((s: { sourceType: string }) => s.sourceType);
    expect(sourceTypes).toContain("ONCHAIN_POOL");
    expect(sourceTypes).toContain("DEXSCREENER");
  });

  it("returns status ok when a fresh accepted observation exists", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T11:59:00.000Z"), // 60s ago
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    expect(report.status).toBe("ok");
    expect(report.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "ONCHAIN_POOL",
          status: "ok",
          observationsCount: 1,
          rejectedCount: 0,
          reason: null,
          staleAfterSeconds: 120,
        }),
      ]),
    );
  });

  it("returns status degraded when only stale observations exist", async () => {
    const now = new Date("2026-05-11T12:10:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: new Date("2026-05-11T12:00:00.000Z"), // 10 min ago
          staleAfterSeconds: 120, // stale after 2 min
          confidence: "0.90",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    expect(report.status).toBe("degraded");
    expect(report.sources[0]).toMatchObject({
      sourceType: "ONCHAIN_POOL",
      status: "degraded",
      reason: "latest_observation_stale",
      rejectedCount: 1,
    });
  });

  it("surfaces disabled source with explicit disabled status", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:58:00.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    expect(report.status).toBe("unknown"); // disabled-only → no enabled observations
    // All 5 known sources appear; DEXSCREENER has 2 observations marked disabled
    expect(report.sources).toHaveLength(5);
    const dex = report.sources.find((s) => s.sourceType === "DEXSCREENER");
    expect(dex).toMatchObject({
      sourceType: "DEXSCREENER",
      status: "disabled",
      observationsCount: 2,
      rejectedCount: 2,
      reason: "source_disabled",
    });
  });

  it("returns ok when an enabled source is fresh alongside a disabled source", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "ONCHAIN_ROUTE",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.85",
        },
        {
          sourceType: "DEXSCREENER",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 300,
          confidence: "0.99",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    expect(report.status).toBe("ok");
    const dexSource = report.sources.find((s) => s.sourceType === "DEXSCREENER");
    const onchainSource = report.sources.find((s) => s.sourceType === "ONCHAIN_ROUTE");
    expect(dexSource?.status).toBe("disabled");
    expect(onchainSource?.status).toBe("ok");
  });

  it("counts low-confidence observations as rejected", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:59:30.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.30", // below threshold of 0.5
        },
        {
          sourceType: "ORACLE",
          observedAt: new Date("2026-05-11T11:59:00.000Z"),
          staleAfterSeconds: 120,
          confidence: "0.80",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    const oracleSource = report.sources.find((s) => s.sourceType === "ORACLE");
    expect(oracleSource).toBeDefined();
    expect(oracleSource?.observationsCount).toBe(2);
    expect(oracleSource?.rejectedCount).toBe(1); // low confidence obs
  });

  it("returns HTTP 500 with safe error envelope on unexpected service error", async () => {
    getDb.mockReturnValue({
      priceObservation: {
        findMany() {
          throw new Error("database explosion");
        },
      },
    });

    const { GET } = await import("../../app/api/prices/status/route");
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: expect.any(String),
      },
    });
    // No internal error details should leak
    expect(JSON.stringify(body)).not.toContain("database explosion");
  });

  it("asOf is a valid ISO timestamp string", async () => {
    getDb.mockReturnValue(createMemoryDb());

    const { GET } = await import("../../app/api/prices/status/route");
    const response = await GET();
    const body = await response.json();

    expect(() => new Date(body.data.asOf)).not.toThrow();
    expect(new Date(body.data.asOf).toISOString()).toBe(body.data.asOf);
  });

  it("uses bounded query semantics: observations outside lookback window are excluded", async () => {
    const now = new Date("2026-05-11T12:00:00.000Z");
    // 8 days ago — outside the 7-day lookback window
    const tooOld = new Date("2026-05-03T12:00:00.000Z");

    getDb.mockReturnValue(
      createMemoryDb([
        {
          sourceType: "ONCHAIN_POOL",
          observedAt: tooOld,
          staleAfterSeconds: 120,
          confidence: "0.90",
        },
      ]),
    );

    const { getPricingStatusReport } = await import("@/services/api/prices");
    const report = await getPricingStatusReport({ now });

    // Observation was outside lookback; ONCHAIN_POOL should show zero observations
    const onchain = report.sources.find((s) => s.sourceType === "ONCHAIN_POOL");
    expect(onchain?.observationsCount).toBe(0);
    expect(onchain?.status).toBe("unknown");
    expect(report.status).toBe("unknown");
  });
});
