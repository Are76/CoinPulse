import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { WalletOnboardingStatusResponseDto } from "@/lib/api/wallet-onboarding-status-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useLiveSnapshotQuery } from "@/lib/query/use-live-snapshot-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

// Deliberately do NOT mock use-wallet-onboarding-status-query here — this
// file exercises the real hook + real TanStack Query cache so the
// handleSubmit removeQueries wiring (Finding 8) is genuinely tested, not
// just asserted against a mock.
vi.mock("@/lib/api/wallet-onboarding-status-client", () => ({
  fetchWalletOnboardingStatus: vi.fn(),
}));

import { fetchWalletOnboardingStatus } from "@/lib/api/wallet-onboarding-status-client";

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

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseLiveSnapshotQuery = vi.mocked(useLiveSnapshotQuery);
const mockUseDebugHealthQuery = vi.mocked(useDebugHealthQuery);
const mockUseDebugStatusQuery = vi.mocked(useDebugStatusQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);
const mockFetchWalletOnboardingStatus = vi.mocked(fetchWalletOnboardingStatus);

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

function buildDashboardDto(): PortfolioDashboardDto {
  return {
    schemaVersion: "v1",
    wallet: { id: "wallet-1", address: WALLET_ADDRESS, chainId: 369 },
    quoteAsset: "fiat:usd",
    asOf: "2026-08-03T12:00:00.000Z",
    materialization: {
      status: "COMPLETED",
      completedSuccessfully: true,
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

const READY_RESPONSE: WalletOnboardingStatusResponseDto = {
  schemaVersion: "v1",
  wallet: { id: "wallet-1", address: WALLET_ADDRESS, chainId: 369 },
  onboarding: {
    status: "CANONICAL_STATE_MATERIALIZED",
    reason: "Canonical portfolio state has been successfully materialized.",
    actionRequired: false,
    holdingsMayBeVisible: true,
    pnlMayBeAvailable: true,
    pricingMayBeUnavailable: false,
    latestSyncRun: null,
    materialization: { status: "COMPLETED", completedSuccessfully: true, warningCount: 0, latestMaterializedAt: null },
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

describe("DashboardScreen onboarding status — repeat submission (Finding 8)", () => {
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
      data: buildDashboardDto(),
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

  it("re-fetches onboarding status on a repeat submission for the same wallet/chain after a failed first request", async () => {
    mockFetchWalletOnboardingStatus
      .mockRejectedValueOnce(new Error("Wallet onboarding status request failed."))
      .mockResolvedValueOnce(READY_RESPONSE);

    renderDashboard();

    submitWalletForm();
    await waitFor(() => expect(mockFetchWalletOnboardingStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Wallet onboarding status request failed.")).toBeInTheDocument());

    // Second submit for the identical wallet/chain — with retry disabled and
    // a 15s staleTime, the failed query would otherwise remain cached and
    // never re-fetch. handleSubmit must remove the onboarding-status query
    // so this submission triggers a genuine second network call.
    submitWalletForm();

    await waitFor(() => expect(mockFetchWalletOnboardingStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Materialized")).toBeInTheDocument());
    expect(screen.queryByText("Wallet onboarding status request failed.")).not.toBeInTheDocument();
  });
});
