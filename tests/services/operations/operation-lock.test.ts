import { describe, expect, it } from "vitest";

import {
  checkOperationConflict,
  OperationConflictError,
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
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-1",
      conflictingTrigger: "REBUILD",
      conflictingStage: "REBUILDING_LEDGER",
      startedAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:02:00.000Z",
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
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-2",
      conflictingTrigger: "REBUILD",
      conflictingStage: "PENDING",
      startedAt: "2026-05-08T11:00:00.000Z",
      updatedAt: "2026-05-08T11:00:00.000Z",
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
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_sync_in_scope",
      conflictingOperationId: "run-sync-1",
      conflictingTrigger: "MANUAL",
      conflictingStage: "PERSISTING_LEDGER",
      startedAt: "2026-05-08T12:00:00.000Z",
      updatedAt: "2026-05-08T12:01:00.000Z",
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
    });

    expect(result).toEqual({ allowed: true });
  });

  it("converts a conflict result into a typed conflict error", () => {
    const error = new OperationConflictError({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-3",
      conflictingTrigger: "REBUILD",
      conflictingStage: "REBUILDING_LEDGER",
      startedAt: "2026-05-08T13:00:00.000Z",
      updatedAt: "2026-05-08T13:01:00.000Z",
    });

    expect(error.code).toBe("OPERATION_CONFLICT");
    expect(error.message).toBe("A conflicting operation is already active.");
    expect(error.details.reason).toBe("active_rebuild_in_progress");
  });
});
