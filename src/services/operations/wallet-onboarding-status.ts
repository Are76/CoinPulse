import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getDb } from "@/lib/db";
import {
  DEFAULT_OPERATION_STALE_THRESHOLDS,
  inspectOperationBlocker,
  type OperationStaleThresholds,
} from "@/services/operations/operation-lock";

/**
 * Canonical wallet onboarding / sync-readiness status vocabulary.
 *
 * Derived exclusively from persisted backend state (the wallet's most
 * recent SyncRun and its PortfolioMaterializationState row) — never from
 * RPC, live snapshots, or frontend inference. See docs/project-decisions.md
 * D-035 for the live-snapshot/canonical-truth boundary this status
 * reinforces.
 *
 * `CANONICAL_STATE_MATERIALIZED` (not "READY") is deliberate: the recorded
 * `updatedFromBlock`/`updatedToBlock` range only proves the most recent
 * materialization pass's own recorded block window is known — it does not
 * prove the wallet's complete history back to genesis has been captured
 * (a single sync/rebuild is capped at 1,000 blocks — see
 * MANUAL_SYNC_MAX_BLOCK_SPAN / REBUILD_MAX_BLOCK_SPAN in
 * src/services/api/validation.ts). No persisted field in the current schema
 * proves full historical coverage, so this status never claims "ready" or
 * "complete".
 *
 * Note: this reads `updatedFromBlock`/`updatedToBlock` — not
 * `sourceLedgerFromBlock`/`sourceLedgerToBlock` — because the sole
 * production writer (run-rebuild-operation.ts -> materialize-positions.ts
 * -> persistMaterializationState) never supplies `sourceLedgerCoverageExact`,
 * so those columns are always persisted as null today. `updatedFromBlock`/
 * `updatedToBlock` are the fields the real rebuild flow actually populates.
 */
export type WalletOnboardingStatus =
  | "TRACKED_NOT_SYNCED"
  | "SYNC_IN_PROGRESS"
  | "SYNC_FAILED"
  | "CANONICAL_STATE_PARTIAL"
  | "CANONICAL_STATE_MATERIALIZED"
  | "CANONICAL_STATE_WARNING";

export type WalletOnboardingLatestSyncRunDto = {
  id: string;
  status: string;
  trigger: string;
  stage: string;
  warningCount: number;
  /** True when this active (PENDING/RUNNING) run exceeds the shared operation-lock staleness threshold. */
  appearsStale: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WalletOnboardingMaterializationDto = {
  status: "RUNNING" | "FAILED" | "COMPLETED" | null;
  completedSuccessfully: boolean | null;
  warningCount: number;
  latestMaterializedAt: string | null;
};

export type WalletOnboardingStatusDto = {
  status: WalletOnboardingStatus;
  reason: string;
  /** Whether an operator/user action (retry sync, investigate warnings) is expected. */
  actionRequired: boolean;
  /**
   * Advisory hints for UI gating only. The dashboard DTO's own
   * `materialization` / `ledgerCoverage` / `pnlCoverage` fields remain the
   * authoritative, per-position source of truth — these booleans never
   * override them.
   */
  holdingsMayBeVisible: boolean;
  pnlMayBeAvailable: boolean;
  pricingMayBeUnavailable: boolean;
  latestSyncRun: WalletOnboardingLatestSyncRunDto | null;
  materialization: WalletOnboardingMaterializationDto;
};

export type LatestSyncRunInput = {
  id: string;
  status: string;
  trigger: string;
  stage: string;
  warningCount: number;
  errorMessage: string | null;
  chainId: number;
  walletId: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null;

export type MaterializationStateInput = {
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  warningCount: number;
  latestMaterializedAt: Date | null;
  errorMessage: string | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
} | null;

const ACTIVE_SYNC_RUN_STATUSES = new Set(["PENDING", "RUNNING"]);

type OnboardingFlags = {
  actionRequired: boolean;
  holdingsMayBeVisible: boolean;
  pnlMayBeAvailable: boolean;
  pricingMayBeUnavailable: boolean;
};

/**
 * Pure derivation — no I/O, deterministic given `now`. Exactly one branch
 * matches for any input, evaluated in this precedence order:
 *
 * 1. No SyncRun AND no materialization ever recorded    -> TRACKED_NOT_SYNCED
 * 2. Latest SyncRun is PENDING or RUNNING                -> SYNC_IN_PROGRESS
 *    (actionRequired=true and the reason flags staleness when the run
 *    exceeds DEFAULT_OPERATION_STALE_THRESHOLDS — see operation-lock.ts)
 * 3. Latest SyncRun is FAILED                            -> SYNC_FAILED
 * 4. Otherwise (latest SyncRun is COMPLETED, or no
 *    SyncRun exists but a PortfolioMaterializationState
 *    row does — e.g. a legacy/imported wallet whose
 *    materialization predates per-run SyncRun tracking):
 *    classify from the materialization row (plus the
 *    completed sync run's own warnings/timestamp, when
 *    one exists):
 *      a. missing / RUNNING / FAILED / not
 *         completedSuccessfully / lacks a valid recorded
 *         updated-block range                            -> CANONICAL_STATE_PARTIAL
 *      b. materialization predates the latest completed
 *         SyncRun (stale relative to newer canonical
 *         ledger changes)                                -> CANONICAL_STATE_PARTIAL
 *      c. COMPLETED + successful + valid range, and
 *         (materialization warningCount + latest completed
 *         SyncRun warningCount) > 0                       -> CANONICAL_STATE_WARNING
 *      d. COMPLETED + successful + valid range, combined
 *         warningCount === 0                               -> CANONICAL_STATE_MATERIALIZED
 */
export function deriveWalletOnboardingStatus(input: {
  latestSyncRun: LatestSyncRunInput;
  materializationState: MaterializationStateInput;
  now: Date;
  staleThresholds?: OperationStaleThresholds;
}): WalletOnboardingStatusDto {
  const { latestSyncRun, materializationState, now } = input;
  const staleThresholds = input.staleThresholds ?? DEFAULT_OPERATION_STALE_THRESHOLDS;

  const syncRunStaleness = latestSyncRun
    ? inspectOperationBlocker(
        {
          id: latestSyncRun.id,
          trigger: latestSyncRun.trigger,
          status: latestSyncRun.status,
          stage: latestSyncRun.stage,
          chainId: latestSyncRun.chainId,
          walletId: latestSyncRun.walletId,
          createdAt: latestSyncRun.createdAt,
          updatedAt: latestSyncRun.updatedAt,
        },
        { now, thresholds: staleThresholds },
      )
    : null;

  const latestSyncRunDto: WalletOnboardingLatestSyncRunDto | null = latestSyncRun
    ? {
        id: latestSyncRun.id,
        status: latestSyncRun.status,
        trigger: latestSyncRun.trigger,
        stage: latestSyncRun.stage,
        warningCount: latestSyncRun.warningCount,
        appearsStale: syncRunStaleness?.appearsStale ?? false,
        createdAt: latestSyncRun.createdAt.toISOString(),
        updatedAt: latestSyncRun.updatedAt.toISOString(),
      }
    : null;

  const materializationDto: WalletOnboardingMaterializationDto = {
    status: materializationState?.status ?? null,
    completedSuccessfully: materializationState?.completedSuccessfully ?? null,
    warningCount: materializationState?.warningCount ?? 0,
    latestMaterializedAt: materializationState?.latestMaterializedAt?.toISOString() ?? null,
  };

  function build(status: WalletOnboardingStatus, reason: string, flags: OnboardingFlags): WalletOnboardingStatusDto {
    return {
      status,
      reason,
      ...flags,
      latestSyncRun: latestSyncRunDto,
      materialization: materializationDto,
    };
  }

  if (!latestSyncRun && !materializationState) {
    return build(
      "TRACKED_NOT_SYNCED",
      "Wallet is tracked but no sync has ever been attempted.",
      {
        actionRequired: true,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (latestSyncRun && ACTIVE_SYNC_RUN_STATUSES.has(latestSyncRun.status)) {
    const isStale = syncRunStaleness?.appearsStale ?? false;
    return build(
      "SYNC_IN_PROGRESS",
      isStale
        ? `A sync or rebuild operation for this wallet appears stuck: it has been ${latestSyncRun.status} longer than the operation-lock staleness threshold (${syncRunStaleness?.staleReason ?? "threshold exceeded"}) and requires investigation.`
        : "A sync or rebuild operation is currently running for this wallet.",
      {
        actionRequired: isStale,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (latestSyncRun && latestSyncRun.status === "FAILED") {
    return build(
      "SYNC_FAILED",
      latestSyncRun.errorMessage
        ? `The most recent sync failed: ${latestSyncRun.errorMessage}`
        : "The most recent sync failed.",
      {
        actionRequired: true,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  // From here: latestSyncRun is either COMPLETED, or null while a
  // PortfolioMaterializationState row still exists (legacy/imported wallet
  // with no per-run SyncRun evidence). Either way, no SyncRun row present
  // must never be reported as "never synced" once materialization evidence
  // contradicts that — classify from the materialization row alone.
  const noSyncEvidencePrefix =
    latestSyncRun === null
      ? "No SyncRun evidence exists for this wallet, but persisted materialization state does. "
      : "";

  if (!materializationState) {
    return build(
      "CANONICAL_STATE_PARTIAL",
      `${noSyncEvidencePrefix}Sync completed but canonical portfolio state has not been materialized yet.`,
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (materializationState.status === "RUNNING") {
    return build(
      "CANONICAL_STATE_PARTIAL",
      `${noSyncEvidencePrefix}Canonical portfolio state materialization is currently in progress.`,
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (materializationState.status === "FAILED") {
    return build(
      "CANONICAL_STATE_PARTIAL",
      materializationState.errorMessage
        ? `${noSyncEvidencePrefix}Materialization failed: ${materializationState.errorMessage}`
        : `${noSyncEvidencePrefix}Materialization failed.`,
      {
        actionRequired: true,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (!materializationState.completedSuccessfully) {
    return build(
      "CANONICAL_STATE_PARTIAL",
      `${noSyncEvidencePrefix}Materialization completed without a recorded success confirmation.`,
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (updatedRangeStatus(materializationState) !== "recorded") {
    return build(
      "CANONICAL_STATE_PARTIAL",
      `${noSyncEvidencePrefix}Canonical materialized state exists but its recorded updated-block range is missing, partial, or invalid.`,
      {
        actionRequired: false,
        holdingsMayBeVisible: true,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (
    latestSyncRun &&
    latestSyncRun.status === "COMPLETED" &&
    (materializationState.latestMaterializedAt === null ||
      materializationState.latestMaterializedAt < latestSyncRun.updatedAt)
  ) {
    return build(
      "CANONICAL_STATE_PARTIAL",
      "The latest sync completed after the last successful materialization; canonical portfolio state may not yet reflect the newest ledger entries.",
      {
        actionRequired: false,
        holdingsMayBeVisible: true,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  const combinedWarningCount = materializationState.warningCount + (latestSyncRun?.warningCount ?? 0);

  if (combinedWarningCount > 0) {
    // Fail closed: a persisted warning on either the materialization row
    // (including negative-token-balance integrity warnings — see
    // materialize-positions.ts) or the latest completed sync/rebuild run
    // (ingestion/normalization warnings — see sync-orchestrator.ts /
    // rebuild-ledger.ts) means the materialized state is not safe to treat
    // as valuation/PnL-ready. This mirrors the existing pricing-candidate
    // materialization-health gate (discover-ingest-candidates.ts
    // buildMaterializationHealth), which already refuses to classify
    // anything as "healthy" once warningCount > 0.
    return build(
      "CANONICAL_STATE_WARNING",
      `${noSyncEvidencePrefix}Canonical materialized state carries active integrity or persisted warnings; portfolio totals, valuation, and PnL are not trustworthy until the warnings are resolved.`,
      {
        actionRequired: true,
        holdingsMayBeVisible: true,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  return build(
    "CANONICAL_STATE_MATERIALIZED",
    `${noSyncEvidencePrefix}Canonical portfolio state has been successfully materialized and its recorded updated-block range is valid. This does not by itself prove the wallet's complete history has been captured.`,
    {
      actionRequired: false,
      holdingsMayBeVisible: true,
      pnlMayBeAvailable: true,
      pricingMayBeUnavailable: false,
    },
  );
}

function updatedRangeStatus(materializationState: {
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
}): "recorded" | "partial" | "unknown" | "invalid" {
  const { updatedFromBlock, updatedToBlock } = materializationState;
  if (updatedFromBlock !== null && updatedToBlock !== null) {
    return updatedFromBlock <= updatedToBlock ? "recorded" : "invalid";
  }
  if (updatedFromBlock !== null || updatedToBlock !== null) {
    return "partial";
  }
  return "unknown";
}

export type WalletOnboardingStatusDbClient = Pick<PrismaClient, "syncRun" | "portfolioMaterializationState">;

/**
 * Resolves onboarding status for an already-resolved tracked wallet. Callers
 * must resolve the Wallet row first (e.g. via resolveTrackedWalletByAddress)
 * — this function performs no wallet lookup itself and assumes the wallet
 * exists and is tracked.
 */
export async function getWalletOnboardingStatus(args: {
  walletId: string;
  chainId: number;
  db?: WalletOnboardingStatusDbClient;
  now?: Date;
  staleThresholds?: OperationStaleThresholds;
}): Promise<WalletOnboardingStatusDto> {
  const db = args.db ?? (getDb() as unknown as WalletOnboardingStatusDbClient);
  const now = args.now ?? new Date();

  const [latestSyncRun, materializationState] = await Promise.all([
    db.syncRun.findFirst({
      where: { walletId: args.walletId, chainId: args.chainId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        trigger: true,
        stage: true,
        warningCount: true,
        errorMessage: true,
        chainId: true,
        walletId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.portfolioMaterializationState.findUnique({
      where: { walletId_chainId: { walletId: args.walletId, chainId: args.chainId } },
      select: {
        status: true,
        completedSuccessfully: true,
        warningCount: true,
        latestMaterializedAt: true,
        errorMessage: true,
        updatedFromBlock: true,
        updatedToBlock: true,
      },
    }),
  ]);

  return deriveWalletOnboardingStatus({
    latestSyncRun,
    materializationState,
    now,
    staleThresholds: args.staleThresholds,
  });
}
