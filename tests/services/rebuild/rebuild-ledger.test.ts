import { describe, expect, it, vi } from "vitest";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { LEDGER_PERSIST_TRANSACTION_OPTIONS, persistNormalizedLedger } from "@/services/sync/ledger-store";
import { rebuildCanonicalLedger } from "@/services/rebuild/rebuild-ledger";

type RawBlockRecord = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  timestamp: Date;
};

type RawTokenTransferRecord = {
  id?: string;
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
  id?: string;
  rawTransferEvidenceStatus?: "RECORDED" | "VERIFIED_EMPTY" | null;
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

type RawStakeActionTransferEvidenceRecord = {
  id: string;
  rawStakeActionId: string;
  rawTokenTransferId: string;
  legRole: string;
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
  const rawTransactions: RawTransactionRecord[] = [];
  const rawDexSwaps: RawDexSwapRecord[] = [];
  const rawLpActions: RawLpActionRecord[] = [];
  const rawStakeActions: RawStakeActionRecord[] = [];
  const rawStakeActionTransferEvidence: RawStakeActionTransferEvidenceRecord[] = [];
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
      // Two call shapes: the TRANSFERS-family raw read (blockNumber range +
      // wallet OR), and the transfer-shadow-reconciliation read (exact
      // txHash set) used by ledger-store.ts's reconcileConsumedTransferShadows.
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber?: { gte: bigint; lte: bigint };
          OR?: Array<{ fromAddress?: string; toAddress?: string }>;
          txHash?: { in: string[] };
        };
      }) {
        if (args.where.txHash) {
          const txHashes = new Set(args.where.txHash.in);
          return rawTokenTransfers.filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              txHashes.has(record.txHash),
          );
        }

        const addresses = new Set(
          (args.where.OR ?? []).flatMap((item) => [item.fromAddress, item.toAddress].filter(Boolean)),
        );

        return rawTokenTransfers
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              args.where.blockNumber !== undefined &&
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
    rawTransaction: {
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

        return rawTransactions
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              (addresses.has(record.fromAddress) || (record.toAddress ? addresses.has(record.toAddress) : false)),
          )
          .sort((a, b) =>
            a.blockNumber === b.blockNumber
              ? a.transactionIndex - b.transactionIndex
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
    // No dex/lp provenance is exercised by these fixtures; always empty,
    // matching production shape (findMany, not a rejection).
    rawDexSwapTransferEvidence: {
      async findMany() {
        return [] as Array<{ rawTokenTransferId: string }>;
      },
    },
    rawLpActionTransferEvidence: {
      async findMany() {
        return [] as Array<{ rawTokenTransferId: string }>;
      },
    },
    rawStakeActionTransferEvidence: {
      async findMany(args: { where: { rawTokenTransferId: { in: string[] } } }) {
        const wantedIds = new Set(args.where.rawTokenTransferId.in);
        return rawStakeActionTransferEvidence
          .filter((row) => wantedIds.has(row.rawTokenTransferId))
          .filter((row) => {
            const transfer = rawTokenTransfers.find((t) => t.id === row.rawTokenTransferId);
            const action = rawStakeActions.find((a) => a.id === row.rawStakeActionId);
            return (
              transfer?.status === "ACTIVE" &&
              action?.status === "ACTIVE" &&
              action?.rawTransferEvidenceStatus === "RECORDED"
            );
          })
          .map((row) => ({ rawTokenTransferId: row.rawTokenTransferId }));
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
          chainId?: number | { in: number[] };
          walletId?: string | { in: string[] };
          txHash?: { in: string[] };
          entryType?: string;
          direction?: string;
          actionGroupId?: { in: string[] };
        };
      }) {
        const chainIdOk = (chainId: number) => {
          if (args.where.chainId === undefined) return true;
          if (typeof args.where.chainId === "number") return chainId === args.where.chainId;
          return args.where.chainId.in.includes(chainId);
        };
        const walletIdOk = (walletId: string) => {
          if (args.where.walletId === undefined) return true;
          if (typeof args.where.walletId === "string") return walletId === args.where.walletId;
          return args.where.walletId.in.includes(walletId);
        };

        return Array.from(ledgerEntries.values()).filter(
          (record) =>
            chainIdOk(record.chainId) &&
            walletIdOk(record.walletId) &&
            (!args.where.txHash || args.where.txHash.in.includes(record.txHash)) &&
            (!args.where.entryType || record.entryType === args.where.entryType) &&
            (!args.where.direction || record.direction === args.where.direction) &&
            (!args.where.actionGroupId || args.where.actionGroupId.in.includes(record.actionGroupId)),
        );
      },
      async updateMany(args: {
        where: { id: { in: string[] } };
        data: { actionGroupId: string };
      }) {
        let count = 0;
        for (const id of args.where.id.in) {
          const record = ledgerEntries.get(id);
          if (record) {
            record.actionGroupId = args.data.actionGroupId;
            count += 1;
          }
        }
        return { count };
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
    rawTransactions,
    rawDexSwaps,
    rawLpActions,
    rawStakeActions,
    rawStakeActionTransferEvidence,
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

  it("rebuilds native transfer and sender fee entries from persisted raw transactions", async () => {
    const stores = createMemoryDb();
    stores.rawBlocks.push(
      {
        chainId: 369,
        blockNumber: 100n,
        blockHash: "0xblock100",
        timestamp: new Date("2026-05-08T10:00:00.000Z"),
      },
      {
        chainId: 369,
        blockNumber: 101n,
        blockHash: "0xblock101",
        timestamp: new Date("2026-05-08T10:01:00.000Z"),
      },
    );
    stores.rawTransactions.push(
      {
        chainId: 369,
        txHash: "0xnative-send",
        blockNumber: 100n,
        blockHash: "0xblock100",
        transactionIndex: 0,
        fromAddress: WALLET_ADDRESS,
        toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        valueRaw: "1000000000000000000",
        gasPriceRaw: "2000000000",
        gasUsedRaw: "21000",
        status: "ACTIVE",
      },
      {
        chainId: 369,
        txHash: "0xnative-receive",
        blockNumber: 101n,
        blockHash: "0xblock101",
        transactionIndex: 0,
        fromAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        toAddress: WALLET_ADDRESS,
        valueRaw: "250000000000000000",
        gasPriceRaw: "2000000000",
        gasUsedRaw: "21000",
        status: "ACTIVE",
      },
    );

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 100n,
      toBlock: 101n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    expect(report.rawSnapshotsProcessed).toBe(2);
    expect(report.ledgerEntriesRecreated).toBe(3);
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
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
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
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
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
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
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

  it("suppresses the canonical-evidenced generic TRANSFER shadow and emits STAKE_RETURN_UNALLOCATED exactly once, not twice and not zero times", async () => {
    const stores = createMemoryDb();
    const PHEX_ASSET_ID = "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
    const RETURN_TX_HASH = "0xtx-stake-return";
    const RETURN_BLOCK_HASH = "0xblock105";

    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 105n,
      blockHash: RETURN_BLOCK_HASH,
      timestamp: new Date("2026-05-08T10:20:00.000Z"),
    });

    // The exact evidenced RETURN_IN raw transfer for this stake end.
    stores.rawTokenTransfers.push({
      id: "rt-return-1",
      chainId: 369,
      tokenId: "token_phex",
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot: PHEX_ASSET_ID,
      decimalsSnapshot: 8,
      txHash: RETURN_TX_HASH,
      blockNumber: 105n,
      blockHash: RETURN_BLOCK_HASH,
      logIndex: 7,
      fromAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      toAddress: WALLET_ADDRESS,
      amountRaw: "2233755002516",
      status: "ACTIVE",
    });

    // The canonical STAKE END action, with the unknown-decomposition shape:
    // totalReturnedRaw known, principal/yield/penalty unknown (no matching
    // START row) — the exact production shape proven in the prior read-only
    // investigation. rawTransferEvidenceStatus RECORDED means PR #377's
    // suppression is authorized to consume the evidenced transfer above.
    stores.rawStakeActions.push({
      id: "stake-end-return-1",
      rawTransferEvidenceStatus: "RECORDED",
      chainId: 369,
      protocolSlug: "hex",
      actionKind: "END",
      txHash: RETURN_TX_HASH,
      blockNumber: 105n,
      blockHash: RETURN_BLOCK_HASH,
      actionIndex: 0,
      contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      initiatorAddress: WALLET_ADDRESS,
      stakeId: 800372n,
      stakeIndex: 5,
      stakedDays: 400,
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot: PHEX_ASSET_ID,
      decimalsSnapshot: 8,
      principalLockedRaw: null,
      totalReturnedRaw: "2233755002516",
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "300000000000000",
      status: "ACTIVE",
    });

    // Exact canonical provenance: this raw transfer is proven consumed by
    // this exact stake action's RETURN_IN leg. No txHash/amount/symbol
    // matching — this is the same evidence relation PR #377 reads.
    stores.rawStakeActionTransferEvidence.push({
      id: "ev-return-1",
      rawStakeActionId: "stake-end-return-1",
      rawTokenTransferId: "rt-return-1",
      legRole: "RETURN_IN",
    });

    // Simulate a pre-fix ledger: a stale generic TRANSFER shadow for the same
    // raw transfer, as it would have existed before this bounded fix and
    // before provenance suppression could observe RECORDED evidence.
    await seedLedger(stores.db, [
      createDraft({
        txHash: RETURN_TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "stale-transfer-shadow",
        dedupeKey: "stale-transfer-shadow-dedupe",
        assetId: PHEX_ASSET_ID,
        quantity: "22337.55002516",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 7,
        sourceLogKey: `log:${RETURN_TX_HASH}:7:transfer:receive`,
      }),
    ]);

    const report = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 105n,
      toBlock: 105n,
      sourceFamilies: ["TRANSFERS", "STAKING"],
      normalizerVersion: "v1",
    });

    const finalEntries = Array.from(stores.ledgerEntries.values());
    const finalGroups = Array.from(stores.ledgerActionGroups.values());

    // The stale TRANSFER shadow group is gone; suppression removed it and
    // normalizeTransfers never recreated it (isCanonicallySuppressedTransferShadow).
    expect(finalGroups.some((group) => group.actionType === "TRANSFER")).toBe(false);
    expect(finalEntries.some((entry) => entry.entryType === "RECEIVE")).toBe(false);

    // The STAKING-family group carries the quantity-preserving fallback
    // instead — never relabeled as principal or yield.
    expect(finalEntries.map((entry) => entry.entryType).sort()).toEqual(
      ["FEE", "STAKE_END", "STAKE_RETURN_UNALLOCATED"].sort(),
    );
    expect(finalEntries.some((entry) => entry.entryType === "STAKE_PRINCIPAL_RETURNED")).toBe(
      false,
    );
    expect(finalEntries.some((entry) => entry.entryType === "STAKE_YIELD_RECEIVED")).toBe(false);

    const unallocated = finalEntries.find(
      (entry) => entry.entryType === "STAKE_RETURN_UNALLOCATED",
    );
    expect(unallocated?.quantity).toBe("22337.55002516");
    expect(unallocated?.direction).toBe("IN");

    // The exact wallet-facing pHEX movement across the ENTIRE final ledger
    // appears exactly once: not 2X (double count from an un-suppressed
    // shadow) and not 0 (lost value). Compared as exact strings, never
    // Number()/parseFloat() — there is exactly one non-internal pHEX entry.
    const nonInternalPhexEntries = finalEntries.filter(
      (entry) => entry.assetId === PHEX_ASSET_ID && entry.direction !== "INTERNAL",
    );
    expect(nonInternalPhexEntries).toHaveLength(1);
    expect(nonInternalPhexEntries[0]?.quantity).toBe("22337.55002516");
    expect(nonInternalPhexEntries[0]?.direction).toBe("IN");

    expect(report.warnings).toEqual([]);
  });

  // ─── P1 test matrix: cross-family transfer-shadow reconciliation ──────────
  //
  // Shared fixture builder for the P1-A..P1-F scenarios below. Two
  // RawTokenTransfer legs in the same tx: one exactly evidenced by the STAKE
  // END action (the reconciliation target), one unrelated (must never be
  // touched — no txHash/amount/symbol matching).
  function seedP1Fixture(stores: ReturnType<typeof createMemoryDb>) {
    const PHEX_ASSET_ID = "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
    const TX_HASH = "0xtx-p1";
    const BLOCK_HASH = "0xblock-p1";

    stores.rawBlocks.push({
      chainId: 369,
      blockNumber: 200n,
      blockHash: BLOCK_HASH,
      timestamp: new Date("2026-05-08T11:00:00.000Z"),
    });

    // The exact evidenced RETURN_IN transfer.
    stores.rawTokenTransfers.push({
      id: "rt-p1-evidenced",
      chainId: 369,
      tokenId: "token_phex",
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot: PHEX_ASSET_ID,
      decimalsSnapshot: 8,
      txHash: TX_HASH,
      blockNumber: 200n,
      blockHash: BLOCK_HASH,
      logIndex: 3,
      fromAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000000000",
      status: "ACTIVE",
    });

    // Unrelated same-tx transfer: same asset, deliberately NOT evidenced —
    // must survive every scenario below (P1-D/E).
    stores.rawTokenTransfers.push({
      id: "rt-p1-unrelated",
      chainId: 369,
      tokenId: "token_phex",
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot: PHEX_ASSET_ID,
      decimalsSnapshot: 8,
      txHash: TX_HASH,
      blockNumber: 200n,
      blockHash: BLOCK_HASH,
      logIndex: 9,
      fromAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      toAddress: WALLET_ADDRESS,
      amountRaw: "1000000000000",
      status: "ACTIVE",
    });

    stores.rawStakeActions.push({
      id: "stake-end-p1",
      rawTransferEvidenceStatus: "RECORDED",
      chainId: 369,
      protocolSlug: "hex",
      actionKind: "END",
      txHash: TX_HASH,
      blockNumber: 200n,
      blockHash: BLOCK_HASH,
      actionIndex: 0,
      contractAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      initiatorAddress: WALLET_ADDRESS,
      stakeId: 900001n,
      stakeIndex: 1,
      stakedDays: 100,
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      assetIdSnapshot: PHEX_ASSET_ID,
      decimalsSnapshot: 8,
      principalLockedRaw: null,
      totalReturnedRaw: "1000000000000",
      principalReturnedRaw: null,
      yieldRaw: null,
      penaltyRaw: null,
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
      feeDecimalsSnapshot: 18,
      feeAmountRaw: "300000000000000",
      status: "ACTIVE",
    });

    // Exact canonical provenance for the evidenced leg only — the unrelated
    // leg deliberately has none.
    stores.rawStakeActionTransferEvidence.push({
      id: "ev-p1",
      rawStakeActionId: "stake-end-p1",
      rawTokenTransferId: "rt-p1-evidenced",
      legRole: "RETURN_IN",
    });

    return { PHEX_ASSET_ID, TX_HASH, BLOCK_HASH };
  }

  function phexMovements(
    stores: ReturnType<typeof createMemoryDb>,
    assetId: string,
  ) {
    return Array.from(stores.ledgerEntries.values()).filter(
      (entry) => entry.assetId === assetId && entry.direction !== "INTERNAL",
    );
  }

  it("P1-A: TRANSFERS persisted first (no evidence yet), STAKING recorded later reconciles the stale shadow", async () => {
    const stores = createMemoryDb();
    const { PHEX_ASSET_ID, TX_HASH } = seedP1Fixture(stores);

    // Step 1: TRANSFERS-only rebuild runs BEFORE evidence exists. Simulate
    // "before evidence" by temporarily clearing it, matching a live first
    // sync where TRANSFERS (source-families.ts order) runs before STAKING
    // has ever recorded RawStakeActionTransferEvidence.
    const evidenceBackup = stores.rawStakeActionTransferEvidence.splice(0);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    // Both transfers materialize as generic TRANSFER shadows — expected,
    // since no evidence existed yet to suppress the evidenced one.
    expect(phexMovements(stores, PHEX_ASSET_ID)).toHaveLength(2);
    expect(
      Array.from(stores.ledgerActionGroups.values()).filter(
        (g) => g.actionType === "TRANSFER" && g.txHash === TX_HASH,
      ),
    ).toHaveLength(2);

    // Step 2: evidence now becomes RECORDED (as STAKING ingestion would do),
    // and STAKING runs — alone, no TRANSFERS in this call.
    stores.rawStakeActionTransferEvidence.push(...evidenceBackup);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    const finalEntries = Array.from(stores.ledgerEntries.values());
    const finalGroups = Array.from(stores.ledgerActionGroups.values());

    // Exactly one TRANSFER group survives — the unrelated one.
    const transferGroups = finalGroups.filter((g) => g.actionType === "TRANSFER");
    expect(transferGroups).toHaveLength(1);
    const survivingEntries = finalEntries.filter(
      (e) => e.actionGroupId === transferGroups[0]!.id,
    );
    expect(survivingEntries.map((e) => e.sourceLogIndex)).toEqual([9]);

    // STAKE_RETURN_UNALLOCATED now exists for the evidenced leg.
    expect(finalEntries.some((e) => e.entryType === "STAKE_RETURN_UNALLOCATED")).toBe(true);

    // The evidenced quantity appears exactly once across the whole ledger
    // (unrelated leg's own 1000000000000/1e8 = 10000 is separate and both
    // must be present): total non-internal pHEX entries = 2 (unrelated
    // TRANSFER + STAKE_RETURN_UNALLOCATED), never 3 (double count) or 1
    // (lost value).
    expect(phexMovements(stores, PHEX_ASSET_ID)).toHaveLength(2);
  });

  it("P1-B: STAKING recorded first, TRANSFERS processed later never introduces a shadow", async () => {
    const stores = createMemoryDb();
    const { PHEX_ASSET_ID } = seedP1Fixture(stores);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    const finalGroups = Array.from(stores.ledgerActionGroups.values());
    const transferGroups = finalGroups.filter((g) => g.actionType === "TRANSFER");
    // Suppression (readCanonicallyConsumedRawTokenTransferIds, unchanged by
    // this fix) already prevents the evidenced leg's shadow at normalization
    // time — only the unrelated leg's TRANSFER group exists.
    expect(transferGroups).toHaveLength(1);
    expect(phexMovements(stores, PHEX_ASSET_ID)).toHaveLength(2);
  });

  it("P1-C: STAKING-only rebuild reconciles a pre-existing stale shadow (no TRANSFERS in the same call)", async () => {
    const stores = createMemoryDb();
    const { PHEX_ASSET_ID, TX_HASH } = seedP1Fixture(stores);

    // Pre-existing stale shadow for the evidenced leg, seeded directly
    // (simulating an earlier run before this fix existed) — plus the
    // unrelated leg's own generic TRANSFER, which must survive.
    await seedLedger(stores.db, [
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "p1c-evidenced-shadow",
        dedupeKey: "p1c-evidenced-shadow-dedupe",
        assetId: PHEX_ASSET_ID,
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 3,
        sourceLogKey: `log:${TX_HASH}:3:transfer:receive`,
      }),
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "p1c-unrelated",
        dedupeKey: "p1c-unrelated-dedupe",
        assetId: PHEX_ASSET_ID,
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 9,
        sourceLogKey: `log:${TX_HASH}:9:transfer:receive`,
      }),
    ]);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    const finalEntries = Array.from(stores.ledgerEntries.values());
    const finalGroups = Array.from(stores.ledgerActionGroups.values());
    const transferGroups = finalGroups.filter((g) => g.actionType === "TRANSFER");

    expect(transferGroups).toHaveLength(1);
    const survivingEntries = finalEntries.filter(
      (e) => e.actionGroupId === transferGroups[0]!.id,
    );
    expect(survivingEntries.map((e) => e.sourceLogIndex)).toEqual([9]);
    expect(finalEntries.some((e) => e.entryType === "STAKE_RETURN_UNALLOCATED")).toBe(true);
    expect(phexMovements(stores, PHEX_ASSET_ID)).toHaveLength(2);
  });

  // ─── Group-deletion safety: a LedgerActionGroup may only be deleted when
  // every entry it owns is also being deleted (CodeRabbit critical finding).
  // transfer-normalizer.ts never actually produces a multi-entry TRANSFER
  // group, but reconcileConsumedTransferShadows must not rely on that
  // invariant holding — these tests force two entries into the same group
  // directly via seedLedger to prove the safety check itself, independent
  // of whether the assumption it guards against can occur today.

  it("reconciliation partial-group: deletes only the consumed shadow entry, preserves the group and its surviving sibling", async () => {
    const stores = createMemoryDb();
    const { PHEX_ASSET_ID, TX_HASH } = seedP1Fixture(stores);

    // Two entries deliberately sharing one actionGroupKey/actionGroupId: one
    // matches the evidenced transfer exactly (sourceLogIndex 3), one does
    // not (sourceLogIndex 9, no evidence) — simulating a group that, for
    // whatever reason, is not the usual single-entry TRANSFER shape.
    await seedLedger(stores.db, [
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "shared-group",
        dedupeKey: "shared-group-consumed",
        assetId: PHEX_ASSET_ID,
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 3,
        sourceLogKey: `log:${TX_HASH}:3:transfer:receive`,
      }),
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "shared-group",
        dedupeKey: "shared-group-surviving",
        assetId: PHEX_ASSET_ID,
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 9,
        sourceLogKey: `log:${TX_HASH}:9:transfer:receive`,
      }),
    ]);

    const groupsBefore = Array.from(stores.ledgerActionGroups.values()).filter(
      (g) => g.actionGroupKey === "shared-group",
    );
    expect(groupsBefore).toHaveLength(1);
    const sharedGroupId = groupsBefore[0]!.id;
    expect(
      Array.from(stores.ledgerEntries.values()).filter((e) => e.actionGroupId === sharedGroupId),
    ).toHaveLength(2);

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    // The group survives (FK-valid: still referenced by its surviving entry).
    expect(stores.ledgerActionGroups.has(sharedGroupId)).toBe(true);

    const survivingGroupEntries = Array.from(stores.ledgerEntries.values()).filter(
      (e) => e.actionGroupId === sharedGroupId,
    );
    expect(survivingGroupEntries).toHaveLength(1);
    expect(survivingGroupEntries[0]?.sourceLogIndex).toBe(9);
    expect(survivingGroupEntries[0]?.dedupeKey).toBe("shared-group-surviving");

    // No orphaned entry: every remaining LedgerEntry.actionGroupId still
    // resolves to an existing LedgerActionGroup.
    for (const entry of stores.ledgerEntries.values()) {
      expect(stores.ledgerActionGroups.has(entry.actionGroupId)).toBe(true);
    }

    expect(Array.from(stores.ledgerEntries.values()).some((e) => e.entryType === "STAKE_RETURN_UNALLOCATED")).toBe(
      true,
    );
  });

  it("reconciliation fully-consumed-group: deletes the entry and safely removes the now-empty group", async () => {
    const stores = createMemoryDb();
    const { TX_HASH } = seedP1Fixture(stores);

    await seedLedger(stores.db, [
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "fully-consumed-group",
        dedupeKey: "fully-consumed-only-entry",
        assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 3,
        sourceLogKey: `log:${TX_HASH}:3:transfer:receive`,
      }),
    ]);

    const sharedGroupId = Array.from(stores.ledgerActionGroups.values()).find(
      (g) => g.actionGroupKey === "fully-consumed-group",
    )!.id;

    await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    expect(stores.ledgerActionGroups.has(sharedGroupId)).toBe(false);
    expect(
      Array.from(stores.ledgerEntries.values()).some((e) => e.actionGroupId === sharedGroupId),
    ).toBe(false);
    // No orphan anywhere in the store.
    for (const entry of stores.ledgerEntries.values()) {
      expect(stores.ledgerActionGroups.has(entry.actionGroupId)).toBe(true);
    }
  });

  it("P1-F: repeated STAKING-only reconciliation is idempotent", async () => {
    const stores = createMemoryDb();
    const { PHEX_ASSET_ID, TX_HASH } = seedP1Fixture(stores);

    await seedLedger(stores.db, [
      createDraft({
        txHash: TX_HASH,
        actionType: "TRANSFER",
        actionGroupKey: "p1f-evidenced-shadow",
        dedupeKey: "p1f-evidenced-shadow-dedupe",
        assetId: PHEX_ASSET_ID,
        quantity: "10000",
        entryType: "RECEIVE",
        direction: "IN",
        sourceLogIndex: 3,
        sourceLogKey: `log:${TX_HASH}:3:transfer:receive`,
      }),
    ]);

    const runOnce = () =>
      rebuildCanonicalLedger({
        db: stores.db as never,
        wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
        fromBlock: 200n,
        toBlock: 200n,
        sourceFamilies: ["STAKING"],
        normalizerVersion: "v1",
      });

    await runOnce();
    const afterFirst = Array.from(stores.ledgerEntries.values())
      .map((e) => ({ entryType: e.entryType, quantity: e.quantity, direction: e.direction }))
      .sort((a, b) => a.entryType.localeCompare(b.entryType));

    await runOnce();
    const afterSecond = Array.from(stores.ledgerEntries.values())
      .map((e) => ({ entryType: e.entryType, quantity: e.quantity, direction: e.direction }))
      .sort((a, b) => a.entryType.localeCompare(b.entryType));

    expect(afterSecond).toEqual(afterFirst);
    expect(phexMovements(stores, PHEX_ASSET_ID)).toHaveLength(1);
  });

  it("opens the outer rebuild transaction with the same bounded, explicit maxWait/timeout used for ledger persistence", async () => {
    const stores = createMemoryDb();
    seedP1Fixture(stores);

    // Prisma's real interactive-transaction client never exposes $transaction
    // itself (no nested transactions) — the mock mirrors that by handing the
    // callback the same store object, which also lacks $transaction, proving
    // persistNormalizedLedger's inner wrapping correctly stays single-level
    // (it never attempts to open a second transaction here).
    const transactionSpy = vi.fn(
      async (
        callback: (client: unknown) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number },
      ) => {
        void options;
        return callback(stores.db);
      },
    );
    const dbWithTransaction = { ...stores.db, $transaction: transactionSpy };

    await rebuildCanonicalLedger({
      db: dbWithTransaction as never,
      wallet: { id: WALLET_ID, chainId: 369, address: WALLET_ADDRESS },
      fromBlock: 200n,
      toBlock: 200n,
      sourceFamilies: ["STAKING"],
      normalizerVersion: "v1",
    });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    const [, options] = transactionSpy.mock.calls[0]!;
    // Same shared constant persistNormalizedLedger's own $transaction call
    // uses — one policy, not a second inconsistent one for rebuild.
    expect(options).toEqual(LEDGER_PERSIST_TRANSACTION_OPTIONS);

    // Scoped deletes + persistence still happened, inside that one call.
    expect(Array.from(stores.ledgerEntries.values()).some((e) => e.entryType === "STAKE_RETURN_UNALLOCATED")).toBe(
      true,
    );
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
      feeAssetIdSnapshot: "chain:369:native:0x0000000000000000000000000000000000000000",
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
