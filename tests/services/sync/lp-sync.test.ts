import { describe, expect, it, vi } from "vitest";

import { readWalletRawLpActions } from "@/services/ingestion/raw-store";
import { runWalletSync } from "@/services/sync/sync-orchestrator";
import { createSyncDependencies, TRANSFER_EVENT_TOPIC0 } from "@/services/sync/transfer-sync";

type RawLogRecord = {
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  address: string;
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
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
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

type RawLpActionRecord = {
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  initiatorAddress: string;
  status: "ACTIVE";
};

function createMemoryStores() {
  const rawLogs = new Map<string, RawLogRecord>();
  const rawBlocks = new Map<string, RawBlockRecord>();
  const rawTokenTransfers = new Map<string, RawTokenTransferRecord>();
  const rawTransactions = new Map<string, RawTransactionRecord>();
  const rawLpActions = new Map<string, RawLpActionRecord>();
  const tokens = new Map<string, Record<string, unknown>>();
  const tokenMetadataSources = new Map<string, Record<string, unknown>>();
  const ledgerActionGroups = new Map<string, Record<string, unknown>>();
  const ledgerEntries = new Map<string, Record<string, unknown>>();
  const cursors = new Map<string, { fromBlock: bigint; toBlock: bigint; blockHash: string | null }>();
  const runs: Array<Record<string, unknown>> = [];

  const db = {
    rawLog: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          logIndex: number;
          address: string;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
          if (!rawLogs.has(key)) {
            rawLogs.set(key, { ...item, status: "ACTIVE" });
            count += 1;
          }
        }
        return { count };
      },
    },
    rawBlock: {
      async createMany(args: { data: RawBlockRecord[] }) {
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
          txHash: string;
          blockNumber: bigint;
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
            rawTokenTransfers.set(key, { ...item, status: "ACTIVE" });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: { where: { chainId: number; status: "ACTIVE"; blockNumber: { gte: bigint; lte: bigint }; OR: Array<{ fromAddress?: string; toAddress?: string }> } }) {
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
            rawTransactions.set(key, { ...item, status: "ACTIVE" });
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
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    rawLpAction: {
      async createMany(args: {
        data: Array<{
          chainId: number;
          txHash: string;
          blockNumber: bigint;
          blockHash: string;
          logIndex: number;
          initiatorAddress: string;
        }>;
      }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.logIndex}:${item.blockHash}`;
          if (!rawLpActions.has(key)) {
            rawLpActions.set(key, { ...item, status: "ACTIVE" });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: { where: { chainId: number; status: "ACTIVE"; blockNumber: { gte: bigint; lte: bigint }; initiatorAddress: string } }) {
        return Array.from(rawLpActions.values())
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
    rawDexSwap: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    token: {
      async findUnique(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } } }) {
        return tokens.get(`${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`) ?? null;
      },
      async upsert(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const key = `${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`;
        const existing = tokens.get(key);
        const next = existing ? { ...existing, ...args.update } : {
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
      async upsert(args: { where: { tokenId_sourceKind_sourceRef: { tokenId: string; sourceRef: string } }; create: { tokenId: string; sourceRef: string } }) {
        tokenMetadataSources.set(`${args.where.tokenId_sourceKind_sourceRef.tokenId}:${args.where.tokenId_sourceKind_sourceRef.sourceRef}`, args.create);
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
      async createMany(args: { data: Array<{ id: string; entryType: string; quantity: string; assetId: string }> }) {
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
      async findUnique(args: { where: { walletId_chainId_sourceFamily: { walletId: string; chainId: number; sourceFamily: string } } }) {
        return cursors.get(`${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`) ?? null;
      },
      async create(args: { data: { walletId: string; chainId: number; sourceFamily: string; fromBlock: bigint; toBlock: bigint; blockHash: string | null } }) {
        cursors.set(`${args.data.walletId}:${args.data.chainId}:${args.data.sourceFamily}`, {
          fromBlock: args.data.fromBlock,
          toBlock: args.data.toBlock,
          blockHash: args.data.blockHash,
        });
        return undefined;
      },
      async update(args: { where: { walletId_chainId_sourceFamily: { walletId: string; chainId: number; sourceFamily: string } }; data: { fromBlock: bigint; toBlock: bigint; blockHash: string | null } }) {
        cursors.set(`${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`, {
          fromBlock: args.data.fromBlock,
          toBlock: args.data.toBlock,
          blockHash: args.data.blockHash,
        });
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
    rawLpActions,
    rawTransactions,
    ledgerEntries,
    cursors,
    tokens,
  };
}

function createAddPublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? [
            {
              address: "0xtoken0",
              blockHash: "0xblock120",
              blockNumber: 120n,
              data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
              logIndex: 1,
              transactionHash: "0xlpadd",
              topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            },
            {
              address: "0xtoken1",
              blockHash: "0xblock120",
              blockNumber: 120n,
              data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
              logIndex: 2,
              transactionHash: "0xlpadd",
              topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            },
          ]
        : [
            {
              address: "0xlp",
              blockHash: "0xblock120",
              blockNumber: 120n,
              data: "0x000000000000000000000000000000000000000000000000016345785d8a0000",
              logIndex: 5,
              transactionHash: "0xlpadd",
              topics: [TRANSFER_EVENT_TOPIC0, "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", walletTopic],
            },
          ];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock120",
      parentHash: "0xblock119",
      timestamp: 1_700_000_200n,
    })),
    readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      const metadata: Record<string, { decimals: number; symbol: string; name: string }> = {
        "0xtoken0": { decimals: 18, symbol: "T0", name: "Token 0" },
        "0xtoken1": { decimals: 6, symbol: "T1", name: "Token 1" },
        "0xlp": { decimals: 18, symbol: "LP", name: "LP Token" },
      };
      const token = metadata[address];
      if (functionName === "decimals") return token.decimals;
      if (functionName === "symbol") return token.symbol;
      return token.name;
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xlpadd",
      blockHash: "0xblock120",
      blockNumber: 120n,
      transactionIndex: 4,
      from: walletAddress,
      to: "0xrouter",
      value: 0n,
      gasPrice: 2_000_000_000n,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xlpadd",
      blockHash: "0xblock120",
      blockNumber: 120n,
      gasUsed: 150_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

function createRemovePublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? [
            {
              address: "0xlp",
              blockHash: "0xblock121",
              blockNumber: 121n,
              data: "0x000000000000000000000000000000000000000000000000016345785d8a0000",
              logIndex: 1,
              transactionHash: "0xlpremove",
              topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            },
          ]
        : [
            {
              address: "0xtoken0",
              blockHash: "0xblock121",
              blockNumber: 121n,
              data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
              logIndex: 4,
              transactionHash: "0xlpremove",
              topics: [TRANSFER_EVENT_TOPIC0, "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", walletTopic],
            },
            {
              address: "0xtoken1",
              blockHash: "0xblock121",
              blockNumber: 121n,
              data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
              logIndex: 5,
              transactionHash: "0xlpremove",
              topics: [TRANSFER_EVENT_TOPIC0, "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", walletTopic],
            },
          ];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock121",
      parentHash: "0xblock120",
      timestamp: 1_700_000_300n,
    })),
    readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      const metadata: Record<string, { decimals: number; symbol: string; name: string }> = {
        "0xtoken0": { decimals: 18, symbol: "T0", name: "Token 0" },
        "0xtoken1": { decimals: 6, symbol: "T1", name: "Token 1" },
        "0xlp": { decimals: 18, symbol: "LP", name: "LP Token" },
      };
      const token = metadata[address];
      if (functionName === "decimals") return token.decimals;
      if (functionName === "symbol") return token.symbol;
      return token.name;
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xlpremove",
      blockHash: "0xblock121",
      blockNumber: 121n,
      transactionIndex: 5,
      from: walletAddress,
      to: "0xrouter",
      value: 0n,
      gasPrice: 2_000_000_000n,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xlpremove",
      blockHash: "0xblock121",
      blockNumber: 121n,
      gasUsed: 160_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

describe("lp sync flow", () => {
  it("persists raw lp add snapshots and canonical lp add ledger rows idempotently", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createAddPublicClient(walletAddress) as never,
    });

    const first = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["LP"],
      startBlock: 120n,
      endBlock: 120n,
      policyLabel: "lp-add",
      dependencies,
    });

    const second = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["LP"],
      startBlock: 120n,
      endBlock: 120n,
      policyLabel: "lp-add",
      dependencies,
    });

    expect(first.counts).toEqual({
      rawLogs: 3,
      actionGroups: 1,
      ledgerEntries: 4,
    });
    expect(second.counts).toEqual({
      rawLogs: 0,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(stores.rawTransactions.size).toBe(1);
    expect(stores.rawLpActions.size).toBe(1);
  });

  it("normalizes from persisted raw lp snapshots even if token rows mutate later", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createRemovePublicClient(walletAddress) as never,
    });

    await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["LP"],
      startBlock: 121n,
      endBlock: 121n,
      policyLabel: "lp-remove",
      dependencies,
    });

    stores.tokens.set("369:0xlp", {
      id: "mutated_lp",
      assetId: "chain:369:erc20:0xmutated",
      addressLower: "0xlp",
      decimals: 8,
      symbol: "BROKEN",
      name: "Broken LP",
    });

    const rawActions = await readWalletRawLpActions({
      chainId: 369,
      walletAddress,
      fromBlock: 121n,
      toBlock: 121n,
    }, stores.db as never);

    const normalized = await dependencies.normalizeSourceFamily({
      runId: "rerun_1",
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamily: "LP",
      rawLogs: rawActions.map((action) => ({
        ...action,
        occurredAt: new Date("2023-11-14T22:13:20.000Z"),
      })),
      fromBlock: 121n,
      toBlock: 121n,
    });

    expect(normalized).toHaveLength(4);
    expect(normalized[0]).toMatchObject({
      entryType: "LP_REMOVE_OUT",
      assetId: "chain:369:erc20:0xlp",
    });
    expect(normalized[1]).toMatchObject({
      entryType: "LP_REMOVE_IN",
      assetId: "chain:369:erc20:0xtoken0",
    });
  });

  it("warns deterministically and skips ambiguous lp candidates", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: {
        getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
          const outgoing = args.topics?.[1] === walletTopic;
          return outgoing
            ? [
                {
                  address: "0xtoken0",
                  blockHash: "0xblock122",
                  blockNumber: 122n,
                  data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
                  logIndex: 1,
                  transactionHash: "0xlpambiguous",
                  topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                },
                {
                  address: "0xtoken1",
                  blockHash: "0xblock122",
                  blockNumber: 122n,
                  data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
                  logIndex: 2,
                  transactionHash: "0xlpambiguous",
                  topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                },
              ]
            : [];
        }),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: "0xblock122",
          parentHash: "0xblock121",
          timestamp: 1_700_000_400n,
        })),
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "decimals") return 18;
          if (functionName === "symbol") return "TOK";
          return "Token";
        }),
        getTransaction: vi.fn(async () => ({
          hash: "0xlpambiguous",
          blockHash: "0xblock122",
          blockNumber: 122n,
          transactionIndex: 0,
          from: walletAddress,
          to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          value: 0n,
          gasPrice: 2_000_000_000n,
          input: "0x",
        })),
        getTransactionReceipt: vi.fn(async () => ({
          transactionHash: "0xlpambiguous",
          blockHash: "0xblock122",
          blockNumber: 122n,
          gasUsed: 21_000n,
          effectiveGasPrice: 2_000_000_000n,
          logs: [],
        })),
      } as never,
    });

    const result = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["LP"],
      startBlock: 122n,
      endBlock: 122n,
      policyLabel: "lp-ambiguous",
      dependencies,
    });

    expect(result.counts).toEqual({
      rawLogs: 2,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(result.warningCount).toBe(1);
    expect(stores.rawLpActions.size).toBe(0);
    expect(stores.ledgerEntries.size).toBe(0);
  });
});
