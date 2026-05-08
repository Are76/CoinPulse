import {
  buildActionGroupKey,
  createLedgerEntryDraft,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization/types";

type StakeBaseArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  occurredAt: Date;
  normalizerVersion: string;
  assetId: string;
  decimals: number;
  sourceRef: string;
  feeAssetId?: string;
  feeAmountRaw?: string;
  feeDecimals?: number;
};

type NormalizeStakeStartArgs = StakeBaseArgs & {
  principalLockedRaw: string;
};

type NormalizeStakeEndArgs = StakeBaseArgs & {
  principalReturnedRaw?: string | null;
  yieldRaw?: string | null;
  penaltyRaw?: string | null;
};

export function normalizeStakeStart(
  args: NormalizeStakeStartArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "HEX_STAKE_START",
    sourceRef: args.sourceRef,
  });

  const entries: CanonicalLedgerEntryDraft[] = [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "HEX_STAKE_START",
      actionGroupKey,
      entryType: "STAKE_START",
      assetId: args.assetId,
      amountRaw: "0",
      decimals: args.decimals,
      direction: "INTERNAL",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:start`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "HEX_STAKE_START",
      actionGroupKey,
      entryType: "STAKE_PRINCIPAL_LOCKED",
      assetId: args.assetId,
      amountRaw: args.principalLockedRaw,
      decimals: args.decimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:principal`,
    }),
  ];

  appendFee(entries, {
    ...args,
    actionType: "HEX_STAKE_START",
    actionGroupKey,
  });

  return entries;
}

export function normalizeStakeEnd(
  args: NormalizeStakeEndArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "HEX_STAKE_END",
    sourceRef: args.sourceRef,
  });

  const entries: CanonicalLedgerEntryDraft[] = [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "HEX_STAKE_END",
      actionGroupKey,
      entryType: "STAKE_END",
      assetId: args.assetId,
      amountRaw: "0",
      decimals: args.decimals,
      direction: "INTERNAL",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:end`,
    }),
  ];

  if (args.principalReturnedRaw && args.principalReturnedRaw !== "0") {
    entries.push(
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "HEX_STAKE_END",
        actionGroupKey,
        entryType: "STAKE_PRINCIPAL_RETURNED",
        assetId: args.assetId,
        amountRaw: args.principalReturnedRaw,
        decimals: args.decimals,
        direction: "IN",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceRef: `${args.sourceRef}:principal`,
      }),
    );
  }

  if (args.yieldRaw && args.yieldRaw !== "0") {
    entries.push(
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "HEX_STAKE_END",
        actionGroupKey,
        entryType: "STAKE_YIELD_RECEIVED",
        assetId: args.assetId,
        amountRaw: args.yieldRaw,
        decimals: args.decimals,
        direction: "IN",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceRef: `${args.sourceRef}:yield`,
      }),
    );
  }

  if (args.penaltyRaw && args.penaltyRaw !== "0") {
    entries.push(
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "HEX_STAKE_END",
        actionGroupKey,
        entryType: "STAKE_PENALTY",
        assetId: args.assetId,
        amountRaw: args.penaltyRaw,
        decimals: args.decimals,
        direction: "OUT",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceRef: `${args.sourceRef}:penalty`,
      }),
    );
  }

  appendFee(entries, {
    ...args,
    actionType: "HEX_STAKE_END",
    actionGroupKey,
  });

  return entries;
}

function appendFee(
  entries: CanonicalLedgerEntryDraft[],
  args: StakeBaseArgs & {
    actionType: "HEX_STAKE_START" | "HEX_STAKE_END";
    actionGroupKey: string;
  },
) {
  if (
    !args.feeAssetId ||
    !args.feeAmountRaw ||
    typeof args.feeDecimals !== "number" ||
    args.feeAmountRaw === "0"
  ) {
    return;
  }

  entries.push(
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: args.actionType,
      actionGroupKey: args.actionGroupKey,
      entryType: "FEE",
      assetId: args.feeAssetId,
      amountRaw: args.feeAmountRaw,
      decimals: args.feeDecimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:fee`,
    }),
  );
}
