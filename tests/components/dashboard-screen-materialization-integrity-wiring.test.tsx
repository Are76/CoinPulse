import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

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
const mockUseDebugHealthQuery = vi.mocked(useDebugHealthQuery);
const mockUseDebugStatusQuery = vi.mocked(useDebugStatusQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);

const DASHBOARD_DTO: PortfolioDashboardDto = {
  schemaVersion: "v1",
  wallet: { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", chainId: 369 },
  quoteAsset: "fiat:usd",
  asOf: "2026-07-27T12:00:00.000Z",
  materialization: {
    status: "FAILED",
    completedSuccessfully: false,
    lastAttemptedAt: "2026-07-27T12:00:00.000Z",
    latestMaterializedAt: null,
    updatedFromBlock: null,
    updatedToBlock: null,
    sourceLedgerFromBlock: null,
    sourceLedgerToBlock: null,
    warningCount: 1,
    warnings: [{ code: "generic_persisted_warning", message: "Screen wiring fixture warning" }],
    errorMessage: "Screen wiring fixture error message",
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
    asOf: "2026-07-27T12:00:00.000Z",
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

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(DashboardScreen)),
  );
}

describe("DashboardScreen materialization integrity wiring", () => {
  beforeEach(() => {
    const wallets: TrackedWalletDto[] = [];
    mockUseTrackedWalletsQuery.mockImplementation(() => ({
      data: { wallets },
      isSuccess: true,
      isError: false,
      isPending: false,
    } as ReturnType<typeof useTrackedWalletsQuery>));
    mockUseDashboardQuery.mockReturnValue({
      data: DASHBOARD_DTO,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes the full materialization DTO from the screen into the integrity presenter", () => {
    renderDashboard();

    expect(screen.getByText("Materialization integrity")).toBeInTheDocument();
    expect(screen.getByText("Materialization error")).toBeInTheDocument();
    expect(screen.getByText("Screen wiring fixture error message")).toBeInTheDocument();
    expect(screen.getByText("generic_persisted_warning")).toBeInTheDocument();
    expect(screen.getByText(/Screen wiring fixture warning/)).toBeInTheDocument();
    expect(screen.getByText("FAILED")).toBeInTheDocument();
  });

  it("keeps the existing freshness section rendering alongside the new integrity section", () => {
    renderDashboard();

    expect(screen.getByText("Materialization freshness")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });
});
