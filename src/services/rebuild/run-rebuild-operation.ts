import "server-only";

import type { SourceFamily } from "@prisma/client";

import { reserveOperationRun } from "@/services/operations/operation-lock";
import { materializeCurrentPortfolioPositions } from "@/services/portfolio";
import type { MaterializePortfolioPositionsReport } from "@/services/portfolio";
import type { RebuildLedgerReport } from "@/services/rebuild/rebuild-ledger";
import { rebuildCanonicalLedger } from "@/services/rebuild/rebuild-ledger";
import {
  createPrismaSyncRunStore,
  type SyncRunStore,
} from "@/services/sync/sync-state-store";

type RebuildOperationDependencies = {
  runStore?: SyncRunStore;
  reserveOperationRun?: typeof reserveOperationRun;
  rebuildCanonicalLedger?: typeof rebuildCanonicalLedger;
  materializeCurrentPortfolioPositions?: typeof materializeCurrentPortfolioPositions;
};

export type RebuildOperationResult = {
  runId: string;
  rebuild: RebuildLedgerReport;
  materialized: MaterializePortfolioPositionsReport;
  warningCount: number;
};

export async function runRebuildOperation(args: {
  wallet: {
    id: string;
    chainId: number;
    address: string;
  };
  fromBlock: bigint;
  toBlock: bigint;
  sourceFamilies: SourceFamily[];
  policyLabel?: string;
  dependencies?: RebuildOperationDependencies;
}): Promise<RebuildOperationResult> {
  const dependencies = args.dependencies ?? {};
  const runStore = dependencies.runStore ?? createPrismaSyncRunStore();
  const reserveRun =
    dependencies.reserveOperationRun ??
    (dependencies.runStore
      ? async (input: Parameters<SyncRunStore["createRun"]>[0]) => runStore.createRun(input)
      : reserveOperationRun);
  const rebuildLedger = dependencies.rebuildCanonicalLedger ?? rebuildCanonicalLedger;
  const materializePortfolio =
    dependencies.materializeCurrentPortfolioPositions ??
    materializeCurrentPortfolioPositions;

  const run = await reserveRun({
    walletId: args.wallet.id,
    chainId: args.wallet.chainId,
    trigger: "REBUILD",
    status: "PENDING",
    stage: "PENDING",
    sourceFamilies: args.sourceFamilies,
    startBlock: args.fromBlock,
    endBlock: args.toBlock,
    policyLabel: args.policyLabel ?? "manual-rebuild",
  });

  let currentStage = "PENDING";
  let latestSafeBlock: bigint | undefined;
  let warningCount = 0;
  const warningDetails: string[] = [];

  try {
    currentStage = "REBUILDING_LEDGER";
    await runStore.updateRun({
      runId: run.id,
      status: "RUNNING",
      stage: currentStage,
      latestSafeBlock,
      warningCount,
      warningDetails: [...warningDetails],
    });

    const rebuild = await rebuildLedger({
      wallet: args.wallet,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
      sourceFamilies: args.sourceFamilies,
    });

    warningCount += rebuild.warnings.length;
    warningDetails.push(...rebuild.warnings);
    latestSafeBlock = args.toBlock;

    currentStage = "MATERIALIZING_POSITIONS";
    await runStore.updateRun({
      runId: run.id,
      status: "RUNNING",
      stage: currentStage,
      latestSafeBlock,
      warningCount,
      warningDetails: [...warningDetails],
    });

    const materialized = await materializePortfolio({
      wallet: args.wallet,
    });

    warningCount += materialized.warnings.length;
    warningDetails.push(...materialized.warnings);

    await runStore.updateRun({
      runId: run.id,
      status: "COMPLETED",
      stage: "COMPLETED",
      latestSafeBlock,
      warningCount,
      warningDetails: [...warningDetails],
      errorMessage: null,
      endBlock: args.toBlock,
      failedSourceFamily: null,
      failedFromBlock: null,
      failedToBlock: null,
    });

    return {
      runId: run.id,
      rebuild,
      materialized,
      warningCount,
    };
  } catch (error) {
    const failedSourceFamily =
      currentStage === "REBUILDING_LEDGER" && args.sourceFamilies.length === 1
        ? args.sourceFamilies[0]
        : null;

    await runStore.updateRun({
      runId: run.id,
      status: "FAILED",
      stage: currentStage,
      latestSafeBlock,
      warningCount,
      warningDetails: [...warningDetails],
      errorMessage: buildRebuildFailureMessage({
        error,
        stage: currentStage,
        sourceFamilies: args.sourceFamilies,
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
      }),
      endBlock: args.toBlock,
      failedSourceFamily,
      failedFromBlock: args.fromBlock,
      failedToBlock: args.toBlock,
    });

    throw error;
  }
}

function buildRebuildFailureMessage(args: {
  error: unknown;
  stage: string;
  sourceFamilies: SourceFamily[];
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  const sourceScope =
    args.stage === "MATERIALIZING_POSITIONS"
      ? "PORTFOLIO"
      : args.sourceFamilies.length === 0
        ? "unknown-source-families"
        : args.sourceFamilies.join(",");

  return `[${args.stage}] ${sourceScope} ${args.fromBlock}-${args.toBlock}: ${message}`;
}
