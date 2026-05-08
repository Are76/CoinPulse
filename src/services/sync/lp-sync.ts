import "server-only";

import { CORE_PROTOCOLS } from "@/config/protocols";
import {
  persistRawLpActions,
  persistRawTransactions,
  readWalletRawLpActions,
} from "@/services/ingestion/raw-store";
import {
  normalizeLpAdd,
  normalizeLpRemove,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization";
import {
  NATIVE_SWAP_FEE_ASSET,
} from "@/services/sync/dex-sync";
import {
  getOccurredAtForLpAction,
  type SyncDbClient,
  type SyncPublicClient,
  ingestWalletTransferArtifacts,
  type WalletTransferSnapshot,
} from "@/services/sync/sync-common";

export type PersistedRawLpAction = Awaited<
  ReturnType<typeof readWalletRawLpActions>
>[number] & {
  occurredAt: Date;
};

export async function ingestLpActions(args: {
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
  let processedLpCandidates = 0;

  for (const transactionTransfers of candidateTransactions) {
    const lpShape = summarizeWalletLpTransfers({
      walletAddress,
      transfers: transactionTransfers,
    });

    if (!lpShape.ok) {
      warnings.push(
        `skip-lp:${transactionTransfers[0]?.txHash ?? "unknown"}:${lpShape.reason}`,
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
      warnings.push(`skip-lp:${transaction.hash.toLowerCase()}:missing-tx-block`);
      continue;
    }

    if (transaction.from.toLowerCase() !== walletAddress) {
      warnings.push(`skip-lp:${transaction.hash.toLowerCase()}:unsupported-initiator`);
      continue;
    }

    const feeGasPrice = receipt.effectiveGasPrice ?? transaction.gasPrice;

    if (feeGasPrice === null) {
      warnings.push(`skip-lp:${transaction.hash.toLowerCase()}:missing-gas-price`);
      continue;
    }

    processedLpCandidates += 1;

    await persistRawTransactions(
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

    await persistRawLpActions(
      [
        {
          chainId: args.wallet.chainId,
          protocolSlug: CORE_PROTOCOLS.pulsex.slug,
          actionKind: lpShape.actionKind,
          txHash: transaction.hash,
          blockNumber: transaction.blockNumber,
          blockHash: transaction.blockHash,
          logIndex: lpShape.lpLeg.logIndex,
          pairAddress: lpShape.lpToken.tokenAddress,
          initiatorAddress: transaction.from,
          counterpartyAddress: transaction.to,
          token0Address: lpShape.token0.tokenAddress,
          token0AssetIdSnapshot: lpShape.token0.assetIdSnapshot,
          token0DecimalsSnapshot: lpShape.token0.decimalsSnapshot,
          token0AmountRaw: lpShape.token0.amountRaw,
          token1Address: lpShape.token1.tokenAddress,
          token1AssetIdSnapshot: lpShape.token1.assetIdSnapshot,
          token1DecimalsSnapshot: lpShape.token1.decimalsSnapshot,
          token1AmountRaw: lpShape.token1.amountRaw,
          lpTokenAddress: lpShape.lpToken.tokenAddress,
          lpAssetIdSnapshot: lpShape.lpToken.assetIdSnapshot,
          lpDecimalsSnapshot: lpShape.lpToken.decimalsSnapshot,
          lpAmountRaw: lpShape.lpToken.amountRaw,
          feeAssetIdSnapshot: NATIVE_SWAP_FEE_ASSET.assetId,
          feeDecimalsSnapshot: NATIVE_SWAP_FEE_ASSET.decimals,
          feeAmountRaw: (receipt.gasUsed * feeGasPrice).toString(),
        },
      ],
      args.db as never,
    );
  }

  const rawActions = await readWalletRawLpActions(
    {
      chainId: args.wallet.chainId,
      walletAddress: args.wallet.address,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    },
    args.db as never,
  );

  return {
    rawLogCount: artifacts.rawLogCount,
    latestBlockHash: artifacts.latestBlockHash,
    logs: rawActions.map((action) => ({
      ...action,
      occurredAt: getOccurredAtForLpAction(action, artifacts.timestampByBlockKey),
    })),
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    warnings: [
      ...warnings,
      ...(processedLpCandidates > 0 && rawActions.length === 0
        ? ["some lp candidates were already persisted"]
        : []),
    ],
  };
}

export function normalizeLpActions(args: {
  normalizerVersion: string;
  wallet: { id: string; chainId: number; address: string };
  rawLogs: readonly PersistedRawLpAction[];
}) {
  const drafts: CanonicalLedgerEntryDraft[] = [];

  for (const rawLog of args.rawLogs) {
    if (rawLog.actionKind === "ADD") {
      drafts.push(
        ...normalizeLpAdd({
          chainId: args.wallet.chainId,
          walletId: args.wallet.id,
          walletAddress: args.wallet.address,
          txHash: rawLog.txHash,
          blockNumber: rawLog.blockNumber,
          sourceRef: `lp:add:${rawLog.logIndex}`,
          occurredAt: rawLog.occurredAt,
          normalizerVersion: args.normalizerVersion,
          token0AssetId: rawLog.token0AssetIdSnapshot,
          token0AmountRaw: rawLog.token0AmountRaw,
          token0Decimals: rawLog.token0DecimalsSnapshot,
          token1AssetId: rawLog.token1AssetIdSnapshot,
          token1AmountRaw: rawLog.token1AmountRaw,
          token1Decimals: rawLog.token1DecimalsSnapshot,
          lpAssetId: rawLog.lpAssetIdSnapshot,
          lpAmountRaw: rawLog.lpAmountRaw,
          lpDecimals: rawLog.lpDecimalsSnapshot,
          feeAssetId: rawLog.feeAssetIdSnapshot,
          feeAmountRaw: rawLog.feeAmountRaw,
          feeDecimals: rawLog.feeDecimalsSnapshot,
        }),
      );
      continue;
    }

    drafts.push(
      ...normalizeLpRemove({
        chainId: args.wallet.chainId,
        walletId: args.wallet.id,
        walletAddress: args.wallet.address,
        txHash: rawLog.txHash,
        blockNumber: rawLog.blockNumber,
        sourceRef: `lp:remove:${rawLog.logIndex}`,
        occurredAt: rawLog.occurredAt,
        normalizerVersion: args.normalizerVersion,
        token0AssetId: rawLog.token0AssetIdSnapshot,
        token0AmountRaw: rawLog.token0AmountRaw,
        token0Decimals: rawLog.token0DecimalsSnapshot,
        token1AssetId: rawLog.token1AssetIdSnapshot,
        token1AmountRaw: rawLog.token1AmountRaw,
        token1Decimals: rawLog.token1DecimalsSnapshot,
        lpAssetId: rawLog.lpAssetIdSnapshot,
        lpAmountRaw: rawLog.lpAmountRaw,
        lpDecimals: rawLog.lpDecimalsSnapshot,
        feeAssetId: rawLog.feeAssetIdSnapshot,
        feeAmountRaw: rawLog.feeAmountRaw,
        feeDecimals: rawLog.feeDecimalsSnapshot,
      }),
    );
  }

  return drafts;
}

type AggregatedTransfer = {
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  amountRaw: string;
  logIndex: number;
};

type LpShape =
  | {
      ok: true;
      actionKind: "ADD" | "REMOVE";
      token0: AggregatedTransfer;
      token1: AggregatedTransfer;
      lpToken: AggregatedTransfer;
      lpLeg: AggregatedTransfer;
    }
  | {
      ok: false;
      reason: string;
    };

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

function summarizeWalletLpTransfers(args: {
  walletAddress: string;
  transfers: readonly WalletTransferSnapshot[];
}): LpShape {
  const outbound = aggregateTransfers(
    args.transfers.filter((transfer) => transfer.fromAddress === args.walletAddress),
  );
  const inbound = aggregateTransfers(
    args.transfers.filter((transfer) => transfer.toAddress === args.walletAddress),
  );

  if (outbound.length === 2 && inbound.length === 1) {
    const [token0, token1] = sortPairAssets(outbound);
    const [lpToken] = inbound;

    if (
      token0.assetIdSnapshot === lpToken.assetIdSnapshot ||
      token1.assetIdSnapshot === lpToken.assetIdSnapshot
    ) {
      return { ok: false, reason: "lp-add-overlapping-assets" };
    }

    return {
      ok: true,
      actionKind: "ADD",
      token0,
      token1,
      lpToken,
      lpLeg: lpToken,
    };
  }

  if (outbound.length === 1 && inbound.length === 2) {
    const [lpToken] = outbound;
    const [token0, token1] = sortPairAssets(inbound);

    if (
      token0.assetIdSnapshot === lpToken.assetIdSnapshot ||
      token1.assetIdSnapshot === lpToken.assetIdSnapshot
    ) {
      return { ok: false, reason: "lp-remove-overlapping-assets" };
    }

    return {
      ok: true,
      actionKind: "REMOVE",
      token0,
      token1,
      lpToken,
      lpLeg: lpToken,
    };
  }

  return {
    ok: false,
    reason: `ambiguous-transfer-shape:${outbound.length}:${inbound.length}`,
  };
}

function aggregateTransfers(transfers: readonly WalletTransferSnapshot[]) {
  const bucket = new Map<string, AggregatedTransfer & { amountRawBigInt: bigint }>();

  for (const transfer of transfers) {
    const existing = bucket.get(transfer.assetIdSnapshot);

    if (existing) {
      existing.amountRawBigInt += BigInt(transfer.amountRaw);
      existing.amountRaw = existing.amountRawBigInt.toString();
      existing.logIndex = Math.min(existing.logIndex, transfer.logIndex);
      continue;
    }

    bucket.set(transfer.assetIdSnapshot, {
      tokenAddress: transfer.tokenAddress,
      assetIdSnapshot: transfer.assetIdSnapshot,
      decimalsSnapshot: transfer.decimalsSnapshot,
      amountRaw: transfer.amountRaw,
      amountRawBigInt: BigInt(transfer.amountRaw),
      logIndex: transfer.logIndex,
    });
  }

  return Array.from(bucket.values()).map((value) => ({
    tokenAddress: value.tokenAddress,
    assetIdSnapshot: value.assetIdSnapshot,
    decimalsSnapshot: value.decimalsSnapshot,
    amountRaw: value.amountRaw,
    logIndex: value.logIndex,
  }));
}

function sortPairAssets(transfers: readonly AggregatedTransfer[]) {
  return [...transfers].sort((left, right) =>
    left.assetIdSnapshot.localeCompare(right.assetIdSnapshot),
  );
}
