import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

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

  for (const draft of drafts) {
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

  const createdActionGroups = await client.ledgerActionGroup.createMany({
    data: Array.from(actionGroups.values()),
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
