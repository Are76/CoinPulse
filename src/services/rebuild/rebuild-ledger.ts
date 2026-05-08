import "server-only";

import type { SourceFamily } from "@prisma/client";

import { getDb } from "@/lib/db";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import {
  readWalletDexSwapSnapshots,
  readWalletRawLpActions,
  readWalletRawStakeActions,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";
import {
  deleteScopedLedgerEntries,
  persistNormalizedLedger,
} from "@/services/sync/ledger-store";
import {
  getOccurredAtForDexSwap,
  getOccurredAtForLpAction,
  getOccurredAtForStakeAction,
  getOccurredAtForTransfer,
} from "@/services/sync/sync-common";
import { normalizeDexSwaps } from "@/services/sync/dex-sync";
import { normalizeLpActions } from "@/services/sync/lp-sync";
import { normalizeStakeActions } from "@/services/sync/stake-sync";
import { normalizeTransfers } from "@/services/sync/transfer-sync";

const SUPPORTED_REBUILD_SOURCE_FAMILIES = [
  "TRANSFERS",
  "DEX",
  "LP",
  "STAKING",
] as const satisfies readonly SourceFamily[];

const SOURCE_FAMILY_ACTION_TYPES: Record<
  (typeof SUPPORTED_REBUILD_SOURCE_FAMILIES)[number],
  readonly string[]
> = {
  TRANSFERS: ["TRANSFER"],
  DEX: ["SWAP"],
  LP: ["LP_ADD", "LP_REMOVE"],
  STAKING: ["HEX_STAKE_START", "HEX_STAKE_END", "HEX_STAKE_LOCK"],
};

type RebuildDbClient = {
  rawBlock: {
    findMany(args: {
      where: {
        chainId: number;
        blockNumber: {
          gte: bigint;
          lte: bigint;
        };
      };
    }): Promise<
      Array<{
        blockNumber: bigint;
        blockHash: string;
        timestamp: Date;
      }>
    >;
  };
  rawTokenTransfer: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  rawDexSwap: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  rawLpAction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  rawStakeAction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  ledgerActionGroup: {
    createMany: typeof getDb extends () => infer T
      ? T extends { ledgerActionGroup: { createMany: infer F } }
        ? F
        : never
      : never;
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
    }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  ledgerEntry: {
    createMany: typeof getDb extends () => infer T
      ? T extends { ledgerEntry: { createMany: infer F } }
        ? F
        : never
      : never;
    findMany(args: {
      where: {
        chainId: number;
        walletId: string;
        actionGroupId: {
          in: string[];
        };
      };
    }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  $transaction?<T>(callback: (client: RebuildDbClient) => Promise<T>): Promise<T>;
};

export type RebuildLedgerReport = {
  wallet: string;
  chainId: number;
  fromBlock: bigint;
  toBlock: bigint;
  sourceFamilies: SourceFamily[];
  sourceFamiliesIncluded: SourceFamily[];
  rawSnapshotsProcessed: number;
  ledgerEntriesDeleted: number;
  ledgerEntriesRecreated: number;
  skippedCount: number;
  skippedSnapshots: number;
  unsupportedSourceFamilies: number;
  warnings: string[];
};

export async function rebuildCanonicalLedger(args: {
  wallet: {
    id: string;
    chainId: number;
    address: string;
  };
  fromBlock: bigint;
  toBlock: bigint;
  sourceFamilies: SourceFamily[];
  normalizerVersion?: string;
  db?: RebuildDbClient;
}): Promise<RebuildLedgerReport> {
  const db = args.db ?? (getDb() as unknown as RebuildDbClient);
  const normalizerVersion = args.normalizerVersion ?? "v1";
  const sourceFamiliesIncluded = args.sourceFamilies.filter(isSupportedSourceFamily);
  const unsupportedSourceFamilies = args.sourceFamilies.length - sourceFamiliesIncluded.length;
  const warnings =
    unsupportedSourceFamilies > 0
      ? [
          `unsupported-source-families:${args.sourceFamilies
            .filter((family) => !isSupportedSourceFamily(family))
            .join(",")}`,
        ]
      : [];
  const timestampByBlockKey = await readTimestampByBlockKey({
    chainId: args.wallet.chainId,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    db,
  });

  const familyResults = await Promise.all(
    sourceFamiliesIncluded.map(async (sourceFamily) => {
      const rawSnapshots = await readRawSnapshots({
        db,
        wallet: args.wallet,
        sourceFamily,
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
      });
      const drafts = normalizeRawSnapshots({
        wallet: args.wallet,
        sourceFamily,
        rawSnapshots,
        timestampByBlockKey,
        normalizerVersion,
      });

      return {
        sourceFamily,
        rawSnapshots,
        drafts,
      };
    }),
  );

  const drafts = familyResults.flatMap((result) => result.drafts);
  const deleteScopeTxHashes = Array.from(
    new Set(
      familyResults.flatMap((result) =>
        result.rawSnapshots.map((snapshot) => snapshot.txHash.toLowerCase()),
      ),
    ),
  );
  const run = async (client: RebuildDbClient) => {
    const deleted = await deleteScopedLedgerEntries(
      {
        chainId: args.wallet.chainId,
        walletId: args.wallet.id,
        actionTypes: sourceFamiliesIncluded.flatMap(
          (sourceFamily) => SOURCE_FAMILY_ACTION_TYPES[sourceFamily],
        ),
        txHashes: deleteScopeTxHashes,
        occurredAtRange: inferOccurredAtRange(timestampByBlockKey),
      },
      client,
    );
    const persisted = await persistNormalizedLedger(drafts, client);

    return { deleted, persisted };
  };
  const { deleted, persisted } = db.$transaction
    ? await db.$transaction(run)
    : await run(db);
  const skippedSnapshots = familyResults.reduce(
    (total, result) =>
      total + Math.max(0, result.rawSnapshots.length - countDistinctActionGroups(result.drafts)),
    0,
  );

  return {
    wallet: args.wallet.address,
    chainId: args.wallet.chainId,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    sourceFamilies: sourceFamiliesIncluded,
    sourceFamiliesIncluded,
    rawSnapshotsProcessed: familyResults.reduce(
      (total, result) => total + result.rawSnapshots.length,
      0,
    ),
    ledgerEntriesDeleted: deleted.entryCount,
    ledgerEntriesRecreated: persisted.entryCount,
    skippedCount: skippedSnapshots,
    skippedSnapshots,
    unsupportedSourceFamilies,
    warnings,
  };
}

type RebuildRawSnapshot =
  | Awaited<ReturnType<typeof readWalletTransferRawTokenTransfers>>[number]
  | Awaited<ReturnType<typeof readWalletDexSwapSnapshots>>[number]
  | Awaited<ReturnType<typeof readWalletRawLpActions>>[number]
  | Awaited<ReturnType<typeof readWalletRawStakeActions>>[number];

async function readRawSnapshots(args: {
  db: RebuildDbClient;
  wallet: {
    chainId: number;
    address: string;
  };
  sourceFamily: (typeof SUPPORTED_REBUILD_SOURCE_FAMILIES)[number];
  fromBlock: bigint;
  toBlock: bigint;
}) {
  switch (args.sourceFamily) {
    case "TRANSFERS":
      return readWalletTransferRawTokenTransfers(
        {
          chainId: args.wallet.chainId,
          walletAddress: args.wallet.address,
          fromBlock: args.fromBlock,
          toBlock: args.toBlock,
        },
        args.db,
      );
    case "DEX":
      return readWalletDexSwapSnapshots(
        {
          chainId: args.wallet.chainId,
          walletAddress: args.wallet.address,
          fromBlock: args.fromBlock,
          toBlock: args.toBlock,
        },
        args.db,
      );
    case "LP":
      return readWalletRawLpActions(
        {
          chainId: args.wallet.chainId,
          walletAddress: args.wallet.address,
          fromBlock: args.fromBlock,
          toBlock: args.toBlock,
        },
        args.db,
      );
    case "STAKING":
      return readWalletRawStakeActions(
        {
          chainId: args.wallet.chainId,
          walletAddress: args.wallet.address,
          fromBlock: args.fromBlock,
          toBlock: args.toBlock,
        },
        args.db,
      );
  }
}

function normalizeRawSnapshots(args: {
  wallet: {
    id: string;
    chainId: number;
    address: string;
  };
  sourceFamily: (typeof SUPPORTED_REBUILD_SOURCE_FAMILIES)[number];
  rawSnapshots: readonly RebuildRawSnapshot[];
  timestampByBlockKey: Map<string, Date>;
  normalizerVersion: string;
}) {
  switch (args.sourceFamily) {
    case "TRANSFERS":
      return normalizeTransfers({
        normalizerVersion: args.normalizerVersion,
        wallet: args.wallet,
        rawLogs: args.rawSnapshots.map((rawSnapshot) => ({
          ...(rawSnapshot as Awaited<
            ReturnType<typeof readWalletTransferRawTokenTransfers>
          >[number]),
          occurredAt: getOccurredAtForTransfer(
            rawSnapshot as Awaited<ReturnType<typeof readWalletTransferRawTokenTransfers>>[number],
            args.timestampByBlockKey,
          ),
        })),
      });
    case "DEX":
      return normalizeDexSwaps({
        normalizerVersion: args.normalizerVersion,
        wallet: args.wallet,
        rawLogs: args.rawSnapshots.map((rawSnapshot) => ({
          ...(rawSnapshot as Awaited<ReturnType<typeof readWalletDexSwapSnapshots>>[number]),
          occurredAt: getOccurredAtForDexSwap(
            rawSnapshot as Awaited<ReturnType<typeof readWalletDexSwapSnapshots>>[number],
            args.timestampByBlockKey,
          ),
        })),
      });
    case "LP":
      return normalizeLpActions({
        normalizerVersion: args.normalizerVersion,
        wallet: args.wallet,
        rawLogs: args.rawSnapshots.map((rawSnapshot) => ({
          ...(rawSnapshot as Awaited<ReturnType<typeof readWalletRawLpActions>>[number]),
          occurredAt: getOccurredAtForLpAction(
            rawSnapshot as Awaited<ReturnType<typeof readWalletRawLpActions>>[number],
            args.timestampByBlockKey,
          ),
        })),
      });
    case "STAKING":
      return normalizeStakeActions({
        normalizerVersion: args.normalizerVersion,
        wallet: args.wallet,
        rawLogs: args.rawSnapshots.map((rawSnapshot) => ({
          ...(rawSnapshot as Awaited<ReturnType<typeof readWalletRawStakeActions>>[number]),
          occurredAt: getOccurredAtForStakeAction(
            rawSnapshot as Awaited<ReturnType<typeof readWalletRawStakeActions>>[number],
            args.timestampByBlockKey,
          ),
        })),
      });
  }
}

async function readTimestampByBlockKey(args: {
  chainId: number;
  fromBlock: bigint;
  toBlock: bigint;
  db: RebuildDbClient;
}) {
  const rawBlocks = await args.db.rawBlock.findMany({
    where: {
      chainId: args.chainId,
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
    },
  });

  return new Map(
    rawBlocks.map((block) => [
      `${block.blockNumber}:${block.blockHash.toLowerCase()}`,
      block.timestamp,
    ]),
  );
}

function inferOccurredAtRange(timestampByBlockKey: Map<string, Date>) {
  const timestamps = Array.from(timestampByBlockKey.values()).sort(
    (left, right) => left.getTime() - right.getTime(),
  );

  if (timestamps.length === 0) {
    return undefined;
  }

  return {
    gte: timestamps[0],
    lte: timestamps[timestamps.length - 1],
  };
}

function countDistinctActionGroups(drafts: readonly CanonicalLedgerEntryDraft[]) {
  return new Set(drafts.map((draft) => draft.actionGroupKey)).size;
}

function isSupportedSourceFamily(
  sourceFamily: SourceFamily,
): sourceFamily is (typeof SUPPORTED_REBUILD_SOURCE_FAMILIES)[number] {
  return SUPPORTED_REBUILD_SOURCE_FAMILIES.includes(
    sourceFamily as (typeof SUPPORTED_REBUILD_SOURCE_FAMILIES)[number],
  );
}
