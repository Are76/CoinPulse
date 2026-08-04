import { describe, expect, it } from "vitest";

import { buildLedgerEntryDedupeKey } from "@/services/normalization/ledger-dedupe";
import { normalizeStakeEnd } from "@/services/normalization/stake-normalizer";
import { normalizeNativeTransaction } from "@/services/normalization/transfer-normalizer";
import { toCanonicalQuantity } from "@/services/normalization/types";
import {
  buildDeterministicActionGroupId,
  buildDeterministicLedgerEntryId,
  persistNormalizedLedger,
} from "@/services/sync/ledger-store";
import type { CanonicalLedgerEntryDraft } from "@/services/normalization";

const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
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

/**
 * Stateful in-memory double that mirrors the real Prisma
 * `createMany({ skipDuplicates: true })` contract: a row whose id already
 * exists is silently skipped, exactly like Postgres `ON CONFLICT DO NOTHING`.
 * Unlike a plain vi.fn() spy, state persists across separate
 * persistNormalizedLedger calls, so this can simulate two independent
 * rebuild invocations (e.g. STAKING then TRANSFERS) writing to the same
 * underlying table.
 */
function createPersistentLedgerStoreClient() {
  const actionGroups = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, Record<string, unknown>>();

  return {
    client: {
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
        // Mirrors the real Prisma query dropDuplicateEconomicFees issues:
        // any already-persisted FEE row for the same
        // (chainId, walletId, txHash, assetId, direction), regardless of
        // which dedupeKey/id it was written under (old family-specific
        // format or new canonical format alike).
        findMany: async ({
          where,
        }: {
          where: {
            chainId: { in: number[] };
            walletId: { in: string[] };
            txHash: { in: string[] };
            entryType: "FEE";
            assetId: { in: string[] };
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
                where.assetId.in.includes(row.assetId as string) &&
                row.direction === "OUT",
            )
            .map((row) => ({
              chainId: row.chainId as number,
              walletId: row.walletId as string,
              txHash: row.txHash as string,
              assetId: row.assetId as string,
              direction: row.direction as string,
            }));
        },
      },
    },
    actionGroups,
    entries,
  };
}

function feeRows(entries: Map<string, Record<string, unknown>>) {
  return Array.from(entries.values()).filter((row) => row.entryType === "FEE");
}

describe("cross-family native gas-fee dedup", () => {
  it("STAKING then TRANSFERS produces exactly one FEE entry", async () => {
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
  });

  it("TRANSFERS then STAKING produces exactly one FEE entry", async () => {
    const store = createPersistentLedgerStoreClient();

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );
    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
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

  it("rebuilding both families together (single persist call) produces exactly one FEE entry", async () => {
    const store = createPersistentLedgerStoreClient();

    const combinedDrafts: CanonicalLedgerEntryDraft[] = [
      ...buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      ...buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
    ];

    await persistNormalizedLedger(combinedDrafts, store.client);

    expect(feeRows(store.entries)).toHaveLength(1);
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

  it("produces no FEE entry for a zero-fee transaction", () => {
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

  it("keeps the regression fee quantity bigint/Decimal safe and exact", () => {
    const staking = buildStakeEndDrafts({
      txHash: REGRESSION_TX_HASH,
      stakeId: "800372",
    });
    const transfer = buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH });

    const stakingFee = staking.find((draft) => draft.entryType === "FEE");
    const transferFee = transfer.find((draft) => draft.entryType === "FEE");

    expect(stakingFee?.quantity).toBe("2313.367367929765231959");
    expect(transferFee?.quantity).toBe("2313.367367929765231959");
    expect(stakingFee?.dedupeKey).toBe(transferFee?.dedupeKey);
  });

  it("regression: block 26154729 dedupe keys and deterministic ids match across families", () => {
    const staking = buildStakeEndDrafts({
      txHash: REGRESSION_TX_HASH,
      stakeId: "800372",
    });
    const transfer = buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH });

    const stakingFee = staking.find((draft) => draft.entryType === "FEE");
    const transferFee = transfer.find((draft) => draft.entryType === "FEE");
    expect(stakingFee).toBeDefined();
    expect(transferFee).toBeDefined();

    const stakingId = buildDeterministicLedgerEntryId({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      dedupeKey: stakingFee!.dedupeKey,
    });
    const transferId = buildDeterministicLedgerEntryId({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      dedupeKey: transferFee!.dedupeKey,
    });

    expect(stakingId).toBe(transferId);

    // Action groups remain distinct — only the FEE entry's identity is
    // shared; the owning action (stake end vs. plain transfer tx) keeps its
    // own actionGroupKey/actionGroupId.
    const stakingGroupId = buildDeterministicActionGroupId({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      actionGroupKey: stakingFee!.actionGroupKey,
    });
    const transferGroupId = buildDeterministicActionGroupId({
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      actionGroupKey: transferFee!.actionGroupKey,
    });
    expect(stakingGroupId).not.toBe(transferGroupId);
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
 * (never NATIVE_GAS_FEE_SOURCE_REF). This bypasses persistNormalizedLedger
 * entirely — it represents already-committed database state, not a fresh
 * normalization — so it proves detection is format-agnostic rather than
 * dependent on any particular sourceRef string.
 */
function seedLegacyFee(
  store: ReturnType<typeof createPersistentLedgerStoreClient>,
  args: {
    txHash: string;
    legacySourceRef: string;
    actionGroupId: string;
    quantity: string;
  },
) {
  const dedupeKey = buildLedgerEntryDedupeKey({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    txHash: args.txHash,
    entryType: "FEE",
    assetId: NATIVE_ASSET_ID,
    direction: "OUT",
    normalizerVersion: "v1",
    sourceRef: args.legacySourceRef,
  });
  const id = buildDeterministicLedgerEntryId({
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    dedupeKey,
  });
  store.entries.set(id, {
    id,
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    actionGroupId: args.actionGroupId,
    txHash: args.txHash.toLowerCase(),
    entryType: "FEE",
    assetId: NATIVE_ASSET_ID,
    quantity: args.quantity,
    direction: "OUT",
    dedupeKey,
  });
  return { id, dedupeKey };
}

describe("legacy pre-PR fee identity compatibility", () => {
  it("regression: a legacy STAKING fee already exists, then TRANSFERS is rebuilt — exactly one economic fee", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
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
  });

  it("a legacy TRANSFERS fee already exists, then STAKING is rebuilt — exactly one economic fee", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "transfer:tx:fee",
      actionGroupId: "lag_legacy_transfer",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildStakeEndDrafts({ txHash: REGRESSION_TX_HASH, stakeId: "800372" }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
  });

  it("a legacy DEX fee already exists, then TRANSFERS is rebuilt — exactly one economic fee", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "swap:pulsex-v2:12:fee",
      actionGroupId: "lag_legacy_swap",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
  });

  it("a legacy LP fee already exists, then TRANSFERS is rebuilt — exactly one economic fee", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "lp:add:5:fee",
      actionGroupId: "lag_legacy_lp_add",
      quantity: REGRESSION_FEE_QUANTITY,
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    const fees = feeRows(store.entries);
    expect(fees).toHaveLength(1);
    expect(fees[0].quantity).toBe(REGRESSION_FEE_QUANTITY);
  });

  it("does not suppress a legitimate fee on a different transaction", async () => {
    const store = createPersistentLedgerStoreClient();
    const otherTxHash =
      "0xad4359252cfb41144733301f3bf626b9467047ab9bb508012e808f6f776ccf1d";

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
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

  it("preserves the legacy-owned action entry and its action group unchanged", async () => {
    const store = createPersistentLedgerStoreClient();

    seedLegacyFee(store, {
      txHash: REGRESSION_TX_HASH,
      legacySourceRef: "stake:end:800372:fee",
      actionGroupId: "lag_legacy_stake_end",
      quantity: REGRESSION_FEE_QUANTITY,
    });
    // Also seed the STAKE_END action entry itself, exactly as a real prior
    // stake-end normalization would have left it, to prove it is untouched.
    store.entries.set("le_legacy_stake_end_marker", {
      id: "le_legacy_stake_end_marker",
      chainId: CHAIN_ID,
      walletId: WALLET_ID,
      actionGroupId: "lag_legacy_stake_end",
      txHash: REGRESSION_TX_HASH.toLowerCase(),
      entryType: "STAKE_END",
      assetId: PHEX_ASSET_ID,
      quantity: "0",
      direction: "INTERNAL",
      dedupeKey: "legacy-stake-end-marker",
    });

    await persistNormalizedLedger(
      buildNativeTransactionDrafts({ txHash: REGRESSION_TX_HASH }),
      store.client,
    );

    expect(store.entries.get("le_legacy_stake_end_marker")).toBeDefined();
    expect(feeRows(store.entries)).toHaveLength(1);
    expect(store.entries.size).toBe(2);
  });
});
