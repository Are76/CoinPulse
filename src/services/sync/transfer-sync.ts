import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient, SourceFamily } from "@prisma/client";
import { parseAbi } from "viem";

import { CORE_PROTOCOLS } from "@/config/protocols";
import {
  PULSECHAIN_NATIVE_ASSET_ID,
  PULSECHAIN_NATIVE_TOKEN_ADDRESS,
} from "@/config/assets";
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
  persistRawDexSwaps,
  persistRawLogs,
  persistRawTokenTransfers,
  persistRawTransactions,
  readWalletDexSwapSnapshots,
  readWalletTransferRawTokenTransfers,
} from "@/services/ingestion/raw-store";
import {
  normalizeSwap,
  normalizeTransfer,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization";
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
export const SWAP_EVENT_TOPIC0 =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
export const SUPPORTED_CONCRETE_SOURCE_FAMILIES = [
  "TRANSFERS",
  "DEX",
] as const;

type SyncDbClient = Pick<
  PrismaClient,
  | "rawLog"
  | "rawBlock"
  | "rawTransaction"
  | "rawTokenTransfer"
  | "rawDexSwap"
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

type SyncPublicClient = LogFetcherClient &
  BlockReaderClient &
  ContractReaderClient &
  TransactionReaderClient;

export type PersistedTransferRawLog = Awaited<
  ReturnType<typeof readWalletTransferRawTokenTransfers>
>[number] & {
  occurredAt: Date;
};

type PersistedDexSwapRawLog = Awaited<
  ReturnType<typeof readWalletDexSwapSnapshots>
>[number] & {
  occurredAt: Date;
};

type WalletTransferSnapshot = Awaited<
  ReturnType<typeof readWalletTransferRawTokenTransfers>
>[number];

type TransferArtifacts = {
  rawLogCount: number;
  latestBlockHash: string | null;
  rawTransfers: readonly PersistedTransferRawLog[];
  transferSnapshots: readonly WalletTransferSnapshot[];
  timestampByBlockKey: Map<string, Date>;
  fromBlock: bigint;
  toBlock: bigint;
  warnings: readonly string[];
};

export function createSyncDependencies(args?: {
  db?: SyncDbClient;
  publicClient?: SyncPublicClient;
  normalizerVersion?: string;
  maxWindowSize?: bigint;
}) {
  const db = args?.db ?? (getDb() as unknown as SyncDbClient);
  const publicClient =
    args?.publicClient ??
    (createPublicClientForChain() as unknown as SyncPublicClient);
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

async function ingestDexSwaps(args: {
  db: SyncDbClient;
  publicClient: SyncPublicClient;
  maxWindowSize: bigint;
  wallet: { chainId: number; address: string };
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const artifacts = await ingestWalletTransferArtifacts(args);
  const warnings = [...artifacts.warnings];
  const walletAddress = args.wallet.address.toLowerCase();
  const transfersByTransaction = groupTransfersByTransaction(
    artifacts.transferSnapshots,
  );
  const candidateTransactions = Array.from(transfersByTransaction.values()).sort(
    (left, right) =>
      left[0].blockNumber === right[0].blockNumber
        ? left[0].txHash.localeCompare(right[0].txHash)
        : Number(left[0].blockNumber - right[0].blockNumber),
  );
  let persistedTransactionCount = 0;
  let persistedReceiptLogCount = 0;
  let processedSwapCandidates = 0;

  for (const transactionTransfers of candidateTransactions) {
    const swapShape = summarizeWalletSwapTransfers({
      walletAddress,
      transfers: transactionTransfers,
    });

    if (!swapShape.ok) {
      warnings.push(
        `skip-dex:${transactionTransfers[0]?.txHash ?? "unknown"}:${swapShape.reason}`,
      );
      continue;
    }

    const transaction = await args.publicClient.getTransaction({
      hash: transactionTransfers[0].txHash as `0x${string}`,
    });
    const receipt = await args.publicClient.getTransactionReceipt({
      hash: transactionTransfers[0].txHash as `0x${string}`,
    });

    if (!transaction.blockHash || transaction.blockNumber === null) {
      warnings.push(`skip-dex:${transaction.hash.toLowerCase()}:missing-tx-block`);
      continue;
    }

    if (transaction.from.toLowerCase() !== walletAddress) {
      warnings.push(
        `skip-dex:${transaction.hash.toLowerCase()}:unsupported-initiator`,
      );
      continue;
    }

    const swapLogs = receipt.logs
      .filter(
        (
          log,
        ): log is typeof log & {
          blockHash: string;
          blockNumber: bigint;
          logIndex: number;
          transactionHash: string;
        } =>
          log.topics[0]?.toLowerCase() === SWAP_EVENT_TOPIC0 &&
          log.blockHash !== null &&
          log.blockNumber !== null &&
          log.logIndex !== null &&
          log.transactionHash !== null,
      )
      .sort((left, right) => left.logIndex - right.logIndex);

    if (swapLogs.length === 0) {
      warnings.push(`skip-dex:${transaction.hash.toLowerCase()}:missing-swap-log`);
      continue;
    }

    const feeGasPrice = receipt.effectiveGasPrice ?? transaction.gasPrice;

    if (feeGasPrice === null) {
      warnings.push(`skip-dex:${transaction.hash.toLowerCase()}:missing-gas-price`);
      continue;
    }

    processedSwapCandidates += 1;

    const persistedTransaction = await persistRawTransactions(
      [
        {
          chainId: args.wallet.chainId,
          txHash: transaction.hash,
          blockNumber: transaction.blockNumber,
          blockHash: transaction.blockHash,
          transactionIndex: transaction.transactionIndex ?? 0,
          fromAddress: transaction.from,
          toAddress: transaction.to,
          valueRaw: transaction.value.toString(),
          gasPriceRaw: feeGasPrice.toString(),
          gasUsedRaw: receipt.gasUsed.toString(),
        },
      ],
      args.db as never,
    );

    persistedTransactionCount += persistedTransaction.count;
    const persistedReceiptLogs = await persistRawLogs(
      receipt.logs
        .filter(
          (
            log,
          ): log is typeof log & {
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

    persistedReceiptLogCount += persistedReceiptLogs.count;
    const primarySwapLog = swapLogs[0];

    await persistRawDexSwaps(
      [
        {
          chainId: args.wallet.chainId,
          protocolSlug: CORE_PROTOCOLS.pulsex.slug,
          txHash: transaction.hash,
          blockNumber: primarySwapLog.blockNumber,
          blockHash: primarySwapLog.blockHash,
          logIndex: primarySwapLog.logIndex,
          pairAddress: primarySwapLog.address,
          initiatorAddress: transaction.from,
          counterpartyAddress: transaction.to,
          soldTokenAddress: swapShape.sold.tokenAddress,
          soldAssetIdSnapshot: swapShape.sold.assetIdSnapshot,
          soldDecimalsSnapshot: swapShape.sold.decimalsSnapshot,
          soldAmountRaw: swapShape.sold.amountRaw,
          boughtTokenAddress: swapShape.bought.tokenAddress,
          boughtAssetIdSnapshot: swapShape.bought.assetIdSnapshot,
          boughtDecimalsSnapshot: swapShape.bought.decimalsSnapshot,
          boughtAmountRaw: swapShape.bought.amountRaw,
          feeAssetIdSnapshot: PULSECHAIN_NATIVE_ASSET_ID,
          feeDecimalsSnapshot: 18,
          feeAmountRaw: (receipt.gasUsed * feeGasPrice).toString(),
        },
      ],
      args.db as never,
    );
  }

  const rawSwaps = await readWalletDexSwapSnapshots(
    {
      chainId: args.wallet.chainId,
      walletAddress: args.wallet.address,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    },
    args.db as never,
  );

  return {
    rawLogCount: artifacts.rawLogCount + persistedReceiptLogCount,
    latestBlockHash: artifacts.latestBlockHash,
    logs: rawSwaps.map((swap) => ({
      ...swap,
      occurredAt: getOccurredAtForDexSwap(swap, artifacts.timestampByBlockKey),
    })),
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    warnings: [
      ...warnings,
      ...(persistedTransactionCount === 0 && processedSwapCandidates > 0
        ? ["some dex candidates were already persisted"]
        : []),
    ],
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

function normalizeDexSwaps(args: {
  normalizerVersion: string;
  wallet: { id: string; chainId: number; address: string };
  rawLogs: readonly PersistedDexSwapRawLog[];
}) {
  const drafts: CanonicalLedgerEntryDraft[] = [];

  for (const rawLog of args.rawLogs) {
    drafts.push(
      ...normalizeSwap({
        chainId: args.wallet.chainId,
        walletId: args.wallet.id,
        walletAddress: args.wallet.address,
        txHash: rawLog.txHash,
        blockNumber: rawLog.blockNumber,
        sourceRef: `swap:${rawLog.protocolSlug}:${rawLog.logIndex}`,
        occurredAt: rawLog.occurredAt,
        normalizerVersion: args.normalizerVersion,
        soldAssetId: rawLog.soldAssetIdSnapshot,
        soldAmountRaw: rawLog.soldAmountRaw,
        soldDecimals: rawLog.soldDecimalsSnapshot,
        boughtAssetId: rawLog.boughtAssetIdSnapshot,
        boughtAmountRaw: rawLog.boughtAmountRaw,
        boughtDecimals: rawLog.boughtDecimalsSnapshot,
        feeAssetId: rawLog.feeAssetIdSnapshot,
        feeAmountRaw: rawLog.feeAmountRaw,
        feeDecimals: rawLog.feeDecimalsSnapshot,
      }),
    );
  }

  return drafts;
}

async function ingestWalletTransferArtifacts(args: {
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
  const uniqueBlocks = Array.from(
    new Set(
      dedupedLogs
        .map((log) => log.blockNumber)
        .filter((value): value is bigint => value !== null),
    ),
  ).sort((left, right) => Number(left - right));
  const endBlock = await args.publicClient.getBlock({
    blockNumber: args.toBlock,
  });
  const blocks = [];

  for (const blockNumber of uniqueBlocks) {
    const block = await args.publicClient.getBlock({ blockNumber });
    blocks.push({
      chainId: args.wallet.chainId,
      blockNumber: block.number,
      blockHash: block.hash,
      parentHash: block.parentHash,
      timestamp: new Date(Number(block.timestamp) * 1000),
    });
  }

  const persistedBlocks = await persistRawBlocks(blocks, args.db as never);
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

  if (blocks.length !== persistedBlocks.count && persistedBlocks.count > 0) {
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
    latestBlockHash: endBlock.hash.toLowerCase(),
    rawTransfers: rawTransfers.map((transfer) => ({
      ...transfer,
      occurredAt: getOccurredAtForTransfer(transfer, timestampByBlockKey),
    })),
    transferSnapshots: rawTransfers,
    timestampByBlockKey,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    warnings,
  };
}

function groupTransfersByTransaction(
  transfers: readonly WalletTransferSnapshot[],
) {
  const grouped = new Map<string, WalletTransferSnapshot[]>();

  for (const transfer of transfers) {
    const key = `${transfer.txHash}:${transfer.blockHash}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.push(transfer);
    } else {
      grouped.set(key, [transfer]);
    }
  }

  for (const group of grouped.values()) {
    group.sort((left, right) => left.logIndex - right.logIndex);
  }

  return grouped;
}

function summarizeWalletSwapTransfers(args: {
  walletAddress: string;
  transfers: readonly WalletTransferSnapshot[];
}) {
  const outbound = new Map<
    string,
    {
      tokenAddress: string;
      assetIdSnapshot: string;
      decimalsSnapshot: number;
      amountRaw: bigint;
    }
  >();
  const inbound = new Map<
    string,
    {
      tokenAddress: string;
      assetIdSnapshot: string;
      decimalsSnapshot: number;
      amountRaw: bigint;
    }
  >();

  for (const transfer of args.transfers) {
    if (transfer.fromAddress === args.walletAddress) {
      accumulateTransfer(outbound, transfer);
    }
    if (transfer.toAddress === args.walletAddress) {
      accumulateTransfer(inbound, transfer);
    }
  }

  if (outbound.size !== 1) {
    return {
      ok: false as const,
      reason: `ambiguous-sold-assets:${outbound.size}`,
    };
  }

  if (inbound.size !== 1) {
    return {
      ok: false as const,
      reason: `ambiguous-bought-assets:${inbound.size}`,
    };
  }

  const sold = firstMapValue(outbound);
  const bought = firstMapValue(inbound);

  if (!sold || !bought) {
    return {
      ok: false as const,
      reason: "missing-wallet-legs",
    };
  }

  if (sold.assetIdSnapshot === bought.assetIdSnapshot) {
    return {
      ok: false as const,
      reason: "same-asset-roundtrip",
    };
  }

  return {
    ok: true as const,
    sold: {
      ...sold,
      amountRaw: sold.amountRaw.toString(),
    },
    bought: {
      ...bought,
      amountRaw: bought.amountRaw.toString(),
    },
  };
}

function accumulateTransfer(
  bucket: Map<
    string,
    {
      tokenAddress: string;
      assetIdSnapshot: string;
      decimalsSnapshot: number;
      amountRaw: bigint;
    }
  >,
  transfer: WalletTransferSnapshot,
) {
  const existing = bucket.get(transfer.assetIdSnapshot);

  if (existing) {
    existing.amountRaw += BigInt(transfer.amountRaw);
    return;
  }

  bucket.set(transfer.assetIdSnapshot, {
    tokenAddress: transfer.tokenAddress,
    assetIdSnapshot: transfer.assetIdSnapshot,
    decimalsSnapshot: transfer.decimalsSnapshot,
    amountRaw: BigInt(transfer.amountRaw),
  });
}

function firstMapValue<T>(value: Map<string, T>) {
  const iterator = value.values().next();

  return iterator.done ? null : iterator.value;
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

export const NATIVE_SWAP_FEE_ASSET = {
  assetId: PULSECHAIN_NATIVE_ASSET_ID,
  tokenAddress: PULSECHAIN_NATIVE_TOKEN_ADDRESS,
  decimals: 18,
} as const;
