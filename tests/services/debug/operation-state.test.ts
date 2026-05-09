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
      staleInspection: {
        ageMs: 60000,
        appearsStale: false,
        staleReason: null,
      },
    });
    expect(result.durationMs).toBe(60000);
  });

  it("marks a long-running operation as stale in debug state", () => {
    const startedAt = new Date("2026-05-08T18:00:00.000Z");
    const now = new Date("2026-05-08T19:30:01.000Z");

    const result = mapSyncRunToOperationState(
      {
        id: "sync-run-stale",
        trigger: "REBUILD",
        status: "RUNNING",
        stage: "REBUILDING_LEDGER",
        chainId: 369,
        walletId: "wallet-1",
        wallet: {
          address: "0x2222222222222222222222222222222222222222",
        },
        warningCount: 0,
        errorMessage: null,
        createdAt: startedAt,
        updatedAt: new Date("2026-05-08T18:30:00.000Z"),
      },
      now,
    );

    expect(result).toMatchObject({
      operationType: "rebuild",
      status: "rebuilding",
      staleInspection: {
        appearsStale: true,
        staleReason: "running_threshold_exceeded",
      },
    });
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
  it("returns an empty blocker summary when there are no active blockers", async () => {
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
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
    });

    expect(report.blockerSummary).toEqual({
      activeBlockerCount: 0,
      staleBlockerCount: 0,
      pendingBlockerCount: 0,
      runningBlockerCount: 0,
      oldestBlockerAgeMs: null,
      newestBlockerAgeMs: null,
      hasStaleBlockers: false,
      blockersByOperationType: {},
    });
    expect(report.ingestionDiagnostics).toEqual([]);
  });

  it("summarizes fresh active blockers without marking them stale", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "pending-sync",
          trigger: "MANUAL",
          status: "PENDING",
          stage: "PENDING",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:50:00.000Z"),
          updatedAt: new Date("2026-05-08T18:50:00.000Z"),
        },
        {
          id: "running-rebuild",
          trigger: "REBUILD",
          status: "RUNNING",
          stage: "REBUILDING_LEDGER",
          chainId: 369,
          walletId: "wallet-2",
          wallet: { address: "0x2222222222222222222222222222222222222222" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:30:00.000Z"),
          updatedAt: new Date("2026-05-08T18:45:00.000Z"),
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
    });

    expect(report.blockerSummary).toEqual({
      activeBlockerCount: 2,
      staleBlockerCount: 0,
      pendingBlockerCount: 1,
      runningBlockerCount: 1,
      oldestBlockerAgeMs: 1800000,
      newestBlockerAgeMs: 600000,
      hasStaleBlockers: false,
      blockersByOperationType: {
        manual_sync: 1,
        rebuild: 1,
      },
    });
  });

  it("summarizes mixed fresh and stale blockers", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "stale-pending",
          trigger: "MANUAL",
          status: "PENDING",
          stage: "PENDING",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:40:00.000Z"),
          updatedAt: new Date("2026-05-08T18:40:00.000Z"),
        },
        {
          id: "fresh-running",
          trigger: "REBUILD",
          status: "RUNNING",
          stage: "REBUILDING_LEDGER",
          chainId: 369,
          walletId: "wallet-2",
          wallet: { address: "0x2222222222222222222222222222222222222222" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:20:00.000Z"),
          updatedAt: new Date("2026-05-08T18:50:00.000Z"),
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
    });

    expect(report.blockerSummary).toEqual({
      activeBlockerCount: 2,
      staleBlockerCount: 1,
      pendingBlockerCount: 1,
      runningBlockerCount: 1,
      oldestBlockerAgeMs: 2400000,
      newestBlockerAgeMs: 1200000,
      hasStaleBlockers: true,
      blockersByOperationType: {
        manual_sync: 1,
        rebuild: 1,
      },
    });
  });

  it("groups blockers by operation type when available", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "manual-1",
          trigger: "MANUAL",
          status: "PENDING",
          stage: "PENDING",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:55:00.000Z"),
          updatedAt: new Date("2026-05-08T18:55:00.000Z"),
        },
        {
          id: "import-1",
          trigger: "IMPORT",
          status: "RUNNING",
          stage: "NORMALIZING_LEDGER",
          chainId: 369,
          walletId: "wallet-2",
          wallet: { address: "0x2222222222222222222222222222222222222222" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:50:00.000Z"),
          updatedAt: new Date("2026-05-08T18:56:00.000Z"),
        },
        {
          id: "rebuild-1",
          trigger: "REBUILD",
          status: "RUNNING",
          stage: "REBUILDING_LEDGER",
          chainId: 369,
          walletId: "wallet-3",
          wallet: { address: "0x3333333333333333333333333333333333333333" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:45:00.000Z"),
          updatedAt: new Date("2026-05-08T18:57:00.000Z"),
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
    });

    expect(report.blockerSummary.blockersByOperationType).toEqual({
      manual_sync: 2,
      rebuild: 1,
    });
  });
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

  it("returns diagnostics for a transfer run with an empty requested range", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "transfer-empty",
          trigger: "MANUAL",
          status: "COMPLETED",
          stage: "COMPLETED",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 0,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:00:00.000Z"),
          updatedAt: new Date("2026-05-08T18:01:00.000Z"),
          sourceFamilies: ["TRANSFERS"],
          policyLabel: "manual",
          startBlock: 10n,
          endBlock: 9n,
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
      getTransferIngestionCounts: async () => ({
        rawBlocksPersistedCount: 0,
        rawTransactionsPersistedCount: 0,
        rawLogsPersistedCount: 0,
      }),
    });

    expect(report.ingestionDiagnostics).toEqual([
      {
        operationId: "transfer-empty",
        walletId: "wallet-1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        sourceFamily: "TRANSFERS",
        rangeStatus: "exact",
        rangeWarning: null,
        requestedFromBlock: "10",
        requestedToBlock: "9",
        nativeScanWindowCount: 0,
        nativeScanWindows: [],
        rawBlocksPersistedCount: 0,
        rawTransactionsPersistedCount: 0,
        rawLogsPersistedCount: 0,
        warningCount: 0,
      },
    ]);
  });

  it("returns diagnostics for a single native scan window with deterministic shape", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "transfer-one-window",
          trigger: "MANUAL",
          status: "COMPLETED",
          stage: "COMPLETED",
          chainId: 369,
          walletId: "wallet-1",
          wallet: { address: "0x1111111111111111111111111111111111111111" },
          warningCount: 2,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:00:00.000Z"),
          updatedAt: new Date("2026-05-08T18:01:00.000Z"),
          sourceFamilies: ["TRANSFERS"],
          policyLabel: "manual",
          startBlock: 100n,
          endBlock: 150n,
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
      getTransferIngestionCounts: async () => ({
        rawBlocksPersistedCount: 51,
        rawTransactionsPersistedCount: 4,
        rawLogsPersistedCount: 3,
      }),
    });

    expect(report.ingestionDiagnostics).toEqual([
      {
        operationId: "transfer-one-window",
        walletId: "wallet-1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        sourceFamily: "TRANSFERS",
        rangeStatus: "exact",
        rangeWarning: null,
        requestedFromBlock: "100",
        requestedToBlock: "150",
        nativeScanWindowCount: 1,
        nativeScanWindows: [{ fromBlock: "100", toBlock: "150" }],
        rawBlocksPersistedCount: 51,
        rawTransactionsPersistedCount: 4,
        rawLogsPersistedCount: 3,
        warningCount: 2,
      },
    ]);
  });

  it("returns diagnostics for multiple native scan windows predictably", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "transfer-many-windows",
          trigger: "REBUILD",
          status: "RUNNING",
          stage: "INGESTING_RAW_LOGS",
          chainId: 369,
          walletId: "wallet-2",
          wallet: { address: "0x2222222222222222222222222222222222222222" },
          warningCount: 1,
          errorMessage: null,
          createdAt: new Date("2026-05-08T18:00:00.000Z"),
          updatedAt: new Date("2026-05-08T18:10:00.000Z"),
          sourceFamilies: ["TRANSFERS", "DEX"],
          policyLabel: "rebuild",
          startBlock: 1n,
          endBlock: 4005n,
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
      getTransferIngestionCounts: async () => ({
        rawBlocksPersistedCount: 4005,
        rawTransactionsPersistedCount: 7,
        rawLogsPersistedCount: 2,
      }),
    });

    expect(report.ingestionDiagnostics).toEqual([
      {
        operationId: "transfer-many-windows",
        walletId: "wallet-2",
        walletAddress: "0x2222222222222222222222222222222222222222",
        chainId: 369,
        sourceFamily: "TRANSFERS",
        rangeStatus: "unavailable",
        rangeWarning:
          "TRANSFERS-specific requested range is not persisted for this multi-family run",
        requestedFromBlock: null,
        requestedToBlock: null,
        nativeScanWindowCount: 0,
        nativeScanWindows: [],
        rawBlocksPersistedCount: null,
        rawTransactionsPersistedCount: null,
        rawLogsPersistedCount: null,
        warningCount: 1,
      },
    ]);
  });

  it("uses the TRANSFERS-specific failed range for multi-family runs when that range is persisted", async () => {
    const now = new Date("2026-05-08T19:00:00.000Z");
    const report = await getOperationStateReport({
      now,
      listSyncRuns: async () => [
        {
          id: "transfer-failed-range",
          trigger: "MANUAL",
          status: "FAILED",
          stage: "INGESTING_RAW_LOGS",
          chainId: 369,
          walletId: "wallet-3",
          wallet: { address: "0x3333333333333333333333333333333333333333" },
          warningCount: 0,
          errorMessage: "[INGESTING_RAW_LOGS] TRANSFERS 10000-14050: upstream failure",
          createdAt: new Date("2026-05-08T18:00:00.000Z"),
          updatedAt: new Date("2026-05-08T18:05:00.000Z"),
          sourceFamilies: ["TRANSFERS", "DEX"],
          policyLabel: "manual",
          startBlock: 0n,
          endBlock: 14050n,
          failedSourceFamily: "TRANSFERS",
          failedFromBlock: 10000n,
          failedToBlock: 14050n,
        },
      ],
      getLastSuccessfulSyncRun: async () => null,
      getLastRebuildRun: async () => null,
      getTransferIngestionCounts: async ({ fromBlock, toBlock }) => ({
        rawBlocksPersistedCount: Number(toBlock - fromBlock + 1n),
        rawTransactionsPersistedCount: 5,
        rawLogsPersistedCount: 4,
      }),
    });

    expect(report.ingestionDiagnostics).toEqual([
      {
        operationId: "transfer-failed-range",
        walletId: "wallet-3",
        walletAddress: "0x3333333333333333333333333333333333333333",
        chainId: 369,
        sourceFamily: "TRANSFERS",
        rangeStatus: "exact",
        rangeWarning: null,
        requestedFromBlock: "10000",
        requestedToBlock: "14050",
        nativeScanWindowCount: 3,
        nativeScanWindows: [
          { fromBlock: "10000", toBlock: "11999" },
          { fromBlock: "12000", toBlock: "13999" },
          { fromBlock: "14000", toBlock: "14050" },
        ],
        rawBlocksPersistedCount: 4051,
        rawTransactionsPersistedCount: 5,
        rawLogsPersistedCount: 4,
        warningCount: 0,
      },
    ]);
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
