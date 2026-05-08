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

  return [
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
}
