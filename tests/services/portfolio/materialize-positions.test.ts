import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { materializeCurrentPortfolioPositions } from "@/services/portfolio/materialize-positions";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";

const WALLET_ID = "wallet_1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const PHEX_ASSET_ID =
  "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";

type TokenRecord = {
  assetId: string;
  addressLower: string;
  decimals: number;
  isNative: boolean;
  chainId: number;
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

type MaterializationStateRecord = {
  walletId: string;
  chainId: number;
  status: string;
  completedSuccessfully: boolean;
  lastAttemptedAt: Date;
  latestMaterializedAt: Date | null;
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  warningCount: number;
  warningDetails: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createDraft(
  overrides: Partial<CanonicalLedgerEntryDraft> = {},
): CanonicalLedgerEntryDraft {
  return {
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
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
    normalizerVersion: "v1",
    sourceLogIndex: 0,
    sourceLogKey: "log:0xseed:0:seed",
    dedupeKey: "seed-dedupe",
    ...overrides,
  };
}

function createMemoryDb() {
  const tokens = new Map<string, TokenRecord>();
  const ledgerActionGroups = new Map<string, ActionGroupRecord>();
  const ledgerEntries = new Map<string, LedgerEntryRecord>();
  const portfolioTokenBalances = new Map<string, Record<string, unknown>>();
  const portfolioLpPositions = new Map<string, Record<string, unknown>>();
  const portfolioStakePositions = new Map<string, Record<string, unknown>>();
  const portfolioMaterializationStates = new Map<string, MaterializationStateRecord>();
  let failTokenBalanceCreateMany: Error | null = null;

  const db = {
    token: {
      async findMany(args: { where: { chainId: number } }) {
        return Array.from(tokens.values()).filter(
          (token) => token.chainId === args.where.chainId,
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
        where: { walletId: string; chainId: number };
      }) {
        return Array.from(ledgerEntries.values())
          .filter(
            (entry) =>
              entry.walletId === args.where.walletId &&
              entry.chainId === args.where.chainId,
          )
          .sort((left, right) => {
            const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
            return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
          });
      },
    },
    portfolioTokenBalance: {
      async deleteMany(args: { where: { walletId: string; chainId: number } }) {
        let count = 0;
        for (const [key, value] of portfolioTokenBalances.entries()) {
          if (
            value.walletId === args.where.walletId &&
            value.chainId === args.where.chainId
          ) {
            portfolioTokenBalances.delete(key);
            count += 1;
          }
        }
        return { count };
      },
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        if (failTokenBalanceCreateMany) {
          throw failTokenBalanceCreateMany;
        }
        for (const record of args.data) {
          portfolioTokenBalances.set(
            `${record.walletId}:${record.chainId}:${record.assetId}`,
            record,
          );
        }
        return { count: args.data.length };
      },
    },
    portfolioLpPosition: {
      async deleteMany(args: { where: { walletId: string; chainId: number } }) {
        let count = 0;
        for (const [key, value] of portfolioLpPositions.entries()) {
          if (
            value.walletId === args.where.walletId &&
            value.chainId === args.where.chainId
          ) {
            portfolioLpPositions.delete(key);
            count += 1;
          }
        }
        return { count };
      },
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        for (const record of args.data) {
          portfolioLpPositions.set(
            `${record.walletId}:${record.chainId}:${record.lpAssetId}`,
            record,
          );
        }
        return { count: args.data.length };
      },
    },
    portfolioStakePosition: {
      async deleteMany(args: { where: { walletId: string; chainId: number } }) {
        let count = 0;
        for (const [key, value] of portfolioStakePositions.entries()) {
          if (
            value.walletId === args.where.walletId &&
            value.chainId === args.where.chainId
          ) {
            portfolioStakePositions.delete(key);
            count += 1;
          }
        }
        return { count };
      },
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        for (const record of args.data) {
          portfolioStakePositions.set(
            `${record.walletId}:${record.chainId}:${record.stakeKey}`,
            record,
          );
        }
        return { count: args.data.length };
      },
    },
    portfolioMaterializationState: {
      async upsert(args: {
        where: { walletId_chainId: { walletId: string; chainId: number } };
        create: Omit<MaterializationStateRecord, "createdAt" | "updatedAt">;
        update: Partial<Omit<MaterializationStateRecord, "walletId" | "chainId" | "createdAt">>;
      }) {
        const key = `${args.where.walletId_chainId.walletId}:${args.where.walletId_chainId.chainId}`;
        const existing = portfolioMaterializationStates.get(key);
        const now = new Date();
        const next: MaterializationStateRecord = existing
          ? {
              ...existing,
              ...args.update,
              updatedAt: now,
            }
          : {
              ...args.create,
              createdAt: now,
              updatedAt: now,
            };
        portfolioMaterializationStates.set(key, next);
        return next;
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
    tokens,
    portfolioTokenBalances,
    portfolioLpPositions,
    portfolioStakePositions,
    portfolioMaterializationStates,
    setFailTokenBalanceCreateMany(error: Error | null) {
      failTokenBalanceCreateMany = error;
    },
  };
}

async function seedLedger(
  db: ReturnType<typeof createMemoryDb>["db"],
  drafts: CanonicalLedgerEntryDraft[],
) {
  return persistNormalizedLedger(drafts, db as never);
}

function seedTokens(tokens: ReturnType<typeof createMemoryDb>["tokens"]) {
  const rows: TokenRecord[] = [
    {
      assetId: NATIVE_ASSET_ID,
      addressLower: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      isNative: true,
      chainId: CHAIN_ID,
    },
    {
      assetId: "chain:369:erc20:0xtokena",
      addressLower: "0xtokena",
      decimals: 6,
      isNative: false,
      chainId: CHAIN_ID,
    },
    {
      assetId: "chain:369:erc20:0xtokenb",
      addressLower: "0xtokenb",
      decimals: 18,
      isNative: false,
      chainId: CHAIN_ID,
    },
    {
      assetId: "chain:369:erc20:0xlp",
      addressLower: "0xlp",
      decimals: 18,
      isNative: false,
      chainId: CHAIN_ID,
    },
    {
      assetId: PHEX_ASSET_ID,
      addressLower: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      decimals: 8,
      isNative: false,
      chainId: CHAIN_ID,
    },
  ];
  for (const row of rows) {
    tokens.set(row.assetId, row);
  }
}

describe("materializeCurrentPortfolioPositions", () => {
  it("materializes token balances from canonical transfer, dex, lp, stake, and fee entries", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    await seedLedger(stores.db, [
      createDraft({ txHash: "0xtransfer", actionGroupKey: "g1", dedupeKey: "d1", assetId: "chain:369:erc20:0xtokena", quantity: "5", entryType: "RECEIVE", sourceLogKey: "log:0xtransfer:receive" }),
      createDraft({ txHash: "0xswap", actionType: "SWAP", actionGroupKey: "g2", dedupeKey: "d2", assetId: "chain:369:erc20:0xtokena", quantity: "2", entryType: "SWAP_OUT", direction: "OUT", sourceLogKey: "log:0xswap:out" }),
      createDraft({ txHash: "0xswap", actionType: "SWAP", actionGroupKey: "g2", dedupeKey: "d3", assetId: "chain:369:erc20:0xtokenb", quantity: "1.5", entryType: "SWAP_IN", sourceLogKey: "log:0xswap:in" }),
      createDraft({ txHash: "0xswap", actionType: "SWAP", actionGroupKey: "g2", dedupeKey: "d4", assetId: NATIVE_ASSET_ID, quantity: "0.0002", entryType: "FEE", direction: "OUT", sourceLogKey: "log:0xswap:fee" }),
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g3", dedupeKey: "d5", assetId: "chain:369:erc20:0xtokena", quantity: "1", entryType: "LP_ADD_OUT", direction: "OUT", sourceLogKey: "log:0xlp-add:t0" }),
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g3", dedupeKey: "d6", assetId: "chain:369:erc20:0xtokenb", quantity: "0.5", entryType: "LP_ADD_OUT", direction: "OUT", sourceLogKey: "log:0xlp-add:t1" }),
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g3", dedupeKey: "d7", assetId: "chain:369:erc20:0xlp", quantity: "0.1", entryType: "LP_ADD_IN", sourceLogKey: "log:0xlp-add:lp" }),
      createDraft({ txHash: "0xstake-start", actionType: "HEX_STAKE_START", actionGroupKey: "g4", dedupeKey: "d8", assetId: PHEX_ASSET_ID, quantity: "0", entryType: "STAKE_START", direction: "INTERNAL", sourceLogKey: "log:0xstake-start:stake:start:42:start" }),
      createDraft({ txHash: "0xstake-start", actionType: "HEX_STAKE_START", actionGroupKey: "g4", dedupeKey: "d9", assetId: PHEX_ASSET_ID, quantity: "1", entryType: "STAKE_PRINCIPAL_LOCKED", direction: "OUT", sourceLogKey: "log:0xstake-start:stake:start:42:principal" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g5", dedupeKey: "d10", assetId: PHEX_ASSET_ID, quantity: "0", entryType: "STAKE_END", direction: "INTERNAL", sourceLogKey: "log:0xstake-end:stake:end:42:end" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g5", dedupeKey: "d11", assetId: PHEX_ASSET_ID, quantity: "1", entryType: "STAKE_PRINCIPAL_RETURNED", sourceLogKey: "log:0xstake-end:stake:end:42:principal" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g5", dedupeKey: "d12", assetId: PHEX_ASSET_ID, quantity: "0.05", entryType: "STAKE_YIELD_RECEIVED", sourceLogKey: "log:0xstake-end:stake:end:42:yield" }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.ledgerEntriesProcessed).toBe(12);
    expect(report.tokenBalancesWritten).toBe(5);
    expect(report.lpPositionsWritten).toBe(1);
    expect(report.stakePositionsWritten).toBe(1);
    expect(report.skippedCount).toBe(0);
    expect(report.warnings).toEqual([
      `negative-token-balance:${NATIVE_ASSET_ID}:-0.0002`,
    ]);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`))
      .toMatchObject({ balanceQuantity: "2", decimals: 6 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokenb`))
      .toMatchObject({ balanceQuantity: "1", decimals: 18 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xlp`))
      .toMatchObject({ balanceQuantity: "0.1", decimals: 18 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${PHEX_ASSET_ID}`))
      .toMatchObject({ balanceQuantity: "0.05", decimals: 8 });
  });

  it("materializes very large Prisma.Decimal quantities (>= 1e21) without exponential parse failure", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    // Prisma.Decimal serializes magnitudes >= 1e21 via toString() in exponential
    // notation (e.g. "1.17038473047e+22"), which breaks the digit-only canonical
    // integer parser. Guard that we are actually reproducing that shape.
    const largeQuantity = new Prisma.Decimal("11703847304700000000000");
    expect(largeQuantity.toString()).toContain("e+");

    vi.spyOn(stores.db.ledgerEntry, "findMany").mockResolvedValue([
      {
        id: "entry_big",
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        actionGroupId: "group_big",
        tokenId: null,
        txHash: "0xbig",
        entryType: "RECEIVE",
        assetId: "chain:369:erc20:0xtokenb",
        quantity: largeQuantity,
        valueUsd: null,
        direction: "IN",
        normalizerVersion: "v1",
        occurredAt: new Date("2026-05-08T10:00:00.000Z"),
        sourceLogIndex: 0,
        sourceLogKey: "log:0xbig:receive",
        dedupeKey: "big-dedupe",
      },
    ] as never);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.ledgerEntriesProcessed).toBe(1);
    expect(report.tokenBalancesWritten).toBe(1);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokenb`))
      .toMatchObject({ balanceQuantity: "11703847304700000000000", decimals: 18 });
  });

  it("materializes LP position state", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    await seedLedger(stores.db, [
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g1", dedupeKey: "d1", assetId: "chain:369:erc20:0xtokena", quantity: "1", entryType: "LP_ADD_OUT", direction: "OUT", sourceLogKey: "log:0xlp-add:t0" }),
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g1", dedupeKey: "d2", assetId: "chain:369:erc20:0xtokenb", quantity: "0.5", entryType: "LP_ADD_OUT", direction: "OUT", sourceLogKey: "log:0xlp-add:t1" }),
      createDraft({ txHash: "0xlp-add", actionType: "LP_ADD", actionGroupKey: "g1", dedupeKey: "d3", assetId: "chain:369:erc20:0xlp", quantity: "0.1", entryType: "LP_ADD_IN", sourceLogKey: "log:0xlp-add:lp" }),
      createDraft({ txHash: "0xlp-remove", actionType: "LP_REMOVE", actionGroupKey: "g2", dedupeKey: "d4", assetId: "chain:369:erc20:0xlp", quantity: "0.04", entryType: "LP_REMOVE_OUT", direction: "OUT", sourceLogKey: "log:0xlp-remove:lp" }),
      createDraft({ txHash: "0xlp-remove", actionType: "LP_REMOVE", actionGroupKey: "g2", dedupeKey: "d5", assetId: "chain:369:erc20:0xtokena", quantity: "0.4", entryType: "LP_REMOVE_IN", sourceLogKey: "log:0xlp-remove:t0" }),
      createDraft({ txHash: "0xlp-remove", actionType: "LP_REMOVE", actionGroupKey: "g2", dedupeKey: "d6", assetId: "chain:369:erc20:0xtokenb", quantity: "0.2", entryType: "LP_REMOVE_IN", sourceLogKey: "log:0xlp-remove:t1" }),
    ]);

    await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(stores.portfolioLpPositions.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xlp`))
      .toMatchObject({
        lpTokenQuantity: "0.06",
        token0NetQuantity: "0.6",
        token1NetQuantity: "0.3",
      });
  });

  it("materializes stake position state", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    await seedLedger(stores.db, [
      createDraft({ txHash: "0xstake-start", actionType: "HEX_STAKE_START", actionGroupKey: "g1", dedupeKey: "d1", assetId: PHEX_ASSET_ID, quantity: "0", entryType: "STAKE_START", direction: "INTERNAL", sourceLogKey: "log:0xstake-start:stake:start:77:start" }),
      createDraft({ txHash: "0xstake-start", actionType: "HEX_STAKE_START", actionGroupKey: "g1", dedupeKey: "d2", assetId: PHEX_ASSET_ID, quantity: "1.25", entryType: "STAKE_PRINCIPAL_LOCKED", direction: "OUT", sourceLogKey: "log:0xstake-start:stake:start:77:principal" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g2", dedupeKey: "d3", assetId: PHEX_ASSET_ID, quantity: "0", entryType: "STAKE_END", direction: "INTERNAL", sourceLogKey: "log:0xstake-end:stake:end:77:end" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g2", dedupeKey: "d4", assetId: PHEX_ASSET_ID, quantity: "1.25", entryType: "STAKE_PRINCIPAL_RETURNED", sourceLogKey: "log:0xstake-end:stake:end:77:principal" }),
      createDraft({ txHash: "0xstake-end", actionType: "HEX_STAKE_END", actionGroupKey: "g2", dedupeKey: "d5", assetId: PHEX_ASSET_ID, quantity: "0.03", entryType: "STAKE_YIELD_RECEIVED", sourceLogKey: "log:0xstake-end:stake:end:77:yield" }),
    ]);

    await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(stores.portfolioStakePositions.get(`${WALLET_ID}:${CHAIN_ID}:77`))
      .toMatchObject({
        principalQuantity: "1.25",
        returnedQuantity: "1.25",
        yieldQuantity: "0.03",
        status: "ENDED",
      });
  });

  it("is idempotent on repeated materialization", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);
    await seedLedger(stores.db, [
      createDraft({ txHash: "0xtransfer", actionGroupKey: "g1", dedupeKey: "d1", assetId: "chain:369:erc20:0xtokena", quantity: "1", entryType: "RECEIVE", sourceLogKey: "log:0xtransfer:receive" }),
    ]);

    const first = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });
    const second = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(first.tokenBalancesWritten).toBe(1);
    expect(second.tokenBalancesWritten).toBe(1);
    expect(stores.portfolioTokenBalances.size).toBe(1);
  });

  it("persists successful materialization provenance and coverage on derived rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
    try {
      const stores = createMemoryDb();
      seedTokens(stores.tokens);
      await seedLedger(stores.db, [
        createDraft({
          txHash: "0xtransfer",
          actionGroupKey: "g1",
          dedupeKey: "d1",
          assetId: "chain:369:erc20:0xtokena",
          quantity: "1",
          entryType: "RECEIVE",
          sourceLogKey: "log:0xtransfer:receive",
        }),
      ]);

      await materializeCurrentPortfolioPositions({
        wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
        provenance: {
          updatedFromBlock: 100n,
          updatedToBlock: 120n,
        },
        db: stores.db as never,
      });

      expect(
        stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`),
      ).toMatchObject({
        updatedFromBlock: 100n,
        updatedToBlock: 120n,
      });
      expect(stores.portfolioMaterializationStates.get(`${WALLET_ID}:${CHAIN_ID}`)).toMatchObject({
        status: "COMPLETED",
        completedSuccessfully: true,
        lastAttemptedAt: new Date("2026-05-10T12:00:00.000Z"),
        latestMaterializedAt: new Date("2026-05-10T12:00:00.000Z"),
        sourceLedgerFromBlock: null,
        sourceLedgerToBlock: null,
        updatedFromBlock: 100n,
        updatedToBlock: 120n,
        warningCount: 0,
        warningDetails: [],
        errorMessage: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up zero balances on rerun", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);
    stores.portfolioTokenBalances.set(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`, {
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS.toLowerCase(),
      chainId: CHAIN_ID,
      assetId: "chain:369:erc20:0xtokena",
      assetAddress: "0xtokena",
      balanceQuantity: "99",
      decimals: 6,
      updatedFromBlock: null,
      updatedToBlock: null,
    });
    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xtransfer-in",
        actionGroupKey: "g1",
        dedupeKey: "d1",
        assetId: "chain:369:erc20:0xtokena",
        quantity: "1",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xtransfer-in:receive",
      }),
      createDraft({
        txHash: "0xtransfer-out",
        actionGroupKey: "g2",
        dedupeKey: "d2",
        assetId: "chain:369:erc20:0xtokena",
        quantity: "1",
        entryType: "SEND",
        direction: "OUT",
        sourceLogKey: "log:0xtransfer-out:send",
      }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.tokenBalancesWritten).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(stores.portfolioTokenBalances.size).toBe(0);
    expect(
      stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`),
    ).toBeUndefined();
  });

  it("materializes mixed native and ERC20 balances with fee impact and canonical asset identity", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xnative-in",
        actionGroupKey: "g1",
        dedupeKey: "d1",
        assetId: NATIVE_ASSET_ID,
        quantity: "2",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xnative-in:receive",
      }),
      createDraft({
        txHash: "0xnative-fee",
        actionType: "TRANSFER",
        actionGroupKey: "g2",
        dedupeKey: "d2",
        assetId: NATIVE_ASSET_ID,
        quantity: "0.0002",
        entryType: "FEE",
        direction: "OUT",
        sourceLogKey: "log:0xnative-fee:fee",
      }),
      createDraft({
        txHash: "0xerc20-in",
        actionGroupKey: "g3",
        dedupeKey: "d3",
        assetId: "chain:369:erc20:0xtokena",
        quantity: "5",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xerc20-in:receive",
      }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.tokenBalancesWritten).toBe(2);
    expect(report.warnings).toEqual([]);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${NATIVE_ASSET_ID}`))
      .toMatchObject({
        assetAddress: null,
        balanceQuantity: "1.9998",
        decimals: 18,
      });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`))
      .toMatchObject({
        assetAddress: "0xtokena",
        balanceQuantity: "5",
        decimals: 6,
      });
  });

  it("warns on negative token balances without dropping persisted state", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);

    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xsend-only",
        actionGroupKey: "g1",
        dedupeKey: "d1",
        assetId: NATIVE_ASSET_ID,
        quantity: "1",
        entryType: "SEND",
        direction: "OUT",
        sourceLogKey: "log:0xsend-only:send",
      }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.tokenBalancesWritten).toBe(1);
    expect(report.warnings).toEqual([
      `negative-token-balance:${NATIVE_ASSET_ID}:-1`,
    ]);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${NATIVE_ASSET_ID}`))
      .toMatchObject({
        assetAddress: null,
        balanceQuantity: "-1",
      });
    expect(stores.portfolioMaterializationStates.get(`${WALLET_ID}:${CHAIN_ID}`)).toMatchObject({
      status: "COMPLETED",
      completedSuccessfully: true,
      warningCount: 1,
      warningDetails: [`negative-token-balance:${NATIVE_ASSET_ID}:-1`],
      errorMessage: null,
    });
  });

  it("updates persisted provenance on rerun", async () => {
    vi.useFakeTimers();
    try {
      const stores = createMemoryDb();
      seedTokens(stores.tokens);
      await seedLedger(stores.db, [
        createDraft({
          txHash: "0xtransfer",
          actionGroupKey: "g1",
          dedupeKey: "d1",
          assetId: "chain:369:erc20:0xtokena",
          quantity: "1",
          entryType: "RECEIVE",
          sourceLogKey: "log:0xtransfer:receive",
        }),
      ]);

      vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
      await materializeCurrentPortfolioPositions({
        wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
        provenance: {
          updatedFromBlock: 100n,
          updatedToBlock: 120n,
        },
        db: stores.db as never,
      });

      vi.setSystemTime(new Date("2026-05-10T12:05:00.000Z"));
      await materializeCurrentPortfolioPositions({
        wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
        provenance: {
          updatedFromBlock: 121n,
          updatedToBlock: 150n,
        },
        db: stores.db as never,
      });

      expect(stores.portfolioMaterializationStates.get(`${WALLET_ID}:${CHAIN_ID}`)).toMatchObject({
        status: "COMPLETED",
        completedSuccessfully: true,
        lastAttemptedAt: new Date("2026-05-10T12:05:00.000Z"),
        latestMaterializedAt: new Date("2026-05-10T12:05:00.000Z"),
        sourceLedgerFromBlock: null,
        sourceLedgerToBlock: null,
        updatedFromBlock: 121n,
        updatedToBlock: 150n,
      });
      expect(
        stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`),
      ).toMatchObject({
        updatedFromBlock: 121n,
        updatedToBlock: 150n,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps successful materialization coverage when a later attempt fails", async () => {
    vi.useFakeTimers();
    try {
      const stores = createMemoryDb();
      seedTokens(stores.tokens);
      await seedLedger(stores.db, [
        createDraft({
          txHash: "0xtransfer",
          actionGroupKey: "g1",
          dedupeKey: "d1",
          assetId: "chain:369:erc20:0xtokena",
          quantity: "1",
          entryType: "RECEIVE",
          sourceLogKey: "log:0xtransfer:receive",
        }),
      ]);

      vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
      await materializeCurrentPortfolioPositions({
        wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
        provenance: {
          updatedFromBlock: 100n,
          updatedToBlock: 120n,
        },
        db: stores.db as never,
      });

      stores.setFailTokenBalanceCreateMany(new Error("persist exploded"));
      vi.setSystemTime(new Date("2026-05-10T12:05:00.000Z"));

      await expect(
        materializeCurrentPortfolioPositions({
          wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
          provenance: {
            updatedFromBlock: 121n,
            updatedToBlock: 150n,
          },
          db: stores.db as never,
        }),
      ).rejects.toThrow("persist exploded");

      expect(stores.portfolioMaterializationStates.get(`${WALLET_ID}:${CHAIN_ID}`)).toMatchObject({
        status: "FAILED",
        completedSuccessfully: false,
        lastAttemptedAt: new Date("2026-05-10T12:05:00.000Z"),
        latestMaterializedAt: new Date("2026-05-10T12:00:00.000Z"),
        sourceLedgerFromBlock: null,
        sourceLedgerToBlock: null,
        updatedFromBlock: 100n,
        updatedToBlock: 120n,
        errorMessage: "persist exploded",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("scoped recompute does not affect unrelated wallet or chain state", async () => {
    const stores = createMemoryDb();
    seedTokens(stores.tokens);
    stores.portfolioTokenBalances.set("wallet_2:369:chain:369:erc20:0xtokena", {
      walletId: "wallet_2",
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: CHAIN_ID,
      assetId: "chain:369:erc20:0xtokena",
      assetAddress: "0xtokena",
      balanceQuantity: "999",
      decimals: 6,
      updatedFromBlock: null,
      updatedToBlock: null,
    });

    await seedLedger(stores.db, [
      createDraft({ txHash: "0xtransfer", actionGroupKey: "g1", dedupeKey: "d1", assetId: "chain:369:erc20:0xtokena", quantity: "1", entryType: "RECEIVE", sourceLogKey: "log:0xtransfer:receive" }),
    ]);

    await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(stores.portfolioTokenBalances.get("wallet_2:369:chain:369:erc20:0xtokena"))
      .toMatchObject({ balanceQuantity: "999" });
  });

  it("writes separate balance rows for two distinct assetIds regardless of shared contract address prefix", async () => {
    // Materialization keys positions by assetId (chain:chainId:type:address), never by symbol or name.
    // Token metadata in this layer has no symbol field; same-symbol same-address identity guards live
    // in average-cost and price-resolver tests where symbol metadata exists in those fixtures.
    const stores = createMemoryDb();

    const alphaAssetId = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const betaAssetId = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    stores.tokens.set(alphaAssetId, {
      assetId: alphaAssetId,
      addressLower: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      decimals: 18,
      isNative: false,
      chainId: CHAIN_ID,
    });
    stores.tokens.set(betaAssetId, {
      assetId: betaAssetId,
      addressLower: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decimals: 18,
      isNative: false,
      chainId: CHAIN_ID,
    });

    await seedLedger(stores.db, [
      createDraft({
        txHash: "0xreceive-alpha",
        actionGroupKey: "g1",
        dedupeKey: "d1",
        assetId: alphaAssetId,
        quantity: "10",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xreceive-alpha:receive",
      }),
      createDraft({
        txHash: "0xreceive-beta",
        actionGroupKey: "g2",
        dedupeKey: "d2",
        assetId: betaAssetId,
        quantity: "25",
        entryType: "RECEIVE",
        sourceLogKey: "log:0xreceive-beta:receive",
      }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.tokenBalancesWritten).toBe(2);

    const alphaBalance = stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${alphaAssetId}`);
    const betaBalance = stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${betaAssetId}`);

    expect(alphaBalance).toMatchObject({
      assetId: alphaAssetId,
      assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      balanceQuantity: "10",
    });
    expect(betaBalance).toMatchObject({
      assetId: betaAssetId,
      assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      balanceQuantity: "25",
    });
  });

  it("materializes canonical quantities without token metadata or RPC", async () => {
    const stores = createMemoryDb();
    await seedLedger(stores.db, [
      createDraft({ txHash: "0xtransfer", actionGroupKey: "g1", dedupeKey: "d1", assetId: "chain:369:erc20:0xunknown", quantity: "1", entryType: "RECEIVE", sourceLogKey: "log:0xtransfer:receive" }),
    ]);

    const report = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });

    expect(report.tokenBalancesWritten).toBe(1);
    expect(report.skippedCount).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xunknown`))
      .toMatchObject({ balanceQuantity: "1", decimals: null, assetAddress: "0xunknown" });
  });
});
