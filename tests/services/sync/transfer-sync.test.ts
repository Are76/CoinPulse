import { describe, expect, it, vi } from "vitest";

import { readWalletTransferRawTokenTransfers } from "@/services/ingestion/raw-store";
import { runWalletSync } from "@/services/sync/sync-orchestrator";
import {
  createSyncDependencies,
  TRANSFER_EVENT_TOPIC0,
} from "@/services/sync/transfer-sync";

function createMemoryStores() {
  const rawLogs = new Map<string, {
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
  }>();
  const rawBlocks = new Map<string, {
    chainId: number;
    blockNumber: bigint;
    blockHash: string;
    parentHash: string;
    timestamp: Date;
  }>();
  const rawTokenTransfers = new Map<string, {
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
  }>();
  const rawTransactions = new Map<string, {
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
  }>();
  const tokens = new Map<string, {
    id: string;
    assetId: string;
    addressLower: string;
    decimals: number;
    symbol: string;
    name: string;
  }>();
  const ledgerActionGroups = new Map<string, unknown>();
  const ledgerEntries = new Map<string, unknown>();
  const cursors = new Map<string, {
    fromBlock: bigint;
    toBlock: bigint;
    blockHash: string | null;
  }>();
  const runs: Array<Record<string, unknown>> = [];

  const db = {
    rawLog: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          transactionId: string | null;
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
              transactionId: item.transactionId,
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
          topic0?: string;
          OR?: Array<{ topic1?: string; topic2?: string }>;
        };
        orderBy: Array<{ blockNumber: "asc" } | { logIndex: "asc" }>;
      }) {
        const topic1 = args.where.OR?.[0]?.topic1;
        const topic2 = args.where.OR?.[1]?.topic2;
        return Array.from(rawLogs.values())
          .filter(
            (item) =>
              item.chainId === args.where.chainId &&
              item.status === args.where.status &&
              item.blockNumber >= args.where.blockNumber.gte &&
              item.blockNumber <= args.where.blockNumber.lte &&
              (!args.where.topic0 || item.topic0 === args.where.topic0) &&
              (!topic1 || item.topic1 === topic1 || item.topic2 === topic2),
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? left.logIndex - right.logIndex
              : Number(left.blockNumber - right.blockNumber),
          );
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
        const fromAddress = args.where.OR?.[0]?.fromAddress;
        const toAddress = args.where.OR?.[1]?.toAddress;
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
              ? left.logIndex - right.logIndex
              : Number(left.blockNumber - right.blockNumber),
          );
      },
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
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          OR: Array<{ fromAddress?: string; toAddress?: string }>;
        };
      }) {
        const fromAddress = args.where.OR?.[0]?.fromAddress;
        const toAddress = args.where.OR?.[1]?.toAddress;
        return Array.from(rawTransactions.values())
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
              ? left.transactionIndex - right.transactionIndex
              : Number(left.blockNumber - right.blockNumber),
          );
      },
    },
    rawDexSwap: {
      async findMany() {
        return [];
      },
    },
    rawLpAction: {
      async findMany() {
        return [];
      },
    },
    rawStakeAction: {
      async findMany() {
        return [];
      },
    },
    token: {
      async findUnique(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } } }) {
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
      async upsert() {
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
      async createMany(args: { data: Array<{ id: string }> }) {
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
        runs.push({ id: `run_${runs.length + 1}`, ...args.data });
        return { id: `run_${runs.length}` };
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        runs.push({ runId: args.where.id, ...args.data });
        return undefined;
      },
    },
    syncCursor: {
      async findUnique(args: { where: { walletId_chainId_sourceFamily: { walletId: string; chainId: number; sourceFamily: string } } }) {
        return (
          cursors.get(
            `${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`,
          ) ?? null
        );
      },
      async create(args: { data: { walletId: string; chainId: number; sourceFamily: string; fromBlock: bigint; toBlock: bigint; blockHash: string | null } }) {
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
      async update(args: { where: { walletId_chainId_sourceFamily: { walletId: string; chainId: number; sourceFamily: string } }; data: { fromBlock: bigint; toBlock: bigint; blockHash: string | null } }) {
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
    rawLogs,
    rawBlocks,
    rawTokenTransfers,
    rawTransactions,
    tokens,
    ledgerActionGroups,
    ledgerEntries,
    cursors,
    runs,
  };
}

describe("transfer sync flow", () => {
  it("reruns the same range without duplicating raw logs, action groups, or ledger entries", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const publicClient = {
      getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
        const outgoing = args.topics?.[1] === walletTopic;
        return outgoing
          ? [
              {
                address: "0x2222222222222222222222222222222222222222",
                blockHash: "0xblock1",
                blockNumber: 10n,
                data: "0x0000000000000000000000000000000000000000000000000000000000000005",
                logIndex: 0,
                transactionHash: "0xtx1",
                topics: [
                  TRANSFER_EVENT_TOPIC0,
                  walletTopic,
                  "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ],
              },
            ]
          : [
              {
                address: "0x2222222222222222222222222222222222222222",
                blockHash: "0xblock2",
                blockNumber: 11n,
                data: "0x0000000000000000000000000000000000000000000000000000000000000007",
                logIndex: 1,
                transactionHash: "0xtx2",
                topics: [
                  TRANSFER_EVENT_TOPIC0,
                  "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  walletTopic,
                ],
              },
            ];
      }),
      getBlock: vi.fn(
        async ({
          blockNumber,
          includeTransactions,
        }: {
          blockNumber: bigint;
          includeTransactions?: boolean;
        }) => ({
          number: blockNumber,
          hash: blockNumber === 10n ? "0xblock1" : "0xblock2",
          parentHash: blockNumber === 10n ? "0xparent0" : "0xblock1",
          timestamp: blockNumber === 10n ? 1_700_000_000n : 1_700_000_100n,
          ...(includeTransactions
            ? {
                transactions:
                  blockNumber === 10n
                    ? [
                        {
                          hash: "0xtx1",
                          blockHash: "0xblock1",
                          blockNumber: 10n,
                          transactionIndex: 0,
                          from: walletAddress,
                          to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          value: 0n,
                          gasPrice: 2_000_000_000n,
                          input: "0xa9059cbb",
                        },
                      ]
                    : [
                        {
                          hash: "0xtx2",
                          blockHash: "0xblock2",
                          blockNumber: 11n,
                          transactionIndex: 1,
                          from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          to: walletAddress,
                          value: 0n,
                          gasPrice: 2_000_000_000n,
                          input: "0x",
                        },
                      ],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") {
          return 0;
        }
        if (functionName === "symbol") {
          return "TOK";
        }
        return "Token";
      }),
      getTransaction: vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
        hash,
        blockHash: hash === "0xtx1" ? "0xblock1" : "0xblock2",
        blockNumber: hash === "0xtx1" ? 10n : 11n,
        transactionIndex: hash === "0xtx1" ? 0 : 1,
        from: walletAddress,
        to:
          hash === "0xtx1"
            ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: 0n,
        gasPrice: 2_000_000_000n,
        input: "0x",
      })),
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
        transactionHash: hash,
        blockHash: hash === "0xtx1" ? "0xblock1" : "0xblock2",
        blockNumber: hash === "0xtx1" ? 10n : 11n,
        gasUsed: hash === "0xtx1" ? 21_000n : 42_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    const first = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 10n,
      endBlock: 11n,
      policyLabel: "rerun-proof",
      dependencies,
    });

    const second = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 10n,
      endBlock: 11n,
      policyLabel: "rerun-proof",
      dependencies,
    });

    expect(first.counts).toEqual({
      rawLogs: 2,
      actionGroups: 3,
      ledgerEntries: 3,
    });
    expect(second.counts).toEqual({
      rawLogs: 0,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(stores.rawTransactions.size).toBe(2);
    expect(stores.rawLogs.size).toBe(2);
    expect(stores.rawTokenTransfers.size).toBe(2);
    expect(stores.ledgerActionGroups.size).toBe(3);
    expect(stores.ledgerEntries.size).toBe(3);
  });

  it("stores the cursor hash for the requested high-water block even when that block had no transfer log", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const publicClient = {
      getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
        const outgoing = args.topics?.[1] === walletTopic;
        return outgoing
          ? [
              {
                address: "0x2222222222222222222222222222222222222222",
                blockHash: "0xblock10",
                blockNumber: 10n,
                data: "0x0000000000000000000000000000000000000000000000000000000000000005",
                logIndex: 0,
                transactionHash: "0xtx1",
                topics: [
                  TRANSFER_EVENT_TOPIC0,
                  walletTopic,
                  "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ],
              },
            ]
          : [];
      }),
      getBlock: vi.fn(
        async ({
          blockNumber,
          includeTransactions,
        }: {
          blockNumber: bigint;
          includeTransactions?: boolean;
        }) => ({
          number: blockNumber,
          hash:
            blockNumber === 10n
              ? "0xblock10"
              : blockNumber === 12n
                ? "0xblock12"
                : "0xblock11",
          parentHash: blockNumber === 10n ? "0xparent9" : "0xblock10",
          timestamp: 1_700_000_000n + blockNumber,
          ...(includeTransactions
            ? {
                transactions:
                  blockNumber === 10n
                    ? [
                        {
                          hash: "0xtx1",
                          blockHash: "0xblock10",
                          blockNumber: 10n,
                          transactionIndex: 0,
                          from: walletAddress,
                          to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          value: 0n,
                          gasPrice: 2_000_000_000n,
                          input: "0xa9059cbb",
                        },
                      ]
                    : [],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") {
          return 0;
        }
        if (functionName === "symbol") {
          return "TOK";
        }
        return "Token";
      }),
      getTransaction: vi.fn(async () => ({
        hash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        transactionIndex: 0,
        from: walletAddress,
        to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        value: 0n,
        gasPrice: 2_000_000_000n,
        input: "0x",
      })),
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 10n,
      endBlock: 12n,
      policyLabel: "high-water-hash",
      dependencies,
    });

    expect(stores.cursors.get("wallet_1:369:TRANSFERS")).toEqual({
      fromBlock: 10n,
      toBlock: 12n,
      blockHash: "0xblock12",
    });
  });

  it("normalizes from persisted raw transfer snapshots even if the token row changes later", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const publicClient = {
      getLogs: vi.fn(async () => [
        {
          address: "0x2222222222222222222222222222222222222222",
          blockHash: "0xblock1",
          blockNumber: 10n,
          data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
          logIndex: 0,
          transactionHash: "0xtx1",
          topics: [
            TRANSFER_EVENT_TOPIC0,
            walletTopic,
            "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        },
      ]),
      getBlock: vi.fn(
        async ({
          blockNumber,
          includeTransactions,
        }: {
          blockNumber: bigint;
          includeTransactions?: boolean;
        }) => ({
          number: blockNumber,
          hash: "0xblock1",
          parentHash: "0xparent0",
          timestamp: 1_700_000_000n,
          ...(includeTransactions
            ? {
                transactions: [
                  {
                    hash: "0xtx1",
                    blockHash: "0xblock1",
                    blockNumber: 10n,
                    transactionIndex: 0,
                    from: walletAddress,
                    to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    value: 0n,
                    gasPrice: 2_000_000_000n,
                    input: "0xa9059cbb",
                  },
                ],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") {
          return 6;
        }
        if (functionName === "symbol") {
          return "TOK";
        }
        return "Token";
      }),
      getTransaction: vi.fn(async () => ({
        hash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        transactionIndex: 0,
        from: walletAddress,
        to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        value: 0n,
        gasPrice: 2_000_000_000n,
        input: "0x",
      })),
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 10n,
      endBlock: 10n,
      policyLabel: "snapshot-regression",
      dependencies,
    });

    const tokenKey = "369:0x2222222222222222222222222222222222222222";
    const mutated = stores.tokens.get(tokenKey);
    if (!mutated) {
      throw new Error("expected token metadata to be persisted");
    }
    stores.tokens.set(tokenKey, {
      ...mutated,
      assetId: "chain:369:erc20:0xmutated",
      decimals: 18,
    });

    const persistedTransfers = await readWalletTransferRawTokenTransfers(
      {
        chainId: 369,
        walletAddress,
        fromBlock: 10n,
        toBlock: 10n,
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
      sourceFamily: "TRANSFERS",
      rawLogs: persistedTransfers.map((transfer) => ({
        ...transfer,
        occurredAt: new Date("2023-11-14T22:13:20.000Z"),
      })),
      fromBlock: 10n,
      toBlock: 10n,
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
      quantity: "5",
    });
  });

  it("fails explicitly when a persisted raw transfer block timestamp is missing", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const publicClient = {
      getLogs: vi.fn(async () => [
        {
          address: "0x2222222222222222222222222222222222222222",
          blockHash: "0xblock1",
          blockNumber: 10n,
          data: "0x0000000000000000000000000000000000000000000000000000000000000005",
          logIndex: 0,
          transactionHash: "0xtx1",
          topics: [
            TRANSFER_EVENT_TOPIC0,
            walletTopic,
            "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        },
      ]),
      getBlock: vi.fn(
        async ({
          blockNumber,
          includeTransactions,
        }: {
          blockNumber: bigint;
          includeTransactions?: boolean;
        }) => ({
          number: blockNumber,
          hash: "0xblock1",
          parentHash: "0xparent0",
          timestamp: 1_700_000_000n,
          ...(includeTransactions
            ? {
                transactions: [
                  {
                    hash: "0xtx1",
                    blockHash: "0xblock1",
                    blockNumber: 10n,
                    transactionIndex: 0,
                    from: walletAddress,
                    to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    value: 0n,
                    gasPrice: 2_000_000_000n,
                    input: "0xa9059cbb",
                  },
                ],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") {
          return 0;
        }
        if (functionName === "symbol") {
          return "TOK";
        }
        return "Token";
      }),
      getTransaction: vi.fn(async () => ({
        hash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        transactionIndex: 0,
        from: walletAddress,
        to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        value: 0n,
        gasPrice: 2_000_000_000n,
        input: "0x",
      })),
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xtx1",
        blockHash: "0xblock1",
        blockNumber: 10n,
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const originalFindMany = stores.db.rawBlock.findMany;
    stores.db.rawBlock.findMany = async () => [];

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: walletAddress,
        },
        sourceFamilies: ["TRANSFERS"],
        startBlock: 10n,
        endBlock: 10n,
        policyLabel: "missing-timestamp",
        dependencies,
      }),
    ).rejects.toThrow("Missing raw block timestamp for transfer 0xtx1 at 10:0xblock1");

    stores.db.rawBlock.findMany = originalFindMany;
  });

  it("normalizes persisted native sends, receives, and sender gas fees from raw transactions without ERC20 logs", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const publicClient = {
      getLogs: vi.fn(async () => []),
      getBlock: vi.fn(
        async ({
          blockNumber,
          includeTransactions,
        }: {
          blockNumber: bigint;
          includeTransactions?: boolean;
        }) => ({
          number: blockNumber,
          hash: blockNumber === 20n ? "0xblock20" : "0xblock21",
          parentHash: blockNumber === 20n ? "0xparent19" : "0xblock20",
          timestamp: blockNumber === 20n ? 1_700_000_200n : 1_700_000_300n,
          ...(includeTransactions
            ? {
                transactions:
                  blockNumber === 20n
                    ? [
                        {
                          hash: "0xnative-send",
                          blockHash: "0xblock20",
                          blockNumber: 20n,
                          transactionIndex: 0,
                          from: walletAddress,
                          to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          value: 1_000_000_000_000_000_000n,
                          gasPrice: 2_000_000_000n,
                          input: "0x",
                        },
                      ]
                    : [
                        {
                          hash: "0xnative-receive",
                          blockHash: "0xblock21",
                          blockNumber: 21n,
                          transactionIndex: 0,
                          from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                          to: walletAddress,
                          value: 250_000_000_000_000_000n,
                          gasPrice: 2_000_000_000n,
                          input: "0x",
                        },
                      ],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(),
      getTransaction: vi.fn(),
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
        transactionHash: hash,
        blockHash: hash === "0xnative-send" ? "0xblock20" : "0xblock21",
        blockNumber: hash === "0xnative-send" ? 20n : 21n,
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    const result = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: walletAddress,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 20n,
      endBlock: 21n,
      policyLabel: "native-transfer",
      dependencies,
    });

    expect(result.counts).toEqual({
      rawLogs: 0,
      actionGroups: 2,
      ledgerEntries: 3,
    });
    expect(stores.rawTransactions.size).toBe(2);
    expect(Array.from(stores.ledgerEntries.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txHash: "0xnative-send",
          entryType: "SEND",
          assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
          quantity: "1",
        }),
        expect.objectContaining({
          txHash: "0xnative-send",
          entryType: "FEE",
          assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
          quantity: "0.000042",
        }),
        expect.objectContaining({
          txHash: "0xnative-receive",
          entryType: "RECEIVE",
          assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
          quantity: "0.25",
        }),
      ]),
    );
  });

  it("preserves native normalization output and cursor metadata across smaller native scan windows", async () => {
    const walletAddress = "0x1111111111111111111111111111111111111111";

    function createPublicClient() {
      return {
        getLogs: vi.fn(async () => []),
        getBlock: vi.fn(
          async ({
            blockNumber,
            includeTransactions,
          }: {
            blockNumber: bigint;
            includeTransactions?: boolean;
          }) => ({
            number: blockNumber,
            hash: `0xblock${blockNumber}`,
            parentHash: blockNumber === 30n ? "0xparent29" : `0xblock${blockNumber - 1n}`,
            timestamp: 1_700_000_000n + blockNumber,
            ...(includeTransactions
              ? {
                  transactions:
                    blockNumber === 30n
                      ? [
                          {
                            hash: "0xnative-send-windowed",
                            blockHash: "0xblock30",
                            blockNumber: 30n,
                            transactionIndex: 0,
                            from: walletAddress,
                            to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            value: 1_000_000_000_000_000_000n,
                            gasPrice: 2_000_000_000n,
                            input: "0x",
                          },
                        ]
                      : blockNumber === 34n
                        ? [
                            {
                              hash: "0xnative-receive-windowed",
                              blockHash: "0xblock34",
                              blockNumber: 34n,
                              transactionIndex: 0,
                              from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                              to: walletAddress,
                              value: 500_000_000_000_000_000n,
                              gasPrice: 2_000_000_000n,
                              input: "0x",
                            },
                          ]
                        : [],
                }
              : {}),
          }),
        ),
        readContract: vi.fn(),
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
          transactionHash: hash,
          blockHash:
            hash === "0xnative-send-windowed" ? "0xblock30" : "0xblock34",
          blockNumber: hash === "0xnative-send-windowed" ? 30n : 34n,
          gasUsed: 21_000n,
          effectiveGasPrice: 2_000_000_000n,
          logs: [],
        })),
      };
    }

    async function runWithMaxWindowSize(maxWindowSize: bigint) {
      const stores = createMemoryStores();
      const publicClient = createPublicClient();
      const dependencies = createSyncDependencies({
        db: stores.db as never,
        publicClient: publicClient as never,
        maxWindowSize,
      });

      const result = await runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: walletAddress,
        },
        sourceFamilies: ["TRANSFERS"],
        startBlock: 30n,
        endBlock: 34n,
        policyLabel: "native-windowing",
        dependencies,
      });

      return {
        result,
        publicClient,
        cursor: stores.cursors.get("wallet_1:369:TRANSFERS"),
        rawBlocks: Array.from(stores.rawBlocks.values())
          .map((block) => ({
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
            parentHash: block.parentHash,
          }))
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? left.blockHash.localeCompare(right.blockHash)
              : Number(left.blockNumber - right.blockNumber),
          ),
        rawTransactions: Array.from(stores.rawTransactions.values())
          .map((transaction) => ({
            txHash: transaction.txHash,
            blockNumber: transaction.blockNumber,
            blockHash: transaction.blockHash,
            transactionIndex: transaction.transactionIndex,
            fromAddress: transaction.fromAddress,
            toAddress: transaction.toAddress,
            valueRaw: transaction.valueRaw,
            gasPriceRaw: transaction.gasPriceRaw,
            gasUsedRaw: transaction.gasUsedRaw,
          }))
          .sort((left, right) =>
            left.txHash === right.txHash
              ? left.transactionIndex - right.transactionIndex
              : left.txHash.localeCompare(right.txHash),
          ),
        ledgerEntries: Array.from(stores.ledgerEntries.values())
          .map((entry) => ({
            txHash: (entry as { txHash: string }).txHash,
            entryType: (entry as { entryType: string }).entryType,
            assetId: (entry as { assetId: string }).assetId,
            quantity: (entry as { quantity: string }).quantity,
          }))
          .sort((left, right) =>
            left.txHash === right.txHash
              ? left.entryType.localeCompare(right.entryType)
              : left.txHash.localeCompare(right.txHash),
          ),
      };
    }

    const wideWindow = await runWithMaxWindowSize(10n);
    const narrowWindow = await runWithMaxWindowSize(2n);

    expect(wideWindow.result.counts).toEqual(narrowWindow.result.counts);
    expect(wideWindow.rawBlocks).toEqual(narrowWindow.rawBlocks);
    expect(wideWindow.rawTransactions).toEqual(narrowWindow.rawTransactions);
    expect(wideWindow.ledgerEntries).toEqual(narrowWindow.ledgerEntries);
    expect(wideWindow.cursor).toEqual({
      fromBlock: 30n,
      toBlock: 34n,
      blockHash: "0xblock34",
    });
    expect(narrowWindow.cursor).toEqual(wideWindow.cursor);
    expect(narrowWindow.publicClient.getBlock.mock.calls).toHaveLength(5);
    expect(
      narrowWindow.publicClient.getBlock.mock.calls.map(
        ([args]: [{ blockNumber: bigint }]) => args.blockNumber,
      ),
    ).toEqual([30n, 31n, 32n, 33n, 34n]);
  });
});

describe("createSyncDependencies production client wiring", () => {
  // Deliberately does not mock createPublicClientForChain()/createDefaultSyncClients():
  // doing so would bypass the exact wiring bug this test guards against (the
  // production zero-arg path silently skipping withRawEthGetLogs). The only
  // external dependency is PULSECHAIN_RPC_URL, which tests/setup.ts always
  // sets via Vitest's setupFiles before this file is imported — so the real
  // client construction never needs a live network call, only the stubbed
  // fetch below.
  it("honors the raw eth_getLogs topics filter when no publicClient is injected", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";
    const capturedGetLogsTopics: unknown[] = [];

    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        id: number;
        method: string;
        params: unknown[];
      };

      if (body.method === "eth_getLogs") {
        const filter = body.params[0] as { topics?: unknown };
        capturedGetLogsTopics.push(filter.topics);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (body.method === "eth_getBlockByNumber") {
        const [blockNumberHex] = body.params as [string, boolean];
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              number: blockNumberHex,
              hash: "0xblock10",
              parentHash: "0xblock9",
              timestamp: "0x652b2c00",
              transactions: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`unexpected JSON-RPC method in test: ${body.method}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      // Zero-argument production path: mirrors sync-orchestrator's
      // createSyncDependencies() call with no injected publicClient. Only the
      // db is stubbed here; the publicClient must come from the real
      // createDefaultSyncClients() fallback (withRawEthGetLogs(createPublicClientForChain())).
      const dependencies = createSyncDependencies({ db: stores.db as never });

      await runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: walletAddress,
        },
        sourceFamilies: ["TRANSFERS"],
        startBlock: 10n,
        endBlock: 10n,
        policyLabel: "zero-arg-production-path",
        dependencies,
      });

      expect(capturedGetLogsTopics).toContainEqual([TRANSFER_EVENT_TOPIC0, null, walletTopic]);
      expect(capturedGetLogsTopics).toContainEqual([TRANSFER_EVENT_TOPIC0, walletTopic, null]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
