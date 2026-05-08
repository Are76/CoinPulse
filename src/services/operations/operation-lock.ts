import "server-only";

import { Prisma } from "@prisma/client";
import type { PrismaClient, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";

const ACTIVE_SYNC_RUN_STATUSES = ["PENDING", "RUNNING"] as const satisfies readonly SyncRunStatus[];
const SYNC_LIKE_TRIGGERS = ["MANUAL", "IMPORT"] as const satisfies readonly SyncTrigger[];

type OperationLockClient = PrismaClient | Prisma.TransactionClient;

type ActiveSyncRunRecord = {
  id: string;
  trigger: SyncTrigger | string;
  status: SyncRunStatus | string;
  stage: string;
  chainId: number;
  walletId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RequestedOperation = {
  trigger: SyncTrigger;
  walletId: string;
  chainId: number;
};

export type OperationConflictDetails = {
  allowed: false;
  reason: "active_rebuild_in_progress" | "active_sync_in_scope";
  conflictingOperationId: string;
  conflictingTrigger: SyncTrigger | string;
  conflictingStage: string | null;
  startedAt: string;
  updatedAt: string;
};

export type OperationConflictResult = { allowed: true } | OperationConflictDetails;

export class OperationConflictError extends Error {
  code = "OPERATION_CONFLICT" as const;
  details: OperationConflictDetails;

  constructor(details: OperationConflictDetails) {
    super("A conflicting operation is already active.");
    this.name = "OperationConflictError";
    this.details = details;
  }
}

export async function checkOperationConflict(args: {
  requestedOperation: RequestedOperation;
  listActiveRuns: () => Promise<ActiveSyncRunRecord[]>;
}): Promise<OperationConflictResult> {
  const activeRuns = (await args.listActiveRuns()).filter((run) =>
    isActiveStatus(run.status),
  );

  if (args.requestedOperation.trigger === "REBUILD") {
    const activeRebuild = activeRuns.find((run) => run.trigger === "REBUILD");
    if (activeRebuild) {
      return buildConflict("active_rebuild_in_progress", activeRebuild);
    }

    const activeScopedSync = activeRuns.find(
      (run) =>
        isSyncLikeTrigger(run.trigger) &&
        run.walletId === args.requestedOperation.walletId &&
        run.chainId === args.requestedOperation.chainId,
    );
    if (activeScopedSync) {
      return buildConflict("active_sync_in_scope", activeScopedSync);
    }
  }

  if (isSyncLikeTrigger(args.requestedOperation.trigger)) {
    const activeRebuild = activeRuns.find((run) => run.trigger === "REBUILD");
    if (activeRebuild) {
      return buildConflict("active_rebuild_in_progress", activeRebuild);
    }
  }

  return { allowed: true };
}

export async function reserveOperationRun(args: {
  walletId: string;
  chainId: number;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  stage: string;
  sourceFamilies: Parameters<OperationLockClient["syncRun"]["create"]>[0]["data"]["sourceFamilies"];
  startBlock: bigint;
  endBlock: bigint;
  latestSafeBlock?: bigint;
  policyLabel: string;
  warningCount?: number;
  warningDetails?: readonly string[];
  errorMessage?: string;
  failedSourceFamily?: Parameters<OperationLockClient["syncRun"]["create"]>[0]["data"]["failedSourceFamily"];
  failedFromBlock?: bigint;
  failedToBlock?: bigint;
  db?: OperationLockClient;
}): Promise<{ id: string }> {
  const db = args.db ?? getDb();

  return db.$transaction(
    async (tx) => {
      const conflict = await checkOperationConflict({
        requestedOperation: {
          trigger: args.trigger,
          walletId: args.walletId,
          chainId: args.chainId,
        },
        listActiveRuns: async () =>
          tx.syncRun.findMany({
            where: buildConflictWhere({
              trigger: args.trigger,
              walletId: args.walletId,
              chainId: args.chainId,
            }),
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              trigger: true,
              status: true,
              stage: true,
              chainId: true,
              walletId: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
      });

      if (!conflict.allowed) {
        throw new OperationConflictError(conflict);
      }

      return tx.syncRun.create({
        data: {
          walletId: args.walletId,
          chainId: args.chainId,
          trigger: args.trigger,
          status: args.status,
          stage: args.stage,
          sourceFamilies: args.sourceFamilies,
          startBlock: args.startBlock,
          endBlock: args.endBlock,
          latestSafeBlock: args.latestSafeBlock,
          policyLabel: args.policyLabel,
          warningCount: args.warningCount ?? 0,
          warningDetails: args.warningDetails ?? [],
          errorMessage: args.errorMessage ?? null,
          failedSourceFamily: args.failedSourceFamily ?? null,
          failedFromBlock: args.failedFromBlock ?? null,
          failedToBlock: args.failedToBlock ?? null,
        },
        select: {
          id: true,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export function isOperationConflictError(error: unknown): error is OperationConflictError | {
  code: "OPERATION_CONFLICT";
  message: string;
  details: OperationConflictDetails;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "OPERATION_CONFLICT" &&
    "message" in error &&
    typeof error.message === "string" &&
    "details" in error
  );
}

function buildConflict(
  reason: OperationConflictDetails["reason"],
  run: ActiveSyncRunRecord,
): OperationConflictDetails {
  return {
    allowed: false,
    reason,
    conflictingOperationId: run.id,
    conflictingTrigger: run.trigger,
    conflictingStage: run.stage || null,
    startedAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function buildConflictWhere(requestedOperation: RequestedOperation): Prisma.SyncRunWhereInput {
  if (requestedOperation.trigger === "REBUILD") {
    return {
      status: { in: [...ACTIVE_SYNC_RUN_STATUSES] },
      OR: [
        { trigger: "REBUILD" },
        {
          trigger: { in: [...SYNC_LIKE_TRIGGERS] },
          walletId: requestedOperation.walletId,
          chainId: requestedOperation.chainId,
        },
      ],
    };
  }

  return {
    status: { in: [...ACTIVE_SYNC_RUN_STATUSES] },
    trigger: "REBUILD",
  };
}

function isActiveStatus(status: SyncRunStatus | string): status is (typeof ACTIVE_SYNC_RUN_STATUSES)[number] {
  return ACTIVE_SYNC_RUN_STATUSES.includes(status as (typeof ACTIVE_SYNC_RUN_STATUSES)[number]);
}

function isSyncLikeTrigger(trigger: SyncTrigger | string): trigger is (typeof SYNC_LIKE_TRIGGERS)[number] {
  return SYNC_LIKE_TRIGGERS.includes(trigger as (typeof SYNC_LIKE_TRIGGERS)[number]);
}
