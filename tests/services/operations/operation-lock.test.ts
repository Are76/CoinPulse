import { describe, expect, it } from "vitest";

import {
  checkOperationConflict,
  inspectOperationBlocker,
  isOperationConflictError,
  OperationConflictError,
  previewOperationConflict,
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

  it("blocks manual sync when an active manual sync exists for the same wallet and chain", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "MANUAL",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-sync-2",
          trigger: "MANUAL",
          status: "RUNNING",
          stage: "INGESTING_RAW_LOGS",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T12:10:00.000Z"),
          updatedAt: new Date("2026-05-08T12:11:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T12:11:00.000Z"),
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_sync_in_scope",
      conflictingOperationId: "run-sync-2",
      conflictingTrigger: "MANUAL",
      conflictingStage: "INGESTING_RAW_LOGS",
      operationType: "manual_sync",
      status: "RUNNING",
      startedAt: "2026-05-08T12:10:00.000Z",
      createdAt: "2026-05-08T12:10:00.000Z",
      updatedAt: "2026-05-08T12:11:00.000Z",
      ageMs: 60000,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("blocks import sync when an active manual sync exists for the same wallet and chain", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "IMPORT",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-sync-3",
          trigger: "MANUAL",
          status: "PENDING",
          stage: "PENDING",
          chainId: 369,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T12:20:00.000Z"),
          updatedAt: new Date("2026-05-08T12:20:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T12:20:00.000Z"),
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "active_sync_in_scope",
      conflictingOperationId: "run-sync-3",
      conflictingTrigger: "MANUAL",
      operationType: "manual_sync",
      status: "PENDING",
    });
  });

  it("allows manual sync when active sync is for another wallet or chain", async () => {
    const result = await checkOperationConflict({
      requestedOperation: {
        trigger: "MANUAL",
        walletId: "wallet-1",
        chainId: 369,
      },
      listActiveRuns: async () => [
        {
          id: "run-sync-other-wallet",
          trigger: "MANUAL",
          status: "RUNNING",
          stage: "INGESTING_RAW_LOGS",
          chainId: 369,
          walletId: "wallet-2",
          createdAt: new Date("2026-05-08T12:30:00.000Z"),
          updatedAt: new Date("2026-05-08T12:31:00.000Z"),
        },
        {
          id: "run-sync-other-chain",
          trigger: "IMPORT",
          status: "RUNNING",
          stage: "INGESTING_RAW_LOGS",
          chainId: 1,
          walletId: "wallet-1",
          createdAt: new Date("2026-05-08T12:30:00.000Z"),
          updatedAt: new Date("2026-05-08T12:31:00.000Z"),
        },
      ],
      now: new Date("2026-05-08T12:31:00.000Z"),
    });

    expect(result).toEqual({ allowed: true });
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
        now: new Date("2026-05-08T14:00:02.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
      details: {
        reason: "active_rebuild_in_progress",
        conflictingOperationId: "run-rebuild-race",
      },
    });
  });

  it("throws OperationConflictError when an active scoped sync already exists", async () => {
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          syncRun: {
            findMany: async () => [
              {
                id: "run-scoped-sync-race",
                trigger: "MANUAL",
                status: "RUNNING",
                stage: "INGESTING_RAW_LOGS",
                chainId: 369,
                walletId: "wallet-1",
                createdAt: new Date("2026-05-08T14:05:00.000Z"),
                updatedAt: new Date("2026-05-08T14:05:01.000Z"),
              },
            ],
            create: async () => ({ id: "should-not-create" }),
          },
        }),
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
        now: new Date("2026-05-08T14:05:02.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
      details: {
        reason: "active_sync_in_scope",
        conflictingOperationId: "run-scoped-sync-race",
      },
    });
  });

  it("creates a sync run when no conflicts are found", async () => {
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          syncRun: {
            findMany: async () => [],
            create: async () => ({ id: "run-created" }),
          },
        }),
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
        now: new Date("2026-05-08T15:00:00.000Z"),
      }),
    ).resolves.toEqual({ id: "run-created" });
  });
});

describe("previewOperationConflict", () => {
  it("reports allowed: true and performs no mutation when no conflicting run exists", async () => {
    const findMany = async () => [];
    const create = async () => {
      throw new Error("previewOperationConflict must never call create()");
    };
    const db = { syncRun: { findMany, create } } as never;

    const result = await previewOperationConflict({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "MANUAL",
      db,
      now: new Date("2026-05-08T16:00:00.000Z"),
    });

    expect(result).toEqual({ allowed: true });
  });

  it("reports the conflicting run's details without reserving anything", async () => {
    const create = async () => {
      throw new Error("previewOperationConflict must never call create()");
    };
    const db = {
      syncRun: {
        findMany: async () => [
          {
            id: "run-rebuild-preview",
            trigger: "REBUILD",
            status: "RUNNING",
            stage: "REBUILDING_LEDGER",
            chainId: 369,
            walletId: "wallet-1",
            createdAt: new Date("2026-05-08T16:00:00.000Z"),
            updatedAt: new Date("2026-05-08T16:01:00.000Z"),
          },
        ],
        create,
      },
    } as never;

    const result = await previewOperationConflict({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "MANUAL",
      db,
      now: new Date("2026-05-08T16:01:00.000Z"),
    });

    expect(result).toEqual({
      allowed: false,
      reason: "active_rebuild_in_progress",
      conflictingOperationId: "run-rebuild-preview",
      conflictingTrigger: "REBUILD",
      conflictingStage: "REBUILDING_LEDGER",
      operationType: "rebuild",
      status: "RUNNING",
      startedAt: "2026-05-08T16:00:00.000Z",
      createdAt: "2026-05-08T16:00:00.000Z",
      updatedAt: "2026-05-08T16:01:00.000Z",
      ageMs: 60000,
      appearsStale: false,
      staleReason: null,
    });
  });

  it("scopes the underlying findMany query to the exact requested wallet, chain, and trigger", async () => {
    let capturedWhere: unknown;
    const create = async () => {
      throw new Error("previewOperationConflict must never call create()");
    };
    const db = {
      syncRun: {
        findMany: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return [];
        },
        create,
      },
    } as never;

    await previewOperationConflict({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "MANUAL",
      db,
      now: new Date("2026-05-08T16:05:00.000Z"),
    });

    // This is the exact contract a chain-wide regression would break: the
    // MANUAL/IMPORT branch of the OR clause must carry the requested
    // walletId and chainId, not just the trigger set.
    expect(capturedWhere).toEqual({
      status: { in: ["PENDING", "RUNNING"] },
      OR: [
        { trigger: "REBUILD" },
        {
          trigger: { in: ["MANUAL", "IMPORT"] },
          walletId: "wallet-1",
          chainId: 369,
        },
      ],
    });
  });

  it("reports a conflict for an active MANUAL run belonging to the SAME wallet+chain (positive control)", async () => {
    const create = async () => {
      throw new Error("previewOperationConflict must never call create()");
    };
    const SAME_WALLET_RUN = {
      id: "run-same-wallet",
      trigger: "MANUAL",
      status: "RUNNING",
      stage: "INGESTING_RAW_LOGS",
      chainId: 369,
      walletId: "wallet-1",
      createdAt: new Date("2026-05-08T16:00:00.000Z"),
      updatedAt: new Date("2026-05-08T16:04:00.000Z"),
    };
    const db = {
      syncRun: {
        // Simulates real Prisma filtering behavior for the where clause
        // previewOperationConflict actually sends (asserted in the test
        // above): only rows matching walletId+chainId (for MANUAL/IMPORT)
        // or trigger === REBUILD are returned.
        findMany: async ({
          where,
        }: {
          where: { OR: Array<{ trigger: string; walletId?: string; chainId?: number }> };
        }) => {
          const scopedClause = where.OR.find((clause) => "walletId" in clause);
          if (
            scopedClause &&
            SAME_WALLET_RUN.walletId === scopedClause.walletId &&
            SAME_WALLET_RUN.chainId === scopedClause.chainId
          ) {
            return [SAME_WALLET_RUN];
          }
          return [];
        },
        create,
      },
    } as never;

    const result = await previewOperationConflict({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "MANUAL",
      db,
      now: new Date("2026-05-08T16:05:00.000Z"),
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "active_sync_in_scope",
      conflictingOperationId: "run-same-wallet",
    });
  });

  it("does not report a conflict from another wallet's active run in the same chain (negative control)", async () => {
    const create = async () => {
      throw new Error("previewOperationConflict must never call create()");
    };
    const OTHER_WALLET_RUN = {
      id: "run-other-wallet",
      trigger: "MANUAL",
      status: "RUNNING",
      stage: "INGESTING_RAW_LOGS",
      chainId: 369,
      walletId: "wallet-other",
      createdAt: new Date("2026-05-08T16:00:00.000Z"),
      updatedAt: new Date("2026-05-08T16:04:00.000Z"),
    };
    const db = {
      syncRun: {
        // Same realistic filtering simulation as the positive-control test
        // above — proves the SAME mock logic excludes a different wallet's
        // run rather than merely never having one to exclude.
        findMany: async ({
          where,
        }: {
          where: { OR: Array<{ trigger: string; walletId?: string; chainId?: number }> };
        }) => {
          const scopedClause = where.OR.find((clause) => "walletId" in clause);
          if (
            scopedClause &&
            OTHER_WALLET_RUN.walletId === scopedClause.walletId &&
            OTHER_WALLET_RUN.chainId === scopedClause.chainId
          ) {
            return [OTHER_WALLET_RUN];
          }
          return [];
        },
        create,
      },
    } as never;

    const result = await previewOperationConflict({
      walletId: "wallet-1",
      chainId: 369,
      trigger: "MANUAL",
      db,
      now: new Date("2026-05-08T16:05:00.000Z"),
    });

    expect(result).toEqual({ allowed: true });
  });
});
