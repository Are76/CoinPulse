import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDebugHealth,
  fetchDebugStatus,
  runManualSync,
  runRebuild,
} from "@/lib/api/debug-client";

const originalFetch = global.fetch;

describe("debug client", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reads health and status routes", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              status: "ok",
              timestamp: "2026-05-08T18:00:00.000Z",
              app: { env: "development" },
              dependencies: {
                database: { status: "ready" },
                redis: { status: "ready" },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              status: "ok",
              timestamp: "2026-05-08T18:00:00.000Z",
              app: { env: "development" },
              supportedChains: [
                {
                  chainId: 369,
                  name: "PulseChain",
                  nativeAssetId: "pulsechain:369/native:pls",
                },
              ],
              sourceFamilies: ["TRANSFERS", "DEX"],
              pricing: {
                persistedObservationsOnly: true,
                liveAdaptersEnabled: false,
              },
            },
          }),
          { status: 200 },
        ),
      ) as typeof fetch;

    await expect(fetchDebugHealth()).resolves.toMatchObject({ status: "ok" });
    await expect(fetchDebugStatus()).resolves.toMatchObject({
      sourceFamilies: ["TRANSFERS", "DEX"],
    });
  });

  it("posts manual sync payloads without adding frontend logic", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { syncRuns: [] } }), { status: 200 }),
    ) as typeof fetch;

    await runManualSync({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      sourceFamilies: ["TRANSFERS", "DEX"],
      startBlock: "1000000",
      endBlock: "1000100",
      policyLabel: "frontend-debug",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sync/manual",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX"],
          startBlock: "1000000",
          endBlock: "1000100",
          policyLabel: "frontend-debug",
        }),
      }),
    );
  });

  it("posts rebuild payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { rebuild: {} } }), { status: 200 }),
    ) as typeof fetch;

    await runRebuild({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      sourceFamilies: ["LP", "STAKING"],
      fromBlock: "1000000",
      toBlock: "1000100",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/rebuild",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["LP", "STAKING"],
          fromBlock: "1000000",
          toBlock: "1000100",
        }),
      }),
    );
  });
});
