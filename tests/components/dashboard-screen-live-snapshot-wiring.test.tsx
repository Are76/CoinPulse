import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";
import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useLiveSnapshotQuery } from "@/lib/query/use-live-snapshot-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

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

function buildDashboardDto(
  status: PortfolioDashboardDto["materialization"]["status"],
  positions?: {
    tokenPositions?: PortfolioDashboardDto["tokenPositions"];
    lpPositions?: PortfolioDashboardDto["lpPositions"];
    stakePositions?: PortfolioDashboardDto["stakePositions"];
  },
): PortfolioDashboardDto {
  return {
    schemaVersion: "v1",
    wallet: { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", chainId: 369 },
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
    tokenPositions: positions?.tokenPositions ?? [],
    lpPositions: positions?.lpPositions ?? [],
    stakePositions: positions?.stakePositions ?? [],
  };
}

const LIVE_SNAPSHOT_DTO: LiveHoldingsSnapshotDto = {
  schemaVersion: "v1",
  wallet: { address: "0x1111111111111111111111111111111111111111", chainId: 369 },
  quoteAsset: "fiat:usd",
  asOf: "2026-08-03T12:00:00.000Z",
  sourceType: "LIVE_RPC_SNAPSHOT",
  observedBlock: "987654",
  coverage: "known_assets_only",
  coverageNote: "Live snapshot wiring fixture coverage note.",
  pnlStatus: "unsupported",
  assets: [
    {
      assetId: "chain:369:erc20:0xcccccccccccccccccccccccccccccccccccccc",
      assetAddress: "0xcccccccccccccccccccccccccccccccccccccc",
      symbol: "TKN",
      decimals: 18,
      balanceQuantity: "2000000000000000000",
      priceStatus: "priced",
      valueQuote: "1.25",
      pricing: {
        sourceType: "PULSEX_ONCHAIN",
        sourceId: "pulsex:pulsex_v2:route:wpls-pdai",
        confidence: "0.9",
        observedAt: "2026-08-03T11:59:00.000Z",
        observedBlock: "987650",
        staleAfterSeconds: 300,
        rejectedReasons: [],
      },
    },
  ],
  totalValueQuote: "1.25",
  valuationStatus: "partial",
  warnings: [],
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(DashboardScreen)),
  );
}

describe("DashboardScreen live snapshot wiring", () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the live snapshot card and hides normal dashboard sections when materialization is null", () => {
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

    renderDashboard();

    expect(screen.getByTestId("live-snapshot-card")).toBeInTheDocument();
    expect(screen.getByText(/Live snapshot wiring fixture coverage note\./)).toBeInTheDocument();
    expect(screen.queryByText("Materialization freshness")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No token positions were materialized for this wallet and chain."),
    ).not.toBeInTheDocument();
  });

  it("shows the normal dashboard sections and hides the live snapshot card when materialization is COMPLETED", () => {
    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto("COMPLETED"),
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

    renderDashboard();

    expect(screen.queryByTestId("live-snapshot-card")).not.toBeInTheDocument();
    expect(screen.getByText("Materialization freshness")).toBeInTheDocument();
    expect(
      screen.getByText("No token positions were materialized for this wallet and chain."),
    ).toBeInTheDocument();
  });

  it("shows the normal dashboard sections (not the live snapshot fallback) when materialization is null but persisted token positions exist", () => {
    const persistedTokenPosition: PortfolioDashboardDto["tokenPositions"][number] = {
      assetId: "chain:369:erc20:0xdddddddddddddddddddddddddddddddddddddd",
      assetAddress: "0xdddddddddddddddddddddddddddddddddddddd",
      balanceQuantity: "3000000000000000000",
      decimals: 18,
      metadataProvenance: { status: "unknown", source: "unknown", observedAt: null, confidence: "unknown", conflictReason: null },
      updatedFromBlock: null,
      updatedToBlock: null,
      pricing: { status: "unavailable", sourceType: null, sourceId: null, confidence: null, observedAt: null, staleAfterSeconds: null, rejectedReasons: [] },
      valuation: { status: "unavailable", valueQuote: null },
      pnl: {
        status: "unavailable",
        holdingsQuantity: null,
        averageCost: null,
        realizedPnl: null,
        unrealizedPnl: null,
        markPrice: null,
        totalAcquiredQuantity: null,
        totalDisposedQuantity: null,
        warnings: [],
      },
    };

    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto(null, { tokenPositions: [persistedTokenPosition] }),
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

    renderDashboard();

    // A null materialization status alone must not hide real persisted
    // positions — only an actually-empty dashboard should fall back to the
    // live snapshot.
    expect(screen.queryByTestId("live-snapshot-card")).not.toBeInTheDocument();
    expect(screen.getByText("Materialization freshness")).toBeInTheDocument();
    expect(
      screen.queryByText("No token positions were materialized for this wallet and chain."),
    ).not.toBeInTheDocument();
    // The live snapshot query must not even be enabled in this case.
    expect(mockUseLiveSnapshotQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("shows a loading state for the live snapshot while it is still fetching", () => {
    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto(null),
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
    mockUseLiveSnapshotQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isFetching: true,
      isLoading: true,
    } as ReturnType<typeof useLiveSnapshotQuery>);

    renderDashboard();

    expect(screen.queryByTestId("live-snapshot-card")).not.toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows an explicit error state when the live snapshot request fails, using the backend error message", () => {
    mockUseDashboardQuery.mockReturnValue({
      data: buildDashboardDto(null),
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
    mockUseLiveSnapshotQuery.mockReturnValue({
      data: undefined,
      error: new Error("Live snapshot RPC provider unavailable."),
      isError: true,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useLiveSnapshotQuery>);

    renderDashboard();

    expect(screen.queryByTestId("live-snapshot-card")).not.toBeInTheDocument();
    expect(screen.getByText("Live snapshot RPC provider unavailable.")).toBeInTheDocument();
  });
});
