import {
  buildActionGroupKey,
  createLedgerEntryDraft,
  type CanonicalLedgerEntryDraft,
} from "@/services/normalization/types";

type NormalizeTransferArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  trackedWalletAddresses?: readonly string[];
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  tokenAddress: string;
  assetId: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  decimals: number;
  occurredAt: Date;
  normalizerVersion: string;
};

export function normalizeTransfer(
  args: NormalizeTransferArgs,
): CanonicalLedgerEntryDraft[] {
  const walletAddress = args.walletAddress.toLowerCase();
  const fromAddress = args.fromAddress.toLowerCase();
  const toAddress = args.toAddress.toLowerCase();
  const trackedAddresses = new Set(
    (args.trackedWalletAddresses ?? [args.walletAddress]).map((address) =>
      address.toLowerCase(),
    ),
  );
  const senderTracked = trackedAddresses.has(fromAddress);
  const recipientTracked = trackedAddresses.has(toAddress);

  if (!senderTracked && !recipientTracked) {
    return [];
  }

  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "TRANSFER",
    sourceRef: `transfer:${args.logIndex}`,
  });

  if (senderTracked && recipientTracked && (fromAddress === walletAddress || toAddress === walletAddress)) {
    return [
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "TRANSFER",
        actionGroupKey,
        entryType: "INTERNAL_TRANSFER",
        assetId: args.assetId,
        amountRaw: args.amountRaw,
        decimals: args.decimals,
        direction: "INTERNAL",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceLogIndex: args.logIndex,
        sourceRef: "transfer:internal",
      }),
    ];
  }

  if (toAddress === walletAddress) {
    return [
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "TRANSFER",
        actionGroupKey,
        entryType: "RECEIVE",
        assetId: args.assetId,
        amountRaw: args.amountRaw,
        decimals: args.decimals,
        direction: "IN",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceLogIndex: args.logIndex,
        sourceRef: "transfer:receive",
      }),
    ];
  }

  if (fromAddress === walletAddress) {
    return [
      createLedgerEntryDraft({
        chainId: args.chainId,
        walletId: args.walletId,
        walletAddress: args.walletAddress,
        txHash: args.txHash,
        blockNumber: args.blockNumber,
        actionType: "TRANSFER",
        actionGroupKey,
        entryType: "SEND",
        assetId: args.assetId,
        amountRaw: args.amountRaw,
        decimals: args.decimals,
        direction: "OUT",
        occurredAt: args.occurredAt,
        normalizerVersion: args.normalizerVersion,
        sourceLogIndex: args.logIndex,
        sourceRef: "transfer:send",
      }),
    ];
  }

  return [];
}
