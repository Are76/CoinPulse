import { describe, expect, it } from "vitest";

import { runPriceIngestion } from "@/services/pricing/price-ingestion";
import type { PriceObservationDraft } from "@/services/pricing/types";
import type { FetchOnchainPriceArgs, FetchOnchainPriceResult } from "@/services/pricing/fetchers/onchain-pulsex-fetcher";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHAIN_ID = 369;
const BLOCK_NUMBER = 21_000_000n;
const OBSERVED_AT = new Date("2026-06-04T12:00:00.000Z");
const QUOTE_ASSET = "fiat:usd";

const PHEX_ASSET: { assetId: string; tokenAddress: `0x${string}`; tokenDecimals: number; quoteAsset: string } = {
  assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  tokenDecimals: 8,
  quoteAsset: QUOTE_ASSET,
};

const PLS_ASSET: { assetId: string; tokenAddress: `0x${string}`; tokenDecimals: number; quoteAsset: string } = {
  assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
  tokenAddress: "0x0000000000000000000000000000000000000000",
  tokenDecimals: 18,
  quoteAsset: QUOTE_ASSET,
};

const PDAI_ASSET: { assetId: string; tokenAddress: `0x${string}`; tokenDecimals: number; quoteAsset: string } = {
  assetId: "chain:369:erc20:0xefd766ccb38eaf1dfd701853bfce31359239f305",
  tokenAddress: "0xefD766cCb38EaF1dfd701853BFCe31359239F305",
  tokenDecimals: 18,
  quoteAsset: QUOTE_ASSET,
};

function makeDraft(assetId: string): PriceObservationDraft {
  return {
    chainId: CHAIN_ID,
    assetId,
    assetAddress: null,
    quoteAsset: QUOTE_ASSET,
    price: "0.021",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pulsex_v1:route:mock",
    routeMetadata: null,
    liquidityUsd: "500000",
    confidence: "0.95",
    observedAt: OBSERVED_AT,
    blockNumber: BLOCK_NUMBER,
    staleAfterSeconds: 120,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSuccessFetcher(assetId: string): (args: FetchOnchainPriceArgs) => Promise<FetchOnchainPriceResult> {
  return async () => ({ ok: true, draft: makeDraft(assetId) });
}

function makeFailFetcher(reason: string): (args: FetchOnchainPriceArgs) => Promise<FetchOnchainPriceResult> {
  return async () => ({ ok: false, reason });
}

function makeCapturingStore() {
  const persisted: PriceObservationDraft[] = [];
  return {
    persisted,
    persistObservations: async (drafts: readonly PriceObservationDraft[]) => {
      persisted.push(...drafts);
      return { createdCount: drafts.length };
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runPriceIngestion", () => {
  it("fetches and persists drafts for all successful assets", async () => {
    const store = makeCapturingStore();

    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET, PLS_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: async (args) => ({ ok: true, draft: makeDraft(args.assetId) }),
        persistObservations: store.persistObservations,
      },
    );

    expect(result.fetchedCount).toBe(2);
    expect(result.persistedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.failedAssets).toEqual([]);
    expect(store.persisted).toHaveLength(2);
    expect(store.persisted.map((d) => d.assetId)).toEqual([
      PHEX_ASSET.assetId,
      PLS_ASSET.assetId,
    ]);
  });

  it("records failed assets and only persists successful drafts", async () => {
    const store = makeCapturingStore();

    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET, PLS_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: async (args) => {
          if (args.assetId === PHEX_ASSET.assetId) {
            return { ok: true, draft: makeDraft(args.assetId) };
          }
          return { ok: false, reason: "zero_amount_out" };
        },
        persistObservations: store.persistObservations,
      },
    );

    expect(result.fetchedCount).toBe(1);
    expect(result.persistedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failedAssets).toEqual([PLS_ASSET.assetId]);
    expect(store.persisted).toHaveLength(1);
    expect(store.persisted[0]?.assetId).toBe(PHEX_ASSET.assetId);
  });

  it("returns all failed and does not call persist when every fetch fails", async () => {
    let persistCalled = false;
    const store = {
      persistObservations: async (drafts: readonly PriceObservationDraft[]) => {
        persistCalled = true;
        return { createdCount: drafts.length };
      },
    };

    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET, PLS_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: makeFailFetcher("unsupported_chain_id:999"),
        persistObservations: store.persistObservations,
      },
    );

    expect(result.fetchedCount).toBe(0);
    expect(result.persistedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    expect(result.failedAssets).toEqual([PHEX_ASSET.assetId, PLS_ASSET.assetId]);
    expect(persistCalled).toBe(false);
  });

  it("returns correct metadata on the result", async () => {
    const store = makeCapturingStore();

    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: makeSuccessFetcher(PHEX_ASSET.assetId),
        persistObservations: store.persistObservations,
      },
    );

    expect(result.chainId).toBe(CHAIN_ID);
    expect(result.blockNumber).toBe(BLOCK_NUMBER);
    expect(result.observedAt).toBe(OBSERVED_AT);
  });

  it("passes the correct args to the fetcher", async () => {
    const capturedArgs: FetchOnchainPriceArgs[] = [];
    const store = makeCapturingStore();

    await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: async (args) => {
          capturedArgs.push(args);
          return { ok: true, draft: makeDraft(args.assetId) };
        },
        persistObservations: store.persistObservations,
      },
    );

    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toMatchObject({
      chainId: CHAIN_ID,
      blockNumber: BLOCK_NUMBER,
      observedAt: OBSERVED_AT,
      assetId: PHEX_ASSET.assetId,
      tokenAddress: PHEX_ASSET.tokenAddress,
      tokenDecimals: PHEX_ASSET.tokenDecimals,
      quoteAsset: PHEX_ASSET.quoteAsset,
    });
  });

  it("handles a single asset correctly", async () => {
    const store = makeCapturingStore();

    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PLS_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: makeSuccessFetcher(PLS_ASSET.assetId),
        persistObservations: store.persistObservations,
      },
    );

    expect(result.fetchedCount).toBe(1);
    expect(result.persistedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("persistedCount reflects deduplication from the store", async () => {
    const result = await runPriceIngestion(
      { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET] },
      {
        publicClient: {} as never,
        fetchPrice: makeSuccessFetcher(PHEX_ASSET.assetId),
        persistObservations: async () => ({ createdCount: 0 }),
      },
    );

    // Fetched 1, but store reported 0 created (duplicate)
    expect(result.fetchedCount).toBe(1);
    expect(result.persistedCount).toBe(0);
  });

  describe("pDAI routing reference skip", () => {
    it("does not count pDAI as a failed asset when the fetcher returns pdai_routing_reference", async () => {
      const store = makeCapturingStore();

      const result = await runPriceIngestion(
        { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET, PDAI_ASSET] },
        {
          publicClient: {} as never,
          fetchPrice: async (args) => {
            if (args.assetId === PDAI_ASSET.assetId) {
              return { ok: false, reason: "pdai_routing_reference" };
            }
            return { ok: true, draft: makeDraft(args.assetId) };
          },
          persistObservations: store.persistObservations,
        },
      );

      expect(result.failedCount).toBe(0);
      expect(result.failedAssets).toEqual([]);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedAssets).toEqual([PDAI_ASSET.assetId]);
      // Only PHEX is persisted — pDAI produces no observation
      expect(result.fetchedCount).toBe(1);
      expect(store.persisted).toHaveLength(1);
      expect(store.persisted[0]?.assetId).toBe(PHEX_ASSET.assetId);
    });

    it("returns skippedCount: 0 when no asset returns pdai_routing_reference", async () => {
      const store = makeCapturingStore();

      const result = await runPriceIngestion(
        { chainId: CHAIN_ID, blockNumber: BLOCK_NUMBER, observedAt: OBSERVED_AT, assets: [PHEX_ASSET] },
        {
          publicClient: {} as never,
          fetchPrice: makeSuccessFetcher(PHEX_ASSET.assetId),
          persistObservations: store.persistObservations,
        },
      );

      expect(result.skippedCount).toBe(0);
      expect(result.skippedAssets).toEqual([]);
    });

    it("distinguishes pdai_routing_reference skip from a real fetch failure", async () => {
      const store = makeCapturingStore();

      const result = await runPriceIngestion(
        {
          chainId: CHAIN_ID,
          blockNumber: BLOCK_NUMBER,
          observedAt: OBSERVED_AT,
          assets: [PHEX_ASSET, PDAI_ASSET, PLS_ASSET],
        },
        {
          publicClient: {} as never,
          fetchPrice: async (args) => {
            if (args.assetId === PDAI_ASSET.assetId) {
              return { ok: false, reason: "pdai_routing_reference" };
            }
            if (args.assetId === PLS_ASSET.assetId) {
              return { ok: false, reason: "zero_amount_out" };
            }
            return { ok: true, draft: makeDraft(args.assetId) };
          },
          persistObservations: store.persistObservations,
        },
      );

      expect(result.failedCount).toBe(1);
      expect(result.failedAssets).toEqual([PLS_ASSET.assetId]);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedAssets).toEqual([PDAI_ASSET.assetId]);
      expect(result.fetchedCount).toBe(1);
    });
  });
});
