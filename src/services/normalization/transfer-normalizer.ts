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

type NormalizeNativeTransactionArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  trackedWalletAddresses?: readonly string[];
  txHash: string;
  blockNumber: bigint;
  fromAddress: string;
  toAddress: string | null;
  valueRaw: string;
  gasPriceRaw: string | null;
  gasUsedRaw: string | null;
  nativeAssetId: string;
  nativeDecimals: number;
  occurredAt: Date;
  normalizerVersion: string;
  hasTrackedTokenTransfersInTransaction?: boolean;
};

export function normalizeTransfer(
  args: NormalizeTransferArgs,
): CanonicalLedgerEntryDraft[] {
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

  if (senderTracked && recipientTracked) {
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

  if (recipientTracked) {
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

  if (senderTracked) {
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

export function normalizeNativeTransaction(
  args: NormalizeNativeTransactionArgs,
): CanonicalLedgerEntryDraft[] {
  const fromAddress = args.fromAddress.toLowerCase();
  const toAddress = args.toAddress?.toLowerCase() ?? null;
  const trackedAddresses = new Set(
    (args.trackedWalletAddresses ?? [args.walletAddress]).map((address) =>
      address.toLowerCase(),
    ),
  );
  const senderTracked = trackedAddresses.has(fromAddress);
  const recipientTracked = toAddress ? trackedAddresses.has(toAddress) : false;

  if (!senderTracked && !recipientTracked) {
    return [];
  }

  const actionGroupKey = buildActionGroupKey({
    chainId: args.chainId,
    walletId: args.walletId,
    txHash: args.txHash,
    actionType: "TRANSFER",
    sourceRef: "transfer:tx",
  });
  const entries: CanonicalLedgerEntryDraft[] = [];

  if (
    args.valueRaw !== "0" &&
    !args.hasTrackedTokenTransfersInTransaction
  ) {
    if (senderTracked && recipientTracked) {
      entries.push(
        createLedgerEntryDraft({
          chainId: args.chainId,
          walletId: args.walletId,
          walletAddress: args.walletAddress,
          txHash: args.txHash,
          blockNumber: args.blockNumber,
          actionType: "TRANSFER",
          actionGroupKey,
          entryType: "INTERNAL_TRANSFER",
          assetId: args.nativeAssetId,
          amountRaw: args.valueRaw,
          decimals: args.nativeDecimals,
          direction: "INTERNAL",
          occurredAt: args.occurredAt,
          normalizerVersion: args.normalizerVersion,
          sourceRef: "transfer:tx:native:internal",
        }),
      );
    } else if (recipientTracked) {
      entries.push(
        createLedgerEntryDraft({
          chainId: args.chainId,
          walletId: args.walletId,
          walletAddress: args.walletAddress,
          txHash: args.txHash,
          blockNumber: args.blockNumber,
          actionType: "TRANSFER",
          actionGroupKey,
          entryType: "RECEIVE",
          assetId: args.nativeAssetId,
          amountRaw: args.valueRaw,
          decimals: args.nativeDecimals,
          direction: "IN",
          occurredAt: args.occurredAt,
          normalizerVersion: args.normalizerVersion,
          sourceRef: "transfer:tx:native:receive",
        }),
      );
    } else if (senderTracked) {
      entries.push(
        createLedgerEntryDraft({
          chainId: args.chainId,
          walletId: args.walletId,
          walletAddress: args.walletAddress,
          txHash: args.txHash,
          blockNumber: args.blockNumber,
          actionType: "TRANSFER",
          actionGroupKey,
          entryType: "SEND",
          assetId: args.nativeAssetId,
          amountRaw: args.valueRaw,
          decimals: args.nativeDecimals,
          direction: "OUT",
          occurredAt: args.occurredAt,
          normalizerVersion: args.normalizerVersion,
          sourceRef: "transfer:tx:native:send",
        }),
      );
    }
  }

  if (
    senderTracked &&
    args.gasPriceRaw &&
    args.gasUsedRaw
  ) {
    const feeRaw = (BigInt(args.gasPriceRaw) * BigInt(args.gasUsedRaw)).toString();

    if (feeRaw !== "0") {
      entries.push(
        createLedgerEntryDraft({
          chainId: args.chainId,
          walletId: args.walletId,
          walletAddress: args.walletAddress,
          txHash: args.txHash,
          blockNumber: args.blockNumber,
          actionType: "TRANSFER",
          actionGroupKey,
          entryType: "FEE",
          assetId: args.nativeAssetId,
          amountRaw: feeRaw,
          decimals: args.nativeDecimals,
          direction: "OUT",
          occurredAt: args.occurredAt,
          normalizerVersion: args.normalizerVersion,
          sourceRef: "transfer:tx:fee",
        }),
      );
    }
  }

  return entries;
}
