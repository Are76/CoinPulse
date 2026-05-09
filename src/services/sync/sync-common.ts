import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { parseAbi } from "viem";

import { getDb } from "@/lib/db";
import { createPublicClientForChain } from "@/services/chains/public-client";
import { buildAdaptiveWindows } from "@/services/ingestion/block-window";
import {
  fetchLogsWithAdaptiveRetry,
  type LogFetcherClient,
  type RpcLog,
} from "@/services/ingestion/log-fetcher";
import {
  persistRawBlocks,
  persistRawLogs,
  persistRawTransactions,
  type PersistRawTransactionInput,
  readWalletRawTransactions,
  persistRawTokenTransfers,
  readWalletProtocolOperationTxHashes,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";

const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

export const TRANSFER_EVENT_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type SyncDbClient = Pick<
  PrismaClient,
  | "rawLog"
  | "rawBlock"
  | "rawTransaction"
  | "rawTokenTransfer"
  | "rawDexSwap"
  | "rawLpAction"
  | "rawStakeAction"
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
  getBlock(args: {
    blockNumber: bigint;
    includeTransactions: true;
  }): Promise<{
    number: bigint;
    hash: string;
    parentHash: string;
    timestamp: bigint;
    transactions: Array<{
      hash: string;
      blockHash: string | null;
      blockNumber: bigint | null;
      transactionIndex: number | null;
      from: string;
      to: string | null;
      value: bigint;
      gasPrice: bigint | null;
      input?: string | null;
    }>;
  }>;
};

type ContractReaderClient = {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
};

type TransactionReaderClient = {
  getTransaction(args: { hash: `0x${string}` }): Promise<{
    hash: string;
    blockHash: string | null;
    blockNumber: bigint | null;
    transactionIndex: number | null;
    from: string;
    to: string | null;
    value: bigint;
    gasPrice: bigint | null;
    input?: string | null;
  }>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    transactionHash: string;
    blockHash: string | null;
    blockNumber: bigint | null;
    gasUsed: bigint;
    effectiveGasPrice?: bigint | null;
    logs: Array<{
      address: string;
      blockHash: string | null;
      blockNumber: bigint | null;
      data: string;
      logIndex: number | null;
      transactionHash: string | null;
      topics: readonly string[];
    }>;
  }>;
};

export type SyncPublicClient = LogFetcherClient &
  BlockReaderClient &
  ContractReaderClient &
  TransactionReaderClient;

export type PersistedTransferRawLog = Awaited<
  ReturnType<typeof readWalletTransferRawTokenTransfers>
>[number] & {
  occurredAt: Date;
};

export type WalletTransferSnapshot = Awaited<
  ReturnType<typeof readWalletTransferRawTokenTransfers>
>[number];

export type WalletTransferTransactionSnapshot = Awaited<
  ReturnType<typeof readWalletRawTransactions>
>[number];

export type TransferArtifacts = {
  rawLogCount: number;
  latestBlockHash: string | null;
  rawTransfers: readonly PersistedTransferRawLog[];
  transferSnapshots: readonly WalletTransferSnapshot[];
  rawTransactions: readonly WalletTransferTransactionSnapshot[];
  protocolOperationTxHashes: readonly string[];
  timestampByBlockKey: Map<string, Date>;
  fromBlock: bigint;
  toBlock: bigint;
  warnings: readonly string[];
};

export function buildNativeTransactionScanWindows(args: {
  fromBlock: bigint;
  toBlock: bigint;
  maxWindowSize: bigint;
}) {
  return buildAdaptiveWindows({
    startBlock: args.fromBlock,
    endBlock: args.toBlock,
    maxWindowSize: args.maxWindowSize,
  });
}

export function createDefaultSyncClients(args?: {
  db?: SyncDbClient;
  publicClient?: SyncPublicClient;
}) {
  return {
    db: args?.db ?? (getDb() as unknown as SyncDbClient),
    publicClient:
      args?.publicClient ??
      (createPublicClientForChain() as unknown as SyncPublicClient),
  };
}

export async function ingestWalletTransferArtifacts(args: {
  db: SyncDbClient;
  publicClient: SyncPublicClient;
  maxWindowSize: bigint;
  wallet: { chainId: number; address: string };
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<TransferArtifacts> {
  const warnings: string[] = [];
  const walletTopic = toTopicAddress(args.wallet.address);
  const windows = buildAdaptiveWindows({
    startBlock: args.fromBlock,
    endBlock: args.toBlock,
    maxWindowSize: args.maxWindowSize,
  });
  const [incoming, outgoing] = await Promise.all([
    fetchLogsWithAdaptiveRetry({
      client: args.publicClient,
      windows,
      topics: [TRANSFER_EVENT_TOPIC0, null, walletTopic],
    }),
    fetchLogsWithAdaptiveRetry({
      client: args.publicClient,
      windows,
      topics: [TRANSFER_EVENT_TOPIC0, walletTopic, null],
    }),
  ]);
  const dedupedLogs = dedupeRpcLogs([...incoming.logs, ...outgoing.logs]);
  const walletAddress = args.wallet.address.toLowerCase();
  const nativeScanWindows = buildNativeTransactionScanWindows({
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    maxWindowSize: args.maxWindowSize,
  });
  let latestBlockHash: string | null = null;
  let scannedBlockCount = 0;
  let persistedBlockCount = 0;
  const scannedRawTransactions: PersistRawTransactionInput[] = [];

  for (const window of nativeScanWindows) {
    const blocks = [];
    const rawTransactions = [];

    for (
      let blockNumber = window.fromBlock;
      blockNumber <= window.toBlock;
      blockNumber += 1n
    ) {
      const block = await args.publicClient.getBlock({
        blockNumber,
        includeTransactions: true,
      });
      const blockHash = block.hash.toLowerCase();

      latestBlockHash = blockNumber === args.toBlock ? blockHash : latestBlockHash;
      blocks.push({
        chainId: args.wallet.chainId,
        blockNumber: block.number,
        blockHash,
        parentHash: block.parentHash.toLowerCase(),
        timestamp: new Date(Number(block.timestamp) * 1000),
      });

      const blockTransactions = "transactions" in block ? block.transactions : [];

      for (const transaction of blockTransactions) {
        const fromAddress = transaction.from.toLowerCase();
        const toAddress = transaction.to?.toLowerCase() ?? null;

        if (fromAddress !== walletAddress && toAddress !== walletAddress) {
          continue;
        }

        const receipt = await args.publicClient.getTransactionReceipt({
          hash: transaction.hash as `0x${string}`,
        });

        rawTransactions.push({
          chainId: args.wallet.chainId,
          txHash: transaction.hash,
          blockNumber: transaction.blockNumber ?? block.number,
          blockHash: transaction.blockHash ?? block.hash,
          transactionIndex: transaction.transactionIndex ?? 0,
          fromAddress: transaction.from,
          toAddress: transaction.to,
          valueRaw: transaction.value.toString(),
          gasPriceRaw:
            (receipt.effectiveGasPrice ?? transaction.gasPrice)?.toString() ?? null,
          gasUsedRaw: receipt.gasUsed.toString(),
        });
      }
    }

    scannedBlockCount += blocks.length;
    scannedRawTransactions.push(...rawTransactions);
    persistedBlockCount += (await persistRawBlocks(blocks, args.db as never)).count;
    await persistRawTransactions(rawTransactions, args.db as never);
  }

  const persistedLogs = await persistRawLogs(
    dedupedLogs
      .filter(
        (
          log,
        ): log is RpcLog & {
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
        chainId: args.wallet.chainId,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        logIndex: log.logIndex,
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    args.db as never,
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
      db: args.db,
      publicClient: args.publicClient,
      chainId: args.wallet.chainId,
      tokenAddress: log.address,
    });

    decodedTransfers.push({
      chainId: args.wallet.chainId,
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

  await persistRawTokenTransfers(decodedTransfers, args.db as never);

  if (scannedBlockCount !== persistedBlockCount && persistedBlockCount > 0) {
    warnings.push("some raw blocks were already persisted for this range");
  }

  const rawTransfers = await readWalletTransferRawTokenTransfers(
    {
      chainId: args.wallet.chainId,
      walletAddress: args.wallet.address,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    },
    args.db as never,
  );
  const persistedTransactions =
    typeof (args.db.rawTransaction as { findMany?: unknown }).findMany === "function"
      ? await readWalletRawTransactions(
          {
            chainId: args.wallet.chainId,
            walletAddress: args.wallet.address,
            fromBlock: args.fromBlock,
            toBlock: args.toBlock,
          },
          args.db as never,
        )
      : scannedRawTransactions.map((transaction) => ({
          chainId: transaction.chainId,
          txHash: transaction.txHash.toLowerCase(),
          blockNumber: transaction.blockNumber,
          blockHash: transaction.blockHash.toLowerCase(),
          transactionIndex: transaction.transactionIndex,
          fromAddress: transaction.fromAddress.toLowerCase(),
          toAddress: transaction.toAddress?.toLowerCase() ?? null,
          valueRaw: transaction.valueRaw,
          gasPriceRaw: transaction.gasPriceRaw,
          gasUsedRaw: transaction.gasUsedRaw,
        }));
  const protocolOperationTxHashes =
    typeof (args.db.rawDexSwap as { findMany?: unknown } | undefined)?.findMany ===
      "function" &&
    typeof (args.db.rawLpAction as { findMany?: unknown } | undefined)?.findMany ===
      "function" &&
    typeof (args.db.rawStakeAction as { findMany?: unknown } | undefined)?.findMany ===
      "function"
      ? await readWalletProtocolOperationTxHashes(
          {
            chainId: args.wallet.chainId,
            walletAddress: args.wallet.address,
            fromBlock: args.fromBlock,
            toBlock: args.toBlock,
          },
          args.db as never,
        )
      : [];
  const blockTimestamps = await args.db.rawBlock.findMany({
    where: {
      chainId: args.wallet.chainId,
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
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
    latestBlockHash,
    rawTransfers: rawTransfers.map((transfer) => ({
      ...transfer,
      occurredAt: getOccurredAtForTransfer(transfer, timestampByBlockKey),
    })),
    transferSnapshots: rawTransfers,
    rawTransactions: persistedTransactions,
    protocolOperationTxHashes,
    timestampByBlockKey,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    warnings,
  };
}

export async function resolveTokenMetadata(args: {
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

export function buildDeterministicTokenId(
  chainId: number,
  addressLower: string,
) {
  return `tok_${createHash("sha256").update(`${chainId}:${addressLower}`).digest("hex")}`;
}

export function dedupeRpcLogs(logs: readonly RpcLog[]) {
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

export function decodeTransferLog(log: {
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

export function toTopicAddress(address: string) {
  return `0x000000000000000000000000${address.toLowerCase().replace(/^0x/, "")}`;
}

function getOccurredAtForBlockHash(
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
      `Missing raw block timestamp for record ${log.txHash} at ${log.blockNumber}:${log.blockHash.toLowerCase()}`,
    );
  }

  return timestamp;
}

export function getOccurredAtForTransfer(
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

export function getOccurredAtForDexSwap(
  log: {
    txHash: string;
    blockNumber: bigint;
    blockHash: string;
  },
  timestampByBlockKey: Map<string, Date>,
) {
  return getOccurredAtForBlockHash(log, timestampByBlockKey);
}

export function getOccurredAtForLpAction(
  log: {
    txHash: string;
    blockNumber: bigint;
    blockHash: string;
  },
  timestampByBlockKey: Map<string, Date>,
) {
  return getOccurredAtForBlockHash(log, timestampByBlockKey);
}

export function getOccurredAtForStakeAction(
  log: {
    txHash: string;
    blockNumber: bigint;
    blockHash: string;
  },
  timestampByBlockKey: Map<string, Date>,
) {
  return getOccurredAtForBlockHash(log, timestampByBlockKey);
}
