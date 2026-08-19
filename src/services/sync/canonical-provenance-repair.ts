import "server-only";

import { Prisma } from "@prisma/client";

import { PHEX_ADDRESS } from "@/config/assets";
import { PULSECHAIN_REFERENCE } from "@/config/chains";
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
 *
 * Concurrency safety — the actual database guarantee, precisely stated:
 *
 * The initial scan (candidate read + transfer read + shape reconstruction)
 * is not itself transactional, so it cannot by itself prove nothing changes
 * before the write. Revalidation, the evidence insert, and the status
 * update therefore all happen inside ONE interactive transaction opened by
 * `applyPendingRepairsAtomically`, explicitly at PostgreSQL SERIALIZABLE
 * isolation (`Prisma.TransactionIsolationLevel.Serializable`) — the
 * strongest isolation level Postgres offers, using Serializable Snapshot
 * Isolation (SSI). This is a real, engine-enforced guarantee, not an
 * application-level approximation: PostgreSQL tracks the actual rows this
 * transaction reads and writes, and if ANY concurrent transaction (at any
 * isolation level — sync, rebuild, or a reorg-marking pass included)
 * commits a change that would make this transaction's result inconsistent
 * with *some* serial (one-at-a-time) execution order, PostgreSQL aborts
 * THIS transaction with a serialization failure (SQLSTATE 40001, surfaced
 * by Prisma as error code P2034) rather than let it commit against stale
 * data. That failure can occur at any statement, including implicitly at
 * COMMIT. On a serialization failure, this module retries the whole
 * transaction body up to 3 times (matching the existing repo-native retry
 * pattern in `sync-state-store.ts`'s `runCursorTransactionWithRetry`); if
 * every attempt fails, the error propagates and NOTHING commits.
 *
 * The final count-based recheck (re-counting the same ACTIVE conditions
 * checked at the start of the transaction, as the last statement before the
 * transaction body returns) is kept as an explicit, readable belt-and-
 * suspenders check that produces a clear domain error and is exercised by
 * targeted tests — it is not itself what provides the concurrency
 * guarantee. The guarantee comes from PostgreSQL's SERIALIZABLE isolation
 * covering the whole transaction, not from any single query inside it.
 *
 * Apply mode fails closed if the client passed in does not expose Prisma's
 * `$transaction(fn, { isolationLevel })` capability: it throws before doing
 * any work rather than silently running unprotected. Dry-run mode never
 * opens a transaction because it performs no writes.
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
  /** Planned in dry-run, actual (post-revalidation) in apply mode. */
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

  // STAKE evidence selection is native pHEX-specific (CORE_PROTOCOLS.hex,
  // PHEX_ADDRESS) — those are PulseChain-only identities. Reject any other
  // chainId up front, before any candidate scan, rather than silently
  // scanning a chain the STAKE producer never runs on.
  if (args.family === "STAKE" && args.chainId !== PULSECHAIN_REFERENCE.id) {
    throw new Error(
      `canonical-provenance-repair: STAKE repair is PulseChain-only (chainId ${PULSECHAIN_REFERENCE.id}); got chainId ${args.chainId}.`,
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

type PendingRepair<TPlan> = {
  actionId: string;
  txHash: string;
  blockHash: string;
  evidenceRowsPlanned: number;
  transferIds: string[];
  planEntries: TPlan[];
};

type EligibilityModel = {
  findMany(args: unknown): Promise<Array<{ id: string }>>;
  count(args: unknown): Promise<number>;
};

type ActionModelKey = "rawDexSwap" | "rawLpAction" | "rawStakeAction";

/**
 * The Prisma capability this module requires for apply mode: an interactive
 * transaction that accepts an explicit isolation level. A client lacking
 * this (for example a bare `Prisma.TransactionClient` already inside
 * another transaction, which cannot itself open a nested transaction with
 * its own isolation level) cannot provide the concurrency guarantee this
 * module depends on, and apply mode must refuse to run rather than execute
 * unprotected.
 */
type SerializableTransactionCapableClient = SyncDbClient & {
  $transaction<T>(
    fn: (tx: SyncDbClient) => Promise<T>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

function hasSerializableTransactionCapability(
  client: SyncDbClient,
): client is SerializableTransactionCapableClient {
  return typeof (client as { $transaction?: unknown }).$transaction === "function";
}

const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

/**
 * Prisma surfaces a PostgreSQL serialization failure (SQLSTATE 40001) or a
 * detected deadlock (40P01) as error code P2034: "Transaction failed due to
 * a write conflict or a deadlock. Please retry your transaction." Retrying
 * a bounded number of times on exactly this code matches the existing
 * repo-native pattern in `sync-state-store.ts`'s
 * `runCursorTransactionWithRetry` / `isRetryableCursorConflict`. Unlike that
 * cursor-merge path, this module's writes are not also unique-constrained
 * (evidence inserts use `skipDuplicates`, and the status update carries no
 * unique constraint), so P2002 is not included here — it would never
 * legitimately fire from this write shape.
 */
function isRetryableSerializationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

/**
 * Opens the ONE Serializable-isolation transaction apply mode writes
 * through, retrying up to `MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS` times on a
 * PostgreSQL serialization failure / deadlock (Prisma P2034) before letting
 * the error propagate. Fails closed — throws immediately, before any DB
 * call — if the client does not expose `$transaction` with isolation-level
 * support; it never falls back to running the operation non-transactionally.
 */
async function runSerializableTransactionWithRetry<T>(
  client: SyncDbClient,
  operation: (tx: SyncDbClient) => Promise<T>,
): Promise<T> {
  if (!hasSerializableTransactionCapability(client)) {
    throw new Error(
      "canonical-provenance-repair: apply mode requires a Prisma client capable of " +
        "an interactive $transaction with an explicit isolationLevel (Serializable). " +
        "The provided client does not expose this capability; refusing to run apply " +
        "mode unprotected against concurrent canonical-state changes rather than " +
        "silently falling back to a non-transactional write.",
    );
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (
        attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS ||
        !isRetryableSerializationConflict(error)
      ) {
        throw error;
      }
    }
  }

  // Unreachable (the loop above always returns or throws), but keeps
  // TypeScript's control-flow analysis satisfied without an unsafe `!`.
  throw lastError;
}

/**
 * Apply-mode-only write path. Unlike a "revalidate, then separately persist"
 * two-step (two separate database operations with an unguarded gap between
 * them), this opens exactly ONE Serializable-isolation transaction that
 * performs the eligibility recheck, the evidence/status write (via the
 * existing PR #376 persister, executed against the transaction client so it
 * never opens a second, separate transaction), and a final count-based
 * guard — all as part of the same atomic unit. See the module doc for the
 * precise database guarantee this provides.
 *
 * Dry-run mode never opens a transaction, never re-queries, and never
 * mutates the report — it already reflects scan-time state, which is what a
 * dry-run report is supposed to show.
 */
async function applyPendingRepairsAtomically<TPlan>(args: {
  apply: boolean;
  client: SyncDbClient;
  pending: readonly PendingRepair<TPlan>[];
  report: CanonicalProvenanceRepairReport;
  actionModelKey: ActionModelKey;
  persist: (plans: TPlan[], tx: SyncDbClient) => Promise<{ count: number }>;
}): Promise<{ count: number }> {
  const { apply, client, pending, report, actionModelKey, persist } = args;

  if (!apply || pending.length === 0) {
    return { count: 0 };
  }

  return runSerializableTransactionWithRetry(client, async (tx) => {
    const actionModel = tx[actionModelKey] as unknown as EligibilityModel;
    const transferModel = tx.rawTokenTransfer as unknown as EligibilityModel;

    const actionIds = [...new Set(pending.map((item) => item.actionId))];
    const transferIds = [...new Set(pending.flatMap((item) => item.transferIds))];

    // Step 1: re-check eligibility inside this transaction, as close to the
    // write as this codebase's Prisma model API allows.
    const [eligibleActionRows, activeTransferRows] = await Promise.all([
      actionModel.findMany({
        where: {
          id: { in: actionIds },
          status: "ACTIVE",
          rawTransferEvidenceStatus: null,
        },
        select: { id: true },
      }),
      transferIds.length === 0
        ? Promise.resolve([])
        : transferModel.findMany({
            where: { id: { in: transferIds }, status: "ACTIVE" },
            select: { id: true },
          }),
    ]);

    const eligibleActionIds = new Set(eligibleActionRows.map((row) => row.id));
    const activeTransferIds = new Set(activeTransferRows.map((row) => row.id));

    const survivors: PendingRepair<TPlan>[] = [];

    for (const item of pending) {
      const actionStillEligible = eligibleActionIds.has(item.actionId);
      const transfersStillActive = item.transferIds.every((id) => activeTransferIds.has(id));

      if (actionStillEligible && transfersStillActive) {
        survivors.push(item);
        continue;
      }

      report.deterministicallyRepairable -= 1;
      report.evidenceRowsPlanned -= item.evidenceRowsPlanned;
      report.repaired = report.repaired.filter((row) => row.actionId !== item.actionId);
      report.unresolved.push({
        actionId: item.actionId,
        txHash: item.txHash,
        blockHash: item.blockHash,
        reason: "revalidation-failed-possible-reorg",
      });
    }

    if (survivors.length === 0) {
      return { count: 0 };
    }

    const finalPlans = survivors.flatMap((item) => item.planEntries);

    // Step 2: the actual write, via the exact PR #376 persister, executed
    // against `tx`. `tx` is an interactive-transaction client and does not
    // itself expose `$transaction`, so persistRaw*TransferEvidence's own
    // internal transaction-detection falls through to running directly
    // against `tx` — its createMany + updateMany become part of THIS
    // transaction, not a second one.
    const persistResult = await persist(finalPlans, tx);

    // Step 3: final belt-and-suspenders recheck, the last read before this
    // transaction body returns. Re-counts the exact same ACTIVE conditions
    // checked in step 1 for every surviving id. This is NOT what provides
    // the concurrency guarantee — that comes from PostgreSQL SERIALIZABLE
    // isolation covering this entire transaction (see module doc): if any
    // concurrent transaction committed a change this transaction's result
    // depends on, PostgreSQL aborts this transaction with a serialization
    // failure regardless of what this guard finds. This guard exists so a
    // still-committed-successfully transaction that nonetheless observed a
    // stale count (a case the database guarantee is not expected to leave
    // open, but this is cheap insurance against a mistaken assumption about
    // that guarantee) produces a clear, testable domain error instead of
    // silently persisting evidence built from a snapshot the code itself no
    // longer trusts.
    const survivorActionIds = [...new Set(survivors.map((item) => item.actionId))];
    const survivorTransferIds = [...new Set(survivors.flatMap((item) => item.transferIds))];

    const [finalActiveActionCount, finalActiveTransferCount] = await Promise.all([
      actionModel.count({ where: { id: { in: survivorActionIds }, status: "ACTIVE" } }),
      survivorTransferIds.length === 0
        ? Promise.resolve(0)
        : transferModel.count({
            where: { id: { in: survivorTransferIds }, status: "ACTIVE" },
          }),
    ]);

    if (
      finalActiveActionCount !== survivorActionIds.length ||
      finalActiveTransferCount !== survivorTransferIds.length
    ) {
      throw new Error(
        "canonical-provenance-repair: concurrent canonical state change detected immediately before commit; rolled back to avoid persisting stale evidence.",
      );
    }

    return persistResult;
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

    type SwapPlan = {
      chainId: number;
      txHash: string;
      blockHash: string;
      logIndex: number;
      legRole: "SOLD" | "BOUGHT";
      rawTokenTransferIds: readonly string[];
    };
    const pending: PendingRepair<SwapPlan>[] = [];

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

      const evidenceRowsPlanned =
        shape.sold.rawTokenTransferIds.length + shape.bought.rawTokenTransferIds.length;

      pending.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned,
        transferIds: [...shape.sold.rawTokenTransferIds, ...shape.bought.rawTokenTransferIds],
        planEntries: [
          {
            chainId: args.chainId,
            txHash: action.txHash,
            blockHash: action.blockHash,
            logIndex: action.logIndex,
            legRole: "SOLD",
            rawTokenTransferIds: shape.sold.rawTokenTransferIds,
          },
          {
            chainId: args.chainId,
            txHash: action.txHash,
            blockHash: action.blockHash,
            logIndex: action.logIndex,
            legRole: "BOUGHT",
            rawTokenTransferIds: shape.bought.rawTokenTransferIds,
          },
        ],
      });

      report.deterministicallyRepairable += 1;
      report.repaired.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned,
      });
      report.evidenceRowsPlanned += evidenceRowsPlanned;
    }

    const applyResult = await applyPendingRepairsAtomically({
      apply,
      client,
      pending,
      report,
      actionModelKey: "rawDexSwap",
      persist: (plans, tx) => persistRawDexSwapTransferEvidence(plans, tx as never),
    });
    report.actionsBecameRecorded = report.deterministicallyRepairable;
    report.evidenceRowsCreated = applyResult.count;

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

    type LpPlan = {
      chainId: number;
      txHash: string;
      blockHash: string;
      logIndex: number;
      legRole: string;
      rawTokenTransferIds: readonly string[];
    };
    const pending: PendingRepair<LpPlan>[] = [];

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

      const evidenceRowsPlanned = legPlans.reduce(
        (sum, plan) => sum + plan.rawTokenTransferIds.length,
        0,
      );

      pending.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned,
        transferIds: legPlans.flatMap((plan) => [...plan.rawTokenTransferIds]),
        planEntries: legPlans,
      });

      report.deterministicallyRepairable += 1;
      report.repaired.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned,
      });
      report.evidenceRowsPlanned += evidenceRowsPlanned;
    }

    const applyResult = await applyPendingRepairsAtomically({
      apply,
      client,
      pending,
      report,
      actionModelKey: "rawLpAction",
      persist: (plans, tx) => persistRawLpActionTransferEvidence(plans, tx as never),
    });
    report.actionsBecameRecorded = report.deterministicallyRepairable;
    report.evidenceRowsCreated = applyResult.count;

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

  type StakePlan = {
    chainId: number;
    txHash: string;
    blockHash: string;
    actionKind: "START" | "END";
    actionIndex: number;
    legRole: string;
    rawTokenTransferIds: readonly string[];
  };
  const pending: PendingRepair<StakePlan>[] = [];

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

      pending.push({
        actionId: action.id,
        txHash: action.txHash,
        blockHash: action.blockHash,
        evidenceRowsPlanned: shape.rawTokenTransferIds.length,
        transferIds: [...shape.rawTokenTransferIds],
        planEntries: [
          {
            chainId: args.chainId,
            txHash: action.txHash,
            blockHash: action.blockHash,
            actionKind: "START",
            actionIndex: 0,
            legRole: "PRINCIPAL_LOCKED_OUT",
            rawTokenTransferIds: shape.rawTokenTransferIds,
          },
        ],
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

    pending.push({
      actionId: action.id,
      txHash: action.txHash,
      blockHash: action.blockHash,
      evidenceRowsPlanned: shape.rawTokenTransferIds.length,
      transferIds: [...shape.rawTokenTransferIds],
      planEntries: [
        {
          chainId: args.chainId,
          txHash: action.txHash,
          blockHash: action.blockHash,
          actionKind: "END",
          actionIndex: 0,
          legRole: "RETURN_IN",
          rawTokenTransferIds: shape.rawTokenTransferIds,
        },
      ],
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

  const applyResult = await applyPendingRepairsAtomically({
    apply,
    client,
    pending,
    report,
    actionModelKey: "rawStakeAction",
    persist: (plans, tx) => persistRawStakeActionTransferEvidence(plans, tx as never),
  });
  report.actionsBecameRecorded = report.deterministicallyRepairable;
  report.evidenceRowsCreated = applyResult.count;

  report.nextCursorId =
    candidates.length === maxActions ? candidates[candidates.length - 1].id : null;
  report.unresolvedCount = report.unresolved.length;
  return report;
}
