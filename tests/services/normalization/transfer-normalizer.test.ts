import { describe, expect, it } from "vitest";

import { normalizeTransfer } from "@/services/normalization/transfer-normalizer";

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
});
