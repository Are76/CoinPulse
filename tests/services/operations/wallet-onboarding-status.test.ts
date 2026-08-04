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

const READY_MATERIALIZATION: NonNullable<MaterializationStateInput> = {
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
      materializationState: READY_MATERIALIZATION,
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
      materializationState: { ...READY_MATERIALIZATION, status: "RUNNING", completedSuccessfully: false },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("returns CANONICAL_STATE_PARTIAL when materialization FAILED, surfacing the error", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...READY_MATERIALIZATION,
        status: "FAILED",
        completedSuccessfully: false,
        errorMessage: "negative balance invariant violated",
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.reason).toContain("negative balance invariant violated");
  });

  it("returns CANONICAL_STATE_PARTIAL when ledger block-range coverage is unknown", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...READY_MATERIALIZATION,
        sourceLedgerFromBlock: null,
        sourceLedgerToBlock: null,
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(false);
  });

  it("returns CANONICAL_STATE_PARTIAL when ledger block-range coverage is only partially recorded", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: {
        ...READY_MATERIALIZATION,
        sourceLedgerFromBlock: 100n,
        sourceLedgerToBlock: null,
      },
    });

    expect(result.status).toBe("CANONICAL_STATE_PARTIAL");
  });

  it("returns CANONICAL_STATE_READY for a fully covered, warning-free materialization", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: READY_MATERIALIZATION,
    });

    expect(result.status).toBe("CANONICAL_STATE_READY");
    expect(result.actionRequired).toBe(false);
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(true);
    expect(result.pricingMayBeUnavailable).toBe(false);
  });

  it("returns CANONICAL_STATE_WARNING for a covered, successful materialization with active warnings", () => {
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: BASE_SYNC_RUN,
      materializationState: { ...READY_MATERIALIZATION, warningCount: 3 },
    });

    expect(result.status).toBe("CANONICAL_STATE_WARNING");
    expect(result.actionRequired).toBe(true);
    expect(result.holdingsMayBeVisible).toBe(true);
    expect(result.pnlMayBeAvailable).toBe(true);
  });

  it("prioritizes an active sync over an older FAILED run and a ready materialization", () => {
    // Precedence check: the most recent SyncRun always wins regardless of
    // what earlier runs or the persisted materialization state say.
    const result = deriveWalletOnboardingStatus({
      latestSyncRun: { ...BASE_SYNC_RUN, id: "run-2", status: "RUNNING" },
      materializationState: READY_MATERIALIZATION,
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
      materializationState: READY_MATERIALIZATION,
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
});

describe("getWalletOnboardingStatus", () => {
  it("queries the latest SyncRun (by createdAt desc) and the materialization state scoped to walletId + chainId", async () => {
    const findFirst = vi.fn().mockResolvedValue(BASE_SYNC_RUN);
    const findUnique = vi.fn().mockResolvedValue(READY_MATERIALIZATION);
    const db = {
      syncRun: { findFirst },
      portfolioMaterializationState: { findUnique },
    } as never;

    const result = await getWalletOnboardingStatus({ walletId: "wallet-1", chainId: 369, db });

    expect(result.status).toBe("CANONICAL_STATE_READY");
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
