import { describe, expect, it } from "vitest";

import { CORE_ASSETS } from "@/config/assets";
import { resolveBestPriceObservation } from "@/services/pricing/price-resolver";
import type { PersistedPriceObservation } from "@/services/pricing/types";

const CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const PHEX_ASSET = "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const PDAI_ASSET = CORE_ASSETS.pdai.assetId;
// Same address text as PDAI_ASSET, but on a different chain — used to prove
// eligibility matching is chain-aware and not address/symbol-only.
const OTHER_CHAIN_PDAI_LOOKALIKE = "chain:1:erc20:0xefD766cCb38EaF1dfd701853BFCe31359239F305";
// Arbitrary chain-aware non-fiat, non-pDAI quote assets a caller might request.
const WPLS_QUOTE_ASSET = "chain:369:erc20:0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const HEX_QUOTE_ASSET = PHEX_ASSET;

// The real fetcher's sourceId shape for a PulseX-routed observation
// (src/services/pricing/fetchers/onchain-pulsex-fetcher.ts `buildDraft`).
// Stable across the pdaiParAssumption marker added in PR #274 — legacy rows
// use the same "pulsex:<router>:route:<path>" shape without the marker.
const PULSEX_ROUTED_SOURCE_ID = "pulsex:pulsex_v2:route:0xtoken-0xwpls-0xpdai";
// The pre-#274 fabricated "pDAI is always $1" observation's exact sourceId
// (removed in PR #274, but historical rows may still be persisted).
const LEGACY_FABRICATED_PDAI_PAR_SOURCE_ID = "pulsex:pdai:par";

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
      hops: [PHEX_ASSET, "chain:369:native:0x0000000000000000000000000000000000000000", QUOTE_ASSET],
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

  describe("pDAI-routed quote eligibility", () => {
    it("treats the exact canonical pDAI quote as eligible for a pDAI-routed observation", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: PDAI_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-quoted",
            quoteAsset: PDAI_ASSET,
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v2", pdaiParAssumption: true },
          }),
        ],
      });

      expect(result.selected?.id).toBe("pulsex-pdai-quoted");
      expect(result.rejected).toEqual([]);
    });

    it("rejects a pDAI-routed observation requested as fiat:usd", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-routed",
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: {
              router: "pulsex_v2",
              path: [PHEX_ASSET, "wpls", PDAI_ASSET],
              pdaiParAssumption: true,
            },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "pulsex-pdai-routed",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("rejects a pDAI-routed observation requested as an arbitrary non-fiat quote asset (WPLS)", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: WPLS_QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-routed-as-wpls",
            quoteAsset: WPLS_QUOTE_ASSET,
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v2", pdaiParAssumption: true },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "pulsex-pdai-routed-as-wpls",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("rejects a pDAI-routed observation requested as an arbitrary non-fiat quote asset (HEX)", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: HEX_QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-routed-as-hex",
            quoteAsset: HEX_QUOTE_ASSET,
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v1", pdaiParAssumption: true },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "pulsex-pdai-routed-as-hex",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("keeps quote matching chain-aware and exact — a same-address pDAI lookalike on another chain is not treated as the canonical pDAI quote", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: OTHER_CHAIN_PDAI_LOOKALIKE,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-routed-as-other-chain-lookalike",
            quoteAsset: OTHER_CHAIN_PDAI_LOOKALIKE,
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v2", pdaiParAssumption: true },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "pulsex-pdai-routed-as-other-chain-lookalike",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("prefers an independently verified fiat:usd observation over a pDAI-routed one", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "pulsex-pdai-routed",
            confidence: "0.95",
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v1", pdaiParAssumption: true },
          }),
          createObservation({
            id: "verified-oracle",
            sourceType: "ORACLE",
            sourceId: "oracle:usd:1",
            confidence: "0.80",
            routeMetadata: null,
          }),
        ],
      });

      expect(result.selected?.id).toBe("verified-oracle");
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "pulsex-pdai-routed",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });
  });

  describe("legacy PulseX provenance predating the pdaiParAssumption marker", () => {
    it("rejects a legacy PulseX-routed observation that has no pdaiParAssumption flag at all", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "legacy-pulsex-routed",
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            confidence: "0.95",
            // Pre-#274 shape: router/path/factory/pair, no pdaiParAssumption key.
            routeMetadata: {
              router: "pulsex_v2",
              path: [PHEX_ASSET, "wpls", PDAI_ASSET],
              factoryAddress: "0xfactory",
              pairAddress: "0xpair",
            },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "legacy-pulsex-routed",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("rejects the legacy fabricated pDAI-par (price 1) observation unconditionally", () => {
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PDAI_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date("2026-05-08T12:01:00.000Z"),
        observations: [
          createObservation({
            id: "legacy-pdai-par",
            assetId: PDAI_ASSET,
            assetAddress: "0xefd766ccb38eaf1dfd701853bfce31359239f305",
            price: "1",
            sourceType: "ORACLE",
            sourceId: LEGACY_FABRICATED_PDAI_PAR_SOURCE_ID,
            confidence: "1",
            routeMetadata: {
              note: "pDAI is the USD quote reference asset; price 1 is deterministic",
            },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "legacy-pdai-par",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("rejects both legacy unsafe forms even under historical-timestamp resolution where they are otherwise fresh and high-confidence", () => {
      // average-cost PnL resolves prices at historical ledger-event
      // timestamps, not "now" — simulate that by resolving very close to
      // observedAt so neither row is stale, and with confidence above the
      // default minimum, so eligibility (not freshness) is what excludes them.
      const historicalEventTime = new Date("2024-01-01T00:00:00.000Z");
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date(historicalEventTime.getTime() + 5_000),
        observations: [
          createObservation({
            id: "legacy-pulsex-routed-historical",
            observedAt: historicalEventTime,
            staleAfterSeconds: 120,
            confidence: "0.95",
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v1", path: [PHEX_ASSET, "wpls", PDAI_ASSET] },
          }),
        ],
      });

      expect(result.selected).toBeNull();
      expect(result.rejected).toEqual([
        expect.objectContaining({
          id: "legacy-pulsex-routed-historical",
          reason: "UNVERIFIED_QUOTE_ASSUMPTION",
        }),
      ]);
    });

    it("still selects a legitimate independently verified observation alongside rejected legacy rows", () => {
      const historicalEventTime = new Date("2024-01-01T00:00:00.000Z");
      const result = resolveBestPriceObservation({
        chainId: CHAIN_ID,
        assetId: PHEX_ASSET,
        quoteAsset: QUOTE_ASSET,
        observedAt: new Date(historicalEventTime.getTime() + 5_000),
        observations: [
          createObservation({
            id: "legacy-pulsex-routed-historical",
            observedAt: historicalEventTime,
            staleAfterSeconds: 120,
            confidence: "0.95",
            sourceId: PULSEX_ROUTED_SOURCE_ID,
            routeMetadata: { router: "pulsex_v1", path: [PHEX_ASSET, "wpls", PDAI_ASSET] },
          }),
          createObservation({
            id: "legacy-pdai-par",
            observedAt: historicalEventTime,
            staleAfterSeconds: 120,
            confidence: "1",
            sourceType: "ORACLE",
            sourceId: LEGACY_FABRICATED_PDAI_PAR_SOURCE_ID,
            routeMetadata: null,
          }),
          createObservation({
            id: "verified-manual",
            observedAt: historicalEventTime,
            staleAfterSeconds: 120,
            sourceType: "MANUAL",
            sourceId: "manual:operator:1",
            confidence: "0.90",
            routeMetadata: null,
          }),
        ],
      });

      expect(result.selected?.id).toBe("verified-manual");
      expect(result.rejected.map((item) => item.reason)).toEqual([
        "UNVERIFIED_QUOTE_ASSUMPTION",
        "UNVERIFIED_QUOTE_ASSUMPTION",
      ]);
    });
  });

  it("still selects pDAI's own volatile price — pDAI is not forcibly pegged to 1 even under the new eligibility check", () => {
    const result = resolveBestPriceObservation({
      chainId: CHAIN_ID,
      assetId: PDAI_ASSET,
      quoteAsset: QUOTE_ASSET,
      observedAt: new Date("2026-05-08T12:01:00.000Z"),
      observations: [
        createObservation({
          id: "pdai-direct",
          assetId: PDAI_ASSET,
          price: "0.73",
          routeMetadata: null,
        }),
      ],
    });

    expect(result.selected?.id).toBe("pdai-direct");
    expect(result.selected?.price).toBe("0.73");
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
