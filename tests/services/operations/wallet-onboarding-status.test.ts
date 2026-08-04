import { describe, expect, it, vi } from "vitest";

import {
  deriveWalletOnboardingStatus,
  getWalletOnboardingStatus,
  type LatestSyncRunInput,
  type MaterializationStateInput,
} from "@/services/operations/wallet-onboarding-status";

const BASE_SYNC_RUN: NonNullable<LatestSyncRunInput> = {
  id: "run-1",
  status: "COMPLETED",
  trigger: "MANUAL",
  stage: "UPDATING_CURSOR",
  errorMessage: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:05:00.000Z"),
};

// Warning-free, fully covered materialization. NOTE: "covered" here only
// means the most recent materialization run's own recorded block window is
// fully known — it is not, by itself, proof of complete wallet history. See
// Finding 2 tests below.
const CLEAN_MATERIALIZATION: NonNullable<MaterializationStateInput> = {
  status: "COMPLETED",
  completedSuccessfully: true,
  warningCount: 0,
  latestMaterializedAt: new Date("2026-08-01T00:05:00.000Z"),
  errorMessage: null,
  sourceLedgerFromBlock: 100n,
  sourceLedgerToBlock: 200n,
};

describe("deriveWalletOnboardingStatus", () => {
  it("returns TRACKED_NOT_SYNCED when no SyncRun has ever been created", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: null,
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

  it("returns SYNC_IN_PROGRESS when the latest SyncRun is PENDING", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "PENDING", stage: "PENDING" },
      materializationState: null,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
    expect(result.actionRequired).toBe(false);
    expect(result.holdingsMayBeVisible).toBe(false);
  });

  it("returns SYNC_IN_PROGRESS when the latest SyncRun is RUNNING", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "RUNNING", stage: "INGESTING_RAW_LOGS" },
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
  });

  it("returns SYNC_FAILED when the latest SyncRun failed, including its error message", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "FAILED", errorMessage: "[INGESTING_RAW_LOGS] TRANSFERS 1-2: RpcError/timeout: redacted" },
      materializationState: null,
    });

    expect(result.status).toBe("SYNC_FAILED");
    expect(result.actionRequired).toBe(true);
    expect(result.reason).toContain("RpcError/timeout");
  });

  it("returns SYNC_FAILED with a generic reason when errorMessage is null", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, status: "FAILED", errorMessage: null },
      materializationState: null,
    });

    expect(result.status).toBe("SYNC_FAILED");
    expect(result.reason).toBe("The most recent sync failed.");
  });

  it("returns CANONICAL_STATE_PARTIAL when sync completed but materialization never ran", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: null,
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.holdingsMayBeVisible).toBe(false);
    expect(result.actionRequired).toBe(false);
  });

  it("returns CANONICAL_STATE_PARTIAL when materialization is currently RUNNING", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, status: "RUNNING", completedSuccessfully: false },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("returns CANONICAL_STATE_PARTIAL when materialization FAILED, surfacing the error", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        status: "FAILED",
        completedSuccessfully: false,
        errorMessage: "negative balance invariant violated",
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("negative balance invariant violated");
  });

  // ── Finding 2: block bounds do not prove complete history ────────────────

  it("returns CANONICAL_STATE_PARTIAL when ledger block-range coverage is unknown (neither bound present)", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        sourceLedgerFromBlock: null,
        sourceLedgerToBlock: null,
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(false);
  });

  it("returns CANONICAL_STATE_PARTIAL when only one ledger block bound is recorded", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        sourceLedgerFromBlock: 100n,
        sourceLedgerToBlock: null,
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("classifies a bounded 1,000-block materialization with both bounds present as MATERIALIZED, never a claim of full readiness", () => {
    // Mirrors REBUILD_MAX_BLOCK_SPAN (src/services/api/validation.ts): a
    // single materialization pass is capped at 1,000 blocks and can never by
    // itself prove complete wallet history.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...CLEAN_MATERIALIZATION,
        sourceLedgerFromBlock: 1_000_000n,
        sourceLedgerToBlock: 1_001_000n,
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.status).not.toBe("CANONICAL_STATE_READY" as never);
    expect(result.reason.toLowerCase()).not.toContain("ready");
    expect(result.reason).toContain("does not by itself prove the wallet's complete history");
  });

  it("returns CANONICAL_STATE_MATERIALIZED (not a 'ready'/complete claim) for a fully covered, warning-free materialization", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.actionRequired).toBe(false);
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(true);
    expect(result.pricingMayBeUnavailable).toBe(false);
  });

  // ── Finding 1: warning-bearing materialization fails closed ──────────────

  it("returns CANONICAL_STATE_WARNING and fails closed (no PnL, pricing not guaranteed) for a covered materialization with active warnings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...CLEAN_MATERIALIZATION, warningCount: 3 },
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
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.pnlMayBeAvailable).toBe(false);
    expect(result.pricingMayBeUnavailable).toBe(true);
    expect(result.actionRequired).toBe(true);
  });

  it("prioritizes an active sync over an older FAILED run and a clean materialization", () => {
    // Precedence check: the most recent SyncRun always wins regardless of
    // what earlier runs or the persisted materialization state say.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, id: "run-2", status: "RUNNING" },
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.status).toBe("SYNC_IN_PROGRESS");
  });

  it("never coerces materialization fields to zero-equivalent values when absent", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: null,
    });

    expect(result.materialization.status).toBeNull();
    expect(result.materialization.completedSuccessfully).toBeNull();
    expect(result.materialization.latestMaterializedAt).toBeNull();
  });

  it("serializes latestSyncRun and materialization timestamps as ISO strings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.latestSyncRun).toEqual({
      id: "run-1",
      status: "COMPLETED",
      trigger: "MANUAL",
      stage: "UPDATING_CURSOR",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:05:00.000Z",
    });
    expect(result.materialization.latestMaterializedAt).toBe("2026-08-01T00:05:00.000Z");
  });

  // ── Finding 3: contradictory persisted state (no SyncRun, materialization exists) ──

  it("does not claim TRACKED_NOT_SYNCED when materialization exists despite no SyncRun row", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.status).not.toBe("TRACKED_NOT_SYNCED");
  });

  it("derives CANONICAL_STATE_MATERIALIZED from a warning-free materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: CLEAN_MATERIALIZATION,
    });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(result.latestSyncRun).toBeNull();
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
  });

  it("derives CANONICAL_STATE_WARNING (failing closed) from a warning-bearing materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: { ...CLEAN_MATERIALIZATION, warningCount: 2 },
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
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
    expect(result.reason).toContain("boom");
  });

  it("derives CANONICAL_STATE_PARTIAL from a RUNNING materialization when no SyncRun exists", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: null,
      materializationState: { ...CLEAN_MATERIALIZATION, status: "RUNNING", completedSuccessfully: false },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("No SyncRun evidence exists for this wallet");
  });
});

describe("getWalletOnboardingStatus", () => {
  it("queries the latest SyncRun (by createdAt desc) and the materialization state scoped to walletId + chainId", async () => {
    const findFirst = vi.fn().mockResolvedValue(BASE_SYNC_RUN);
    const findUnique = vi.fn().mockResolvedValue(CLEAN_MATERIALIZATION);
    const db = {
      syncRun: { findFirst },
      portfolioMaterializationState: { findUnique },
    } as never;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-1", chainId: 369, db });

    expect(result.status).toBe("CANONICAL_STATE_MATERIALIZED");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId: "wallet-1", chainId: 369 },
        orderBy: [{ createdAt: "desc" }],
      }),
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId_chainId: { walletId: "wallet-1", chainId: 369 } },
      }),
    );
  });

  it("derives TRACKED_NOT_SYNCED when both queries return nothing", async () => {
    const db = {
      syncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      portfolioMaterializationState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-2", chainId: 369, db });

    expect(result.status).toBe("TRACKED_NOT_SYNCED");
  });
});
