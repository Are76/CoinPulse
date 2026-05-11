import { afterEach, describe, expect, it, vi } from "vitest";

type PriceObservationRow = {
  sourceType: string;
  observedAt: Date;
  staleAfterSeconds: number;
  confidence: string;
};

function createMemoryDb(observations: PriceObservationRow[] = []) {
  return new Proxy(
    {
      priceObservation: {
        async findMany() {
          return observations.slice().sort(
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
    expect(body.data.sources).toEqual([]);
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
    expect(report.sources).toEqual([
      expect.objectContaining({
        sourceType: "ONCHAIN_POOL",
        status: "ok",
        observationsCount: 1,
        rejectedCount: 0,
        reason: null,
        staleAfterSeconds: 120,
      }),
    ]);
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

    expect(report.status).toBe("unknown"); // disabled-only → no enabled sources
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({
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
});
