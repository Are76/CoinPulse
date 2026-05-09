import "server-only";

import type { SourceFamily, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";
import {
  inspectOperationBlocker,
  type OperationStaleReason,
} from "@/services/operations/operation-lock";
import { buildNativeTransactionScanWindows } from "@/services/sync/sync-common";

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
  staleInspection: {
    ageMs: number;
    appearsStale: boolean;
    staleReason: OperationStaleReason | null;
  } | null;
};

export type OperationStateReport = {
  updatedAt: string;
  operations: OperationState[];
  blockerSummary: {
    activeBlockerCount: number;
    staleBlockerCount: number;
    pendingBlockerCount: number;
    runningBlockerCount: number;
    oldestBlockerAgeMs: number | null;
    newestBlockerAgeMs: number | null;
    hasStaleBlockers: boolean;
    blockersByOperationType: Partial<Record<OperationType, number>>;
  };
  ingestionDiagnostics: TransferIngestionDiagnostic[];
  lastSuccessfulSyncAt: string | null;
  lastRebuildAt: string | null;
  warnings: string[];
};

export type TransferIngestionDiagnostic = {
  operationId: string;
  walletId: string | null;
  walletAddress: string | null;
  chainId: number;
  sourceFamily: "TRANSFERS";
  requestedFromBlock: string | null;
  requestedToBlock: string | null;
  rangeStatus: "exact" | "unavailable";
  rangeWarning: string | null;
  nativeScanWindowCount: number;
  nativeScanWindows: Array<{
    fromBlock: string;
    toBlock: string;
  }>;
  rawBlocksPersistedCount: number | null;
  rawTransactionsPersistedCount: number | null;
  rawLogsPersistedCount: number | null;
  warningCount: number;
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
  startBlock?: bigint | null;
  endBlock?: bigint | null;
  failedSourceFamily?: SourceFamily | null;
  failedFromBlock?: bigint | null;
  failedToBlock?: bigint | null;
};

type OperationStateDependencies = {
  now?: Date;
  listSyncRuns?: () => Promise<SyncRunOperationRecord[]>;
  getLastSuccessfulSyncRun?: () => Promise<SyncRunOperationRecord | null>;
  getLastRebuildRun?: () => Promise<SyncRunOperationRecord | null>;
  getTransferIngestionCounts?: (args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<{
    rawBlocksPersistedCount: number;
    rawTransactionsPersistedCount: number;
    rawLogsPersistedCount: number;
  }>;
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
          startBlock: true,
          endBlock: true,
          failedSourceFamily: true,
          failedFromBlock: true,
          failedToBlock: true,
        },
      }));
  const getLastSuccessfulSyncRun =
    dependencies.getLastSuccessfulSyncRun ??
    (async () =>
      getDb().syncRun.findFirst({
        where: {
          trigger: {
            in: ["MANUAL", "IMPORT"],
          },
          status: "COMPLETED",
        },
        orderBy: [{ updatedAt: "desc" }],
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
          startBlock: true,
          endBlock: true,
          failedSourceFamily: true,
          failedFromBlock: true,
          failedToBlock: true,
        },
      }));
  const getLastRebuildRun =
    dependencies.getLastRebuildRun ??
    (async () =>
      getDb().syncRun.findFirst({
        where: {
          trigger: "REBUILD",
          status: {
            in: ["RUNNING", "COMPLETED"],
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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
          startBlock: true,
          endBlock: true,
          failedSourceFamily: true,
          failedFromBlock: true,
          failedToBlock: true,
        },
      }));
  const getTransferIngestionCounts =
    dependencies.getTransferIngestionCounts ??
    (async (args: {
      chainId: number;
      walletAddress: string;
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      const walletAddress = args.walletAddress.toLowerCase();
      const [rawBlocksPersistedCount, rawTransactionsPersistedCount, rawLogsPersistedCount] =
        await Promise.all([
          getDb().rawBlock.count({
            where: {
              chainId: args.chainId,
              status: "ACTIVE",
              blockNumber: {
                gte: args.fromBlock,
                lte: args.toBlock,
              },
            },
          }),
          getDb().rawTransaction.count({
            where: {
              chainId: args.chainId,
              status: "ACTIVE",
              blockNumber: {
                gte: args.fromBlock,
                lte: args.toBlock,
              },
              OR: [{ fromAddress: walletAddress }, { toAddress: walletAddress }],
            },
          }),
          getDb().rawLog.count({
            where: {
              chainId: args.chainId,
              status: "ACTIVE",
              blockNumber: {
                gte: args.fromBlock,
                lte: args.toBlock,
              },
              topic0:
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              OR: [
                {
                  topic1: `0x000000000000000000000000${walletAddress.replace(/^0x/, "")}`,
                },
                {
                  topic2: `0x000000000000000000000000${walletAddress.replace(/^0x/, "")}`,
                },
              ],
            },
          }),
        ]);

      return {
        rawBlocksPersistedCount,
        rawTransactionsPersistedCount,
        rawLogsPersistedCount,
      };
    });

  const syncRuns = await listSyncRuns();
  const [lastSuccessfulSyncRun, lastRebuildRun] = await Promise.all([
    getLastSuccessfulSyncRun(),
    getLastRebuildRun(),
  ]);
  const operations = syncRuns
    .map((syncRun) => mapSyncRunToOperationState(syncRun, now))
    .sort(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );
  const ingestionDiagnostics = (
    await Promise.all(
      syncRuns.map(async (syncRun) =>
        projectTransferIngestionDiagnostic(syncRun, getTransferIngestionCounts),
      ),
    )
  ).filter((diagnostic): diagnostic is TransferIngestionDiagnostic => diagnostic !== null);

  const lastSuccessfulSyncAt = lastSuccessfulSyncRun
    ? mapSyncRunToOperationState(lastSuccessfulSyncRun, now).finishedAt
    : null;

  const lastRebuildOperation = lastRebuildRun
    ? mapSyncRunToOperationState(lastRebuildRun, now)
    : null;
  const lastRebuildAt = lastRebuildOperation
    ? lastRebuildOperation.finishedAt ?? lastRebuildOperation.startedAt
    : null;

  const warnings =
    lastRebuildAt === null
      ? [
          "rebuild operations are not persisted separately yet; lastRebuildAt may be unavailable",
        ]
      : [];

  return {
    updatedAt: now.toISOString(),
    operations,
    blockerSummary: summarizeOperationBlockers(operations),
    ingestionDiagnostics,
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
    staleInspection:
      syncRun.status === "PENDING" || syncRun.status === "RUNNING"
        ? (() => {
            const inspection = inspectOperationBlocker(syncRun, { now });
            return {
              ageMs: inspection.ageMs,
              appearsStale: inspection.appearsStale,
              staleReason: inspection.staleReason,
            };
          })()
        : null,
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

function summarizeOperationBlockers(
  operations: OperationState[],
): OperationStateReport["blockerSummary"] {
  const blockers = operations.filter(
    (operation) =>
      operation.staleInspection !== null &&
      (operation.status === "queued" ||
        operation.status === "running" ||
        operation.status === "rebuilding"),
  );

  const ageValues = blockers.map(
    (blocker) => blocker.staleInspection?.ageMs ?? 0,
  );
  const blockersByOperationType = blockers.reduce<
    Partial<Record<OperationType, number>>
  >((accumulator, blocker) => {
    accumulator[blocker.operationType] =
      (accumulator[blocker.operationType] ?? 0) + 1;
    return accumulator;
  }, {});

  const pendingBlockerCount = blockers.filter(
    (blocker) => blocker.status === "queued",
  ).length;
  const runningBlockerCount = blockers.filter(
    (blocker) =>
      blocker.status === "running" || blocker.status === "rebuilding",
  ).length;
  const staleBlockerCount = blockers.filter(
    (blocker) => blocker.staleInspection?.appearsStale === true,
  ).length;

  return {
    activeBlockerCount: blockers.length,
    staleBlockerCount,
    pendingBlockerCount,
    runningBlockerCount,
    oldestBlockerAgeMs: ageValues.length > 0 ? Math.max(...ageValues) : null,
    newestBlockerAgeMs: ageValues.length > 0 ? Math.min(...ageValues) : null,
    hasStaleBlockers: staleBlockerCount > 0,
    blockersByOperationType,
  };
}

async function projectTransferIngestionDiagnostic(
  syncRun: SyncRunOperationRecord,
  getTransferIngestionCounts: NonNullable<
    OperationStateDependencies["getTransferIngestionCounts"]
  >,
): Promise<TransferIngestionDiagnostic | null> {
  if (!syncRun.sourceFamilies?.includes("TRANSFERS") || !syncRun.wallet?.address) {
    return null;
  }

  const range = deriveTransferDiagnosticRange(syncRun);

  if (!range) {
    return {
      operationId: syncRun.id,
      walletId: syncRun.walletId,
      walletAddress: syncRun.wallet.address,
      chainId: syncRun.chainId,
      sourceFamily: "TRANSFERS",
      requestedFromBlock: null,
      requestedToBlock: null,
      rangeStatus: "unavailable",
      rangeWarning:
        "TRANSFERS-specific requested range is not persisted for this multi-family run",
      nativeScanWindowCount: 0,
      nativeScanWindows: [],
      rawBlocksPersistedCount: null,
      rawTransactionsPersistedCount: null,
      rawLogsPersistedCount: null,
      warningCount: syncRun.warningCount,
    };
  }

  const hasEmptyRange = range.fromBlock > range.toBlock;
  const counts = hasEmptyRange
    ? {
        rawBlocksPersistedCount: 0,
        rawTransactionsPersistedCount: 0,
        rawLogsPersistedCount: 0,
      }
    : await getTransferIngestionCounts({
        chainId: syncRun.chainId,
        walletAddress: syncRun.wallet.address,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      });
  const nativeScanWindows = hasEmptyRange
    ? []
    : buildNativeTransactionScanWindows({
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        maxWindowSize: 2_000n,
      });

  return {
    operationId: syncRun.id,
    walletId: syncRun.walletId,
    walletAddress: syncRun.wallet.address,
    chainId: syncRun.chainId,
    sourceFamily: "TRANSFERS",
    requestedFromBlock: range.fromBlock.toString(),
    requestedToBlock: range.toBlock.toString(),
    rangeStatus: "exact",
    rangeWarning: null,
    nativeScanWindowCount: nativeScanWindows.length,
    nativeScanWindows: nativeScanWindows.map((window) => ({
      fromBlock: window.fromBlock.toString(),
      toBlock: window.toBlock.toString(),
    })),
    rawBlocksPersistedCount: counts.rawBlocksPersistedCount,
    rawTransactionsPersistedCount: counts.rawTransactionsPersistedCount,
    rawLogsPersistedCount: counts.rawLogsPersistedCount,
    warningCount: syncRun.warningCount,
  };
}

function deriveTransferDiagnosticRange(syncRun: SyncRunOperationRecord) {
  if (
    syncRun.sourceFamilies?.length === 1 &&
    syncRun.sourceFamilies[0] === "TRANSFERS" &&
    typeof syncRun.startBlock === "bigint" &&
    typeof syncRun.endBlock === "bigint"
  ) {
    return {
      fromBlock: syncRun.startBlock,
      toBlock: syncRun.endBlock,
    };
  }

  if (
    syncRun.failedSourceFamily === "TRANSFERS" &&
    typeof syncRun.failedFromBlock === "bigint" &&
    typeof syncRun.failedToBlock === "bigint"
  ) {
    return {
      fromBlock: syncRun.failedFromBlock,
      toBlock: syncRun.failedToBlock,
    };
  }

  return null;
}
