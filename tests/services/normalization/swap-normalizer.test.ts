import { describe, expect, it } from "vitest";

import { normalizeSwap } from "@/services/normalization/swap-normalizer";

describe("normalizeSwap", () => {
  it("builds atomic swap entries that share a deterministic action group key", () => {
    const entries = normalizeSwap({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xswap",
      blockNumber: 500n,
      sourceRef: "swap:log:12",
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      soldAssetId: "chain:369:erc20:0xsold",
      soldAmountRaw: "150000000",
      soldDecimals: 8,
      boughtAssetId: "chain:369:erc20:0xbought",
      boughtAmountRaw: "3000000",
      boughtDecimals: 6,
      feeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeAmountRaw: "10000000000000000",
      feeDecimals: 18,
    });

    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "SWAP_OUT",
      "SWAP_IN",
      "FEE",
    ]);
    expect(entries.map((entry) => entry.quantity)).toEqual(["1.5", "3", "0.01"]);
  });
});
