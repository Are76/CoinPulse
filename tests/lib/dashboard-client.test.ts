import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDebugHealth,
  fetchDebugStatus,
  fetchPortfolioDashboard,
} from "@/lib/api/dashboard-client";

const originalFetch = global.fetch;

describe("dashboard client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests the dashboard route with query params", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { schemaVersion: "v1", tokenPositions: [], lpPositions: [], stakePositions: [] },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    await fetchPortfolioDashboard({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      quoteAsset: "fiat:usd",
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
          data: { schemaVersion: "v1", tokenPositions: [], lpPositions: [], stakePositions: [] },
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
