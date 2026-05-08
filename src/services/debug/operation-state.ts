import "server-only";

import type { SourceFamily, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";

export type OperationType =
  | "manual_sync"
  | "rebuild"
  | "health_check"
  | "dashboard_refresh"
  | "unknown";

export type OperationStatus =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "partial"
  | "stale"
  | "rebuilding"
  | "unknown";

export type OperationState = {
  operationId: string;
  operationType: OperationType;
  status: OperationStatus;
  chainId: number;
  walletId: string | null;
  walletAddress: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  currentStage: string | null;
  warningCount: number;
  errorMessage: string | null;
  sourceFamilies: SourceFamily[] | null;
  provenance: {
    trigger: SyncTrigger | "UNKNOWN";
    policyLabel: string | null;
  };
};

export type OperationStateReport = {
  updatedAt: string;
  operations: OperationState[];
  lastSuccessfulSyncAt: string | null;
  lastRebuildAt: string | null;
  warnings: string[];
};

type SyncRunOperationRecord = {
  id: string;
  trigger: SyncTrigger | string;
  status: SyncRunStatus | string;
  stage: string;
  chainId: number;
  walletId: string | null;
  wallet: {
    address: string;
  } | null;
  warningCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  sourceFamilies?: SourceFamily[];
  policyLabel?: string | null;
};

type OperationStateDependencies = {
  now?: Date;
  listSyncRuns?: () => Promise<SyncRunOperationRecord[]>;
};

export async function getOperationStateReport(
  dependencies: OperationStateDependencies = {},
): Promise<OperationStateReport> {
  const now = dependencies.now ?? new Date();
  const listSyncRuns =
    dependencies.listSyncRuns ??
    (async () =>
      getDb().syncRun.findMany({
        orderBy: [{ createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          trigger: true,
          status: true,
          stage: true,
          chainId: true,
          walletId: true,
          wallet: {
            select: {
              address: true,
            },
          },
          warningCount: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          sourceFamilies: true,
          policyLabel: true,
        },
      }));

  const syncRuns = await listSyncRuns();
  const operations = syncRuns
    .map((syncRun) => mapSyncRunToOperationState(syncRun, now))
    .sort(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );

  const lastSuccessfulSyncAt = syncRuns
    .map((syncRun) => mapSyncRunToOperationState(syncRun, now))
    .filter(
      (operation) =>
        operation.operationType === "manual_sync" &&
        (operation.status === "succeeded" || operation.status === "partial") &&
        operation.finishedAt,
    )
    .sort((left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!))[0]
    ?.finishedAt ?? null;

  const lastRebuildAt = syncRuns
    .map((syncRun) => mapSyncRunToOperationState(syncRun, now))
    .filter(
      (operation) =>
        operation.operationType === "rebuild" &&
        (operation.status === "succeeded" ||
          operation.status === "partial" ||
          operation.status === "rebuilding") &&
        (operation.finishedAt ?? operation.startedAt),
    )
    .sort(
      (left, right) =>
        Date.parse(right.finishedAt ?? right.startedAt) -
        Date.parse(left.finishedAt ?? left.startedAt),
    )[0]?.finishedAt ?? null;

  const warnings =
    lastRebuildAt === null
      ? [
          "rebuild operations are not persisted separately yet; lastRebuildAt may be unavailable",
        ]
      : [];

  return {
    updatedAt: now.toISOString(),
    operations,
    lastSuccessfulSyncAt,
    lastRebuildAt,
    warnings,
  };
}

export function mapSyncRunToOperationState(
  syncRun: SyncRunOperationRecord,
  now = new Date(),
): OperationState {
  const operationType = mapOperationType(syncRun.trigger);
  const terminal = syncRun.status === "COMPLETED" || syncRun.status === "FAILED";
  const finishedAt = terminal ? syncRun.updatedAt.toISOString() : null;
  const durationMs = Math.max(
    0,
    (terminal ? syncRun.updatedAt : now).getTime() - syncRun.createdAt.getTime(),
  );

  return {
    operationId: syncRun.id,
    operationType,
    status: mapOperationStatus({
      operationType,
      status: syncRun.status,
      warningCount: syncRun.warningCount,
    }),
    chainId: syncRun.chainId,
    walletId: syncRun.walletId,
    walletAddress: syncRun.wallet?.address ?? null,
    startedAt: syncRun.createdAt.toISOString(),
    finishedAt,
    durationMs,
    currentStage: syncRun.stage || null,
    warningCount: syncRun.warningCount,
    errorMessage: syncRun.errorMessage,
    sourceFamilies: syncRun.sourceFamilies ?? null,
    provenance: {
      trigger: isKnownTrigger(syncRun.trigger) ? syncRun.trigger : "UNKNOWN",
      policyLabel: syncRun.policyLabel ?? null,
    },
  };
}

function mapOperationType(trigger: SyncTrigger | string): OperationType {
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

function mapOperationStatus(args: {
  operationType: OperationType;
  status: SyncRunStatus | string;
  warningCount: number;
}): OperationStatus {
  switch (args.status) {
    case "PENDING":
      return "queued";
    case "RUNNING":
      return args.operationType === "rebuild" ? "rebuilding" : "running";
    case "FAILED":
      return "failed";
    case "COMPLETED":
      return args.warningCount > 0 ? "partial" : "succeeded";
    default:
      return "unknown";
  }
}

function isKnownTrigger(value: string): value is SyncTrigger {
  return value === "MANUAL" || value === "IMPORT" || value === "REBUILD";
}
