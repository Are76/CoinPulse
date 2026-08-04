import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { WalletOnboardingStatusResponseDto } from "@/lib/api/wallet-onboarding-status-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";
import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useLiveSnapshotQuery } from "@/lib/query/use-live-snapshot-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";
import { useWalletOnboardingStatusQuery } from "@/lib/query/use-wallet-onboarding-status-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => null,
}));

vi.mock("@/lib/api/dashboard-client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  fetchDebugHealth: vi.fn(async () => ({
    status: "ok",
    dependencies: { database: { status: "ok" }, redis: { status: "ok" } },
  })),
  fetchDebugStatus: vi.fn(async () => ({ sourceFamilies: ["pulsechain"] })),
}));

vi.mock("@/lib/query/use-dashboard-query", () => ({
  useDashboardQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-live-snapshot-query", () => ({
  useLiveSnapshotQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-debug-health-query", () => ({
  useDebugHealthQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-debug-status-query", () => ({
  useDebugStatusQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-tracked-wallets-query", () => ({
  useTrackedWalletsQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-wallet-onboarding-status-query", () => ({
  useWalletOnboardingStatusQuery: vi.fn(),
}));

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseLiveSnapshotQuery = vi.mocked(useLiveSnapshotQuery);
const mockUseDebugHealthQuery = vi.mocked(useDebugHealthQuery);
const mockUseDebugStatusQuery = vi.mocked(useDebugStatusQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);
const mockUseWalletOnboardingStatusQuery = vi.mocked(useWalletOnboardingStatusQuery);

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

function buildDashboardDto(
  status: PortfolioDashboardDto["materialization"]["status"],
): PortfolioDashboardDto {
  return {
    schemaVersion: "v1",
    wallet: { id: "wallet-1", address: WALLET_ADDRESS, chainId: 369 },
    quoteAsset: "fiat:usd",
    asOf: "2026-08-03T12:00:00.000Z",
    materialization: {
      status,
      completedSuccessfully: status === "COMPLETED",
      lastAttemptedAt: null,
      latestMaterializedAt: null,
      updatedFromBlock: null,
      updatedToBlock: null,
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 0,
      warnings: [],
      errorMessage: null,
      hasNegativeBalances: false,
      negativeBalances: [],
      freshness: { status: "stale", reason: null, lastMaterializedAt: null, staleAfterSeconds: 300 },
    },
    ledgerCoverage: { status: "unknown", fromBlock: null, toBlock: null, sourceFamilies: [], reason: null },
    pnlCoverage: {
      status: "unknown",
      reasons: [],
      affectedSections: [],
      pricedPositionsCount: 0,
      unpricedPositionsCount: 0,
      unsupportedPositionsCount: 0,
      incompleteBasisPositionsCount: 0,
      stalePricePositionsCount: 0,
      sourceDisabledPositionsCount: 0,
      asOf: "2026-08-03T12:00:00.000Z",
    },
    summary: {
      totalValueQuote: null,
      valuationStatus: "unavailable",
      valuationCoverage: { totalPositions: 0, valuedPositions: 0, unvaluedPositions: 0 },
      warnings: [],
    },
    tokenPositions: [],
    lpPositions: [],
    stakePositions: [],
  };
}

const LIVE_SNAPSHOT_DTO: LiveHoldingsSnapshotDto = {
  schemaVersion: "v1",
  wallet: { address: WALLET_ADDRESS, chainId: 369 },
  quoteAsset: "fiat:usd",
  asOf: "2026-08-03T12:00:00.000Z",
  sourceType: "LIVE_RPC_SNAPSHOT",
  observedBlock: "987654",
  coverage: "known_assets_only",
  coverageNote: "Onboarding-status wiring fixture coverage note.",
  pnlStatus: "unsupported",
  assets: [],
  totalValueQuote: null,
  valuationStatus: "unavailable",
  warnings: [],
};

const MATERIALIZED_ONBOARDING: WalletOnboardingStatusResponseDto = {
  schemaVersion: "v1",
  wallet: { id: "wallet-1", address: WALLET_ADDRESS, chainId: 369 },
  onboarding: {
    status: "CANONICAL_STATE_MATERIALIZED",
    reason: "Canonical portfolio state has been successfully materialized and its recorded ledger block range is fully known.",
    actionRequired: false,
    holdingsMayBeVisible: true,
    pnlMayBeAvailable: true,
    pricingMayBeUnavailable: false,
    latestSyncRun: null,
    materialization: { status: "COMPLETED", completedSuccessfully: true, warningCount: 0, latestMaterializedAt: null },
  },
};

const NOT_SYNCED_ONBOARDING: WalletOnboardingStatusResponseDto = {
  schemaVersion: "v1",
  wallet: { id: "wallet-1", address: WALLET_ADDRESS, chainId: 369 },
  onboarding: {
    status: "TRACKED_NOT_SYNCED",
    reason: "Wallet is tracked but no sync has ever been attempted.",
    actionRequired: true,
    holdingsMayBeVisible: false,
    pnlMayBeAvailable: false,
    pricingMayBeUnavailable: true,
    latestSyncRun: null,
    materialization: { status: null, completedSuccessfully: null, warningCount: 0, latestMaterializedAt: null },
  },
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(DashboardScreen)),
  );
}

function submitWalletForm() {
  fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: WALLET_ADDRESS } });
  fireEvent.change(screen.getByLabelText("Chain ID"), { target: { value: "369" } });
  fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));
}

describe("DashboardScreen wallet onboarding status wiring", () => {
  beforeEach(() => {
    const wallets: TrackedWalletDto[] = [];
    mockUseTrackedWalletsQuery.mockImplementation(() => ({
      data: { wallets },
      isSuccess: true,
      isError: false,
      isPending: false,
    } as ReturnType<typeof useTrackedWalletsQuery>));
    mockUseDebugHealthQuery.mockReturnValue({
      data: { status: "ok", dependencies: { database: { status: "ready" }, redis: { status: "ready" } } },
      error: null,
      isError: false,
    } as ReturnType<typeof useDebugHealthQuery>);
    mockUseDebugStatusQuery.mockReturnValue({
      data: { sourceFamilies: ["pulsechain"] },
      error: null,
      isError: false,
    } as ReturnType<typeof useDebugStatusQuery>);
    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto("COMPLETED"),
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
    mockUseLiveSnapshotQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useLiveSnapshotQuery>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render an onboarding status section before a wallet is submitted", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();

    expect(screen.queryByText("Onboarding status")).not.toBeInTheDocument();
  });

  it("renders the canonical backend-derived status once a wallet is submitted", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: MATERIALIZED_ONBOARDING,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Onboarding status")).toBeInTheDocument();
    expect(screen.getByText("Materialized")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Canonical portfolio state has been successfully materialized and its recorded ledger block range is fully known.",
      ),
    ).toBeInTheDocument();
  });

  it("renders TRACKED_NOT_SYNCED distinctly from a materialized state", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: NOT_SYNCED_ONBOARDING,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Not synced")).toBeInTheDocument();
    expect(screen.queryByText("Materialized")).not.toBeInTheDocument();
  });

  it("keeps the canonical onboarding status visible even when the live snapshot fallback renders", () => {
    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto(null),
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
    mockUseLiveSnapshotQuery.mockReturnValue({
      data: LIVE_SNAPSHOT_DTO,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useLiveSnapshotQuery>);
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: NOT_SYNCED_ONBOARDING,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    // The live-RPC-derived snapshot never replaces or hides the canonical,
    // backend-derived onboarding status — both are visible at once.
    expect(screen.getByTestId("live-snapshot-card")).toBeInTheDocument();
    expect(screen.getByText("Onboarding status")).toBeInTheDocument();
    expect(screen.getByText("Not synced")).toBeInTheDocument();
  });

  it("shows a loading message while the onboarding status request is in flight", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Loading onboarding status…")).toBeInTheDocument();
  });

  it("falls back to a generic message when the onboarding status request fails without a query error object", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: null,
    } as unknown as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Unknown frontend error.")).toBeInTheDocument();
  });

  // ── Finding 9: render the backend-provided onboarding error message ──────

  it("renders the operator-safe backend WALLET_NOT_FOUND message verbatim instead of a generic string", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Wallet not found for the requested chain."),
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Wallet not found for the requested chain.")).toBeInTheDocument();
    expect(screen.queryByText("Could not load onboarding status.")).not.toBeInTheDocument();
  });

  it("does not leak internal error details, only the backend-provided message", () => {
    mockUseWalletOnboardingStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Internal server error."),
    } as ReturnType<typeof useWalletOnboardingStatusQuery>);

    renderDashboard();
    submitWalletForm();

    expect(screen.getByText("Internal server error.")).toBeInTheDocument();
  });
});
