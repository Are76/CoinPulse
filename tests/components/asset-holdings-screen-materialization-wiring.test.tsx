/**
 * AssetHoldingsScreen materialization warnings wiring.
 *
 * The Holdings screen consumes the same dashboard DTO as the Dashboard
 * screen and must surface the same backend-provided freshness and
 * integrity warnings via the existing shared presenter components —
 * rendering only, no recomputation.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetHoldingsScreen } from "@/components/portfolio/asset-holdings-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { PortfolioDashboardDto } from "@/services/dashboard/types";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("@/lib/query/use-dashboard-query", () => ({
  useDashboardQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-tracked-wallets-query", () => ({
  useTrackedWalletsQuery: vi.fn(),
}));

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);

const WALLET_A: TrackedWalletDto = {
  id: "wallet-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "First",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function baseDashboardDto(): PortfolioDashboardDto {
  return {
    schemaVersion: "v1",
    wallet: { id: "wallet-1", address: WALLET_A.address, chainId: 369 },
    quoteAsset: "fiat:usd",
    asOf: "2026-07-27T12:00:00.000Z",
    materialization: {
      status: "COMPLETED",
      completedSuccessfully: true,
      lastAttemptedAt: "2026-07-27T12:00:00.000Z",
      latestMaterializedAt: "2026-07-27T12:00:00.000Z",
      updatedFromBlock: null,
      updatedToBlock: null,
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 0,
      warnings: [],
      errorMessage: null,
      hasNegativeBalances: false,
      negativeBalances: [],
      freshness: { status: "fresh", reason: null, lastMaterializedAt: "2026-07-27T12:00:00.000Z", staleAfterSeconds: 300 },
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
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AssetHoldingsScreen)),
  );
}

beforeEach(() => {
  nav.search = "";
  mockUseTrackedWalletsQuery.mockReturnValue({
    data: { schemaVersion: "v1", wallets: [WALLET_A] },
    isSuccess: true,
    isError: false,
    isPending: false,
  } as ReturnType<typeof useTrackedWalletsQuery>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssetHoldingsScreen materialization warnings — flagged payload", () => {
  it("surfaces freshness and integrity warnings from the backend DTO", () => {
    const dto = baseDashboardDto();
    dto.materialization = {
      ...dto.materialization,
      status: "FAILED",
      completedSuccessfully: false,
      warningCount: 1,
      warnings: [{ code: "generic_persisted_warning", message: "Holdings wiring fixture warning" }],
      errorMessage: "Holdings wiring fixture error message",
      hasNegativeBalances: true,
      freshness: { status: "stale", reason: null, lastMaterializedAt: null, staleAfterSeconds: 300 },
    };

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(screen.getByText("Materialization freshness")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Materialization integrity")).toBeInTheDocument();
    expect(screen.getByText("Materialization error")).toBeInTheDocument();
    expect(screen.getByText("Holdings wiring fixture error message")).toBeInTheDocument();
    expect(screen.getByText("generic_persisted_warning")).toBeInTheDocument();
    expect(screen.getByText(/Holdings wiring fixture warning/)).toBeInTheDocument();
    expect(screen.getByText("FAILED")).toBeInTheDocument();
  });
});

describe("AssetHoldingsScreen materialization warnings — clean payload", () => {
  it("does not fabricate an integrity warning when materialization is clean", () => {
    const dto = baseDashboardDto();

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(screen.getByText("Materialization freshness")).toBeInTheDocument();
    expect(screen.queryByText("Materialization error")).not.toBeInTheDocument();
    expect(screen.queryByText("generic_persisted_warning")).not.toBeInTheDocument();
  });
});

describe("AssetHoldingsScreen materialization warnings — existing behavior preserved", () => {
  it("does not fire an extra dashboard query call for rendering the warning sections", () => {
    const dto = baseDashboardDto();
    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(mockUseDashboardQuery).toHaveBeenCalledTimes(1);
    expect(mockUseDashboardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: WALLET_A.address, chainId: WALLET_A.chainId, enabled: true }),
    );
  });
});
