import { afterEach, describe, expect, it, vi } from "vitest";

const resolveTrackedWalletByAddress = vi.fn();
const runWalletSync = vi.fn();
const runRebuildOperation = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress,
}));

vi.mock("@/services/sync", () => ({
  runWalletSync,
}));

vi.mock("@/services/rebuild", () => ({
  runRebuildOperation,
}));

describe("POST /api/sync/manual", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("validates input, resolves the wallet, and delegates to the sync service", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runWalletSync.mockResolvedValue({
      runId: "sync-run-1",
      counts: {
        rawLogs: 10,
        actionGroups: 4,
        ledgerEntries: 9,
      },
      warningCount: 1,
      latestSafeBlock: 200n,
    });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX"],
          endBlock: "200",
          startBlock: "100",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        runId: "sync-run-1",
        counts: {
          rawLogs: 10,
          actionGroups: 4,
          ledgerEntries: 9,
        },
        warningCount: 1,
        latestSafeBlock: "200",
      },
    });
    expect(runWalletSync).toHaveBeenCalledWith({
      wallet: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
      sourceFamilies: ["TRANSFERS", "DEX"],
      startBlock: 100n,
      endBlock: 200n,
      policyLabel: "manual-dashboard-sync",
      trigger: "MANUAL",
    });
  });

  it("returns a structured validation error for invalid sync input", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "bad",
          chainId: "oops",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: expect.any(Array),
      },
    });
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns not found when the requested tracked wallet is absent", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Wallet not found for the requested chain.",
      },
    });
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns a safe internal error response for unexpected sync failures", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runWalletSync.mockRejectedValue(new Error("rpc token secret leaked"));

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("rpc token secret leaked");
  });

  it("rejects block spans above the safe limit before calling the sync service", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING"],
          startBlock: "26740000",
          endBlock: "26797360",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toBe("Invalid request input.");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Block span exceeds") }),
      ]),
    );
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("accepts block spans at or below the safe limit", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runWalletSync.mockResolvedValue({
      runId: "sync-run-safe",
      counts: { rawLogs: 2, actionGroups: 1, ledgerEntries: 2 },
      warningCount: 0,
      latestSafeBlock: 1000n,
    });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          startBlock: "0",
          endBlock: "1000",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runWalletSync).toHaveBeenCalled();
  });

  it("returns a structured 400 with a safe message that does not leak secrets", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          startBlock: "0",
          endBlock: "99999",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/rpc/i);
    expect(bodyStr).not.toMatch(/secret/i);
    expect(bodyStr).not.toMatch(/stack/i);
    expect(bodyStr).not.toMatch(/env\b/i);
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns a structured 409 conflict when manual sync is blocked by an active rebuild", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runWalletSync.mockRejectedValue({
      code: "OPERATION_CONFLICT",
      message: "A conflicting operation is already active.",
      details: {
        allowed: false,
        reason: "active_rebuild_in_progress",
        conflictingOperationId: "run-rebuild-1",
        conflictingTrigger: "REBUILD",
        conflictingStage: "REBUILDING_LEDGER",
        operationType: "rebuild",
        status: "RUNNING",
        startedAt: "2026-05-08T10:00:00.000Z",
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:01:00.000Z",
        ageMs: 60000,
        appearsStale: false,
        staleReason: null,
      },
    });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: {
          allowed: false,
          reason: "active_rebuild_in_progress",
          conflictingOperationId: "run-rebuild-1",
          conflictingTrigger: "REBUILD",
          conflictingStage: "REBUILDING_LEDGER",
          operationType: "rebuild",
          status: "RUNNING",
          startedAt: "2026-05-08T10:00:00.000Z",
          createdAt: "2026-05-08T10:00:00.000Z",
          updatedAt: "2026-05-08T10:01:00.000Z",
          ageMs: 60000,
          appearsStale: false,
          staleReason: null,
        },
      },
    });
  });
});

describe("POST /api/rebuild", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delegates rebuild and materialization to the backend services", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runRebuildOperation.mockResolvedValue({
      runId: "rebuild-run-1",
      warningCount: 1,
      rebuild: {
        wallet: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        fromBlock: 100n,
        toBlock: 200n,
        sourceFamilies: ["TRANSFERS", "DEX"],
        sourceFamiliesIncluded: ["TRANSFERS", "DEX"],
        rawSnapshotsProcessed: 12,
        ledgerEntriesDeleted: 3,
        ledgerEntriesRecreated: 9,
        skippedCount: 1,
        skippedSnapshots: 1,
        unsupportedSourceFamilies: 0,
        warnings: ["warning-a"],
      },
      materialized: {
        wallet: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        ledgerEntriesProcessed: 9,
        tokenBalancesWritten: 3,
        lpPositionsWritten: 1,
        stakePositionsWritten: 0,
        skippedCount: 0,
        warnings: [],
      },
    });

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        rebuild: {
          wallet: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS", "DEX"],
          sourceFamiliesIncluded: ["TRANSFERS", "DEX"],
          rawSnapshotsProcessed: 12,
          ledgerEntriesDeleted: 3,
          ledgerEntriesRecreated: 9,
          skippedCount: 1,
          skippedSnapshots: 1,
          unsupportedSourceFamilies: 0,
          warnings: ["warning-a"],
        },
        materialized: {
          wallet: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          ledgerEntriesProcessed: 9,
          tokenBalancesWritten: 3,
          lpPositionsWritten: 1,
          stakePositionsWritten: 0,
          skippedCount: 0,
          warnings: [],
        },
      },
    });
    expect(runRebuildOperation).toHaveBeenCalledWith({
      wallet: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
      fromBlock: 100n,
      toBlock: 200n,
      sourceFamilies: ["TRANSFERS", "DEX"],
    });
  });

  it("rejects rebuild block spans above the safe limit before calling the rebuild service", async () => {
    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "26740000",
          toBlock: "26797360",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Block span exceeds") }),
      ]),
    );
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns a structured validation error for invalid rebuild input", async () => {
    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "bad",
          chainId: "oops",
          fromBlock: "200",
          toBlock: "100",
          sourceFamilies: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: expect.any(Array),
      },
    });
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns not found when the requested rebuild wallet is absent", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Wallet not found for the requested chain.",
      },
    });
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns a safe internal error response for unexpected rebuild failures", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runRebuildOperation.mockRejectedValue(
      new Error("ledger secret stack detail"),
    );

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("ledger secret stack detail");
  });

  it("returns a structured 409 conflict when rebuild is blocked by an active sync", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    runRebuildOperation.mockRejectedValue({
      code: "OPERATION_CONFLICT",
      message: "A conflicting operation is already active.",
      details: {
        allowed: false,
        reason: "active_sync_in_scope",
        conflictingOperationId: "run-sync-1",
        conflictingTrigger: "MANUAL",
        conflictingStage: "PERSISTING_LEDGER",
        operationType: "manual_sync",
        status: "RUNNING",
        startedAt: "2026-05-08T12:00:00.000Z",
        createdAt: "2026-05-08T12:00:00.000Z",
        updatedAt: "2026-05-08T12:01:00.000Z",
        ageMs: 60000,
        appearsStale: false,
        staleReason: null,
      },
    });

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: {
          allowed: false,
          reason: "active_sync_in_scope",
          conflictingOperationId: "run-sync-1",
          conflictingTrigger: "MANUAL",
          conflictingStage: "PERSISTING_LEDGER",
          operationType: "manual_sync",
          status: "RUNNING",
          startedAt: "2026-05-08T12:00:00.000Z",
          createdAt: "2026-05-08T12:00:00.000Z",
          updatedAt: "2026-05-08T12:01:00.000Z",
          ageMs: 60000,
          appearsStale: false,
          staleReason: null,
        },
      },
    });
  });
});
