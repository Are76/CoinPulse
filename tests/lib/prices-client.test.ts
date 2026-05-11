import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, fetchPricingStatus } from "@/lib/api/prices-client";

const originalFetch = global.fetch;

const MOCK_PRICING_STATUS = {
  schemaVersion: "v1" as const,
  status: "ok" as const,
  asOf: "2026-05-11T12:00:00.000Z",
  sources: [
    {
      sourceType: "ONCHAIN_POOL",
      status: "ok" as const,
      latestObservedAt: "2026-05-11T11:59:00.000Z",
      staleAfterSeconds: 120,
      observationsCount: 5,
      rejectedCount: 0,
      reason: null,
    },
  ],
};

describe("prices client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetchPricingStatus calls /api/prices/status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PRICING_STATUS }), { status: 200 }),
    ) as typeof fetch;

    await fetchPricingStatus();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/prices/status",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fetchPricingStatus returns parsed DTO on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PRICING_STATUS }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchPricingStatus();

    expect(result.schemaVersion).toBe("v1");
    expect(result.status).toBe("ok");
    expect(result.asOf).toBe("2026-05-11T12:00:00.000Z");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toEqual(MOCK_PRICING_STATUS.sources[0]);
  });

  it("fetchPricingStatus surfaces ApiClientError on backend error", async () => {
    const makeErrorResponse = () =>
      new Response(
        JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Unable to determine pricing status." },
        }),
        { status: 500 },
      );

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse())
      .mockResolvedValueOnce(makeErrorResponse()) as typeof fetch;

    await expect(fetchPricingStatus()).rejects.toBeInstanceOf(ApiClientError);
    await expect(fetchPricingStatus()).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Unable to determine pricing status.",
    });
  });

  it("fetchPricingStatus rejects invalid response shape", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            // missing required fields
            status: "ok",
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    await expect(fetchPricingStatus()).rejects.toThrow();
  });

  it("fetchPricingStatus handles degraded status with multiple sources", async () => {
    const degradedPayload = {
      schemaVersion: "v1" as const,
      status: "degraded" as const,
      asOf: "2026-05-11T12:00:00.000Z",
      sources: [
        {
          sourceType: "ONCHAIN_POOL",
          status: "degraded" as const,
          latestObservedAt: "2026-05-11T11:00:00.000Z",
          staleAfterSeconds: 120,
          observationsCount: 3,
          rejectedCount: 3,
          reason: "latest_observation_stale",
        },
        {
          sourceType: "DEXSCREENER",
          status: "disabled" as const,
          latestObservedAt: null,
          staleAfterSeconds: null,
          observationsCount: 0,
          rejectedCount: 0,
          reason: "source_disabled",
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: degradedPayload }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchPricingStatus();

    expect(result.status).toBe("degraded");
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.status).toBe("degraded");
    expect(result.sources[1]?.status).toBe("disabled");
  });

  it("fetchPricingStatus handles unknown status with null source fields", async () => {
    const unknownPayload = {
      schemaVersion: "v1" as const,
      status: "unknown" as const,
      asOf: "2026-05-11T12:00:00.000Z",
      sources: [
        {
          sourceType: "ORACLE",
          status: "unknown" as const,
          latestObservedAt: null,
          staleAfterSeconds: null,
          observationsCount: 0,
          rejectedCount: 0,
          reason: "no_observations",
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: unknownPayload }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchPricingStatus();

    expect(result.status).toBe("unknown");
    expect(result.sources[0]?.latestObservedAt).toBeNull();
    expect(result.sources[0]?.staleAfterSeconds).toBeNull();
  });
});
