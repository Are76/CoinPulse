import { createHash } from "node:crypto";

type LedgerDedupeInput = {
  chainId: number;
  walletId: string;
  txHash: string;
  entryType: string;
  assetId: string;
  direction: string;
  normalizerVersion: string;
  sourceRef: string;
};

export function buildLedgerEntryDedupeKey(input: LedgerDedupeInput) {
  const canonicalPayload = JSON.stringify({
    chainId: input.chainId,
    walletId: input.walletId,
    txHash: input.txHash.toLowerCase(),
    entryType: input.entryType,
    assetId: input.assetId,
    direction: input.direction,
    normalizerVersion: input.normalizerVersion,
    sourceRef: input.sourceRef,
  });

  return createHash("sha256").update(canonicalPayload).digest("hex");
}
