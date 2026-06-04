import "server-only";

import { type SourceFamily, type SyncTrigger } from "@prisma/client";

import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { reserveOperationRun } from "@/services/operations/operation-lock";
import {
  createPrismaSyncCursorStore,
  createPrismaSyncRunStore,
  type SyncCursorRecord,
  type SyncCursorStore,
  type SyncRunStore,
} from "@/services/sync/sync-state-store";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";
import { classifySyncError } from "@/services/sync/sync-error-classifier";
import { createSyncDependencies } from "@/services/sync/transfer-sync";

export type SyncWallet = {
  id: string;
  chainId: number;
  address: string;
};

export type IngestSourceFamilyResult<TLog = unknown> = {
  rawLogCount: number;
  latestBlockHash: string | null;
  logs: readonly TLog[];
  fromBlock: bigint;
  toBlock: bigint;
  warnings: readonly string[];
};

type SyncRunDependencies<TLog = unknown> = {
  supportedSourceFamilies?: readonly SourceFamily[];
  runStore?: SyncRunStore;
  cursorStore?: SyncCursorStore;
  reserveOperationRun?: typeof reserveOperationRun;
  ingestSourceFamily: (args: {
    runId: string;
    wallet: SyncWallet;
    sourceFamily: SourceFamily;
    fromBlock: bigint;
    toBlock: bigint;
    cursor: SyncCursorRecord | null;
  }) => Promise<IngestSourceFamilyResult<TLog>>;
  normalizeSourceFamily: (args: {
    runId: string;
    wallet: SyncWallet;
    sourceFamily: SourceFamily;
    rawLogs: readonly TLog[];
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<readonly CanonicalLedgerEntryDraft[]>;
  persistLedger?: typeof persistNormalizedLedger;
};

export async function runWalletSync<TLog = unknown>(args: {
  wallet: SyncWallet;
  sourceFamilies: SourceFamily[];
  endBlock: bigint;
  startBlock?: bigint;
  policyLabel: string;
  trigger?: SyncTrigger;
  dependencies?: SyncRunDependencies<TLog>;
}) {
  const dependencies =
    args.dependencies ?? (createSyncDependencies() as unknown as SyncRunDependencies<TLog>);
  const unsupportedSourceFamilies = (dependencies.supportedSourceFamilies
    ? args.sourceFamilies.filter(
        (sourceFamily) =>
          !dependencies.supportedSourceFamilies?.includes(sourceFamily),
      )
    : []) as SourceFamily[];

  if (unsupportedSourceFamilies.length > 0) {
    throw new Error(
      `Unsupported source families for the current concrete sync path: ${unsupportedSourceFamilies.join(
        ", ",
      )}. Supported families: ${dependencies.supportedSourceFamilies?.join(", ") ?? "none"}.`,
    );
  }

  const runStore = dependencies.runStore ?? createPrismaSyncRunStore();
  const cursorStore = dependencies.cursorStore ?? createPrismaSyncCursorStore();
  const persistLedger = dependencies.persistLedger ?? persistNormalizedLedger;
  const reserveRun =
    dependencies.reserveOperationRun ??
    (dependencies.runStore
      ? async (input: Parameters<SyncRunStore["createRun"]>[0]) => runStore.createRun(input)
      : reserveOperationRun);

  const syncPlans = await Promise.all(
    args.sourceFamilies.map(async (sourceFamily) => {
      const cursor = await cursorStore.getCursor({
        walletId: args.wallet.id,
        chainId: args.wallet.chainId,
        sourceFamily,
      });

      return {
        sourceFamily,
        cursor,
        fromBlock:
          args.startBlock ?? (cursor ? cursor.toBlock + 1n : 0n),
      };
    }),
  );

  const run = await reserveRun({
    walletId: args.wallet.id,
    chainId: args.wallet.chainId,
    trigger: args.trigger ?? "MANUAL",
    status: "PENDING",
    stage: "PENDING",
    sourceFamilies: args.sourceFamilies,
    startBlock: minBlock(syncPlans.map((plan) => plan.fromBlock)),
    endBlock: args.endBlock,
    policyLabel: args.policyLabel,
  });

  let warningCount = 0;
  const warningDetails: string[] = [];
  let latestSafeBlock: bigint | undefined;
  let currentStage = "PENDING";
  let currentRange:
    | {
        sourceFamily: SourceFamily;
        fromBlock: bigint;
        toBlock: bigint;
      }
    | undefined;
  const counts = {
    rawLogs: 0,
    actionGroups: 0,
    ledgerEntries: 0,
  };

  try {
    for (const plan of syncPlans) {
      if (plan.fromBlock > args.endBlock) {
        latestSafeBlock = args.endBlock;
        continue;
      }

      currentRange = {
        sourceFamily: plan.sourceFamily,
        fromBlock: plan.fromBlock,
        toBlock: args.endBlock,
      };

      currentStage = "INGESTING_RAW_LOGS";
      await runStore.updateRun({
        runId: run.id,
        status: "RUNNING",
        stage: currentStage,
        latestSafeBlock,
        warningCount,
        warningDetails,
      });

      const ingestResult = await dependencies.ingestSourceFamily({
        runId: run.id,
        wallet: args.wallet,
        sourceFamily: plan.sourceFamily,
        fromBlock: plan.fromBlock,
        toBlock: args.endBlock,
        cursor: plan.cursor,
      });

      counts.rawLogs += ingestResult.rawLogCount;
      warningCount += ingestResult.warnings.length;
      warningDetails.push(...ingestResult.warnings);
      latestSafeBlock = ingestResult.toBlock;
      currentRange = {
        sourceFamily: plan.sourceFamily,
        fromBlock: ingestResult.fromBlock,
        toBlock: ingestResult.toBlock,
      };

      currentStage = "NORMALIZING_LEDGER";
      await runStore.updateRun({
        runId: run.id,
        status: "RUNNING",
        stage: currentStage,
        latestSafeBlock,
        warningCount,
        warningDetails,
      });

      const drafts = await dependencies.normalizeSourceFamily({
        runId: run.id,
        wallet: args.wallet,
        sourceFamily: plan.sourceFamily,
        rawLogs: ingestResult.logs,
        fromBlock: ingestResult.fromBlock,
        toBlock: ingestResult.toBlock,
      });

      currentStage = "PERSISTING_LEDGER";
      await runStore.updateRun({
        runId: run.id,
        status: "RUNNING",
        stage: currentStage,
        latestSafeBlock,
        warningCount,
        warningDetails,
      });

      const persisted = await persistLedger(drafts);

      counts.actionGroups += persisted.actionGroupCount;
      counts.ledgerEntries += persisted.entryCount;

      currentStage = "UPDATING_CURSOR";
      await runStore.updateRun({
        runId: run.id,
        status: "RUNNING",
        stage: currentStage,
        latestSafeBlock,
        warningCount,
        warningDetails,
      });

      await cursorStore.upsertCursor({
        walletId: args.wallet.id,
        chainId: args.wallet.chainId,
        sourceFamily: plan.sourceFamily,
        fromBlock: ingestResult.fromBlock,
        toBlock: ingestResult.toBlock,
        blockHash: ingestResult.latestBlockHash,
      });
    }

    await runStore.updateRun({
      runId: run.id,
      status: "COMPLETED",
      stage: "COMPLETED",
      latestSafeBlock: latestSafeBlock ?? args.endBlock,
      warningCount,
      warningDetails,
      errorMessage: null,
      endBlock: args.endBlock,
      failedSourceFamily: null,
      failedFromBlock: null,
      failedToBlock: null,
    });

    return {
      runId: run.id,
      counts,
      warningCount,
      latestSafeBlock: latestSafeBlock ?? args.endBlock,
    };
  } catch (error) {
    await runStore.updateRun({
      runId: run.id,
      status: "FAILED",
      stage: currentStage,
      latestSafeBlock,
      warningCount,
      warningDetails,
      errorMessage: buildSyncFailureMessage({
        error,
        stage: currentStage,
        sourceFamily: currentRange?.sourceFamily,
        fromBlock: currentRange?.fromBlock,
        toBlock: currentRange?.toBlock,
      }),
      endBlock: args.endBlock,
      failedSourceFamily: currentRange?.sourceFamily ?? null,
      failedFromBlock: currentRange?.fromBlock ?? null,
      failedToBlock: currentRange?.toBlock ?? null,
    });

    throw error;
  }
}

function buildSyncFailureMessage(args: {
  error: unknown;
  stage: string;
  sourceFamily?: SourceFamily;
  fromBlock?: bigint;
  toBlock?: bigint;
}) {
  const range =
    args.sourceFamily && typeof args.fromBlock === "bigint" && typeof args.toBlock === "bigint"
      ? `${args.sourceFamily} ${args.fromBlock}-${args.toBlock}`
      : "unknown-range";
  const errorName = args.error instanceof Error ? args.error.name : typeof args.error;
  const errorCategory = classifySyncError(args.error);

  return `[${args.stage}] ${range}: ${errorName}/${errorCategory}`;
}


function minBlock(values: readonly bigint[]) {
  let smallest = values[0] ?? 0n;

  for (const value of values) {
    if (value < smallest) {
      smallest = value;
    }
  }

  return smallest;
}
