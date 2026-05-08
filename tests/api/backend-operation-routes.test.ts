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
        startedAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:01:00.000Z",
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
          startedAt: "2026-05-08T10:00:00.000Z",
          updatedAt: "2026-05-08T10:01:00.000Z",
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
        startedAt: "2026-05-08T12:00:00.000Z",
        updatedAt: "2026-05-08T12:01:00.000Z",
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
          startedAt: "2026-05-08T12:00:00.000Z",
          updatedAt: "2026-05-08T12:01:00.000Z",
        },
      },
    });
  });
});
