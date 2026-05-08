import { describe, expect, it, vi } from "vitest";
import type { SourceFamily } from "@prisma/client";

import { runWalletSync } from "@/services/sync/sync-orchestrator";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

function createDraft(
  overrides: Partial<CanonicalLedgerEntryDraft> = {},
): CanonicalLedgerEntryDraft {
  return {
    chainId: 369,
    walletId: "wallet_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    txHash: "0xtx",
    blockNumber: 121n,
    actionType: "TRANSFER",
    actionGroupKey: "group_1",
    entryType: "RECEIVE",
    assetId: "chain:369:erc20:0xasset",
    quantity: "1",
    direction: "IN",
    occurredAt: new Date("2026-05-08T10:00:00.000Z"),
    normalizerVersion: "v1",
    sourceLogIndex: 1,
    sourceLogKey: "log:0xtx:1:transfer:receive",
    dedupeKey: "dedupe_1",
    ...overrides,
  };
}

function createRunStore() {
  const updates: Array<Record<string, unknown>> = [];

  return {
    updates,
    createRun: vi.fn(async (input: Record<string, unknown>) => ({
      id: "run_1",
      ...input,
    })),
    updateRun: vi.fn(async (input: Record<string, unknown>) => {
      updates.push(input);
    }),
  };
}

describe("runWalletSync", () => {
  it("resumes from the stored cursor and advances sync state after successful persistence", async () => {
    const runStore = createRunStore();
    const cursorStore = {
      getCursor: vi.fn(async ({ sourceFamily }: { walletId: string; chainId: number; sourceFamily: SourceFamily }) =>
        sourceFamily === "TRANSFERS"
          ? {
              fromBlock: 1n,
              toBlock: 120n,
              blockHash: "0xold",
            }
          : null,
      ),
      upsertCursor: vi.fn(async () => undefined),
    };
    const ingest = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => ({
      rawLogCount: 2,
      latestBlockHash: "0xnew",
      logs: [{ txHash: "0xtx", logIndex: 1 }],
      fromBlock,
      toBlock,
      warnings: [],
    }));
    const normalize = vi.fn(async () => [createDraft()]);
    const persistLedger = vi.fn(async () => ({
      actionGroupCount: 1,
      entryCount: 1,
    }));

    const result = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: "0x1111111111111111111111111111111111111111",
      },
      sourceFamilies: ["TRANSFERS"],
      endBlock: 150n,
      policyLabel: "full-history",
      dependencies: {
        runStore,
        cursorStore,
        ingestSourceFamily: ingest,
        normalizeSourceFamily: normalize,
        persistLedger,
      },
    });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 121n,
        toBlock: 150n,
        sourceFamily: "TRANSFERS",
      }),
    );
    expect(cursorStore.upsertCursor).toHaveBeenCalledWith({
      walletId: "wallet_1",
      chainId: 369,
      sourceFamily: "TRANSFERS",
      fromBlock: 121n,
      toBlock: 150n,
      blockHash: "0xnew",
    });
    expect(runStore.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run_1",
        status: "COMPLETED",
        stage: "COMPLETED",
      }),
    );
    expect(result.counts).toEqual({
      rawLogs: 2,
      actionGroups: 1,
      ledgerEntries: 1,
    });
  });

  it("supports rerunning the same explicit range without relying on cursor movement", async () => {
    const runStore = createRunStore();
    const cursorStore = {
      getCursor: vi.fn(async () => ({
        fromBlock: 1n,
        toBlock: 150n,
        blockHash: "0xold",
      })),
      upsertCursor: vi.fn(async () => undefined),
    };
    const ingest = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => ({
      rawLogCount: 1,
      latestBlockHash: "0xrerun",
      logs: [{ txHash: "0xtx", logIndex: 1 }],
      fromBlock,
      toBlock,
      warnings: [],
    }));
    const normalize = vi.fn(async () => [createDraft()]);
    const persistLedger = vi.fn(async () => ({
      actionGroupCount: 0,
      entryCount: 0,
    }));

    const result = await runWalletSync({
      wallet: {
        id: "wallet_1",
        chainId: 369,
        address: "0x1111111111111111111111111111111111111111",
      },
      sourceFamilies: ["TRANSFERS"],
      startBlock: 121n,
      endBlock: 150n,
      policyLabel: "rerun-window",
      dependencies: {
        runStore,
        cursorStore,
        ingestSourceFamily: ingest,
        normalizeSourceFamily: normalize,
        persistLedger,
      },
    });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 121n,
        toBlock: 150n,
      }),
    );
    expect(result.counts).toEqual({
      rawLogs: 1,
      actionGroups: 0,
      ledgerEntries: 0,
    });
  });

  it("marks the sync run as failed with stage and range context when normalization fails", async () => {
    const runStore = createRunStore();
    const cursorStore = {
      getCursor: vi.fn(async () => null),
      upsertCursor: vi.fn(async () => undefined),
    };
    const ingest = vi.fn(async () => ({
      rawLogCount: 1,
      latestBlockHash: "0xhash",
      logs: [{ txHash: "0xtx", logIndex: 1 }],
      fromBlock: 10n,
      toBlock: 20n,
      warnings: ["missing optional receipt"],
    }));
    const normalize = vi.fn(async () => {
      throw new Error("normalizer exploded");
    });

    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: "0x1111111111111111111111111111111111111111",
        },
        sourceFamilies: ["TRANSFERS"],
        startBlock: 10n,
        endBlock: 20n,
        policyLabel: "debug-window",
        dependencies: {
          runStore,
          cursorStore,
          ingestSourceFamily: ingest,
          normalizeSourceFamily: normalize,
          persistLedger: vi.fn(),
        },
      }),
    ).rejects.toThrow("normalizer exploded");

    expect(runStore.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run_1",
        status: "FAILED",
        stage: "NORMALIZING_LEDGER",
        warningCount: 1,
        latestSafeBlock: 20n,
        errorMessage: expect.stringContaining("TRANSFERS 10-20"),
      }),
    );
  });
});
