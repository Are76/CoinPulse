import {
  buildActionGroupKey,
  createLedgerEntryDraft,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization/types";

type NormalizeHexStakeLockArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  sourceRef: string;
  occurredAt: Date;
  normalizerVersion: string;
  assetId: string;
  amountRaw: string;
  decimals: number;
};

export function normalizeHexStakeLock(
  args: NormalizeHexStakeLockArgs,
): CanonicalLedgerEntryDraft[] {
  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "HEX_STAKE_LOCK",
    sourceRef: args.sourceRef,
  });

  return [
    createLedgerEntryDraft({
      chainId: args.chainId,
      walletId: args.walletId,
      walletAddress: args.walletAddress,
      txHash: args.txHash,
      blockNumber: args.blockNumber,
      actionType: "HEX_STAKE_LOCK",
      actionGroupKey,
      entryType: "STAKE_LOCK",
      assetId: args.assetId,
      amountRaw: args.amountRaw,
      decimals: args.decimals,
      direction: "OUT",
      occurredAt: args.occurredAt,
      normalizerVersion: args.normalizerVersion,
      sourceRef: args.sourceRef,
    }),
  ];
}
