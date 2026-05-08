import { describe, expect, it } from "vitest";

import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { materializeCurrentPortfolioPositions } from "@/services/portfolio/materialize-positions";
import { persistNormalizedLedger } from "@/services/sync/ledger-store";

const WALLET_ID = "wallet_1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const NATIVE_ASSET_ID = "chain:369:native:PLS";
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
    expect(report.warnings).toEqual([]);
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokena`))
      .toMatchObject({ balanceQuantity: "2", decimals: 6 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xtokenb`))
      .toMatchObject({ balanceQuantity: "1", decimals: 18 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:chain:369:erc20:0xlp`))
      .toMatchObject({ balanceQuantity: "0.1", decimals: 18 });
    expect(stores.portfolioTokenBalances.get(`${WALLET_ID}:${CHAIN_ID}:${PHEX_ASSET_ID}`))
      .toMatchObject({ balanceQuantity: "0.05", decimals: 8 });
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
