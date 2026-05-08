import "server-only";

import type { SourceFamily } from "@prisma/client";

import { getDb } from "@/lib/db";
import { createPublicClientForChain } from "@/services/chains/public-client";
import { normalizeTransfer, type CanonicalLedgerEntryDraft } from "@/services/normalization";
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

export const SUPPORTED_CONCRETE_SOURCE_FAMILIES = [
  "TRANSFERS",
  "DEX",
  "LP",
] as const;

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
  const maxWindowSize = args?.maxWindowSize ?? 2_000n;

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
            rawLogs: normalizeArgs.rawLogs as readonly PersistedTransferRawLog[],
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
    logs: artifacts.rawTransfers,
    fromBlock: artifacts.fromBlock,
    toBlock: artifacts.toBlock,
    warnings: artifacts.warnings,
  };
}

function normalizeTransfers(args: {
  normalizerVersion: string;
  wallet: { id: string; chainId: number; address: string };
  rawLogs: readonly PersistedTransferRawLog[];
}) {
  const drafts: CanonicalLedgerEntryDraft[] = [];

  for (const rawLog of args.rawLogs) {
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
  }

  return drafts;
}
