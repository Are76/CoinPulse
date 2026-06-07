import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  fetchDebugHealth,
  fetchDebugStatus,
  fetchTrackedWallets,
  runManualSync,
  runRebuild,
} from "@/lib/api/debug-client";

const HEX_OBS_MISSING = {
  schemaVersion: "v1" as const,
  chainId: 369,
  sourceFamily: "HEXMINING" as const,
  status: "missing" as const,
  asOf: "2026-06-07T00:00:00.000Z",
  latestObservation: null,
  provenance: { source: "rawHexDailyDataObservation" as const, storage: "postgres" as const },
  warnings: [],
};

const HEX_OBS_AVAILABLE = {
  schemaVersion: "v1" as const,
  chainId: 369,
  sourceFamily: "HEXMINING" as const,
  status: "available" as const,
  asOf: "2026-06-07T00:00:00.000Z",
  latestObservation: {
    id: "obs_abc",
    rangeStartDay: 1000,
    rangeEndDay: 1099,
    observedAtBlock: "23456789",
    observedAt: "2026-06-05T23:00:00.000Z",
    rpcEndpointLabel: "pulsechain-primary",
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    createdAt: "2026-06-06T00:00:00.000Z",
  },
  provenance: { source: "rawHexDailyDataObservation" as const, storage: "postgres" as const },
  warnings: [],
};

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
              hexMining: { observationStatus: HEX_OBS_MISSING },
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

  it("fetches tracked wallets and returns parsed DTO", async () => {
    const mockWallet = {
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      label: "Main Wallet",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            schemaVersion: "v1",
            wallets: [mockWallet],
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await fetchTrackedWallets();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/wallets/tracked",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.schemaVersion).toBe("v1");
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]).toEqual(mockWallet);
  });

  it("preserves backend ApiClientError from fetchTrackedWallets", async () => {
    const makeErrorResponse = () =>
      new Response(
        JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Internal server error." },
        }),
        { status: 500 },
      );

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse())
      .mockResolvedValueOnce(makeErrorResponse()) as typeof fetch;

    await expect(fetchTrackedWallets()).rejects.toBeInstanceOf(ApiClientError);
    await expect(fetchTrackedWallets()).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
    });
  });

  // ─── hexMining.observationStatus client schema tests ──────────────────────────

  function makeStatusResponse(observationStatus: unknown) {
    return new Response(
      JSON.stringify({
        data: {
          status: "ok",
          timestamp: "2026-06-07T00:00:00.000Z",
          app: { env: "development" },
          supportedChains: [],
          sourceFamilies: [],
          pricing: { persistedObservationsOnly: true, liveAdaptersEnabled: false },
          hexMining: { observationStatus },
        },
      }),
      { status: 200 },
    );
  }

  it("fetchDebugStatus preserves hexMining.observationStatus when status is missing", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStatusResponse(HEX_OBS_MISSING)) as typeof fetch;

    const result = await fetchDebugStatus();
    expect(result.hexMining.observationStatus.status).toBe("missing");
    expect(result.hexMining.observationStatus).toMatchObject({
      schemaVersion: "v1",
      chainId: 369,
      sourceFamily: "HEXMINING",
      status: "missing",
      latestObservation: null,
    });
  });

  it("fetchDebugStatus preserves hexMining.observationStatus when status is available with latestObservation", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStatusResponse(HEX_OBS_AVAILABLE)) as typeof fetch;

    const result = await fetchDebugStatus();
    expect(result.hexMining.observationStatus.status).toBe("available");
    if (result.hexMining.observationStatus.status === "available") {
      expect(result.hexMining.observationStatus.latestObservation).not.toBeNull();
      expect(result.hexMining.observationStatus.latestObservation?.observedAt).toBe(
        "2026-06-05T23:00:00.000Z",
      );
      expect(result.hexMining.observationStatus.latestObservation?.createdAt).toBe(
        "2026-06-06T00:00:00.000Z",
      );
      expect(result.hexMining.observationStatus.latestObservation?.observedAtBlock).toBe(
        "23456789",
      );
    }
  });

  it("fetchDebugStatus preserves hexMining.observationStatus when status is unavailable", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStatusResponse({ status: "unavailable" })) as typeof fetch;

    const result = await fetchDebugStatus();
    expect(result.hexMining.observationStatus).toEqual({ status: "unavailable" });
  });

  it("fetchDebugStatus does not expose canonicalPayload via client schema", async () => {
    const obsWithPayload = {
      ...HEX_OBS_AVAILABLE,
      canonicalPayload: '{"secret":"data"}',
      latestObservation: {
        ...HEX_OBS_AVAILABLE.latestObservation,
        canonicalPayload: '{"secret":"data"}',
      },
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStatusResponse(obsWithPayload)) as typeof fetch;

    const result = await fetchDebugStatus();
    expect(JSON.stringify(result)).not.toContain("canonicalPayload");
    expect(JSON.stringify(result)).not.toContain('"secret"');
  });
});
