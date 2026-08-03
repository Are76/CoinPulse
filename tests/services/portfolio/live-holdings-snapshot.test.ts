import { describe, expect, it, vi } from "vitest";

import { assembleLiveHoldingsSnapshot } from "@/services/portfolio/live-holdings-snapshot";
import type { ResolveBestPriceResult } from "@/services/pricing/types";

const CHAIN_ID = 369;
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222";
const TOKEN_ASSET_ID = `chain:369:erc20:${TOKEN_ADDRESS}`;
const QUOTE_ASSET = "fiat:usd";
const AS_OF = new Date("2026-08-03T00:00:00.000Z");

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
        return { selected: { price: "0.00005" } as never, rejected: [] };
      }
      return { selected: { price: "10" } as never, rejected: [] };
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
      selected: { price: "1" } as never,
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
