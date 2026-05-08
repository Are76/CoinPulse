import {
  buildActionGroupKey,
  createLedgerEntryDraft,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization/types";

type NormalizeSwapArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  sourceRef: string;
  occurredAt: Date;
  normalizerVersion: string;
  soldAssetId: string;
  soldAmountRaw: string;
  soldDecimals: number;
  boughtAssetId: string;
  boughtAmountRaw: string;
  boughtDecimals: number;
  feeAssetId: string;
  feeAmountRaw: string;
  feeDecimals: number;
};

export function normalizeSwap(
  args: NormalizeSwapArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "SWAP",
    sourceRef: args.sourceRef,
  });

  return [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "SWAP",
      actionGroupKey,
      entryType: "SWAP_OUT",
      assetId: args.soldAssetId,
      amountRaw: args.soldAmountRaw,
      decimals: args.soldDecimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:out`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "SWAP",
      actionGroupKey,
      entryType: "SWAP_IN",
      assetId: args.boughtAssetId,
      amountRaw: args.boughtAmountRaw,
      decimals: args.boughtDecimals,
      direction: "IN",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: `${args.sourceRef}:in`,
    }),
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "SWAP",
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
  ];
}
