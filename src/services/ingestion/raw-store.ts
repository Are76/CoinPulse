import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { getDb } from "@/lib/db";

type RawStoreClient = PrismaClient | Prisma.TransactionClient;

export type PersistRawLogInput = {
  chainId: number;
  transactionId?: string | null;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  address: string;
  topics: readonly string[];
  data: string;
};

export type PersistRawBlockInput = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  parentHash: string;
  timestamp: Date;
};

export async function persistRawLogs(
  logs: readonly PersistRawLogInput[],
  client: RawStoreClient = getDb(),
) {
  if (logs.length === 0) {
    return { count: 0 };
  }

  return client.rawLog.createMany({
    data: logs.map((log) => ({
      chainId: log.chainId,
      transactionId: log.transactionId ?? null,
      txHash: log.txHash.toLowerCase(),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash.toLowerCase(),
      logIndex: log.logIndex,
      address: log.address.toLowerCase(),
      topic0: log.topics[0] ?? null,
      topic1: log.topics[1] ?? null,
      topic2: log.topics[2] ?? null,
      topic3: log.topics[3] ?? null,
      data: log.data.toLowerCase(),
    })),
    skipDuplicates: true,
  });
}

export async function persistRawBlocks(
  blocks: readonly PersistRawBlockInput[],
  client: RawStoreClient = getDb(),
) {
  if (blocks.length === 0) {
    return { count: 0 };
  }

  return client.rawBlock.createMany({
    data: blocks.map((block) => ({
      chainId: block.chainId,
      blockNumber: block.blockNumber,
      blockHash: block.blockHash.toLowerCase(),
      parentHash: block.parentHash.toLowerCase(),
      timestamp: block.timestamp,
    })),
    skipDuplicates: true,
  });
}

export async function markRawDataRangeReorged(
  args: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawStoreClient = getDb(),
) {
  const where = {
    chainId: args.chainId,
    blockNumber: {
      gte: args.fromBlock,
      lte: args.toBlock,
    },
  } satisfies Prisma.RawBlockWhereInput;

  const [rawBlocks, rawTransactions, rawLogs, rawTokenTransfers] =
    await client.$transaction([
      client.rawBlock.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
      client.rawTransaction.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
      client.rawLog.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
      client.rawTokenTransfer.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
    ]);

  return {
    rawBlocks: rawBlocks.count,
    rawTransactions: rawTransactions.count,
    rawLogs: rawLogs.count,
    rawTokenTransfers: rawTokenTransfers.count,
  };
}
