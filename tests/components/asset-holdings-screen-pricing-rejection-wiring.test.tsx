/**
 * AssetHoldingsScreen presentation of backend pricing.rejectedReasons.
 *
 * The Holdings screen consumes the same PortfolioDashboardDto.tokenPositions
 * as the Dashboard screen and must present the UNVERIFIED_QUOTE_ASSUMPTION
 * backend rejection reason (introduced by PR #351) through the same shared
 * explanation helper — rendering only, no recomputation, no additional
 * fetch.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetHoldingsScreen } from "@/components/portfolio/asset-holdings-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import type { DashboardTokenPositionDto, PortfolioDashboardDto } from "@/services/dashboard/types";
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

const EXPLANATION_TITLE = "USD price unavailable";
const EXPLANATION_MESSAGE =
  "A pDAI-based observation was rejected because CoinPulse does not have independent evidence that pDAI equals USD. Current USD valuation and unrealized PnL are therefore unavailable.";

const WALLET_A: TrackedWalletDto = {
  id: "wallet-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "First",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makeTokenPosition(
  overrides: Partial<DashboardTokenPositionDto> = {},
): DashboardTokenPositionDto {
  return {
    assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
    assetAddress: "0x2222222222222222222222222222222222222222",
    balanceQuantity: "5",
    decimals: 18,
    metadataProvenance: {
      status: "observed",
      source: "chain",
      observedAt: "2026-05-08T11:59:00.000Z",
      confidence: "medium",
      conflictReason: null,
    },
    updatedFromBlock: null,
    updatedToBlock: null,
    pricing: {
      status: "unavailable",
      sourceType: null,
      sourceId: null,
      confidence: null,
      observedAt: null,
      staleAfterSeconds: null,
      rejectedReasons: [],
    },
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
    ...overrides,
  };
}

function baseDashboardDto(): PortfolioDashboardDto {
  return {
    schemaVersion: "v1",
    wallet: { id: "wallet-1", address: WALLET_A.address, chainId: 369 },
    quoteAsset: "fiat:usd",
    asOf: "2026-07-31T12:00:00.000Z",
    materialization: {
      status: "COMPLETED",
      completedSuccessfully: true,
      lastAttemptedAt: "2026-07-31T12:00:00.000Z",
      latestMaterializedAt: "2026-07-31T12:00:00.000Z",
      updatedFromBlock: null,
      updatedToBlock: null,
      sourceLedgerFromBlock: null,
      sourceLedgerToBlock: null,
      warningCount: 0,
      warnings: [],
      errorMessage: null,
      hasNegativeBalances: false,
      negativeBalances: [],
      freshness: { status: "fresh", reason: null, lastMaterializedAt: "2026-07-31T12:00:00.000Z", staleAfterSeconds: 300 },
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
      asOf: "2026-07-31T12:00:00.000Z",
    },
    summary: {
      totalValueQuote: null,
      valuationStatus: "unavailable",
      valuationCoverage: { totalPositions: 1, valuedPositions: 0, unvaluedPositions: 1 },
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

describe("AssetHoldingsScreen pricing rejection presentation — affected position", () => {
  it("explains an unverified pDAI quote assumption without showing the raw backend enum", () => {
    const dto = baseDashboardDto();
    dto.tokenPositions = [
      makeTokenPosition({
        pricing: {
          status: "unavailable",
          sourceType: null,
          sourceId: null,
          confidence: null,
          observedAt: null,
          staleAfterSeconds: null,
          rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
        },
      }),
    ];

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(screen.getByText(EXPLANATION_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EXPLANATION_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("UNVERIFIED_QUOTE_ASSUMPTION")).not.toBeInTheDocument();
  });

  it("does not perform an additional fetch to explain the reason", () => {
    const dto = baseDashboardDto();
    dto.tokenPositions = [
      makeTokenPosition({
        pricing: {
          status: "unavailable",
          sourceType: null,
          sourceId: null,
          confidence: null,
          observedAt: null,
          staleAfterSeconds: null,
          rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
        },
      }),
    ];

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(mockUseDashboardQuery).toHaveBeenCalledTimes(1);
  });
});

describe("AssetHoldingsScreen pricing rejection presentation — unaffected position", () => {
  it("does not show the pDAI explanation for a position without that rejection reason", () => {
    const dto = baseDashboardDto();
    dto.tokenPositions = [makeTokenPosition()];

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
  });
});

describe("AssetHoldingsScreen pricing rejection presentation — available price with a rejected pDAI candidate", () => {
  it("does not show the explanation, and keeps displaying the accepted price, when pricing.status is available", () => {
    const dto = baseDashboardDto();
    dto.tokenPositions = [
      makeTokenPosition({
        pricing: {
          status: "available",
          sourceType: "ORACLE",
          sourceId: "manual:verified-fiat-usd",
          confidence: "high",
          observedAt: "2026-07-31T12:00:00.000Z",
          staleAfterSeconds: 300,
          rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
        },
        valuation: { status: "available", valueQuote: "42.50" },
      }),
    ];

    mockUseDashboardQuery.mockReturnValue({
      data: dto,
      error: null,
      isError: false,
      isFetching: false,
      isPending: false,
    } as ReturnType<typeof useDashboardQuery>);

    renderScreen();

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText("UNVERIFIED_QUOTE_ASSUMPTION")).not.toBeInTheDocument();
    expect(screen.getByText("42.50")).toBeInTheDocument();
    expect(screen.getAllByText("available").length).toBeGreaterThan(0);
  });
});
