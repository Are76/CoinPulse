import { describe, expect, it } from "vitest";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";
import { rebuildCanonicalLedger } from "@/services/rebuild/rebuild-ledger";

type RawBlockRecord = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
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

type RawLpActionRecord = {
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

type ActionGroupRecord = {
  id: string;
  chainId: number;
  walletId: string;
  txHash: string;
  actionGroupKey: string;
  actionType: string;
  occurredAt: Date;
};

type LedgerEntryRecord = {
  id: string;
  chainId: number;
  walletId: string;
  actionGroupId: string;
  tokenId: string | null;
  txHash: string;
  entryType: string;
  assetId: string;
  quantity: string;
  valueUsd: string | null;
  direction: string;
  normalizerVersion: string;
  occurredAt: Date;
  sourceLogIndex: number | null;
  sourceLogKey: string;
  dedupeKey: string;
};

function createDraft(
  overrides: Partial<CanonicalLedgerEntryDraft> = {},
): CanonicalLedgerEntryDraft {
  return {
    chainId: 369,
    walletId: "wallet_1",
    walletAddress: WALLET_ADDRESS,
    txHash: "0xseed",
    blockNumber: 1n,
    actionType: "TRANSFER",
    actionGroupKey: "seed-group",
    entryType: "RECEIVE",
    assetId: "chain:369:erc20:0xseed",
    quantity: "1",
    direction: "IN",
    occurredAt: new Date("2026-05-08T10:00:00.000Z"),
    normalizerVersion: "v0",
    sourceLogIndex: 0,
    sourceLogKey: "log:0xseed:0:seed",
    dedupeKey: "seed-dedupe",
    ...overrides,
  };
}

const WALLET_ID = "wallet_1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

function createMemoryDb() {
  const rawBlocks: RawBlockRecord[] = [];
  const rawTokenTransfers: RawTokenTransferRecord[] = [];
  const rawDexSwaps: RawDexSwapRecord[] = [];
  const rawLpActions: RawLpActionRecord[] = [];
  const rawStakeActions: RawStakeActionRecord[] = [];
  const ledgerActionGroups = new Map<string, ActionGroupRecord>();
  const ledgerEntries = new Map<string, LedgerEntryRecord>();

  const db = {
    rawBlock: {
      async findMany(args: {
        where: { chainId: number; blockNumber: { gte: bigint; lte: bigint } };
      }) {
        return rawBlocks.filter(
          (record) =>
            record.chainId === args.where.chainId &&
            record.blockNumber >= args.where.blockNumber.gte &&
            record.blockNumber <= args.where.blockNumber.lte,
        );
      },
    },
    rawTokenTransfer: {
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          OR: Array<{ fromAddress?: string; toAddress?: string }>;
        };
      }) {
        const addresses = new Set(
          args.where.OR.flatMap((item) => [item.fromAddress, item.toAddress].filter(Boolean)),
        );

        return rawTokenTransfers
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              (addresses.has(record.fromAddress) || addresses.has(record.toAddress)),
          )
          .sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.logIndex - b.logIndex
              : Number(a.blockNumber - b.blockNumber),
          );
      },
    },
    rawDexSwap: {
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          initiatorAddress: string;
        };
      }) {
        return rawDexSwaps
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              record.initiatorAddress === args.where.initiatorAddress,
          )
          .sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.logIndex - b.logIndex
              : Number(a.blockNumber - b.blockNumber),
          );
      },
    },
    rawLpAction: {
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          initiatorAddress: string;
        };
      }) {
        return rawLpActions
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              record.initiatorAddress === args.where.initiatorAddress,
          )
          .sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.logIndex - b.logIndex
              : Number(a.blockNumber - b.blockNumber),
          );
      },
    },
    rawStakeAction: {
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          initiatorAddress: string;
        };
      }) {
        return rawStakeActions
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              record.initiatorAddress === args.where.initiatorAddress,
          )
          .sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.actionIndex - b.actionIndex
              : Number(a.blockNumber - b.blockNumber),
          );
      },
    },
    ledgerActionGroup: {
      async createMany(args: { data: ActionGroupRecord[] }) {
        let count = 0;
        for (const record of args.data) {
          if (!ledgerActionGroups.has(record.id)) {
            ledgerActionGroups.set(record.id, record);
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId: number;
          walletId: string;
          txHash: { in: string[] };
          actionType: { in: string[] };
        };
      }) {
        return Array.from(ledgerActionGroups.values()).filter(
          (record) =>
            record.chainId === args.where.chainId &&
            record.walletId === args.where.walletId &&
            args.where.txHash.in.includes(record.txHash) &&
            args.where.actionType.in.includes(record.actionType),
        );
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        let count = 0;
        for (const id of args.where.id.in) {
          if (ledgerActionGroups.delete(id)) {
            count += 1;
          }
        }
        return { count };
      },
    },
    ledgerEntry: {
      async createMany(args: { data: LedgerEntryRecord[] }) {
        let count = 0;
        for (const record of args.data) {
          if (!ledgerEntries.has(record.id)) {
            ledgerEntries.set(record.id, record);
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId?: number;
          walletId?: string;
          actionGroupId?: { in: string[] };
        };
      }) {
        return Array.from(ledgerEntries.values()).filter(
          (record) =>
            (typeof args.where.chainId !== "number" || record.chainId === args.where.chainId) &&
            (typeof args.where.walletId !== "string" || record.walletId === args.where.walletId) &&
            (!args.where.actionGroupId || args.where.actionGroupId.in.includes(record.actionGroupId)),
        );
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        let count = 0;
        for (const id of args.where.id.in) {
          if (ledgerEntries.delete(id)) {
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return {
    db,
    rawBlocks,
    rawTokenTransfers,
    rawDexSwaps,
    rawLpActions,
    rawStakeActions,
    ledgerActionGroups,
    ledgerEntries,
  };
}

async function seedLedger(
  db: ReturnType<typeof createMemoryDb>["db"],
  drafts: CanonicalLedgerEntryDraft[],
) {
  return persistNormalizedLedger(drafts, db as never);
}

describe("rebuildCanonicalLedger", () => {
  it("rebuilds canonical transfer entries from raw transfer snapshots and preserves unrelated entries", async () => {
    const stores = createMemoryDb();
    const rawTransfer = {
      chainId: 369,
      tokenId: "token_1",
      tokenAddress: "0xtoken",
      assetIdSnapshot: "chain:369:erc20:0xtoken",
      decimalsSnapshot: 6,
      txHash: "0xtx-transfer",
      blockNumber: 100n,
      blockHash: "0xblock100",
      logIndex: 1,
      fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000",
      status: "ACTIVE" as const,
    };
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 100n,
      blockHash: "0xblock100",
      timestamp: new Date("2026-05-08T10:00:00.000Z"),
    });
    stores.rawTokenTransfers.push(rawTransfer);

    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xtx-transfer",
        actionGroupKey: "wrong-transfer-group",
        dedupeKey: "wrong-transfer-dedupe",
        assetId: "chain:369:erc20:0xwrong",
        entryType: "SEND",
        direction: "OUT",
        sourceLogKey: "log:0xtx-transfer:wrong",
      }),
      createDraft({
        txHash: "0xunrelated-dex",
        actionType: "SWAP",
        actionGroupKey: "unrelated-dex-group",
        dedupeKey: "unrelated-dex-dedupe",
        entryType: "SWAP_OUT",
        direction: "OUT",
        sourceLogKey: "log:0xunrelated-dex:0",
      }),
    ]);

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 100n,
      toBlock: 100n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(1);
    expect(report.ledgerEntriesDeleted).toBe(1);
    expect(report.ledgerEntriesRecreated).toBe(1);
    expect(report.skippedCount).toBe(0);
    expect(report.skippedSnapshots).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(stores.rawTokenTransfers).toEqual([rawTransfer]);
    expect(Array.from(stores.ledgerEntries.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txHash: "0xtx-transfer",
          entryType: "RECEIVE",
          assetId: "chain:369:erc20:0xtoken",
          quantity: "1",
        }),
        expect.objectContaining({
          txHash: "0xunrelated-dex",
          entryType: "SWAP_OUT",
        }),
      ]),
    );
  });

  it("rebuilds canonical dex swap entries from raw swap snapshots", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 101n,
      blockHash: "0xblock101",
      timestamp: new Date("2026-05-08T10:05:00.000Z"),
    });
    stores.rawDexSwaps.push({
      chainId: 369,
      protocolSlug: "pulsex",
      txHash: "0xtx-swap",
      blockNumber: 101n,
      blockHash: "0xblock101",
      logIndex: 5,
      pairAddress: "0xpair",
      initiatorAddress: WALLET_ADDRESS,
      counterpartyAddress: "0xrouter",
      soldTokenAddress: "0xsold",
      soldAssetIdSnapshot: "chain:369:erc20:0xsold",
      soldDecimalsSnapshot: 6,
      soldAmountRaw: "5000000",
      boughtTokenAddress: "0xbought",
      boughtAssetIdSnapshot: "chain:369:erc20:0xbought",
      boughtDecimalsSnapshot: 18,
      boughtAmountRaw: "3000000000000000000",
      feeAssetIdSnapshot: "chain:369:native:PLS",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "200000000000000",
      status: "ACTIVE",
    });

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 101n,
      toBlock: 101n,
      sourceFamilies: ["DEX"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(1);
    expect(report.ledgerEntriesDeleted).toBe(0);
    expect(report.ledgerEntriesRecreated).toBe(3);
    expect(Array.from(stores.ledgerEntries.values()).map((entry) => entry.entryType)).toEqual([
      "SWAP_OUT",
      "SWAP_IN",
      "FEE",
    ]);
  });

  it("rebuilds canonical lp entries from raw lp snapshots", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 102n,
      blockHash: "0xblock102",
      timestamp: new Date("2026-05-08T10:10:00.000Z"),
    });
    stores.rawLpActions.push({
      chainId: 369,
      protocolSlug: "pulsex",
      actionKind: "ADD",
      txHash: "0xtx-lp",
      blockNumber: 102n,
      blockHash: "0xblock102",
      logIndex: 6,
      pairAddress: "0xlp",
      initiatorAddress: WALLET_ADDRESS,
      counterpartyAddress: "0xrouter",
      token0Address: "0xtoken0",
      token0AssetIdSnapshot: "chain:369:erc20:0xtoken0",
      token0DecimalsSnapshot: 18,
      token0AmountRaw: "1000000000000000000",
      token1Address: "0xtoken1",
      token1AssetIdSnapshot: "chain:369:erc20:0xtoken1",
      token1DecimalsSnapshot: 6,
      token1AmountRaw: "5000000",
      lpTokenAddress: "0xlp",
      lpAssetIdSnapshot: "chain:369:erc20:0xlp",
      lpDecimalsSnapshot: 18,
      lpAmountRaw: "100000000000000000",
      feeAssetIdSnapshot: "chain:369:native:PLS",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "200000000000000",
      status: "ACTIVE",
    });

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 102n,
      toBlock: 102n,
      sourceFamilies: ["LP"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(1);
    expect(report.ledgerEntriesRecreated).toBe(4);
    expect(Array.from(stores.ledgerEntries.values()).map((entry) => entry.entryType)).toEqual([
      "LP_ADD_OUT",
      "LP_ADD_OUT",
      "LP_ADD_IN",
      "FEE",
    ]);
  });

  it("rebuilds canonical stake entries from raw stake snapshots", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 103n,
      blockHash: "0xblock103",
      timestamp: new Date("2026-05-08T10:15:00.000Z"),
    });
    stores.rawStakeActions.push({
      chainId: 369,
      protocolSlug: "hex",
      actionKind: "END",
      txHash: "0xtx-stake",
      blockNumber: 103n,
      blockHash: "0xblock103",
      actionIndex: 0,
      contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      initiatorAddress: WALLET_ADDRESS,
      stakeId: 42n,
      stakeIndex: 3,
      stakedDays: 365,
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot:
        "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimalsSnapshot: 8,
      principalLockedRaw: null,
      totalReturnedRaw: "105000000",
      principalReturnedRaw: "100000000",
      yieldRaw: "5000000",
      penaltyRaw: null,
      feeAssetIdSnapshot: "chain:369:native:PLS",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "300000000000000",
      status: "ACTIVE",
    });

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 103n,
      toBlock: 103n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(1);
    expect(report.ledgerEntriesRecreated).toBe(4);
    expect(Array.from(stores.ledgerEntries.values()).map((entry) => entry.entryType)).toEqual([
      "STAKE_END",
      "STAKE_PRINCIPAL_RETURNED",
      "STAKE_YIELD_RECEIVED",
      "FEE",
    ]);
  });

  it("rebuilds mixed source families in one run", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push(
      {
        chainId: 369,
        blockNumber: 104n,
        blockHash: "0xblock104",
        timestamp: new Date("2026-05-08T10:20:00.000Z"),
      },
      {
        chainId: 369,
        blockNumber: 105n,
        blockHash: "0xblock105",
        timestamp: new Date("2026-05-08T10:25:00.000Z"),
      },
    );
    stores.rawTokenTransfers.push({
      chainId: 369,
      tokenId: "token_1",
      tokenAddress: "0xtoken",
      assetIdSnapshot: "chain:369:erc20:0xtoken",
      decimalsSnapshot: 6,
      txHash: "0xtx-transfer-2",
      blockNumber: 104n,
      blockHash: "0xblock104",
      logIndex: 1,
      fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000",
      status: "ACTIVE",
    });
    stores.rawDexSwaps.push({
      chainId: 369,
      protocolSlug: "pulsex",
      txHash: "0xtx-swap-2",
      blockNumber: 105n,
      blockHash: "0xblock105",
      logIndex: 2,
      pairAddress: "0xpair",
      initiatorAddress: WALLET_ADDRESS,
      counterpartyAddress: "0xrouter",
      soldTokenAddress: "0xsold",
      soldAssetIdSnapshot: "chain:369:erc20:0xsold",
      soldDecimalsSnapshot: 6,
      soldAmountRaw: "2500000",
      boughtTokenAddress: "0xbought",
      boughtAssetIdSnapshot: "chain:369:erc20:0xbought",
      boughtDecimalsSnapshot: 18,
      boughtAmountRaw: "1000000000000000000",
      feeAssetIdSnapshot: "chain:369:native:PLS",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "100000000000000",
      status: "ACTIVE",
    });

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 104n,
      toBlock: 105n,
      sourceFamilies: ["TRANSFERS", "DEX"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(2);
    expect(report.ledgerEntriesRecreated).toBe(4);
    expect(report.sourceFamiliesIncluded).toEqual(["TRANSFERS", "DEX"]);
  });

  it("is idempotent across repeated rebuilds", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 106n,
      blockHash: "0xblock106",
      timestamp: new Date("2026-05-08T10:30:00.000Z"),
    });
    stores.rawTokenTransfers.push({
      chainId: 369,
      tokenId: "token_1",
      tokenAddress: "0xtoken",
      assetIdSnapshot: "chain:369:erc20:0xtoken",
      decimalsSnapshot: 6,
      txHash: "0xtx-transfer-3",
      blockNumber: 106n,
      blockHash: "0xblock106",
      logIndex: 1,
      fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000",
      status: "ACTIVE",
    });

    const first = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 106n,
      toBlock: 106n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });
    const second = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 106n,
      toBlock: 106n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    expect(first.ledgerEntriesRecreated).toBe(1);
    expect(second.ledgerEntriesDeleted).toBe(1);
    expect(second.ledgerEntriesRecreated).toBe(1);
    expect(stores.ledgerEntries.size).toBe(1);
  });

  it("does not delete unrelated same-family ledger entries outside the selected raw scope", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 107n,
      blockHash: "0xblock107",
      timestamp: new Date("2026-05-08T10:35:00.000Z"),
    });
    stores.rawTokenTransfers.push({
      chainId: 369,
      tokenId: "token_1",
      tokenAddress: "0xtoken",
      assetIdSnapshot: "chain:369:erc20:0xtoken",
      decimalsSnapshot: 6,
      txHash: "0xtx-transfer-4",
      blockNumber: 107n,
      blockHash: "0xblock107",
      logIndex: 1,
      fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000",
      status: "ACTIVE",
    });

    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xoutside-scope",
        actionGroupKey: "outside-scope-group",
        dedupeKey: "outside-scope-dedupe",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xoutside-scope:0",
      }),
    ]);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 107n,
      toBlock: 107n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    expect(Array.from(stores.ledgerEntries.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ txHash: "0xoutside-scope" }),
        expect.objectContaining({ txHash: "0xtx-transfer-4" }),
      ]),
    );
  });
});
