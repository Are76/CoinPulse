import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicTokenId,
  buildNativeTransactionScanWindows,
  resolveTokenMetadata,
} from "@/services/sync/sync-common";

describe("buildNativeTransactionScanWindows", () => {
  it("splits large ranges predictably by the configured max window size", () => {
    expect(
      buildNativeTransactionScanWindows({
        fromBlock: 10n,
        toBlock: 16n,
        maxWindowSize: 3n,
      }),
    ).toEqual([
      { fromBlock: 10n, toBlock: 12n },
      { fromBlock: 13n, toBlock: 15n },
      { fromBlock: 16n, toBlock: 16n },
    ]);
  });

  it("returns a single window when the range already fits", () => {
    expect(
      buildNativeTransactionScanWindows({
        fromBlock: 20n,
        toBlock: 21n,
        maxWindowSize: 5n,
      }),
    ).toEqual([{ fromBlock: 20n, toBlock: 21n }]);
  });
});


describe("resolveTokenMetadata token identity contracts", () => {
  function createTokenIdentityHarness() {
    type StoredToken = {
      id: string;
      chainId: number;
      address: string;
      addressLower: string;
      assetId: string;
      symbol: string;
      name: string;
      decimals: number;
      decimalsSource: string;
      isNative: boolean;
    };

    const tokens = new Map<string, StoredToken>();
    const metadataSources = new Map<string, unknown>();

    const db = {
      token: {
        async findUnique(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } } }) {
          const key = `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`;
          return tokens.get(key) ?? null;
        },
        async upsert(args: {
          where: { chainId_addressLower: { chainId: number; addressLower: string } };
          create: StoredToken;
          update: Partial<StoredToken>;
        }) {
          const key = `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`;
          const existing = tokens.get(key);
          const next = existing ? { ...existing, ...args.update } : args.create;
          tokens.set(key, next);
          return next;
        },
      },
      tokenMetadataSource: {
        async upsert(args: {
          where: { tokenId_sourceKind_sourceRef: { tokenId: string; sourceKind: string; sourceRef: string } };
          create: unknown;
          update: unknown;
        }) {
          const key = `${args.where.tokenId_sourceKind_sourceRef.tokenId}:${args.where.tokenId_sourceKind_sourceRef.sourceKind}:${args.where.tokenId_sourceKind_sourceRef.sourceRef}`;
          metadataSources.set(key, metadataSources.has(key) ? args.update : args.create);
          return metadataSources.get(key);
        },
      },
    };

    const metadataByAddress = new Map<string, { decimals: number; symbol: string; name: string }>([
      [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        { decimals: 6, symbol: "SAME", name: "Same Symbol Alpha" },
      ],
      [
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        { decimals: 18, symbol: "SAME", name: "Same Symbol Beta" },
      ],
    ]);

    const publicClient = {
      readContract: vi.fn(async (args: { address: `0x${string}`; functionName: string }) => {
        const metadata = metadataByAddress.get(args.address.toLowerCase());
        if (!metadata) {
          throw new Error(`missing metadata for ${args.address}`);
        }

        if (args.functionName === "decimals") {
          return metadata.decimals;
        }
        if (args.functionName === "symbol") {
          return metadata.symbol;
        }
        if (args.functionName === "name") {
          return metadata.name;
        }

        throw new Error(`unexpected function ${args.functionName}`);
      }),
    };

    return { db, publicClient, tokens };
  }

  it("keeps same-symbol tokens distinct by normalized contract address and chain", async () => {
    const harness = createTokenIdentityHarness();

    const alpha = await resolveTokenMetadata({
      db: harness.db as never,
      publicClient: harness.publicClient as never,
      chainId: 369,
      tokenAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const beta = await resolveTokenMetadata({
      db: harness.db as never,
      publicClient: harness.publicClient as never,
      chainId: 369,
      tokenAddress: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
    });
    const alphaOnOtherChain = await resolveTokenMetadata({
      db: harness.db as never,
      publicClient: harness.publicClient as never,
      chainId: 943,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(alpha).toEqual({
      tokenId: buildDeterministicTokenId(369, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      assetId: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      decimals: 6,
    });
    expect(beta).toMatchObject({
      tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      assetId: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decimals: 18,
    });
    expect(alphaOnOtherChain).toMatchObject({
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      assetId: "chain:943:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      decimals: 6,
    });

    expect(new Set([alpha.tokenId, beta.tokenId, alphaOnOtherChain.tokenId]).size).toBe(3);
    expect(new Set([alpha.assetId, beta.assetId, alphaOnOtherChain.assetId]).size).toBe(3);
    expect(Array.from(harness.tokens.values()).map((token) => token.symbol)).toEqual([
      "SAME",
      "SAME",
      "SAME",
    ]);
    expect(Array.from(harness.tokens.values()).map((token) => token.decimals)).toEqual([6, 18, 6]);
  });

  it("returns existing normalized-address metadata without re-inferring decimals from symbol", async () => {
    const harness = createTokenIdentityHarness();

    const first = await resolveTokenMetadata({
      db: harness.db as never,
      publicClient: harness.publicClient as never,
      chainId: 369,
      tokenAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    harness.publicClient.readContract.mockClear();

    const second = await resolveTokenMetadata({
      db: harness.db as never,
      publicClient: harness.publicClient as never,
      chainId: 369,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(second).toEqual(first);
    expect(harness.publicClient.readContract).not.toHaveBeenCalled();
  });
});
