import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDebugHealth,
  fetchDebugStatus,
  fetchPortfolioDashboard,
} from "@/lib/api/dashboard-client";

const originalFetch = global.fetch;

const EMPTY_PNL_COVERAGE = {
  status: "unknown",
  reasons: [],
  affectedSections: [],
  pricedPositionsCount: 0,
  unpricedPositionsCount: 0,
  unsupportedPositionsCount: 0,
  incompleteBasisPositionsCount: 0,
  stalePricePositionsCount: 0,
  sourceDisabledPositionsCount: 0,
  asOf: "2026-01-01T00:00:00.000Z",
};

describe("dashboard client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests the dashboard route with query params", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            schemaVersion: "v1",
            pnlCoverage: EMPTY_PNL_COVERAGE,
            tokenPositions: [],
            lpPositions: [],
            stakePositions: [],
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    await expect(
      fetchPortfolioDashboard({
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        quoteAsset: "fiat:usd",
      }),
    ).resolves.toMatchObject({
      pnlCoverage: EMPTY_PNL_COVERAGE,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portfolio/dashboard?walletAddress=0x1111111111111111111111111111111111111111&chainId=369&quoteAsset=fiat%3Ausd",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
        },
      }),
    );
  });

  it("forwards asOf when requesting the dashboard route", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            schemaVersion: "v1",
            pnlCoverage: EMPTY_PNL_COVERAGE,
            tokenPositions: [],
            lpPositions: [],
            stakePositions: [],
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    await fetchPortfolioDashboard({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      quoteAsset: "fiat:usd",
      asOf: "2026-02-02T00:00:00.000Z",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/portfolio/dashboard?walletAddress=0x1111111111111111111111111111111111111111&chainId=369&quoteAsset=fiat%3Ausd&asOf=2026-02-02T00%3A00%3A00.000Z",
      expect.any(Object),
    );
  });

  it("passes dashboard token metadata provenance through without frontend inference", async () => {
    const metadataProvenance = {
      status: "observed",
      source: "chain",
      observedAt: "2026-05-08T11:59:00.000Z",
      confidence: "medium",
      conflictReason: null,
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            schemaVersion: "v1",
            pnlCoverage: EMPTY_PNL_COVERAGE,
            tokenPositions: [{ metadataProvenance }],
            lpPositions: [],
            stakePositions: [],
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    await expect(
      fetchPortfolioDashboard({
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      }),
    ).resolves.toMatchObject({ tokenPositions: [{ metadataProvenance }] });
  });

  it("throws structured API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request input.",
          },
        }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchPortfolioDashboard({
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "INVALID_INPUT",
      message: "Invalid request input.",
    });
  });

  it("reads health and status routes", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "ok" } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { sourceFamilies: ["TRANSFERS"] } }), {
          status: 200,
        }),
      ) as typeof fetch;

    await expect(fetchDebugHealth()).resolves.toMatchObject({ status: "ok" });
    await expect(fetchDebugStatus()).resolves.toMatchObject({
      sourceFamilies: ["TRANSFERS"],
    });
  });
});
