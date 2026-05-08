import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicActionGroupId,
  buildDeterministicLedgerEntryId,
  persistNormalizedLedger,
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
      },
      ledgerEntry: {
        createMany: ledgerEntryCreateMany,
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
