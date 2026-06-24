import "server-only";

import { CORE_PROTOCOLS } from "@/config/protocols";
import {
  PULSECHAIN_NATIVE_ASSET_ID,
  PULSECHAIN_NATIVE_TOKEN_ADDRESS,
} from "@/config/assets";
import {
  persistRawDexSwaps,
  persistRawLogs,
  persistRawTransactions,
  readWalletDexSwapSnapshots,
} from "@/services/ingestion/raw-store";
import { normalizeSwap, type CanonicalLedgerEntryDraft } from "@/services/normalization";
import {
  getOccurredAtForDexSwap,
  type SyncDbClient,
  type SyncPublicClient,
  ingestWalletTransferArtifacts,
  type WalletTransferSnapshot,
  canonicalizeSnapshotAssetId,
} from "@/services/sync/sync-common";

export const SWAP_EVENT_TOPIC0 =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

export const NATIVE_SWAP_FEE_ASSET = {
  assetId: PULSECHAIN_NATIVE_ASSET_ID,
  tokenAddress: PULSECHAIN_NATIVE_TOKEN_ADDRESS,
  decimals: 18,
} as const;

export type PersistedDexSwapRawLog = Awaited<
  ReturnType<typeof readWalletDexSwapSnapshots>
>[number] & {
  occurredAt: Date;
};

export async function ingestDexSwaps(args: {
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
          feeAssetIdSnapshot: NATIVE_SWAP_FEE_ASSET.assetId,
          feeDecimalsSnapshot: NATIVE_SWAP_FEE_ASSET.decimals,
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

export function normalizeDexSwaps(args: {
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
        feeAssetId: canonicalizeSnapshotAssetId(rawLog.feeAssetIdSnapshot),
        feeAmountRaw: rawLog.feeAmountRaw,
        feeDecimals: rawLog.feeDecimalsSnapshot,
      }),
    );
  }

  return drafts;
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
