import { describe, expect, it } from "vitest";

import {
  checkOperationConflict,
  inspectOperationBlocker,
  isOperationConflictError,
  OperationConflictError,
  reserveOperationRun,
} from "@/services/operations/operation-lock";

describe("checkOperationConflict", () => {
  it("blocks rebuild when another rebuild is active", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "REBUILD",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-rebuild-1",
          trigger: "REBUILD",
          status: "RUNNING",
          stage: "REBUILDING_LEDGER",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T10:00:00.000Z"),
          updatedAt: new Date("2026-05-08T10:02:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T10:02:00.000Z"),
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-1",
      conflictingTrigger: "REBUILD",
      conflictingStage: "REBUILDING_LEDGER",
      operationType: "rebuild",
      status: "RUNNING",
      startedAt: "2026-05-08T10:00:00.000Z",
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:02:00.000Z",
      ageMs: 120000,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("blocks manual sync when a rebuild is active", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "MANUAL",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-rebuild-2",
          trigger: "REBUILD",
          status: "PENDING",
          stage: "PENDING",
          chainId: 1,
          walletId: "wallet-other",
          createdAt: new Date("2026-05-08T11:00:00.000Z"),
          updatedAt: new Date("2026-05-08T11:00:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T11:00:00.000Z"),
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-2",
      conflictingTrigger: "REBUILD",
      conflictingStage: "PENDING",
      operationType: "rebuild",
      status: "PENDING",
      startedAt: "2026-05-08T11:00:00.000Z",
      createdAt: "2026-05-08T11:00:00.000Z",
      updatedAt: "2026-05-08T11:00:00.000Z",
      ageMs: 0,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("blocks rebuild when an active manual sync exists for the same wallet and chain", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "REBUILD",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-sync-1",
          trigger: "MANUAL",
          status: "RUNNING",
          stage: "PERSISTING_LEDGER",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T12:00:00.000Z"),
          updatedAt: new Date("2026-05-08T12:01:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T12:01:00.000Z"),
    });

    expect(result).toEqual({
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
    });
  });

  it("allows an operation when only completed or failed runs exist", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "REBUILD",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-completed",
          trigger: "REBUILD",
          status: "COMPLETED",
          stage: "COMPLETED",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T09:00:00.000Z"),
          updatedAt: new Date("2026-05-08T09:05:00.000Z"),
        },
        {
          id: "run-failed",
          trigger: "MANUAL",
          status: "FAILED",
          stage: "INGESTING_RAW_LOGS",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T09:10:00.000Z"),
          updatedAt: new Date("2026-05-08T09:11:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(result).toEqual({ allowed: true });
  });

  it("marks a fresh pending blocker as not stale", () => {
    const result = inspectOperationBlocker(
      {
        id: "run-pending-fresh",
        trigger: "REBUILD",
        status: "PENDING",
        stage: "PENDING",
        chainId: 369,
        walletId: "wallet-1",
        createdAt: new Date("2026-05-08T10:00:00.000Z"),
        updatedAt: new Date("2026-05-08T10:01:00.000Z"),
      },
      {
        now: new Date("2026-05-08T10:10:00.000Z"),
        thresholds: {
          pendingMs: 15 * 60 * 1000,
          runningMs: 60 * 60 * 1000,
        },
      },
    );

    expect(result).toMatchObject({
      status: "PENDING",
      operationType: "rebuild",
      ageMs: 600000,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("marks a stale pending blocker explicitly", () => {
    const result = inspectOperationBlocker(
      {
        id: "run-pending-stale",
        trigger: "REBUILD",
        status: "PENDING",
        stage: "PENDING",
        chainId: 369,
        walletId: "wallet-1",
        createdAt: new Date("2026-05-08T10:00:00.000Z"),
        updatedAt: new Date("2026-05-08T10:02:00.000Z"),
      },
      {
        now: new Date("2026-05-08T10:20:00.000Z"),
        thresholds: {
          pendingMs: 15 * 60 * 1000,
          runningMs: 60 * 60 * 1000,
        },
      },
    );

    expect(result).toMatchObject({
      status: "PENDING",
      ageMs: 1200000,
      appearsStale: true,
      staleReason: "pending_threshold_exceeded",
    });
  });

  it("marks a fresh running blocker as not stale", () => {
    const result = inspectOperationBlocker(
      {
        id: "run-running-fresh",
        trigger: "MANUAL",
        status: "RUNNING",
        stage: "PERSISTING_LEDGER",
        chainId: 369,
        walletId: "wallet-1",
        createdAt: new Date("2026-05-08T10:00:00.000Z"),
        updatedAt: new Date("2026-05-08T10:30:00.000Z"),
      },
      {
        now: new Date("2026-05-08T10:45:00.000Z"),
        thresholds: {
          pendingMs: 15 * 60 * 1000,
          runningMs: 60 * 60 * 1000,
        },
      },
    );

    expect(result).toMatchObject({
      status: "RUNNING",
      operationType: "manual_sync",
      ageMs: 2700000,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("marks a stale running blocker explicitly", () => {
    const result = inspectOperationBlocker(
      {
        id: "run-running-stale",
        trigger: "MANUAL",
        status: "RUNNING",
        stage: "PERSISTING_LEDGER",
        chainId: 369,
        walletId: "wallet-1",
        createdAt: new Date("2026-05-08T10:00:00.000Z"),
        updatedAt: new Date("2026-05-08T10:30:00.000Z"),
      },
      {
        now: new Date("2026-05-08T11:45:01.000Z"),
        thresholds: {
          pendingMs: 15 * 60 * 1000,
          runningMs: 60 * 60 * 1000,
        },
      },
    );

    expect(result).toMatchObject({
      status: "RUNNING",
      ageMs: 6301000,
      appearsStale: true,
      staleReason: "running_threshold_exceeded",
    });
  });

  it("converts a conflict result into a typed conflict error", () => {
    const error = new OperationConflictError({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-3",
      conflictingTrigger: "REBUILD",
      conflictingStage: "REBUILDING_LEDGER",
      operationType: "rebuild",
      status: "RUNNING",
      startedAt: "2026-05-08T13:00:00.000Z",
      createdAt: "2026-05-08T13:00:00.000Z",
      updatedAt: "2026-05-08T13:01:00.000Z",
      ageMs: 60000,
      appearsStale: false,
      staleReason: null,
    });

    expect(error.code).toBe("OPERATION_CONFLICT");
    expect(error.message).toBe("A conflicting operation is already active.");
    expect(error.details.reason).toBe("active_rebuild_in_progress");
  });

  it("rejects malformed conflict-like errors in the type guard", () => {
    expect(
      isOperationConflictError({
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: null,
      }),
    ).toBe(false);

    expect(
      isOperationConflictError({
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: {
          allowed: false,
        },
      }),
    ).toBe(false);
  });
});

describe("reserveOperationRun", () => {
  it("converts a serializable P2034 race into OperationConflictError after conflict recheck", async () => {
    const db = {
      $transaction: async () => {
        const error = new Error("serialization failure") as Error & { code: string };
        error.code = "P2034";
        throw error;
      },
      syncRun: {
        findMany: async () => [
          {
            id: "run-rebuild-race",
            trigger: "REBUILD",
            status: "RUNNING",
            stage: "REBUILDING_LEDGER",
            chainId: 369,
            walletId: "wallet-1",
            createdAt: new Date("2026-05-08T14:00:00.000Z"),
            updatedAt: new Date("2026-05-08T14:00:01.000Z"),
          },
        ],
      },
    } as never;

    await expect(
      reserveOperationRun({
        walletId: "wallet-1",
        chainId: 369,
        trigger: "MANUAL",
        status: "PENDING",
        stage: "PENDING",
        sourceFamilies: ["TRANSFERS"],
        startBlock: 100n,
        endBlock: 200n,
        policyLabel: "manual-dashboard-sync",
        db,
        now: new Date("2026-05-08T14:10:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
      details: expect.objectContaining({
        reason: "active_rebuild_in_progress",
        conflictingOperationId: "run-rebuild-race",
        appearsStale: false,
      }),
    });
  });

  it("does not blindly convert P2034 to conflict when recheck finds no active operation", async () => {
    let attempts = 0;
    const create = async () => ({ id: "run-created-after-retry" });
    const db = {
      $transaction: async (callback: (tx: { syncRun: { findMany: () => Promise<never[]>; create: typeof create } }) => Promise<{ id: string }>) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("serialization failure") as Error & { code: string };
          error.code = "P2034";
          throw error;
        }

        return callback({
          syncRun: {
            findMany: async () => [],
            create,
          },
        });
      },
      syncRun: {
        findMany: async () => [],
      },
    } as never;

    const result = await reserveOperationRun({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "REBUILD",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: ["TRANSFERS"],
      startBlock: 100n,
      endBlock: 200n,
      policyLabel: "manual-rebuild",
      db,
      now: new Date("2026-05-08T14:10:00.000Z"),
    });

    expect(result).toEqual({ id: "run-created-after-retry" });
    expect(attempts).toBe(2);
  });
});
