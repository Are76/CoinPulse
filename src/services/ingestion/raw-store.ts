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

export type PersistRawTransactionInput = {
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
};

export type PersistRawDexSwapInput = {
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
};

export type PersistRawLpActionInput = {
  chainId: number;
  protocolSlug: string;
  actionKind: "ADD" | "REMOVE";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  pairAddress: string;
  initiatorAddress: string;
  counterpartyAddress: string | null;
  token0Address: string;
  token0AssetIdSnapshot: string;
  token0DecimalsSnapshot: number;
  token0AmountRaw: string;
  token1Address: string;
  token1AssetIdSnapshot: string;
  token1DecimalsSnapshot: number;
  token1AmountRaw: string;
  lpTokenAddress: string;
  lpAssetIdSnapshot: string;
  lpDecimalsSnapshot: number;
  lpAmountRaw: string;
  feeAssetIdSnapshot: string;
  feeDecimalsSnapshot: number;
  feeAmountRaw: string;
};

export type PersistRawStakeActionInput = {
  chainId: number;
  protocolSlug: string;
  actionKind: "START" | "END";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  actionIndex: number;
  contractAddress: string;
  initiatorAddress: string;
  stakeId?: bigint | null;
  stakeIndex?: number | null;
  stakedDays?: number | null;
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  principalLockedRaw?: string | null;
  totalReturnedRaw?: string | null;
  principalReturnedRaw?: string | null;
  yieldRaw?: string | null;
  penaltyRaw?: string | null;
  feeAssetIdSnapshot: string;
  feeDecimalsSnapshot: number;
  feeAmountRaw: string;
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

type RawTransactionStoreClient = {
  rawTransaction: {
    createMany(args: {
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
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
};

type RawDexSwapStoreClient = {
  rawDexSwap: {
    createMany(args: {
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
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
};

type RawLpActionStoreClient = {
  rawLpAction: {
    createMany(args: {
      data: Array<{
        chainId: number;
        protocolSlug: string;
        actionKind: string;
        txHash: string;
        blockNumber: bigint;
        blockHash: string;
        logIndex: number;
        pairAddress: string;
        initiatorAddress: string;
        counterpartyAddress: string | null;
        token0Address: string;
        token0AssetIdSnapshot: string;
        token0DecimalsSnapshot: number;
        token0AmountRaw: string;
        token1Address: string;
        token1AssetIdSnapshot: string;
        token1DecimalsSnapshot: number;
        token1AmountRaw: string;
        lpTokenAddress: string;
        lpAssetIdSnapshot: string;
        lpDecimalsSnapshot: number;
        lpAmountRaw: string;
        feeAssetIdSnapshot: string;
        feeDecimalsSnapshot: number;
        feeAmountRaw: string;
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
};

type RawStakeActionStoreClient = {
  rawStakeAction: {
    createMany(args: {
      data: Array<{
        chainId: number;
        protocolSlug: string;
        actionKind: string;
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
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findFirst?(args: unknown): Promise<Record<string, unknown> | null>;
  };
};

type RawTokenTransferReadClient = {
  rawTokenTransfer: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

type RawTransactionReadClient = {
  rawTransaction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

type RawDexSwapReadClient = {
  rawDexSwap: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

type RawLpActionReadClient = {
  rawLpAction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

type RawStakeActionReadClient = {
  rawStakeAction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    findFirst?(args: unknown): Promise<Record<string, unknown> | null>;
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

export async function persistRawTransactions(
  transactions: readonly PersistRawTransactionInput[],
  client: RawTransactionStoreClient = getDb(),
) {
  if (transactions.length === 0) {
    return { count: 0 };
  }

  return client.rawTransaction.createMany({
    data: transactions.map((transaction) => ({
      chainId: transaction.chainId,
      txHash: transaction.txHash.toLowerCase(),
      blockNumber: transaction.blockNumber,
      blockHash: transaction.blockHash.toLowerCase(),
      transactionIndex: transaction.transactionIndex,
      fromAddress: transaction.fromAddress.toLowerCase(),
      toAddress: transaction.toAddress?.toLowerCase() ?? null,
      valueRaw: transaction.valueRaw,
      gasPriceRaw: transaction.gasPriceRaw,
      gasUsedRaw: transaction.gasUsedRaw,
    })),
    skipDuplicates: true,
  });
}

export async function persistRawDexSwaps(
  swaps: readonly PersistRawDexSwapInput[],
  client: RawDexSwapStoreClient = getDb(),
) {
  if (swaps.length === 0) {
    return { count: 0 };
  }

  return client.rawDexSwap.createMany({
    data: swaps.map((swap) => ({
      chainId: swap.chainId,
      protocolSlug: swap.protocolSlug,
      txHash: swap.txHash.toLowerCase(),
      blockNumber: swap.blockNumber,
      blockHash: swap.blockHash.toLowerCase(),
      logIndex: swap.logIndex,
      pairAddress: swap.pairAddress.toLowerCase(),
      initiatorAddress: swap.initiatorAddress.toLowerCase(),
      counterpartyAddress: swap.counterpartyAddress?.toLowerCase() ?? null,
      soldTokenAddress: swap.soldTokenAddress.toLowerCase(),
      soldAssetIdSnapshot: swap.soldAssetIdSnapshot,
      soldDecimalsSnapshot: swap.soldDecimalsSnapshot,
      soldAmountRaw: swap.soldAmountRaw,
      boughtTokenAddress: swap.boughtTokenAddress.toLowerCase(),
      boughtAssetIdSnapshot: swap.boughtAssetIdSnapshot,
      boughtDecimalsSnapshot: swap.boughtDecimalsSnapshot,
      boughtAmountRaw: swap.boughtAmountRaw,
      feeAssetIdSnapshot: swap.feeAssetIdSnapshot,
      feeDecimalsSnapshot: swap.feeDecimalsSnapshot,
      feeAmountRaw: swap.feeAmountRaw,
    })),
    skipDuplicates: true,
  });
}

export async function persistRawLpActions(
  actions: readonly PersistRawLpActionInput[],
  client: RawLpActionStoreClient = getDb(),
) {
  if (actions.length === 0) {
    return { count: 0 };
  }

  return client.rawLpAction.createMany({
    data: actions.map((action) => ({
      chainId: action.chainId,
      protocolSlug: action.protocolSlug,
      actionKind: action.actionKind,
      txHash: action.txHash.toLowerCase(),
      blockNumber: action.blockNumber,
      blockHash: action.blockHash.toLowerCase(),
      logIndex: action.logIndex,
      pairAddress: action.pairAddress.toLowerCase(),
      initiatorAddress: action.initiatorAddress.toLowerCase(),
      counterpartyAddress: action.counterpartyAddress?.toLowerCase() ?? null,
      token0Address: action.token0Address.toLowerCase(),
      token0AssetIdSnapshot: action.token0AssetIdSnapshot,
      token0DecimalsSnapshot: action.token0DecimalsSnapshot,
      token0AmountRaw: action.token0AmountRaw,
      token1Address: action.token1Address.toLowerCase(),
      token1AssetIdSnapshot: action.token1AssetIdSnapshot,
      token1DecimalsSnapshot: action.token1DecimalsSnapshot,
      token1AmountRaw: action.token1AmountRaw,
      lpTokenAddress: action.lpTokenAddress.toLowerCase(),
      lpAssetIdSnapshot: action.lpAssetIdSnapshot,
      lpDecimalsSnapshot: action.lpDecimalsSnapshot,
      lpAmountRaw: action.lpAmountRaw,
      feeAssetIdSnapshot: action.feeAssetIdSnapshot,
      feeDecimalsSnapshot: action.feeDecimalsSnapshot,
      feeAmountRaw: action.feeAmountRaw,
    })),
    skipDuplicates: true,
  });
}

export async function persistRawStakeActions(
  actions: readonly PersistRawStakeActionInput[],
  client: RawStakeActionStoreClient = getDb(),
) {
  if (actions.length === 0) {
    return { count: 0 };
  }

  return client.rawStakeAction.createMany({
    data: actions.map((action) => ({
      chainId: action.chainId,
      protocolSlug: action.protocolSlug,
      actionKind: action.actionKind,
      txHash: action.txHash.toLowerCase(),
      blockNumber: action.blockNumber,
      blockHash: action.blockHash.toLowerCase(),
      actionIndex: action.actionIndex,
      contractAddress: action.contractAddress.toLowerCase(),
      initiatorAddress: action.initiatorAddress.toLowerCase(),
      stakeId: action.stakeId ?? null,
      stakeIndex: action.stakeIndex ?? null,
      stakedDays: action.stakedDays ?? null,
      tokenAddress: action.tokenAddress.toLowerCase(),
      assetIdSnapshot: action.assetIdSnapshot,
      decimalsSnapshot: action.decimalsSnapshot,
      principalLockedRaw: action.principalLockedRaw ?? null,
      totalReturnedRaw: action.totalReturnedRaw ?? null,
      principalReturnedRaw: action.principalReturnedRaw ?? null,
      yieldRaw: action.yieldRaw ?? null,
      penaltyRaw: action.penaltyRaw ?? null,
      feeAssetIdSnapshot: action.feeAssetIdSnapshot,
      feeDecimalsSnapshot: action.feeDecimalsSnapshot,
      feeAmountRaw: action.feeAmountRaw,
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

export async function readWalletRawTransactions(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawTransactionReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const records = await client.rawTransaction.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      OR: [{ fromAddress: walletAddress }, { toAddress: walletAddress }],
    },
    orderBy: [{ blockNumber: "asc" }, { transactionIndex: "asc" }],
  });

  return records.map((record) => ({
    chainId: record.chainId as number,
    txHash: record.txHash as string,
    blockNumber: record.blockNumber as bigint,
    blockHash: record.blockHash as string,
    transactionIndex: record.transactionIndex as number,
    fromAddress: record.fromAddress as string,
    toAddress:
      typeof record.toAddress === "string" ? record.toAddress : null,
    valueRaw:
      typeof record.valueRaw === "string"
        ? record.valueRaw
        : (record.valueRaw as { toString(): string }).toString(),
    gasPriceRaw:
      record.gasPriceRaw == null
        ? null
        : typeof record.gasPriceRaw === "string"
          ? record.gasPriceRaw
          : (record.gasPriceRaw as { toString(): string }).toString(),
    gasUsedRaw:
      record.gasUsedRaw == null
        ? null
        : typeof record.gasUsedRaw === "string"
          ? record.gasUsedRaw
          : (record.gasUsedRaw as { toString(): string }).toString(),
  }));
}

export async function readWalletProtocolOperationTxHashes(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawDexSwapReadClient & RawLpActionReadClient & RawStakeActionReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const [dexRows, lpRows, stakeRows] = await Promise.all([
    client.rawDexSwap.findMany({
      where: {
        chainId: args.chainId,
        status: "ACTIVE",
        blockNumber: {
          gte: args.fromBlock,
          lte: args.toBlock,
        },
        initiatorAddress: walletAddress,
      },
      select: { txHash: true },
    }),
    client.rawLpAction.findMany({
      where: {
        chainId: args.chainId,
        status: "ACTIVE",
        blockNumber: {
          gte: args.fromBlock,
          lte: args.toBlock,
        },
        initiatorAddress: walletAddress,
      },
      select: { txHash: true },
    }),
    client.rawStakeAction.findMany({
      where: {
        chainId: args.chainId,
        status: "ACTIVE",
        blockNumber: {
          gte: args.fromBlock,
          lte: args.toBlock,
        },
        initiatorAddress: walletAddress,
      },
      select: { txHash: true },
    }),
  ]);

  return Array.from(
    new Set(
      [...dexRows, ...lpRows, ...stakeRows]
        .map((record) => record.txHash)
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase()),
    ),
  ).sort();
}

export async function readWalletDexSwapSnapshots(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawDexSwapReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const records = await client.rawDexSwap.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      initiatorAddress: walletAddress,
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  return records.map((record) => ({
    chainId: record.chainId as number,
    protocolSlug: record.protocolSlug as string,
    txHash: record.txHash as string,
    blockNumber: record.blockNumber as bigint,
    blockHash: record.blockHash as string,
    logIndex: record.logIndex as number,
    pairAddress: record.pairAddress as string,
    initiatorAddress: record.initiatorAddress as string,
    counterpartyAddress:
      typeof record.counterpartyAddress === "string"
        ? record.counterpartyAddress
        : null,
    soldTokenAddress: record.soldTokenAddress as string,
    soldAssetIdSnapshot: record.soldAssetIdSnapshot as string,
    soldDecimalsSnapshot: record.soldDecimalsSnapshot as number,
    // Decimal(78, 0) columns: serialize with toFixed() rather than toString().
    // Prisma.Decimal.toString() emits exponential notation for magnitudes >= 1e21,
    // which corrupts the digit-only raw string contract relied on downstream.
    // toFixed() always yields fixed-point, digit-only output.
    soldAmountRaw:
      typeof record.soldAmountRaw === "string"
        ? record.soldAmountRaw
        : (record.soldAmountRaw as { toFixed(): string }).toFixed(),
    boughtTokenAddress: record.boughtTokenAddress as string,
    boughtAssetIdSnapshot: record.boughtAssetIdSnapshot as string,
    boughtDecimalsSnapshot: record.boughtDecimalsSnapshot as number,
    boughtAmountRaw:
      typeof record.boughtAmountRaw === "string"
        ? record.boughtAmountRaw
        : (record.boughtAmountRaw as { toFixed(): string }).toFixed(),
    feeAssetIdSnapshot: record.feeAssetIdSnapshot as string,
    feeDecimalsSnapshot: record.feeDecimalsSnapshot as number,
    feeAmountRaw:
      typeof record.feeAmountRaw === "string"
        ? record.feeAmountRaw
        : (record.feeAmountRaw as { toFixed(): string }).toFixed(),
  }));
}

export async function readWalletRawLpActions(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawLpActionReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const records = await client.rawLpAction.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      initiatorAddress: walletAddress,
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  return records.map((record) => ({
    chainId: record.chainId as number,
    protocolSlug: record.protocolSlug as string,
    actionKind: record.actionKind as "ADD" | "REMOVE",
    txHash: record.txHash as string,
    blockNumber: record.blockNumber as bigint,
    blockHash: record.blockHash as string,
    logIndex: record.logIndex as number,
    pairAddress: record.pairAddress as string,
    initiatorAddress: record.initiatorAddress as string,
    counterpartyAddress:
      typeof record.counterpartyAddress === "string"
        ? record.counterpartyAddress
        : null,
    token0Address: record.token0Address as string,
    token0AssetIdSnapshot: record.token0AssetIdSnapshot as string,
    token0DecimalsSnapshot: record.token0DecimalsSnapshot as number,
    // Decimal(78, 0) columns: serialize with toFixed() rather than toString().
    // Prisma.Decimal.toString() emits exponential notation for magnitudes >= 1e21,
    // which corrupts the digit-only raw string contract relied on downstream.
    // toFixed() always yields fixed-point, digit-only output.
    token0AmountRaw:
      typeof record.token0AmountRaw === "string"
        ? record.token0AmountRaw
        : (record.token0AmountRaw as { toFixed(): string }).toFixed(),
    token1Address: record.token1Address as string,
    token1AssetIdSnapshot: record.token1AssetIdSnapshot as string,
    token1DecimalsSnapshot: record.token1DecimalsSnapshot as number,
    token1AmountRaw:
      typeof record.token1AmountRaw === "string"
        ? record.token1AmountRaw
        : (record.token1AmountRaw as { toFixed(): string }).toFixed(),
    lpTokenAddress: record.lpTokenAddress as string,
    lpAssetIdSnapshot: record.lpAssetIdSnapshot as string,
    lpDecimalsSnapshot: record.lpDecimalsSnapshot as number,
    lpAmountRaw:
      typeof record.lpAmountRaw === "string"
        ? record.lpAmountRaw
        : (record.lpAmountRaw as { toFixed(): string }).toFixed(),
    feeAssetIdSnapshot: record.feeAssetIdSnapshot as string,
    feeDecimalsSnapshot: record.feeDecimalsSnapshot as number,
    feeAmountRaw:
      typeof record.feeAmountRaw === "string"
        ? record.feeAmountRaw
        : (record.feeAmountRaw as { toFixed(): string }).toFixed(),
  }));
}

export async function readWalletRawStakeActions(
  args: {
    chainId: number;
    walletAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  client: RawStakeActionReadClient = getDb(),
) {
  const walletAddress = args.walletAddress.toLowerCase();
  const records = await client.rawStakeAction.findMany({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      blockNumber: {
        gte: args.fromBlock,
        lte: args.toBlock,
      },
      initiatorAddress: walletAddress,
    },
    orderBy: [{ blockNumber: "asc" }, { actionIndex: "asc" }],
  });

  return records.map((record) => ({
    chainId: record.chainId as number,
    protocolSlug: record.protocolSlug as string,
    actionKind: record.actionKind as "START" | "END",
    txHash: record.txHash as string,
    blockNumber: record.blockNumber as bigint,
    blockHash: record.blockHash as string,
    actionIndex: record.actionIndex as number,
    contractAddress: record.contractAddress as string,
    initiatorAddress: record.initiatorAddress as string,
    stakeId:
      typeof record.stakeId === "bigint"
        ? record.stakeId
        : record.stakeId == null
          ? null
          : BigInt(record.stakeId as string),
    stakeIndex: typeof record.stakeIndex === "number" ? record.stakeIndex : null,
    stakedDays: typeof record.stakedDays === "number" ? record.stakedDays : null,
    tokenAddress: record.tokenAddress as string,
    assetIdSnapshot: record.assetIdSnapshot as string,
    decimalsSnapshot: record.decimalsSnapshot as number,
    // Decimal(78, 0) columns: serialize with toFixed() rather than toString().
    // Prisma.Decimal.toString() emits exponential notation for magnitudes >= 1e21
    // (e.g. "1.17038473047e+22"), which fails the /^\d+$/ canonical quantity guard
    // downstream. toFixed() always yields fixed-point, digit-only output.
    principalLockedRaw:
      record.principalLockedRaw == null
        ? null
        : typeof record.principalLockedRaw === "string"
          ? record.principalLockedRaw
          : (record.principalLockedRaw as { toFixed(): string }).toFixed(),
    totalReturnedRaw:
      record.totalReturnedRaw == null
        ? null
        : typeof record.totalReturnedRaw === "string"
          ? record.totalReturnedRaw
          : (record.totalReturnedRaw as { toFixed(): string }).toFixed(),
    principalReturnedRaw:
      record.principalReturnedRaw == null
        ? null
        : typeof record.principalReturnedRaw === "string"
          ? record.principalReturnedRaw
          : (record.principalReturnedRaw as { toFixed(): string }).toFixed(),
    yieldRaw:
      record.yieldRaw == null
        ? null
        : typeof record.yieldRaw === "string"
          ? record.yieldRaw
          : (record.yieldRaw as { toFixed(): string }).toFixed(),
    penaltyRaw:
      record.penaltyRaw == null
        ? null
        : typeof record.penaltyRaw === "string"
          ? record.penaltyRaw
          : (record.penaltyRaw as { toFixed(): string }).toFixed(),
    feeAssetIdSnapshot: record.feeAssetIdSnapshot as string,
    feeDecimalsSnapshot: record.feeDecimalsSnapshot as number,
    feeAmountRaw:
      typeof record.feeAmountRaw === "string"
        ? record.feeAmountRaw
        : (record.feeAmountRaw as { toFixed(): string }).toFixed(),
  }));
}

export async function readStakeStartSnapshotByStakeId(
  args: {
    chainId: number;
    walletAddress: string;
    stakeId: bigint;
  },
  client: RawStakeActionReadClient = getDb(),
) {
  const record = await client.rawStakeAction.findFirst?.({
    where: {
      chainId: args.chainId,
      status: "ACTIVE",
      initiatorAddress: args.walletAddress.toLowerCase(),
      actionKind: "START",
      stakeId: args.stakeId,
    },
    orderBy: [{ blockNumber: "desc" }, { actionIndex: "desc" }],
  });

  if (!record) {
    return null;
  }

  const [mapped] = await readWalletRawStakeActions(
    {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      fromBlock: record.blockNumber as bigint,
      toBlock: record.blockNumber as bigint,
    },
    {
      rawStakeAction: {
        findMany: async () => [record],
      },
    },
  );

  return mapped ?? null;
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

  const [rawBlocks, rawTransactions, rawLogs, rawTokenTransfers, rawDexSwaps, rawLpActions, rawStakeActions] =
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
      client.rawDexSwap.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
      client.rawLpAction.updateMany({
        where,
        data: {
          status: "REORGED",
        },
      }),
      client.rawStakeAction.updateMany({
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
    rawDexSwaps: rawDexSwaps.count,
    rawLpActions: rawLpActions.count,
    rawStakeActions: rawStakeActions.count,
  };
}

function toTopicAddress(address: string) {
  return `0x000000000000000000000000${address.toLowerCase().replace(/^0x/, "")}`;
}
