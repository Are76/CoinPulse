import { describe, expect, it } from "vitest";

import {
  normalizeLpAdd,
  normalizeLpRemove,
} from "@/services/normalization/lp-normalizer";

describe("lp normalizers", () => {
  it("builds deterministic atomic lp add entries", () => {
    const entries = normalizeLpAdd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xlpadd",
      blockNumber: 100n,
      sourceRef: "lp:add:6",
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      token0AssetId: "chain:369:erc20:0xtoken0",
      token0AmountRaw: "1000000000000000000",
      token0Decimals: 18,
      token1AssetId: "chain:369:erc20:0xtoken1",
      token1AmountRaw: "5000000",
      token1Decimals: 6,
      lpAssetId: "chain:369:erc20:0xlp",
      lpAmountRaw: "100000000000000000",
      lpDecimals: 18,
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "LP_ADD_OUT",
      "LP_ADD_OUT",
      "LP_ADD_IN",
    ]);
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
  });

  it("builds deterministic atomic lp remove entries", () => {
    const entries = normalizeLpRemove({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xlpremove",
      blockNumber: 101n,
      sourceRef: "lp:remove:9",
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      token0AssetId: "chain:369:erc20:0xtoken0",
      token0AmountRaw: "1000000000000000000",
      token0Decimals: 18,
      token1AssetId: "chain:369:erc20:0xtoken1",
      token1AmountRaw: "5000000",
      token1Decimals: 6,
      lpAssetId: "chain:369:erc20:0xlp",
      lpAmountRaw: "100000000000000000",
      lpDecimals: 18,
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "LP_REMOVE_OUT",
      "LP_REMOVE_IN",
      "LP_REMOVE_IN",
    ]);
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
  });
});
