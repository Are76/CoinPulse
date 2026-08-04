import { describe, expect, it, vi } from "vitest";

import { DEFAULT_OPERATION_STALE_THRESHOLDS } from "@/services/operations/operation-lock";
import {
  deriveWalletOnboardingStatus,
  getWalletOnboardingStatus,
  type LatestSyncRunInput,
  type MaterializationStateInput,
  type WalletOnboardingStatusDbClient,
} from "@/services/operations/wallet-onboarding-status";

const NOW = new Date("2026-08-04T12:00:00.000Z");

const BASE_SYNC_RUN: NonNullable<LatestSyncRunInput> = {
  id: "run-1",
  status: "COMPLETED",
  trigger: "MANUAL",
  stage: "UPDATING_CURSOR",
  warningCount: 0,
  errorMessage: null,
  chainId: 369,
  walletId: "wallet-1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:05:00.000Z"),
};

// Warning-free, validly recorded materialization completed shortly after
// BASE_SYNC_RUN. NOTE: a non-null updatedFromBlock/updatedToBlock pair only
// means the most recent materialization pass's own recorded block window is
// known — it is not, by itself, proof of complete wallet history. See the
// "production-reachable" and "does not prove full history" tests below.
const CLEAN_MATERIALIZATION: NonNullable<MaterializationStateInput> = {
  status: "COMPLETED",
  completedSuccessfully: true,
  warningCount: 0,
  latestMaterializedAt: new Date("2026-08-01T00:06:00.000Z"),
  errorMessage: null,
  updatedFromBlock: 100n,
  updatedToBlock: 200n,
};

describe("deriveWalletOnboardingStatus", () => {
  it("returns TRACKED_NOT_SYNCED when no SyncRun has ever been created", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("TRACKED_NOT_SYNCED");
    expect(result.actionRequired).toBe(true);
    expect(result.holdingsMayBeVisible).toBe(false);
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.latestSyncRun).toBeNull();
    expect(result.materialization).toEqual({
      status: null,
      completedSuccessfully: null,
      warningCount: 0,
      latestMaterializedAt: null,
    });
  });

  it("returns SYNC_IN_PROGRESS when the latest SyncRun is PENDING and fresh (actionRequired=false)", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "PENDING", stage: "PENDING", createdAt: NOW, updatedAt: NOW },
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
    expect(result.actionRequired).toBe(false);
    expect(result.holdingsMayBeVisible).toBe(false);
    expect(result.latestSyncRun?.appearsStale).toBe(false);
  });

  it("returns SYNC_IN_PROGRESS when the latest SyncRun is RUNNING and fresh", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "RUNNING", stage: "INGESTING_RAW_LOGS", createdAt: NOW, updatedAt: NOW },
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
    expect(result.actionRequired).toBe(false);
  });

  // ── Finding 3: stale PENDING/RUNNING detection ────────────────────────────

  it("marks a stale PENDING run as actionable, reusing DEFAULT_OPERATION_STALE_THRESHOLDS.pendingMs", () => {
    const staleCreatedAt = new Date(NOW.getTime() - (DEFAULT_OPERATION_STALE_THRESHOLDS.pendingMs + 1000));
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "PENDING", stage: "PENDING", createdAt: staleCreatedAt, updatedAt: staleCreatedAt },
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
    expect(result.actionRequired).toBe(true);
    expect(result.latestSyncRun?.appearsStale).toBe(true);
    expect(result.reason).toContain("stuck");
  });

  it("does not flag a PENDING run just under the pending threshold as stale", () => {
    const freshCreatedAt = new Date(NOW.getTime() - (DEFAULT_OPERATION_STALE_THRESHOLDS.pendingMs - 1000));
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "PENDING", stage: "PENDING", createdAt: freshCreatedAt, updatedAt: freshCreatedAt },
      materializationState: null,
      now: NOW,
    });

    expect(result.actionRequired).toBe(false);
    expect(result.latestSyncRun?.appearsStale).toBe(false);
  });

  it("marks a stale RUNNING run as actionable, reusing DEFAULT_OPERATION_STALE_THRESHOLDS.runningMs", () => {
    const staleCreatedAt = new Date(NOW.getTime() - (DEFAULT_OPERATION_STALE_THRESHOLDS.runningMs + 1000));
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "RUNNING", stage: "INGESTING_RAW_LOGS", createdAt: staleCreatedAt, updatedAt: staleCreatedAt },
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
    expect(result.actionRequired).toBe(true);
    expect(result.latestSyncRun?.appearsStale).toBe(true);
  });

  it("does not flag a RUNNING run just under the running threshold as stale", () => {
    const freshCreatedAt = new Date(NOW.getTime() - (DEFAULT_OPERATION_STALE_THRESHOLDS.runningMs - 1000));
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "RUNNING", stage: "INGESTING_RAW_LOGS", createdAt: freshCreatedAt, updatedAt: freshCreatedAt },
      materializationState: null,
      now: NOW,
    });

    expect(result.actionRequired).toBe(false);
  });

  it("returns SYNC_FAILED when the latest SyncRun failed, including its error message", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "FAILED", errorMessage: "[INGESTING_RAW_LOGS] TRANSFERS 1-2: RpcError/timeout: redacted" },
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_FAILED");
    expect(result.actionRequired).toBe(true);
    expect(result.reason).toContain("RpcError/timeout");
  });

  it("returns SYNC_FAILED with a generic reason when errorMessage is null", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "FAILED", errorMessage: null },
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_FAILED");
    expect(result.reason).toBe("The most recent sync failed.");
  });

  it("returns CANONICAL_STATE_PARTIAL when sync completed but materialization never ran", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: null,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.holdingsMayBeVisible).toBe(false);
    expect(result.actionRequired).toBe(false);
  });

  it("returns CANONICAL_STATE_PARTIAL when materialization is currently RUNNING", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, status: "RUNNING", completedSuccessfully: false },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  // ── Finding 5: failed materialization must be actionable ──────────────────

  it("returns CANONICAL_STATE_PARTIAL with actionRequired=true when materialization FAILED, surfacing the error", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        status: "FAILED",
        completedSuccessfully: false,
        errorMessage: "negative balance invariant violated",
      },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.actionRequired).toBe(true);
    expect(result.reason).toContain("negative balance invariant violated");
  });

  // ── Finding 6 / 7: range validation and production-reachability ──────────

  it("returns CANONICAL_STATE_PARTIAL when the updated-block range is unknown (neither bound present)", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, updatedFromBlock: null, updatedToBlock: null },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(false);
  });

  it("returns CANONICAL_STATE_PARTIAL when only one updated-block bound is recorded", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, updatedFromBlock: 100n, updatedToBlock: null },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("returns CANONICAL_STATE_PARTIAL when the updated-block range is inverted (fromBlock > toBlock)", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, updatedFromBlock: 1000n, updatedToBlock: 500n },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("invalid");
  });

  it("reaches CANONICAL_STATE_MATERIALIZED using only updatedFromBlock/updatedToBlock — the fields the real rebuild flow actually persists", () => {
    // run-rebuild-operation.ts only ever supplies { updatedFromBlock,
    // updatedToBlock } as provenance (never sourceLedgerCoverageExact), so
    // this fixture matches production shape exactly — proving the predicate
    // is actually reachable by the real materialization writer.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.status).not.toBe("CANONICAL_STATE_READY" as never);
    expect(result.reason.toLowerCase()).not.toContain("ready");
    expect(result.reason).toContain("does not by itself prove the wallet's complete history");
    expect(result.actionRequired).toBe(false);
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(true);
    expect(result.pricingMayBeUnavailable).toBe(false);
  });

  it("classifies a bounded 1,000-block materialization with both bounds present as MATERIALIZED, never a claim of full readiness", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, updatedFromBlock: 1_000_000n, updatedToBlock: 1_001_000n },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.reason).not.toMatch(/\bready\b/i);
  });

  // ── Finding 1: stale materialization relative to a newer completed sync ──

  it("returns CANONICAL_STATE_PARTIAL when materialization predates the latest completed sync", () => {
    // MANUAL syncs never trigger materialization (only rebuild does — see
    // sync-orchestrator.ts), so ledger data can move on without a
    // corresponding re-materialization.
    const newerSync = { ...BASE_SYNC_RUN, updatedAt: new Date("2026-08-02T00:00:00.000Z") };
    const staleMaterialization = {
      ...CLEAN_MATERIALIZATION,
      latestMaterializedAt: new Date("2026-08-01T00:06:00.000Z"), // before newerSync.updatedAt
    };

    const result = deriveWalletOnboardingStatus({
      latestSyncRun: newerSync,
      materializationState: staleMaterialization,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.reason).toContain("after the last successful materialization");
  });

  it("returns CANONICAL_STATE_PARTIAL when materialization has no latestMaterializedAt but the sync completed", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, latestMaterializedAt: null },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("reaches CANONICAL_STATE_MATERIALIZED when materialization happened at or after the latest sync completed", () => {
    const sync = { ...BASE_SYNC_RUN, updatedAt: new Date("2026-08-01T00:05:00.000Z") };
    const materialization = { ...CLEAN_MATERIALIZATION, latestMaterializedAt: new Date("2026-08-01T00:05:00.000Z") };

    const result = deriveWalletOnboardingStatus({
      latestSyncRun: sync,
      materializationState: materialization,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
  });

  // ── Finding 4: SyncRun warnings fold into the precedence, fail closed ─────

  it("returns CANONICAL_STATE_WARNING (fail closed) for a warning-free materialization when the completed SyncRun itself carries warnings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, warningCount: 2 },
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.actionRequired).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.pricingMayBeUnavailable).toBe(true);
    expect(result.latestSyncRun?.warningCount).toBe(2);
  });

  it("returns CANONICAL_STATE_WARNING and fails closed (no PnL, pricing not guaranteed) for a materialization with active warnings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, warningCount: 3 },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.actionRequired).toBe(true);
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.pricingMayBeUnavailable).toBe(true);
    expect(result.reason).toContain("are not trustworthy");
  });

  it("fails closed for a negative-balance-style warning-bearing materialization", () => {
    // Negative-token-balance integrity warnings are folded into warningCount
    // at materialization time (see materialize-positions.ts), so this is the
    // same branch as any other warning — never treated as PnL/pricing-safe.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, warningCount: 1 },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.pricingMayBeUnavailable).toBe(true);
    expect(result.actionRequired).toBe(true);
  });

  it("does not fabricate SyncRun warning details — only exposes the persisted count", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, warningCount: 4 },
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.latestSyncRun?.warningCount).toBe(4);
    expect(result).not.toHaveProperty("warningDetails");
  });

  it("prioritizes an active sync over an older FAILED run and a clean materialization", () => {
    // Precedence check: the most recent SyncRun always wins regardless of
    // what earlier runs or the persisted materialization state say.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, id: "run-2", status: "RUNNING", createdAt: NOW, updatedAt: NOW },
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
  });

  it("never coerces materialization fields to zero-equivalent values when absent", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: null,
      now: NOW,
    });

    expect(result.materialization.status).toBeNull();
    expect(result.materialization.completedSuccessfully).toBeNull();
    expect(result.materialization.latestMaterializedAt).toBeNull();
  });

  it("serializes latestSyncRun and materialization timestamps as ISO strings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.latestSyncRun).toEqual({
      id: "run-1",
      status: "COMPLETED",
      trigger: "MANUAL",
      stage: "UPDATING_CURSOR",
      warningCount: 0,
      appearsStale: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:05:00.000Z",
    });
    expect(result.materialization.latestMaterializedAt).toBe("2026-08-01T00:06:00.000Z");
  });

  // ── Finding 3 (contradictory persisted state): no SyncRun, materialization exists ──

  it("does not claim TRACKED_NOT_SYNCED when materialization exists despite no SyncRun row", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).not.toBe("TRACKED_NOT_SYNCED");
  });

  it("derives CANONICAL_STATE_MATERIALIZED from a warning-free materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: CLEAN_MATERIALIZATION,
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.latestSyncRun).toBeNull();
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
  });

  it("derives CANONICAL_STATE_WARNING (failing closed) from a warning-bearing materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: { ...CLEAN_MATERIALIZATION, warningCount: 2 },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
  });

  it("derives CANONICAL_STATE_PARTIAL from a FAILED materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        status: "FAILED",
        completedSuccessfully: false,
        errorMessage: "boom",
      },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.actionRequired).toBe(true);
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
    expect(result.reason).toContain("boom");
  });

  it("derives CANONICAL_STATE_PARTIAL from a RUNNING materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: { ...CLEAN_MATERIALIZATION, status: "RUNNING", completedSuccessfully: false },
      now: NOW,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
  });
});

describe("getWalletOnboardingStatus", () => {
  it("queries the latest SyncRun (by createdAt desc) and the materialization state scoped to walletId + chainId, selecting updatedFromBlock/updatedToBlock and warningCount", async () => {
    const findFirst = vi.fn().mockResolvedValue(BASE_SYNC_RUN);
    const findUnique = vi.fn().mockResolvedValue(CLEAN_MATERIALIZATION);
    const db = {
      syncRun: { findFirst },
      portfolioMaterializationState: { findUnique },
    } as unknown as WalletOnboardingStatusDbClient;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-1", chainId: 369, db, now: NOW });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId: "wallet-1", chainId: 369 },
        orderBy: [{ createdAt: "desc" }],
        select: expect.objectContaining({ warningCount: true, chainId: true, walletId: true }),
      }),
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId_chainId: { walletId: "wallet-1", chainId: 369 } },
        select: expect.objectContaining({ updatedFromBlock: true, updatedToBlock: true }),
      }),
    );
  });

  it("derives TRACKED_NOT_SYNCED when both queries return nothing", async () => {
    const db = {
      syncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      portfolioMaterializationState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as WalletOnboardingStatusDbClient;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-2", chainId: 369, db, now: NOW });

    expect(result.status).toBe("TRACKED_NOT_SYNCED");
  });

  it("defaults `now` to the current time when omitted", async () => {
    const db = {
      syncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      portfolioMaterializationState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as WalletOnboardingStatusDbClient;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-3", chainId: 369, db });

    expect(result.status).toBe("TRACKED_NOT_SYNCED");
  });
});
