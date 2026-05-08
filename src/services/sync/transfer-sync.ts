import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient, SourceFamily } from "@prisma/client";
import { parseAbi } from "viem";

import { getDb } from "@/lib/db";
import { createPublicClientForChain } from "@/services/chains/public-client";
import {
  buildAdaptiveWindows,
} from "@/services/ingestion/block-window";
import {
  fetchLogsWithAdaptiveRetry,
  type LogFetcherClient,
  type RpcLog,
} from "@/services/ingestion/log-fetcher";
import {
  persistRawBlocks,
  persistRawLogs,
  persistRawTokenTransfers,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";
import { normalizeTransfer, type CanonicalLedgerEntryDraft } from "@/services/normalization";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";
import {
  createPrismaSyncCursorStore,
  createPrismaSyncRunStore,
  type SyncCursorRecord,
} from "@/services/sync/sync-state-store";

const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

export const TRANSFER_EVENT_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const SUPPORTED_CONCRETE_SOURCE_FAMILIES = ["TRANSFERS"] as const;

type SyncDbClient = Pick<
  PrismaClient,
  | "rawLog"
  | "rawBlock"
  | "rawTokenTransfer"
  | "token"
  | "tokenMetadataSource"
  | "syncRun"
  | "syncCursor"
  | "ledgerActionGroup"
  | "ledgerEntry"
>;

type BlockReaderClient = {
  getBlock(args: { blockNumber: bigint }): Promise<{
    number: bigint;
    hash: string;
    parentHash: string;
    timestamp: bigint;
  }>;
};

type ContractReaderClient = {
  readContract(args: {
    address: `0x${string}`;
    abi: typeof ERC20_METADATA_ABI;
    functionName: "decimals" | "symbol" | "name";
  }): Promise<number | string>;
};

type SyncPublicClient = LogFetcherClient & BlockReaderClient & ContractReaderClient;

export type PersistedTransferRawLog = Awaited<
  ReturnType<typeof readWalletTransferRawTokenTransfers>
>[number] & {
  occurredAt: Date;
};

export function createSyncDependencies(args?: {
  db?: SyncDbClient;
  publicClient?: SyncPublicClient;
  normalizerVersion?: string;
  maxWindowSize?: bigint;
}) {
  const db = args?.db ?? (getDb() as unknown as SyncDbClient);
  const publicClient = args?.publicClient ?? (createPublicClientForChain() as unknown as SyncPublicClient);
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
      if (ingestArgs.sourceFamily !== "TRANSFERS") {
        throw new Error(`Unsupported source family for concrete sync path: ${ingestArgs.sourceFamily}`);
      }

      const warnings: string[] = [];
      const walletTopic = toTopicAddress(ingestArgs.wallet.address);
      const windows = buildAdaptiveWindows({
        startBlock: ingestArgs.fromBlock,
        endBlock: ingestArgs.toBlock,
        maxWindowSize,
      });
      const [incoming, outgoing] = await Promise.all([
        fetchLogsWithAdaptiveRetry({
          client: publicClient,
          windows,
          topics: [TRANSFER_EVENT_TOPIC0, null, walletTopic],
        }),
        fetchLogsWithAdaptiveRetry({
          client: publicClient,
          windows,
          topics: [TRANSFER_EVENT_TOPIC0, walletTopic, null],
        }),
      ]);
      const dedupedLogs = dedupeRpcLogs([...incoming.logs, ...outgoing.logs]);
      const uniqueBlocks = Array.from(
        new Set(dedupedLogs.map((log) => log.blockNumber).filter((value): value is bigint => value !== null)),
      ).sort((left, right) => Number(left - right));
      const endBlock = await publicClient.getBlock({
        blockNumber: ingestArgs.toBlock,
      });
      const blocks = [];

      for (const blockNumber of uniqueBlocks) {
        const block = await publicClient.getBlock({ blockNumber });
        blocks.push({
          chainId: ingestArgs.wallet.chainId,
          blockNumber: block.number,
          blockHash: block.hash,
          parentHash: block.parentHash,
          timestamp: new Date(Number(block.timestamp) * 1000),
        });
      }

      const persistedBlocks = await persistRawBlocks(blocks, db as never);
      const persistedLogs = await persistRawLogs(
        dedupedLogs
          .filter(
            (log): log is RpcLog & {
              blockHash: string;
              blockNumber: bigint;
              logIndex: number;
              transactionHash: string;
            } =>
              log.blockHash !== null &&
              log.blockNumber !== null &&
              log.logIndex !== null &&
              log.transactionHash !== null,
          )
          .map((log) => ({
            chainId: ingestArgs.wallet.chainId,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            logIndex: log.logIndex,
            address: log.address,
            topics: log.topics,
            data: log.data,
          })),
        db as never,
      );
      const decodedTransfers = [];

      for (const log of dedupedLogs) {
        if (
          log.blockHash === null ||
          log.blockNumber === null ||
          log.logIndex === null ||
          log.transactionHash === null
        ) {
          continue;
        }

        const decoded = decodeTransferLog({
          topic1: log.topics[1] ?? null,
          topic2: log.topics[2] ?? null,
          data: log.data,
        });
        const token = await resolveTokenMetadata({
          db,
          publicClient,
          chainId: ingestArgs.wallet.chainId,
          tokenAddress: log.address,
        });

        decodedTransfers.push({
          chainId: ingestArgs.wallet.chainId,
          tokenId: token.tokenId,
          tokenAddress: token.tokenAddress,
          assetIdSnapshot: token.assetId,
          decimalsSnapshot: token.decimals,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          fromAddress: decoded.fromAddress,
          toAddress: decoded.toAddress,
          amountRaw: decoded.amountRaw,
        });
      }
      const persistedTransfers = await persistRawTokenTransfers(
        decodedTransfers,
        db as never,
      );

      if (blocks.length !== persistedBlocks.count && persistedBlocks.count > 0) {
        warnings.push("some raw blocks were already persisted for this range");
      }

      const rawLogs = await readWalletTransferRawTokenTransfers(
        {
          chainId: ingestArgs.wallet.chainId,
          walletAddress: ingestArgs.wallet.address,
          fromBlock: ingestArgs.fromBlock,
          toBlock: ingestArgs.toBlock,
        },
        db as never,
      );
      const blockTimestamps = await db.rawBlock.findMany({
        where: {
          chainId: ingestArgs.wallet.chainId,
          blockNumber: {
            gte: ingestArgs.fromBlock,
            lte: ingestArgs.toBlock,
          },
        },
      });
      const timestampByBlockKey = new Map(
        blockTimestamps.map((block) => [
          `${block.blockNumber}:${block.blockHash.toLowerCase()}`,
          block.timestamp,
        ]),
      );

      return {
        rawLogCount: persistedLogs.count,
        latestBlockHash:
          endBlock.hash.toLowerCase(),
        logs: rawLogs.map((log) => ({
          ...log,
          occurredAt: getOccurredAtForTransfer(log, timestampByBlockKey),
        })),
        fromBlock: ingestArgs.fromBlock,
        toBlock: ingestArgs.toBlock,
        warnings,
        rawTransferCount: persistedTransfers.count,
      };
    },
    normalizeSourceFamily: async (normalizeArgs: {
      runId: string;
      wallet: { id: string; chainId: number; address: string };
      sourceFamily: SourceFamily;
      rawLogs: readonly PersistedTransferRawLog[];
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      if (normalizeArgs.sourceFamily !== "TRANSFERS") {
        throw new Error(`Unsupported source family for concrete sync path: ${normalizeArgs.sourceFamily}`);
      }

      const drafts: CanonicalLedgerEntryDraft[] = [];

      for (const rawLog of normalizeArgs.rawLogs) {
        drafts.push(
          ...normalizeTransfer({
            chainId: normalizeArgs.wallet.chainId,
            walletId: normalizeArgs.wallet.id,
            walletAddress: normalizeArgs.wallet.address,
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
            normalizerVersion,
          }),
        );
      }

      return drafts;
    },
  };
}

function dedupeRpcLogs(logs: readonly RpcLog[]) {
  const byKey = new Map<string, RpcLog>();

  for (const log of logs) {
    const key = `${log.transactionHash?.toLowerCase()}:${log.logIndex}:${log.blockHash?.toLowerCase()}`;

    if (!byKey.has(key)) {
      byKey.set(key, log);
    }
  }

  return Array.from(byKey.values()).sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? (left.logIndex ?? 0) - (right.logIndex ?? 0)
      : Number((left.blockNumber ?? 0n) - (right.blockNumber ?? 0n)),
  );
}

function decodeTransferLog(log: {
  topic1: string | null;
  topic2: string | null;
  data: string;
}) {
  const fromTopic = log.topic1;
  const toTopic = log.topic2;

  if (!fromTopic || !toTopic) {
    throw new Error("transfer log missing indexed addresses");
  }

  return {
    fromAddress: `0x${fromTopic.slice(-40)}`.toLowerCase(),
    toAddress: `0x${toTopic.slice(-40)}`.toLowerCase(),
    amountRaw: BigInt(log.data).toString(),
  };
}

async function resolveTokenMetadata(args: {
  db: SyncDbClient;
  publicClient: SyncPublicClient;
  chainId: number;
  tokenAddress: string;
}) {
  const addressLower = args.tokenAddress.toLowerCase();
  const existing = await args.db.token.findUnique({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower,
      },
    },
  });

  if (existing) {
    return {
      tokenId: existing.id,
      tokenAddress: existing.addressLower,
      assetId: existing.assetId,
      decimals: existing.decimals,
    };
  }

  const [decimals, symbol, name] = await Promise.all([
    args.publicClient.readContract({
      address: addressLower as `0x${string}`,
      abi: ERC20_METADATA_ABI,
      functionName: "decimals",
    }),
    args.publicClient.readContract({
      address: addressLower as `0x${string}`,
      abi: ERC20_METADATA_ABI,
      functionName: "symbol",
    }),
    args.publicClient.readContract({
      address: addressLower as `0x${string}`,
      abi: ERC20_METADATA_ABI,
      functionName: "name",
    }),
  ]);
  const assetId = `chain:${args.chainId}:erc20:${addressLower}`;

  const token = await args.db.token.upsert({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower,
      },
    },
    create: {
      id: buildDeterministicTokenId(args.chainId, addressLower),
      chainId: args.chainId,
      address: addressLower,
      addressLower,
      assetId,
      symbol: String(symbol),
      name: String(name),
      decimals: Number(decimals),
      decimalsSource: "RPC",
      isNative: false,
    },
    update: {
      symbol: String(symbol),
      name: String(name),
      decimals: Number(decimals),
      decimalsSource: "RPC",
    },
  });

  await args.db.tokenMetadataSource.upsert({
    where: {
      tokenId_sourceKind_sourceRef: {
        tokenId: token.id,
        sourceKind: "RPC",
        sourceRef: addressLower,
      },
    },
    create: {
      tokenId: token.id,
      sourceKind: "RPC",
      sourceRef: addressLower,
      decimals: Number(decimals),
      symbol: String(symbol),
      name: String(name),
    },
    update: {
      decimals: Number(decimals),
      symbol: String(symbol),
      name: String(name),
    },
  });

  return {
    tokenId: token.id,
    tokenAddress: addressLower,
    assetId,
    decimals: Number(decimals),
  };
}

function buildDeterministicTokenId(chainId: number, addressLower: string) {
  return `tok_${createHash("sha256").update(`${chainId}:${addressLower}`).digest("hex")}`;
}

function toTopicAddress(address: string) {
  return `0x000000000000000000000000${address.toLowerCase().replace(/^0x/, "")}`;
}

function getOccurredAtForTransfer(
  log: {
    txHash: string;
    blockNumber: bigint;
    blockHash: string;
  },
  timestampByBlockKey: Map<string, Date>,
) {
  const timestamp = timestampByBlockKey.get(
    `${log.blockNumber}:${log.blockHash.toLowerCase()}`,
  );

  if (!timestamp) {
    throw new Error(
      `Missing raw block timestamp for transfer ${log.txHash} at ${log.blockNumber}:${log.blockHash.toLowerCase()}`,
    );
  }

  return timestamp;
}
