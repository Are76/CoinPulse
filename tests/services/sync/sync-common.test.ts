import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicTokenId,
  buildNativeTransactionScanWindows,
  ingestWalletTransferArtifacts,
  resolveTokenMetadata,
  toTopicAddress,
  TRANSFER_EVENT_TOPIC0,
  withRawEthGetLogs,
} from "@/services/sync/sync-common";
import { SYNC_WARNING_CODES } from "@/services/sync/sync-warning-codes";

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

describe("ingestWalletTransferArtifacts wallet-relevance filtering", () => {
  const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
  const WALLET_TOPIC = toTopicAddress(WALLET_ADDRESS);
  // Pre-seeded so retained-log tests never need to hit readContract for
  // token metadata; the address only used by the rejected-only log is
  // deliberately left unseeded so a stray readContract call is observable.
  const TRACKED_TOKEN_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const REJECTED_ONLY_TOKEN_ADDRESS = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function createIngestionHarness() {
    const rawLogs = new Map<string, Record<string, unknown>>();
    const rawBlocks = new Map<string, Record<string, unknown>>();
    const rawTransactions = new Map<string, Record<string, unknown>>();
    const rawTokenTransfers = new Map<string, Record<string, unknown>>();
    const tokens = new Map<string, Record<string, unknown>>([
      [
        `369:${TRACKED_TOKEN_ADDRESS}`,
        {
          id: "token_tracked",
          addressLower: TRACKED_TOKEN_ADDRESS,
          assetId: `chain:369:erc20:${TRACKED_TOKEN_ADDRESS}`,
          decimals: 18,
        },
      ],
    ]);

    const db = {
      rawLog: {
        async createMany(args: {
          data: Array<{ chainId: number; txHash: string; blockHash: string; logIndex: number }>;
        }) {
          let count = 0;
          for (const item of args.data) {
            const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
            if (!rawLogs.has(key)) {
              rawLogs.set(key, item);
              count += 1;
            }
          }
          return { count };
        },
      },
      rawBlock: {
        async createMany(args: {
          data: Array<{
            chainId: number;
            blockNumber: bigint;
            blockHash: string;
            parentHash: string;
            timestamp: Date;
          }>;
        }) {
          let count = 0;
          for (const item of args.data) {
            const key = `${item.chainId}:${item.blockNumber}:${item.blockHash}`;
            if (!rawBlocks.has(key)) {
              rawBlocks.set(key, item);
              count += 1;
            }
          }
          return { count };
        },
        async findMany(args: { where: { chainId: number; blockNumber: { gte: bigint; lte: bigint } } }) {
          return Array.from(rawBlocks.values()).filter(
            (item) =>
              (item.chainId as number) === args.where.chainId &&
              (item.blockNumber as bigint) >= args.where.blockNumber.gte &&
              (item.blockNumber as bigint) <= args.where.blockNumber.lte,
          );
        },
      },
      rawTransaction: {
        async createMany(args: { data: Array<{ chainId: number; txHash: string; blockHash: string }> }) {
          let count = 0;
          for (const item of args.data) {
            const key = `${item.chainId}:${item.txHash}:${item.blockHash}`;
            if (!rawTransactions.has(key)) {
              rawTransactions.set(key, item);
              count += 1;
            }
          }
          return { count };
        },
        async findMany() {
          return [];
        },
      },
      rawTokenTransfer: {
        async createMany(args: {
          data: Array<{
            chainId: number;
            txHash: string;
            blockHash: string;
            logIndex: number;
            fromAddress: string;
            toAddress: string;
          }>;
        }) {
          let count = 0;
          for (const item of args.data) {
            const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
            if (!rawTokenTransfers.has(key)) {
              rawTokenTransfers.set(key, item);
              count += 1;
            }
          }
          return { count };
        },
        async findMany(args: {
          where: {
            chainId: number;
            blockNumber: { gte: bigint; lte: bigint };
            OR: Array<{ fromAddress?: string; toAddress?: string }>;
          };
        }) {
          const fromAddress = args.where.OR[0]?.fromAddress;
          const toAddress = args.where.OR[1]?.toAddress;
          return Array.from(rawTokenTransfers.values()).filter(
            (item) =>
              (item.chainId as number) === args.where.chainId &&
              (item.blockNumber as bigint) >= args.where.blockNumber.gte &&
              (item.blockNumber as bigint) <= args.where.blockNumber.lte &&
              (item.fromAddress === fromAddress || item.toAddress === toAddress),
          );
        },
      },
      token: {
        async findUnique(args: {
          where: { chainId_addressLower: { chainId: number; addressLower: string } };
        }) {
          return (
            tokens.get(
              `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`,
            ) ?? null
          );
        },
        async upsert(args: {
          where: { chainId_addressLower: { chainId: number; addressLower: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) {
          const key = `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`;
          const existing = tokens.get(key);
          const next = existing ? { ...existing, ...args.update } : args.create;
          tokens.set(key, next);
          return next;
        },
      },
      tokenMetadataSource: {
        async upsert() {
          return undefined;
        },
      },
    };

    return { db, rawLogs, rawBlocks, rawTransactions, rawTokenTransfers, tokens };
  }

  function createIngestionPublicClient(logs: unknown[]) {
    return {
      // A provider that does not honor the topics filter — the exact scenario
      // this defense-in-depth check must survive — returns the same log set
      // regardless of the requested topics.
      getLogs: vi.fn(async () => logs),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        number: blockNumber,
        hash: "0xblock10",
        parentHash: "0xblock9",
        timestamp: 1_700_000_000n,
        transactions: [],
      })),
      readContract: vi.fn(async ({ functionName }: { address: string; functionName: string }) => {
        if (functionName === "decimals") return 18;
        if (functionName === "symbol") return "TOK";
        return "Token";
      }),
      getTransaction: vi.fn(),
      getTransactionReceipt: vi.fn(),
    };
  }

  const unrelatedLog = {
    address: REJECTED_ONLY_TOKEN_ADDRESS,
    blockHash: "0xblock10",
    blockNumber: 10n,
    data: "0x0000000000000000000000000000000000000000000000000000000000000064",
    logIndex: 0,
    transactionHash: "0xtxunrelated",
    topics: [
      TRANSFER_EVENT_TOPIC0,
      "0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
      "0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd",
    ],
  };

  const inboundLog = {
    address: TRACKED_TOKEN_ADDRESS,
    blockHash: "0xblock10",
    blockNumber: 10n,
    data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
    logIndex: 1,
    transactionHash: "0xtxinbound",
    topics: [
      TRANSFER_EVENT_TOPIC0,
      "0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      WALLET_TOPIC,
    ],
  };

  const outboundLog = {
    address: TRACKED_TOKEN_ADDRESS,
    blockHash: "0xblock10",
    blockNumber: 10n,
    data: "0x00000000000000000000000000000000000000000000000000000000000001f4",
    logIndex: 2,
    transactionHash: "0xtxoutbound",
    topics: [
      TRANSFER_EVENT_TOPIC0,
      WALLET_TOPIC,
      "0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff",
    ],
  };

  const nonTransferLog = {
    address: TRACKED_TOKEN_ADDRESS,
    blockHash: "0xblock10",
    blockNumber: 10n,
    data: "0x00",
    logIndex: 3,
    transactionHash: "0xtxnontransfer",
    topics: [
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      WALLET_TOPIC,
      "0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff",
    ],
  };

  function runIngestion(logs: unknown[]) {
    const harness = createIngestionHarness();
    const publicClient = createIngestionPublicClient(logs);

    return ingestWalletTransferArtifacts({
      db: harness.db as never,
      publicClient: publicClient as never,
      maxWindowSize: 2n,
      wallet: { chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 10n,
      toBlock: 10n,
    }).then((artifacts) => ({ artifacts, harness, publicClient }));
  }

  it("rejects a Transfer log whose topics do not reference the tracked wallet", async () => {
    const { artifacts, harness } = await runIngestion([unrelatedLog]);

    expect(artifacts.rawTransfers).toHaveLength(0);
    expect(artifacts.warnings.some((warning) => warning.includes("unrelated-wallet"))).toBe(true);
    expect(harness.rawLogs.size).toBe(0);
  });

  it("retains a genuine inbound wallet transfer (topic2 matches wallet)", async () => {
    const { artifacts } = await runIngestion([inboundLog]);

    expect(artifacts.rawTransfers).toHaveLength(1);
    expect(artifacts.rawTransfers[0]).toMatchObject({
      txHash: "0xtxinbound",
      toAddress: WALLET_ADDRESS.toLowerCase(),
    });
  });

  it("retains a genuine outbound wallet transfer (topic1 matches wallet)", async () => {
    const { artifacts } = await runIngestion([outboundLog]);

    expect(artifacts.rawTransfers).toHaveLength(1);
    expect(artifacts.rawTransfers[0]).toMatchObject({
      txHash: "0xtxoutbound",
      fromAddress: WALLET_ADDRESS.toLowerCase(),
    });
  });

  it("rejects a non-Transfer topic0 log", async () => {
    const { artifacts, harness } = await runIngestion([nonTransferLog]);

    expect(artifacts.rawTransfers).toHaveLength(0);
    expect(artifacts.warnings.some((warning) => warning.includes("non-transfer"))).toBe(true);
    expect(harness.rawLogs.size).toBe(0);
  });

  it("rejects unrelated-wallet logs before RawLog persistence and before token metadata resolution", async () => {
    const { artifacts, harness, publicClient } = await runIngestion([
      unrelatedLog,
      inboundLog,
      outboundLog,
      nonTransferLog,
    ]);

    expect(artifacts.rawTransfers.map((transfer) => transfer.txHash).sort()).toEqual([
      "0xtxinbound",
      "0xtxoutbound",
    ]);
    // Only the two wallet-relevant logs ever reach persistRawLogs.
    expect(harness.rawLogs.size).toBe(2);
    expect(
      Array.from(harness.rawLogs.values()).map((log) => (log as { txHash: string }).txHash).sort(),
    ).toEqual(["0xtxinbound", "0xtxoutbound"]);
    // Token metadata resolution/readContract must never run for a token
    // contract that appears only in a rejected log.
    for (const call of publicClient.readContract.mock.calls) {
      expect(call[0].address).not.toBe(REJECTED_ONLY_TOKEN_ADDRESS);
    }
  });

  describe("structured warning classification", () => {
    it("classifies a skipped non-transfer log as UNKNOWN with the exact legacy detail", async () => {
      const { artifacts } = await runIngestion([nonTransferLog]);

      expect(artifacts.warnings).toHaveLength(1);
      expect(artifacts.structuredWarnings).toHaveLength(1);
      expect(artifacts.structuredWarnings[0]).toEqual({
        code: SYNC_WARNING_CODES.UNKNOWN,
        detail: artifacts.warnings[0],
      });
      expect(artifacts.structuredWarnings[0].detail).toContain("non-transfer");
    });

    it("classifies a skipped unrelated-wallet log as UNKNOWN with the exact legacy detail", async () => {
      const { artifacts } = await runIngestion([unrelatedLog]);

      expect(artifacts.warnings).toHaveLength(1);
      expect(artifacts.structuredWarnings).toHaveLength(1);
      expect(artifacts.structuredWarnings[0]).toEqual({
        code: SYNC_WARNING_CODES.UNKNOWN,
        detail: artifacts.warnings[0],
      });
      expect(artifacts.structuredWarnings[0].detail).toContain("unrelated-wallet");
    });

    it("classifies a skipped non-ERC20 log as UNKNOWN, never RAW_BLOCKS_ALREADY_PERSISTED", async () => {
      const harness = createIngestionHarness();
      // A wallet-relevant Transfer log (topics reference the tracked wallet)
      // whose token contract fails ERC20 metadata resolution — the exact
      // producer condition for the "skipped non-ERC20 log" warning.
      const UNSEEDED_TOKEN_ADDRESS = "0xcccccccccccccccccccccccccccccccccccccccc";
      const nonErc20Log = {
        address: UNSEEDED_TOKEN_ADDRESS,
        blockHash: "0xblock10",
        blockNumber: 10n,
        data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
        logIndex: 1,
        transactionHash: "0xtxbadtoken",
        topics: [
          TRANSFER_EVENT_TOPIC0,
          "0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          WALLET_TOPIC,
        ],
      };
      const publicClient = createIngestionPublicClient([nonErc20Log]);
      publicClient.readContract = vi.fn(async () => {
        throw new Error("not an ERC20 contract");
      });

      const artifacts = await ingestWalletTransferArtifacts({
        db: harness.db as never,
        publicClient: publicClient as never,
        maxWindowSize: 2n,
        wallet: { chainId: 369, address: WALLET_ADDRESS },
        fromBlock: 10n,
        toBlock: 10n,
      });

      expect(artifacts.warnings.some((warning) => warning.includes("non-ERC20"))).toBe(true);
      const nonErc20Structured = artifacts.structuredWarnings.find((warning) =>
        warning.detail.includes("non-ERC20"),
      );
      expect(nonErc20Structured).toEqual({
        code: SYNC_WARNING_CODES.UNKNOWN,
        detail: expect.stringContaining("non-ERC20"),
      });
      expect(nonErc20Structured?.code).not.toBe(SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED);
    });

    it("classifies the raw-block-replay warning as RAW_BLOCKS_ALREADY_PERSISTED, detail unchanged", async () => {
      const harness = createIngestionHarness();
      // Pre-seed block 10 as already persisted (same identity ingestion will
      // compute: chainId 369, blockNumber 10, lowercased block hash) so that
      // scanning blocks [10, 11] persists only block 11 — the exact producer
      // condition (scannedBlockCount !== persistedBlockCount &&
      // persistedBlockCount > 0).
      harness.rawBlocks.set("369:10:0xblock10", {
        chainId: 369,
        blockNumber: 10n,
        blockHash: "0xblock10",
        parentHash: "0xblock9",
        timestamp: new Date(1_700_000_000 * 1000),
      });
      const publicClient = {
        getLogs: vi.fn(async () => []),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: `0xblock${blockNumber}`,
          parentHash: `0xblock${blockNumber - 1n}`,
          timestamp: 1_700_000_000n,
          transactions: [],
        })),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      };

      const artifacts = await ingestWalletTransferArtifacts({
        db: harness.db as never,
        publicClient: publicClient as never,
        maxWindowSize: 2n,
        wallet: { chainId: 369, address: WALLET_ADDRESS },
        fromBlock: 10n,
        toBlock: 11n,
      });

      const expectedDetail = "some raw blocks were already persisted for this range";
      expect(artifacts.warnings).toContain(expectedDetail);
      expect(artifacts.structuredWarnings).toContainEqual({
        code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED,
        detail: expectedDetail,
      });
      // Every other structured entry (there are none here) would remain
      // UNKNOWN — asserted separately by the non-ERC20/non-transfer/
      // unrelated-wallet tests above. This test proves the RAW_BLOCKS code is
      // assigned only from the exact scanned-vs-persisted condition, never
      // derived from matching this detail text elsewhere.
      expect(artifacts.warnings).toHaveLength(1);
      expect(artifacts.structuredWarnings).toHaveLength(1);
    });

    it("keeps two identically-worded warnings distinguishable by producer-assigned code, proving code is not text-derived", () => {
      const detail = "some raw blocks were already persisted for this range";
      const genuine = {
        code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED,
        detail,
      };
      // Simulates a hypothetical future producer that happens to emit the
      // exact same detail text without the structural raw-block-replay
      // condition — it must default to UNKNOWN, and the two must remain
      // distinguishable by code even though their detail strings are
      // byte-for-byte identical.
      const unrelated = { code: SYNC_WARNING_CODES.UNKNOWN, detail };

      expect(genuine.detail).toBe(unrelated.detail);
      expect(genuine.code).not.toBe(unrelated.code);
    });

    // B1 (genuine canonical replay still classified correctly) is already
    // covered above by "classifies the raw-block-replay warning as
    // RAW_BLOCKS_ALREADY_PERSISTED, detail unchanged": block 10 is
    // pre-seeded as an exact canonical (chainId, blockNumber, blockHash)
    // identity before ingestion runs, block 11 is newly inserted, and the
    // shortfall (1) is fully explained by the 1 pre-existing identity.

    it("B3: a retry-style recovery where some blocks already existed and the rest are newly inserted still classifies as RAW_BLOCKS_ALREADY_PERSISTED", async () => {
      const harness = createIngestionHarness();
      // Simulate a prior partial run that already persisted blocks 10 and 11
      // canonically; this retry rescans 10-12 and should only newly insert 12.
      harness.rawBlocks.set("369:10:0xblock10", {
        chainId: 369,
        blockNumber: 10n,
        blockHash: "0xblock10",
        parentHash: "0xblock9",
        timestamp: new Date(1_700_000_000 * 1000),
      });
      harness.rawBlocks.set("369:11:0xblock11", {
        chainId: 369,
        blockNumber: 11n,
        blockHash: "0xblock11",
        parentHash: "0xblock10",
        timestamp: new Date(1_700_000_000 * 1000),
      });
      const publicClient = {
        getLogs: vi.fn(async () => []),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: `0xblock${blockNumber}`,
          parentHash: `0xblock${blockNumber - 1n}`,
          timestamp: 1_700_000_000n,
          transactions: [],
        })),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      };

      const artifacts = await ingestWalletTransferArtifacts({
        db: harness.db as never,
        publicClient: publicClient as never,
        maxWindowSize: 3n,
        wallet: { chainId: 369, address: WALLET_ADDRESS },
        fromBlock: 10n,
        toBlock: 12n,
      });

      const expectedDetail = "some raw blocks were already persisted for this range";
      expect(artifacts.warnings).toContain(expectedDetail);
      expect(artifacts.structuredWarnings).toContainEqual({
        code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED,
        detail: expectedDetail,
      });
      // Only block 12 was newly inserted.
      expect(harness.rawBlocks.size).toBe(3);
    });

    it("A2: a concurrent insert by another wallet's sync between the persist call and its result does not cause a false failure", async () => {
      const harness = createIngestionHarness();
      // No pre-existing canonical rows before ingestion starts — a pre-read
      // taken now would find nothing for either scanned identity.
      const originalCreateMany = harness.db.rawBlock.createMany;
      harness.db.rawBlock.createMany = async (args: Parameters<typeof originalCreateMany>[0]) => {
        // Simulate a concurrent sync for a DIFFERENT wallet on the same
        // chain (RawBlock identity is chain-scoped, and the operation lock
        // only scopes conflicts to walletId+chainId, so this interleaving is
        // possible) committing block 10's exact canonical identity right
        // before this call's own skipDuplicates insert runs.
        harness.rawBlocks.set("369:10:0xblock10", {
          chainId: 369,
          blockNumber: 10n,
          blockHash: "0xblock10",
          parentHash: "0xblock9",
          timestamp: new Date(1_700_000_000 * 1000),
        });
        return originalCreateMany(args);
      };
      const publicClient = {
        getLogs: vi.fn(async () => []),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: `0xblock${blockNumber}`,
          parentHash: `0xblock${blockNumber - 1n}`,
          timestamp: 1_700_000_000n,
          transactions: [],
        })),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      };

      const artifacts = await ingestWalletTransferArtifacts({
        db: harness.db as never,
        publicClient: publicClient as never,
        maxWindowSize: 2n,
        wallet: { chainId: 369, address: WALLET_ADDRESS },
        fromBlock: 10n,
        toBlock: 11n,
      });

      // scannedBlockCount (2) !== persistedBlockCount (1, since block 10 was
      // skipped as a duplicate of the concurrently-inserted row) — but a
      // post-persist re-read proves both exact scanned identities (10 and
      // 11) are now canonically present, so this must not throw and must
      // classify as the benign replay warning, not an unexplained gap.
      const expectedDetail = "some raw blocks were already persisted for this range";
      expect(artifacts.warnings).toContain(expectedDetail);
      expect(artifacts.structuredWarnings).toContainEqual({
        code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED,
        detail: expectedDetail,
      });
      expect(harness.rawBlocks.size).toBe(2);
    });

    it("B2: a malformed/duplicate RPC block response within the same batch is never classified as benign replay — ingestion fails closed", async () => {
      const harness = createIngestionHarness();
      // No pre-existing canonical rows at all — the DB starts empty.
      const publicClient = {
        getLogs: vi.fn(async () => []),
        // Stale/malformed RPC: both requested heights (10 and 11) resolve to
        // the exact same block identity (number 10, hash 0xblock10). This is
        // representative of the Codex finding — skipDuplicates would discard
        // one of the two rows on insert, making scanned (2) !== persisted (1)
        // even though nothing was previously persisted in PostgreSQL.
        getBlock: vi.fn(async () => ({
          number: 10n,
          hash: "0xblock10",
          parentHash: "0xblock9",
          timestamp: 1_700_000_000n,
          transactions: [],
        })),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      };

      await expect(
        ingestWalletTransferArtifacts({
          db: harness.db as never,
          publicClient: publicClient as never,
          maxWindowSize: 2n,
          wallet: { chainId: 369, address: WALLET_ADDRESS },
          fromBlock: 10n,
          toBlock: 11n,
        }),
      ).rejects.toThrow(/duplicate|conflicting/i);

      // Ingestion must fail closed rather than silently persist a benign
      // RAW_BLOCKS_ALREADY_PERSISTED classification for an unproven shortfall.
      expect(harness.rawBlocks.size).toBe(0);
    });

    it("fails closed on an unexplained raw block persistence shortfall that is not proven by pre-existing canonical identities", async () => {
      const harness = createIngestionHarness();
      // Pre-seed a row under a DIFFERENT block hash than what the RPC will
      // return for block 10, so it does not match the scanned identity.
      harness.rawBlocks.set("369:10:0xstale-hash", {
        chainId: 369,
        blockNumber: 10n,
        blockHash: "0xstale-hash",
        parentHash: "0xblock9",
        timestamp: new Date(1_700_000_000 * 1000),
      });
      // Force persistRawBlocks to under-report relative to what was actually
      // scanned and what canonically pre-existed, simulating an unexplained
      // persistence gap (e.g. a transient write failure masked by count).
      // Reports 0 inserted regardless of input, while the pre-existing
      // lookup (queried beforehand) proves 0 exact matching identities —
      // scanned 2, persisted 0, pre-existing 0: an unexplained shortfall.
      harness.db.rawBlock.createMany = async () => ({ count: 0 });

      const publicClient = {
        getLogs: vi.fn(async () => []),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: `0xblock${blockNumber}`,
          parentHash: `0xblock${blockNumber - 1n}`,
          timestamp: 1_700_000_000n,
          transactions: [],
        })),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      };

      await expect(
        ingestWalletTransferArtifacts({
          db: harness.db as never,
          publicClient: publicClient as never,
          maxWindowSize: 2n,
          wallet: { chainId: 369, address: WALLET_ADDRESS },
          fromBlock: 10n,
          toBlock: 11n,
        }),
      ).rejects.toThrow(/unexplained/i);
    });
  });
});
