import { describe, expect, it, vi } from "vitest";

import {
  assembleLiveHoldingsSnapshot,
  MAX_CONCURRENT_TOKEN_BALANCE_READS,
  UnsupportedChainError,
} from "@/services/portfolio/live-holdings-snapshot";
import type { ResolveBestPriceResult } from "@/services/pricing/types";

const CHAIN_ID = 369;
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222";
const TOKEN_ASSET_ID = `chain:369:erc20:${TOKEN_ADDRESS}`;
const QUOTE_ASSET = "fiat:usd";
const AS_OF = new Date("2026-08-03T00:00:00.000Z");

function makeSelectedPrice(overrides: { price: string }) {
  return {
    price: overrides.price,
    sourceType: "PULSEX_ONCHAIN",
    sourceId: "pulsex:pulsex_v2:route:wpls-pdai",
    confidence: "0.9",
    observedAt: AS_OF,
    blockNumber: 999n,
    staleAfterSeconds: 300,
  };
}

function makeDb(tokens: Array<{ assetId: string; address: string; decimals: number; symbol: string | null }>) {
  return {
    token: {
      findMany: vi.fn().mockResolvedValue(tokens),
    },
  };
}

function makePublicClient(args: {
  nativeBalance: bigint;
  tokenBalances: Record<string, bigint | Error>;
  blockNumber: bigint;
}) {
  return {
    getBalance: vi.fn().mockResolvedValue(args.nativeBalance),
    getBlockNumber: vi.fn().mockResolvedValue(args.blockNumber),
    readContract: vi.fn().mockImplementation(({ address }: { address: string }) => {
      const result = args.tokenBalances[address.toLowerCase()];
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result ?? 0n);
    }),
  };
}

describe("assembleLiveHoldingsSnapshot", () => {
  it("includes native balance and priced known tokens, sums valued positions", async () => {
    const db = makeDb([
      { assetId: TOKEN_ASSET_ID, address: TOKEN_ADDRESS, decimals: 18, symbol: "TKN" },
    ]);
    const publicClient = makePublicClient({
      nativeBalance: 2_000000000000000000n, // 2 PLS
      tokenBalances: { [TOKEN_ADDRESS.toLowerCase()]: 5_000000000000000000n }, // 5 TKN
      blockNumber: 999n,
    });
    const resolvePrice = vi.fn(async (args: { assetId: string }): Promise<ResolveBestPriceResult> => {
      if (args.assetId === NATIVE_ASSET_ID) {
        return { selected: makeSelectedPrice({ price: "0.00005" }) as never, rejected: [] };
      }
      return { selected: makeSelectedPrice({ price: "10" }) as never, rejected: [] };
    });

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(result.schemaVersion).toBe("v1");
    expect(result.sourceType).toBe("LIVE_RPC_SNAPSHOT");
    expect(result.observedBlock).toBe("999");
    expect(result.pnlStatus).toBe("unsupported");
    expect(result.assets).toHaveLength(2);

    const native = result.assets.find((asset) => asset.assetId === NATIVE_ASSET_ID);
    expect(native?.balanceQuantity).toBe("2000000000000000000");
    expect(native?.priceStatus).toBe("priced");
    expect(native?.valueQuote).toBe("0.0001");

    const token = result.assets.find((asset) => asset.assetId === TOKEN_ASSET_ID);
    expect(token?.balanceQuantity).toBe("5000000000000000000");
    expect(token?.priceStatus).toBe("priced");
    expect(token?.valueQuote).toBe("50");

    expect(result.totalValueQuote).toBe("50.0001");
    expect(result.valuationStatus).toBe("available");
    expect(result.warnings).toEqual([]);

    // Price provenance must be attached per-asset, not just a bare priceStatus.
    expect(native?.pricing.rejectedReasons).toEqual([]);
    expect(token?.pricing.rejectedReasons).toEqual([]);

    // The token query must exclude native assets — balanceOf must never be
    // called against a native asset row (see the isNative-exclusion test
    // below for the direct regression check).
    expect(db.token.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isNative: false }) }),
    );
  });

  it("pins every balance read to the block reported as observedBlock", async () => {
    const db = makeDb([
      { assetId: TOKEN_ASSET_ID, address: TOKEN_ADDRESS, decimals: 18, symbol: "TKN" },
    ]);
    const publicClient = makePublicClient({
      nativeBalance: 1_000000000000000000n,
      tokenBalances: { [TOKEN_ADDRESS.toLowerCase()]: 1_000000000000000000n },
      blockNumber: 42_000n,
    });
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: null,
      rejected: [],
    }));

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(result.observedBlock).toBe("42000");
    // getBlockNumber must be called before the balance reads it pins.
    expect(publicClient.getBalance).toHaveBeenCalledWith({ address: WALLET_ADDRESS, blockNumber: 42_000n });
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: TOKEN_ADDRESS, blockNumber: 42_000n }),
    );
  });

  it("excludes native assets from the ERC-20 balanceOf probe list even if seeded in the Token table", async () => {
    // The Token table seeds a native PLS row (isNative: true). The mock db
    // here simulates the query already applying the isNative:false filter
    // (as production Prisma does) — this test's job is to assert the
    // service actually requests that filter, so a native row is never
    // treated as an ERC-20 balanceOf target.
    const db = makeDb([]);
    const publicClient = makePublicClient({
      nativeBalance: 1_000000000000000000n,
      tokenBalances: {},
      blockNumber: 1000n,
    });
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: null,
      rejected: [],
    }));

    await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(db.token.findMany).toHaveBeenCalledWith({
      where: { chainId: CHAIN_ID, isIgnored: false, isNative: false },
      select: { assetId: true, address: true, decimals: true, symbol: true },
    });
    // Native balance still comes from getBalance, never from readContract.
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("bounds concurrent per-token balanceOf RPC calls to MAX_CONCURRENT_TOKEN_BALANCE_READS", async () => {
    const tokenCount = MAX_CONCURRENT_TOKEN_BALANCE_READS * 3;
    const tokens = Array.from({ length: tokenCount }, (_, index) => {
      const address = `0x${(index + 10).toString(16).padStart(40, "0")}`;
      return { assetId: `chain:369:erc20:${address}`, address, decimals: 18, symbol: `T${index}` };
    });
    const db = makeDb(tokens);

    let inFlight = 0;
    let maxInFlight = 0;
    const publicClient = {
      getBalance: vi.fn().mockResolvedValue(0n),
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      readContract: vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so other queued reads have a chance to start concurrently
        // before this one resolves — proves real concurrency, not
        // accidental full serialization.
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return 1_000000000000000000n;
      }),
    };
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: null,
      rejected: [],
    }));

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(publicClient.readContract).toHaveBeenCalledTimes(tokenCount);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_TOKEN_BALANCE_READS);
    expect(result.assets).toHaveLength(tokenCount);
  });

  it("throws UnsupportedChainError for a non-PulseChain chainId before performing any RPC read", async () => {
    const db = makeDb([]);
    const publicClient = makePublicClient({ nativeBalance: 0n, tokenBalances: {}, blockNumber: 1000n });
    const resolvePrice = vi.fn();

    await expect(
      assembleLiveHoldingsSnapshot({
        wallet: { address: WALLET_ADDRESS, chainId: 1 },
        quoteAsset: QUOTE_ASSET,
        asOf: AS_OF,
        db: db as never,
        publicClient: publicClient as never,
        resolvePrice,
      }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);

    expect(publicClient.getBalance).not.toHaveBeenCalled();
    expect(publicClient.getBlockNumber).not.toHaveBeenCalled();
    expect(db.token.findMany).not.toHaveBeenCalled();
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it("attaches price provenance (source, confidence, observed block) to a priced asset", async () => {
    const db = makeDb([
      { assetId: TOKEN_ASSET_ID, address: TOKEN_ADDRESS, decimals: 18, symbol: "TKN" },
    ]);
    const publicClient = makePublicClient({
      nativeBalance: 0n,
      tokenBalances: { [TOKEN_ADDRESS.toLowerCase()]: 1_000000000000000000n },
      blockNumber: 1000n,
    });
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: {
        price: "2",
        sourceType: "PULSEX_ONCHAIN",
        sourceId: "pulsex:pulsex_v2:route:wpls-pdai",
        confidence: "0.9",
        observedAt: AS_OF,
        blockNumber: 999n,
        staleAfterSeconds: 300,
      } as never,
      rejected: [],
    }));

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(result.assets[0].pricing).toEqual({
      sourceType: "PULSEX_ONCHAIN",
      sourceId: "pulsex:pulsex_v2:route:wpls-pdai",
      confidence: "0.9",
      observedAt: AS_OF.toISOString(),
      observedBlock: "999",
      staleAfterSeconds: 300,
      rejectedReasons: [],
    });
  });

  it("marks an asset unpriced when the resolver finds no observation, and excludes it from the total", async () => {
    const db = makeDb([
      { assetId: TOKEN_ASSET_ID, address: TOKEN_ADDRESS, decimals: 18, symbol: "TKN" },
    ]);
    const publicClient = makePublicClient({
      nativeBalance: 0n,
      tokenBalances: { [TOKEN_ADDRESS.toLowerCase()]: 1_000000000000000000n },
      blockNumber: 1000n,
    });
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: null,
      rejected: [{ reason: "NO_OBSERVATION" } as never],
    }));

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    // Zero native balance is omitted; only the token position is returned.
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].priceStatus).toBe("unpriced");
    expect(result.assets[0].valueQuote).toBeNull();
    expect(result.totalValueQuote).toBeNull();
    expect(result.valuationStatus).toBe("unavailable");
    expect(result.warnings).toContain(`pricing-unavailable:${TOKEN_ASSET_ID}`);
  });

  it("tolerates a single token balanceOf RPC failure without failing the whole snapshot", async () => {
    const failingTokenAddress = "0x3333333333333333333333333333333333333333";
    const db = makeDb([
      { assetId: TOKEN_ASSET_ID, address: TOKEN_ADDRESS, decimals: 18, symbol: "TKN" },
      {
        assetId: `chain:369:erc20:${failingTokenAddress}`,
        address: failingTokenAddress,
        decimals: 18,
        symbol: "BAD",
      },
    ]);
    const publicClient = makePublicClient({
      nativeBalance: 0n,
      tokenBalances: {
        [TOKEN_ADDRESS.toLowerCase()]: 1_000000000000000000n,
        [failingTokenAddress.toLowerCase()]: new Error("RPC timeout"),
      },
      blockNumber: 1000n,
    });
    const resolvePrice = vi.fn(async (): Promise<ResolveBestPriceResult> => ({
      selected: makeSelectedPrice({ price: "1" }) as never,
      rejected: [],
    }));

    const result = await assembleLiveHoldingsSnapshot({
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: QUOTE_ASSET,
      asOf: AS_OF,
      db: db as never,
      publicClient: publicClient as never,
      resolvePrice,
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].assetId).toBe(TOKEN_ASSET_ID);
    expect(result.warnings).toContain(`balance-read-failed:chain:369:erc20:${failingTokenAddress}`);
  });
});
