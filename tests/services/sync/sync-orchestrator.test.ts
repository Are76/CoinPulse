import { describe, expect, it, vi } from "vitest";
import type { SourceFamily } from "@prisma/client";

import { runWalletSync } from "@/services/sync/sync-orchestrator";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";
import { OperationConflictError } from "@/services/operations/operation-lock";

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
    expect(runStore.updates[0]).toEqual(
      expect.objectContaining({
        runId: "run_1",
        status: "RUNNING",
        stage: "INGESTING_RAW_LOGS",
        startBlock: 121n,
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
    expect(cursorStore.upsertCursor).toHaveBeenCalledWith({
      walletId: "wallet_1",
      chainId: 369,
      sourceFamily: "TRANSFERS",
      fromBlock: 121n,
      toBlock: 150n,
      blockHash: "0xrerun",
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
        failedSourceFamily: "TRANSFERS",
        failedFromBlock: 10n,
        failedToBlock: 20n,
        warningCount: 1,
        warningDetails: ["missing optional receipt"],
        latestSafeBlock: 20n,
        errorMessage: expect.stringContaining("TRANSFERS 10-20"),
      }),
    );
  });

  it("aggregates a very large ingest warning set without throwing a RangeError", async () => {
    const runStore = createRunStore();
    const cursorStore = {
      getCursor: vi.fn(async () => null),
      upsertCursor: vi.fn(async () => undefined),
    };
    const warningCount = 200_000;
    const largeWarnings = Array.from(
      { length: warningCount },
      (_, index) => `skip-stake:0x${index.toString(16)}:unsupported-initiator`,
    );
    const ingest = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => ({
      rawLogCount: 0,
      latestBlockHash: "0xnew",
      logs: [],
      fromBlock,
      toBlock,
      warnings: largeWarnings,
    }));
    const normalize = vi.fn(async () => []);
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
      sourceFamilies: ["STAKING"],
      startBlock: 10n,
      endBlock: 20n,
      policyLabel: "large-warning-set",
      dependencies: {
        runStore,
        cursorStore,
        ingestSourceFamily: ingest,
        normalizeSourceFamily: normalize,
        persistLedger,
      },
    });

    expect(result.warningCount).toBe(warningCount);
    expect(runStore.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run_1",
        status: "COMPLETED",
        warningCount,
      }),
    );
  });

  it("preserves the underlying error message in the failure diagnostics", async () => {
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
      warnings: [],
    }));
    const normalize = vi.fn(async () => {
      throw new Error("Invalid array length while building ledger draft");
    });

    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: "0x1111111111111111111111111111111111111111",
        },
        sourceFamilies: ["STAKING"],
        startBlock: 10n,
        endBlock: 20n,
        policyLabel: "diagnostic-window",
        dependencies: {
          runStore,
          cursorStore,
          ingestSourceFamily: ingest,
          normalizeSourceFamily: normalize,
          persistLedger: vi.fn(),
        },
      }),
    ).rejects.toThrow("Invalid array length while building ledger draft");

    expect(runStore.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run_1",
        status: "FAILED",
        stage: "NORMALIZING_LEDGER",
        errorMessage: expect.stringContaining(
          "Invalid array length while building ledger draft",
        ),
      }),
    );
  });

  it("fails fast when the concrete sync path is asked to run unsupported source families", async () => {
    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: "0x1111111111111111111111111111111111111111",
        },
        sourceFamilies: ["DEX"],
        startBlock: 10n,
        endBlock: 20n,
        policyLabel: "unsupported-family",
        dependencies: {
          supportedSourceFamilies: ["TRANSFERS"],
          ingestSourceFamily: vi.fn(),
          normalizeSourceFamily: vi.fn(),
        },
      }),
    ).rejects.toThrow(
      "Unsupported source families for the current concrete sync path: DEX. Supported families: TRANSFERS.",
    );
  });

  it("marks a pre-reserved run failed when unsupported families fail before ingestion", async () => {
    const runStore = createRunStore();

    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: "0x1111111111111111111111111111111111111111",
        },
        sourceFamilies: ["NATIVE"],
        startBlock: 10n,
        endBlock: 20n,
        policyLabel: "unsupported-family",
        dependencies: {
          supportedSourceFamilies: ["TRANSFERS"],
          runStore,
          cursorStore: {
            getCursor: vi.fn(async () => null),
            upsertCursor: vi.fn(async () => undefined),
          },
          reserveOperationRun: vi.fn(async () => ({ id: "pre-reserved-run" })),
          ingestSourceFamily: vi.fn(),
          normalizeSourceFamily: vi.fn(),
          persistLedger: vi.fn(),
        },
      }),
    ).rejects.toThrow(
      "Unsupported source families for the current concrete sync path: NATIVE. Supported families: TRANSFERS.",
    );

    expect(runStore.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "pre-reserved-run",
        status: "FAILED",
        stage: "PENDING",
        startBlock: 10n,
        errorMessage: expect.stringContaining("unknown-range"),
      }),
    );
  });

  it("blocks a manual sync when an active rebuild conflict is reported", async () => {
    const reserveOperationRun = vi.fn(async () => {
      throw new OperationConflictError({
        allowed: false,
        reason: "active_rebuild_in_progress",
        conflictingOperationId: "run-rebuild-1",
        conflictingTrigger: "REBUILD",
        conflictingStage: "REBUILDING_LEDGER",
        startedAt: "2026-05-08T12:00:00.000Z",
        createdAt: "2026-05-08T12:00:00.000Z",
        updatedAt: "2026-05-08T12:01:00.000Z",
        operationType: "rebuild",
        status: "RUNNING",
        ageMs: 60000,
        appearsStale: false,
        staleReason: null,
      });
    });

    await expect(
      runWalletSync({
        wallet: {
          id: "wallet_1",
          chainId: 369,
          address: "0x1111111111111111111111111111111111111111",
        },
        sourceFamilies: ["TRANSFERS"],
        endBlock: 20n,
        policyLabel: "manual-dashboard-sync",
        dependencies: {
          cursorStore: {
            getCursor: vi.fn(async () => null),
            upsertCursor: vi.fn(async () => undefined),
          },
          ingestSourceFamily: vi.fn(),
          normalizeSourceFamily: vi.fn(),
          reserveOperationRun,
        },
      }),
    ).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
      details: expect.objectContaining({
        reason: "active_rebuild_in_progress",
        conflictingOperationId: "run-rebuild-1",
      }),
    });
  });
});
