import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";

import { PHEX_ADDRESS } from "@/config/assets";
import { repairFabricatedTokenTransfers } from "@/services/ingestion/fabricated-transfer-repair";
import { readWalletRawStakeActions } from "@/services/ingestion/raw-store";
import { runWalletSync } from "@/services/sync/sync-orchestrator";
import { createSyncDependencies, TRANSFER_EVENT_TOPIC0 } from "@/services/sync/transfer-sync";

const PHEX_ADDRESS_LOWER = PHEX_ADDRESS.toLowerCase();
// Real on-chain HEX stake selectors: stakeStart = 0x52a438b8, stakeEnd = 0x343009a2.
// Encoding with these names proves the production decoder handles the genuine
// selectors emitted by the native PulseChain HEX contract.
const PHEX_STAKE_ABI = parseAbi([
  "function stakeStart(uint256 newStakedHearts, uint256 newStakedDays)",
  "function stakeEnd(uint256 stakeIndex, uint40 stakeIdParam)",
]);

// Pre-fix (incorrect) selectors the production decoder must now reject:
// startStake = 0x128bfcae, endStake = 0x89e7f551.
const LEGACY_PHEX_STAKE_ABI = parseAbi([
  "function startStake(uint256 newStakedHearts, uint256 newStakedDays)",
  "function endStake(uint256 stakeIndex, uint40 stakeIdParam)",
]);

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

type RawStakeActionRecord = {
  chainId: number;
  protocolSlug: string;
  actionKind: "START" | "END";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  actionIndex: number;
  contractAddress: string;
  initiatorAddress: string;
  stakeId: bigint | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  principalLockedRaw: string | null;
  totalReturnedRaw: string | null;
  principalReturnedRaw: string | null;
  yieldRaw: string | null;
  penaltyRaw: string | null;
  feeAssetIdSnapshot: string;
  feeDecimalsSnapshot: number;
  feeAmountRaw: string;
  status: "ACTIVE";
};

function createMemoryStores() {
  const rawLogs = new Map<string, RawLogRecord>();
  const rawBlocks = new Map<string, RawBlockRecord>();
  const rawTokenTransfers = new Map<string, RawTokenTransferRecord>();
  const rawTransactions = new Map<string, RawTransactionRecord>();
  const rawStakeActions = new Map<string, RawStakeActionRecord>();
  const tokens = new Map<string, Record<string, unknown>>();
  const ledgerActionGroups = new Map<string, Record<string, unknown>>();
  const ledgerEntries = new Map<string, Record<string, unknown>>();
  const cursors = new Map<string, { fromBlock: bigint; toBlock: bigint; blockHash: string | null }>();
  const runs: Array<Record<string, unknown>> = [];

  tokens.set(`369:${PHEX_ADDRESS_LOWER}`, {
    id: "token_phex",
    chainId: 369,
    addressLower: PHEX_ADDRESS_LOWER,
    assetId: `chain:369:erc20:${PHEX_ADDRESS_LOWER}`,
    decimals: 8,
    symbol: "pHEX",
    name: "PulseChain HEX",
  });

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
      updateMany: vi.fn(async () => ({ count: 0 })),
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
      updateMany: vi.fn(async () => ({ count: 0 })),
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
    rawDexSwap: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    rawLpAction: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    rawStakeAction: {
      async createMany(args: { data: RawStakeActionRecord[] }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.txHash}:${item.actionKind}:${item.actionIndex}:${item.blockHash}`;
          if (!rawStakeActions.has(key)) {
            rawStakeActions.set(key, { ...item, status: "ACTIVE" });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: { where: { chainId: number; status: "ACTIVE"; blockNumber: { gte: bigint; lte: bigint }; initiatorAddress: string } }) {
        return Array.from(rawStakeActions.values())
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
              ? left.actionIndex - right.actionIndex
              : Number(left.blockNumber - right.blockNumber),
          );
      },
      async findFirst(args: { where: { chainId: number; status: "ACTIVE"; initiatorAddress: string; actionKind: "START"; stakeId: bigint } }) {
        const matches = Array.from(rawStakeActions.values())
          .filter(
            (item) =>
              item.chainId === args.where.chainId &&
              item.status === args.where.status &&
              item.initiatorAddress === args.where.initiatorAddress &&
              item.actionKind === args.where.actionKind &&
              item.stakeId === args.where.stakeId,
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? right.actionIndex - left.actionIndex
              : Number(right.blockNumber - left.blockNumber),
          );

        return matches[0] ?? null;
      },
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    token: {
      async findUnique(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } } }) {
        return tokens.get(`${args.where.chainId_addressLower.chainId}:${args.where.chainId_addressLower.addressLower}`) ?? null;
      },
      async upsert(args: { where: { chainId_addressLower: { chainId: number; addressLower: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) {
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
      async createMany(args: { data: Array<{ id: string; entryType: string; assetId: string; quantity: string }> }) {
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
      async create(args: { data: Record<string, unknown> }) {
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
    rawLogs,
    rawStakeActions,
    rawTransactions,
    rawTokenTransfers,
    ledgerEntries,
    tokens,
    runs,
  };
}

function createStakeStartPublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";

  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? [
            {
              address: PHEX_ADDRESS_LOWER,
              blockHash: "0xblock140",
              blockNumber: 140n,
              data: "0x0000000000000000000000000000000000000000000000000000000005f5e100",
              logIndex: 2,
              transactionHash: "0xstakestart",
              topics: [
                TRANSFER_EVENT_TOPIC0,
                walletTopic,
                "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39",
              ],
            },
          ]
        : [];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock140",
      parentHash: "0xblock139",
      timestamp: 1_700_000_500n,
    })),
    readContract: vi.fn(async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      expect(blockNumber).toBe(140n);
      if (functionName === "stakeCount") {
        return 4n;
      }
      if (functionName === "stakeLists") {
        return [42n, 100000000n, 777n, 1, 365, 0, false];
      }
      throw new Error(`unexpected function ${functionName}`);
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      transactionIndex: 3,
      from: walletAddress,
      to: PHEX_ADDRESS_LOWER,
      value: 0n,
      gasPrice: 2_000_000_000n,
      input: encodeFunctionData({
        abi: PHEX_STAKE_ABI,
        functionName: "stakeStart",
        args: [100000000n, 365n],
      }),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      gasUsed: 150_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

// keccak256("StakeStart(uint256,address,uint40)") — emitted by the native HEX
// contract in the same transaction as the stake's burn Transfer.
const STAKE_START_EVENT_TOPIC0 =
  "0x14872dc760f33532684e68e1b6d5fd3f71ba7b07dee76bdb2b084f28b74233ef";

function createUnfilteredLogsStakeStartPublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
  // StakeStart data0: stakedDays<<184 | stakeShares<<112 | stakedHearts<<40 | timestamp.
  // A single 32-byte word, so a topic0-blind transfer decode "succeeds" and
  // fabricates an outbound wallet transfer with the packed word as the amount.
  const stakeStartData0 =
    (365n << 184n) | (777n << 112n) | (100000000n << 40n) | 1_700_000_500n;

  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? [
            // A provider that ignores the topics filter returns the StakeStart
            // event alongside the genuine burn Transfer of the same transaction.
            {
              address: PHEX_ADDRESS_LOWER,
              blockHash: "0xblock140",
              blockNumber: 140n,
              data: `0x${stakeStartData0.toString(16).padStart(64, "0")}`,
              logIndex: 1,
              transactionHash: "0xstakestart",
              topics: [
                STAKE_START_EVENT_TOPIC0,
                walletTopic,
                "0x000000000000000000000000000000000000000000000000000000000000002a",
              ],
            },
            {
              address: PHEX_ADDRESS_LOWER,
              blockHash: "0xblock140",
              blockNumber: 140n,
              data: "0x0000000000000000000000000000000000000000000000000000000005f5e100",
              logIndex: 2,
              transactionHash: "0xstakestart",
              topics: [
                TRANSFER_EVENT_TOPIC0,
                walletTopic,
                "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39",
              ],
            },
          ]
        : [];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock140",
      parentHash: "0xblock139",
      timestamp: 1_700_000_500n,
    })),
    readContract: vi.fn(async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      expect(blockNumber).toBe(140n);
      if (functionName === "stakeCount") {
        return 4n;
      }
      if (functionName === "stakeLists") {
        return [42n, 100000000n, 777n, 1, 365, 0, false];
      }
      throw new Error(`unexpected function ${functionName}`);
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      transactionIndex: 3,
      from: walletAddress,
      to: PHEX_ADDRESS_LOWER,
      value: 0n,
      gasPrice: 2_000_000_000n,
      input: encodeFunctionData({
        abi: PHEX_STAKE_ABI,
        functionName: "stakeStart",
        args: [100000000n, 365n],
      }),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      gasUsed: 150_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

function createUnrelatedWalletNoiseStakeStartPublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
  // A provider that does not scope eth_getLogs to the tracked wallet returns
  // another holder's genuine pHEX transfer from the same block alongside
  // this wallet's real stake-start burn transfer. Neither indexed address on
  // the noise log is the tracked wallet.
  const unrelatedWalletTransferLog = {
    address: PHEX_ADDRESS_LOWER,
    blockHash: "0xblock140",
    blockNumber: 140n,
    data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
    logIndex: 0,
    transactionHash: "0xunrelatedtransfer",
    topics: [
      TRANSFER_EVENT_TOPIC0,
      "0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
      "0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd",
    ],
  };
  const genuineBurnLog = {
    address: PHEX_ADDRESS_LOWER,
    blockHash: "0xblock140",
    blockNumber: 140n,
    data: "0x0000000000000000000000000000000000000000000000000000000005f5e100",
    logIndex: 2,
    transactionHash: "0xstakestart",
    topics: [
      TRANSFER_EVENT_TOPIC0,
      walletTopic,
      "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39",
    ],
  };

  return {
    // Ignores the requested topics filter entirely and always returns both
    // logs — the strongest form of "provider does not honor the filter".
    getLogs: vi.fn(async () => [unrelatedWalletTransferLog, genuineBurnLog]),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock140",
      parentHash: "0xblock139",
      timestamp: 1_700_000_500n,
    })),
    readContract: vi.fn(async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      expect(blockNumber).toBe(140n);
      if (functionName === "stakeCount") {
        return 4n;
      }
      if (functionName === "stakeLists") {
        return [42n, 100000000n, 777n, 1, 365, 0, false];
      }
      throw new Error(`unexpected function ${functionName}`);
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      transactionIndex: 3,
      from: walletAddress,
      to: PHEX_ADDRESS_LOWER,
      value: 0n,
      gasPrice: 2_000_000_000n,
      input: encodeFunctionData({
        abi: PHEX_STAKE_ABI,
        functionName: "stakeStart",
        args: [100000000n, 365n],
      }),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xstakestart",
      blockHash: "0xblock140",
      blockNumber: 140n,
      gasUsed: 150_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

function createStakeEndPublicClient(walletAddress: string) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";

  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? []
        : [
            {
              address: PHEX_ADDRESS_LOWER,
              blockHash: "0xblock141",
              blockNumber: 141n,
              data: "0x0000000000000000000000000000000000000000000000000000000006422c40",
              logIndex: 5,
              transactionHash: "0xstakeend",
              topics: [
                TRANSFER_EVENT_TOPIC0,
                "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39",
                walletTopic,
              ],
            },
          ];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock141",
      parentHash: "0xblock140",
      timestamp: 1_700_000_600n,
    })),
    readContract: vi.fn(async () => {
      throw new Error("end sync should not read historical stake metadata");
    }),
    getTransaction: vi.fn(async () => ({
      hash: "0xstakeend",
      blockHash: "0xblock141",
      blockNumber: 141n,
      transactionIndex: 4,
      from: walletAddress,
      to: PHEX_ADDRESS_LOWER,
      value: 0n,
      gasPrice: 2_000_000_000n,
      input: encodeFunctionData({
        abi: PHEX_STAKE_ABI,
        functionName: "stakeEnd",
        args: [3n, 42],
      }),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: "0xstakeend",
      blockHash: "0xblock141",
      blockNumber: 141n,
      gasUsed: 160_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

type LegacyStakeFunction = "startStake" | "endStake";

function createLegacySelectorPublicClient(
  walletAddress: string,
  legacyFunction: LegacyStakeFunction,
) {
  const walletTopic = "0x0000000000000000000000001111111111111111111111111111111111111111";
  const txHash = `0xlegacy${legacyFunction}`;
  // The decoder rejects the legacy selector before any transfer-shape check, so
  // an outbound pHEX transfer is enough to make the transaction a candidate for
  // both the legacy startStake (0x128bfcae) and endStake (0x89e7f551) inputs.
  const input =
    legacyFunction === "startStake"
      ? encodeFunctionData({
          abi: LEGACY_PHEX_STAKE_ABI,
          functionName: "startStake",
          args: [100000000n, 365n],
        })
      : encodeFunctionData({
          abi: LEGACY_PHEX_STAKE_ABI,
          functionName: "endStake",
          args: [3n, 42],
        });

  return {
    getLogs: vi.fn(async (args: { topics?: readonly (string | readonly string[] | null)[] }) => {
      const outgoing = args.topics?.[1] === walletTopic;
      return outgoing
        ? [
            {
              address: PHEX_ADDRESS_LOWER,
              blockHash: "0xblock140",
              blockNumber: 140n,
              data: "0x0000000000000000000000000000000000000000000000000000000005f5e100",
              logIndex: 2,
              transactionHash: txHash,
              topics: [
                TRANSFER_EVENT_TOPIC0,
                walletTopic,
                "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39",
              ],
            },
          ]
        : [];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: "0xblock140",
      parentHash: "0xblock139",
      timestamp: 1_700_000_500n,
    })),
    readContract: vi.fn(async () => {
      throw new Error("legacy selector must be rejected before any contract read");
    }),
    getTransaction: vi.fn(async () => ({
      hash: txHash,
      blockHash: "0xblock140",
      blockNumber: 140n,
      transactionIndex: 3,
      from: walletAddress,
      to: PHEX_ADDRESS_LOWER,
      value: 0n,
      gasPrice: 2_000_000_000n,
      // Encoded with a pre-fix selector (0x128bfcae / 0x89e7f551) that no longer
      // exists in the production ABI and must be skipped as an unsupported selector.
      input,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: txHash,
      blockHash: "0xblock140",
      blockNumber: 140n,
      gasUsed: 150_000n,
      effectiveGasPrice: 2_000_000_000n,
      logs: [],
    })),
  };
}

describe("stake sync flow", () => {
  it("persists raw stake start snapshots and canonical stake ledger rows idempotently", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createStakeStartPublicClient(walletAddress) as never,
    });

    const first = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start",
      dependencies,
    });

    const second = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start",
      dependencies,
    });

    expect(first.counts).toEqual({
      rawLogs: 1,
      actionGroups: 1,
      ledgerEntries: 3,
    });
    expect(second.counts).toEqual({
      rawLogs: 0,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(stores.rawTransactions.size).toBe(1);
    expect(stores.rawStakeActions.size).toBe(1);
  });

  it("persists a genuine stake start even when the provider returns non-Transfer logs", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createUnfilteredLogsStakeStartPublicClient(walletAddress) as never,
    });

    const result = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start-unfiltered-logs",
      dependencies,
    });

    // The StakeStart event log must be excluded from the transfer evidence
    // path instead of being decoded into a fabricated outbound transfer that
    // breaks the 1-outbound/0-inbound stake-start shape check.
    expect(result.counts).toEqual({
      rawLogs: 1,
      actionGroups: 1,
      ledgerEntries: 3,
    });
    expect(result.warningCount).toBe(1);
    expect(stores.rawTokenTransfers.size).toBe(1);
    expect(stores.rawStakeActions.size).toBe(1);
    const stakeAction = [...stores.rawStakeActions.values()][0];
    expect(stakeAction).toMatchObject({
      actionKind: "START",
      stakeId: 42n,
      stakeIndex: 3,
      stakedDays: 365,
      principalLockedRaw: "100000000",
    });
  });

  it("still produces the expected RawStakeAction when unrelated-wallet Transfer noise is mixed into the same block", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createUnrelatedWalletNoiseStakeStartPublicClient(walletAddress) as never,
    });

    const result = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start-unrelated-wallet-noise",
      dependencies,
    });

    // Only the genuine burn transfer is wallet-relevant; the unrelated
    // holder's transfer must never reach RawLog/RawTokenTransfer persistence,
    // and the genuine stake-start shape check must still pass.
    expect(result.counts).toEqual({
      rawLogs: 1,
      actionGroups: 1,
      ledgerEntries: 3,
    });
    expect(stores.rawTokenTransfers.size).toBe(1);
    expect(stores.rawStakeActions.size).toBe(1);
    const noiseStakeAction = [...stores.rawStakeActions.values()][0];
    expect(noiseStakeAction).toMatchObject({
      actionKind: "START",
      stakeId: 42n,
      stakeIndex: 3,
      stakedDays: 365,
      principalLockedRaw: "100000000",
    });
  });

  it("normalizes end-stake entries from persisted raw stake snapshots", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";

    stores.rawStakeActions.set("369:0xstart:START:0:0xblock140", {
      chainId: 369,
      protocolSlug: "hex",
      actionKind: "START",
      txHash: "0xstart",
      blockNumber: 140n,
      blockHash: "0xblock140",
      actionIndex: 0,
      contractAddress: PHEX_ADDRESS_LOWER,
      initiatorAddress: walletAddress,
      stakeId: 42n,
      stakeIndex: 3,
      stakedDays: 365,
      tokenAddress: PHEX_ADDRESS_LOWER,
      assetIdSnapshot: `chain:369:erc20:${PHEX_ADDRESS_LOWER}`,
      decimalsSnapshot: 8,
      principalLockedRaw: "100000000",
      totalReturnedRaw: null,
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "300000000000000",
      status: "ACTIVE",
    });

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createStakeEndPublicClient(walletAddress) as never,
    });

    await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 141n,
      endBlock: 141n,
      policyLabel: "stake-end",
      dependencies,
    });

    stores.tokens.set(`369:${PHEX_ADDRESS_LOWER}`, {
      id: "mutated_phex",
      chainId: 369,
      addressLower: PHEX_ADDRESS_LOWER,
      assetId: "chain:369:erc20:0xmutated",
      decimals: 18,
      symbol: "BROKEN",
      name: "Broken Token",
    });

    const rawActions = await readWalletRawStakeActions(
      {
        chainId: 369,
        walletAddress,
        fromBlock: 141n,
        toBlock: 141n,
      },
      stores.db as never,
    );

    const normalized = await dependencies.normalizeSourceFamily({
      runId: "rerun_1",
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamily: "STAKING",
      rawLogs: rawActions.map((action) => ({
        ...action,
        occurredAt: new Date("2023-11-14T22:13:20.000Z"),
      })),
      fromBlock: 141n,
      toBlock: 141n,
    });

    expect(normalized).toHaveLength(4);
    expect(normalized.map((entry) => entry.entryType)).toEqual([
      "STAKE_END",
      "STAKE_PRINCIPAL_RETURNED",
      "STAKE_YIELD_RECEIVED",
      "FEE",
    ]);
    expect(normalized[1]).toMatchObject({
      assetId: `chain:369:erc20:${PHEX_ADDRESS_LOWER}`,
      quantity: "1",
    });
    expect(normalized[2]).toMatchObject({
      assetId: `chain:369:erc20:${PHEX_ADDRESS_LOWER}`,
      quantity: "0.05",
    });
  });

  it("warns deterministically and skips ambiguous stake candidates", async () => {
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
                  address: PHEX_ADDRESS_LOWER,
                  blockHash: "0xblock142",
                  blockNumber: 142n,
                  data: "0x0000000000000000000000000000000000000000000000000000000002faf080",
                  logIndex: 1,
                  transactionHash: "0xstakeambiguous",
                  topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39"],
                },
                {
                  address: PHEX_ADDRESS_LOWER,
                  blockHash: "0xblock142",
                  blockNumber: 142n,
                  data: "0x0000000000000000000000000000000000000000000000000000000002faf080",
                  logIndex: 2,
                  transactionHash: "0xstakeambiguous",
                  topics: [TRANSFER_EVENT_TOPIC0, walletTopic, "0x0000000000000000000000002b591e99afe9f32eaa6214f7b7629768c40eeb39"],
                },
              ]
            : [];
        }),
        getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
          number: blockNumber,
          hash: "0xblock142",
          parentHash: "0xblock141",
          timestamp: 1_700_000_700n,
        })),
        readContract: vi.fn(async () => 0n),
        getTransaction: vi.fn(async () => ({
          hash: "0xstakeambiguous",
          blockHash: "0xblock142",
          blockNumber: 142n,
          transactionIndex: 5,
          from: walletAddress,
          to: PHEX_ADDRESS_LOWER,
          value: 0n,
          gasPrice: 2_000_000_000n,
          input: encodeFunctionData({
            abi: PHEX_STAKE_ABI,
            functionName: "stakeStart",
            args: [100000000n, 365n],
          }),
        })),
        getTransactionReceipt: vi.fn(async () => ({
          transactionHash: "0xstakeambiguous",
          blockHash: "0xblock142",
          blockNumber: 142n,
          gasUsed: 150_000n,
          effectiveGasPrice: 2_000_000_000n,
          logs: [],
        })),
      } as never,
    });

    const result = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 142n,
      endBlock: 142n,
      policyLabel: "stake-ambiguous",
      dependencies,
    });

    expect(result.counts).toEqual({
      rawLogs: 2,
      actionGroups: 0,
      ledgerEntries: 0,
    });
    expect(result.warningCount).toBe(1);
    expect(stores.rawStakeActions.size).toBe(0);
    expect(stores.ledgerEntries.size).toBe(0);
  });

  it("unblocks genuine stake-start evidence once a fabricated legacy transfer row is invalidated", async () => {
    const stores = createMemoryStores();
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletTopic =
      "0x0000000000000000000000001111111111111111111111111111111111111111";

    // Legacy pre-PR-#326 poisoned state: the HEX StakeStart event of the same
    // stake transaction was mis-decoded as an outbound wallet transfer (the
    // stakeId packed into `toAddress`, the packed data word as the amount).
    // Its backing RawLog is persisted with the StakeStart topic0 — exactly the
    // shape that blocked stakeId 942660 at block 26154634.
    const fabricatedIdentity = "369:0xstakestart:1:0xblock140";
    stores.rawTokenTransfers.set(fabricatedIdentity, {
      chainId: 369,
      txHash: "0xstakestart",
      blockNumber: 140n,
      blockHash: "0xblock140",
      logIndex: 1,
      fromAddress: walletAddress,
      toAddress: "0x000000000000000000000000000000000000002a",
      tokenId: "token_phex",
      tokenAddress: PHEX_ADDRESS_LOWER,
      assetIdSnapshot: `chain:369:erc20:${PHEX_ADDRESS_LOWER}`,
      decimalsSnapshot: 8,
      amountRaw: "13620820367221310374848487290948873865081649229393590",
      status: "ACTIVE",
    } as unknown as Parameters<typeof stores.rawTokenTransfers.set>[1]);
    stores.rawLogs.set(fabricatedIdentity, {
      chainId: 369,
      txHash: "0xstakestart",
      blockNumber: 140n,
      blockHash: "0xblock140",
      logIndex: 1,
      address: PHEX_ADDRESS_LOWER,
      topic0: STAKE_START_EVENT_TOPIC0,
      topic1: walletTopic,
      topic2:
        "0x000000000000000000000000000000000000000000000000000000000000002a",
      topic3: null,
      data: "0x00",
      status: "ACTIVE",
    } as unknown as Parameters<typeof stores.rawLogs.set>[1]);

    const dependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: createStakeStartPublicClient(walletAddress) as never,
    });

    // Run 1: the poisoned ACTIVE row makes the transaction look like it has
    // two outbound transfers, so the stake-start shape check must skip it.
    const blocked = await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start-poisoned-legacy-row",
      dependencies,
    });

    expect(blocked.warningCount).toBe(1);
    // Pin the block to the shape-check skip itself (persisted through the
    // SyncRun record) so this test cannot pass on an unrelated warning.
    const blockedWarnings = stores.runs.flatMap((run) => {
      const details = (run as { warningDetails?: unknown }).warningDetails;
      return Array.isArray(details) ? (details as string[]) : [];
    });
    expect(blockedWarnings).toContain(
      "skip-stake:0xstakestart:ambiguous-start-transfer-shape:2:0",
    );
    expect(stores.rawStakeActions.size).toBe(0);

    // Operator repair over the same persisted state, via an adapter that
    // exposes the memory stores through the repair service's client shape.
    const repairClient = {
      rawTokenTransfer: {
        findMany: async (argsUnknown: unknown) => {
          const args = argsUnknown as {
            where: { status?: string; chainId?: number; id?: { gt: string } };
            take?: number;
          };
          let rows = [...stores.rawTokenTransfers.entries()]
            .filter(
              ([key, record]) =>
                (args.where.status === undefined ||
                  (record as unknown as { status: string }).status ===
                    args.where.status) &&
                (args.where.chainId === undefined ||
                  record.chainId === args.where.chainId) &&
                (args.where.id?.gt === undefined || key > args.where.id.gt),
            )
            .sort(([left], [right]) => (left < right ? -1 : 1))
            .map(([key, record]) => ({
              id: key,
              chainId: record.chainId,
              txHash: record.txHash,
              logIndex: record.logIndex,
              blockHash: record.blockHash,
              status: (record as unknown as { status: string }).status,
            }));
          if (args.take !== undefined) {
            rows = rows.slice(0, args.take);
          }
          return rows as unknown as Array<Record<string, unknown>>;
        },
        updateMany: async (argsUnknown: unknown) => {
          const args = argsUnknown as {
            where: { id: { in: string[] }; status: string };
            data: { status: string };
          };
          let count = 0;
          for (const id of args.where.id.in) {
            const record = stores.rawTokenTransfers.get(id) as unknown as
              | { status: string }
              | undefined;
            if (record && record.status === args.where.status) {
              record.status = args.data.status;
              count += 1;
            }
          }
          return { count };
        },
      },
      rawLog: {
        findMany: async (argsUnknown: unknown) => {
          const args = argsUnknown as { where: { txHash: { in: string[] } } };
          return [...stores.rawLogs.entries()]
            .filter(([, record]) => args.where.txHash.in.includes(record.txHash))
            .map(([key, record]) => ({
              id: key,
              chainId: record.chainId,
              txHash: record.txHash,
              logIndex: record.logIndex,
              blockHash: record.blockHash,
              topic0:
                (record as unknown as { topic0?: string | null }).topic0 ?? null,
              status: (record as unknown as { status: string }).status,
            })) as unknown as Array<Record<string, unknown>>;
        },
      },
    };

    const repairReport = await repairFabricatedTokenTransfers(
      { apply: true, chainId: 369 },
      repairClient,
    );

    // The genuine burn transfer persisted by run 1 stays untouched; only the
    // StakeStart mis-decode is proven fabricated and invalidated.
    expect(repairReport.genuineTransfers).toBe(1);
    expect(repairReport.provenFabricatedTransfers).toBe(1);
    expect(repairReport.changedTransfers).toBe(1);
    expect(repairReport.fabricated[0]).toMatchObject({
      transferId: fabricatedIdentity,
      txHash: "0xstakestart",
      logIndex: 1,
    });

    // Run 2: with the fabricated row invalidated, the stake-start shape is
    // 1-outbound/0-inbound again and the genuine evidence lands.
    await runWalletSync({
      wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
      sourceFamilies: ["STAKING"],
      startBlock: 140n,
      endBlock: 140n,
      policyLabel: "stake-start-after-repair",
      dependencies,
    });

    expect(stores.rawStakeActions.size).toBe(1);
    expect([...stores.rawStakeActions.values()][0]).toMatchObject({
      actionKind: "START",
      stakeId: 42n,
      stakeIndex: 3,
      stakedDays: 365,
      principalLockedRaw: "100000000",
    });
  });

  it.each([
    { legacyFunction: "startStake" as const, selector: "0x128bfcae" },
    { legacyFunction: "endStake" as const, selector: "0x89e7f551" },
  ])(
    "rejects the legacy $legacyFunction selector ($selector) and persists no stake actions",
    async ({ legacyFunction }) => {
      const stores = createMemoryStores();
      const walletAddress = "0x1111111111111111111111111111111111111111";
      const dependencies = createSyncDependencies({
        db: stores.db as never,
        publicClient: createLegacySelectorPublicClient(walletAddress, legacyFunction) as never,
      });

      const result = await runWalletSync({
        wallet: { id: "wallet_1", chainId: 369, address: walletAddress },
        sourceFamilies: ["STAKING"],
        startBlock: 140n,
        endBlock: 140n,
        policyLabel: `stake-legacy-${legacyFunction}`,
        dependencies,
      });

      // The pHEX transfer is still ingested as a raw log, but the transaction
      // carries a pre-fix selector (0x128bfcae / 0x89e7f551) that the decoder no
      // longer recognizes, so no stake action or ledger entry is produced.
      expect(result.counts).toEqual({
        rawLogs: 1,
        actionGroups: 0,
        ledgerEntries: 0,
      });
      expect(result.warningCount).toBeGreaterThanOrEqual(1);
      expect(stores.rawStakeActions.size).toBe(0);
      expect(stores.ledgerEntries.size).toBe(0);
    },
  );
});
