import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

type LedgerStoreClient = {
  ledgerActionGroup: {
    upsert(args: {
      where: {
        chainId_walletId_actionGroupKey: {
          chainId: number;
          walletId: string;
          actionGroupKey: string;
        };
      };
      create: {
        id: string;
        chainId: number;
        walletId: string;
        txHash: string;
        actionGroupKey: string;
        actionType: string;
        occurredAt: Date;
      };
      update: {
        txHash: string;
        actionType: string;
        occurredAt: Date;
      };
    }): Promise<unknown>;
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

  for (const actionGroup of actionGroups.values()) {
    await client.ledgerActionGroup.upsert({
      where: {
        chainId_walletId_actionGroupKey: {
          chainId: actionGroup.chainId,
          walletId: actionGroup.walletId,
          actionGroupKey: actionGroup.actionGroupKey,
        },
      },
      create: actionGroup,
      update: {
        txHash: actionGroup.txHash,
        actionType: actionGroup.actionType,
        occurredAt: actionGroup.occurredAt,
      },
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

  return {
    actionGroupCount: actionGroups.size,
    entryCount: createdEntries.count,
  };
}

function buildDeterministicId(prefix: string, parts: readonly string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join(":")).digest("hex")}`;
}
