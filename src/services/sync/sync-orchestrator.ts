import "server-only";

import type { SourceFamily, SyncTrigger } from "@prisma/client";

import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import {
  createPrismaSyncCursorStore,
  createPrismaSyncRunStore,
  type SyncCursorRecord,
  type SyncCursorStore,
  type SyncRunStore,
} from "@/services/sync/sync-state-store";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";

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
  runStore?: SyncRunStore;
  cursorStore?: SyncCursorStore;
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
  dependencies: SyncRunDependencies<TLog>;
}) {
  const runStore =
    args.dependencies.runStore ?? createPrismaSyncRunStore();
  const cursorStore =
    args.dependencies.cursorStore ?? createPrismaSyncCursorStore();
  const persistLedger =
    args.dependencies.persistLedger ?? persistNormalizedLedger;

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

  const run = await runStore.createRun({
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
      });

      const ingestResult = await args.dependencies.ingestSourceFamily({
        runId: run.id,
        wallet: args.wallet,
        sourceFamily: plan.sourceFamily,
        fromBlock: plan.fromBlock,
        toBlock: args.endBlock,
        cursor: plan.cursor,
      });

      counts.rawLogs += ingestResult.rawLogCount;
      warningCount += ingestResult.warnings.length;
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
      });

      const drafts = await args.dependencies.normalizeSourceFamily({
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
      errorMessage: null,
      endBlock: args.endBlock,
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
      errorMessage: buildSyncFailureMessage({
        error,
        stage: currentStage,
        sourceFamily: currentRange?.sourceFamily,
        fromBlock: currentRange?.fromBlock,
        toBlock: currentRange?.toBlock,
      }),
      endBlock: args.endBlock,
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
  const message = args.error instanceof Error ? args.error.message : String(args.error);

  return `[${args.stage}] ${range}: ${message}`;
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
