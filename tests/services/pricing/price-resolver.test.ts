import { describe, expect, it } from "vitest";

import { resolveBestPriceObservation } from "@/services/pricing/price-resolver";
import type { PersistedPriceObservation } from "@/services/pricing/types";

const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const PHEX_ASSET = "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const PDAI_ASSET = "chain:369:erc20:0xefD766cCb38EaF1dfd701853BFCe31359239F305";

function createObservation(
  overrides: Partial<PersistedPriceObservation> = {},
): PersistedPriceObservation {
  return {
    id: "obs-1",
    chainId: CHAIN_ID,
    assetId: PHEX_ASSET,
    assetAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    quoteAsset: QUOTE_ASSET,
    price: "0.021",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pair:0xpair",
    routeMetadata: {
      hops: [PHEX_ASSET, "chain:369:native:PLS", QUOTE_ASSET],
    },
    liquidityUsd: "225000",
    confidence: "0.91",
    observedAt: new Date("2026-05-08T12:00:00.000Z"),
    blockNumber: 12500n,
    staleAfterSeconds: 120,
    createdAt: new Date("2026-05-08T12:00:01.000Z"),
    updatedAt: new Date("2026-05-08T12:00:01.000Z"),
    ...overrides,
  };
}

describe("resolveBestPriceObservation", () => {
  it("selects the best usable observation by confidence, freshness, and source priority", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "dexscreener",
          sourceType: "DEXSCREENER",
          sourceId: "dexscreener:pair:1",
          confidence: "0.99",
          observedAt: new Date("2026-05-08T12:00:59.000Z"),
        }),
        createObservation({
          id: "oracle",
          sourceType: "ORACLE",
          sourceId: "oracle:usd:1",
          confidence: "0.85",
          observedAt: new Date("2026-05-08T12:00:58.000Z"),
        }),
        createObservation({
          id: "onchain",
          sourceType: "ONCHAIN_POOL",
          sourceId: "pulsex:pair:trusted",
          confidence: "0.92",
          observedAt: new Date("2026-05-08T12:00:57.000Z"),
        }),
      ],
    });

    expect(result.selected?.id).toBe("onchain");
    expect(result.rejected.map((item) => item.id)).toContain("dexscreener");
  });

  it("rejects stale prices", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:10:00.000Z"),
      observations: [createObservation()],
    });

    expect(result.selected).toBeNull();
    expect(result.rejected).toEqual([
      expect.objectContaining({
        id: "obs-1",
        reason: "STALE",
      }),
    ]);
  });

  it("rejects low-confidence prices", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [createObservation({ confidence: "0.39" })],
    });

    expect(result.selected).toBeNull();
    expect(result.rejected).toEqual([
      expect.objectContaining({
        id: "obs-1",
        reason: "LOW_CONFIDENCE",
      }),
    ]);
  });

  it("resolves observations by chain and asset identifier instead of same-symbol assumptions", () => {
    const sameSymbolOtherContract = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "same-symbol-other-contract",
          assetId: sameSymbolOtherContract,
          assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          price: "99",
          confidence: "0.99",
        }),
        createObservation({
          id: "same-contract-other-chain",
          chainId: 943,
          assetId: "chain:943:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          price: "77",
          confidence: "0.99",
        }),
        createObservation({
          id: "target-asset",
          assetId: PHEX_ASSET,
          price: "0.021",
          confidence: "0.91",
        }),
      ],
    });

    expect(result.selected?.id).toBe("target-asset");
    expect(result.selected?.assetId).toBe(PHEX_ASSET);
    expect(result.selected?.chainId).toBe(CHAIN_ID);
    expect(result.selected?.price).toBe("0.021");
    expect(result.rejected).toEqual([]);
  });

  it("keeps pricing provenance on the requested contract when route metadata has matching display strings", () => {
    const sameNameAlpha = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sameNameBeta = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: sameNameAlpha,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "beta-shared-display",
          assetId: sameNameBeta,
          assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          price: "99",
          confidence: "0.99",
          sourceId: "pulsex:pair:beta",
          routeMetadata: { symbol: "SAME", name: "Shared Metadata Name" },
        }),
        createObservation({
          id: "alpha-shared-display",
          assetId: sameNameAlpha,
          assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          price: "5",
          confidence: "0.91",
          sourceId: "pulsex:pair:alpha",
          routeMetadata: { symbol: "SAME", name: "Shared Metadata Name" },
        }),
      ],
    });

    expect(result.selected).toMatchObject({
      id: "alpha-shared-display",
      assetId: sameNameAlpha,
      assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      price: "5",
      sourceId: "pulsex:pair:alpha",
      routeMetadata: { symbol: "SAME", name: "Shared Metadata Name" },
    });
    expect(result.rejected).toEqual([]);
  });

  it("treats pDAI as volatile rather than pegging it to one dollar", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PDAI_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "pdai",
          assetId: PDAI_ASSET,
          assetAddress: "0xefd766ccb38eaf1dfd701853bfce31359239f305",
          price: "0.73",
        }),
      ],
    });

    expect(result.selected?.price).toBe("0.73");
  });

  it("does not allow DexScreener to become the primary resolved price", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "dexscreener-only",
          sourceType: "DEXSCREENER",
          sourceId: "dexscreener:pair:only",
          confidence: "0.99",
        }),
      ],
    });

    expect(result.selected).toBeNull();
    expect(result.rejected).toEqual([
      expect.objectContaining({
        id: "dexscreener-only",
        reason: "SOURCE_DISABLED",
      }),
    ]);
  });

  it("uses Decimal comparison for liquidityUsd tiebreaker — preserves precision beyond float53 range", () => {
    // These two values differ only in their last digit but both exceed Number.MAX_SAFE_INTEGER,
    // so Number() coercion would make them indistinguishable and produce a non-deterministic sort.
    const higherLiquidity = "100000000000000001"; // 10^17 + 1
    const lowerLiquidity  = "100000000000000000"; // 10^17
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PHEX_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({ id: "low-liq",  liquidityUsd: lowerLiquidity,  confidence: "0.9" }),
        createObservation({ id: "high-liq", liquidityUsd: higherLiquidity, confidence: "0.9" }),
      ],
    });

    expect(result.selected?.id).toBe("high-liq");
  });
});
