import "server-only";

import type { Prisma, PrismaClient, SourceFamily, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";

type SyncStateClient = PrismaClient | Prisma.TransactionClient;

export type SyncRunRecord = {
  id: string;
};

export type SyncCursorRecord = {
  fromBlock: bigint;
  toBlock: bigint;
  blockHash: string | null;
};

export type SyncRunStore = {
  createRun(input: {
    walletId: string;
    chainId: number;
    trigger: SyncTrigger;
    status: SyncRunStatus;
    stage: string;
    sourceFamilies: SourceFamily[];
    startBlock: bigint;
    endBlock: bigint;
    latestSafeBlock?: bigint;
    policyLabel: string;
    warningCount?: number;
    errorMessage?: string;
  }): Promise<SyncRunRecord>;
  updateRun(input: {
    runId: string;
    status?: SyncRunStatus;
    stage?: string;
    latestSafeBlock?: bigint;
    warningCount?: number;
    errorMessage?: string | null;
    endBlock?: bigint;
  }): Promise<void>;
};

export type SyncCursorStore = {
  getCursor(input: {
    walletId: string;
    chainId: number;
    sourceFamily: SourceFamily;
  }): Promise<SyncCursorRecord | null>;
  upsertCursor(input: {
    walletId: string;
    chainId: number;
    sourceFamily: SourceFamily;
    fromBlock: bigint;
    toBlock: bigint;
    blockHash: string | null;
  }): Promise<void>;
};

export function createPrismaSyncRunStore(
  client: SyncStateClient = getDb(),
): SyncRunStore {
  return {
    async createRun(input) {
      const run = await client.syncRun.create({
        data: {
          walletId: input.walletId,
          chainId: input.chainId,
          trigger: input.trigger,
          status: input.status,
          stage: input.stage,
          sourceFamilies: input.sourceFamilies,
          startBlock: input.startBlock,
          endBlock: input.endBlock,
          latestSafeBlock: input.latestSafeBlock,
          policyLabel: input.policyLabel,
          warningCount: input.warningCount ?? 0,
          errorMessage: input.errorMessage ?? null,
        },
        select: {
          id: true,
        },
      });

      return run;
    },
    async updateRun(input) {
      await client.syncRun.update({
        where: {
          id: input.runId,
        },
        data: {
          status: input.status,
          stage: input.stage,
          latestSafeBlock: input.latestSafeBlock,
          warningCount: input.warningCount,
          errorMessage: input.errorMessage,
          endBlock: input.endBlock,
        },
      });
    },
  };
}

export function createPrismaSyncCursorStore(
  client: SyncStateClient = getDb(),
): SyncCursorStore {
  return {
    async getCursor(input) {
      return client.syncCursor.findUnique({
        where: {
          walletId_chainId_sourceFamily: {
            walletId: input.walletId,
            chainId: input.chainId,
            sourceFamily: input.sourceFamily,
          },
        },
        select: {
          fromBlock: true,
          toBlock: true,
          blockHash: true,
        },
      });
    },
    async upsertCursor(input) {
      await client.syncCursor.upsert({
        where: {
          walletId_chainId_sourceFamily: {
            walletId: input.walletId,
            chainId: input.chainId,
            sourceFamily: input.sourceFamily,
          },
        },
        create: {
          walletId: input.walletId,
          chainId: input.chainId,
          sourceFamily: input.sourceFamily,
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
          blockHash: input.blockHash,
        },
        update: {
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
          blockHash: input.blockHash,
        },
      });
    },
  };
}
