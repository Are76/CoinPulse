import { createHash } from "node:crypto";

import { buildLedgerEntryDedupeKey } from "@/services/normalization/ledger-dedupe";

export type NormalizedEntryType =
  | "RECEIVE"
  | "SEND"
  | "SWAP_IN"
  | "SWAP_OUT"
  | "FEE"
  | "LP_ADD_IN"
  | "LP_ADD_OUT"
  | "LP_REMOVE_IN"
  | "LP_REMOVE_OUT"
  | "STAKE_LOCK"
  | "STAKE_UNLOCK"
  | "STAKE_REWARD"
  | "INTERNAL_TRANSFER"
  | "APPROVAL_IGNORE";

export type NormalizedActionType =
  | "TRANSFER"
  | "SWAP"
  | "LP_ADD"
  | "LP_REMOVE"
  | "HEX_STAKE_LOCK";

export type LedgerDirection = "IN" | "OUT" | "INTERNAL";

export type CanonicalLedgerEntryDraft = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  actionType: NormalizedActionType;
  actionGroupKey: string;
  entryType: NormalizedEntryType;
  assetId: string;
  quantity: string;
  direction: LedgerDirection;
  occurredAt: Date;
  normalizerVersion: string;
  sourceLogIndex?: number;
  sourceLogKey: string;
  dedupeKey: string;
};

export function toCanonicalQuantity(args: {
  amountRaw: string;
  decimals: number;
}) {
  if (!/^\d+$/.test(args.amountRaw)) {
    throw new Error("amountRaw must be an unsigned integer string");
  }

  if (args.decimals < 0) {
    throw new Error("decimals cannot be negative");
  }

  if (args.decimals === 0) {
    return trimLeadingZeros(args.amountRaw);
  }

  const paddedAmount = args.amountRaw.padStart(args.decimals + 1, "0");
  const integerPart = paddedAmount.slice(0, -args.decimals);
  const fractionalPart = paddedAmount.slice(-args.decimals).replace(/0+$/, "");

  if (fractionalPart.length === 0) {
    return trimLeadingZeros(integerPart);
  }

  return `${trimLeadingZeros(integerPart)}.${fractionalPart}`;
}

export function buildActionGroupKey(args: {
  chainId: number;
  walletId: string;
  txHash: string;
  actionType: NormalizedActionType;
  sourceRef: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        chainId: args.chainId,
        walletId: args.walletId,
        txHash: args.txHash.toLowerCase(),
        actionType: args.actionType,
        sourceRef: args.sourceRef,
      }),
    )
    .digest("hex");
}

function trimLeadingZeros(value: string) {
  const trimmed = value.replace(/^0+/, "");

  return trimmed.length === 0 ? "0" : trimmed;
}

export function buildSourceLogKey(args: {
  txHash: string;
  logIndex?: number;
  suffix?: string;
}) {
  const fragments = ["log", args.txHash.toLowerCase()];

  if (typeof args.logIndex === "number") {
    fragments.push(String(args.logIndex));
  }

  if (args.suffix) {
    fragments.push(args.suffix);
  }

  return fragments.join(":");
}

export function createLedgerEntryDraft(args: {
  chainId: number;
  walletId: string;
  walletAddress: string;
  txHash: string;
  blockNumber: bigint;
  actionType: NormalizedActionType;
  actionGroupKey: string;
  entryType: NormalizedEntryType;
  assetId: string;
  amountRaw: string;
  decimals: number;
  direction: LedgerDirection;
  occurredAt: Date;
  normalizerVersion: string;
  sourceLogIndex?: number;
  sourceRef: string;
}) {
  const quantity = toCanonicalQuantity({
    amountRaw: args.amountRaw,
    decimals: args.decimals,
  });
  const sourceLogKey = buildSourceLogKey({
    txHash: args.txHash,
    logIndex: args.sourceLogIndex,
    suffix: args.sourceRef,
  });

  return {
    chainId: args.chainId,
    walletId: args.walletId,
    walletAddress: args.walletAddress.toLowerCase(),
    txHash: args.txHash.toLowerCase(),
    blockNumber: args.blockNumber,
    actionType: args.actionType,
    actionGroupKey: args.actionGroupKey,
    entryType: args.entryType,
    assetId: args.assetId,
    quantity,
    direction: args.direction,
    occurredAt: args.occurredAt,
    normalizerVersion: args.normalizerVersion,
    sourceLogIndex: args.sourceLogIndex,
    sourceLogKey,
    dedupeKey: buildLedgerEntryDedupeKey({
      chainId: args.chainId,
      walletId: args.walletId,
      txHash: args.txHash,
      entryType: args.entryType,
      assetId: args.assetId,
      direction: args.direction,
      normalizerVersion: args.normalizerVersion,
      sourceRef: sourceLogKey,
    }),
  } satisfies CanonicalLedgerEntryDraft;
}
