import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as pricesClient from "@/lib/api/prices-client";
import { queryKeys } from "@/lib/query/query-keys";
import {
  PRICING_STATUS_GC_TIME,
  PRICING_STATUS_STALE_TIME,
  usePricingStatusQuery,
} from "@/lib/query/use-pricing-status-query";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 3, retryDelay: 1 },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

const MOCK_PRICING_STATUS: pricesClient.PricingStatusDto = {
  schemaVersion: "v1",
  status: "ok",
  asOf: "2026-05-11T12:00:00.000Z",
  sources: [
    {
      sourceType: "ONCHAIN_POOL",
      status: "ok",
      latestObservedAt: "2026-05-11T11:59:00.000Z",
      staleAfterSeconds: 120,
      observationsCount: 5,
      rejectedCount: 0,
      reason: null,
    },
  ],
};

describe("usePricingStatusQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses queryKeys.prices.status(369) as the query key", async () => {
    vi.spyOn(pricesClient, "fetchPricingStatus").mockResolvedValue(MOCK_PRICING_STATUS);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePricingStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.prices.status(369) });
    expect(query).toBeDefined();
    const queryOptions = query!.options as {
      queryKey?: unknown;
      staleTime?: unknown;
      gcTime?: unknown;
      retry?: unknown;
    };
    expect(queryOptions.queryKey).toEqual(queryKeys.prices.status(369));
    expect(queryOptions.staleTime).toBe(PRICING_STATUS_STALE_TIME);
    expect(queryOptions.gcTime).toBe(PRICING_STATUS_GC_TIME);
    expect(queryOptions.retry).toBe(false);
  });

  it("returns the pricing status DTO on success", async () => {
    vi.spyOn(pricesClient, "fetchPricingStatus").mockResolvedValue(MOCK_PRICING_STATUS);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePricingStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(pricesClient.fetchPricingStatus).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_PRICING_STATUS);
  });

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(pricesClient, "fetchPricingStatus").mockResolvedValue(MOCK_PRICING_STATUS);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePricingStatusQuery({ enabled: false }), {
      wrapper: Wrapper,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(pricesClient.fetchPricingStatus).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("preserves backend ApiClientError and does not retry", async () => {
    vi.spyOn(pricesClient, "fetchPricingStatus").mockRejectedValue(
      new pricesClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Unable to determine pricing status.",
      }),
    );
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePricingStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(pricesClient.fetchPricingStatus).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(pricesClient.ApiClientError);
    expect((result.current.error as Error).message).toBe(
      "Unable to determine pricing status.",
    );
  });

  it("does not invalidate dashboard or wallet queries", async () => {
    vi.spyOn(pricesClient, "fetchPricingStatus").mockResolvedValue(MOCK_PRICING_STATUS);
    const { queryClient, Wrapper } = makeWrapper();

    // Pre-seed a dashboard and wallet query with data
    await queryClient.setQueryData(
      queryKeys.dashboard({
        schemaVersion: "v1",
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        quoteAsset: "fiat:usd",
      }),
      { stub: true },
    );
    await queryClient.setQueryData(queryKeys.wallets.tracked(369), { stub: true });

    const { result } = renderHook(() => usePricingStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Dashboard and wallet caches must remain untouched
    const dashboardData = queryClient.getQueryData(
      queryKeys.dashboard({
        schemaVersion: "v1",
        chainId: 369,
        walletAddress: "0x1111111111111111111111111111111111111111",
        quoteAsset: "fiat:usd",
      }),
    );
    expect(dashboardData).toEqual({ stub: true });

    const walletData = queryClient.getQueryData(queryKeys.wallets.tracked(369));
    expect(walletData).toEqual({ stub: true });
  });

  it("staleTime is 15_000 and gcTime is 5 minutes", () => {
    expect(PRICING_STATUS_STALE_TIME).toBe(15_000);
    expect(PRICING_STATUS_GC_TIME).toBe(5 * 60_000);
  });

  it("does not accept chainId in hook params", () => {
    type Params = Parameters<typeof usePricingStatusQuery>[0];
    // @ts-expect-error Pricing status hook is intentionally PulseChain-only for now.
    const invalidParams: Params = { chainId: 1 };
    expect(invalidParams).toBeDefined();
  });
});
