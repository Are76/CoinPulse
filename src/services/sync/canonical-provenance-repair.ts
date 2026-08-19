import "server-only";

import { PHEX_ADDRESS } from "@/config/assets";
import { getDb } from "@/lib/db";
import {
  persistRawDexSwapTransferEvidence,
  persistRawLpActionTransferEvidence,
  persistRawStakeActionTransferEvidence,
  readRawDexSwapProvenanceRepairCandidates,
  readRawLpActionProvenanceRepairCandidates,
  readRawStakeActionProvenanceRepairCandidates,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";
import {
  summarizeWalletSwapTransfers,
} from "@/services/sync/dex-sync";
import {
  buildLpTransferEvidencePlans,
  summarizeWalletLpTransfers,
} from "@/services/sync/lp-sync";
import {
  summarizeStakeEndTransfers,
  summarizeStakeStartTransfers,
} from "@/services/sync/stake-sync";
import type { SyncDbClient } from "@/services/sync/sync-common";

/**
 * Historical canonical raw-transfer provenance repair.
 *
 * Backfills `rawTransferEvidenceStatus`/evidence rows (introduced by PR #376)
 * for ACTIVE, historical (rawTransferEvidenceStatus === null) SWAP, LP, and
 * currently-supported transfer-derived STAKE actions — using only already
 * persisted canonical PostgreSQL rows, never RPC.
 *
 * Determinism boundary: this module does not reimplement evidence selection.
 * It reuses the exact same pure functions the live producers
 * (dex-sync.ts / lp-sync.ts / stake-sync.ts) use to select
 * RawTokenTransfer evidence, applied to the exact same kind of input
 * (ACTIVE wallet-facing RawTokenTransfer rows for one transaction, read
 * from Postgres). If the reused producer function cannot deterministically
 * shape the transfers for a transaction, the action is left unresolved —
 * never guessed, never inferred from txHash/symbol/amount/direction alone.
 *
 * As a defense-in-depth consistency gate (not a selection mechanism), the
 * recomputed leg asset/amount is compared against the amount/asset already
 * persisted on the higher-order action row at original ingestion time. A
 * mismatch means the currently-persisted raw-transfer evidence no longer
 * matches what was true when the action was created (e.g. an intervening
 * reorg changed the transfer set) — such rows are left unresolved rather
 * than repaired with stale-relative-to-now evidence.
 *
 * Never mutates RECORDED or VERIFIED_EMPTY actions: the candidate readers
 * only ever select rows with rawTransferEvidenceStatus === null.
 */

export type ProvenanceRepairFamily = "SWAP" | "LP" | "STAKE";

export const PROVENANCE_REPAIR_DEFAULT_MAX_ACTIONS = 100;
export const PROVENANCE_REPAIR_MAX_ACTIONS_HARD_CAP = 500;

export type RepairCanonicalRawTransferProvenanceArgs = {
  chainId: number;
  family: ProvenanceRepairFamily;
  /** Optional wallet scope. Omit to scan all wallets on the chain. */
  walletAddress?: string;
  /** Default false: dry-run/read-only. Mutations require apply: true. */
  apply?: boolean;
  /** Resume a bounded scan from a previous report's nextCursorId. */
  cursorId?: string | null;
  /** Bounded batch size. Defaults to 100, hard-capped at 500. */
  maxActions?: number;
};

export type UnresolvedProvenanceCandidate = {
  actionId: string;
  txHash: string;
  blockHash: string;
  reason: string;
};

export type RepairedProvenanceCandidate = {
  actionId: string;
  txHash: string;
  blockHash: string;
  evidenceRowsPlanned: number;
};

export type CanonicalProvenanceRepairReport = {
  apply: boolean;
  chainId: number;
  family: ProvenanceRepairFamily;
  walletAddress: string | null;
  /** ACTIVE, rawTransferEvidenceStatus === null actions scanned this batch. */
  candidatesScanned: number;
  deterministicallyRepairable: number;
  unresolvedCount: number;
  evidenceRowsPlanned: number;
  /** Actual DB-changed evidence row count in apply mode; 0 in dry-run. */
  evidenceRowsCreated: number;
  /** Planned in dry-run, actual in apply mode. */
  actionsBecameRecorded: number;
  /** Always 0 for these families under current producer semantics — see
   * module doc: SWAP/LP/STAKE producers never call the evidence persister
   * with all-empty legs, so this repair never fabricates VERIFIED_EMPTY. */
  actionsBecameVerifiedEmpty: number;
  repaired: RepairedProvenanceCandidate[];
  unresolved: UnresolvedProvenanceCandidate[];
  /** Pass as cursorId on the next call to continue this bounded scan. */
  nextCursorId: string | null;
};

const PHEX_ADDRESS_LOWER = PHEX_ADDRESS.toLowerCase();

function validateArgs(args: RepairCanonicalRawTransferProvenanceArgs) {
  if (!Number.isInteger(args.chainId) || args.chainId <= 0) {
    throw new Error(
      "canonical-provenance-repair: chainId must be a positive integer.",
    );
  }

  if (!["SWAP", "LP", "STAKE"].includes(args.family)) {
    throw new Error(
      "canonical-provenance-repair: family must be one of SWAP, LP, STAKE.",
    );
  }

  if (args.maxActions !== undefined) {
    if (
      !Number.isInteger(args.maxActions) ||
      args.maxActions < 1 ||
      args.maxActions > PROVENANCE_REPAIR_MAX_ACTIONS_HARD_CAP
    ) {
      throw new Error(
        `canonical-provenance-repair: maxActions must be an integer between 1 and ${PROVENANCE_REPAIR_MAX_ACTIONS_HARD_CAP}.`,
      );
    }
  }
}

async function readTransactionTransfers(
  args: {
    chainId: number;
    walletAddress: string;
    txHash: string;
    blockHash: string;
    blockNumber: bigint;
    restrictToTokenAddress?: string;
  },
  client: SyncDbClient,
) {
  const transfers = await readWalletTransferRawTokenTransfers(
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      fromBlock: args.blockNumber,
      toBlock: args.blockNumber,
    },
    client as never,
  );

  const txHashLower = args.txHash.toLowerCase();
  const blockHashLower = args.blockHash.toLowerCase();

  return transfers.filter((transfer) => {
    if (
      transfer.txHash.toLowerCase() !== txHashLower ||
      transfer.blockHash.toLowerCase() !== blockHashLower
    ) {
      return false;
    }

    if (
      args.restrictToTokenAddress !== undefined &&
      transfer.tokenAddress.toLowerCase() !== args.restrictToTokenAddress
    ) {
      return false;
    }

    return true;
  });
}

export async function repairCanonicalRawTransferProvenance(
  args: RepairCanonicalRawTransferProvenanceArgs,
  client: SyncDbClient = getDb() as unknown as SyncDbClient,
): Promise<CanonicalProvenanceRepairReport> {
  validateArgs(args);

  const apply = args.apply === true;
  const maxActions = args.maxActions ?? PROVENANCE_REPAIR_DEFAULT_MAX_ACTIONS;
  const walletAddress = args.walletAddress?.toLowerCase();

  const report: CanonicalProvenanceRepairReport = {
    apply,
    chainId: args.chainId,
    family: args.family,
    walletAddress: walletAddress ?? null,
    candidatesScanned: 0,
    deterministicallyRepairable: 0,
    unresolvedCount: 0,
    evidenceRowsPlanned: 0,
    evidenceRowsCreated: 0,
    actionsBecameRecorded: 0,
    actionsBecameVerifiedEmpty: 0,
    repaired: [],
    unresolved: [],
    nextCursorId: null,
  };

  if (args.family === "SWAP") {
    const candidates = await readRawDexSwapProvenanceRepairCandidates(
      { chainId: args.chainId, walletAddress, cursorId: args.cursorId ?? null, take: maxActions },
      client as never,
    );
    report.candidatesScanned = candidates.length;

    const plans: Array<{
      chainId: number;
      txHash: string;
      blockHash: string;
      logIndex: number;
      legRole: "SOLD" | "BOUGHT";
      rawTokenTransferIds: readonly string[];
    }> = [];

    for (const action of candidates) {
      const transfers = await readTransactionTransfers(
        {
          chainId: args.chainId,
          walletAddress: action.initiatorAddress,
          txHash: action.txHash,
          blockHash: action.blockHash,
          blockNumber: action.blockNumber,
        },
        client,
      );

      const shape = summarizeWalletSwapTransfers({
        walletAddress: action.initiatorAddress,
        transfers,
      });

      if (!shape.ok) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: `unreconstructable-shape:${shape.reason}`,
        });
        continue;
      }

      if (
        shape.sold.assetIdSnapshot !== action.soldAssetIdSnapshot ||
        shape.sold.amountRaw !== action.soldAmountRaw ||
        shape.bought.assetIdSnapshot !== action.boughtAssetIdSnapshot ||
        shape.bought.amountRaw !== action.boughtAmountRaw
      ) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: "producer-recompute-mismatch",
        });
        continue;
      }

      plans.push({
        chainId: args.chainId,
        txHash: action.txHash,
        blockHash: action.blockHash,
        logIndex: action.logIndex,
        legRole: "SOLD",
        rawTokenTransferIds: shape.sold.rawTokenTransferIds,
      });
      plans.push({
        chainId: args.chainId,
        txHash: action.txHash,
        blockHash: action.blockHash,
        logIndex: action.logIndex,
        legRole: "BOUGHT",
        rawTokenTransferIds: shape.bought.rawTokenTransferIds,
      });

      report.deterministicallyRepairable += 1;
      report.repaired.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned:
          shape.sold.rawTokenTransferIds.length + shape.bought.rawTokenTransferIds.length,
      });
      report.evidenceRowsPlanned +=
        shape.sold.rawTokenTransferIds.length + shape.bought.rawTokenTransferIds.length;
    }

    report.actionsBecameRecorded = report.deterministicallyRepairable;

    if (apply && plans.length > 0) {
      const result = await persistRawDexSwapTransferEvidence(plans, client as never);
      report.evidenceRowsCreated = result.count;
    }

    report.nextCursorId =
      candidates.length === maxActions ? candidates[candidates.length - 1].id : null;
    report.unresolvedCount = report.unresolved.length;
    return report;
  }

  if (args.family === "LP") {
    const candidates = await readRawLpActionProvenanceRepairCandidates(
      { chainId: args.chainId, walletAddress, cursorId: args.cursorId ?? null, take: maxActions },
      client as never,
    );
    report.candidatesScanned = candidates.length;

    const plans: Array<{
      chainId: number;
      txHash: string;
      blockHash: string;
      logIndex: number;
      legRole: string;
      rawTokenTransferIds: readonly string[];
    }> = [];

    for (const action of candidates) {
      const transfers = await readTransactionTransfers(
        {
          chainId: args.chainId,
          walletAddress: action.initiatorAddress,
          txHash: action.txHash,
          blockHash: action.blockHash,
          blockNumber: action.blockNumber,
        },
        client,
      );

      const shape = summarizeWalletLpTransfers({
        walletAddress: action.initiatorAddress,
        transfers,
      });

      if (!shape.ok) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: `unreconstructable-shape:${shape.reason}`,
        });
        continue;
      }

      if (shape.actionKind !== action.actionKind) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: "action-kind-mismatch",
        });
        continue;
      }

      if (
        shape.token0.assetIdSnapshot !== action.token0AssetIdSnapshot ||
        shape.token0.amountRaw !== action.token0AmountRaw ||
        shape.token1.assetIdSnapshot !== action.token1AssetIdSnapshot ||
        shape.token1.amountRaw !== action.token1AmountRaw ||
        shape.lpToken.assetIdSnapshot !== action.lpAssetIdSnapshot ||
        shape.lpToken.amountRaw !== action.lpAmountRaw
      ) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: "producer-recompute-mismatch",
        });
        continue;
      }

      const legPlans = buildLpTransferEvidencePlans({
        chainId: args.chainId,
        txHash: action.txHash,
        blockHash: action.blockHash,
        logIndex: action.logIndex,
        lpShape: shape,
      });
      plans.push(...legPlans);

      const evidenceRowsPlanned = legPlans.reduce(
        (sum, plan) => sum + plan.rawTokenTransferIds.length,
        0,
      );

      report.deterministicallyRepairable += 1;
      report.repaired.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned,
      });
      report.evidenceRowsPlanned += evidenceRowsPlanned;
    }

    report.actionsBecameRecorded = report.deterministicallyRepairable;

    if (apply && plans.length > 0) {
      const result = await persistRawLpActionTransferEvidence(plans, client as never);
      report.evidenceRowsCreated = result.count;
    }

    report.nextCursorId =
      candidates.length === maxActions ? candidates[candidates.length - 1].id : null;
    report.unresolvedCount = report.unresolved.length;
    return report;
  }

  // STAKE
  const candidates = await readRawStakeActionProvenanceRepairCandidates(
    { chainId: args.chainId, walletAddress, cursorId: args.cursorId ?? null, take: maxActions },
    client as never,
  );
  report.candidatesScanned = candidates.length;

  const plans: Array<{
    chainId: number;
    txHash: string;
    blockHash: string;
    actionKind: "START" | "END";
    actionIndex: number;
    legRole: string;
    rawTokenTransferIds: readonly string[];
  }> = [];

  for (const action of candidates) {
    const transfers = await readTransactionTransfers(
      {
        chainId: args.chainId,
        walletAddress: action.initiatorAddress,
        txHash: action.txHash,
        blockHash: action.blockHash,
        blockNumber: action.blockNumber,
        restrictToTokenAddress: PHEX_ADDRESS_LOWER,
      },
      client,
    );

    if (action.actionKind === "START") {
      const shape = summarizeStakeStartTransfers({
        walletAddress: action.initiatorAddress,
        transfers,
      });

      if (!shape.ok) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: `unreconstructable-shape:${shape.reason}`,
        });
        continue;
      }

      if (action.principalLockedRaw === null) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: "missing-principal-snapshot",
        });
        continue;
      }

      const outboundAmount = transfers.find(
        (transfer) => transfer.fromAddress === action.initiatorAddress,
      )?.amountRaw;

      if (outboundAmount !== action.principalLockedRaw) {
        report.unresolved.push({
          actionId: action.id,
          txHash: action.txHash,
          blockHash: action.blockHash,
          reason: "producer-recompute-mismatch",
        });
        continue;
      }

      plans.push({
        chainId: args.chainId,
        txHash: action.txHash,
        blockHash: action.blockHash,
        actionKind: "START",
        actionIndex: 0,
        legRole: "PRINCIPAL_LOCKED_OUT",
        rawTokenTransferIds: shape.rawTokenTransferIds,
      });

      report.deterministicallyRepairable += 1;
      report.repaired.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned: shape.rawTokenTransferIds.length,
      });
      report.evidenceRowsPlanned += shape.rawTokenTransferIds.length;
      continue;
    }

    // END
    const shape = summarizeStakeEndTransfers({
      walletAddress: action.initiatorAddress,
      transfers,
    });

    if (!shape.ok) {
      report.unresolved.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        reason: `unreconstructable-shape:${shape.reason}`,
      });
      continue;
    }

    if (action.totalReturnedRaw === null) {
      report.unresolved.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        reason: "missing-return-snapshot",
      });
      continue;
    }

    if (shape.totalReturnedRaw !== action.totalReturnedRaw) {
      report.unresolved.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        reason: "producer-recompute-mismatch",
      });
      continue;
    }

    plans.push({
      chainId: args.chainId,
      txHash: action.txHash,
      blockHash: action.blockHash,
      actionKind: "END",
      actionIndex: 0,
      legRole: "RETURN_IN",
      rawTokenTransferIds: shape.rawTokenTransferIds,
    });

    report.deterministicallyRepairable += 1;
    report.repaired.push({
      actionId: action.id,
      txHash: action.txHash,
      blockHash: action.blockHash,
      evidenceRowsPlanned: shape.rawTokenTransferIds.length,
    });
    report.evidenceRowsPlanned += shape.rawTokenTransferIds.length;
  }

  report.actionsBecameRecorded = report.deterministicallyRepairable;

  if (apply && plans.length > 0) {
    const result = await persistRawStakeActionTransferEvidence(plans, client as never);
    report.evidenceRowsCreated = result.count;
  }

  report.nextCursorId =
    candidates.length === maxActions ? candidates[candidates.length - 1].id : null;
  report.unresolvedCount = report.unresolved.length;
  return report;
}
