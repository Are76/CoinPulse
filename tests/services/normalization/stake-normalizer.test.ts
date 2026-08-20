import { describe, expect, it } from "vitest";

import {
  normalizeStakeEnd,
  normalizeStakeStart,
} from "@/services/normalization/stake-normalizer";

describe("stake normalizers", () => {
  it("builds deterministic atomic stake start entries", () => {
    const entries = normalizeStakeStart({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakestart",
      blockNumber: 140n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalLockedRaw: "100000000",
      feeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeAmountRaw: "200000000000000",
      feeDecimals: 18,
      sourceRef: "stake:start:42",
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "STAKE_START",
      "STAKE_PRINCIPAL_LOCKED",
      "FEE",
    ]);
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
  });

  it("builds deterministic atomic stake end entries", () => {
    const entries = normalizeStakeEnd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakeend",
      blockNumber: 141n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalReturnedRaw: "100000000",
      yieldRaw: "5000000",
      penaltyRaw: "1000000",
      feeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeAmountRaw: "200000000000000",
      feeDecimals: 18,
      sourceRef: "stake:end:42",
    });

    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      "STAKE_END",
      "STAKE_PRINCIPAL_RETURNED",
      "STAKE_YIELD_RECEIVED",
      "STAKE_PENALTY",
      "FEE",
    ]);
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
  });

  it("preserves the exact returned quantity via STAKE_RETURN_UNALLOCATED when the principal/yield/penalty split is unknown", () => {
    const entries = normalizeStakeEnd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakeend-unresolved",
      blockNumber: 141n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      totalReturnedRaw: "2233755002516",
      feeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeAmountRaw: "200000000000000",
      feeDecimals: 18,
      sourceRef: "stake:end:800372",
    });

    expect(entries.map((entry) => entry.entryType)).toEqual([
      "STAKE_END",
      "STAKE_RETURN_UNALLOCATED",
      "FEE",
    ]);
    expect(entries.some((entry) => entry.entryType === "STAKE_PRINCIPAL_RETURNED")).toBe(false);
    expect(entries.some((entry) => entry.entryType === "STAKE_YIELD_RECEIVED")).toBe(false);
    expect(entries.some((entry) => entry.entryType === "STAKE_PENALTY")).toBe(false);

    const unallocated = entries.find((entry) => entry.entryType === "STAKE_RETURN_UNALLOCATED");
    expect(unallocated?.direction).toBe("IN");
    expect(unallocated?.quantityRaw).toBe("2233755002516");
    expect(unallocated?.actionType).toBe("HEX_STAKE_END");
    expect(new Set(entries.map((entry) => entry.actionGroupKey)).size).toBe(1);
  });

  it("does not emit STAKE_RETURN_UNALLOCATED when the principal/yield/penalty split is known, even if totalReturnedRaw is also present", () => {
    const entries = normalizeStakeEnd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakeend-known",
      blockNumber: 141n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalReturnedRaw: "100000000",
      yieldRaw: "5000000",
      penaltyRaw: null,
      totalReturnedRaw: "105000000",
      feeAssetId: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeAmountRaw: "200000000000000",
      feeDecimals: 18,
      sourceRef: "stake:end:42",
    });

    expect(entries.map((entry) => entry.entryType)).toEqual([
      "STAKE_END",
      "STAKE_PRINCIPAL_RETURNED",
      "STAKE_YIELD_RECEIVED",
      "FEE",
    ]);
    expect(entries.some((entry) => entry.entryType === "STAKE_RETURN_UNALLOCATED")).toBe(false);
  });

  it("does not fabricate a movement when both the split and the total return are unknown or zero", () => {
    const entriesAllNull = normalizeStakeEnd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakeend-empty",
      blockNumber: 141n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      totalReturnedRaw: null,
      sourceRef: "stake:end:0",
    });

    expect(entriesAllNull.map((entry) => entry.entryType)).toEqual(["STAKE_END"]);

    const entriesZeroTotal = normalizeStakeEnd({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xstakeend-zero",
      blockNumber: 141n,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      totalReturnedRaw: "0",
      sourceRef: "stake:end:0",
    });

    expect(entriesZeroTotal.map((entry) => entry.entryType)).toEqual(["STAKE_END"]);
  });
});
