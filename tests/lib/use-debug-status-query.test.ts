import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DEBUG_STATUS_GC_TIME,
  DEBUG_STATUS_REFETCH_INTERVAL,
  DEBUG_STATUS_STALE_TIME,
  useDebugStatusQuery,
} from "@/lib/query/use-debug-status-query";

const MOCK_STATUS: debugClient.DebugStatusReportDto = {
  status: "ok",
  timestamp: "2026-05-10T00:00:00.000Z",
  app: { env: "development" },
  supportedChains: [
    { chainId: 369, name: "PulseChain", nativeAssetId: "chain:369:native:PLS" },
  ],
  sourceFamilies: ["TRANSFERS", "DEX"],
  pricing: { persistedObservationsOnly: true, liveAdaptersEnabled: false },
};

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

function makeRetryingWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 3, retryDelay: 1 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useDebugStatusQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses queryKeys.debug.status() as the query key", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockResolvedValue(MOCK_STATUS);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useDebugStatusQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData(queryKeys.debug.status());
    expect(cached).toEqual(MOCK_STATUS);
  });

  it("calls fetchDebugStatus as the query function", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockResolvedValue(MOCK_STATUS);

    const { result } = renderHook(() => useDebugStatusQuery(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.fetchDebugStatus).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_STATUS);
  });

  it("does not retry on deterministic ApiClientError", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Backend is unavailable.",
      }),
    );

    const { result } = renderHook(() => useDebugStatusQuery(), {
      wrapper: makeRetryingWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(debugClient.fetchDebugStatus).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch errors through the query error state", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(() => useDebugStatusQuery(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Network error");
  });

  it("exports the expected staleTime, gcTime, and refetchInterval constants", () => {
    expect(DEBUG_STATUS_STALE_TIME).toBe(10_000);
    expect(DEBUG_STATUS_GC_TIME).toBe(5 * 60_000);
    expect(DEBUG_STATUS_REFETCH_INTERVAL).toBe(10_000);
  });
});
