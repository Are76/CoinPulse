import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as dashboardClient from "@/lib/api/dashboard-client";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DASHBOARD_GC_TIME,
  DASHBOARD_STALE_TIME,
  useDashboardQuery,
} from "@/lib/query/use-dashboard-query";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

function makeRetryingWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 3,
        retryDelay: 1,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MOCK_DASHBOARD = {
  schemaVersion: "v1" as const,
  wallet: { id: "w1", address: "0x1111111111111111111111111111111111111111", chainId: 369 },
  quoteAsset: "fiat:usd",
  asOf: "2026-01-01T00:00:00.000Z",
  materialization: {
    status: "COMPLETED" as const,
    completedSuccessfully: true,
    lastAttemptedAt: "2026-01-01T00:00:00.000Z",
    latestMaterializedAt: "2026-01-01T00:00:00.000Z",
    updatedFromBlock: null,
    updatedToBlock: null,
    sourceLedgerFromBlock: null,
    sourceLedgerToBlock: null,
    warningCount: 0,
    warnings: [],
    errorMessage: null,
    hasNegativeBalances: false,
    negativeBalances: [],
    freshness: {
      status: "fresh" as const,
      reason: null,
      lastMaterializedAt: "2026-01-01T00:00:00.000Z",
      staleAfterSeconds: 900,
    },
  },
  ledgerCoverage: {
    status: "unknown" as const,
    fromBlock: null,
    toBlock: null,
    sourceFamilies: [],
    reason: "No block range recorded in persisted materialization state.",
  },
  pnlCoverage: {
    status: "unknown" as const,
    reasons: [],
    affectedSections: [],
    pricedPositionsCount: 0,
    unpricedPositionsCount: 0,
    unsupportedPositionsCount: 0,
    incompleteBasisPositionsCount: 0,
    stalePricePositionsCount: 0,
    sourceDisabledPositionsCount: 0,
    asOf: "2026-01-01T00:00:00.000Z",
  },
  summary: {
    totalValueQuote: null,
    valuationStatus: "unsupported" as const,
    valuationCoverage: { totalPositions: 0, valuedPositions: 0, unvaluedPositions: 0 },
    warnings: [],
  },
  tokenPositions: [],
  lpPositions: [],
  stakePositions: [],
};

describe("useDashboardQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the exact shared dashboard query key and cache lifetimes", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const expectedQueryKey = queryKeys.dashboard({
      schemaVersion: "v1",
      chainId: 369,
      walletAddress: "  0xABCDEFabcdefABCDEFabcdefABCDEFabcdef1234  ",
      quoteAsset: "fiat:usd",
      asOf: "2026-02-02T00:00:00.000Z",
    });

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "  0xABCDEFabcdefABCDEFabcdefABCDEFabcdef1234  ",
          chainId: 369,
          quoteAsset: "fiat:usd",
          asOf: "2026-02-02T00:00:00.000Z",
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey: expectedQueryKey });
    expect(matchingQueries).toHaveLength(1);
    expect(matchingQueries[0].queryKey).toEqual(expectedQueryKey);
    const cacheOptions = matchingQueries[0].options as { gcTime?: unknown; staleTime?: unknown };
    expect(cacheOptions.staleTime).toBe(DASHBOARD_STALE_TIME);
    expect(cacheOptions.gcTime).toBe(DASHBOARD_GC_TIME);
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      expectedQueryKey,
    ]);
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith({
      walletAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdef1234",
      chainId: 369,
      quoteAsset: "fiat:usd",
      asOf: "2026-02-02T00:00:00.000Z",
    });
  });

  it("passes the backend DTO through without frontend computation or inference", async () => {
    const dashboard = {
      ...MOCK_DASHBOARD,
      summary: {
        totalValueQuote: "123.45",
        valuationStatus: "partial" as const,
        valuationCoverage: { totalPositions: 3, valuedPositions: 1, unvaluedPositions: 2 },
        warnings: ["backend supplied warning"],
      },
      materialization: {
        ...MOCK_DASHBOARD.materialization,
        status: "FAILED" as const,
        completedSuccessfully: false,
        warningCount: 1,
        warnings: [
          { code: "generic_persisted_warning" as const, message: "materialization warning" },
        ],
        errorMessage: "backend supplied materialization error",
      },
      pnlCoverage: {
        ...MOCK_DASHBOARD.pnlCoverage,
        status: "partial" as const,
        reasons: ["unpriced" as const],
        affectedSections: ["tokens" as const],
        pricedPositionsCount: 1,
        unpricedPositionsCount: 2,
      },
      tokenPositions: [
        {
          assetId: "chain:369:erc20:0xtoken",
          assetAddress: "0xtoken",
          balanceQuantity: "5",
          decimals: 18,
          metadataProvenance: {
            status: "unknown" as const,
            source: "unknown" as const,
            observedAt: null,
            confidence: "low" as const,
            conflictReason: "backend conflict",
          },
          updatedFromBlock: "10",
          updatedToBlock: "20",
          pricing: {
            status: "stale_price" as const,
            sourceType: "ORACLE" as const,
            sourceId: "price-1",
            confidence: "low" as const,
            observedAt: "2026-01-01T00:00:00.000Z",
            staleAfterSeconds: 60,
            rejectedReasons: ["backend rejected reason"],
          },
          valuation: { status: "available" as const, valueQuote: "123.45" },
          pnl: {
            status: "incomplete_basis" as const,
            holdingsQuantity: "5",
            averageCost: null,
            realizedPnl: "1",
            unrealizedPnl: null,
            markPrice: "24.69",
            totalAcquiredQuantity: "5",
            totalDisposedQuantity: "0",
            warnings: [
              { code: "INSUFFICIENT_COST_BASIS" as const, detail: "backend pnl warning" },
            ],
          },
        },
      ],
    };
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(dashboard);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(dashboard);
    expect(result.current.data).toEqual(dashboard);
  });

  it("fetches portfolio dashboard data when enabled with a non-empty wallet address", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          quoteAsset: "fiat:usd",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      quoteAsset: "fiat:usd",
    });
    expect(result.current.data).toEqual(MOCK_DASHBOARD);
  });

  it("passes backend metadata provenance through the query result", async () => {
    const metadataProvenance = {
      status: "observed" as const,
      source: "chain" as const,
      observedAt: "2026-05-08T11:59:00.000Z",
      confidence: "medium" as const,
      conflictReason: null,
    };
    const dashboard = {
      ...MOCK_DASHBOARD,
      tokenPositions: [
        {
          assetId: "chain:369:erc20:0xtoken",
          assetAddress: "0xtoken",
          balanceQuantity: "5",
          decimals: 18,
          metadataProvenance,
          updatedFromBlock: null,
          updatedToBlock: null,
          pricing: {
            status: "unavailable" as const,
            sourceType: null,
            sourceId: null,
            confidence: null,
            observedAt: null,
            staleAfterSeconds: null,
            rejectedReasons: [],
          },
          valuation: { status: "unavailable" as const, valueQuote: null },
          pnl: {
            status: "unavailable" as const,
            holdingsQuantity: null,
            averageCost: null,
            realizedPnl: null,
            unrealizedPnl: null,
            markPrice: null,
            totalAcquiredQuantity: null,
            totalDisposedQuantity: null,
            warnings: [],
          },
        },
      ],
    };
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(dashboard);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tokenPositions[0].metadataProvenance).toEqual(metadataProvenance);
  });

  it("trims leading and trailing whitespace from walletAddress before fetching", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "  0x1111111111111111111111111111111111111111  ",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0x1111111111111111111111111111111111111111",
      }),
    );
  });

  it("does not fetch when walletAddress is empty", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(dashboardClient.fetchPortfolioDashboard).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is whitespace only", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "   ",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(dashboardClient.fetchPortfolioDashboard).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(dashboardClient.fetchPortfolioDashboard).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("propagates fetch errors through the query error state", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: makeRetryingWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe("Network error");
  });

  it("uses the default quoteAsset of fiat:usd when not specified", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteAsset: "fiat:usd",
      }),
    );
  });

  it("forwards asOf to fetchPortfolioDashboard when provided", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          asOf: "2026-02-02T00:00:00.000Z",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        asOf: "2026-02-02T00:00:00.000Z",
      }),
    );
  });

  it("does not retry failed dashboard queries", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockRejectedValue(
      new dashboardClient.ApiClientError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Invalid request input.",
      }),
    );

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tracked-wallet request contract
//
// Regression suite proving the hook forwards whatever walletAddress and
// chainId it receives as explicit request params, independent of any
// tracked-wallet frontend state.  A tracked-looking address and a manually
// typed address must be indistinguishable at this layer.
// ---------------------------------------------------------------------------

describe("tracked-wallet request contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a tracked-looking wallet address is forwarded as explicit walletAddress param without consulting tracked-wallet state", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const TRACKED_LOOKING = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01";

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: TRACKED_LOOKING,
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: TRACKED_LOOKING,
        chainId: 369,
      }),
    );
  });

  it("a manually supplied wallet address is forwarded identically to a tracked-looking address", async () => {
    vi.spyOn(dashboardClient, "fetchPortfolioDashboard").mockResolvedValue(MOCK_DASHBOARD);

    const MANUAL_ADDRESS = "0x2222222222222222222222222222222222222222";

    const { result } = renderHook(
      () =>
        useDashboardQuery({
          walletAddress: MANUAL_ADDRESS,
          chainId: 369,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardClient.fetchPortfolioDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: MANUAL_ADDRESS,
        chainId: 369,
      }),
    );
  });
});
