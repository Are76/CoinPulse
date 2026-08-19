import { describe, expect, it } from "vitest";

import { repairCanonicalRawTransferProvenance } from "@/services/sync/canonical-provenance-repair";
import {
  checkEnv,
  parseProvenanceRepairCliArgs,
} from "../../../scripts/repair-canonical-provenance";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x9999999999999999999999999999999999999999";
const CHAIN_ID = 369;
const PHEX = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
// Deliberately not long runs of a single repeated letter: some ICU locale
// collations (e.g. Danish "aa") sort repeated-letter runs in
// locale-dependent, non-ASCIIbetical order, which would make this fixture's
// expected sortPairAssets() ordering environment-dependent.
const TOKEN_A = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const TOKEN_B = "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const TOKEN_C = "0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
const LP_TOKEN = "0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";

type MockTransfer = {
  id: string;
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  status: string;
};

type MockSwap = {
  id: string;
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  initiatorAddress: string;
  soldAssetIdSnapshot: string;
  soldAmountRaw: string;
  boughtAssetIdSnapshot: string;
  boughtAmountRaw: string;
  status: string;
  rawTransferEvidenceStatus: string | null;
};

type MockLpAction = {
  id: string;
  chainId: number;
  actionKind: "ADD" | "REMOVE";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  initiatorAddress: string;
  token0AssetIdSnapshot: string;
  token0AmountRaw: string;
  token1AssetIdSnapshot: string;
  token1AmountRaw: string;
  lpAssetIdSnapshot: string;
  lpAmountRaw: string;
  status: string;
  rawTransferEvidenceStatus: string | null;
};

type MockStakeAction = {
  id: string;
  chainId: number;
  protocolSlug: string;
  actionKind: "START" | "END";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  actionIndex: number;
  initiatorAddress: string;
  tokenAddress: string;
  principalLockedRaw: string | null;
  totalReturnedRaw: string | null;
  status: string;
  rawTransferEvidenceStatus: string | null;
};

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const key of Object.keys(where)) {
    if (key === "OR") {
      const clauses = where.OR as Array<Record<string, unknown>>;
      if (!clauses.some((clause) => matchesWhere(record, clause))) return false;
      continue;
    }
    const cond = where[key];
    const value = record[key];

    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      const condObj = cond as { gt?: unknown; gte?: unknown; lte?: unknown; in?: unknown[] };
      if (condObj.gt !== undefined) {
        if (!((value as never) > (condObj.gt as never))) return false;
        continue;
      }
      if (condObj.gte !== undefined || condObj.lte !== undefined) {
        if (condObj.gte !== undefined && !((value as never) >= (condObj.gte as never))) return false;
        if (condObj.lte !== undefined && !((value as never) <= (condObj.lte as never))) return false;
        continue;
      }
      if (condObj.in !== undefined) {
        if (!condObj.in.includes(value)) return false;
        continue;
      }
      return false;
    }

    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }

    if (value !== cond) return false;
  }
  return true;
}

function createRepairMockDb(seed: {
  transfers?: MockTransfer[];
  swaps?: MockSwap[];
  lpActions?: MockLpAction[];
  stakeActions?: MockStakeAction[];
  failEvidenceInsert?: boolean;
}) {
  const transfers = (seed.transfers ?? []).map((t) => ({ ...t }));
  const swaps = (seed.swaps ?? []).map((s) => ({ ...s }));
  const lpActions = (seed.lpActions ?? []).map((l) => ({ ...l }));
  const stakeActions = (seed.stakeActions ?? []).map((s) => ({ ...s }));
  const dexEvidence: Array<{ rawDexSwapId: string; rawTokenTransferId: string; legRole: string }> = [];
  const lpEvidence: Array<{ rawLpActionId: string; rawTokenTransferId: string; legRole: string }> = [];
  const stakeEvidence: Array<{ rawStakeActionId: string; rawTokenTransferId: string; legRole: string }> = [];

  const client = {
    rawTokenTransfer: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        transfers
          .filter((t) => matchesWhere(t, args.where))
          .sort((a, b) =>
            a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber),
          ),
    },
    rawDexSwap: {
      findMany: async (args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
        let rows = swaps.filter((s) => matchesWhere(s, args.where));
        if (args.orderBy) rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      },
      updateMany: async (args: { where: { id: { in: string[] } }; data: { rawTransferEvidenceStatus: string } }) => {
        let count = 0;
        for (const s of swaps) {
          if (args.where.id.in.includes(s.id)) {
            s.rawTransferEvidenceStatus = args.data.rawTransferEvidenceStatus;
            count += 1;
          }
        }
        return { count };
      },
    },
    rawLpAction: {
      findMany: async (args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
        let rows = lpActions.filter((l) => matchesWhere(l, args.where));
        if (args.orderBy) rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      },
      updateMany: async (args: { where: { id: { in: string[] } }; data: { rawTransferEvidenceStatus: string } }) => {
        let count = 0;
        for (const l of lpActions) {
          if (args.where.id.in.includes(l.id)) {
            l.rawTransferEvidenceStatus = args.data.rawTransferEvidenceStatus;
            count += 1;
          }
        }
        return { count };
      },
    },
    rawStakeAction: {
      findMany: async (args: { where: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
        let rows = stakeActions.filter((s) => matchesWhere(s, args.where));
        if (args.orderBy) rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      },
      updateMany: async (args: { where: { id: { in: string[] } }; data: { rawTransferEvidenceStatus: string } }) => {
        let count = 0;
        for (const s of stakeActions) {
          if (args.where.id.in.includes(s.id)) {
            s.rawTransferEvidenceStatus = args.data.rawTransferEvidenceStatus;
            count += 1;
          }
        }
        return { count };
      },
    },
    rawDexSwapTransferEvidence: {
      createMany: async (args: { data: typeof dexEvidence }) => {
        if (seed.failEvidenceInsert) throw new Error("forced evidence insert failure");
        let count = 0;
        for (const row of args.data) {
          const exists = dexEvidence.some(
            (e) => e.rawDexSwapId === row.rawDexSwapId && e.legRole === row.legRole && e.rawTokenTransferId === row.rawTokenTransferId,
          );
          if (!exists) {
            dexEvidence.push(row);
            count += 1;
          }
        }
        return { count };
      },
    },
    rawLpActionTransferEvidence: {
      createMany: async (args: { data: typeof lpEvidence }) => {
        if (seed.failEvidenceInsert) throw new Error("forced evidence insert failure");
        let count = 0;
        for (const row of args.data) {
          const exists = lpEvidence.some(
            (e) => e.rawLpActionId === row.rawLpActionId && e.legRole === row.legRole && e.rawTokenTransferId === row.rawTokenTransferId,
          );
          if (!exists) {
            lpEvidence.push(row);
            count += 1;
          }
        }
        return { count };
      },
    },
    rawStakeActionTransferEvidence: {
      createMany: async (args: { data: typeof stakeEvidence }) => {
        if (seed.failEvidenceInsert) throw new Error("forced evidence insert failure");
        let count = 0;
        for (const row of args.data) {
          const exists = stakeEvidence.some(
            (e) => e.rawStakeActionId === row.rawStakeActionId && e.legRole === row.legRole && e.rawTokenTransferId === row.rawTokenTransferId,
          );
          if (!exists) {
            stakeEvidence.push(row);
            count += 1;
          }
        }
        return { count };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const snapshot = {
        swaps: swaps.map((s) => ({ ...s })),
        lpActions: lpActions.map((l) => ({ ...l })),
        stakeActions: stakeActions.map((s) => ({ ...s })),
        dexEvidence: [...dexEvidence],
        lpEvidence: [...lpEvidence],
        stakeEvidence: [...stakeEvidence],
      };
      try {
        return await fn(client);
      } catch (error) {
        swaps.splice(0, swaps.length, ...snapshot.swaps);
        lpActions.splice(0, lpActions.length, ...snapshot.lpActions);
        stakeActions.splice(0, stakeActions.length, ...snapshot.stakeActions);
        dexEvidence.splice(0, dexEvidence.length, ...snapshot.dexEvidence);
        lpEvidence.splice(0, lpEvidence.length, ...snapshot.lpEvidence);
        stakeEvidence.splice(0, stakeEvidence.length, ...snapshot.stakeEvidence);
        throw error;
      }
    },
  };

  return { client, transfers, swaps, lpActions, stakeActions, dexEvidence, lpEvidence, stakeEvidence };
}

function transfer(overrides: Partial<MockTransfer> & { id: string }): MockTransfer {
  return {
    chainId: CHAIN_ID,
    txHash: "0xtx",
    blockNumber: 100n,
    blockHash: "0xblock",
    logIndex: 0,
    tokenAddress: TOKEN_A,
    assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`,
    decimalsSnapshot: 18,
    fromAddress: WALLET,
    toAddress: "0xrouter000000000000000000000000000000000",
    amountRaw: "1000",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("repairCanonicalRawTransferProvenance — SWAP", () => {
  function baseSwapTransfers() {
    return [
      transfer({
        id: "t_sold",
        txHash: "0xswap1",
        logIndex: 0,
        tokenAddress: TOKEN_A,
        assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`,
        fromAddress: WALLET,
        toAddress: "0xrouter000000000000000000000000000000000",
        amountRaw: "1000",
      }),
      transfer({
        id: "t_bought",
        txHash: "0xswap1",
        logIndex: 2,
        tokenAddress: TOKEN_B,
        assetIdSnapshot: `chain:369:erc20:${TOKEN_B}`,
        fromAddress: "0xrouter000000000000000000000000000000000",
        toAddress: WALLET,
        amountRaw: "2000",
      }),
    ];
  }

  function baseSwapAction(overrides: Partial<MockSwap> = {}): MockSwap {
    return {
      id: "swap_1",
      chainId: CHAIN_ID,
      txHash: "0xswap1",
      blockNumber: 100n,
      blockHash: "0xblock",
      logIndex: 1,
      initiatorAddress: WALLET,
      soldAssetIdSnapshot: `chain:369:erc20:${TOKEN_A}`,
      soldAmountRaw: "1000",
      boughtAssetIdSnapshot: `chain:369:erc20:${TOKEN_B}`,
      boughtAmountRaw: "2000",
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
      ...overrides,
    };
  }

  it("Test A: deterministically repairs a SWAP action and excludes unrelated same-tx transfers (Test E)", async () => {
    const unrelated = transfer({
      id: "t_unrelated",
      txHash: "0xswap1",
      logIndex: 1,
      fromAddress: "0xdead000000000000000000000000000000dead",
      toAddress: "0xbeef000000000000000000000000000000beef",
    });
    const store = createRepairMockDb({
      transfers: [...baseSwapTransfers(), unrelated],
      swaps: [baseSwapAction()],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(report.unresolvedCount).toBe(0);
    expect(report.evidenceRowsCreated).toBe(2);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBe("RECORDED");
    expect(store.dexEvidence).toEqual(
      expect.arrayContaining([
        { rawDexSwapId: "swap_1", rawTokenTransferId: "t_sold", legRole: "SOLD" },
        { rawDexSwapId: "swap_1", rawTokenTransferId: "t_bought", legRole: "BOUGHT" },
      ]),
    );
    // The unrelated transfer never appears in any evidence row.
    expect(store.dexEvidence.some((e) => e.rawTokenTransferId === "t_unrelated")).toBe(false);
  });

  it("Test F / negative test: same-asset-and-amount ambiguity leaves the action unresolved, never guesses", async () => {
    // Two distinct outbound assets makes the shape ambiguous under the
    // reused producer function — this must never be resolved by amount or
    // txHash alone.
    const ambiguousTransfers = [
      ...baseSwapTransfers(),
      transfer({
        id: "t_second_outbound",
        txHash: "0xswap1",
        logIndex: 3,
        tokenAddress: TOKEN_C,
        assetIdSnapshot: `chain:369:erc20:${TOKEN_C}`,
        fromAddress: WALLET,
        toAddress: "0xrouter000000000000000000000000000000000",
        amountRaw: "1000", // same amount as t_sold — must not be usable to pick one
      }),
    ];
    const store = createRepairMockDb({
      transfers: ambiguousTransfers,
      swaps: [baseSwapAction()],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(0);
    expect(report.unresolvedCount).toBe(1);
    expect(report.unresolved[0].reason).toMatch(/^unreconstructable-shape:ambiguous-sold-assets/);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBeNull();
    expect(store.dexEvidence).toEqual([]);
  });

  it("Test J: a REORGED backing transfer is never used as evidence — the action becomes unresolved", async () => {
    const transfers = baseSwapTransfers();
    transfers[0].status = "REORGED"; // sold-leg transfer no longer canonical
    const store = createRepairMockDb({
      transfers,
      swaps: [baseSwapAction()],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(0);
    expect(report.unresolved[0].reason).toMatch(/^unreconstructable-shape:/);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBeNull();
  });

  it("Test K: a REORGED parent action is never scanned or repaired", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction({ status: "REORGED" })],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(0);
    expect(store.dexEvidence).toEqual([]);
  });

  it("Test H: an existing RECORDED action is never rescanned or rewritten", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction({ rawTransferEvidenceStatus: "RECORDED" })],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(0);
    expect(store.dexEvidence).toEqual([]);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBe("RECORDED");
  });

  it("Test I: an existing VERIFIED_EMPTY action is never rescanned or rewritten", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction({ rawTransferEvidenceStatus: "VERIFIED_EMPTY" })],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(0);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBe("VERIFIED_EMPTY");
  });

  it("Test G: legacy null action is repaired only when the shape is safe; ambiguous ones stay null", async () => {
    const safe = baseSwapAction({ id: "swap_safe" });
    const unsafe = baseSwapAction({
      id: "swap_unsafe",
      txHash: "0xswap2",
      blockHash: "0xblock2",
    });
    const safeTransfers = baseSwapTransfers();
    const unsafeTransfers = [
      transfer({ id: "u1", txHash: "0xswap2", blockHash: "0xblock2", logIndex: 0, fromAddress: WALLET, toAddress: "0xrouter" }),
      // no inbound leg at all -> ambiguous-bought-assets:0
    ];
    const store = createRepairMockDb({
      transfers: [...safeTransfers, ...unsafeTransfers],
      swaps: [safe, unsafe],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(report.unresolvedCount).toBe(1);
    expect(store.swaps.find((s) => s.id === "swap_safe")?.rawTransferEvidenceStatus).toBe("RECORDED");
    expect(store.swaps.find((s) => s.id === "swap_unsafe")?.rawTransferEvidenceStatus).toBeNull();
  });

  it("Test L: dry-run computes the exact same plan but writes nothing", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction()],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP" }, // apply omitted -> dry-run
      store.client as never,
    );

    expect(report.apply).toBe(false);
    expect(report.deterministicallyRepairable).toBe(1);
    expect(report.evidenceRowsPlanned).toBe(2);
    expect(report.evidenceRowsCreated).toBe(0);
    expect(store.dexEvidence).toEqual([]);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBeNull();
  });

  it("Test M: apply is idempotent — a second run finds no remaining candidates", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction()],
    });

    const first = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );
    const second = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(first.deterministicallyRepairable).toBe(1);
    expect(second.candidatesScanned).toBe(0);
    expect(second.deterministicallyRepairable).toBe(0);
    expect(store.dexEvidence).toHaveLength(2);
  });

  it("Test N: a persistence failure leaves no partial evidence and no status change", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction()],
      failEvidenceInsert: true,
    });

    await expect(
      repairCanonicalRawTransferProvenance(
        { chainId: CHAIN_ID, family: "SWAP", apply: true },
        store.client as never,
      ),
    ).rejects.toThrow("forced evidence insert failure");

    expect(store.swaps[0].rawTransferEvidenceStatus).toBeNull();
    expect(store.dexEvidence).toEqual([]);
  });

  it("revalidation backstop: a transfer reorged between scan and write is never persisted as evidence", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction()],
    });

    // Simulate a concurrent reorg landing after the transaction-scoped scan
    // read (readTransactionTransfers, which filters by blockNumber range)
    // but before the final apply-mode revalidation read (which filters by
    // an explicit id list). The sold-leg transfer becomes REORGED in
    // between — the action must be moved to unresolved, not persisted.
    const realFindMany = store.client.rawTokenTransfer.findMany;
    store.client.rawTokenTransfer.findMany = (async (queryArgs: {
      where: Record<string, unknown>;
    }) => {
      const isRevalidationQuery =
        queryArgs.where.id !== undefined && queryArgs.where.blockNumber === undefined;
      if (isRevalidationQuery) {
        const soldTransfer = store.transfers.find((t) => t.id === "t_sold");
        if (soldTransfer) soldTransfer.status = "REORGED";
      }
      return realFindMany(queryArgs);
    }) as typeof realFindMany;

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(0);
    expect(report.unresolved).toEqual([
      expect.objectContaining({ actionId: "swap_1", reason: "revalidation-failed-possible-reorg" }),
    ]);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBeNull();
    expect(store.dexEvidence).toEqual([]);
  });

  it("dry-run never re-validates or queries revalidation state (matches scan-time report)", async () => {
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction()],
    });
    const findManySpy = store.client.rawTokenTransfer.findMany;
    let revalidationCallSeen = false;
    store.client.rawTokenTransfer.findMany = (async (queryArgs: {
      where: Record<string, unknown>;
    }) => {
      if (queryArgs.where.id !== undefined && queryArgs.where.blockNumber === undefined) {
        revalidationCallSeen = true;
      }
      return findManySpy(queryArgs);
    }) as typeof findManySpy;

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP" }, // dry-run
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(revalidationCallSeen).toBe(false);
  });

  it("Test O: bounded execution — maxActions caps the batch and returns a resume cursor", async () => {
    const swaps: MockSwap[] = [];
    const transfers: MockTransfer[] = [];
    for (let i = 0; i < 3; i += 1) {
      const txHash = `0xswapbatch${i}`;
      swaps.push(baseSwapAction({ id: `swap_batch_${i}`, txHash, blockHash: `0xblockbatch${i}` }));
      transfers.push(
        transfer({ id: `sold_${i}`, txHash, blockHash: `0xblockbatch${i}`, logIndex: 0, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter000000000000000000000000000000000", amountRaw: "1000" }),
        transfer({ id: `bought_${i}`, txHash, blockHash: `0xblockbatch${i}`, logIndex: 2, tokenAddress: TOKEN_B, assetIdSnapshot: `chain:369:erc20:${TOKEN_B}`, fromAddress: "0xrouter000000000000000000000000000000000", toAddress: WALLET, amountRaw: "2000" }),
      );
    }
    const store = createRepairMockDb({ transfers, swaps });

    const firstPage = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true, maxActions: 2 },
      store.client as never,
    );

    expect(firstPage.candidatesScanned).toBe(2);
    expect(firstPage.deterministicallyRepairable).toBe(2);
    expect(firstPage.nextCursorId).not.toBeNull();

    const secondPage = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", apply: true, maxActions: 2, cursorId: firstPage.nextCursorId },
      store.client as never,
    );

    expect(secondPage.candidatesScanned).toBe(1);
    expect(secondPage.nextCursorId).toBeNull();
    expect(store.swaps.every((s) => s.rawTransferEvidenceStatus === "RECORDED")).toBe(true);
  });

  it("rejects maxActions above the hard cap", async () => {
    const store = createRepairMockDb({});
    await expect(
      repairCanonicalRawTransferProvenance(
        { chainId: CHAIN_ID, family: "SWAP", maxActions: 501 },
        store.client as never,
      ),
    ).rejects.toThrow(/maxActions must be an integer between 1 and 500/);
  });

  it("respects a wallet scope, ignoring actions initiated by other wallets", async () => {
    const otherWalletSwap = baseSwapAction({
      id: "swap_other",
      initiatorAddress: OTHER_WALLET,
      txHash: "0xswapother",
      blockHash: "0xblockother",
    });
    const store = createRepairMockDb({
      transfers: baseSwapTransfers(),
      swaps: [baseSwapAction(), otherWalletSwap],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "SWAP", walletAddress: WALLET, apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(1);
    expect(store.swaps.find((s) => s.id === "swap_other")?.rawTransferEvidenceStatus).toBeNull();
  });

  it("allows a non-PulseChain chainId for SWAP — current architecture does not restrict this family to 369", async () => {
    const nonPulsechainId = 1; // e.g. Ethereum mainnet chainId, purely as a probe value
    const store = createRepairMockDb({
      transfers: baseSwapTransfers().map((t) => ({ ...t, chainId: nonPulsechainId })),
      swaps: [baseSwapAction({ chainId: nonPulsechainId })],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: nonPulsechainId, family: "SWAP", apply: true },
      store.client as never,
    );

    // Whatever the deterministic outcome is for a non-369 chain today, it
    // must not be an up-front rejection — SWAP has no chain restriction.
    expect(report.candidatesScanned).toBe(1);
    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.swaps[0].rawTransferEvidenceStatus).toBe("RECORDED");
  });

  it("allows a non-PulseChain chainId for LP — current architecture does not restrict this family to 369", async () => {
    const nonPulsechainId = 1;
    const transfers = [
      transfer({ id: "t0", chainId: nonPulsechainId, txHash: "0xlpnonchain", logIndex: 0, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:${nonPulsechainId}:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "1000" }),
      transfer({ id: "t1", chainId: nonPulsechainId, txHash: "0xlpnonchain", logIndex: 1, tokenAddress: TOKEN_B, assetIdSnapshot: `chain:${nonPulsechainId}:erc20:${TOKEN_B}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "500" }),
      transfer({ id: "lp_in", chainId: nonPulsechainId, txHash: "0xlpnonchain", logIndex: 2, tokenAddress: LP_TOKEN, assetIdSnapshot: `chain:${nonPulsechainId}:erc20:${LP_TOKEN}`, fromAddress: "0xrouter", toAddress: WALLET, amountRaw: "300" }),
    ];
    const lpAction: MockLpAction = {
      id: "lp_nonchain",
      chainId: nonPulsechainId,
      actionKind: "ADD",
      txHash: "0xlpnonchain",
      blockNumber: 100n,
      blockHash: "0xblock",
      logIndex: 2,
      initiatorAddress: WALLET,
      token0AssetIdSnapshot: `chain:${nonPulsechainId}:erc20:${TOKEN_A}`,
      token0AmountRaw: "1000",
      token1AssetIdSnapshot: `chain:${nonPulsechainId}:erc20:${TOKEN_B}`,
      token1AmountRaw: "500",
      lpAssetIdSnapshot: `chain:${nonPulsechainId}:erc20:${LP_TOKEN}`,
      lpAmountRaw: "300",
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
    };
    const store = createRepairMockDb({ transfers, lpActions: [lpAction] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: nonPulsechainId, family: "LP", apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(1);
    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.lpActions[0].rawTransferEvidenceStatus).toBe("RECORDED");
  });
});

describe("repairCanonicalRawTransferProvenance — chain scoping", () => {
  it("allows STAKE repair for PulseChain (chainId 369)", async () => {
    const stakeAction = {
      id: "stake_chain369",
      chainId: 369,
      protocolSlug: "hex",
      actionKind: "START" as const,
      txHash: "0xstakechain369",
      blockNumber: 100n,
      blockHash: "0xblock",
      actionIndex: 0,
      initiatorAddress: WALLET,
      tokenAddress: PHEX,
      principalLockedRaw: "500000000",
      totalReturnedRaw: null,
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
    };
    const transfers = [
      transfer({ id: "principal_out_369", txHash: "0xstakechain369", logIndex: 0, tokenAddress: PHEX, assetIdSnapshot: `chain:369:erc20:${PHEX}`, fromAddress: WALLET, toAddress: PHEX, amountRaw: "500000000" }),
    ];
    const store = createRepairMockDb({ transfers, stakeActions: [stakeAction] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: 369, family: "STAKE", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.stakeActions[0].rawTransferEvidenceStatus).toBe("RECORDED");
  });

  it("rejects STAKE repair for any non-PulseChain chainId before scanning or mutating anything", async () => {
    const store = createRepairMockDb({
      transfers: [
        transfer({ id: "principal_out_1", chainId: 1, txHash: "0xstakechain1", logIndex: 0, tokenAddress: PHEX, assetIdSnapshot: `chain:1:erc20:${PHEX}`, fromAddress: WALLET, toAddress: PHEX, amountRaw: "500000000" }),
      ],
      stakeActions: [
        {
          id: "stake_chain1",
          chainId: 1,
          protocolSlug: "hex",
          actionKind: "START" as const,
          txHash: "0xstakechain1",
          blockNumber: 100n,
          blockHash: "0xblock",
          actionIndex: 0,
          initiatorAddress: WALLET,
          tokenAddress: PHEX,
          principalLockedRaw: "500000000",
          totalReturnedRaw: null,
          status: "ACTIVE",
          rawTransferEvidenceStatus: null,
        },
      ],
    });

    // Spy on the candidate scan to prove rejection happens before any scan.
    const findManySpy = store.client.rawStakeAction.findMany;
    let scanWasAttempted = false;
    store.client.rawStakeAction.findMany = (async (queryArgs: unknown) => {
      scanWasAttempted = true;
      return findManySpy(queryArgs as never);
    }) as typeof findManySpy;

    await expect(
      repairCanonicalRawTransferProvenance(
        { chainId: 1, family: "STAKE", apply: true },
        store.client as never,
      ),
    ).rejects.toThrow(/STAKE repair is PulseChain-only \(chainId 369\); got chainId 1/);

    expect(scanWasAttempted).toBe(false);
    expect(store.stakeActions[0].rawTransferEvidenceStatus).toBeNull();
    expect(store.stakeEvidence).toEqual([]);
  });

  it("rejects STAKE repair for a non-PulseChain chainId even in dry-run mode", async () => {
    const store = createRepairMockDb({});

    await expect(
      repairCanonicalRawTransferProvenance(
        { chainId: 1, family: "STAKE" }, // dry-run, no apply
        store.client as never,
      ),
    ).rejects.toThrow(/STAKE repair is PulseChain-only/);
  });
});

describe("repairCanonicalRawTransferProvenance — LP", () => {
  it("Test B / D: deterministically repairs an LP ADD with many-to-one token0 evidence", async () => {
    const transfers = [
      transfer({ id: "t0_a", txHash: "0xlp1", logIndex: 0, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "600" }),
      transfer({ id: "t0_b", txHash: "0xlp1", logIndex: 1, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "400" }),
      transfer({ id: "t1_a", txHash: "0xlp1", logIndex: 2, tokenAddress: TOKEN_B, assetIdSnapshot: `chain:369:erc20:${TOKEN_B}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "500" }),
      transfer({ id: "lp_in", txHash: "0xlp1", logIndex: 3, tokenAddress: LP_TOKEN, assetIdSnapshot: `chain:369:erc20:${LP_TOKEN}`, fromAddress: "0xrouter", toAddress: WALLET, amountRaw: "300" }),
    ];
    const lpAction: MockLpAction = {
      id: "lp_1",
      chainId: CHAIN_ID,
      actionKind: "ADD",
      txHash: "0xlp1",
      blockNumber: 100n,
      blockHash: "0xblock",
      logIndex: 3,
      initiatorAddress: WALLET,
      token0AssetIdSnapshot: `chain:369:erc20:${TOKEN_A}`,
      token0AmountRaw: "1000",
      token1AssetIdSnapshot: `chain:369:erc20:${TOKEN_B}`,
      token1AmountRaw: "500",
      lpAssetIdSnapshot: `chain:369:erc20:${LP_TOKEN}`,
      lpAmountRaw: "300",
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
    };
    const store = createRepairMockDb({ transfers, lpActions: [lpAction] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "LP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(report.evidenceRowsCreated).toBe(4);
    expect(store.lpActions[0].rawTransferEvidenceStatus).toBe("RECORDED");
    const token0Ids = store.lpEvidence
      .filter((e) => e.legRole === "TOKEN0_OUT")
      .map((e) => e.rawTokenTransferId)
      .sort();
    expect(token0Ids).toEqual(["t0_a", "t0_b"]);
  });

  it("leaves an LP action unresolved when the recomputed shape drifts from the persisted snapshot", async () => {
    const transfers = [
      transfer({ id: "t0", txHash: "0xlp2", logIndex: 0, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "1000" }),
      transfer({ id: "t1", txHash: "0xlp2", logIndex: 1, tokenAddress: TOKEN_B, assetIdSnapshot: `chain:369:erc20:${TOKEN_B}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "500" }),
      transfer({ id: "lp_in2", txHash: "0xlp2", logIndex: 2, tokenAddress: LP_TOKEN, assetIdSnapshot: `chain:369:erc20:${LP_TOKEN}`, fromAddress: "0xrouter", toAddress: WALLET, amountRaw: "300" }),
    ];
    const lpAction: MockLpAction = {
      id: "lp_2",
      chainId: CHAIN_ID,
      actionKind: "ADD",
      txHash: "0xlp2",
      blockNumber: 100n,
      blockHash: "0xblock",
      logIndex: 2,
      initiatorAddress: WALLET,
      token0AssetIdSnapshot: `chain:369:erc20:${TOKEN_A}`,
      token0AmountRaw: "999999", // drifted from what the transfers actually sum to
      token1AssetIdSnapshot: `chain:369:erc20:${TOKEN_B}`,
      token1AmountRaw: "500",
      lpAssetIdSnapshot: `chain:369:erc20:${LP_TOKEN}`,
      lpAmountRaw: "300",
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
    };
    const store = createRepairMockDb({ transfers, lpActions: [lpAction] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "LP", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(0);
    expect(report.unresolved[0].reason).toBe("producer-recompute-mismatch");
    expect(store.lpActions[0].rawTransferEvidenceStatus).toBeNull();
  });
});

describe("repairCanonicalRawTransferProvenance — STAKE", () => {
  function baseStakeAction(overrides: Partial<MockStakeAction> = {}): MockStakeAction {
    return {
      id: "stake_1",
      chainId: CHAIN_ID,
      protocolSlug: "hex",
      actionKind: "START",
      txHash: "0xstake1",
      blockNumber: 100n,
      blockHash: "0xblock",
      actionIndex: 0,
      initiatorAddress: WALLET,
      tokenAddress: PHEX,
      principalLockedRaw: "500000000",
      totalReturnedRaw: null,
      status: "ACTIVE",
      rawTransferEvidenceStatus: null,
      ...overrides,
    };
  }

  it("Test C: deterministically repairs a supported native pHEX STAKE START", async () => {
    const transfers = [
      transfer({ id: "principal_out", txHash: "0xstake1", logIndex: 0, tokenAddress: PHEX, assetIdSnapshot: `chain:369:erc20:${PHEX}`, fromAddress: WALLET, toAddress: PHEX, amountRaw: "500000000" }),
    ];
    const store = createRepairMockDb({ transfers, stakeActions: [baseStakeAction()] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "STAKE", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.stakeActions[0].rawTransferEvidenceStatus).toBe("RECORDED");
    expect(store.stakeEvidence).toEqual([
      { rawStakeActionId: "stake_1", rawTokenTransferId: "principal_out", legRole: "PRINCIPAL_LOCKED_OUT" },
    ]);
  });

  it("deterministically repairs a supported native pHEX STAKE END", async () => {
    const endAction = baseStakeAction({
      id: "stake_end_1",
      actionKind: "END",
      txHash: "0xstakeend1",
      principalLockedRaw: null,
      totalReturnedRaw: "600000000",
    });
    const transfers = [
      transfer({ id: "return_in", txHash: "0xstakeend1", logIndex: 0, tokenAddress: PHEX, assetIdSnapshot: `chain:369:erc20:${PHEX}`, fromAddress: PHEX, toAddress: WALLET, amountRaw: "600000000" }),
    ];
    const store = createRepairMockDb({ transfers, stakeActions: [endAction] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "STAKE", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.stakeActions[0].rawTransferEvidenceStatus).toBe("RECORDED");
    expect(store.stakeEvidence).toEqual([
      { rawStakeActionId: "stake_end_1", rawTokenTransferId: "return_in", legRole: "RETURN_IN" },
    ]);
  });

  it("ignores non-pHEX transfers in the same transaction when reconstructing the STAKE shape", async () => {
    const transfers = [
      transfer({ id: "principal_out", txHash: "0xstake2", logIndex: 0, tokenAddress: PHEX, assetIdSnapshot: `chain:369:erc20:${PHEX}`, fromAddress: WALLET, toAddress: PHEX, amountRaw: "500000000" }),
      // an unrelated token transfer in the same tx must never pollute the
      // phex-only stake shape check.
      transfer({ id: "unrelated_token", txHash: "0xstake2", logIndex: 1, tokenAddress: TOKEN_A, assetIdSnapshot: `chain:369:erc20:${TOKEN_A}`, fromAddress: WALLET, toAddress: "0xrouter", amountRaw: "1" }),
    ];
    const store = createRepairMockDb({
      transfers,
      stakeActions: [baseStakeAction({ txHash: "0xstake2" })],
    });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "STAKE", apply: true },
      store.client as never,
    );

    expect(report.deterministicallyRepairable).toBe(1);
    expect(store.stakeEvidence).toEqual([
      { rawStakeActionId: "stake_1", rawTokenTransferId: "principal_out", legRole: "PRINCIPAL_LOCKED_OUT" },
    ]);
  });

  it("never scans unsupported actionKind/actionIndex rows (out of current producer scope)", async () => {
    const unsupported = baseStakeAction({
      id: "stake_unsupported",
      actionKind: "START",
      actionIndex: 1, // the live producer never writes actionIndex !== 0
    });
    const store = createRepairMockDb({ stakeActions: [unsupported] });

    const report = await repairCanonicalRawTransferProvenance(
      { chainId: CHAIN_ID, family: "STAKE", apply: true },
      store.client as never,
    );

    expect(report.candidatesScanned).toBe(0);
    expect(store.stakeActions[0].rawTransferEvidenceStatus).toBeNull();
  });
});

describe("repair-canonical-provenance CLI parsing", () => {
  it("defaults to dry-run and requires chain-id and family", () => {
    expect(parseProvenanceRepairCliArgs([])).toEqual({
      ok: false,
      error: "--chain-id is required.",
    });
    expect(parseProvenanceRepairCliArgs(["--chain-id", "369"])).toEqual({
      ok: false,
      error: "--family is required.",
    });
  });

  it("accepts a full valid invocation with dry-run as the default", () => {
    const result = parseProvenanceRepairCliArgs(["--chain-id", "369", "--family", "swap"]);
    expect(result).toEqual({
      ok: true,
      options: { apply: false, chainId: 369, family: "SWAP" },
    });
  });

  it("accepts apply, wallet, max-actions, and cursor together", () => {
    const result = parseProvenanceRepairCliArgs([
      "--chain-id",
      "369",
      "--family",
      "LP",
      "--wallet",
      `${WALLET.toUpperCase().replace("0X", "0x")}`,
      "--max-actions",
      "50",
      "--cursor",
      "abc123",
      "--apply",
    ]);
    expect(result).toEqual({
      ok: true,
      options: {
        apply: true,
        chainId: 369,
        family: "LP",
        walletAddress: WALLET,
        maxActions: 50,
        cursorId: "abc123",
      },
    });
  });

  it("rejects an out-of-range max-actions and an invalid family", () => {
    expect(parseProvenanceRepairCliArgs(["--chain-id", "369", "--family", "SWAP", "--max-actions", "501"]).ok).toBe(false);
    expect(parseProvenanceRepairCliArgs(["--chain-id", "369", "--family", "CURVE"]).ok).toBe(false);
    expect(parseProvenanceRepairCliArgs(["--chain-id", "369", "--family", "SWAP", "--wallet", "0xnotanaddress"]).ok).toBe(false);
  });

  it("requires DATABASE_URL and REDIS_URL without printing their values", () => {
    expect(checkEnv({})).toEqual({ ok: false, missing: ["DATABASE_URL", "REDIS_URL"] });
    expect(checkEnv({ DATABASE_URL: "postgres://x", REDIS_URL: "redis://y" })).toEqual({ ok: true });
  });
});
