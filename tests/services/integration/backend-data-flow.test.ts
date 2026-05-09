import { describe, expect, it, vi } from "vitest";

import { assemblePortfolioDashboard } from "@/services/dashboard/portfolio-dashboard";
import { getOperationStateReport } from "@/services/debug/operation-state";
import { materializeCurrentPortfolioPositions } from "@/services/portfolio/materialize-positions";
import { rebuildCanonicalLedger } from "@/services/rebuild/rebuild-ledger";
import { runWalletSync } from "@/services/sync/sync-orchestrator";
import { createSyncDependencies, TRANSFER_EVENT_TOPIC0 } from "@/services/sync/transfer-sync";
import type { AverageCostPnlResult } from "@/services/pnl/types";

const CHAIN_ID = 369;
const WALLET_ID = "wallet_1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_TOPIC =
  "0x0000000000000000000000001111111111111111111111111111111111111111";
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222";
const TOKEN_ASSET_ID = `chain:${CHAIN_ID}:erc20:${TOKEN_ADDRESS}`;
const NATIVE_ASSET_ID = `chain:${CHAIN_ID}:native:PLS`;

type RawLogRecord = {
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
  status: "ACTIVE";
};

type RawBlockRecord = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  parentHash: string;
  timestamp: Date;
  status: "ACTIVE";
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

type TokenRecord = {
  id: string;
  assetId: string;
  addressLower: string;
  decimals: number;
  symbol: string;
  name: string;
  isNative?: boolean;
  chainId?: number;
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

type SyncCursorRow = {
  fromBlock: bigint;
  toBlock: bigint;
  blockHash: string | null;
};

type SyncRunRow = {
  id: string;
  walletId: string;
  walletAddress: string;
  chainId: number;
  trigger: "MANUAL" | "IMPORT" | "REBUILD";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  sourceFamilies: Array<"TRANSFERS" | "DEX" | "LP" | "STAKING" | "NATIVE">;
  startBlock: bigint;
  endBlock: bigint;
  latestSafeBlock: bigint | null;
  policyLabel: string | null;
  warningCount: number;
  warningDetails: string[];
  errorMessage: string | null;
  failedSourceFamily: "TRANSFERS" | "DEX" | "LP" | "STAKING" | "NATIVE" | null;
  failedFromBlock: bigint | null;
  failedToBlock: bigint | null;
  createdAt: Date;
  updatedAt: Date;
};

function matchesTopicOr(
  record: Pick<RawLogRecord, "topic1" | "topic2">,
  clauses?: Array<{ topic1?: string; topic2?: string }>,
) {
  if (!clauses || clauses.length === 0) {
    return true;
  }

  return clauses.some((clause) => {
    const topic1Matches =
      clause.topic1 === undefined || record.topic1 === clause.topic1;
    const topic2Matches =
      clause.topic2 === undefined || record.topic2 === clause.topic2;

    return topic1Matches && topic2Matches;
  });
}

function matchesAddressOr(
  record: Pick<RawTokenTransferRecord | RawTransactionRecord, "fromAddress" | "toAddress">,
  clauses?: Array<{ fromAddress?: string; toAddress?: string }>,
) {
  if (!clauses || clauses.length === 0) {
    return true;
  }

  return clauses.some((clause) => {
    const fromAddressMatches =
      clause.fromAddress === undefined || record.fromAddress === clause.fromAddress;
    const toAddressMatches =
      clause.toAddress === undefined || record.toAddress === clause.toAddress;

    return fromAddressMatches && toAddressMatches;
  });
}

function createIntegrationDb() {
  const rawLogs = new Map<string, RawLogRecord>();
  const rawBlocks = new Map<string, RawBlockRecord>();
  const rawTokenTransfers = new Map<string, RawTokenTransferRecord>();
  const rawTransactions = new Map<string, RawTransactionRecord>();
  const tokens = new Map<string, TokenRecord>();
  const ledgerActionGroups = new Map<string, ActionGroupRecord>();
  const ledgerEntries = new Map<string, LedgerEntryRecord>();
  const portfolioTokenBalances = new Map<string, Record<string, unknown>>();
  const portfolioLpPositions = new Map<string, Record<string, unknown>>();
  const portfolioStakePositions = new Map<string, Record<string, unknown>>();
  const syncCursors = new Map<string, SyncCursorRow>();
  const syncRuns = new Map<string, SyncRunRow>();
  let runCount = 0;

  tokens.set(NATIVE_ASSET_ID, {
    id: "token_native_pls",
    assetId: NATIVE_ASSET_ID,
    addressLower: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    decimals: 18,
    symbol: "PLS",
    name: "PulseChain",
    isNative: true,
    chainId: CHAIN_ID,
  });

  const db = {
    rawLog: {
      async createMany(args: { data: Array<Omit<RawLogRecord, "status">> }) {
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
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          topic0?: string;
          OR?: Array<{ topic1?: string; topic2?: string }>;
        };
        orderBy?: Array<{ blockNumber?: "asc" | "desc"; logIndex?: "asc" | "desc" }>;
      }) {
        return Array.from(rawLogs.values())
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              (!args.where.topic0 || record.topic0 === args.where.topic0) &&
              matchesTopicOr(record, args.where.OR),
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? left.logIndex - right.logIndex
              : Number(left.blockNumber - right.blockNumber),
          );
      },
      async count(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          topic0?: string;
          OR?: Array<{ topic1?: string; topic2?: string }>;
        };
      }) {
        const results = await db.rawLog.findMany({
          where: args.where,
        });
        return results.length;
      },
    },
    rawBlock: {
      async createMany(args: { data: Array<Omit<RawBlockRecord, "status">> }) {
        let count = 0;
        for (const item of args.data) {
          const key = `${item.chainId}:${item.blockNumber}:${item.blockHash}`;
          if (!rawBlocks.has(key)) {
            rawBlocks.set(key, { ...item, status: "ACTIVE" });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId: number;
          blockNumber: { gte: bigint; lte: bigint };
        };
      }) {
        return Array.from(rawBlocks.values()).filter(
          (record) =>
            record.chainId === args.where.chainId &&
            record.blockNumber >= args.where.blockNumber.gte &&
            record.blockNumber <= args.where.blockNumber.lte,
        );
      },
      async count(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
        };
      }) {
        return Array.from(rawBlocks.values()).filter(
          (record) =>
            record.chainId === args.where.chainId &&
            record.status === args.where.status &&
            record.blockNumber >= args.where.blockNumber.gte &&
            record.blockNumber <= args.where.blockNumber.lte,
        ).length;
      },
    },
    rawTokenTransfer: {
      async createMany(args: {
        data: Array<Omit<RawTokenTransferRecord, "status">>;
        skipDuplicates?: boolean;
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
      async findMany(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          OR: Array<{ fromAddress?: string; toAddress?: string }>;
        };
        orderBy?: Array<{ blockNumber?: "asc" | "desc"; logIndex?: "asc" | "desc" }>;
      }) {
        return Array.from(rawTokenTransfers.values())
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              matchesAddressOr(record, args.where.OR),
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
        data: Array<Omit<RawTransactionRecord, "status">>;
        skipDuplicates?: boolean;
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
        orderBy?: Array<{
          blockNumber?: "asc" | "desc";
          transactionIndex?: "asc" | "desc";
        }>;
      }) {
        return Array.from(rawTransactions.values())
          .filter(
            (record) =>
              record.chainId === args.where.chainId &&
              record.status === args.where.status &&
              record.blockNumber >= args.where.blockNumber.gte &&
              record.blockNumber <= args.where.blockNumber.lte &&
              matchesAddressOr(record, args.where.OR),
          )
          .sort((left, right) =>
            left.blockNumber === right.blockNumber
              ? left.transactionIndex - right.transactionIndex
              : Number(left.blockNumber - right.blockNumber),
          );
      },
      async count(args: {
        where: {
          chainId: number;
          status: "ACTIVE";
          blockNumber: { gte: bigint; lte: bigint };
          OR: Array<{ fromAddress?: string; toAddress?: string }>;
        };
      }) {
        const results = await db.rawTransaction.findMany({
          where: args.where,
        });
        return results.length;
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
      async findUnique(args: {
        where: { chainId_addressLower: { chainId: number; addressLower: string } };
      }) {
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
        const next: TokenRecord = existing
          ? {
              ...existing,
              symbol: args.update.symbol,
              name: args.update.name,
              decimals: args.update.decimals,
            }
          : {
              id: args.create.id,
              assetId: args.create.assetId,
              addressLower: args.create.addressLower,
              decimals: args.create.decimals,
              symbol: args.create.symbol,
              name: args.create.name,
              isNative: args.create.isNative,
              chainId: args.create.chainId,
            };
        tokens.set(key, next);
        return next;
      },
      async findMany(args: { where: { chainId: number } }) {
        return Array.from(tokens.values())
          .filter((token) => token.chainId === args.where.chainId)
          .map((token) => ({
            assetId: token.assetId,
            addressLower: token.addressLower,
            decimals: token.decimals,
            isNative: token.isNative ?? false,
          }));
      },
    },
    tokenMetadataSource: {
      async upsert() {
        return undefined;
      },
    },
    ledgerActionGroup: {
      async createMany(args: { data: ActionGroupRecord[]; skipDuplicates?: boolean }) {
        let count = 0;
        for (const item of args.data) {
          if (!ledgerActionGroups.has(item.id)) {
            ledgerActionGroups.set(item.id, item);
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          chainId: number;
          walletId: string;
          actionType: { in: string[] };
          txHash?: { in: string[] };
          occurredAt?: { gte: Date; lte: Date };
        };
      }) {
        return Array.from(ledgerActionGroups.values()).filter((record) => {
          const inBase =
            record.chainId === args.where.chainId &&
            record.walletId === args.where.walletId &&
            args.where.actionType.in.includes(record.actionType);
          if (!inBase) return false;
          if (args.where.txHash) {
            return args.where.txHash.in.includes(record.txHash);
          }
          if (args.where.occurredAt) {
            return (
              record.occurredAt >= args.where.occurredAt.gte &&
              record.occurredAt <= args.where.occurredAt.lte
            );
          }
          return true;
        });
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        let count = 0;
        for (const id of args.where.id.in) {
          if (ledgerActionGroups.delete(id)) count += 1;
        }
        return { count };
      },
    },
    ledgerEntry: {
      async createMany(args: { data: LedgerEntryRecord[]; skipDuplicates?: boolean }) {
        let count = 0;
        for (const item of args.data) {
          if (!ledgerEntries.has(item.id)) {
            ledgerEntries.set(item.id, item);
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args: {
        where: {
          walletId?: string;
          chainId?: number;
          actionGroupId?: { in: string[] };
        };
        orderBy?: Array<{ occurredAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
        include?: { actionGroup: { select: { actionType: true } } };
      }) {
        const rows = Array.from(ledgerEntries.values())
          .filter(
            (record) =>
              (typeof args.where.walletId !== "string" ||
                record.walletId === args.where.walletId) &&
              (typeof args.where.chainId !== "number" ||
                record.chainId === args.where.chainId) &&
              (!args.where.actionGroupId ||
                args.where.actionGroupId.in.includes(record.actionGroupId)),
          )
          .sort((left, right) => {
            const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
            return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
          });

        if (!args.include?.actionGroup) {
          return rows;
        }

        return rows.map((row) => ({
          ...row,
          actionGroup: {
            actionType: ledgerActionGroups.get(row.actionGroupId)?.actionType ?? "TRANSFER",
          },
        }));
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        let count = 0;
        for (const id of args.where.id.in) {
          if (ledgerEntries.delete(id)) count += 1;
        }
        return { count };
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
        for (const row of args.data) {
          portfolioTokenBalances.set(`${row.walletId}:${row.chainId}:${row.assetId}`, row);
        }
        return { count: args.data.length };
      },
      async findMany(args: {
        where: { walletId: string; chainId: number };
      }) {
        return Array.from(portfolioTokenBalances.values())
          .filter(
            (row) =>
              row.walletId === args.where.walletId &&
              row.chainId === args.where.chainId,
          )
          .sort((left, right) => String(left.assetId).localeCompare(String(right.assetId)));
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
        for (const row of args.data) {
          portfolioLpPositions.set(`${row.walletId}:${row.chainId}:${row.lpAssetId}`, row);
        }
        return { count: args.data.length };
      },
      async findMany(args: {
        where: { walletId: string; chainId: number };
      }) {
        return Array.from(portfolioLpPositions.values())
          .filter(
            (row) =>
              row.walletId === args.where.walletId &&
              row.chainId === args.where.chainId,
          )
          .sort((left, right) => String(left.lpAssetId).localeCompare(String(right.lpAssetId)));
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
        for (const row of args.data) {
          portfolioStakePositions.set(`${row.walletId}:${row.chainId}:${row.stakeKey}`, row);
        }
        return { count: args.data.length };
      },
      async findMany(args: {
        where: { walletId: string; chainId: number };
      }) {
        return Array.from(portfolioStakePositions.values())
          .filter(
            (row) =>
              row.walletId === args.where.walletId &&
              row.chainId === args.where.chainId,
          )
          .sort((left, right) => String(left.stakeKey).localeCompare(String(right.stakeKey)));
      },
    },
    syncRun: {
      async create(args: {
        data: Omit<SyncRunRow, "id" | "walletAddress" | "createdAt" | "updatedAt">;
        select: { id: true };
      }) {
        runCount += 1;
        const id = `run_${runCount}`;
        const now = new Date(`2026-05-10T00:00:${String(runCount).padStart(2, "0")}.000Z`);
        syncRuns.set(id, {
          id,
          walletId: args.data.walletId,
          walletAddress: WALLET_ADDRESS,
          chainId: args.data.chainId,
          trigger: args.data.trigger,
          status: args.data.status,
          stage: args.data.stage,
          sourceFamilies: args.data.sourceFamilies,
          startBlock: args.data.startBlock,
          endBlock: args.data.endBlock,
          latestSafeBlock: args.data.latestSafeBlock ?? null,
          policyLabel: args.data.policyLabel,
          warningCount: args.data.warningCount ?? 0,
          warningDetails: [...(args.data.warningDetails ?? [])],
          errorMessage: args.data.errorMessage ?? null,
          failedSourceFamily: args.data.failedSourceFamily ?? null,
          failedFromBlock: args.data.failedFromBlock ?? null,
          failedToBlock: args.data.failedToBlock ?? null,
          createdAt: now,
          updatedAt: now,
        });
        return { id };
      },
      async update(args: {
        where: { id: string };
        data: Partial<Omit<SyncRunRow, "id" | "walletId" | "walletAddress" | "chainId" | "createdAt">>;
      }) {
        const current = syncRuns.get(args.where.id);
        if (!current) {
          throw new Error(`sync run not found: ${args.where.id}`);
        }
        current.status = args.data.status ?? current.status;
        current.stage = args.data.stage ?? current.stage;
        current.latestSafeBlock = args.data.latestSafeBlock ?? current.latestSafeBlock;
        current.warningCount = args.data.warningCount ?? current.warningCount;
        current.warningDetails = args.data.warningDetails
          ? [...args.data.warningDetails]
          : current.warningDetails;
        current.errorMessage =
          typeof args.data.errorMessage === "undefined"
            ? current.errorMessage
            : args.data.errorMessage;
        current.endBlock = args.data.endBlock ?? current.endBlock;
        current.failedSourceFamily =
          typeof args.data.failedSourceFamily === "undefined"
            ? current.failedSourceFamily
            : args.data.failedSourceFamily;
        current.failedFromBlock =
          typeof args.data.failedFromBlock === "undefined"
            ? current.failedFromBlock
            : args.data.failedFromBlock;
        current.failedToBlock =
          typeof args.data.failedToBlock === "undefined"
            ? current.failedToBlock
            : args.data.failedToBlock;
        current.updatedAt = new Date(current.updatedAt.getTime() + 1000);
        return undefined;
      },
    },
    syncCursor: {
      async findUnique(args: {
        where: {
          walletId_chainId_sourceFamily: {
            walletId: string;
            chainId: number;
            sourceFamily: string;
          };
        };
        select?: { fromBlock: true; toBlock: true; blockHash: true };
      }) {
        return (
          syncCursors.get(
            `${args.where.walletId_chainId_sourceFamily.walletId}:${args.where.walletId_chainId_sourceFamily.chainId}:${args.where.walletId_chainId_sourceFamily.sourceFamily}`,
          ) ?? null
        );
      },
      async create(args: {
        data: {
          walletId: string;
          chainId: number;
          sourceFamily: string;
          fromBlock: bigint;
          toBlock: bigint;
          blockHash: string | null;
        };
      }) {
        syncCursors.set(
          `${args.data.walletId}:${args.data.chainId}:${args.data.sourceFamily}`,
          {
            fromBlock: args.data.fromBlock,
            toBlock: args.data.toBlock,
            blockHash: args.data.blockHash,
          },
        );
        return undefined;
      },
      async update(args: {
        where: {
          walletId_chainId_sourceFamily: {
            walletId: string;
            chainId: number;
            sourceFamily: string;
          };
        };
        data: { fromBlock: bigint; toBlock: bigint; blockHash: string | null };
      }) {
        syncCursors.set(
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
    portfolioTokenBalances,
    syncRuns,
  };
}

function createPnlResult(assetId: string): AverageCostPnlResult {
  return {
    walletId: WALLET_ID,
    chainId: CHAIN_ID,
    assetId,
    quoteAsset: "fiat:usd",
    holdingsQuantity: assetId === TOKEN_ASSET_ID ? "5" : "0.999958",
    averageCost: "0",
    realizedPnl: "0",
    unrealizedPnl: "0",
    markPrice: assetId === TOKEN_ASSET_ID ? "2" : "1",
    totalAcquiredQuantity: assetId === TOKEN_ASSET_ID ? "5" : "2",
    totalDisposedQuantity: assetId === TOKEN_ASSET_ID ? "0" : "1.000042",
    warnings: [],
  };
}

function snapshotLedgerEntries(
  ledgerEntries: Map<string, LedgerEntryRecord>,
) {
  return Array.from(ledgerEntries.values())
    .map((entry) => ({
      txHash: entry.txHash,
      entryType: entry.entryType,
      assetId: entry.assetId,
      quantity: entry.quantity,
      direction: entry.direction,
      actionGroupId: entry.actionGroupId,
    }))
    .sort((left, right) =>
      left.txHash === right.txHash
        ? left.entryType.localeCompare(right.entryType)
        : left.txHash.localeCompare(right.txHash),
    );
}

function toSyncRunOperationRecord(run: SyncRunRow) {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    stage: run.stage,
    chainId: run.chainId,
    walletId: run.walletId,
    wallet: { address: run.walletAddress },
    warningCount: run.warningCount,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    sourceFamilies: run.sourceFamilies,
    policyLabel: run.policyLabel,
    startBlock: run.startBlock,
    endBlock: run.endBlock,
    failedSourceFamily: run.failedSourceFamily,
    failedFromBlock: run.failedFromBlock,
    failedToBlock: run.failedToBlock,
  };
}

describe("backend truth pipeline verification", () => {
  it("proves sync persists raw truth, rebuild recreates canonical entries, and debug/dashboard read persisted state only", async () => {
    const stores = createIntegrationDb();
    const publicClient = {
      getLogs: vi.fn(async () => [
        {
          address: TOKEN_ADDRESS,
          blockHash: "0xblock50",
          blockNumber: 50n,
          data: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
          logIndex: 0,
          transactionHash: "0xerc20-receive",
          topics: [
            TRANSFER_EVENT_TOPIC0,
            "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            WALLET_TOPIC,
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
          hash: `0xblock${blockNumber}`,
          parentHash: blockNumber === 50n ? "0xblock49" : `0xblock${blockNumber - 1n}`,
          timestamp: 1_700_000_000n + blockNumber,
          ...(includeTransactions
            ? {
                transactions:
                  blockNumber === 50n
                    ? [
                        {
                          hash: "0xerc20-receive",
                          blockHash: "0xblock50",
                          blockNumber: 50n,
                          transactionIndex: 0,
                          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                          to: WALLET_ADDRESS,
                          value: 0n,
                          gasPrice: 2_000_000_000n,
                          input: "0xa9059cbb",
                        },
                      ]
                    : blockNumber === 51n
                      ? [
                          {
                            hash: "0xnative-send",
                            blockHash: "0xblock51",
                            blockNumber: 51n,
                            transactionIndex: 0,
                            from: WALLET_ADDRESS,
                            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            value: 1_000_000_000_000_000_000n,
                            gasPrice: 2_000_000_000n,
                            input: "0x",
                          },
                        ]
                      : [
                          {
                            hash: "0xnative-receive",
                            blockHash: "0xblock52",
                            blockNumber: 52n,
                            transactionIndex: 0,
                            from: "0xcccccccccccccccccccccccccccccccccccccccc",
                            to: WALLET_ADDRESS,
                            value: 2_000_000_000_000_000_000n,
                            gasPrice: 2_000_000_000n,
                            input: "0x",
                          },
                        ],
              }
            : {}),
        }),
      ),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return 6;
        if (functionName === "symbol") return "TOK";
        return "Token";
      }),
      getTransaction: vi.fn(async ({ hash }: { hash: `0x${string}` }) => {
        switch (hash) {
          case "0xerc20-receive":
            return {
              hash,
              blockHash: "0xblock50",
              blockNumber: 50n,
              transactionIndex: 0,
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: WALLET_ADDRESS,
              value: 0n,
              gasPrice: 2_000_000_000n,
              input: "0xa9059cbb",
            };
          case "0xnative-send":
            return {
              hash,
              blockHash: "0xblock51",
              blockNumber: 51n,
              transactionIndex: 0,
              from: WALLET_ADDRESS,
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: 1_000_000_000_000_000_000n,
              gasPrice: 2_000_000_000n,
              input: "0x",
            };
          default:
            return {
              hash,
              blockHash: "0xblock52",
              blockNumber: 52n,
              transactionIndex: 0,
              from: "0xcccccccccccccccccccccccccccccccccccccccc",
              to: WALLET_ADDRESS,
              value: 2_000_000_000_000_000_000n,
              gasPrice: 2_000_000_000n,
              input: "0x",
            };
        }
      }),
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
        transactionHash: hash,
        blockHash:
          hash === "0xerc20-receive"
            ? "0xblock50"
            : hash === "0xnative-send"
              ? "0xblock51"
              : "0xblock52",
        blockNumber:
          hash === "0xerc20-receive" ? 50n : hash === "0xnative-send" ? 51n : 52n,
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [],
      })),
    };

    const syncDependencies = createSyncDependencies({
      db: stores.db as never,
      publicClient: publicClient as never,
    });

    const syncResult = await runWalletSync({
      wallet: {
        id: WALLET_ID,
        chainId: CHAIN_ID,
        address: WALLET_ADDRESS,
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 50n,
      endBlock: 52n,
      policyLabel: "integration-data-flow",
      dependencies: syncDependencies,
    });

    expect(syncResult.counts).toEqual({
      rawLogs: 1,
      actionGroups: 3,
      ledgerEntries: 4,
    });
    expect(stores.rawBlocks.size).toBe(3);
    expect(stores.rawLogs.size).toBe(1);
    expect(stores.rawTokenTransfers.size).toBe(1);
    expect(stores.rawTransactions.size).toBe(3);

    const syncedLedgerSnapshot = snapshotLedgerEntries(stores.ledgerEntries);
    expect(syncedLedgerSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txHash: "0xerc20-receive",
          entryType: "RECEIVE",
          assetId: TOKEN_ASSET_ID,
          quantity: "5",
        }),
        expect.objectContaining({
          txHash: "0xnative-send",
          entryType: "SEND",
          assetId: NATIVE_ASSET_ID,
          quantity: "1",
        }),
        expect.objectContaining({
          txHash: "0xnative-send",
          entryType: "FEE",
          assetId: NATIVE_ASSET_ID,
          quantity: "0.000042",
        }),
        expect.objectContaining({
          txHash: "0xnative-receive",
          entryType: "RECEIVE",
          assetId: NATIVE_ASSET_ID,
          quantity: "2",
        }),
      ]),
    );

    vi.clearAllMocks();

    const rebuildReport = await rebuildCanonicalLedger({
      db: stores.db as never,
      wallet: { id: WALLET_ID, chainId: CHAIN_ID, address: WALLET_ADDRESS },
      fromBlock: 50n,
      toBlock: 52n,
      sourceFamilies: ["TRANSFERS"],
      normalizerVersion: "v1",
    });

    expect(rebuildReport.rawSnapshotsProcessed).toBe(4);
    expect(snapshotLedgerEntries(stores.ledgerEntries)).toEqual(syncedLedgerSnapshot);

    const materializeReport = await materializeCurrentPortfolioPositions({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      db: stores.db as never,
    });
    expect(materializeReport.tokenBalancesWritten).toBe(2);

    const dashboard = await assemblePortfolioDashboard({
      wallet: { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: "fiat:usd",
      asOf: new Date("2026-05-10T00:10:00.000Z"),
      db: stores.db as never,
      resolvePrice: async ({ assetId }) =>
        assetId === TOKEN_ASSET_ID
          ? {
              selected: {
                id: "obs-token",
                chainId: CHAIN_ID,
                assetId: TOKEN_ASSET_ID,
                assetAddress: TOKEN_ADDRESS,
                quoteAsset: "fiat:usd",
                price: "2",
                sourceType: "ONCHAIN_POOL",
                sourceId: "pulsex:pair:0xpair",
                routeMetadata: null,
                liquidityUsd: "100000",
                confidence: "0.95",
                observedAt: new Date("2026-05-10T00:10:00.000Z"),
                blockNumber: 52n,
                staleAfterSeconds: 300,
                createdAt: new Date("2026-05-10T00:10:00.000Z"),
                updatedAt: new Date("2026-05-10T00:10:00.000Z"),
              },
              rejected: [],
            }
          : {
              selected: {
                id: "obs-native",
                chainId: CHAIN_ID,
                assetId: NATIVE_ASSET_ID,
                assetAddress: null,
                quoteAsset: "fiat:usd",
                price: "1",
                sourceType: "ONCHAIN_POOL",
                sourceId: "native:pair",
                routeMetadata: null,
                liquidityUsd: "100000",
                confidence: "0.99",
                observedAt: new Date("2026-05-10T00:10:00.000Z"),
                blockNumber: 52n,
                staleAfterSeconds: 300,
                createdAt: new Date("2026-05-10T00:10:00.000Z"),
                updatedAt: new Date("2026-05-10T00:10:00.000Z"),
              },
              rejected: [],
            },
      calculatePnl: async ({ assetId }) => createPnlResult(assetId),
    });

    expect(dashboard.schemaVersion).toBe("v1");
    expect(dashboard.tokenPositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: TOKEN_ASSET_ID,
          balanceQuantity: "5",
        }),
        expect.objectContaining({
          assetId: NATIVE_ASSET_ID,
          balanceQuantity: "0.999958",
        }),
      ]),
    );

    const operationState = await getOperationStateReport({
      now: new Date("2026-05-10T00:10:30.000Z"),
      listSyncRuns: async () =>
        Array.from(stores.syncRuns.values()).map(toSyncRunOperationRecord),
      getLastSuccessfulSyncRun: async () =>
        toSyncRunOperationRecord(Array.from(stores.syncRuns.values())[0]!),
      getLastRebuildRun: async () => null,
      getTransferIngestionCounts: async ({ chainId, walletAddress, fromBlock, toBlock }) => {
        const normalizedWallet = walletAddress.toLowerCase();
        return {
          rawBlocksPersistedCount: Array.from(stores.rawBlocks.values()).filter(
            (record) =>
              record.chainId === chainId &&
              record.blockNumber >= fromBlock &&
              record.blockNumber <= toBlock &&
              record.status === "ACTIVE",
          ).length,
          rawTransactionsPersistedCount: Array.from(stores.rawTransactions.values()).filter(
            (record) =>
              record.chainId === chainId &&
              record.blockNumber >= fromBlock &&
              record.blockNumber <= toBlock &&
              record.status === "ACTIVE" &&
              (record.fromAddress === normalizedWallet ||
                record.toAddress === normalizedWallet),
          ).length,
          rawLogsPersistedCount: Array.from(stores.rawLogs.values()).filter(
            (record) =>
              record.chainId === chainId &&
              record.blockNumber >= fromBlock &&
              record.blockNumber <= toBlock &&
              record.status === "ACTIVE" &&
              record.topic0 === TRANSFER_EVENT_TOPIC0 &&
              (record.topic1 === WALLET_TOPIC.toLowerCase() ||
                record.topic2 === WALLET_TOPIC.toLowerCase()),
          ).length,
        };
      },
    });

    expect(operationState.ingestionDiagnostics).toEqual([
      {
        operationId: "run_1",
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        chainId: CHAIN_ID,
        sourceFamily: "TRANSFERS",
        requestedFromBlock: "50",
        requestedToBlock: "52",
        rangeStatus: "exact",
        rangeWarning: null,
        nativeScanWindowCount: 1,
        nativeScanWindows: [{ fromBlock: "50", toBlock: "52" }],
        rawBlocksPersistedCount: 3,
        rawTransactionsPersistedCount: 3,
        rawLogsPersistedCount: 1,
        warningCount: 0,
      },
    ]);

    expect(publicClient.getLogs).not.toHaveBeenCalled();
    expect(publicClient.getBlock).not.toHaveBeenCalled();
    expect(publicClient.getTransaction).not.toHaveBeenCalled();
    expect(publicClient.getTransactionReceipt).not.toHaveBeenCalled();
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });
});
