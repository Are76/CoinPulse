import { afterEach, describe, expect, it, vi } from "vitest";

const getHealthReport = vi.fn();
const getDebugStatusReport = vi.fn();

vi.mock("@/services/debug", () => ({
  getHealthReport,
  getDebugStatusReport,
}));

describe("GET /api/debug/health", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns backend readiness without secrets", async () => {
    getHealthReport.mockResolvedValue({
      status: "ok",
      timestamp: "2026-05-08T12:00:00.000Z",
      app: { env: "test" },
      dependencies: {
        database: { status: "ready" },
        redis: { status: "ready" },
      },
    });

    const { GET } = await import("../../app/api/debug/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "ok",
        timestamp: "2026-05-08T12:00:00.000Z",
        app: { env: "test" },
        dependencies: {
          database: { status: "ready" },
          redis: { status: "ready" },
        },
      },
    });
  });

  it("returns 503 when a dependency is unavailable", async () => {
    getHealthReport.mockResolvedValue({
      status: "degraded",
      timestamp: "2026-05-08T12:00:00.000Z",
      app: { env: "test" },
      dependencies: {
        database: { status: "ready" },
        redis: { status: "unavailable" },
      },
    });

    const { GET } = await import("../../app/api/debug/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
  });

  it("returns a stable internal error response when health assembly throws", async () => {
    getHealthReport.mockRejectedValue(
      new Error("database password leaked in stack"),
    );

    const { GET } = await import("../../app/api/debug/health/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to determine backend health.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(
      "database password leaked in stack",
    );
  });
});

describe("GET /api/debug/status", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns safe backend status metadata", async () => {
    getDebugStatusReport.mockReturnValue({
      status: "ok",
      timestamp: "2026-05-08T12:00:00.000Z",
      app: { env: "test" },
      supportedChains: [
        {
          chainId: 369,
          name: "PulseChain",
          nativeAssetId: "chain:369:native:PLS",
        },
      ],
      sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING", "NATIVE"],
      pricing: {
        persistedObservationsOnly: true,
        liveAdaptersEnabled: false,
      },
      operationState: {
        updatedAt: "2026-05-08T12:00:00.000Z",
        operations: [],
        blockerSummary: {
          activeBlockerCount: 0,
          staleBlockerCount: 0,
          pendingBlockerCount: 0,
          runningBlockerCount: 0,
          oldestBlockerAgeMs: null,
          newestBlockerAgeMs: null,
          hasStaleBlockers: false,
          blockersByOperationType: {},
        },
        ingestionDiagnostics: [],
        lastSuccessfulSyncAt: null,
        lastRebuildAt: null,
        warnings: [],
      },
      materializationDiagnostics: {
        updatedAt: "2026-05-08T12:00:00.000Z",
        wallets: [],
      },
    });

    const { GET } = await import("../../app/api/debug/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "ok",
        timestamp: "2026-05-08T12:00:00.000Z",
        app: { env: "test" },
        supportedChains: [
          {
            chainId: 369,
            name: "PulseChain",
            nativeAssetId: "chain:369:native:PLS",
          },
        ],
        sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING", "NATIVE"],
        pricing: {
          persistedObservationsOnly: true,
          liveAdaptersEnabled: false,
        },
        operationState: {
          updatedAt: "2026-05-08T12:00:00.000Z",
          operations: [],
          blockerSummary: {
            activeBlockerCount: 0,
            staleBlockerCount: 0,
            pendingBlockerCount: 0,
            runningBlockerCount: 0,
            oldestBlockerAgeMs: null,
            newestBlockerAgeMs: null,
            hasStaleBlockers: false,
            blockersByOperationType: {},
          },
          ingestionDiagnostics: [],
          lastSuccessfulSyncAt: null,
          lastRebuildAt: null,
          warnings: [],
        },
        materializationDiagnostics: {
          updatedAt: "2026-05-08T12:00:00.000Z",
          wallets: [],
        },
      },
    });
  });

  it("returns a stable internal error response when status assembly throws", async () => {
    getDebugStatusReport.mockRejectedValue(new Error("database exploded"));

    const { GET } = await import("../../app/api/debug/status/route");
    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to determine backend status.",
      },
    });
  });
});
