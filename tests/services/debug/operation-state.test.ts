import { describe, expect, it } from "vitest";

import {
  getOperationStateReport,
  mapSyncRunToOperationState,
} from "@/services/debug/operation-state";

describe("mapSyncRunToOperationState", () => {
  it("maps a completed manual sync with warnings to partial", () => {
    const startedAt = new Date("2026-05-08T18:00:00.000Z");
    const finishedAt = new Date("2026-05-08T18:05:30.000Z");

    const result = mapSyncRunToOperationState(
      {
        id: "sync-run-1",
        trigger: "MANUAL",
        status: "COMPLETED",
        stage: "COMPLETED",
        chainId: 369,
        walletId: "wallet-1",
        wallet: {
          address: "0x1111111111111111111111111111111111111111",
        },
        warningCount: 2,
        errorMessage: null,
        createdAt: startedAt,
        updatedAt: finishedAt,
      },
      finishedAt,
    );

    expect(result).toMatchObject({
      operationId: "sync-run-1",
      operationType: "manual_sync",
      status: "partial",
      chainId: 369,
      walletId: "wallet-1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      currentStage: "COMPLETED",
      warningCount: 2,
      errorMessage: null,
    });
    expect(result.startedAt).toBe(startedAt.toISOString());
    expect(result.finishedAt).toBe(finishedAt.toISOString());
    expect(result.durationMs).toBe(330000);
  });

  it("maps a running sync to a running operation without a finished timestamp", () => {
    const startedAt = new Date("2026-05-08T18:00:00.000Z");
    const now = new Date("2026-05-08T18:01:00.000Z");

    const result = mapSyncRunToOperationState(
      {
        id: "sync-run-2",
        trigger: "MANUAL",
        status: "RUNNING",
        stage: "PERSISTING_LEDGER",
        chainId: 369,
        walletId: "wallet-1",
        wallet: {
          address: "0x2222222222222222222222222222222222222222",
        },
        warningCount: 0,
        errorMessage: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
      now,
    );

    expect(result).toMatchObject({
      operationType: "manual_sync",
      status: "running",
      currentStage: "PERSISTING_LEDGER",
      finishedAt: null,
      errorMessage: null,
    });
    expect(result.durationMs).toBe(60000);
  });

  it("maps failed runs to failed operations and preserves the backend error message", () => {
    const startedAt = new Date("2026-05-08T18:00:00.000Z");
    const finishedAt = new Date("2026-05-08T18:03:00.000Z");

    const result = mapSyncRunToOperationState(
      {
        id: "sync-run-3",
        trigger: "IMPORT",
        status: "FAILED",
        stage: "INGESTING_RAW_LOGS",
        chainId: 1,
        walletId: null,
        wallet: null,
        warningCount: 1,
        errorMessage: "[INGESTING_RAW_LOGS] TRANSFERS 0-100: RPC failure",
        createdAt: startedAt,
        updatedAt: finishedAt,
      },
      finishedAt,
    );

    expect(result).toMatchObject({
      operationType: "manual_sync",
      status: "failed",
      walletId: null,
      walletAddress: null,
      errorMessage: "[INGESTING_RAW_LOGS] TRANSFERS 0-100: RPC failure",
    });
  });
});

describe("getOperationStateReport", () => {
  it("builds summary timestamps and keeps rebuild state explicit when no rebuild operations exist", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "sync-run-1",
          trigger: "MANUAL",
          status: "COMPLETED",
          stage: "COMPLETED",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:00:00.000Z"),
          updatedAt: new Date("2026-05-08T18:02:00.000Z"),
        },
        {
          id: "sync-run-2",
          trigger: "MANUAL",
          status: "RUNNING",
          stage: "NORMALIZING_LEDGER",
          chainId: 369,
          walletId: "wallet-2",
          wallet: { address: "0x2222222222222222222222222222222222222222" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:30:00.000Z"),
          updatedAt: new Date("2026-05-08T18:30:00.000Z"),
        },
      ],
      getLastSuccessfulSyncRun: async () => ({
        id: "sync-run-1",
        trigger: "MANUAL",
        status: "COMPLETED",
        stage: "COMPLETED",
        chainId: 369,
        walletId: "wallet-1",
        wallet: { address: "0x1111111111111111111111111111111111111111" },
        warningCount: 0,
        errorMessage: null,
        createdAt: new Date("2026-05-08T18:00:00.000Z"),
        updatedAt: new Date("2026-05-08T18:02:00.000Z"),
      }),
      getLastRebuildRun: async () => null,
    });

    expect(report.operations).toHaveLength(2);
    expect(report.operations[0]).toMatchObject({
      operationId: "sync-run-2",
      status: "running",
    });
    expect(report.operations[1]).toMatchObject({
      operationId: "sync-run-1",
      status: "succeeded",
    });
    expect(report.lastSuccessfulSyncAt).toBe("2026-05-08T18:02:00.000Z");
    expect(report.lastRebuildAt).toBeNull();
    expect(report.updatedAt).toBe(now.toISOString());
    expect(report.warnings).toContain(
      "rebuild operations are not persisted separately yet; lastRebuildAt may be unavailable",
    );
  });

  it("finds lastSuccessfulSyncAt even when the successful run is older than the recent operations list", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const recentRuns = Array.from({ length: 25 }, (_, index) => ({
      id: `recent-run-${index}`,
      trigger: "MANUAL" as const,
      status: "FAILED" as const,
      stage: "INGESTING_RAW_LOGS",
      chainId: 369,
      walletId: `wallet-${index}`,
      wallet: {
        address: `0x${String(index + 1).padStart(40, "1")}`,
      },
      warningCount: 0,
      errorMessage: "sync failed",
      createdAt: new Date(`2026-05-08T18:${String(index).padStart(2, "0")}:00.000Z`),
      updatedAt: new Date(`2026-05-08T18:${String(index).padStart(2, "0")}:30.000Z`),
    }));

    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => recentRuns,
      getLastSuccessfulSyncRun: async () => ({
        id: "older-success",
        trigger: "MANUAL",
        status: "COMPLETED",
        stage: "COMPLETED",
        chainId: 369,
        walletId: "wallet-success",
        wallet: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        warningCount: 0,
        errorMessage: null,
        createdAt: new Date("2026-05-08T17:00:00.000Z"),
        updatedAt: new Date("2026-05-08T17:05:00.000Z"),
      }),
      getLastRebuildRun: async () => null,
    });

    expect(report.operations).toHaveLength(25);
    expect(report.lastSuccessfulSyncAt).toBe("2026-05-08T17:05:00.000Z");
  });

  it("uses startedAt for lastRebuildAt when a rebuild is still running", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => ({
        id: "rebuild-running",
        trigger: "REBUILD",
        status: "RUNNING",
        stage: "NORMALIZING_LEDGER",
        chainId: 369,
        walletId: "wallet-rebuild",
        wallet: { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        warningCount: 0,
        errorMessage: null,
        createdAt: new Date("2026-05-08T18:45:00.000Z"),
        updatedAt: new Date("2026-05-08T18:45:00.000Z"),
      }),
    });

    expect(report.lastRebuildAt).toBe("2026-05-08T18:45:00.000Z");
    expect(report.warnings).toHaveLength(0);
  });
});
