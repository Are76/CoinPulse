import "server-only";

import type { SourceFamily } from "@prisma/client";

import { PHEX_ADDRESS } from "@/config/assets";
import { SUPPORTED_SYNC_SOURCE_FAMILIES } from "@/services/sync/source-families";
import { getDb } from "@/lib/db";
import { createPublicClientForChain } from "@/services/chains/public-client";
import {
  normalizeNativeTransaction,
  normalizeTransfer,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization";
import { readWalletRawTransactions } from "@/services/ingestion/raw-store";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";
import {
  createPrismaSyncCursorStore,
  createPrismaSyncRunStore,
  type SyncCursorRecord,
} from "@/services/sync/sync-state-store";
import {
  ingestDexSwaps,
  normalizeDexSwaps,
  NATIVE_SWAP_FEE_ASSET,
  type PersistedDexSwapRawLog,
  SWAP_EVENT_TOPIC0,
} from "@/services/sync/dex-sync";
import {
  ingestLpActions,
  normalizeLpActions,
  type PersistedRawLpAction,
} from "@/services/sync/lp-sync";
import {
  ingestStakeActions,
  normalizeStakeActions,
  type PersistedRawStakeAction,
} from "@/services/sync/stake-sync";
import {
  createDefaultSyncClients,
  getOccurredAtForDexSwap,
  getOccurredAtForTransfer,
  ingestWalletTransferArtifacts,
  type PersistedTransferRawLog,
  type SyncDbClient,
  type SyncPublicClient,
  TRANSFER_EVENT_TOPIC0,
} from "@/services/sync/sync-common";

export {
  getOccurredAtForDexSwap,
  getOccurredAtForTransfer,
  NATIVE_SWAP_FEE_ASSET,
  SWAP_EVENT_TOPIC0,
  TRANSFER_EVENT_TOPIC0,
};

export const SUPPORTED_CONCRETE_SOURCE_FAMILIES = SUPPORTED_SYNC_SOURCE_FAMILIES;

export type PersistedTransferRawTransaction = Awaited<
  ReturnType<typeof readWalletRawTransactions>
>[number] & {
  occurredAt: Date;
};

export type PersistedTransferNormalizationSnapshot =
  | ({ snapshotType: "token_transfer" } & PersistedTransferRawLog)
  | ({
      snapshotType: "raw_transaction";
      hasTrackedTokenTransfersInTransaction: boolean;
    } & PersistedTransferRawTransaction);

export function createSyncDependencies(args?: {
  db?: SyncDbClient;
  publicClient?: SyncPublicClient;
  normalizerVersion?: string;
  maxWindowSize?: bigint;
}) {
  const { db, publicClient } = createDefaultSyncClients({
    db: args?.db ?? (getDb() as unknown as SyncDbClient),
    publicClient:
      args?.publicClient ??
      (createPublicClientForChain() as unknown as SyncPublicClient),
  });
  const normalizerVersion = args?.normalizerVersion ?? "v1";
  // SYNC_MAX_WINDOW_SIZE env var allows per-deployment tuning:
  // public RPC → 2, private RPC → 500+, local dev → 2000
  const envWindowSize = process.env.SYNC_MAX_WINDOW_SIZE
    ? BigInt(process.env.SYNC_MAX_WINDOW_SIZE)
    : 2n;
  const maxWindowSize = args?.maxWindowSize ?? envWindowSize;

  return {
    supportedSourceFamilies: [...SUPPORTED_CONCRETE_SOURCE_FAMILIES],
    runStore: createPrismaSyncRunStore(db as never),
    cursorStore: createPrismaSyncCursorStore(db as never),
    persistLedger: (drafts: readonly CanonicalLedgerEntryDraft[]) =>
      persistNormalizedLedger(drafts, db as never),
    ingestSourceFamily: async (ingestArgs: {
      runId: string;
      wallet: { chainId: number; address: string };
      sourceFamily: SourceFamily;
      fromBlock: bigint;
      toBlock: bigint;
      cursor: SyncCursorRecord | null;
    }) => {
      switch (ingestArgs.sourceFamily) {
        case "TRANSFERS":
          return ingestTransfers({
            db,
            publicClient,
            maxWindowSize,
            wallet: ingestArgs.wallet,
            fromBlock: ingestArgs.fromBlock,
            toBlock: ingestArgs.toBlock,
          });
        case "DEX":
          return ingestDexSwaps({
            db,
            publicClient,
            maxWindowSize,
            wallet: ingestArgs.wallet,
            fromBlock: ingestArgs.fromBlock,
            toBlock: ingestArgs.toBlock,
          });
        case "LP":
          return ingestLpActions({
            db,
            publicClient,
            maxWindowSize,
            wallet: ingestArgs.wallet,
            fromBlock: ingestArgs.fromBlock,
            toBlock: ingestArgs.toBlock,
          });
        case "STAKING":
          return ingestStakeActions({
            db,
            publicClient,
            maxWindowSize,
            wallet: ingestArgs.wallet,
            fromBlock: ingestArgs.fromBlock,
            toBlock: ingestArgs.toBlock,
          });
        default:
          throw new Error(
            `Unsupported source family for concrete sync path: ${ingestArgs.sourceFamily}`,
          );
      }
    },
    normalizeSourceFamily: async (normalizeArgs: {
      runId: string;
      wallet: { id: string; chainId: number; address: string };
      sourceFamily: SourceFamily;
      rawLogs: readonly unknown[];
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      switch (normalizeArgs.sourceFamily) {
        case "TRANSFERS":
          return normalizeTransfers({
            normalizerVersion,
            wallet: normalizeArgs.wallet,
            rawLogs:
              normalizeArgs.rawLogs as readonly PersistedTransferNormalizationSnapshot[],
          });
        case "DEX":
          return normalizeDexSwaps({
            normalizerVersion,
            wallet: normalizeArgs.wallet,
            rawLogs: normalizeArgs.rawLogs as readonly PersistedDexSwapRawLog[],
          });
        case "LP":
          return normalizeLpActions({
            normalizerVersion,
            wallet: normalizeArgs.wallet,
            rawLogs: normalizeArgs.rawLogs as readonly PersistedRawLpAction[],
          });
        case "STAKING":
          return normalizeStakeActions({
            normalizerVersion,
            wallet: normalizeArgs.wallet,
            rawLogs: normalizeArgs.rawLogs as readonly PersistedRawStakeAction[],
          });
        default:
          throw new Error(
            `Unsupported source family for concrete sync path: ${normalizeArgs.sourceFamily}`,
          );
      }
    },
  };
}

async function ingestTransfers(args: {
  db: SyncDbClient;
  publicClient: SyncPublicClient;
  maxWindowSize: bigint;
  wallet: { chainId: number; address: string };
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const artifacts = await ingestWalletTransferArtifacts(args);

  return {
    rawLogCount: artifacts.rawLogCount,
    latestBlockHash: artifacts.latestBlockHash,
    logs: buildTransferNormalizationSnapshots({
      rawTransfers: artifacts.rawTransfers,
      rawTransactions: artifacts.rawTransactions,
      protocolOperationTxHashes: artifacts.protocolOperationTxHashes,
      timestampByBlockKey: artifacts.timestampByBlockKey,
    }),
    fromBlock: artifacts.fromBlock,
    toBlock: artifacts.toBlock,
    warnings: artifacts.warnings,
  };
}

export function normalizeTransfers(args: {
  normalizerVersion: string;
  wallet: { id: string; chainId: number; address: string };
  rawLogs:
    | readonly PersistedTransferNormalizationSnapshot[]
    | readonly PersistedTransferRawLog[];
}) {
  const drafts: CanonicalLedgerEntryDraft[] = [];

  for (const rawLog of args.rawLogs) {
    if (!("snapshotType" in rawLog) || rawLog.snapshotType === "token_transfer") {
      drafts.push(
        ...normalizeTransfer({
          chainId: args.wallet.chainId,
          walletId: args.wallet.id,
          walletAddress: args.wallet.address,
          txHash: rawLog.txHash,
          blockNumber: rawLog.blockNumber,
          logIndex: rawLog.logIndex,
          tokenAddress: rawLog.tokenAddress,
          assetId: rawLog.assetIdSnapshot,
          fromAddress: rawLog.fromAddress,
          toAddress: rawLog.toAddress,
          amountRaw: rawLog.amountRaw,
          decimals: rawLog.decimalsSnapshot,
          occurredAt: rawLog.occurredAt,
          normalizerVersion: args.normalizerVersion,
        }),
      );
      continue;
    }

    drafts.push(
      ...normalizeNativeTransaction({
        chainId: args.wallet.chainId,
        walletId: args.wallet.id,
        walletAddress: args.wallet.address,
        txHash: rawLog.txHash,
        blockNumber: rawLog.blockNumber,
        fromAddress: rawLog.fromAddress,
        toAddress: rawLog.toAddress,
        valueRaw: rawLog.valueRaw,
        gasPriceRaw: rawLog.gasPriceRaw,
        gasUsedRaw: rawLog.gasUsedRaw,
        nativeAssetId: NATIVE_SWAP_FEE_ASSET.assetId,
        nativeDecimals: NATIVE_SWAP_FEE_ASSET.decimals,
        occurredAt: rawLog.occurredAt,
        normalizerVersion: args.normalizerVersion,
        hasTrackedTokenTransfersInTransaction:
          rawLog.hasTrackedTokenTransfersInTransaction,
      }),
    );
  }

  return drafts;
}

export function buildTransferNormalizationSnapshots(args: {
  rawTransfers: readonly PersistedTransferRawLog[];
  rawTransactions: readonly Awaited<ReturnType<typeof readWalletRawTransactions>>[number][];
  protocolOperationTxHashes: readonly string[];
  timestampByBlockKey: Map<string, Date>;
}) {
  const transferCountByTxHash = new Map<string, number>();

  for (const transfer of args.rawTransfers) {
    const txHash = transfer.txHash.toLowerCase();
    transferCountByTxHash.set(txHash, (transferCountByTxHash.get(txHash) ?? 0) + 1);
  }

  const protocolOperationTxHashes = new Set(
    args.protocolOperationTxHashes.map((txHash) => txHash.toLowerCase()),
  );
  for (const txHash of inferInlineProtocolTransferTxHashes(args)) {
    protocolOperationTxHashes.add(txHash);
  }
  const snapshots: PersistedTransferNormalizationSnapshot[] = args.rawTransfers.map(
    (transfer) => ({
      snapshotType: "token_transfer",
      ...transfer,
    }),
  );

  for (const transaction of args.rawTransactions) {
    const txHash = transaction.txHash.toLowerCase();

    if (protocolOperationTxHashes.has(txHash)) {
      continue;
    }

    snapshots.push({
      snapshotType: "raw_transaction",
      ...transaction,
      occurredAt: getOccurredAtForTransfer(transaction, args.timestampByBlockKey),
      hasTrackedTokenTransfersInTransaction:
        (transferCountByTxHash.get(txHash) ?? 0) > 0,
    });
  }

  return snapshots.sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? left.snapshotType === "token_transfer" && right.snapshotType === "token_transfer"
        ? left.logIndex - right.logIndex
        : left.snapshotType === "raw_transaction" && right.snapshotType === "raw_transaction"
          ? left.transactionIndex - right.transactionIndex
          : left.snapshotType === "raw_transaction"
            ? -1
            : 1
      : Number(left.blockNumber - right.blockNumber),
  );
}

function inferInlineProtocolTransferTxHashes(args: {
  rawTransfers: readonly PersistedTransferRawLog[];
  rawTransactions: readonly Awaited<ReturnType<typeof readWalletRawTransactions>>[number][];
}) {
  const transfersByTxHash = new Map<string, PersistedTransferRawLog[]>();
  const transactionByTxHash = new Map(
    args.rawTransactions.map((transaction) => [transaction.txHash.toLowerCase(), transaction]),
  );

  for (const transfer of args.rawTransfers) {
    const txHash = transfer.txHash.toLowerCase();
    const group = transfersByTxHash.get(txHash);

    if (group) {
      group.push(transfer);
    } else {
      transfersByTxHash.set(txHash, [transfer]);
    }
  }

  const protocolTxHashes = new Set<string>();
  const phexAddress = PHEX_ADDRESS.toLowerCase();

  for (const [txHash, transfers] of transfersByTxHash.entries()) {
    const transaction = transactionByTxHash.get(txHash);
    const uniqueOutboundAssets = new Set<string>();
    const uniqueInboundAssets = new Set<string>();

    for (const transfer of transfers) {
      if (transaction?.fromAddress.toLowerCase() === transfer.fromAddress.toLowerCase()) {
        uniqueOutboundAssets.add(transfer.assetIdSnapshot);
      }
      if (
        transaction?.toAddress &&
        transaction.toAddress.toLowerCase() === transfer.toAddress.toLowerCase()
      ) {
        uniqueInboundAssets.add(transfer.assetIdSnapshot);
      }
    }

    const transferCountByDirection = {
      outbound: uniqueOutboundAssets.size,
      inbound: uniqueInboundAssets.size,
    };

    if (
      transaction?.toAddress?.toLowerCase() === phexAddress &&
      transfers.some((transfer) => transfer.tokenAddress === phexAddress)
    ) {
      protocolTxHashes.add(txHash);
      continue;
    }

    if (
      (transferCountByDirection.outbound === 2 && transferCountByDirection.inbound === 1) ||
      (transferCountByDirection.outbound === 1 && transferCountByDirection.inbound === 2)
    ) {
      protocolTxHashes.add(txHash);
      continue;
    }

    if (
      transferCountByDirection.outbound === 1 &&
      transferCountByDirection.inbound === 1
    ) {
      const [outboundAsset] = uniqueOutboundAssets;
      const [inboundAsset] = uniqueInboundAssets;

      if (outboundAsset && inboundAsset && outboundAsset !== inboundAsset) {
        protocolTxHashes.add(txHash);
      }
    }
  }

  return protocolTxHashes;
}
