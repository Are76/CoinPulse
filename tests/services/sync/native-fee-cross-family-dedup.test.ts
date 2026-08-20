import { describe, expect, it } from "vitest";

import { buildLedgerEntryDedupeKey } from "@/services/normalization/ledger-dedupe";
import { normalizeStakeEnd } from "@/services/normalization/stake-normalizer";
import { normalizeSwap } from "@/services/normalization/swap-normalizer";
import { normalizeNativeTransaction } from "@/services/normalization/transfer-normalizer";
import { toCanonicalQuantity } from "@/services/normalization/types";
import {
  buildDeterministicLedgerEntryId,
  persistNormalizedLedger,
  wrapPrismaClientAsLedgerStore,
} from "@/services/sync/ledger-store";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const LEGACY_NATIVE_ASSET_ID = "chain:369:native:PLS";
const PHEX_ASSET_ID = "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const CHAIN_ID = 369;
const WALLET_ID = "wallet_1";
const WALLET_ADDRESS = "0x75f808367720951e789d47e9e9db51148d9aa765";

/**
 * Regression fixture: real production evidence for wallet
 * 0x75f808367720951e789d47e9e9db51148d9aa765, tx
 * 0x3288d9623cd59829b8695b35d1a29a451137eaf758ebdbec0b42ed6c9e08c59b,
 * block 26154729 — a HEX stake-end transaction whose gas fee was found
 * duplicated across the STAKING and TRANSFERS normalizers during a rebuild
 * preflight (gasPriceRaw 978630231669573, gasUsedRaw 2363883).
 */
const REGRESSION_TX_HASH =
  "0x3288d9623cd59829b8695b35d1a29a451137eaf758ebdbec0b42ed6c9e08c59b";
const REGRESSION_BLOCK = 26154729n;
const REGRESSION_GAS_PRICE_RAW = "978630231669573";
const REGRESSION_GAS_USED_RAW = "2363883";
const REGRESSION_FEE_RAW = (
  BigInt(REGRESSION_GAS_PRICE_RAW) * BigInt(REGRESSION_GAS_USED_RAW)
).toString();
const REGRESSION_FEE_QUANTITY = toCanonicalQuantity({
  amountRaw: REGRESSION_FEE_RAW,
  decimals: 18,
});

function buildStakeEndDrafts(overrides: { txHash: string; stakeId: string }) {
  return normalizeStakeEnd({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    walletAddress: WALLET_ADDRESS,
    txHash: overrides.txHash,
    blockNumber: REGRESSION_BLOCK,
    occurredAt: new Date("2026-06-08T00:00:00.000Z"),
    normalizerVersion: "v1",
    assetId: PHEX_ASSET_ID,
    decimals: 8,
    principalReturnedRaw: "0",
    yieldRaw: "0",
    penaltyRaw: "0",
    feeAssetId: NATIVE_ASSET_ID,
    feeAmountRaw: REGRESSION_FEE_RAW,
    feeDecimals: 18,
    sourceRef: `stake:end:${overrides.stakeId}`,
  });
}

function buildNativeTransactionDrafts(overrides: { txHash: string }) {
  return normalizeNativeTransaction({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    walletAddress: WALLET_ADDRESS,
    txHash: overrides.txHash,
    blockNumber: REGRESSION_BLOCK,
    fromAddress: WALLET_ADDRESS,
    toAddress: "0x0000000000000000000000000000000000000000",
    valueRaw: "0",
    gasPriceRaw: REGRESSION_GAS_PRICE_RAW,
    gasUsedRaw: REGRESSION_GAS_USED_RAW,
    nativeAssetId: NATIVE_ASSET_ID,
    nativeDecimals: 18,
    occurredAt: new Date("2026-06-08T00:00:00.000Z"),
    normalizerVersion: "v1",
    // A TRANSFERS-family rebuild sees this tx's ACTIVE pHEX RawTokenTransfer
    // row too, so hasTrackedTokenTransfersInTransaction is true in
    // production; valueRaw is "0" here regardless, so this only affects
    // whether a native SEND/RECEIVE would fire — it does not gate FEE.
    hasTrackedTokenTransfersInTransaction: true,
  });
}

function buildSwapDrafts(overrides: { txHash: string; logIndex: number }) {
  return normalizeSwap({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    walletAddress: WALLET_ADDRESS,
    txHash: overrides.txHash,
    blockNumber: REGRESSION_BLOCK,
    sourceRef: `swap:pulsex-v2:${overrides.logIndex}`,
    occurredAt: new Date("2026-06-08T00:00:00.000Z"),
    normalizerVersion: "v1",
    soldAssetId: PHEX_ASSET_ID,
    soldAmountRaw: "100000000",
    soldDecimals: 8,
    boughtAssetId: "chain:369:erc20:0xf6f8db0aba00007681f8faf16a0fda1c9b030b11",
    boughtAmountRaw: "500000000000000000000",
    boughtDecimals: 18,
    feeAssetId: NATIVE_ASSET_ID,
    feeAmountRaw: REGRESSION_FEE_RAW,
    feeDecimals: 18,
  });
}

/**
 * Stateful in-memory double that mirrors the real Prisma persistence
 * contract used by ledger-store.ts: createMany({ skipDuplicates: true })
 * behaves like Postgres ON CONFLICT DO NOTHING keyed by id; findMany reads
 * reflect current state; updateMany mutates only the targeted field. State
 * persists across separate persistNormalizedLedger calls, so this can
 * simulate two independent rebuild invocations (e.g. STAKING then
 * TRANSFERS) writing to the same underlying tables.
 */
function createPersistentLedgerStoreClient() {
  const actionGroups = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, Record<string, unknown>>();

  const rawDb = {
    ledgerActionGroup: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        let count = 0;
        for (const row of data) {
          const id = row.id as string;
          if (!actionGroups.has(id)) {
            actionGroups.set(id, row);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        return Array.from(actionGroups.values())
          .filter((row) => where.id.in.includes(row.id as string))
          .map((row) => ({ id: row.id as string, actionType: row.actionType as string }));
      },
      // Honors the exact relation-filter shape wrapPrismaClientAsLedgerStore's
      // feeReassignmentCleanup.deleteEmptyActionGroups issues in production
      // (`entries: { none: {} }`), so this test store exercises the real
      // adapter code — not just a hand-rolled approximation of it — and
      // cascades child LedgerEntry deletion the same way
      // onDelete: Cascade does on the real LedgerEntry.actionGroup relation.
      deleteMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; entries?: { none: Record<string, never> } };
      }) => {
        let count = 0;
        for (const id of where.id.in) {
          if (where.entries?.none) {
            const hasEntries = Array.from(entries.values()).some(
              (row) => row.actionGroupId === id,
            );
            if (hasEntries) {
              continue;
            }
          }
          if (actionGroups.delete(id)) {
            for (const [entryId, row] of entries) {
              if (row.actionGroupId === id) {
                entries.delete(entryId);
              }
            }
            count += 1;
          }
        }
        return { count };
      },
    },
    ledgerEntry: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of data) {
            const id = row.id as string;
            if (!entries.has(id)) {
              entries.set(id, row);
              count += 1;
            }
          }
          return { count };
        },
        // Mirrors the real Prisma query resolveCanonicalFeeOwnership issues:
        // any already-persisted FEE row for the same
        // (chainId, walletId, txHash), regardless of which dedupeKey/id or
        // assetId string it was written under (old family-specific format,
        // legacy native asset id, or new canonical format alike).
        findMany: async ({
          where,
        }: {
          where: {
            chainId: { in: number[] };
            walletId: { in: string[] };
            txHash: { in: string[] };
            entryType: "FEE";
            direction: "OUT";
          };
        }) => {
          return Array.from(entries.values())
            .filter(
              (row) =>
                row.entryType === "FEE" &&
                where.chainId.in.includes(row.chainId as number) &&
                where.walletId.in.includes(row.walletId as string) &&
                where.txHash.in.includes((row.txHash as string).toLowerCase()) &&
                row.direction === "OUT",
            )
            .map((row) => ({
              id: row.id as string,
              chainId: row.chainId as number,
              walletId: row.walletId as string,
              txHash: row.txHash as string,
              actionGroupId: row.actionGroupId as string,
            }));
        },
        // Mirrors the real Prisma/Postgres foreign-key constraint:
        // LedgerEntry.actionGroupId is required and references
        // LedgerActionGroup.id. Reassigning to a group that has not been
        // created yet must fail here exactly as it would against a real
        // database, so this mock catches the write-ordering class of bug
        // it is designed to catch, not just count-based outcomes.
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: { actionGroupId: string };
        }) => {
          if (!actionGroups.has(data.actionGroupId)) {
            throw new Error(
              `foreign key violation: LedgerActionGroup ${data.actionGroupId} does not exist`,
            );
          }
          let count = 0;
          for (const id of where.id.in) {
            const row = entries.get(id);
            if (row) {
              row.actionGroupId = data.actionGroupId;
              count += 1;
            }
          }
          return { count };
        },
      },
  };

  // Routes through the real wrapPrismaClientAsLedgerStore adapter rather
  // than hand-rolling a feeReassignmentCleanup double, so these tests
  // exercise the exact production code that constructs the
  // `entries: { none: {} }` conditional delete — not just an approximation
  // of its intended behavior. rawDb has no rawTokenTransfer, so
  // transferShadowReconciliation stays disabled (unused by these tests) and
  // no $transaction, so persistNormalizedLedger runs directly against this
  // client without opening one, exactly as before this change.
  const client = wrapPrismaClientAsLedgerStore(rawDb as never);

  return {
    client,
    actionGroups,
    entries,
  };
}

function feeRows(entries: Map<string, Record<string, unknown>>) {
  return Array.from(entries.values()).filter((row) => row.entryType === "FEE");
}

function actionTypeOf(
  store: ReturnType<typeof createPersistentLedgerStoreClient>,
  actionGroupId: string,
) {
  return store.actionGroups.get(actionGroupId)?.actionType;
}

describe("cross-family native gas-fee dedup and canonical ownership", () => {
  it("STAKING then TRANSFERS produces exactly one FEE entry owned by STAKING", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("HEX_STAKE_END");
  });

  it("TRANSFERS then STAKING produces exactly one FEE entry, re-homed to STAKING", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );
    // Before STAKING runs, the fee is (correctly, for now) owned by the
    // generic TRANSFER group — the only action that has happened yet.
    expect(feeRows(store.entries)).toHaveLength(1);
    expect(actionTypeOf(store, feeRows(store.entries)[0].actionGroupId as string)).toBe(
      "TRANSFER",
    );

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("HEX_STAKE_END");
  });

  it("both normalization orders converge on the identical canonical fee owner", async () => {
    const storeStakingFirst = createPersistentLedgerStoreClient();
    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      storeStakingFirst.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      storeStakingFirst.client,
    );

    const storeTransfersFirst = createPersistentLedgerStoreClient();
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      storeTransfersFirst.client,
    );
    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      storeTransfersFirst.client,
    );

    const feeA = feeRows(storeStakingFirst.entries)[0];
    const feeB = feeRows(storeTransfersFirst.entries)[0];

    expect(actionTypeOf(storeStakingFirst, feeA.actionGroupId as string)).toBe("HEX_STAKE_END");
    expect(actionTypeOf(storeTransfersFirst, feeB.actionGroupId as string)).toBe(
      "HEX_STAKE_END",
    );
    // Same underlying LedgerEntry identity (id/dedupeKey) either way — only
    // the eventual actionGroupId can differ mid-flight, never the final one.
    expect(feeA.id).toBe(feeB.id);
    expect(feeA.dedupeKey).toBe(feeB.dedupeKey);
    expect(feeA.quantity).toBe(feeB.quantity);
  });

  it("rebuilding TRANSFERS twice produces exactly one FEE entry", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    expect(feeRows(store.entries)).toHaveLength(1);
  });

  it("rebuilding STAKING twice produces exactly one FEE entry", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );
    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    expect(feeRows(store.entries)).toHaveLength(1);
  });

  it("rebuilding STAKING then TRANSFERS repeatedly remains idempotent (fee count and owner stable)", async () => {
    const store = createPersistentLedgerStoreClient();

    for (let i = 0; i < 3; i += 1) {
      await persistNormalizedLedger(
        buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
        store.client,
      );
      await persistNormalizedLedger(
        buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
        store.client,
      );
    }

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("HEX_STAKE_END");
  });

  it("rebuilding both families together (single persist call) produces exactly one FEE entry owned by STAKING", async () => {
    const store = createPersistentLedgerStoreClient();

    const combinedDrafts: CanonicalLedgerEntryDraft[] = [
      ...buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      ...buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
    ];

    await persistNormalizedLedger(combinedDrafts, store.client);

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("HEX_STAKE_END");
    // The TRANSFER action group (whose only draft was the losing FEE) must
    // never be persisted at all.
    const transferGroups = Array.from(store.actionGroups.values()).filter(
      (group) => group.actionType === "TRANSFER",
    );
    expect(transferGroups).toHaveLength(0);
  });

  it("SWAP outranks a plain TRANSFER fee, regardless of order", async () => {
    const swapTx = "0xswap0000000000000000000000000000000000000000000000000000000001";
    const storeSwapFirst = createPersistentLedgerStoreClient();
    await persistNormalizedLedger(
      buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
      storeSwapFirst.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: swapTx }),
      storeSwapFirst.client,
    );
    expect(feeRows(storeSwapFirst.entries)).toHaveLength(1);
    expect(
      actionTypeOf(storeSwapFirst, feeRows(storeSwapFirst.entries)[0].actionGroupId as string),
    ).toBe("SWAP");

    const storeTransferFirst = createPersistentLedgerStoreClient();
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: swapTx }),
      storeTransferFirst.client,
    );
    await persistNormalizedLedger(
      buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
      storeTransferFirst.client,
    );
    expect(feeRows(storeTransferFirst.entries)).toHaveLength(1);
    expect(
      actionTypeOf(
        storeTransferFirst,
        feeRows(storeTransferFirst.entries)[0].actionGroupId as string,
      ),
    ).toBe("SWAP");
  });

  it("preserves the associated staking action entries alongside the deduped fee", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const entryTypes = Array.from(store.entries.values()).map((row) => row.entryType);
    expect(entryTypes).toContain("STAKE_END");
    expect(entryTypes).toContain("FEE");
    expect(entryTypes.filter((type) => type === "FEE")).toHaveLength(1);
  });

  it("keeps distinct transactions' fees distinct", async () => {
    const store = createPersistentLedgerStoreClient();
    const otherTxHash =
      "0xad4359252cfb41144733301f3bf626b9467047ab9bb508012e808f6f776ccf1d";

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: otherTxHash }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(2);
    expect(new Set(fees.map((row) => row.txHash))).toEqual(
      new Set([REGRESSION_TX_HASH, otherTxHash]),
    );
  });

  it("produces no FEE entry for a zero-fee TRANSFERS transaction", () => {
    const drafts = normalizeNativeTransaction({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      txHash: "0xzero-fee",
      blockNumber: 1n,
      fromAddress: WALLET_ADDRESS,
      toAddress: "0x2222222222222222222222222222222222222222",
      valueRaw: "0",
      gasPriceRaw: null,
      gasUsedRaw: null,
      nativeAssetId: NATIVE_ASSET_ID,
      nativeDecimals: 18,
      occurredAt: new Date("2026-06-08T00:00:00.000Z"),
      normalizerVersion: "v1",
    });

    expect(drafts.some((draft) => draft.entryType === "FEE")).toBe(false);
  });

  it("produces no FEE entry for a zero-fee SWAP", () => {
    const drafts = normalizeSwap({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      txHash: "0xzero-fee-swap",
      blockNumber: 1n,
      sourceRef: "swap:pulsex-v2:1",
      occurredAt: new Date("2026-06-08T00:00:00.000Z"),
      normalizerVersion: "v1",
      soldAssetId: PHEX_ASSET_ID,
      soldAmountRaw: "100000000",
      soldDecimals: 8,
      boughtAssetId: "chain:369:erc20:0xf6f8db0aba00007681f8faf16a0fda1c9b030b11",
      boughtAmountRaw: "500000000000000000000",
      boughtDecimals: 18,
      feeAssetId: NATIVE_ASSET_ID,
      feeAmountRaw: "0",
      feeDecimals: 18,
    });

    expect(drafts.some((draft) => draft.entryType === "FEE")).toBe(false);
    expect(drafts.map((draft) => draft.entryType)).toEqual(["SWAP_OUT", "SWAP_IN"]);
  });

  it("a zero fee on one transaction never blocks a later real fee on the same transaction", async () => {
    const store = createPersistentLedgerStoreClient();
    const txHash = "0xswap0000000000000000000000000000000000000000000000000000000002";

    // A zero-fee SWAP normalization contributes no FEE draft at all.
    await persistNormalizedLedger(
      normalizeSwap({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        walletAddress: WALLET_ADDRESS,
        txHash,
        blockNumber: 1n,
        sourceRef: "swap:pulsex-v2:1",
        occurredAt: new Date("2026-06-08T00:00:00.000Z"),
        normalizerVersion: "v1",
        soldAssetId: PHEX_ASSET_ID,
        soldAmountRaw: "100000000",
        soldDecimals: 8,
        boughtAssetId: "chain:369:erc20:0xf6f8db0aba00007681f8faf16a0fda1c9b030b11",
        boughtAmountRaw: "500000000000000000000",
        boughtDecimals: 18,
        feeAssetId: NATIVE_ASSET_ID,
        feeAmountRaw: "0",
        feeDecimals: 18,
      }),
      store.client,
    );
    expect(feeRows(store.entries)).toHaveLength(0);

    // A later TRANSFERS normalization of the same tx supplies the real fee.
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
  });

  it("does not collapse unrelated ledger entries from the same transactions", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );
    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    // STAKE_END (from staking) must survive; the transfer draft here has no
    // SEND/RECEIVE (valueRaw "0" + hasTrackedTokenTransfersInTransaction),
    // so only its FEE draft overlaps with staking's FEE.
    const entryTypes = Array.from(store.entries.values()).map((row) => row.entryType);
    expect(entryTypes.filter((type) => type === "STAKE_END")).toHaveLength(1);
    expect(entryTypes.filter((type) => type === "FEE")).toHaveLength(1);
    expect(store.entries.size).toBe(2);
  });
});

/**
 * Seeds the store with a FEE row exactly as it would have been persisted by
 * a pre-PR normalizer run, using the OLD family-specific sourceRef pattern
 * (never NATIVE_GAS_FEE_SOURCE_REF) and, optionally, the legacy symbol-based
 * native asset id string. This bypasses persistNormalizedLedger entirely —
 * it represents already-committed database state, not a fresh
 * normalization — so it proves detection is format-agnostic rather than
 * dependent on any particular sourceRef or assetId string. Also seeds the
 * owning action group so ownership-priority resolution has real data to
 * compare against, exactly as a real database would.
 */
function seedLegacyFee(
  store: ReturnType<typeof createPersistentLedgerStoreClient>,
  args: {
    txHash: string;
    legacySourceRef: string;
    actionGroupId: string;
    actionType: string;
    quantity: string;
    assetId?: string;
  },
) {
  const assetId = args.assetId ?? NATIVE_ASSET_ID;
  const dedupeKey = buildLedgerEntryDedupeKey({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    txHash: args.txHash,
    entryType: "FEE",
    assetId,
    direction: "OUT",
    normalizerVersion: "v1",
    sourceRef: args.legacySourceRef,
  });
  const id = buildDeterministicLedgerEntryId({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    dedupeKey,
  });
  store.actionGroups.set(args.actionGroupId, {
    id: args.actionGroupId,
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    txHash: args.txHash.toLowerCase(),
    actionType: args.actionType,
  });
  store.entries.set(id, {
    id,
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    actionGroupId: args.actionGroupId,
    txHash: args.txHash.toLowerCase(),
    entryType: "FEE",
    assetId,
    quantity: args.quantity,
    direction: "OUT",
    dedupeKey,
  });
  return { id, dedupeKey };
}

describe("orphaned action-group cleanup after fee reassignment", () => {
  it("deletes the old TRANSFER group once its only entry (the FEE) is re-homed to a higher-priority SWAP group", async () => {
    const store = createPersistentLedgerStoreClient();
    const swapTx = "0xswap0000000000000000000000000000000000000000000000000000000003";

    await persistNormalizedLedger(buildNativeTransactionDrafts({ txHash: swapTx }), store.client);

    const feesBefore = feeRows(store.entries);
    expect(feesBefore).toHaveLength(1);
    const transferGroupId = feesBefore[0].actionGroupId as string;
    expect(actionTypeOf(store, transferGroupId)).toBe("TRANSFER");
    expect(store.actionGroups.has(transferGroupId)).toBe(true);

    await persistNormalizedLedger(
      buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
      store.client,
    );

    // The old TRANSFER group had exactly one entry (the FEE); once that FEE
    // is re-homed to SWAP, the TRANSFER group has zero entries and must be
    // removed rather than left as a permanent orphan.
    expect(store.actionGroups.has(transferGroupId)).toBe(false);

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    const swapGroupId = fees[0].actionGroupId as string;
    expect(actionTypeOf(store, swapGroupId)).toBe("SWAP");

    const swapGroupEntryTypes = Array.from(store.entries.values())
      .filter((row) => row.actionGroupId === swapGroupId)
      .map((row) => row.entryType)
      .sort();
    expect(swapGroupEntryTypes).toEqual(["FEE", "SWAP_IN", "SWAP_OUT"]);
  });

  it("does not delete the old TRANSFER group when it still owns a legitimate entry after fee re-homing", async () => {
    const store = createPersistentLedgerStoreClient();
    const swapTx = "0xswap0000000000000000000000000000000000000000000000000000000004";

    const transferDrafts = normalizeNativeTransaction({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      walletAddress: WALLET_ADDRESS,
      txHash: swapTx,
      blockNumber: REGRESSION_BLOCK,
      fromAddress: WALLET_ADDRESS,
      toAddress: "0x9999999999999999999999999999999999999999",
      valueRaw: "1000000000000000000",
      gasPriceRaw: REGRESSION_GAS_PRICE_RAW,
      gasUsedRaw: REGRESSION_GAS_USED_RAW,
      nativeAssetId: NATIVE_ASSET_ID,
      nativeDecimals: 18,
      occurredAt: new Date("2026-06-08T00:00:00.000Z"),
      normalizerVersion: "v1",
      hasTrackedTokenTransfersInTransaction: false,
    });
    expect(transferDrafts.map((draft) => draft.entryType).sort()).toEqual(["FEE", "SEND"]);

    await persistNormalizedLedger(transferDrafts, store.client);

    const feesBefore = feeRows(store.entries);
    expect(feesBefore).toHaveLength(1);
    const transferGroupId = feesBefore[0].actionGroupId as string;
    expect(store.entries.size).toBe(2); // SEND + FEE, same TRANSFER group

    await persistNormalizedLedger(
      buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
      store.client,
    );

    // The FEE moved to SWAP, but the TRANSFER group's SEND entry survives,
    // so the TRANSFER group itself must not be deleted.
    expect(store.actionGroups.has(transferGroupId)).toBe(true);
    const remainingTransferEntries = Array.from(store.entries.values()).filter(
      (row) => row.actionGroupId === transferGroupId,
    );
    expect(remainingTransferEntries).toHaveLength(1);
    expect(remainingTransferEntries[0].entryType).toBe("SEND");

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("SWAP");
  });

  it("produces no duplicate FEE and no lingering orphan when the same evidence is persisted repeatedly (idempotent)", async () => {
    const store = createPersistentLedgerStoreClient();
    const swapTx = "0xswap0000000000000000000000000000000000000000000000000000000005";

    for (let i = 0; i < 3; i += 1) {
      await persistNormalizedLedger(
        buildNativeTransactionDrafts({ txHash: swapTx }),
        store.client,
      );
      await persistNormalizedLedger(
        buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
        store.client,
      );
    }

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("SWAP");

    // No orphaned empty TRANSFER group left behind across repeated runs.
    const transferGroups = Array.from(store.actionGroups.values()).filter(
      (group) => group.actionType === "TRANSFER",
    );
    expect(transferGroups).toHaveLength(0);
  });

  it("re-checks emptiness at the moment deleteEmptyActionGroups actually runs, not against an earlier observation", async () => {
    // What this proves: the cleanup step never trusts a previously-cached
    // "this group looked empty" fact — a write landing in the candidate
    // group strictly before the (single) deleteEmptyActionGroups call still
    // correctly excludes that group, because there is no separate prior
    // count step left to go stale. This is an in-memory, single-threaded
    // simulation and can only model a write that is already committed by
    // the time the relation filter evaluates — it cannot exercise real
    // PostgreSQL MVCC visibility of a genuinely concurrent, still-uncommitted
    // transaction. That case (an uncommitted writer racing this exact
    // DELETE) is settled by PostgreSQL's own foreign-key row locking, not by
    // anything this test can simulate — see the feeReassignmentCleanup doc
    // comment on LedgerStoreClient in src/services/sync/ledger-store.ts for
    // that argument in full.
    const store = createPersistentLedgerStoreClient();
    const swapTx = "0xswap0000000000000000000000000000000000000000000000000000000006";

    await persistNormalizedLedger(buildNativeTransactionDrafts({ txHash: swapTx }), store.client);

    const feesBefore = feeRows(store.entries);
    expect(feesBefore).toHaveLength(1);
    const transferGroupId = feesBefore[0].actionGroupId as string;
    expect(actionTypeOf(store, transferGroupId)).toBe("TRANSFER");

    // Injects a new, legitimate LedgerEntry into the candidate group
    // immediately before delegating to the real
    // feeReassignmentCleanup.deleteEmptyActionGroups (not a stub returning a
    // canned result) — proving the actual relation-filter check, not an
    // assumption about it, is what excludes the group.
    const realDeleteEmptyActionGroups =
      store.client.feeReassignmentCleanup!.deleteEmptyActionGroups;
    const concurrentEntryId = "le_concurrent_receive";
    let concurrentWriteInjected = false;
    store.client.feeReassignmentCleanup!.deleteEmptyActionGroups = async (args) => {
      if (!concurrentWriteInjected) {
        concurrentWriteInjected = true;
        store.entries.set(concurrentEntryId, {
          id: concurrentEntryId,
          chainId: CHAIN_ID,
          walletId: WALLET_ID,
          actionGroupId: transferGroupId,
          txHash: swapTx,
          entryType: "RECEIVE",
          assetId: NATIVE_ASSET_ID,
          quantity: "1",
          direction: "IN",
          dedupeKey: "concurrent:receive",
        });
      }
      return realDeleteEmptyActionGroups(args);
    };

    await persistNormalizedLedger(
      buildSwapDrafts({ txHash: swapTx, logIndex: 12 }),
      store.client,
    );

    // The concurrently-committed entry must survive — no cascade deletion.
    expect(store.entries.has(concurrentEntryId)).toBe(true);
    // The TRANSFER group itself must survive too: it was no longer empty at
    // the moment the atomic delete actually evaluated its condition.
    expect(store.actionGroups.has(transferGroupId)).toBe(true);

    // The FEE re-homing to SWAP still proceeds correctly, unaffected by the
    // preserved TRANSFER group.
    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("SWAP");
  });
});

describe("legacy pre-PR fee identity compatibility", () => {
  it("regression: a legacy STAKING fee already exists, then TRANSFERS is rebuilt — exactly one economic fee, still STAKING-owned", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
      actionType: "HEX_STAKE_END",
      quantity: REGRESSION_FEE_QUANTITY,
    });
    expect(store.entries.size).toBe(1);

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    expect(fees[0].actionGroupId).toBe("lag_legacy_stake_end");
  });

  it("a legacy TRANSFERS fee already exists, then STAKING is rebuilt — exactly one economic fee, re-homed to STAKING", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "transfer:tx:fee",
      actionGroupId: "lag_legacy_transfer",
      actionType: "TRANSFER",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    // Re-homed in place: same row id, new (canonical, higher-priority) owner.
    expect(fees[0].id).toBe(
      buildDeterministicLedgerEntryId({
        chainId: CHAIN_ID,
        walletId: WALLET_ID,
        dedupeKey: buildLedgerEntryDedupeKey({
          chainId: CHAIN_ID,
          walletId: WALLET_ID,
          txHash: REGRESSION_TX_HASH,
          entryType: "FEE",
          assetId: NATIVE_ASSET_ID,
          direction: "OUT",
          normalizerVersion: "v1",
          sourceRef: "transfer:tx:fee",
        }),
      }),
    );
    expect(actionTypeOf(store, fees[0].actionGroupId as string)).toBe("HEX_STAKE_END");
  });

  it("a legacy DEX fee already exists, then TRANSFERS is rebuilt — exactly one economic fee, still DEX-owned", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "swap:pulsex-v2:12:fee",
      actionGroupId: "lag_legacy_swap",
      actionType: "SWAP",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    expect(fees[0].actionGroupId).toBe("lag_legacy_swap");
  });

  it("a legacy LP fee already exists, then TRANSFERS is rebuilt — exactly one economic fee, still LP-owned", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "lp:add:5:fee",
      actionGroupId: "lag_legacy_lp_add",
      actionType: "LP_ADD",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
    expect(fees[0].actionGroupId).toBe("lag_legacy_lp_add");
  });

  it("a legacy fee recorded under the old symbol-based native asset id is still recognized", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
      actionType: "HEX_STAKE_END",
      quantity: REGRESSION_FEE_QUANTITY,
      assetId: LEGACY_NATIVE_ASSET_ID,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].assetId).toBe(LEGACY_NATIVE_ASSET_ID);
  });

  it("does not suppress a legitimate fee on a different transaction", async () => {
    const store = createPersistentLedgerStoreClient();
    const otherTxHash =
      "0xad4359252cfb41144733301f3bf626b9467047ab9bb508012e808f6f776ccf1d";

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
      actionType: "HEX_STAKE_END",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: otherTxHash }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(2);
    expect(new Set(fees.map((row) => row.txHash))).toEqual(
      new Set([REGRESSION_TX_HASH, otherTxHash]),
    );
  });

  it("preserves the legacy-owned action entry unchanged when the fee is re-homed", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "transfer:tx:fee",
      actionGroupId: "lag_legacy_transfer",
      actionType: "TRANSFER",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    expect(feeRows(store.entries)).toHaveLength(1);
    // The STAKE_END action entry from this run is present alongside it.
    const entryTypes = Array.from(store.entries.values()).map((row) => row.entryType);
    expect(entryTypes).toContain("STAKE_END");
    expect(store.entries.size).toBe(2);
  });
});
