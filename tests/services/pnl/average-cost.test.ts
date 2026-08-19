import { describe, expect, it } from "vitest";

import { resolveBestPriceObservation } from "@/services/pricing/price-resolver";
import type { PersistedPriceObservation } from "@/services/pricing/types";
import { calculateAverageCostPnl } from "@/services/pnl/average-cost";
import type { PnLPriceResolver } from "@/services/pnl/types";

const CHAIN_ID = 369;
const WALLET_ID = "wallet-1";
const QUOTE_ASSET = "fiat:usd";
const TARGET_ASSET = "chain:369:erc20:0xtoken";
const TARGET_ADDRESS = "0xtoken";
const PLS_ASSET = "chain:369:native:0x0000000000000000000000000000000000000000";
const PLS_ADDRESS = null;
const LP_ASSET = "chain:369:erc20:0xlp";

function createEntry(overrides: Partial<Parameters<typeof calculateAverageCostPnl>[0]["entries"][number]> = {}) {
  return {
    id: overrides.id ?? `entry-${Math.random().toString(16).slice(2)}`,
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    assetId: TARGET_ASSET,
    entryType: "SWAP_IN" as const,
    actionType: "SWAP" as const,
    direction: "IN" as const,
    quantity: "10",
    occurredAt: new Date("2026-05-08T12:00:00.000Z"),
    actionGroupId: "group-1",
    txHash: "0xtx-1",
    sourceLogKey: "log:0xtx-1:0",
    ...overrides,
  };
}

function createObservation(
  overrides: Partial<PersistedPriceObservation> = {},
): PersistedPriceObservation {
  return {
    id: overrides.id ?? `obs-${Math.random().toString(16).slice(2)}`,
    chainId: CHAIN_ID,
    assetId: PLS_ASSET,
    assetAddress: PLS_ADDRESS,
    quoteAsset: QUOTE_ASSET,
    price: "1",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpair",
    routeMetadata: null,
    liquidityUsd: "1000000",
    confidence: "0.95",
    observedAt: new Date("2026-05-08T12:00:00.000Z"),
    blockNumber: 10n,
    staleAfterSeconds: 3600,
    createdAt: new Date("2026-05-08T12:00:00.000Z"),
    updatedAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

function createResolver(
  observations: readonly PersistedPriceObservation[],
): PnLPriceResolver {
  return async ({ chainId, assetId, quoteAsset, at, minimumConfidence }) =>
    resolveBestPriceObservation({
      chainId,
      assetId,
      quoteAsset,
      observations,
      observedAt: at,
      minimumConfidence,
    });
}

describe("calculateAverageCostPnl", () => {
  it("calculates simple buy/sell realized PnL", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "sell-target",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:0",
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "sell-pls",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "pls-sell",
          observedAt: new Date("2026-05-08T13:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "target-mark",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T14:00:00.000Z"),
          price: "15",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("6");
    expect(result.averageCost).toBe("10");
    expect(result.realizedPnl).toBe("20");
    expect(result.unrealizedPnl).toBe("30");
  });


  it("keeps cost basis asset-specific for same-symbol token variants", async () => {
    const otherSameSymbolAsset = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-target-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "buy-other-same-symbol",
          actionGroupId: "group-other",
          txHash: "0xtx-other",
          sourceLogKey: "log:0xtx-other:0",
          assetId: otherSameSymbolAsset,
          quantity: "50",
          occurredAt: new Date("2026-05-08T12:30:00.000Z"),
        }),
        createEntry({
          id: "buy-other-pls",
          actionGroupId: "group-other",
          txHash: "0xtx-other",
          sourceLogKey: "log:0xtx-other:1",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "1",
          occurredAt: new Date("2026-05-08T12:30:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy-target",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "target-mark",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T14:00:00.000Z"),
          price: "15",
        }),
      ]),
    });

    expect(result.assetId).toBe(TARGET_ASSET);
    expect(result.holdingsQuantity).toBe("10");
    expect(result.averageCost).toBe("10");
    expect(result.realizedPnl).toBe("0");
    expect(result.unrealizedPnl).toBe("50");
  });

  it("keeps realized PnL at zero until a disposal event exists", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "target-mark",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T14:00:00.000Z"),
          price: "15",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("10");
    expect(result.totalDisposedQuantity).toBe("0");
    expect(result.realizedPnl).toBe("0");
    expect(result.markPrice).toBe("15");
    expect(result.unrealizedPnl).toBe("50");
  });

  it("keeps missing marks as null and exposes no percentage field for zero-cost positions", async () => {
    const missingMarkResult = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({
          id: "airdrop-target",
          actionType: "TRANSFER",
          entryType: "RECEIVE",
          quantity: "10",
        }),
      ],
      resolvePrice: createResolver([]),
    });

    expect(missingMarkResult.averageCost).toBe("0");
    expect(missingMarkResult.markPrice).toBeNull();
    expect(missingMarkResult.unrealizedPnl).toBeNull();
    expect(missingMarkResult.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MARK_PRICE_UNAVAILABLE" })]),
    );
    expect(missingMarkResult).not.toHaveProperty("pnlPercent");
    expect(missingMarkResult).not.toHaveProperty("roi");

    const zeroCostMarkedResult = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({
          id: "airdrop-target",
          actionType: "TRANSFER",
          entryType: "RECEIVE",
          quantity: "10",
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "target-mark",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T14:00:00.000Z"),
          price: "2",
        }),
      ]),
    });

    expect(zeroCostMarkedResult.averageCost).toBe("0");
    expect(zeroCostMarkedResult.markPrice).toBe("2");
    expect(zeroCostMarkedResult.unrealizedPnl).toBe("20");
    expect(zeroCostMarkedResult).not.toHaveProperty("pnlPercent");
    expect(zeroCostMarkedResult).not.toHaveProperty("roi");
  });

  it("calculates average cost across multiple buys", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-1-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "buy-2-target",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:0",
          quantity: "10",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "buy-2-pls",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "140",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({ id: "pls-buy-1", observedAt: new Date("2026-05-08T12:00:00.000Z"), price: "1" }),
        createObservation({ id: "pls-buy-2", observedAt: new Date("2026-05-08T13:00:00.000Z"), price: "1" }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("20");
    expect(result.averageCost).toBe("12");
    expect(result.realizedPnl).toBe("0");
  });

  it("calculates partial sell realized PnL while preserving average cost", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-1-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "buy-2-target",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:0",
          quantity: "10",
          occurredAt: new Date("2026-05-08T12:30:00.000Z"),
        }),
        createEntry({
          id: "buy-2-pls",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "140",
          occurredAt: new Date("2026-05-08T12:30:00.000Z"),
        }),
        createEntry({
          id: "sell-target",
          actionGroupId: "group-3",
          txHash: "0xtx-3",
          sourceLogKey: "log:0xtx-3:0",
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "5",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "sell-pls",
          actionGroupId: "group-3",
          txHash: "0xtx-3",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "75",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({ id: "pls-buy-1", observedAt: new Date("2026-05-08T12:00:00.000Z"), price: "1" }),
        createObservation({ id: "pls-buy-2", observedAt: new Date("2026-05-08T12:30:00.000Z"), price: "1" }),
        createObservation({ id: "pls-sell", observedAt: new Date("2026-05-08T13:00:00.000Z"), price: "1" }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("15");
    expect(result.averageCost).toBe("12");
    expect(result.realizedPnl).toBe("15");
  });

  it("uses a resolved mark price for unrealized PnL and rejects stale or low-confidence marks", async () => {
    const staleResult = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
        }),
        createObservation({
          id: "target-stale",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          staleAfterSeconds: 60,
          price: "15",
        }),
      ]),
    });

    expect(staleResult.markPrice).toBeNull();
    expect(staleResult.unrealizedPnl).toBeNull();
    expect(staleResult.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MARK_PRICE_UNAVAILABLE" }),
      ]),
    );

    const lowConfidenceResult = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
        }),
        createObservation({
          id: "target-low-confidence",
          assetId: TARGET_ASSET,
          assetAddress: TARGET_ADDRESS,
          observedAt: new Date("2026-05-08T13:59:00.000Z"),
          confidence: "0.2",
          price: "15",
        }),
      ]),
    });

    expect(lowConfidenceResult.markPrice).toBeNull();
    expect(lowConfidenceResult.unrealizedPnl).toBeNull();
  });

  it("includes explicit non-target fees in acquisition cost", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "buy-fee",
          assetId: PLS_ASSET,
          entryType: "FEE",
          direction: "OUT",
          quantity: "5",
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.averageCost).toBe("10.5");
  });

  it("does not realize pnl for internal transfers", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "internal",
          actionType: "TRANSFER",
          entryType: "INTERNAL_TRANSFER",
          direction: "INTERNAL",
          quantity: "3",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.realizedPnl).toBe("0");
    expect(result.holdingsQuantity).toBe("10");
  });

  it("fails closed instead of zero-proceeds when a SEND-only group has a same-tx sibling RECEIVE of another asset (protocol-detection-gap calibration, tx 0x25e9f8027e6d3efbaa17a50d3f6e08b1f6618a7b51572167d5f88abc20b61488)", async () => {
    // Synthetic fixture modeled on the audited structure: gas/FEE group, SEND
    // group, RECEIVE group — all sharing one txHash but split across three
    // actionGroupIds because the swap protocol was not recognized.
    const TX_HASH = "0x25e9f8027e6d3efbaa17a50d3f6e08b1f6618a7b51572167d5f88abc20b61488";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "gas-fee",
          actionGroupId: "group-fee",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:0`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "FEE",
          direction: "OUT",
          quantity: "1",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "send-target",
          actionGroupId: "group-send",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:1`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "receive-other",
          actionGroupId: "group-receive",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:2`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    // Must not fabricate zero proceeds for the SEND-only group.
    expect(result.holdingsQuantity).toBe("10");
    expect(result.totalDisposedQuantity).toBe("0");
    expect(result.realizedPnl).toBe("0");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNRESOLVED_ECONOMIC_COUPLING",
          actionGroupId: "group-send",
          txHash: TX_HASH,
        }),
      ]),
    );
  });

  it("fails closed instead of zero-proceeds for a DEX-coverage-gap calibration transaction with the same 3-group shape (tx 0xa24e369be05870cbf2fdf8a43b28e38b58396eb510acfaf29a7fc3310c044504)", async () => {
    const TX_HASH = "0xa24e369be05870cbf2fdf8a43b28e38b58396eb510acfaf29a7fc3310c044504";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "gas-fee",
          actionGroupId: "group-fee",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:0`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "FEE",
          direction: "OUT",
          quantity: "1",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "send-target",
          actionGroupId: "group-send",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:1`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "receive-other",
          actionGroupId: "group-receive",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:2`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("10");
    expect(result.totalDisposedQuantity).toBe("0");
    expect(result.realizedPnl).toBe("0");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNRESOLVED_ECONOMIC_COUPLING",
          actionGroupId: "group-send",
          txHash: TX_HASH,
        }),
      ]),
    );
  });

  it("fails closed instead of zero-cost when a RECEIVE-only group has a same-tx sibling SEND of another asset", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({
          id: "receive-target",
          actionGroupId: "group-receive",
          txHash: "0xtx-split",
          sourceLogKey: "log:0xtx-split:0",
          actionType: "TRANSFER",
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "10",
        }),
        createEntry({
          id: "send-other",
          actionGroupId: "group-send",
          txHash: "0xtx-split",
          sourceLogKey: "log:0xtx-split:1",
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "SEND",
          direction: "OUT",
          quantity: "100",
        }),
      ],
      resolvePrice: createResolver([]),
    });

    expect(result.holdingsQuantity).toBe("0");
    expect(result.totalAcquiredQuantity).toBe("0");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNRESOLVED_ECONOMIC_COUPLING",
          actionGroupId: "group-receive",
          txHash: "0xtx-split",
        }),
      ]),
    );
  });

  it("(synthetic false-positive guard) fails closed rather than inventing a SWAP classification for unrelated same-tx economic actions", async () => {
    // Synthetic — not derived from any observed transaction. Models a
    // hypothetical case where a payment OUT of asset A and an unrelated
    // IN of asset B happen to land in the same transaction. The guard has
    // no way to prove these are unrelated, so it must fail closed rather
    // than silently accepting zero proceeds or inventing a swap.
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "payment-out-target",
          actionGroupId: "group-payment",
          txHash: "0xtx-unrelated",
          sourceLogKey: "log:0xtx-unrelated:0",
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "2",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "unrelated-receive-other-asset",
          actionGroupId: "group-unrelated",
          txHash: "0xtx-unrelated",
          sourceLogKey: "log:0xtx-unrelated:1",
          actionType: "TRANSFER",
          assetId: LP_ASSET,
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "1",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("10");
    expect(result.totalDisposedQuantity).toBe("0");
    expect(result.realizedPnl).toBe("0");
    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(true);
    // Never fabricates a SWAP classification — actionType is caller-provided
    // input, not something the guard infers or writes back.
  });

  it("does not trigger the coupling guard from a FEE-only sibling group (fee cannot satisfy the opposite-direction requirement)", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({
          id: "receive-target",
          actionGroupId: "group-receive",
          txHash: "0xtx-fee-only",
          sourceLogKey: "log:0xtx-fee-only:0",
          actionType: "TRANSFER",
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "10",
        }),
        createEntry({
          id: "gas-fee-sibling",
          actionGroupId: "group-fee",
          txHash: "0xtx-fee-only",
          sourceLogKey: "log:0xtx-fee-only:1",
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "FEE",
          direction: "OUT",
          quantity: "1",
        }),
      ],
      resolvePrice: createResolver([]),
    });

    // Ordinary zero-cost acquisition (e.g. airdrop) — no coupling evidence,
    // guard must stay silent and preserve normal gas/fee handling.
    expect(result.holdingsQuantity).toBe("10");
    expect(result.averageCost).toBe("0");
    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(false);
  });

  it("does not trigger the coupling guard for a correctly normalized SWAP action group (both legs already co-grouped)", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "sell-target",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:0",
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "sell-pls",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "pls-sell",
          observedAt: new Date("2026-05-08T13:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("6");
    expect(result.realizedPnl).toBe("20");
    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(false);
  });

  it("[B] does not mark a recognized SWAP's own TRANSFER shadow SEND/RECEIVE groups as unresolved coupling", async () => {
    // Models the real production shape Codex flagged: TRANSFERS-family
    // normalization unconditionally emits a generic TRANSFER SEND/RECEIVE
    // "shadow" group for every raw transfer in a transaction
    // (buildTransferNormalizationSnapshots does not exclude token transfers
    // that DEX-family normalization already turned into a canonical SWAP
    // group). So a single correctly recognized swap can be represented by
    // THREE actionGroupIds sharing one txHash: the canonical SWAP group,
    // a TRANSFER shadow SEND (mirroring the SWAP_OUT leg), and a TRANSFER
    // shadow RECEIVE (mirroring the SWAP_IN leg). None of the shadow groups
    // may be marked UNRESOLVED_ECONOMIC_COUPLING just because they see each
    // other as an opposite-direction, different-asset, non-fee sibling.
    const TX_HASH = "0xtx-swap-with-transfer-shadows";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        // Canonical SWAP group — the real, authoritative economic record.
        createEntry({
          id: "swap-out-target",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:swap:out`,
          actionType: "SWAP",
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "swap-in-pls",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:swap:in`,
          actionType: "SWAP",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        // TRANSFER shadow SEND — duplicate raw-transfer evidence of the same
        // SWAP_OUT leg, produced independently by the TRANSFERS family.
        createEntry({
          id: "shadow-send-target",
          actionGroupId: "group-shadow-send",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:transfer:0`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        // TRANSFER shadow RECEIVE — duplicate raw-transfer evidence of the
        // same SWAP_IN leg.
        createEntry({
          id: "shadow-receive-pls",
          actionGroupId: "group-shadow-receive",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:transfer:1`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "pls-swap",
          observedAt: new Date("2026-05-08T13:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(false);
    // The canonical SWAP group resolves the disposal normally.
    expect(result.totalDisposedQuantity).toBe("4");
    expect(result.realizedPnl).toBe("20");
  });

  it("[B2] does not silently drop an independent TRANSFER that only coincidentally shares asset+direction with a complete higher-order sibling at a different quantity", async () => {
    // CodeRabbit follow-up: (assetId, direction) alone is not a safe shadow
    // key, because normalizeTransfer's sourceLogKey embeds the raw ERC-20
    // Transfer log index while normalizeSwap's embeds the raw DEX Swap
    // event's own log index (`swap:<protocol>:<logIndex>` in dex-sync.ts) —
    // there is no shared raw-event identifier between the two families to
    // prove "same underlying movement" without a normalizer change. The
    // shadow check additionally requires an EXACT quantity match. Here the
    // TRANSFER SEND is for a different quantity (7) than the SWAP's own
    // SEND-direction leg (4), so it must NOT be treated as a shadow — it
    // must fall through to ordinary processing (and, since no other
    // evidence resolves its proceeds, to the unresolved-coupling guard,
    // which still finds no *opposite-direction* candidate here and lets it
    // finalize with zero proceeds — it is never silently discarded without
    // being counted).
    const TX_HASH = "0xtx-coincidental-asset-direction-collision";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({ quantity: "20" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        // Canonical SWAP group: SEND-direction leg of quantity 4.
        createEntry({
          id: "swap-out-target",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:swap:out`,
          actionType: "SWAP",
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "swap-in-pls",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:swap:in`,
          actionType: "SWAP",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        // Independent TRANSFER SEND of the SAME asset and direction, but a
        // DIFFERENT quantity (7, not 4) — a genuinely separate disposal that
        // happens to share (assetId, direction) with the SWAP's own leg.
        createEntry({
          id: "independent-send-target",
          actionGroupId: "group-independent-transfer",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:transfer:9`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "7",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
        createObservation({
          id: "pls-swap",
          observedAt: new Date("2026-05-08T13:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    // Not silently dropped: it is counted as a disposal (quantity 7), on top
    // of the canonical SWAP's own disposal (quantity 4) — total 11.
    expect(result.totalDisposedQuantity).toBe("11");
    expect(result.holdingsQuantity).toBe("9");
  });

  it("[C] does not trigger the guard for a plain TRANSFER group sharing a tx with a separate, unrelated, complete higher-order SWAP", async () => {
    // A TRANSFER SEND-only group has no counter-value evidence at all inside
    // its own actionGroupId. The only same-tx sibling entries come from a
    // separate, correctly co-grouped SWAP (both legs present, unrelated
    // asset pair). Because that SWAP group is complete, the transaction's
    // coupled economic action is already established — the coupling guard
    // must stay silent rather than firing off the SWAP's inbound leg, and
    // the TRANSFER disposal must complete normally (not be skipped as
    // unresolved).
    const TX_HASH = "0xtx-transfer-plus-unrelated-swap";

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        // Prior holdings so the disposal below clears the cost-basis check
        // and actually reaches the coupling guard instead of short-circuiting
        // on INSUFFICIENT_COST_BASIS.
        createEntry({ quantity: "10" }),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "transfer-send-target",
          actionGroupId: "group-transfer",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:0`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "swap-out-other",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:1`,
          actionType: "SWAP",
          assetId: LP_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "1",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "swap-in-other",
          actionGroupId: "group-swap",
          txHash: TX_HASH,
          sourceLogKey: `log:${TX_HASH}:2`,
          actionType: "SWAP",
          assetId: PLS_ASSET,
          entryType: "SWAP_IN",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(false);
    // Not skipped: the disposal is finalized (proceeds unresolvable
    // in-group resolve to 0, since there is genuinely no coupling evidence
    // for this TRANSFER group once the unrelated SWAP is excluded).
    expect(result.totalDisposedQuantity).toBe("4");
    expect(result.holdingsQuantity).toBe("6");
    // Locks the documented "proceeds resolve to 0" behavior directly — a
    // regression that fabricated non-zero proceeds for this group would
    // still pass the two assertions above but would fail this one.
    expect(result.realizedPnl).toBe("-40");
  });

  it("[D] does not treat a zero-quantity opposite-direction sibling as coupling evidence", async () => {
    // A same-tx sibling exists in the required opposite direction and a
    // different asset, but its quantity is zero (e.g. a zero-amount spam or
    // protocol event). It must not count as economic coupling evidence.
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry({
          id: "receive-target",
          actionGroupId: "group-receive",
          txHash: "0xtx-zero-sibling",
          sourceLogKey: "log:0xtx-zero-sibling:0",
          actionType: "TRANSFER",
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "10",
        }),
        createEntry({
          id: "zero-send-other",
          actionGroupId: "group-zero",
          txHash: "0xtx-zero-sibling",
          sourceLogKey: "log:0xtx-zero-sibling:1",
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "SEND",
          direction: "OUT",
          quantity: "0",
        }),
      ],
      resolvePrice: createResolver([]),
    });

    // Ordinary zero-cost acquisition — no real coupling evidence exists.
    expect(result.holdingsQuantity).toBe("10");
    expect(result.averageCost).toBe("0");
    expect(
      result.warnings.some((warning) => warning.code === "UNRESOLVED_ECONOMIC_COUPLING"),
    ).toBe(false);
  });

  it("[H] avoids per-group full-ledger scans (index is built once and stays correct across many unrelated transactions)", async () => {
    // Not a timing/perf assertion (those are brittle) — a scale-sanity check
    // that correctness holds when relevantEntries contains many unrelated
    // transactions, each contributing its own acquisition group, plus one
    // F3-shaped unresolved transaction mixed in. hasUnresolvedSiblingCoupling
    // is index-backed (entriesByTxHash / completeHigherOrderTxHashes built
    // once in buildSiblingCouplingIndex), so this scales with the size of
    // each individual transaction, not the size of the full wallet ledger.
    const UNRESOLVED_TX_HASH = "0xtx-unresolved-among-many";
    const unrelatedEntries = Array.from({ length: 500 }, (_, index) =>
      createEntry({
        id: `bulk-buy-${index}`,
        actionGroupId: `bulk-group-${index}`,
        txHash: `0xtx-bulk-${index}`,
        sourceLogKey: `log:0xtx-bulk-${index}:0`,
        actionType: "TRANSFER",
        entryType: "RECEIVE",
        direction: "IN",
        quantity: "1",
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      }),
    );

    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        ...unrelatedEntries,
        createEntry({
          id: "unresolved-send",
          actionGroupId: "group-unresolved-send",
          txHash: UNRESOLVED_TX_HASH,
          sourceLogKey: `log:${UNRESOLVED_TX_HASH}:0`,
          actionType: "TRANSFER",
          entryType: "SEND",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "unresolved-receive-other",
          actionGroupId: "group-unresolved-receive",
          txHash: UNRESOLVED_TX_HASH,
          sourceLogKey: `log:${UNRESOLVED_TX_HASH}:1`,
          actionType: "TRANSFER",
          assetId: PLS_ASSET,
          entryType: "RECEIVE",
          direction: "IN",
          quantity: "60",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([]),
    });

    expect(result.holdingsQuantity).toBe("500");
    // States the fail-closed outcome directly rather than only implying it
    // through holdingsQuantity: the unresolved SEND group must not have
    // contributed a disposal at all.
    expect(result.totalDisposedQuantity).toBe("0");
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "UNRESOLVED_ECONOMIC_COUPLING" &&
          warning.actionGroupId === "group-unresolved-send",
      ),
    ).toBe(true);
  });

  it("warns on unsupported lp and stake actions instead of fabricating truth", async () => {
    const result = await calculateAverageCostPnl({
      walletId: WALLET_ID,
      chainId: CHAIN_ID,
      assetId: TARGET_ASSET,
      quoteAsset: QUOTE_ASSET,
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      entries: [
        createEntry(),
        createEntry({
          id: "buy-pls",
          assetId: PLS_ASSET,
          entryType: "SWAP_OUT",
          direction: "OUT",
          quantity: "100",
        }),
        createEntry({
          id: "lp-out",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:0",
          actionType: "LP_ADD",
          entryType: "LP_ADD_OUT",
          direction: "OUT",
          quantity: "4",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "lp-in",
          actionGroupId: "group-2",
          txHash: "0xtx-2",
          sourceLogKey: "log:0xtx-2:1",
          actionType: "LP_ADD",
          entryType: "LP_ADD_IN",
          assetId: LP_ASSET,
          direction: "IN",
          quantity: "1",
          occurredAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
        createEntry({
          id: "stake-lock",
          actionGroupId: "group-3",
          txHash: "0xtx-3",
          sourceLogKey: "log:0xtx-3:0:stake:1",
          actionType: "HEX_STAKE_START",
          entryType: "STAKE_PRINCIPAL_LOCKED",
          direction: "OUT",
          quantity: "2",
          occurredAt: new Date("2026-05-08T13:30:00.000Z"),
        }),
      ],
      resolvePrice: createResolver([
        createObservation({
          id: "pls-buy",
          observedAt: new Date("2026-05-08T12:00:00.000Z"),
          price: "1",
        }),
      ]),
    });

    expect(result.holdingsQuantity).toBe("10");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_LP_ACTION" }),
        expect.objectContaining({ code: "UNSUPPORTED_STAKE_ACTION" }),
      ]),
    );
  });
});
