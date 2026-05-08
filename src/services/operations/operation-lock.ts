import "server-only";

import { Prisma } from "@prisma/client";
import type { PrismaClient, SourceFamily, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";

const ACTIVE_SYNC_RUN_STATUSES = ["PENDING", "RUNNING"] as const satisfies readonly SyncRunStatus[];
const SYNC_LIKE_TRIGGERS = ["MANUAL", "IMPORT"] as const satisfies readonly SyncTrigger[];

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

export type OperationStaleThresholds = {
  pendingMs: number;
  runningMs: number;
};

export const DEFAULT_OPERATION_STALE_THRESHOLDS: OperationStaleThresholds = {
  pendingMs: 15 * 60 * 1000,
  runningMs: 60 * 60 * 1000,
};

export type OperationStaleReason =
  | "pending_threshold_exceeded"
  | "running_threshold_exceeded";

export type OperationConflictDetails = {
  allowed: false;
  reason: "active_rebuild_in_progress" | "active_sync_in_scope";
  conflictingOperationId: string;
  conflictingTrigger: SyncTrigger | string;
  conflictingStage: string | null;
  operationType: "manual_sync" | "rebuild" | "unknown";
  status: SyncRunStatus | string;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  ageMs: number;
  appearsStale: boolean;
  staleReason: OperationStaleReason | null;
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
  now?: Date;
  thresholds?: OperationStaleThresholds;
}): Promise<OperationConflictResult> {
  const now = args.now ?? new Date();
  const activeRuns = (await args.listActiveRuns()).filter((run) =>
    isActiveStatus(run.status),
  );

  if (args.requestedOperation.trigger === "REBUILD") {
    const activeRebuild = activeRuns.find((run) => run.trigger === "REBUILD");
    if (activeRebuild) {
      return buildConflict(
        "active_rebuild_in_progress",
        activeRebuild,
        now,
        args.thresholds,
      );
    }

    const activeScopedSync = activeRuns.find(
      (run) =>
        isSyncLikeTrigger(run.trigger) &&
        run.walletId === args.requestedOperation.walletId &&
        run.chainId === args.requestedOperation.chainId,
    );
    if (activeScopedSync) {
      return buildConflict(
        "active_sync_in_scope",
        activeScopedSync,
        now,
        args.thresholds,
      );
    }
  }

  if (isSyncLikeTrigger(args.requestedOperation.trigger)) {
    const activeRebuild = activeRuns.find((run) => run.trigger === "REBUILD");
    if (activeRebuild) {
      return buildConflict(
        "active_rebuild_in_progress",
        activeRebuild,
        now,
        args.thresholds,
      );
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
  sourceFamilies: SourceFamily[];
  startBlock: bigint;
  endBlock: bigint;
  latestSafeBlock?: bigint;
  policyLabel: string;
  warningCount?: number;
  warningDetails?: readonly string[];
  errorMessage?: string;
  failedSourceFamily?: SourceFamily;
  failedFromBlock?: bigint;
  failedToBlock?: bigint;
  db?: PrismaClient;
  now?: Date;
  thresholds?: OperationStaleThresholds;
}): Promise<{ id: string }> {
  const db = args.db ?? getDb();
  const now = args.now ?? new Date();
  const requestedOperation = {
    trigger: args.trigger,
    walletId: args.walletId,
    chainId: args.chainId,
  } as const;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const conflict = await checkOperationConflict({
            requestedOperation,
            listActiveRuns: async () => listConflictingRuns(tx, requestedOperation),
            now,
            thresholds: args.thresholds,
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
    } catch (error) {
      if (!isSerializableRetryableConflict(error)) {
        throw error;
      }

      const conflict = await checkOperationConflict({
        requestedOperation,
        listActiveRuns: async () => listConflictingRuns(db, requestedOperation),
        now,
        thresholds: args.thresholds,
      });

      if (!conflict.allowed) {
        throw new OperationConflictError(conflict);
      }

      if (attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("unreachable");
}

export function inspectOperationBlocker(
  run: ActiveSyncRunRecord,
  options: {
    now?: Date;
    thresholds?: OperationStaleThresholds;
  } = {},
) {
  const now = options.now ?? new Date();
  const thresholds = options.thresholds ?? DEFAULT_OPERATION_STALE_THRESHOLDS;
  const ageMs = Math.max(0, now.getTime() - run.createdAt.getTime());
  const staleReason = getStaleReason(run.status, ageMs, thresholds);

  return {
    operationType: mapOperationType(run.trigger),
    status: run.status,
    startedAt: run.createdAt.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    ageMs,
    appearsStale: staleReason !== null,
    staleReason,
  };
}

export function isOperationConflictError(error: unknown): error is OperationConflictError | {
  code: "OPERATION_CONFLICT";
  message: string;
  details: OperationConflictDetails;
} {
  const details =
    typeof error === "object" &&
    error !== null &&
    "details" in error
      ? error.details
      : null;

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "OPERATION_CONFLICT" &&
    "message" in error &&
    typeof error.message === "string" &&
    typeof details === "object" &&
    details !== null &&
    "allowed" in details &&
    details.allowed === false &&
    "reason" in details &&
    typeof details.reason === "string"
  );
}

function buildConflict(
  reason: OperationConflictDetails["reason"],
  run: ActiveSyncRunRecord,
  now: Date,
  thresholds?: OperationStaleThresholds,
): OperationConflictDetails {
  const inspection = inspectOperationBlocker(run, { now, thresholds });
  return {
    allowed: false,
    reason,
    conflictingOperationId: run.id,
    conflictingTrigger: run.trigger,
    conflictingStage: run.stage || null,
    ...inspection,
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

async function listConflictingRuns(
  client: Pick<PrismaClient, "syncRun"> | Prisma.TransactionClient,
  requestedOperation: RequestedOperation,
) {
  return client.syncRun.findMany({
    where: buildConflictWhere(requestedOperation),
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
  });
}

function isSerializableRetryableConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

function getStaleReason(
  status: SyncRunStatus | string,
  ageMs: number,
  thresholds: OperationStaleThresholds,
): OperationStaleReason | null {
  if (status === "PENDING" && ageMs > thresholds.pendingMs) {
    return "pending_threshold_exceeded";
  }

  if (status === "RUNNING" && ageMs > thresholds.runningMs) {
    return "running_threshold_exceeded";
  }

  return null;
}

function mapOperationType(
  trigger: SyncTrigger | string,
): "manual_sync" | "rebuild" | "unknown" {
  switch (trigger) {
    case "MANUAL":
    case "IMPORT":
      return "manual_sync";
    case "REBUILD":
      return "rebuild";
    default:
      return "unknown";
  }
}

function isActiveStatus(status: SyncRunStatus | string): status is (typeof ACTIVE_SYNC_RUN_STATUSES)[number] {
  return ACTIVE_SYNC_RUN_STATUSES.includes(status as (typeof ACTIVE_SYNC_RUN_STATUSES)[number]);
}

function isSyncLikeTrigger(trigger: SyncTrigger | string): trigger is (typeof SYNC_LIKE_TRIGGERS)[number] {
  return SYNC_LIKE_TRIGGERS.includes(trigger as (typeof SYNC_LIKE_TRIGGERS)[number]);
}
