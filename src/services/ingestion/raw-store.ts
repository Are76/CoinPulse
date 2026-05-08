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

export type PersistRawTokenTransferInput = {
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
};

type RawLogReadClient = {
  rawLog: {
    findMany(args: {
      where: {
        chainId: number;
        status: "ACTIVE";
        blockNumber: {
          gte: bigint;
          lte: bigint;
        };
        topic0: string;
        OR: Array<{
          topic1?: string;
          topic2?: string;
        }>;
      };
      orderBy: Array<{
        blockNumber?: "asc";
        logIndex?: "asc";
      }>;
    }): Promise<
      Array<{
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
      }>
    >;
  };
};

type RawTokenTransferStoreClient = {
  rawTokenTransfer: {
    createMany(args: {
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
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
};

type RawTokenTransferReadClient = {
  rawTokenTransfer: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
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

export async function persistRawTokenTransfers(
  transfers: readonly PersistRawTokenTransferInput[],
  client: RawTokenTransferStoreClient = getDb(),
) {
  if (transfers.length === 0) {
    return { count: 0 };
  }

  return client.rawTokenTransfer.createMany({
    data: transfers.map((transfer) => ({
      chainId: transfer.chainId,
      tokenId: transfer.tokenId,
      tokenAddress: transfer.tokenAddress.toLowerCase(),
      assetIdSnapshot: transfer.assetIdSnapshot,
      decimalsSnapshot: transfer.decimalsSnapshot,
      txHash: transfer.txHash.toLowerCase(),
      blockNumber: transfer.blockNumber,
      blockHash: transfer.blockHash.toLowerCase(),
      logIndex: transfer.logIndex,
      fromAddress: transfer.fromAddress.toLowerCase(),
      toAddress: transfer.toAddress.toLowerCase(),
      amountRaw: transfer.amountRaw,
    })),
    skipDuplicates: true,
  });
}

export async function readWalletTransferRawLogs(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
    transferTopic0: string;
  },
  client: RawLogReadClient = getDb(),
) {
  const walletTopic = toTopicAddress(args.walletAddress);

  return client.rawLog.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      topic0: args.transferTopic0.toLowerCase(),
      OR: [{ topic1: walletTopic }, { topic2: walletTopic }],
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });
}

export async function readWalletTransferRawTokenTransfers(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawTokenTransferReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const records = await client.rawTokenTransfer.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      OR: [{ fromAddress: walletAddress }, { toAddress: walletAddress }],
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });

  return records.map((record) => ({
    chainId: record.chainId as number,
    tokenId: record.tokenId as string,
    tokenAddress: record.tokenAddress as string,
    assetIdSnapshot: record.assetIdSnapshot as string,
    decimalsSnapshot: record.decimalsSnapshot as number,
    txHash: record.txHash as string,
    blockNumber: record.blockNumber as bigint,
    blockHash: record.blockHash as string,
    logIndex: record.logIndex as number,
    fromAddress: record.fromAddress as string,
    toAddress: record.toAddress as string,
    amountRaw:
      typeof record.amountRaw === "string"
        ? record.amountRaw
        : (record.amountRaw as { toString(): string }).toString(),
  }));
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

function toTopicAddress(address: string) {
  return `0x000000000000000000000000${address.toLowerCase().replace(/^0x/, "")}`;
}
