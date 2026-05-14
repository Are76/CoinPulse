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
const PLS_ASSET = "chain:369:native:pls";
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
