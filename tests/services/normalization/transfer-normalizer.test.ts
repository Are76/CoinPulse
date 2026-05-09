import { describe, expect, it } from "vitest";

import {
  normalizeNativeTransaction,
  normalizeTransfer,
} from "@/services/normalization/transfer-normalizer";

describe("normalizeTransfer", () => {
  it("normalizes a tracked inbound transfer into canonical accounting units", () => {
    expect(
      normalizeTransfer({
        chainId: 369,
        walletId: "wallet_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: "0xtx",
        blockNumber: 123n,
        logIndex: 7,
        tokenAddress: "0x2222222222222222222222222222222222222222",
        assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
        fromAddress: "0x3333333333333333333333333333333333333333",
        toAddress: "0x1111111111111111111111111111111111111111",
        amountRaw: "2500000",
        decimals: 6,
        occurredAt: new Date("2026-05-08T10:00:00.000Z"),
        normalizerVersion: "v1",
      }),
    ).toMatchObject([
      {
        entryType: "RECEIVE",
        quantity: "2.5",
        direction: "IN",
      },
    ]);
  });

  it("normalizes transfers between tracked wallets as a single internal transfer", () => {
    const entries = normalizeTransfer({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      trackedWalletAddresses: [
        "0x1111111111111111111111111111111111111111",
        "0x4444444444444444444444444444444444444444",
      ],
      txHash: "0xtx",
      blockNumber: 123n,
      logIndex: 9,
      tokenAddress: "0x2222222222222222222222222222222222222222",
      assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
      fromAddress: "0x4444444444444444444444444444444444444444",
      toAddress: "0x1111111111111111111111111111111111111111",
      amountRaw: "10",
      decimals: 0,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "INTERNAL_TRANSFER",
      direction: "INTERNAL",
    });
  });

  it("classifies a secondary tracked wallet outbound transfer as send instead of dropping it", () => {
    const entries = normalizeTransfer({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      trackedWalletAddresses: [
        "0x1111111111111111111111111111111111111111",
        "0x4444444444444444444444444444444444444444",
      ],
      txHash: "0xtx2",
      blockNumber: 124n,
      logIndex: 10,
      tokenAddress: "0x2222222222222222222222222222222222222222",
      assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
      fromAddress: "0x4444444444444444444444444444444444444444",
      toAddress: "0x5555555555555555555555555555555555555555",
      amountRaw: "42",
      decimals: 0,
      occurredAt: new Date("2026-05-08T10:00:00.000Z"),
      normalizerVersion: "v1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "SEND",
      direction: "OUT",
      quantity: "42",
    });
  });

  it("normalizes a native send and explicit gas fee for the tracked sender", () => {
    const entries = normalizeNativeTransaction({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xnative-send",
      blockNumber: 200n,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      valueRaw: "1000000000000000000",
      gasPriceRaw: "2000000000",
      gasUsedRaw: "21000",
      nativeAssetId: "chain:369:native:PLS",
      nativeDecimals: 18,
      occurredAt: new Date("2026-05-09T10:00:00.000Z"),
      normalizerVersion: "v1",
    });

    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryType: "SEND",
          quantity: "1",
          direction: "OUT",
        }),
        expect.objectContaining({
          entryType: "FEE",
          quantity: "0.000042",
          direction: "OUT",
        }),
      ]),
    );
  });

  it("normalizes a native receive without charging the tracked recipient a fee", () => {
    const entries = normalizeNativeTransaction({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xnative-receive",
      blockNumber: 201n,
      fromAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      toAddress: "0x1111111111111111111111111111111111111111",
      valueRaw: "250000000000000000",
      gasPriceRaw: "2000000000",
      gasUsedRaw: "21000",
      nativeAssetId: "chain:369:native:PLS",
      nativeDecimals: 18,
      occurredAt: new Date("2026-05-09T10:01:00.000Z"),
      normalizerVersion: "v1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "RECEIVE",
      quantity: "0.25",
      direction: "IN",
    });
  });

  it("skips zero-value native transfer entries but still records sender gas fees", () => {
    const entries = normalizeNativeTransaction({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xerc20-call",
      blockNumber: 202n,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      valueRaw: "0",
      gasPriceRaw: "3000000000",
      gasUsedRaw: "50000",
      nativeAssetId: "chain:369:native:PLS",
      nativeDecimals: 18,
      occurredAt: new Date("2026-05-09T10:02:00.000Z"),
      normalizerVersion: "v1",
      hasTrackedTokenTransfersInTransaction: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "FEE",
      quantity: "0.00015",
      direction: "OUT",
    });
  });

  it("does not create a native transfer entry when tracked ERC20 transfers already exist in the same tx", () => {
    const entries = normalizeNativeTransaction({
      chainId: 369,
      walletId: "wallet_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xmixed",
      blockNumber: 203n,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
      valueRaw: "500000000000000000",
      gasPriceRaw: "1000000000",
      gasUsedRaw: "21000",
      nativeAssetId: "chain:369:native:PLS",
      nativeDecimals: 18,
      occurredAt: new Date("2026-05-09T10:03:00.000Z"),
      normalizerVersion: "v1",
      hasTrackedTokenTransfersInTransaction: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "FEE",
      quantity: "0.000021",
    });
  });
});
