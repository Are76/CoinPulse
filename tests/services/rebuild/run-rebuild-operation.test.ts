import { describe, expect, it, vi } from "vitest";

import { OperationConflictError } from "@/services/operations/operation-lock";
import { runRebuildOperation } from "@/services/rebuild/run-rebuild-operation";

describe("runRebuildOperation", () => {
  it("persists a rebuild SyncRun lifecycle and combines rebuild/materialization warnings", async () => {
    const createRun = vi.fn().mockResolvedValue({ id: "rebuild-run-1" });
    const updateRun = vi.fn().mockResolvedValue(undefined);
    const rebuildCanonicalLedger = vi.fn().mockResolvedValue({
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
      warnings: ["rebuild-warning"],
    });
    const materializeCurrentPortfolioPositions = vi.fn().mockResolvedValue({
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      ledgerEntriesProcessed: 9,
      tokenBalancesWritten: 3,
      lpPositionsWritten: 1,
      stakePositionsWritten: 0,
      skippedCount: 0,
      warnings: ["materialize-warning"],
    });

    const result = await runRebuildOperation({
      wallet: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
      fromBlock: 100n,
      toBlock: 200n,
      sourceFamilies: ["TRANSFERS", "DEX"],
      dependencies: {
        runStore: {
          createRun,
          updateRun,
        },
        rebuildCanonicalLedger,
        materializeCurrentPortfolioPositions,
      },
    });

    expect(createRun).toHaveBeenCalledWith({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "REBUILD",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS", "DEX"],
      startBlock: 100n,
      endBlock: 200n,
      policyLabel: "manual-rebuild",
    });
    expect(updateRun).toHaveBeenNthCalledWith(1, {
      runId: "rebuild-run-1",
      status: "RUNNING",
      stage: "REBUILDING_LEDGER",
      latestSafeBlock: undefined,
      warningCount: 0,
      warningDetails: [],
    });
    expect(updateRun).toHaveBeenNthCalledWith(2, {
      runId: "rebuild-run-1",
      status: "RUNNING",
      stage: "MATERIALIZING_POSITIONS",
      latestSafeBlock: 200n,
      warningCount: 1,
      warningDetails: ["rebuild-warning"],
    });
    expect(updateRun).toHaveBeenNthCalledWith(3, {
      runId: "rebuild-run-1",
      status: "COMPLETED",
      stage: "COMPLETED",
      latestSafeBlock: 200n,
      warningCount: 2,
      warningDetails: ["rebuild-warning", "materialize-warning"],
      errorMessage: null,
      endBlock: 200n,
      failedSourceFamily: null,
      failedFromBlock: null,
      failedToBlock: null,
    });
    expect(result).toEqual({
      runId: "rebuild-run-1",
      rebuild: expect.objectContaining({
        ledgerEntriesRecreated: 9,
      }),
      materialized: expect.objectContaining({
        tokenBalancesWritten: 3,
      }),
      warningCount: 2,
    });
  });

  it("marks the persisted rebuild run as failed when ledger rebuild throws", async () => {
    const createRun = vi.fn().mockResolvedValue({ id: "rebuild-run-2" });
    const updateRun = vi.fn().mockResolvedValue(undefined);
    const rebuildCanonicalLedger = vi.fn().mockRejectedValue(new Error("rebuild exploded"));

    await expect(
      runRebuildOperation({
        wallet: {
          id: "wallet-1",
          address: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        },
        fromBlock: 500n,
        toBlock: 600n,
        sourceFamilies: ["LP"],
        dependencies: {
          runStore: {
            createRun,
            updateRun,
          },
          rebuildCanonicalLedger,
          materializeCurrentPortfolioPositions: vi.fn(),
        },
      }),
    ).rejects.toThrow("rebuild exploded");

    expect(updateRun).toHaveBeenNthCalledWith(1, {
      runId: "rebuild-run-2",
      status: "RUNNING",
      stage: "REBUILDING_LEDGER",
      latestSafeBlock: undefined,
      warningCount: 0,
      warningDetails: [],
    });
    expect(updateRun).toHaveBeenNthCalledWith(2, {
      runId: "rebuild-run-2",
      status: "FAILED",
      stage: "REBUILDING_LEDGER",
      latestSafeBlock: undefined,
      warningCount: 0,
      warningDetails: [],
      errorMessage: "[REBUILDING_LEDGER] LP 500-600: rebuild exploded",
      endBlock: 600n,
      failedSourceFamily: "LP",
      failedFromBlock: 500n,
      failedToBlock: 600n,
    });
  });

  it("blocks rebuild when reserveOperationRun reports an active conflicting sync", async () => {
    const reserveOperationRun = vi.fn(async () => {
      throw new OperationConflictError({
        allowed: false,
        reason: "active_sync_in_scope",
        conflictingOperationId: "run-sync-1",
        conflictingTrigger: "MANUAL",
        conflictingStage: "PERSISTING_LEDGER",
        startedAt: "2026-05-08T12:00:00.000Z",
        createdAt: "2026-05-08T12:00:00.000Z",
        updatedAt: "2026-05-08T12:01:00.000Z",
        operationType: "manual_sync",
        status: "RUNNING",
        ageMs: 60000,
        appearsStale: false,
        staleReason: null,
      });
    });

    await expect(
      runRebuildOperation({
        wallet: {
          id: "wallet-1",
          address: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        },
        fromBlock: 100n,
        toBlock: 200n,
        sourceFamilies: ["TRANSFERS"],
        dependencies: {
          runStore: {
            createRun: vi.fn(),
            updateRun: vi.fn(),
          },
          reserveOperationRun,
          rebuildCanonicalLedger: vi.fn(),
          materializeCurrentPortfolioPositions: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
      details: expect.objectContaining({
        reason: "active_sync_in_scope",
        conflictingOperationId: "run-sync-1",
      }),
    });
  });
});
