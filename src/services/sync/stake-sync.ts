import "server-only";

import { decodeFunctionData, parseAbi } from "viem";

import { CORE_ASSETS, PHEX_ADDRESS, PHEX_DECIMALS } from "@/config/assets";
import { CORE_PROTOCOLS } from "@/config/protocols";
import {
  persistRawStakeActions,
  persistRawTransactions,
  readStakeStartSnapshotByStakeId,
  readWalletRawStakeActions,
} from "@/services/ingestion/raw-store";
import {
  normalizeStakeEnd,
  normalizeStakeStart,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization";
import { NATIVE_SWAP_FEE_ASSET } from "@/services/sync/dex-sync";
import {
  getOccurredAtForStakeAction,
  type SyncDbClient,
  type SyncPublicClient,
  ingestWalletTransferArtifacts,
  type WalletTransferSnapshot,
  canonicalizeSnapshotAssetId,
} from "@/services/sync/sync-common";

const PHEX_ADDRESS_LOWER = PHEX_ADDRESS.toLowerCase();

const PHEX_STAKE_ABI = parseAbi([
  "function startStake(uint256 newStakedHearts, uint256 newStakedDays)",
  "function endStake(uint256 stakeIndex, uint40 stakeIdParam)",
  "function stakeCount(address stakerAddr) view returns (uint256)",
  "function stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
]);

export type PersistedRawStakeAction = Awaited<
  ReturnType<typeof readWalletRawStakeActions>
>[number] & {
  occurredAt: Date;
};

type DecodedStakeCall =
  | {
      kind: "START";
      principalRaw: string;
      stakedDays: number;
    }
  | {
      kind: "END";
      stakeIndex: number;
      stakeId: bigint;
    }
  | {
      kind: "UNSUPPORTED";
      reason: string;
    };

export async function ingestStakeActions(args: {
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
  const phexTransfers = artifacts.transferSnapshots.filter(
    (transfer) => transfer.tokenAddress === PHEX_ADDRESS_LOWER,
  );
  const transfersByTransaction = groupTransfersByTransaction(phexTransfers);
  const candidateTransactions = Array.from(transfersByTransaction.values()).sort(
    (left, right) =>
      left[0].blockNumber === right[0].blockNumber
        ? left[0].txHash.localeCompare(right[0].txHash)
        : Number(left[0].blockNumber - right[0].blockNumber),
  );
  let processedCandidates = 0;

  for (const transactionTransfers of candidateTransactions) {
    const txHash = transactionTransfers[0].txHash as `0x${string}`;
    const transaction = await args.publicClient.getTransaction({ hash: txHash });

    if (!transaction.blockHash || transaction.blockNumber === null) {
      warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:missing-tx-block`);
      continue;
    }

    if (transaction.from.toLowerCase() !== walletAddress) {
      warnings.push(
        `skip-stake:${transaction.hash.toLowerCase()}:unsupported-initiator`,
      );
      continue;
    }

    if (transaction.to?.toLowerCase() !== PHEX_ADDRESS_LOWER) {
      warnings.push(
        `skip-stake:${transaction.hash.toLowerCase()}:unsupported-contract-target`,
      );
      continue;
    }

    const decodedCall = decodeStakeCall(transaction.input);

    if (decodedCall.kind === "UNSUPPORTED") {
      warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:${decodedCall.reason}`);
      continue;
    }

    const receipt = await args.publicClient.getTransactionReceipt({ hash: txHash });
    const feeGasPrice = receipt.effectiveGasPrice ?? transaction.gasPrice;

    if (feeGasPrice === null) {
      warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:missing-gas-price`);
      continue;
    }

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

    if (decodedCall.kind === "START") {
      const startShape = summarizeStakeStartTransfers({
        walletAddress,
        transfers: transactionTransfers,
      });

      if (!startShape.ok) {
        warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:${startShape.reason}`);
        continue;
      }

      const stakeCountResult = await args.publicClient.readContract({
        address: PHEX_ADDRESS_LOWER as `0x${string}`,
        abi: PHEX_STAKE_ABI,
        functionName: "stakeCount",
        args: [walletAddress as `0x${string}`],
        blockNumber: transaction.blockNumber,
      });
      const stakeCount = BigInt(stakeCountResult as bigint | number | string);

      if (stakeCount === 0n) {
        warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:empty-stake-count`);
        continue;
      }

      const stakeIndex = Number(stakeCount - 1n);
      const stake = (await args.publicClient.readContract({
        address: PHEX_ADDRESS_LOWER as `0x${string}`,
        abi: PHEX_STAKE_ABI,
        functionName: "stakeLists",
        args: [walletAddress as `0x${string}`, BigInt(stakeIndex)],
        blockNumber: transaction.blockNumber,
      })) as readonly [bigint, bigint, bigint, number, number, number, boolean];

      const stakeId = BigInt(stake[0]);
      const stakedHearts = BigInt(stake[1]);
      const stakedDays = Number(stake[4]);

      if (stakedHearts.toString() !== decodedCall.principalRaw) {
        warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:principal-mismatch`);
        continue;
      }

      processedCandidates += 1;

      await persistRawStakeActions(
        [
          {
            chainId: args.wallet.chainId,
            protocolSlug: CORE_PROTOCOLS.hex.slug,
            actionKind: "START",
            txHash: transaction.hash,
            blockNumber: transaction.blockNumber,
            blockHash: transaction.blockHash,
            actionIndex: 0,
            contractAddress: PHEX_ADDRESS_LOWER,
            initiatorAddress: transaction.from,
            stakeId,
            stakeIndex,
            stakedDays,
            tokenAddress: PHEX_ADDRESS_LOWER,
            assetIdSnapshot: CORE_ASSETS.phex.assetId,
            decimalsSnapshot: PHEX_DECIMALS,
            principalLockedRaw: decodedCall.principalRaw,
            feeAssetIdSnapshot: NATIVE_SWAP_FEE_ASSET.assetId,
            feeDecimalsSnapshot: NATIVE_SWAP_FEE_ASSET.decimals,
            feeAmountRaw: (receipt.gasUsed * feeGasPrice).toString(),
          },
        ],
        args.db as never,
      );

      continue;
    }

    const endShape = summarizeStakeEndTransfers({
      walletAddress,
      transfers: transactionTransfers,
    });

    if (!endShape.ok) {
      warnings.push(`skip-stake:${transaction.hash.toLowerCase()}:${endShape.reason}`);
      continue;
    }

    const matchedStart = await readStakeStartSnapshotByStakeId(
      {
        chainId: args.wallet.chainId,
        walletAddress,
        stakeId: decodedCall.stakeId,
      },
      args.db as never,
    );

    let principalReturnedRaw: string | null = null;
    let yieldRaw: string | null = null;
    let penaltyRaw: string | null = null;

    if (matchedStart?.principalLockedRaw) {
      const principalLocked = BigInt(matchedStart.principalLockedRaw);
      const totalReturned = BigInt(endShape.totalReturnedRaw);
      const principalReturned = totalReturned < principalLocked ? totalReturned : principalLocked;
      const yieldAmount = totalReturned > principalLocked ? totalReturned - principalLocked : 0n;
      const penaltyAmount = totalReturned < principalLocked ? principalLocked - totalReturned : 0n;

      principalReturnedRaw = principalReturned.toString();
      yieldRaw = yieldAmount === 0n ? null : yieldAmount.toString();
      penaltyRaw = penaltyAmount === 0n ? null : penaltyAmount.toString();
    }

    processedCandidates += 1;

    await persistRawStakeActions(
      [
        {
          chainId: args.wallet.chainId,
          protocolSlug: CORE_PROTOCOLS.hex.slug,
          actionKind: "END",
          txHash: transaction.hash,
          blockNumber: transaction.blockNumber,
          blockHash: transaction.blockHash,
          actionIndex: 0,
          contractAddress: PHEX_ADDRESS_LOWER,
          initiatorAddress: transaction.from,
          stakeId: decodedCall.stakeId,
          stakeIndex: decodedCall.stakeIndex,
          tokenAddress: PHEX_ADDRESS_LOWER,
          assetIdSnapshot: CORE_ASSETS.phex.assetId,
          decimalsSnapshot: PHEX_DECIMALS,
          totalReturnedRaw: endShape.totalReturnedRaw,
          principalReturnedRaw,
          yieldRaw,
          penaltyRaw,
          feeAssetIdSnapshot: NATIVE_SWAP_FEE_ASSET.assetId,
          feeDecimalsSnapshot: NATIVE_SWAP_FEE_ASSET.decimals,
          feeAmountRaw: (receipt.gasUsed * feeGasPrice).toString(),
        },
      ],
      args.db as never,
    );
  }

  const rawActions = await readWalletRawStakeActions(
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
      occurredAt: getOccurredAtForStakeAction(action, artifacts.timestampByBlockKey),
    })),
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    warnings: [
      ...warnings,
      ...(processedCandidates > 0 && rawActions.length === 0
        ? ["some stake candidates were already persisted"]
        : []),
    ],
  };
}

export function normalizeStakeActions(args: {
  normalizerVersion: string;
  wallet: { id: string; chainId: number; address: string };
  rawLogs: readonly PersistedRawStakeAction[];
}) {
  const drafts: CanonicalLedgerEntryDraft[] = [];

  for (const rawLog of args.rawLogs) {
    if (rawLog.actionKind === "START") {
      if (!rawLog.principalLockedRaw) {
        continue;
      }

      drafts.push(
        ...normalizeStakeStart({
          chainId: args.wallet.chainId,
          walletId: args.wallet.id,
          walletAddress: args.wallet.address,
          txHash: rawLog.txHash,
          blockNumber: rawLog.blockNumber,
          occurredAt: rawLog.occurredAt,
          normalizerVersion: args.normalizerVersion,
          assetId: rawLog.assetIdSnapshot,
          decimals: rawLog.decimalsSnapshot,
          principalLockedRaw: rawLog.principalLockedRaw,
          feeAssetId: canonicalizeSnapshotAssetId(rawLog.feeAssetIdSnapshot),
          feeAmountRaw: rawLog.feeAmountRaw,
          feeDecimals: rawLog.feeDecimalsSnapshot,
          sourceRef: `stake:start:${rawLog.stakeId ?? rawLog.actionIndex}`,
        }),
      );
      continue;
    }

    drafts.push(
      ...normalizeStakeEnd({
        chainId: args.wallet.chainId,
        walletId: args.wallet.id,
        walletAddress: args.wallet.address,
        txHash: rawLog.txHash,
        blockNumber: rawLog.blockNumber,
        occurredAt: rawLog.occurredAt,
        normalizerVersion: args.normalizerVersion,
        assetId: rawLog.assetIdSnapshot,
        decimals: rawLog.decimalsSnapshot,
        principalReturnedRaw: rawLog.principalReturnedRaw,
        yieldRaw: rawLog.yieldRaw,
        penaltyRaw: rawLog.penaltyRaw,
        feeAssetId: rawLog.feeAssetIdSnapshot,
        feeAmountRaw: rawLog.feeAmountRaw,
        feeDecimals: rawLog.feeDecimalsSnapshot,
        sourceRef: `stake:end:${rawLog.stakeId ?? rawLog.actionIndex}`,
      }),
    );
  }

  return drafts;
}

function decodeStakeCall(input: string | null | undefined): DecodedStakeCall {
  if (!input || input === "0x") {
    return { kind: "UNSUPPORTED", reason: "missing-input" };
  }

  try {
    const decoded = decodeFunctionData({
      abi: PHEX_STAKE_ABI,
      data: input as `0x${string}`,
    });

    if (decoded.functionName === "startStake") {
      const [principalRaw, stakedDays] = decoded.args as readonly [bigint, bigint];

      return {
        kind: "START",
        principalRaw: principalRaw.toString(),
        stakedDays: Number(stakedDays),
      };
    }

    if (decoded.functionName === "endStake") {
      const [stakeIndex, stakeIdParam] = decoded.args as readonly [
        bigint,
        bigint | number,
      ];

      return {
        kind: "END",
        stakeIndex: Number(stakeIndex),
        stakeId: BigInt(stakeIdParam),
      };
    }
  } catch {
    return { kind: "UNSUPPORTED", reason: "unsupported-selector" };
  }

  return { kind: "UNSUPPORTED", reason: "unsupported-selector" };
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

function summarizeStakeStartTransfers(args: {
  walletAddress: string;
  transfers: readonly WalletTransferSnapshot[];
}) {
  const outbound = args.transfers.filter(
    (transfer) => transfer.fromAddress === args.walletAddress,
  );
  const inbound = args.transfers.filter(
    (transfer) => transfer.toAddress === args.walletAddress,
  );

  if (outbound.length !== 1 || inbound.length !== 0) {
    return {
      ok: false as const,
      reason: `ambiguous-start-transfer-shape:${outbound.length}:${inbound.length}`,
    };
  }

  return { ok: true as const };
}

function summarizeStakeEndTransfers(args: {
  walletAddress: string;
  transfers: readonly WalletTransferSnapshot[];
}) {
  const outbound = args.transfers.filter(
    (transfer) => transfer.fromAddress === args.walletAddress,
  );
  const inbound = args.transfers.filter(
    (transfer) => transfer.toAddress === args.walletAddress,
  );

  if (outbound.length !== 0 || inbound.length !== 1) {
    return {
      ok: false as const,
      reason: `ambiguous-end-transfer-shape:${outbound.length}:${inbound.length}`,
    };
  }

  return {
    ok: true as const,
    totalReturnedRaw: inbound[0].amountRaw,
  };
}
