import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import type { CanonicalLedgerEntryDraft, NormalizedActionType } from "@/services/normalization";
import { readCanonicallyConsumedRawTokenTransferIds } from "@/services/ingestion/raw-store";

type LedgerStoreClient = {
  ledgerActionGroup: {
    createMany(args: {
      data: Array<{
        id: string;
        chainId: number;
        walletId: string;
        txHash: string;
        actionGroupKey: string;
        actionType: string;
        blockNumber: bigint | null;
        occurredAt: Date;
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; actionType: true };
    }): Promise<Array<{ id: string; actionType: string }>>;
  };
  ledgerEntry: {
    createMany(args: {
      data: Array<{
        id: string;
        chainId: number;
        walletId: string;
        actionGroupId: string;
        tokenId: string | null;
        txHash: string;
        entryType: CanonicalLedgerEntryDraft["entryType"];
        assetId: string;
        quantity: string;
        valueUsd: string | null;
        direction: CanonicalLedgerEntryDraft["direction"];
        normalizerVersion: string;
        occurredAt: Date;
        sourceLogIndex: number | null;
        sourceLogKey: string;
        dedupeKey: string;
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: {
        chainId: { in: number[] };
        walletId: { in: string[] };
        txHash: { in: string[] };
        entryType: "FEE";
        direction: "OUT";
      };
      select: {
        id: true;
        chainId: true;
        walletId: true;
        txHash: true;
        actionGroupId: true;
      };
    }): Promise<
      Array<{
        id: string;
        chainId: number;
        walletId: string;
        txHash: string;
        actionGroupId: string;
      }>
    >;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { actionGroupId: string };
    }): Promise<{ count: number }>;
  };
  /**
   * Entirely separate, fully optional capability used only by
   * reconcileConsumedTransferShadows, kept off the existing
   * ledgerActionGroup/ledgerEntry method shapes above so it never narrows or
   * conflicts with the many existing narrowly-typed test clients that
   * implement only the shapes those callers need. Feature-detected as a
   * whole: when absent, reconciliation is skipped entirely (a no-op), never
   * a partial/best-effort attempt. See reconcileConsumedTransferShadows for
   * why this exists and its exact-identity guarantees.
   */
  transferShadowReconciliation?: {
    findTransferGroups(args: {
      chainId: number;
      walletId: string;
      txHashes: readonly string[];
    }): Promise<Array<{ id: string; txHash: string }>>;
    findGroupEntries(args: {
      actionGroupIds: readonly string[];
    }): Promise<
      Array<{ id: string; actionGroupId: string; txHash: string; sourceLogIndex: number | null }>
    >;
    findActiveRawTransfers(args: {
      chainId: number;
      txHashes: readonly string[];
    }): Promise<Array<{ id: string; txHash: string; logIndex: number }>>;
    // Delegates to the exact same canonical-consumption authority PR #377's
    // own TRANSFER-shadow suppression reads (readCanonicallyConsumedRawTokenTransferIds):
    // an ACTIVE RawTokenTransfer.id proven consumed by ACTIVE,
    // rawTransferEvidenceStatus "RECORDED" SWAP/LP/STAKE evidence. Fails
    // closed (empty set) if the underlying evidence tables are unreachable.
    readConsumedRawTokenTransferIds(
      rawTokenTransferIds: readonly string[],
    ): Promise<ReadonlySet<string>>;
    deleteEntries(args: { ids: readonly string[] }): Promise<{ count: number }>;
    deleteActionGroups(args: { ids: readonly string[] }): Promise<{ count: number }>;
  };
  /**
   * Entirely separate, fully optional capability used only by
   * resolveCanonicalFeeOwnership's caller (persistNormalizedLedgerBatch) to
   * remove a source LedgerActionGroup that resolveCanonicalFeeOwnership's own
   * FEE re-homing left with zero LedgerEntry rows (e.g. a generic TRANSFER
   * group whose only entry was its native-gas FEE, once that FEE is re-homed
   * to a higher-priority SWAP/LP/STAKE group for the same transaction).
   * Feature-detected exactly like transferShadowReconciliation above: when
   * the underlying client does not expose ledgerActionGroup.deleteMany, this
   * is entirely skipped (no orphan cleanup attempted) rather than a
   * partial/best-effort attempt — narrower test clients that never exercise
   * this path are unaffected.
   *
   * Deliberately a single conditional DELETE, not a count-then-delete pair: a
   * separate "count remaining entries" read followed by a later unconditional
   * delete would leave a window between the two round trips where a
   * concurrent transaction could commit a brand-new LedgerEntry into a
   * candidate group that the earlier count already observed as empty, and —
   * since LedgerEntry.actionGroup is onDelete: Cascade (prisma/schema.prisma)
   * — a delete that trusted that stale count would cascade away the
   * newly-committed, legitimate entry along with its now-condemned parent
   * group. Folding the check into the DELETE's own WHERE clause (the
   * `entries: { none: {} }` relation filter, compiled to a
   * `NOT EXISTS (SELECT 1 FROM "LedgerEntry" WHERE "actionGroupId" = ...)`
   * subquery) closes that specific TOCTOU gap between our own read and our
   * own write.
   *
   * The remaining question is a genuinely concurrent transaction whose own
   * INSERT/UPDATE into LedgerEntry (referencing one of these same candidate
   * groups) is still in flight — not yet committed — while this DELETE
   * executes. That case is settled by PostgreSQL's own foreign-key
   * enforcement, independent of isolation level and requiring no additional
   * application-side locking: inserting or re-homing a row that references
   * LedgerActionGroup.id takes a FOR KEY SHARE lock on that referenced parent
   * row for the duration of the referencing transaction (this is the
   * documented purpose of FOR KEY SHARE — see the PostgreSQL "Explicit
   * Locking" chapter — guarding a referenced row against concurrent deletion
   * or key changes while a foreign-key check against it is pending). That
   * lock conflicts with the row lock this DELETE needs on the same parent
   * row, so exactly one of two outcomes is possible, never a silent
   * cascade of the other transaction's row:
   *   - The other transaction's FK-check lock is taken first and it later
   *     commits: this DELETE blocks on that row, then re-evaluates its WHERE
   *     clause against the now-committed data once unblocked (PostgreSQL's
   *     standard read-committed re-check for a concurrently-locked row) —
   *     the relation filter now sees the new entry and excludes the group.
   *   - This DELETE's lock is taken first and it commits: the other
   *     transaction's still-pending FK check then fails with a foreign-key
   *     violation against the now-deleted parent, exactly as inserting any
   *     row against a nonexistent parent id would — an ordinary constraint
   *     conflict for that writer to handle/retry, not data loss.
   * Either way, a legitimate LedgerEntry can never be cascade-deleted by this
   * cleanup. This guarantee is PostgreSQL's own referential-integrity
   * behavior and cannot be exercised by an in-memory test double — the
   * in-memory regression coverage below proves this capability is invoked
   * with the correct candidate scoping and is never bypassed by a stale
   * earlier read, not the underlying database engine's locking semantics.
   */
  feeReassignmentCleanup?: {
    // Deletes only the given candidate LedgerActionGroup ids that have zero
    // related LedgerEntry rows according to the DELETE statement's own
    // relation-filter evaluation — one conditional DELETE, not a separate
    // prior read followed by an unconditional one. See the guarantee this
    // relies on (PostgreSQL foreign-key row locking) in the doc comment
    // above.
    deleteEmptyActionGroups(args: {
      candidateActionGroupIds: readonly string[];
    }): Promise<{ count: number }>;
  };
  $transaction?<T>(callback: (client: LedgerStoreClient) => Promise<T>): Promise<T>;
};

export type PrismaLikeClient = {
  ledgerActionGroup: {
    findMany(args: unknown): Promise<Array<{ id: string; txHash: string }>>;
    deleteMany?(args: unknown): Promise<{ count: number }>;
  };
  ledgerEntry: {
    findMany(
      args: unknown,
    ): Promise<
      Array<{ id: string; actionGroupId: string; txHash: string; sourceLogIndex: number | null }>
    >;
    deleteMany?(args: unknown): Promise<{ count: number }>;
  };
  rawTokenTransfer?: {
    findMany(args: unknown): Promise<Array<{ id: string; txHash: string; logIndex: number }>>;
  };
  $transaction?<T>(
    callback: (tx: PrismaLikeClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

/**
 * Bounds for the interactive transaction persistNormalizedLedger opens
 * around one batch's writes plus reconcileConsumedTransferShadows'
 * read/delete work. Prisma's defaults (maxWait 2000ms, timeout 5000ms) are a
 * reasonable floor but leave little headroom once reconciliation adds
 * several sequential round trips (transfer-group lookup, entry lookup,
 * raw-transfer lookup, evidence check, deletes) on top of the existing
 * create/reassignment work. One persistNormalizedLedger call always covers
 * exactly one bounded sync/rebuild window — the rebuild path is capped by
 * REBUILD_MAX_BLOCK_SPAN (api/validation.ts, 1000 blocks) and live sync
 * windows are smaller still — so the batch this transaction ever covers is
 * bounded, not unbounded, and a generous-but-finite timeout is safe rather
 * than a workaround for an open-ended workload.
 */
export const LEDGER_PERSIST_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 15_000,
} as const;

/**
 * Wraps a full Prisma-shaped client (production getDb(), or a Prisma
 * $transaction callback's tx client) into LedgerStoreClient. Safe to call
 * unconditionally from any production call site, including ones that may
 * receive a narrower test double: the transferShadowReconciliation
 * capability is only attached when the underlying client actually exposes
 * ledgerActionGroup.deleteMany, ledgerEntry.deleteMany, AND
 * rawTokenTransfer.findMany — every other client (missing one or more of
 * these) gets ledgerActionGroup/ledgerEntry passed through unchanged and no
 * transferShadowReconciliation, so persistNormalizedLedger's own
 * feature-detection (see reconcileConsumedTransferShadows) skips
 * reconciliation entirely rather than crashing on a missing method.
 *
 * ownsTransaction (default true) controls whether the returned
 * LedgerStoreClient is allowed to open its own transaction via
 * persistNormalizedLedger's `if (client.$transaction)` check. Pass `false`
 * whenever `db` is ALREADY a transaction-scoped client (e.g. the `client`
 * argument rebuild-ledger.ts's outer `db.$transaction(run, ...)` callback
 * receives) — see the caller-ownership note on `deleteScopedLedgerEntries`
 * for why this must be explicit rather than inferred from `db.$transaction`'s
 * mere presence: Prisma's real interactive-transaction client still exposes
 * a bound `$transaction` method (proven empirically, not merely assumed —
 * confirmed against @prisma/client 7.8.0's driver-adapter Client Engine),
 * and invoking it while already inside a transaction reliably corrupts that
 * engine's transaction bookkeeping, causing the NEXT unrelated top-level
 * `db.$transaction(...)` call in the same process to fail with "Transaction
 * already closed: A start cannot be executed on a committed transaction" —
 * not merely a nested-transaction error on the nested call itself.
 */
export function wrapPrismaClientAsLedgerStore(
  db: PrismaLikeClient,
  options?: { ownsTransaction?: boolean },
): LedgerStoreClient {
  const ownsTransaction = options?.ownsTransaction ?? true;
  const canReconcile =
    typeof db.ledgerActionGroup.deleteMany === "function" &&
    typeof db.ledgerEntry.deleteMany === "function" &&
    typeof db.rawTokenTransfer?.findMany === "function";
  const canCleanupOrphanedFeeSourceGroups = typeof db.ledgerActionGroup.deleteMany === "function";

  return {
    ledgerActionGroup: db.ledgerActionGroup as never,
    ledgerEntry: db.ledgerEntry as never,
    transferShadowReconciliation: canReconcile
      ? {
          async findTransferGroups(args) {
            return db.ledgerActionGroup.findMany({
              where: {
                chainId: args.chainId,
                walletId: args.walletId,
                actionType: { in: ["TRANSFER"] },
                txHash: { in: [...args.txHashes] },
              },
              select: { id: true, txHash: true },
            });
          },
          async findGroupEntries(args) {
            return db.ledgerEntry.findMany({
              where: { actionGroupId: { in: [...args.actionGroupIds] } },
              select: { id: true, actionGroupId: true, txHash: true, sourceLogIndex: true },
            });
          },
          async findActiveRawTransfers(args) {
            return db.rawTokenTransfer!.findMany({
              where: {
                chainId: args.chainId,
                txHash: { in: [...args.txHashes] },
                status: "ACTIVE",
              },
              select: { id: true, txHash: true, logIndex: true },
            });
          },
          async readConsumedRawTokenTransferIds(rawTokenTransferIds) {
            return readCanonicallyConsumedRawTokenTransferIds(
              { rawTokenTransferIds },
              db as never,
            );
          },
          async deleteEntries(args) {
            return db.ledgerEntry.deleteMany!({ where: { id: { in: [...args.ids] } } });
          },
          async deleteActionGroups(args) {
            return db.ledgerActionGroup.deleteMany!({ where: { id: { in: [...args.ids] } } });
          },
        }
      : undefined,
    feeReassignmentCleanup: canCleanupOrphanedFeeSourceGroups
      ? {
          // A single DELETE ... WHERE id IN (candidates) AND entries: none {}
          // — the "no related LedgerEntry rows" condition is evaluated by
          // Postgres as part of executing this one statement, not read
          // separately beforehand. See the LedgerStoreClient type doc above
          // for why a prior separate count would be unsafe.
          async deleteEmptyActionGroups(args) {
            return db.ledgerActionGroup.deleteMany!({
              where: {
                id: { in: [...args.candidateActionGroupIds] },
                entries: { none: {} },
              },
            });
          },
        }
      : undefined,
    $transaction: ownsTransaction && db.$transaction
      ? (callback) =>
          db.$transaction!(
            (tx) => callback(wrapPrismaClientAsLedgerStore(tx)),
            LEDGER_PERSIST_TRANSACTION_OPTIONS,
          )
      : undefined,
  };
}

type ScopedLedgerDeleteClient = {
  ledgerActionGroup: {
    findMany(args: {
      where: {
        chainId: number;
        walletId: string;
        actionType: {
          in: string[];
        };
        txHash?: {
          in: string[];
        };
        occurredAt?: {
          gte: Date;
          lte: Date;
        };
      };
    }): Promise<
      Array<{
        id: string;
      }>
    >;
    deleteMany(args: {
      where: {
        id: {
          in: string[];
        };
      };
    }): Promise<{ count: number }>;
  };
  ledgerEntry: {
    findMany(args: {
      where: {
        chainId: number;
        walletId: string;
        actionGroupId: {
          in: string[];
        };
      };
    }): Promise<
      Array<{
        id: string;
      }>
    >;
    deleteMany(args: {
      where: {
        id: {
          in: string[];
        };
      };
    }): Promise<{ count: number }>;
  };
  $transaction?<T>(callback: (client: ScopedLedgerDeleteClient) => Promise<T>): Promise<T>;
};

export function buildDeterministicActionGroupId(args: {
  chainId: number;
  walletId: string;
  actionGroupKey: string;
}) {
  return buildDeterministicId("lag", [
    String(args.chainId),
    args.walletId,
    args.actionGroupKey,
  ]);
}

export function buildDeterministicLedgerEntryId(args: {
  chainId: number;
  walletId: string;
  dedupeKey: string;
}) {
  return buildDeterministicId("le", [
    String(args.chainId),
    args.walletId,
    args.dedupeKey,
  ]);
}

/**
 * Canonical fee-ownership priority, highest to lowest. A transaction pays
 * gas exactly once; when it also executes a specific protocol action, the
 * fee canonically belongs with that action — matching how
 * calculateAverageCostPnl groups entries strictly by actionGroupId — with
 * the generic TRANSFER action group only as the fallback owner for a plain
 * transfer that has no protocol action at all. This order is fixed and
 * independent of normalization/sync order, source family, or which family
 * happens to persist first.
 */
const FEE_OWNER_ACTION_TYPE_PRIORITY: readonly NormalizedActionType[] = [
  "HEX_STAKE_END",
  "HEX_STAKE_START",
  "HEX_STAKE_LOCK",
  "SWAP",
  "LP_ADD",
  "LP_REMOVE",
  "TRANSFER",
];

function feeOwnerPriority(actionType: string): number {
  const index = FEE_OWNER_ACTION_TYPE_PRIORITY.indexOf(actionType as NormalizedActionType);
  return index === -1 ? FEE_OWNER_ACTION_TYPE_PRIORITY.length : index;
}

function feeTxIdentityKey(row: { chainId: number; walletId: string; txHash: string }) {
  return `${row.chainId}:${row.walletId}:${row.txHash.toLowerCase()}`;
}

/**
 * Keeps, per (chainId, walletId, txHash), only the FEE draft whose
 * actionType has the highest canonical priority (FEE_OWNER_ACTION_TYPE_PRIORITY).
 * All non-FEE drafts pass through unchanged. This runs before any
 * action-group/entry identity is built, so a losing FEE draft's action
 * group is never even considered for persistence — the natural fix for "no
 * empty fee-only action groups" within a single batch. Ties (two drafts of
 * the same actionType, e.g. two stakes started in one multicall
 * transaction) keep the first-encountered draft; either is an equally
 * correct owner since they share the same priority tier.
 *
 * A FEE entry's assetId is intentionally not part of the grouping key: a
 * FEE entry is, by construction, always the chain's native asset. Some
 * snapshots recorded before assetId canonicalization may still carry a
 * legacy symbol-based native asset id (see canonicalizeSnapshotAssetId in
 * sync-common.ts); grouping by assetId would silently fail to recognize two
 * such rows as the same economic fee.
 */
function selectCanonicalFeeDrafts(
  drafts: readonly CanonicalLedgerEntryDraft[],
): CanonicalLedgerEntryDraft[] {
  const bestFeeByTx = new Map<string, CanonicalLedgerEntryDraft>();
  const result: CanonicalLedgerEntryDraft[] = [];

  for (const draft of drafts) {
    if (draft.entryType !== "FEE") {
      result.push(draft);
      continue;
    }

    const key = feeTxIdentityKey(draft);
    const current = bestFeeByTx.get(key);
    if (!current || feeOwnerPriority(draft.actionType) < feeOwnerPriority(current.actionType)) {
      bestFeeByTx.set(key, draft);
    }
  }

  result.push(...bestFeeByTx.values());
  return result;
}

/**
 * Resolves the single canonical owner for each transaction's native
 * gas-fee LedgerEntry against whatever is already persisted, independent of
 * call order across separate persistNormalizedLedger invocations (e.g.
 * separate STAKING then TRANSFERS rebuilds, in either order, run once or
 * repeatedly) and independent of legacy vs. current dedupeKey format.
 *
 * This function only reads and plans — it performs no writes. It mutates
 * the in-memory `entries` map (dropping losing in-batch drafts) but leaves
 * all actual persistence, including the target-action-group existence
 * requirement for any reassignment, to the caller. This split matters: a
 * reassignment's target action group may not exist yet (e.g. this is the
 * first time this specific stake/swap action group is being created), and
 * LedgerEntry.actionGroupId is a required foreign key — updating it before
 * the target group is created would violate that constraint. The caller
 * (persistNormalizedLedger) is responsible for creating every action group
 * a reassignment targets before applying any reassignment update.
 *
 * For every surviving in-batch FEE draft (selectCanonicalFeeDrafts already
 * resolved in-batch ties), look up any already-persisted FEE LedgerEntry
 * for the same (chainId, walletId, txHash) — matched without assetId, for
 * the same reason described on selectCanonicalFeeDrafts — and resolve to
 * one of:
 *   - No persisted row: insert the in-batch draft normally.
 *   - Persisted row's action group already outranks or ties the in-batch
 *     draft: drop the in-batch draft; the persisted row is left untouched
 *     (id, dedupeKey, quantity, asset, action group all unchanged).
 *   - In-batch draft outranks the persisted row's action group: plan to
 *     re-home the persisted row in place (only its actionGroupId — never
 *     its id, dedupeKey, quantity, or asset) to the winning action group,
 *     and drop the in-batch draft (the canonical row already exists under
 *     the correct identity, nothing new needs inserting). The persisted
 *     row's PRE-reassignment actionGroupId is carried on the plan as
 *     `previousActionGroupId` so the caller can later check whether that
 *     source group has been left with zero entries and, if so, remove it —
 *     see the orphan-cleanup step in persistNormalizedLedgerBatch.
 *
 * This never deletes raw evidence, never touches a non-FEE entry, and never
 * reads outside the exact transactions present in this batch.
 */
async function resolveCanonicalFeeOwnership(
  entries: Map<string, CanonicalLedgerEntryDraft & { actionGroupId: string; id: string }>,
  client: LedgerStoreClient,
): Promise<Array<{ id: string; actionGroupId: string; previousActionGroupId: string }>> {
  const feeCandidates = Array.from(entries.entries()).filter(
    ([, entry]) => entry.entryType === "FEE",
  );
  if (feeCandidates.length === 0) {
    return [];
  }

  const existingFees = await client.ledgerEntry.findMany({
    where: {
      chainId: { in: Array.from(new Set(feeCandidates.map(([, entry]) => entry.chainId))) },
      walletId: { in: Array.from(new Set(feeCandidates.map(([, entry]) => entry.walletId))) },
      txHash: {
        in: Array.from(new Set(feeCandidates.map(([, entry]) => entry.txHash.toLowerCase()))),
      },
      entryType: "FEE",
      direction: "OUT",
    },
    select: { id: true, chainId: true, walletId: true, txHash: true, actionGroupId: true },
  });

  if (existingFees.length === 0) {
    return [];
  }

  const actionGroups = await client.ledgerActionGroup.findMany({
    where: { id: { in: Array.from(new Set(existingFees.map((row) => row.actionGroupId))) } },
    select: { id: true, actionType: true },
  });
  const actionTypeByGroupId = new Map(actionGroups.map((group) => [group.id, group.actionType]));

  const bestExistingByTx = new Map<string, { id: string; actionGroupId: string; actionType: string }>();
  for (const row of existingFees) {
    const key = feeTxIdentityKey(row);
    const actionType = actionTypeByGroupId.get(row.actionGroupId) ?? "TRANSFER";
    const current = bestExistingByTx.get(key);
    if (!current || feeOwnerPriority(actionType) < feeOwnerPriority(current.actionType)) {
      bestExistingByTx.set(key, { id: row.id, actionGroupId: row.actionGroupId, actionType });
    }
  }

  const reassignments: Array<{
    id: string;
    actionGroupId: string;
    previousActionGroupId: string;
  }> = [];

  for (const [entryIdentity, entry] of feeCandidates) {
    const existing = bestExistingByTx.get(feeTxIdentityKey(entry));
    if (!existing) {
      continue;
    }

    if (feeOwnerPriority(existing.actionType) <= feeOwnerPriority(entry.actionType)) {
      entries.delete(entryIdentity);
      continue;
    }

    reassignments.push({
      id: existing.id,
      actionGroupId: entry.actionGroupId,
      previousActionGroupId: existing.actionGroupId,
    });
    entries.delete(entryIdentity);
  }

  return reassignments;
}

/**
 * Reconciles a stale generic TRANSFER shadow against the exact canonical
 * RawTokenTransfer it duplicates, whenever this batch is persisting a
 * higher-order (non-TRANSFER) draft for the same transaction.
 *
 * Why this exists: PR #377's suppression check (readCanonicallyConsumedRawTokenTransferIds,
 * consulted by buildTransferNormalizationSnapshots) only prevents a NEW
 * TRANSFER draft from being created once canonical evidence is RECORDED. It
 * cannot retroactively remove a TRANSFER entry that was already persisted
 * before that evidence existed — e.g. the default sync order runs TRANSFERS
 * before STAKING (source-families.ts), so a first full sync can persist a
 * generic TRANSFER for a stake-return transfer before STAKING has recorded
 * the RawStakeActionTransferEvidence that would have suppressed it. A
 * STAKING-only rebuild has the identical gap: rebuild-ledger.ts's delete
 * scope for a STAKING-only rebuild only ever touches HEX_STAKE_* action
 * types, never TRANSFER, so a pre-existing shadow from an earlier run is
 * never cleaned up by re-running STAKING alone.
 *
 * This function closes that gap symmetrically for every higher-order family
 * (SWAP/LP/STAKE all write to the same three evidence tables
 * readCanonicallyConsumedRawTokenTransferIds already reads), using the exact
 * same canonical-identity authority PR #377 itself uses: an ACTIVE
 * RawTokenTransfer.id proven consumed by ACTIVE, rawTransferEvidenceStatus
 * "RECORDED" evidence. It never matches by txHash alone, amount, symbol,
 * direction, or ordering — only by the same (chainId, txHash, logIndex) ->
 * RawTokenTransfer.id identity the normalizer itself uses to build
 * sourceLogIndex, cross-checked against the exact evidence relation.
 *
 * Feature-detected: entirely skipped (no-op) when the client does not expose
 * client.transferShadowReconciliation — narrower test clients that never
 * exercise this path are unaffected. Called from inside
 * persistNormalizedLedger's own transaction, so the delete and the new
 * higher-order entries this batch is about to write commit together or not
 * at all.
 */
async function reconcileConsumedTransferShadows(
  entries: ReadonlyMap<string, CanonicalLedgerEntryDraft & { actionGroupId: string; id: string }>,
  client: LedgerStoreClient,
): Promise<{ actionGroupCount: number; entryCount: number }> {
  const reconciliation = client.transferShadowReconciliation;
  if (!reconciliation) {
    return { actionGroupCount: 0, entryCount: 0 };
  }

  type Scope = { chainId: number; walletId: string; txHashes: Set<string> };
  const scopesByWalletChain = new Map<string, Scope>();

  for (const entry of entries.values()) {
    if (entry.actionType === "TRANSFER") {
      continue;
    }
    const key = `${entry.chainId}:${entry.walletId}`;
    const scope = scopesByWalletChain.get(key) ?? {
      chainId: entry.chainId,
      walletId: entry.walletId,
      txHashes: new Set<string>(),
    };
    scope.txHashes.add(entry.txHash.toLowerCase());
    scopesByWalletChain.set(key, scope);
  }

  if (scopesByWalletChain.size === 0) {
    return { actionGroupCount: 0, entryCount: 0 };
  }

  let actionGroupCount = 0;
  let entryCount = 0;

  for (const scope of scopesByWalletChain.values()) {
    const txHashes = Array.from(scope.txHashes);

    const shadowGroups = await reconciliation.findTransferGroups({
      chainId: scope.chainId,
      walletId: scope.walletId,
      txHashes,
    });
    if (shadowGroups.length === 0) {
      continue;
    }

    const shadowGroupIds = shadowGroups.map((group) => group.id);
    const shadowEntries = await reconciliation.findGroupEntries({
      actionGroupIds: shadowGroupIds,
    });
    const candidateEntries = shadowEntries.filter(
      (entry): entry is typeof entry & { sourceLogIndex: number } =>
        typeof entry.sourceLogIndex === "number",
    );
    if (candidateEntries.length === 0) {
      continue;
    }

    // Exact canonical identity only: (chainId, txHash, logIndex) is the same
    // tuple the normalizer itself embeds in sourceLogIndex/sourceLogKey.
    const rawTransfers = await reconciliation.findActiveRawTransfers({
      chainId: scope.chainId,
      txHashes,
    });
    const transferIdByKey = new Map<string, string>();
    for (const transfer of rawTransfers) {
      transferIdByKey.set(`${transfer.txHash.toLowerCase()}:${transfer.logIndex}`, transfer.id);
    }

    const transferIdByEntryId = new Map<string, string>();
    for (const entry of candidateEntries) {
      const transferId = transferIdByKey.get(`${entry.txHash.toLowerCase()}:${entry.sourceLogIndex}`);
      if (transferId) {
        transferIdByEntryId.set(entry.id, transferId);
      }
    }
    if (transferIdByEntryId.size === 0) {
      continue;
    }

    const consumedTransferIds = await reconciliation.readConsumedRawTokenTransferIds(
      Array.from(new Set(transferIdByEntryId.values())),
    );
    if (consumedTransferIds.size === 0) {
      continue;
    }

    const entryIdsToDelete = Array.from(transferIdByEntryId.entries())
      .filter(([, transferId]) => consumedTransferIds.has(transferId))
      .map(([entryId]) => entryId);
    if (entryIdsToDelete.length === 0) {
      continue;
    }

    const entryIdSet = new Set(entryIdsToDelete);

    // Safety invariant: a LedgerActionGroup may only be deleted when EVERY
    // entry it currently owns (not just the proven-consumed ones) is also
    // being deleted. shadowEntries is the complete membership list per group
    // (fetched by actionGroupId, unfiltered by sourceLogIndex validity), so
    // this check catches any group that turns out to have a surviving
    // sibling entry — never inferred by amount/direction/symbol/ordering,
    // only exact group/entry identity. A generic TRANSFER group is expected
    // to always contain exactly one entry (transfer-normalizer.ts), but this
    // does not rely on that invariant holding.
    const entryIdsByGroup = new Map<string, string[]>();
    for (const entry of shadowEntries) {
      const ids = entryIdsByGroup.get(entry.actionGroupId) ?? [];
      ids.push(entry.id);
      entryIdsByGroup.set(entry.actionGroupId, ids);
    }

    const groupIdsToDelete: string[] = [];
    for (const [groupId, memberEntryIds] of entryIdsByGroup) {
      const anyMemberSelected = memberEntryIds.some((id) => entryIdSet.has(id));
      if (!anyMemberSelected) {
        continue;
      }
      const everyMemberSelected = memberEntryIds.every((id) => entryIdSet.has(id));
      if (everyMemberSelected) {
        groupIdsToDelete.push(groupId);
      }
      // else: a surviving sibling entry exists in this group — the group and
      // its unconsumed sibling(s) are preserved; only the consumed shadow
      // entry (still in entryIdsToDelete below) is removed.
    }

    await reconciliation.deleteEntries({ ids: entryIdsToDelete });
    if (groupIdsToDelete.length > 0) {
      await reconciliation.deleteActionGroups({ ids: groupIdsToDelete });
    }

    entryCount += entryIdsToDelete.length;
    actionGroupCount += groupIdsToDelete.length;
  }

  return { actionGroupCount, entryCount };
}

export async function persistNormalizedLedger(
  drafts: readonly CanonicalLedgerEntryDraft[],
  client: LedgerStoreClient = wrapPrismaClientAsLedgerStore(getDb() as unknown as PrismaLikeClient),
) {
  if (drafts.length === 0) {
    return {
      actionGroupCount: 0,
      entryCount: 0,
    };
  }

  const run = async (transactionClient: LedgerStoreClient) =>
    persistNormalizedLedgerBatch(drafts, transactionClient);

  if (client.$transaction) {
    return client.$transaction(run);
  }

  return run(client);
}

async function persistNormalizedLedgerBatch(
  drafts: readonly CanonicalLedgerEntryDraft[],
  client: LedgerStoreClient,
) {
  const canonicalDrafts = selectCanonicalFeeDrafts(drafts);

  const actionGroups = new Map<
    string,
    {
      id: string;
      chainId: number;
      walletId: string;
      txHash: string;
      actionGroupKey: string;
      actionType: string;
      blockNumber: bigint | null;
      occurredAt: Date;
    }
  >();
  const entries = new Map<
    string,
    CanonicalLedgerEntryDraft & {
      actionGroupId: string;
      id: string;
    }
  >();

  for (const draft of canonicalDrafts) {
    const actionGroupIdentity = `${draft.chainId}:${draft.walletId}:${draft.actionGroupKey}`;
    const actionGroupId = buildDeterministicActionGroupId({
      chainId: draft.chainId,
      walletId: draft.walletId,
      actionGroupKey: draft.actionGroupKey,
    });

    if (!actionGroups.has(actionGroupIdentity)) {
      actionGroups.set(actionGroupIdentity, {
        id: actionGroupId,
        chainId: draft.chainId,
        walletId: draft.walletId,
        txHash: draft.txHash.toLowerCase(),
        actionGroupKey: draft.actionGroupKey,
        actionType: draft.actionType,
        blockNumber: draft.blockNumber,
        occurredAt: draft.occurredAt,
      });
    }

    const entryIdentity = `${draft.chainId}:${draft.walletId}:${draft.dedupeKey}`;

    if (!entries.has(entryIdentity)) {
      entries.set(entryIdentity, {
        ...draft,
        txHash: draft.txHash.toLowerCase(),
        actionGroupId,
        id: buildDeterministicLedgerEntryId({
          chainId: draft.chainId,
          walletId: draft.walletId,
          dedupeKey: draft.dedupeKey,
        }),
      });
    }
  }

  const reassignments = await resolveCanonicalFeeOwnership(entries, client);

  // See reconcileConsumedTransferShadows doc comment: removes any
  // already-persisted generic TRANSFER shadow for the exact RawTokenTransfer
  // this batch's higher-order (non-TRANSFER) drafts prove consumed, in the
  // same transaction as the createMany calls below. Awaited for sequencing
  // only — its counts are not surfaced on persistNormalizedLedger's return
  // shape to avoid widening every existing typed call site.
  await reconcileConsumedTransferShadows(entries, client);

  // Never persist an action group that ends up with zero entries in this
  // batch — e.g. a family whose only contribution was a FEE draft that lost
  // canonical ownership (either to another in-batch draft, or to an
  // already-persisted higher-priority row) above. A reassignment target
  // group must still be created even though its winning FEE draft was
  // removed from `entries` above (the persisted row is being re-homed into
  // it, not re-inserted), so reassignment targets are included explicitly.
  const referencedActionGroupIds = new Set([
    ...Array.from(entries.values()).map((entry) => entry.actionGroupId),
    ...reassignments.map((reassignment) => reassignment.actionGroupId),
  ]);
  const actionGroupsToPersist = Array.from(actionGroups.values()).filter((group) =>
    referencedActionGroupIds.has(group.id),
  );

  // Action groups (including every reassignment target) must exist before
  // any reassignment update runs: LedgerEntry.actionGroupId is a required
  // foreign key, and a reassignment target may be a brand-new group being
  // created for the first time in this very call.
  const createdActionGroups = await client.ledgerActionGroup.createMany({
    data: actionGroupsToPersist,
    skipDuplicates: true,
  });

  for (const reassignment of reassignments) {
    await client.ledgerEntry.updateMany({
      where: { id: { in: [reassignment.id] } },
      data: { actionGroupId: reassignment.actionGroupId },
    });
  }

  const createdEntries = await client.ledgerEntry.createMany({
    data: Array.from(entries.values()).map((entry) => ({
      id: entry.id,
      chainId: entry.chainId,
      walletId: entry.walletId,
      actionGroupId: entry.actionGroupId,
      tokenId: null,
      txHash: entry.txHash,
      entryType: entry.entryType,
      assetId: entry.assetId,
      quantity: entry.quantity,
      valueUsd: null,
      direction: entry.direction,
      normalizerVersion: entry.normalizerVersion,
      occurredAt: entry.occurredAt,
      sourceLogIndex: entry.sourceLogIndex ?? null,
      sourceLogKey: entry.sourceLogKey,
      dedupeKey: entry.dedupeKey,
    })),
    skipDuplicates: true,
  });

  // Remove any source LedgerActionGroup that resolveCanonicalFeeOwnership's
  // re-homing above left with zero LedgerEntry rows (e.g. a generic
  // TRANSFER group whose only entry was its native-gas FEE, now re-homed to
  // a higher-priority SWAP/LP/STAKE group for the same transaction). Scoped
  // only to the exact groups the reassignments above moved a FEE out of, and
  // deleted via one conditional DELETE (feeReassignmentCleanup.deleteEmptyActionGroups)
  // whose own WHERE clause re-checks emptiness rather than trusting a prior
  // read — see that capability's doc comment on LedgerStoreClient for the
  // full guarantee, including why a genuinely concurrent, still-uncommitted
  // writer targeting the same candidate group cannot result in a legitimate
  // entry being silently cascade-deleted (PostgreSQL's FK-referenced-row
  // locking, not application code, is what settles that case). Runs after
  // both the reassignment updates and the new-entry inserts above, inside
  // the same transaction.
  if (reassignments.length > 0 && client.feeReassignmentCleanup) {
    const candidateActionGroupIds = Array.from(
      new Set(
        reassignments
          .map((reassignment) => reassignment.previousActionGroupId)
          .filter((groupId) => !referencedActionGroupIds.has(groupId)),
      ),
    );

    if (candidateActionGroupIds.length > 0) {
      await client.feeReassignmentCleanup.deleteEmptyActionGroups({
        candidateActionGroupIds,
      });
    }
  }

  return {
    actionGroupCount: createdActionGroups.count,
    entryCount: createdEntries.count,
  };
}

/**
 * `alreadyInTransaction` (default false) must be set to `true` whenever
 * `client` is already a transaction-scoped Prisma client (e.g. the callback
 * argument of an outer `db.$transaction(...)`, as in rebuild-ledger.ts).
 * This cannot be inferred from `client.$transaction`'s mere presence:
 * Prisma's real interactive-transaction client (confirmed empirically
 * against @prisma/client 7.8.0's driver-adapter Client Engine, not merely
 * assumed) still exposes a bound `$transaction` method, and calling it while
 * already inside a transaction reliably corrupts that engine's transaction
 * bookkeeping — not by failing the nested call itself, but by causing the
 * NEXT unrelated top-level `db.$transaction(...)` call in the same process
 * to fail with "Transaction already closed: A start cannot be executed on a
 * committed transaction." When `alreadyInTransaction` is true, this function
 * always executes directly against `client`, never opening a second
 * transaction.
 */
export async function deleteScopedLedgerEntries(
  args: {
    chainId: number;
    walletId: string;
    actionTypes: readonly string[];
    txHashes?: readonly string[];
    occurredAtRange?: {
      gte: Date;
      lte: Date;
    };
  },
  client: ScopedLedgerDeleteClient = getDb(),
  options?: { alreadyInTransaction?: boolean },
) {
  if (args.actionTypes.length === 0) {
    return {
      actionGroupCount: 0,
      entryCount: 0,
    };
  }

  const run = async (transactionClient: ScopedLedgerDeleteClient) => {
    const where = {
      chainId: args.chainId,
      walletId: args.walletId,
      actionType: {
        in: [...args.actionTypes],
      },
      ...(args.txHashes && args.txHashes.length > 0
        ? {
            txHash: {
              in: [...args.txHashes],
            },
          }
        : args.occurredAtRange
          ? {
              occurredAt: args.occurredAtRange,
            }
          : {}),
    };

    const actionGroups = await transactionClient.ledgerActionGroup.findMany({
      where,
    });

    if (actionGroups.length === 0) {
      return {
        actionGroupCount: 0,
        entryCount: 0,
      };
    }

    const actionGroupIds = actionGroups.map((group) => group.id);
    const entries = await transactionClient.ledgerEntry.findMany({
      where: {
        chainId: args.chainId,
        walletId: args.walletId,
        actionGroupId: {
          in: actionGroupIds,
        },
      },
    });

    if (entries.length > 0) {
      await transactionClient.ledgerEntry.deleteMany({
        where: {
          id: {
            in: entries.map((entry) => entry.id),
          },
        },
      });
    }

    await transactionClient.ledgerActionGroup.deleteMany({
      where: {
        id: {
          in: actionGroupIds,
        },
      },
    });

    return {
      actionGroupCount: actionGroupIds.length,
      entryCount: entries.length,
    };
  };

  if (!options?.alreadyInTransaction && client.$transaction) {
    return client.$transaction(run);
  }

  return run(client);
}

function buildDeterministicId(prefix: string, parts: readonly string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join(":")).digest("hex")}`;
}
