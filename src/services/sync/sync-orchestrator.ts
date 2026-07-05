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
  dependencies?: Partial<SyncRunDependencies<TLog>>;
}) {
  const defaultDeps = needsConcreteSyncDefaults(args.dependencies)
    ? createSyncDependencies()
    : undefined;
  const dependencies = buildSyncDependencies<TLog>(args.dependencies, defaultDeps);
  const unsupportedSourceFamilies = (dependencies.supportedSourceFamilies
    ? args.sourceFamilies.filter(
        (sourceFamily) =>
          !dependencies.supportedSourceFamilies?.includes(sourceFamily),
      )
    : []) as SourceFamily[];

  const unsupportedSourceFamiliesError =
    unsupportedSourceFamilies.length > 0
      ? new Error(
          `Unsupported source families for the current concrete sync path: ${unsupportedSourceFamilies.join(
            ", ",
          )}. Supported families: ${dependencies.supportedSourceFamilies?.join(", ") ?? "none"}.`,
        )
      : null;

  if (unsupportedSourceFamiliesError && !args.dependencies?.reserveOperationRun) {
    throw unsupportedSourceFamiliesError;
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
  const plannedStartBlock = minBlock(syncPlans.map((plan) => plan.fromBlock));

  const run = await reserveRun({
    walletId: args.wallet.id,
    chainId: args.wallet.chainId,
    trigger: args.trigger ?? "MANUAL",
    status: "PENDING",
    stage: "PENDING",
    sourceFamilies: args.sourceFamilies,
    startBlock: plannedStartBlock,
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
    if (unsupportedSourceFamiliesError) {
      throw unsupportedSourceFamiliesError;
    }

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
        startBlock: plannedStartBlock,
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
      // Append one-by-one instead of `push(...ingestResult.warnings)`: a single
      // window can emit hundreds of thousands of warnings (e.g. STAKING over a
      // heavily-traded pHEX range), and spreading that many arguments exceeds
      // V8's call-argument limit and throws `RangeError: Maximum call stack size
      // exceeded`.
      for (const warning of ingestResult.warnings) {
        warningDetails.push(warning);
      }
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
    // Log the full error (with stack) independently of the DB write, so the
    // real failure is visible in server logs even if persisting the SyncRun
    // itself fails.
    console.error("Wallet sync failed", {
      runId: run.id,
      stage: currentStage,
      sourceFamily: currentRange?.sourceFamily,
      fromBlock: currentRange?.fromBlock?.toString(),
      toBlock: currentRange?.toBlock?.toString(),
      error,
    });

    await runStore.updateRun({
      runId: run.id,
      status: "FAILED",
      stage: currentStage,
      startBlock: plannedStartBlock,
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

function needsConcreteSyncDefaults<TLog>(
  dependencies: Partial<SyncRunDependencies<TLog>> | undefined,
) {
  return (
    !dependencies ||
    !dependencies.ingestSourceFamily ||
    !dependencies.normalizeSourceFamily
  );
}

function buildSyncDependencies<TLog>(
  dependencies: Partial<SyncRunDependencies<TLog>> | undefined,
  defaultDeps: ReturnType<typeof createSyncDependencies> | undefined,
): SyncRunDependencies<TLog> {
  const ingestSourceFamily =
    dependencies?.ingestSourceFamily ??
    (defaultDeps?.ingestSourceFamily as SyncRunDependencies<TLog>["ingestSourceFamily"] | undefined);
  const normalizeSourceFamily =
    dependencies?.normalizeSourceFamily ??
    (defaultDeps?.normalizeSourceFamily as SyncRunDependencies<TLog>["normalizeSourceFamily"] | undefined);

  if (!ingestSourceFamily || !normalizeSourceFamily) {
    throw new Error("runWalletSync requires ingest and normalization dependencies.");
  }

  return {
    supportedSourceFamilies:
      dependencies?.supportedSourceFamilies ?? defaultDeps?.supportedSourceFamilies,
    runStore: dependencies?.runStore ?? defaultDeps?.runStore,
    cursorStore: dependencies?.cursorStore ?? defaultDeps?.cursorStore,
    reserveOperationRun: dependencies?.reserveOperationRun,
    ingestSourceFamily,
    normalizeSourceFamily,
    persistLedger: dependencies?.persistLedger ?? defaultDeps?.persistLedger,
  };
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
  // Preserve the underlying message so failures are diagnosable. `errorName`
  // + category alone (e.g. "RangeError/unexpected_error") is a label, not a
  // diagnosis — the real V8 message ("Invalid array length", etc.) is what
  // pinpoints the throw site. This string is persisted to SyncRun.errorMessage
  // and surfaced verbatim by /api/debug/status, so it is sanitized first;
  // full, unredacted detail is available in server logs via console.error.
  const errorDetail =
    args.error instanceof Error && args.error.message
      ? `: ${sanitizeFailureDetail(args.error.message)}`
      : "";

  return `[${args.stage}] ${range}: ${errorName}/${errorCategory}${errorDetail}`;
}

const MAX_PERSISTED_FAILURE_DETAIL_LENGTH = 300;

/**
 * Strip secrets from an error message before it is persisted to
 * SyncRun.errorMessage / returned by the debug API. viem and Prisma errors can
 * embed provider RPC URLs (often with API keys in the path/query) or database
 * connection strings (`postgresql://user:pass@host`). Redact any `scheme://…`
 * authority-form URI and bound the length. Public identifiers (tx hashes,
 * addresses, `chain:369:…` asset ids) contain no `//` authority and are kept.
 */
function sanitizeFailureDetail(message: string): string {
  const redacted = message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > MAX_PERSISTED_FAILURE_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_PERSISTED_FAILURE_DETAIL_LENGTH)}…`
    : redacted;
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
