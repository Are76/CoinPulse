import { describe, expect, it } from "vitest";

import {
  buildActionGroupKey,
  toCanonicalQuantity,
} from "@/services/normalization/types";

describe("normalization types", () => {
  it("builds a deterministic action group key for repeated inputs", () => {
    const key = buildActionGroupKey({
      chainId: 369,
      walletId: "wallet_1",
      txHash: "0xABC",
      actionType: "SWAP",
      sourceRef: "swap:log:12",
    });

    expect(key).toBe(
      buildActionGroupKey({
        chainId: 369,
        walletId: "wallet_1",
        txHash: "0xabc",
        actionType: "SWAP",
        sourceRef: "swap:log:12",
      }),
    );
  });

  it("converts raw integer token amounts into decimal-adjusted quantities", () => {
    expect(
      toCanonicalQuantity({
        amountRaw: "123450000",
        decimals: 6,
      }),
    ).toBe("123.45");
  });
});
