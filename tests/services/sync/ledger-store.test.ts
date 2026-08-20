import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicActionGroupId,
  buildDeterministicLedgerEntryId,
  persistNormalizedLedger,
  wrapPrismaClientAsLedgerStore,
} from "@/services/sync/ledger-store";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

function createDraft(
  overrides: Partial<CanonicalLedgerEntryDraft> = {},
): CanonicalLedgerEntryDraft {
  return {
    chainId: 369,
    walletId: "wallet_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    txHash: "0xtx",
    blockNumber: 100n,
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

describe("persistNormalizedLedger", () => {
  it("persists deterministic action group and ledger entry identities idempotently", async () => {
    const actionGroupCreateMany = vi.fn(async () => ({
      count: 1,
    }));
    const ledgerEntryCreateMany = vi.fn(async () => ({
      count: 2,
    }));

    const client = {
      ledgerActionGroup: {
        createMany: actionGroupCreateMany,
        findMany: vi.fn(async () => []),
      },
      ledgerEntry: {
        createMany: ledgerEntryCreateMany,
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    const actionGroupKey = "group_1";
    const first = createDraft({
      actionGroupKey,
      dedupeKey: "dedupe_1",
    });
    const second = createDraft({
      actionGroupKey,
      dedupeKey: "dedupe_2",
      sourceLogIndex: 2,
      sourceLogKey: "log:0xtx:2:transfer:receive",
    });

    const result = await persistNormalizedLedger([first, second, first], client);

    expect(result).toEqual({
      actionGroupCount: 1,
      entryCount: 2,
    });
    expect(actionGroupCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: buildDeterministicActionGroupId({
            chainId: first.chainId,
            walletId: first.walletId,
            actionGroupKey,
          }),
        }),
      ],
      skipDuplicates: true,
    });
    expect(ledgerEntryCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: buildDeterministicLedgerEntryId({
          chainId: first.chainId,
          walletId: first.walletId,
            dedupeKey: first.dedupeKey,
          }),
          actionGroupId: buildDeterministicActionGroupId({
            chainId: first.chainId,
            walletId: first.walletId,
            actionGroupKey,
          }),
        }),
        expect.objectContaining({
          id: buildDeterministicLedgerEntryId({
            chainId: second.chainId,
            walletId: second.walletId,
            dedupeKey: second.dedupeKey,
          }),
        }),
      ]),
      skipDuplicates: true,
    });
  });
});

describe("wrapPrismaClientAsLedgerStore", () => {
  it("opens the interactive transaction with a bounded, explicit maxWait/timeout (not the bare Prisma default)", async () => {
    const transactionSpy = vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number },
      ) => {
        void options;
        return callback({
          ledgerActionGroup: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
          ledgerEntry: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
        });
      },
    );

    const db = {
      ledgerActionGroup: { findMany: vi.fn(async () => []) },
      ledgerEntry: { findMany: vi.fn(async () => []) },
      $transaction: transactionSpy,
    };

    await persistNormalizedLedger(
      [
        createDraft({
          actionGroupKey: "group_tx_opts",
          dedupeKey: "dedupe_tx_opts",
        }),
      ],
      wrapPrismaClientAsLedgerStore(db as never),
    );

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    const [, options] = transactionSpy.mock.calls[0]!;
    expect(options).toMatchObject({ maxWait: expect.any(Number), timeout: expect.any(Number) });
    // Explicit and greater than Prisma's bare default (timeout: 5000ms),
    // to give reconcileConsumedTransferShadows' added round trips headroom.
    expect((options as { timeout: number }).timeout).toBeGreaterThan(5000);
  });
});
