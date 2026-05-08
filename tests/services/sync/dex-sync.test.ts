import { describe, expect, it, vi } from "vitest";

import { readWalletDexSwapSnapshots } from "@/services/ingestion/raw-store";
import { runWalletSync } from "@/services/sync/sync-orchestrator";
import {
  createSyncDependencies,
  SWAP_EVENT_TOPIC0,
  TRANSFER_EVENT_TOPIC0,
} from "@/services/sync/transfer-sync";

type RawLogRecord = {
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
  transactionId: string | null;
  status: "ACTIVE";
};

type RawBlockRecord = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  parentHash: string;
  timestamp: Date;
};

type RawTokenTransferRecord = {
  chainId: number;
  tokenId: string;
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  status: "ACTIVE";
};

type RawTransactionRecord = {
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  valueRaw: string;
  gasPriceRaw: string | null;
  gasUsedRaw: string | null;
  status: "ACTIVE";
};

type RawDexSwapRecord = {
  chainId: number;
  protocolSlug: string;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  pairAddress: string;
  initiatorAddress: string;
  counterpartyAddress: string | null;
  soldTokenAddress: string;
  soldAssetIdSnapshot: string;
  soldDecimalsSnapshot: number;
  soldAmountRaw: string;
  boughtTokenAddress: string;
  boughtAssetIdSnapshot: string;
  boughtDecimalsSnapshot: number;
  boughtAmountRaw: string;
  feeAssetIdSnapshot: string;
  feeDecimalsSnapshot: number;
  feeAmountRaw: string;
  status: "ACTIVE";
};

type TokenRecord = {
  id: string;
  assetId: string;
  addressLower: string;
  decimals: number;
  symbol: string;
  name: string;
};

function createMemoryStores() {
  const rawLogs = new Map<string, RawLogRecord>();
  const rawBlocks = new Map<string, RawBlockRecord>();
  const rawTokenTransfers = new Map<string, RawTokenTransferRecord>();
  const rawTransactions = new Map<string, RawTransactionRecord>();
  const rawDexSwaps = new Map<string, RawDexSwapRecord>();
  const tokens = new Map<string, TokenRecord>();
  const tokenMetadataSources = new Map<string, Record<string, unknown>>();
  const ledgerActionGroups = new Map<string, Record<string, unknown>>();
  const ledgerEntries = new Map<string, Record<string, unknown>>();
  const cursors = new Map<
    string,
    { fromBlock: bigint; toBlock: bigint; blockHash: string | null }
  >();
  const runs: Array<Record<string, unknown>> = [];

  const db = {
    rawLog: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          transactionId?: string | null;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          logIndex: number;
          address: string;
          topic0: string | null;
          topic1: string | null;
          topic2: string | null;
          topic3: string | null;
          data: string;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
          if (!rawLogs.has(key)) {
            rawLogs.set(key, {
              ...item,
              transactionId: item.transactionId ?? null,
              status: "ACTIVE",
            });
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
      async findMany(args: {
        where: { chainId: number; blockNumber: { gte: bigint; lte: bigint } };
      }) {
        return Array.from(rawBlocks.values()).filter(
          (item) =>
            item.chainId === args.where.chainId &&
            item.blockNumber >= args.where.blockNumber.gte &&
            item.blockNumber <= args.where.blockNumber.lte,
        );
      },
    },
    rawTokenTransfer: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          tokenId: string;
          tokenAddress: string;
          assetIdSnapshot: string;
          decimalsSnapshot: number;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          logIndex: number;
          fromAddress: string;
          toAddress: string;
          amountRaw: string;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
          if (!rawTokenTransfers.has(key)) {
            rawTokenTransfers.set(key, {
              ...item,
              status: "ACTIVE",
            });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          OR: Array<{ fromAddress?: string; toAddress?: string }>;
        };
      }) {
        const fromAddress = args.where.OR[0]?.fromAddress;
        const toAddress = args.where.OR[1]?.toAddress;
        return Array.from(rawTokenTransfers.values())
          .filter(
            (item) =>
              item.chainId === args.where.chainId &&
              item.status === args.where.status &&
              item.blockNumber >= args.where.blockNumber.gte &&
              item.blockNumber <= args.where.blockNumber.lte &&
              (item.fromAddress === fromAddress || item.toAddress === toAddress),
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? Number(left.logIndex) - Number(right.logIndex)
              : Number(left.blockNumber - right.blockNumber),
          );
      },
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    rawTransaction: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          transactionIndex: number;
          fromAddress: string;
          toAddress: string | null;
          valueRaw: string;
          gasPriceRaw: string | null;
          gasUsedRaw: string | null;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.blockHash}`;
          if (!rawTransactions.has(key)) {
            rawTransactions.set(key, {
              ...item,
              status: "ACTIVE",
            });
            count += 1;
          }
        }
        return { count };
      },
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    rawDexSwap: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          protocolSlug: string;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          logIndex: number;
          pairAddress: string;
          initiatorAddress: string;
          counterpartyAddress: string | null;
          soldTokenAddress: string;
          soldAssetIdSnapshot: string;
          soldDecimalsSnapshot: number;
          soldAmountRaw: string;
          boughtTokenAddress: string;
          boughtAssetIdSnapshot: string;
          boughtDecimalsSnapshot: number;
          boughtAmountRaw: string;
          feeAssetIdSnapshot: string;
          feeDecimalsSnapshot: number;
          feeAmountRaw: string;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
          if (!rawDexSwaps.has(key)) {
            rawDexSwaps.set(key, {
              ...item,
              status: "ACTIVE",
            });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          initiatorAddress: string;
        };
      }) {
        return Array.from(rawDexSwaps.values())
          .filter(
            (item) =>
              item.chainId === args.where.chainId &&
              item.status === args.where.status &&
              item.initiatorAddress === args.where.initiatorAddress &&
              item.blockNumber >= args.where.blockNumber.gte &&
              item.blockNumber <= args.where.blockNumber.lte,
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? Number(left.logIndex) - Number(right.logIndex)
              : Number(left.blockNumber - right.blockNumber),
          );
      },
      updateMany: vi.fn(async () => ({ count: 0 })),
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
        create: {
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
        update: {
          symbol: string;
          name: string;
          decimals: number;
          decimalsSource: string;
        };
      }) {
        const key = `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`;
        const existing = tokens.get(key);
        const next = existing
          ? { ...existing, ...args.update }
          : {
              id: args.create.id,
              assetId: args.create.assetId,
              addressLower: args.create.addressLower,
              decimals: args.create.decimals,
              symbol: args.create.symbol,
              name: args.create.name,
            };
        tokens.set(key, next);
        return next;
      },
    },
    tokenMetadataSource: {
      async upsert(args: {
        where: { tokenId_sourceKind_sourceRef: { tokenId: string; sourceRef: string } };
        create: { tokenId: string; sourceRef: string };
      }) {
        tokenMetadataSources.set(
          `${args.where.tokenId_sourceKind_sourceRef.tokenId}:${args.where.tokenId_sourceKind_sourceRef.sourceRef}`,
          args.create,
        );
        return undefined;
      },
    },
    ledgerActionGroup: {
      async createMany(args: { data: Array<{ id: string }> }) {
        let count = 0;
        for (const item of args.data) {
          if (!ledgerActionGroups.has(item.id)) {
            ledgerActionGroups.set(item.id, item);
            count += 1;
          }
        }
        return { count };
      },
    },
    ledgerEntry: {
      async createMany(
        args: { data: Array<{ id: string; entryType: string; quantity: string; assetId: string }> },
      ) {
        let count = 0;
        for (const item of args.data) {
          if (!ledgerEntries.has(item.id)) {
            ledgerEntries.set(item.id, item);
            count += 1;
          }
        }
        return { count };
      },
    },
    syncRun: {
      async create(args: { data: Record<string, unknown>; select: { id: true } }) {
        const id = `run_${runs.length + 1}`;
        runs.push({ id, ...args.data });
        return { id };
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        runs.push({ runId: args.where.id, ...args.data });
        return undefined;
      },
    },
    syncCursor: {
      async findUnique(args: {
        where: {
          walletId_chainId_sourceFamily: {
            walletId: string;
            chainId: number;
            sourceFamily: string;
          };
        };
      }) {
        return (
          cursors.get(
            `${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`,
          ) ?? null
        );
      },
      async create(args: {
        data: {
          walletId: string;
          chainId: number;
          sourceFamily: string;
          fromBlock: bigint;
          toBlock: bigint;
          blockHash: string | null;
        };
      }) {
        cursors.set(
          `${args.data.walletId}:${args.data.chainId}:${args.data.sourceFamily}`,
          {
            fromBlock: args.data.fromBlock,
            toBlock: args.data.toBlock,
            blockHash: args.data.blockHash,
          },
        );
        return undefined;
      },
      async update(args: {
        where: {
          walletId_chainId_sourceFamily: {
            walletId: string;
            chainId: number;
            sourceFamily: string;
          };
        };
        data: { fromBlock: bigint; toBlock: bigint; blockHash: string | null };
      }) {
        cursors.set(
          `${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`,
          {
            fromBlock: args.data.fromBlock,
            toBlock: args.data.toBlock,
            blockHash: args.data.blockHash,
          },
        );
        return undefined;
      },
    },
    $transaction: async (input: unknown) => {
      if (typeof input === "function") {
        return input(db);
      }
      return input;
    },
  };

  return {
    db,
    rawDexSwaps,
    rawTransactions,
    ledgerActionGroups,
    ledgerEntries,
    cursors,
    tokens,
  };
}

function createHappyPathPublicClient(walletAddress: string) {
  const walletTopic =
    "0x0000000000000000000000001111111111111111111111111111111111111111";

  return {
    getLogs: vi.fn(
      async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
        const outgoing = args.topics?.[1] === walletTopic;

        return outgoing
          ? [
              {
                address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                blockHash: "0xblock100",
                blockNumber: 100n,
                data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
                logIndex: 3,
                transactionHash: "0xswaptx",
                topics: [
                  TRANSFER_EVENT_TOPIC0,
                  walletTopic,
                  "0x0000000000000000000000009999999999999999999999999999999999999999",
                ],
              },
            ]
          : [
              {
                address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                blockHash: "0xblock100",
                blockNumber: 100n,
                data: "0x000000000000000000000000000000000000000000000029a2241af62c0000",
                logIndex: 8,
                transactionHash: "0xswaptx",
                topics: [
                  TRANSFER_EVENT_TOPIC0,
                  "0x0000000000000000000000009999999999999999999999999999999999999999",
                  walletTopic,
                ],
              },
            ];
      },
    ),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock100",
      parentHash: "0xblock099",
      timestamp: 1_700_000_000n,
    })),
    readContract: vi.fn(async (args: { address: string; functionName: string }) => {
      if (args.address === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
        if (args.functionName === "decimals") {
          return 6;
        }
        if (args.functionName === "symbol") {
          return "USDC";
        }
        return "USD Coin";
      }

      if (args.functionName === "decimals") {
        return 18;
      }
      if (args.functionName === "symbol") {
        return "WPLS";
      }
      return "Wrapped Pulse";
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xswaptx",
      blockHash: "0xblock100",
      blockNumber: 100n,
      transactionIndex: 2,
      from: walletAddress,
      to: "0x7777777777777777777777777777777777777777",
      value: 0n,
      gasPrice: 2_000_000_000n,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xswaptx",
      blockHash: "0xblock100",
      blockNumber: 100n,
      gasUsed: 100_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [
        {
          address: "0x9999999999999999999999999999999999999999",
          blockHash: "0xblock100",
          blockNumber: 100n,
          logIndex: 5,
          transactionHash: "0xswaptx",
          topics: [
            SWAP_EVENT_TOPIC0,
            "0x0000000000000000000000007777777777777777777777777777777777777777",
            walletTopic,
          ],
          data: "0x",
        },
      ],
    })),
  };
}

describe("dex sync flow", () => {
  it("persists raw dex swap snapshots and canonical swap ledger rows idempotently", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createHappyPathPublicClient(walletAddress) as never,
    });

    const first = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["DEX"],
      startBlock: 100n,
      endBlock: 100n,
      policyLabel: "dex-swap",
      dependencies,
    });

    const second = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["DEX"],
      startBlock: 100n,
      endBlock: 100n,
      policyLabel: "dex-swap",
      dependencies,
    });

    expect(first.counts).toEqual({
      rawLogs: 3,
      actionGroups: 1,
      ledgerEntries: 3,
    });
    expect(second.counts).toEqual({
      rawLogs: 0,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(stores.rawTransactions.size).toBe(1);
    expect(stores.rawDexSwaps.size).toBe(1);
    expect(Array.from(stores.ledgerEntries.values()).map((entry) => entry.entryType)).toEqual([
      "SWAP_OUT",
      "SWAP_IN",
      "FEE",
    ]);
    expect(Array.from(stores.ledgerEntries.values()).map((entry) => entry.quantity)).toEqual([
      "5",
      "3",
      "0.0002",
    ]);
    expect(stores.cursors.get("wallet_1:369:DEX")).toEqual({
      fromBlock: 100n,
      toBlock: 100n,
      blockHash: "0xblock100",
    });
  });

  it("normalizes from persisted raw dex swap snapshots even if token rows mutate later", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createHappyPathPublicClient(walletAddress) as never,
    });

    await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["DEX"],
      startBlock: 100n,
      endBlock: 100n,
      policyLabel: "snapshot-regression",
      dependencies,
    });

    stores.tokens.set("369:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
      id: "mutated_1",
      assetId: "chain:369:erc20:0xmutated",
      addressLower: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      decimals: 18,
      symbol: "BROKEN",
      name: "Broken Token",
    });

    const rawSwaps = await readWalletDexSwapSnapshots(
      {
        chainId: 369,
        walletAddress,
        fromBlock: 100n,
        toBlock: 100n,
      },
      stores.db as never,
    );

    const normalized = await dependencies.normalizeSourceFamily({
      runId: "rerun_1",
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamily: "DEX",
      rawLogs: rawSwaps.map((swap) => ({
        ...swap,
        occurredAt: new Date("2023-11-14T22:13:20.000Z"),
      })),
      fromBlock: 100n,
      toBlock: 100n,
    });

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      assetId: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      quantity: "5",
    });
    expect(normalized[1]).toMatchObject({
      assetId: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      quantity: "3",
    });
  });

  it("warns deterministically and skips ambiguous wallet swap shapes", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: {
        getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
          const outgoing = args.topics?.[1] === walletTopic;

          return outgoing
            ? [
                {
                  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  blockHash: "0xblock101",
                  blockNumber: 101n,
                  data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
                  logIndex: 1,
                  transactionHash: "0xambiguous",
                  topics: [
                    TRANSFER_EVENT_TOPIC0,
                    walletTopic,
                    "0x0000000000000000000000009999999999999999999999999999999999999999",
                  ],
                },
                {
                  address: "0xcccccccccccccccccccccccccccccccccccccccc",
                  blockHash: "0xblock101",
                  blockNumber: 101n,
                  data: "0x000000000000000000000000000000000000000000000000000000000000000a",
                  logIndex: 2,
                  transactionHash: "0xambiguous",
                  topics: [
                    TRANSFER_EVENT_TOPIC0,
                    walletTopic,
                    "0x0000000000000000000000008888888888888888888888888888888888888888",
                  ],
                },
              ]
            : [
                {
                  address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  blockHash: "0xblock101",
                  blockNumber: 101n,
                  data: "0x000000000000000000000000000000000000000000000029a2241af62c0000",
                  logIndex: 8,
                  transactionHash: "0xambiguous",
                  topics: [
                    TRANSFER_EVENT_TOPIC0,
                    "0x0000000000000000000000009999999999999999999999999999999999999999",
                    walletTopic,
                  ],
                },
              ];
        }),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: "0xblock101",
          parentHash: "0xblock100",
          timestamp: 1_700_000_100n,
        })),
        readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
          if (functionName === "decimals") {
            return address === "0xcccccccccccccccccccccccccccccccccccccccc" ? 0 : 6;
          }
          if (functionName === "symbol") {
            return "TOK";
          }
          return "Token";
        }),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
      } as never,
    });

    const result = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["DEX"],
      startBlock: 101n,
      endBlock: 101n,
      policyLabel: "ambiguous-wallet-shape",
      dependencies,
    });

    expect(result.counts).toEqual({
      rawLogs: 3,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(result.warningCount).toBe(1);
    expect(stores.rawDexSwaps.size).toBe(0);
    expect(stores.ledgerEntries.size).toBe(0);
  });
});
