import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import type { CanonicalLedgerEntryDraft, NormalizedActionType } from "@/services/normalization";

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
};

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
 * For every surviving in-batch FEE draft (selectCanonicalFeeDrafts already
 * resolved in-batch ties), look up any already-persisted FEE LedgerEntry
 * for the same (chainId, walletId, txHash) — matched without assetId, for
 * the same reason described on selectCanonicalFeeDrafts — and resolve to
 * one of:
 *   - No persisted row: insert the in-batch draft normally.
 *   - Persisted row's action group already outranks or ties the in-batch
 *     draft: drop the in-batch draft; the persisted row is left untouched
 *     (id, dedupeKey, quantity, asset, action group all unchanged).
 *   - In-batch draft outranks the persisted row's action group: re-home the
 *     persisted row in place (update only its actionGroupId — never its id,
 *     dedupeKey, quantity, or asset) to the winning action group, and drop
 *     the in-batch draft (the canonical row already exists under the
 *     correct identity, nothing new needs inserting).
 *
 * This never deletes raw evidence, never touches a non-FEE entry, and never
 * reads or writes outside the exact transactions present in this batch.
 */
async function resolveCanonicalFeeOwnership(
  entries: Map<string, CanonicalLedgerEntryDraft & { actionGroupId: string; id: string }>,
  client: LedgerStoreClient,
) {
  const feeCandidates = Array.from(entries.entries()).filter(
    ([, entry]) => entry.entryType === "FEE",
  );
  if (feeCandidates.length === 0) {
    return;
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
    return;
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

  const reassignments: Array<{ id: string; actionGroupId: string }> = [];

  for (const [entryIdentity, entry] of feeCandidates) {
    const existing = bestExistingByTx.get(feeTxIdentityKey(entry));
    if (!existing) {
      continue;
    }

    if (feeOwnerPriority(existing.actionType) <= feeOwnerPriority(entry.actionType)) {
      entries.delete(entryIdentity);
      continue;
    }

    reassignments.push({ id: existing.id, actionGroupId: entry.actionGroupId });
    entries.delete(entryIdentity);
  }

  for (const reassignment of reassignments) {
    await client.ledgerEntry.updateMany({
      where: { id: { in: [reassignment.id] } },
      data: { actionGroupId: reassignment.actionGroupId },
    });
  }
}

export async function persistNormalizedLedger(
  drafts: readonly CanonicalLedgerEntryDraft[],
  client: LedgerStoreClient = getDb(),
) {
  if (drafts.length === 0) {
    return {
      actionGroupCount: 0,
      entryCount: 0,
    };
  }

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

  await resolveCanonicalFeeOwnership(entries, client);

  // Never persist an action group that ends up with zero entries in this
  // batch — e.g. a family whose only contribution was a FEE draft that lost
  // canonical ownership (either to another in-batch draft, or to an
  // already-persisted higher-priority row) above.
  const referencedActionGroupIds = new Set(
    Array.from(entries.values()).map((entry) => entry.actionGroupId),
  );
  const actionGroupsToPersist = Array.from(actionGroups.values()).filter((group) =>
    referencedActionGroupIds.has(group.id),
  );

  const createdActionGroups = await client.ledgerActionGroup.createMany({
    data: actionGroupsToPersist,
    skipDuplicates: true,
  });

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

  return {
    actionGroupCount: createdActionGroups.count,
    entryCount: createdEntries.count,
  };
}

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

  if (client.$transaction) {
    return client.$transaction(run);
  }

  return run(client);
}

function buildDeterministicId(prefix: string, parts: readonly string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join(":")).digest("hex")}`;
}
