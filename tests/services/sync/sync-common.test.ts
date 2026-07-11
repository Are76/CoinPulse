import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicTokenId,
  buildNativeTransactionScanWindows,
  resolveTokenMetadata,
  TRANSFER_EVENT_TOPIC0,
  withRawEthGetLogs,
} from "@/services/sync/sync-common";

describe("withRawEthGetLogs", () => {
  const walletTopic =
    "0x0000000000000000000000001111111111111111111111111111111111111111";

  function createRequestClient() {
    return {
      request: vi.fn(async () => [
        {
          address: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          blockHash: "0xblockhash",
          blockNumber: "0x8c" as `0x${string}`,
          data: "0x01",
          logIndex: "0x2" as `0x${string}`,
          transactionHash: "0xtxhash",
          topics: [TRANSFER_EVENT_TOPIC0, walletTopic],
        },
      ]),
      getBlock: vi.fn(),
    };
  }

  it("sends the raw topics filter through eth_getLogs with hex block bounds", async () => {
    const client = createRequestClient();
    const wrapped = withRawEthGetLogs(client);

    await wrapped.getLogs({
      topics: [TRANSFER_EVENT_TOPIC0, walletTopic, null],
      fromBlock: 140n,
      toBlock: 141n,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: "0x8c",
          toBlock: "0x8d",
          topics: [TRANSFER_EVENT_TOPIC0, walletTopic, null],
        },
      ],
    });
  });

  it("passes an address filter through when provided", async () => {
    const client = createRequestClient();
    const wrapped = withRawEthGetLogs(client);

    await wrapped.getLogs({
      address: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      topics: [TRANSFER_EVENT_TOPIC0],
      fromBlock: 1n,
      toBlock: 1n,
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: "0x1",
          toBlock: "0x1",
          address: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          topics: [TRANSFER_EVENT_TOPIC0],
        },
      ],
    });
  });

  it("maps raw hex log fields into the RpcLog shape", async () => {
    const wrapped = withRawEthGetLogs(createRequestClient());

    const logs = await wrapped.getLogs({
      topics: [TRANSFER_EVENT_TOPIC0],
      fromBlock: 140n,
      toBlock: 140n,
    });

    expect(logs).toEqual([
      {
        address: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
        blockHash: "0xblockhash",
        blockNumber: 140n,
        data: "0x01",
        logIndex: 2,
        transactionHash: "0xtxhash",
        topics: [TRANSFER_EVENT_TOPIC0, walletTopic],
      },
    ]);
  });

  it("preserves the other client methods", async () => {
    const client = createRequestClient();
    const wrapped = withRawEthGetLogs(client);

    expect(wrapped.getBlock).toBe(client.getBlock);
    expect(wrapped.request).toBe(client.request);
  });
});

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
        { decimals: 6, symbol: "SAME", name: "Shared Metadata Name" },
      ],
      [
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        { decimals: 18, symbol: "SAME", name: "Shared Metadata Name" },
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

    return { db, publicClient, tokens, metadataSources };
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
    expect(Array.from(harness.tokens.values()).map((token) => token.name)).toEqual([
      "Shared Metadata Name",
      "Shared Metadata Name",
      "Shared Metadata Name",
    ]);
    expect(Array.from(harness.tokens.values()).map((token) => token.decimals)).toEqual([6, 18, 6]);
  });

  it("records RPC metadata provenance separately for same-symbol and same-name tokens", async () => {
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

    expect(harness.metadataSources).toEqual(
      new Map([
        [
          `${alpha.tokenId}:RPC:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
          {
            tokenId: alpha.tokenId,
            sourceKind: "RPC",
            sourceRef: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            decimals: 6,
            symbol: "SAME",
            name: "Shared Metadata Name",
          },
        ],
        [
          `${beta.tokenId}:RPC:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
          {
            tokenId: beta.tokenId,
            sourceKind: "RPC",
            sourceRef: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            decimals: 18,
            symbol: "SAME",
            name: "Shared Metadata Name",
          },
        ],
      ]),
    );
    expect(
      new Set(
        Array.from(harness.metadataSources.values()).map(
          (source) => (source as { tokenId: string }).tokenId,
        ),
      ),
    ).toEqual(new Set([alpha.tokenId, beta.tokenId]));
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
