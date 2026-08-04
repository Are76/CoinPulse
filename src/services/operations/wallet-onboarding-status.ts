import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getDb } from "@/lib/db";

/**
 * Canonical wallet onboarding / sync-readiness status vocabulary.
 *
 * Derived exclusively from persisted backend state (the wallet's most
 * recent SyncRun and its PortfolioMaterializationState row) — never from
 * RPC, live snapshots, or frontend inference. See docs/project-decisions.md
 * D-035 for the live-snapshot/canonical-truth boundary this status
 * reinforces.
 */
export type WalletOnboardingStatus =
  | "TRACKED_NOT_SYNCED"
  | "SYNC_IN_PROGRESS"
  | "SYNC_FAILED"
  | "CANONICAL_STATE_PARTIAL"
  | "CANONICAL_STATE_READY"
  | "CANONICAL_STATE_WARNING";

export type WalletOnboardingLatestSyncRunDto = {
  id: string;
  status: string;
  trigger: string;
  stage: string;
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
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null;

export type MaterializationStateInput = {
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  warningCount: number;
  latestMaterializedAt: Date | null;
  errorMessage: string | null;
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
} | null;

const ACTIVE_SYNC_RUN_STATUSES = new Set(["PENDING", "RUNNING"]);

/**
 * Pure derivation — no I/O. Exactly one branch matches for any input,
 * evaluated in this precedence order:
 *
 * 1. No SyncRun ever created for the wallet           -> TRACKED_NOT_SYNCED
 * 2. Latest SyncRun is PENDING or RUNNING              -> SYNC_IN_PROGRESS
 * 3. Latest SyncRun is FAILED                          -> SYNC_FAILED
 * 4. Latest SyncRun is COMPLETED, and materialized
 *    state is missing / not COMPLETED / not
 *    successful / RUNNING / FAILED / lacks full
 *    ledger block-range coverage                       -> CANONICAL_STATE_PARTIAL
 * 5. Materialized state is COMPLETED + successful +
 *    covered, with warningCount > 0                    -> CANONICAL_STATE_WARNING
 * 6. Materialized state is COMPLETED + successful +
 *    covered, with warningCount === 0                  -> CANONICAL_STATE_READY
 */
export function deriveWalletOnboardingStatus(input: {
  latestSyncRun: LatestSyncRunInput;
  materializationState: MaterializationStateInput;
}): WalletOnboardingStatusDto {
  const { latestSyncRun, materializationState } = input;

  const latestSyncRunDto: WalletOnboardingLatestSyncRunDto | null = latestSyncRun
    ? {
        id: latestSyncRun.id,
        status: latestSyncRun.status,
        trigger: latestSyncRun.trigger,
        stage: latestSyncRun.stage,
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

  function build(
    status: WalletOnboardingStatus,
    reason: string,
    flags: {
      actionRequired: boolean;
      holdingsMayBeVisible: boolean;
      pnlMayBeAvailable: boolean;
      pricingMayBeUnavailable: boolean;
    },
  ): WalletOnboardingStatusDto {
    return {
      status,
      reason,
      ...flags,
      latestSyncRun: latestSyncRunDto,
      materialization: materializationDto,
    };
  }

  if (!latestSyncRun) {
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

  if (ACTIVE_SYNC_RUN_STATUSES.has(latestSyncRun.status)) {
    return build(
      "SYNC_IN_PROGRESS",
      "A sync or rebuild operation is currently running for this wallet.",
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (latestSyncRun.status === "FAILED") {
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

  // latestSyncRun.status === "COMPLETED" from here down.

  if (!materializationState) {
    return build(
      "CANONICAL_STATE_PARTIAL",
      "Sync completed but canonical portfolio state has not been materialized yet.",
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
      "Canonical portfolio state materialization is currently in progress.",
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
        ? `Materialization failed: ${materializationState.errorMessage}`
        : "Materialization failed.",
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (!materializationState.completedSuccessfully) {
    return build(
      "CANONICAL_STATE_PARTIAL",
      "Materialization completed without a recorded success confirmation.",
      {
        actionRequired: false,
        holdingsMayBeVisible: false,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (ledgerCoverageStatus(materializationState) !== "covered") {
    return build(
      "CANONICAL_STATE_PARTIAL",
      "Canonical materialized state exists but historical ledger coverage is partial or unknown.",
      {
        actionRequired: false,
        holdingsMayBeVisible: true,
        pnlMayBeAvailable: false,
        pricingMayBeUnavailable: true,
      },
    );
  }

  if (materializationState.warningCount > 0) {
    return build(
      "CANONICAL_STATE_WARNING",
      "Canonical materialized state is ready but has active integrity or persisted warnings.",
      {
        actionRequired: true,
        holdingsMayBeVisible: true,
        pnlMayBeAvailable: true,
        pricingMayBeUnavailable: false,
      },
    );
  }

  return build(
    "CANONICAL_STATE_READY",
    "Canonical materialized state is ready and covers the known ledger history.",
    {
      actionRequired: false,
      holdingsMayBeVisible: true,
      pnlMayBeAvailable: true,
      pricingMayBeUnavailable: false,
    },
  );
}

function ledgerCoverageStatus(materializationState: {
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
}): "covered" | "partial" | "unknown" {
  const { sourceLedgerFromBlock, sourceLedgerToBlock } = materializationState;
  if (sourceLedgerFromBlock !== null && sourceLedgerToBlock !== null) {
    return "covered";
  }
  if (sourceLedgerFromBlock !== null || sourceLedgerToBlock !== null) {
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
}): Promise<WalletOnboardingStatusDto> {
  const db = args.db ?? (getDb() as unknown as WalletOnboardingStatusDbClient);

  const [latestSyncRun, materializationState] = await Promise.all([
    db.syncRun.findFirst({
      where: { walletId: args.walletId, chainId: args.chainId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        trigger: true,
        stage: true,
        errorMessage: true,
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
        sourceLedgerFromBlock: true,
        sourceLedgerToBlock: true,
      },
    }),
  ]);

  return deriveWalletOnboardingStatus({
    latestSyncRun,
    materializationState,
  });
}
