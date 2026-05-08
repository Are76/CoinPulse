import {
  buildActionGroupKey,
  createLedgerEntryDraft,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization/types";

type NormalizeLpAddArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  sourceRef: string;
  occurredAt: Date;
  normalizerVersion: string;
  token0AssetId: string;
  token0AmountRaw: string;
  token0Decimals: number;
  token1AssetId: string;
  token1AmountRaw: string;
  token1Decimals: number;
  lpAssetId: string;
  lpAmountRaw: string;
  lpDecimals: number;
  feeAssetId?: string;
  feeAmountRaw?: string;
  feeDecimals?: number;
};

export function normalizeLpAdd(
  args: NormalizeLpAddArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "LP_ADD",
    sourceRef: args.sourceRef,
  });

  const entries: CanonicalLedgerEntryDraft[] = [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_ADD",
      actionGroupKey,
      entryType: "LP_ADD_OUT",
      assetId: args.token0AssetId,
      amountRaw: args.token0AmountRaw,
      decimals: args.token0Decimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:token0`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_ADD",
      actionGroupKey,
      entryType: "LP_ADD_OUT",
      assetId: args.token1AssetId,
      amountRaw: args.token1AmountRaw,
      decimals: args.token1Decimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:token1`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_ADD",
      actionGroupKey,
      entryType: "LP_ADD_IN",
      assetId: args.lpAssetId,
      amountRaw: args.lpAmountRaw,
      decimals: args.lpDecimals,
      direction: "IN",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:lp`,
    }),
  ];

  if (
    args.feeAssetId &&
    args.feeAmountRaw &&
    typeof args.feeDecimals === "number" &&
    args.feeAmountRaw !== "0"
  ) {
    entries.push(
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "LP_ADD",
        actionGroupKey,
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

  return entries;
}

type NormalizeLpRemoveArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  sourceRef: string;
  occurredAt: Date;
  normalizerVersion: string;
  token0AssetId: string;
  token0AmountRaw: string;
  token0Decimals: number;
  token1AssetId: string;
  token1AmountRaw: string;
  token1Decimals: number;
  lpAssetId: string;
  lpAmountRaw: string;
  lpDecimals: number;
  feeAssetId?: string;
  feeAmountRaw?: string;
  feeDecimals?: number;
};

export function normalizeLpRemove(
  args: NormalizeLpRemoveArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "LP_REMOVE",
    sourceRef: args.sourceRef,
  });

  const entries: CanonicalLedgerEntryDraft[] = [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_REMOVE",
      actionGroupKey,
      entryType: "LP_REMOVE_OUT",
      assetId: args.lpAssetId,
      amountRaw: args.lpAmountRaw,
      decimals: args.lpDecimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:lp`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_REMOVE",
      actionGroupKey,
      entryType: "LP_REMOVE_IN",
      assetId: args.token0AssetId,
      amountRaw: args.token0AmountRaw,
      decimals: args.token0Decimals,
      direction: "IN",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:token0`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "LP_REMOVE",
      actionGroupKey,
      entryType: "LP_REMOVE_IN",
      assetId: args.token1AssetId,
      amountRaw: args.token1AmountRaw,
      decimals: args.token1Decimals,
      direction: "IN",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:token1`,
    }),
  ];

  if (
    args.feeAssetId &&
    args.feeAmountRaw &&
    typeof args.feeDecimals === "number" &&
    args.feeAmountRaw !== "0"
  ) {
    entries.push(
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "LP_REMOVE",
        actionGroupKey,
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

  return entries;
}
