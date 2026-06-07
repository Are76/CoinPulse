import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DEBUG_STATUS_REFETCH_INTERVAL,
  useDebugStatusQuery,
} from "@/lib/query/use-debug-status-query";

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

const MOCK_STATUS = {
  status: "ok" as const,
  timestamp: "2026-01-01T00:00:00.000Z",
  app: { env: "test" },
  supportedChains: [
    {
      chainId: 369,
      name: "PulseChain",
      nativeAssetId: "native:pulsechain:pls",
    },
  ],
  sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING", "NATIVE"],
  pricing: {
    persistedObservationsOnly: true as const,
    liveAdaptersEnabled: false as const,
  },
  hexMining: {
    observationStatus: {
      schemaVersion: "v1" as const,
      chainId: 369,
      sourceFamily: "HEXMINING" as const,
      status: "missing" as const,
      asOf: "2026-01-01T00:00:00.000Z",
      latestObservation: null,
      provenance: {
        source: "rawHexDailyDataObservation" as const,
        storage: "postgres" as const,
      },
      warnings: [],
    },
  },
};

describe("useDebugStatusQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches debug status with the shared debug status query key", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockResolvedValue(MOCK_STATUS);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.fetchDebugStatus).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_STATUS);

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.debug.status() });
    expect(query).toBeDefined();
    const queryOptions = query!.options as {
      queryKey?: unknown;
      staleTime?: unknown;
      gcTime?: unknown;
      refetchInterval?: unknown;
      retry?: unknown;
    };
    expect(queryOptions.queryKey).toEqual(queryKeys.debug.status());
    expect(queryOptions.staleTime).toBe(QUERY_DEFAULTS.debugStatus.staleTime);
    expect(queryOptions.gcTime).toBe(QUERY_DEFAULTS.debugStatus.gcTime);
    expect(queryOptions.refetchInterval).toBe(DEBUG_STATUS_REFETCH_INTERVAL);
    expect(queryOptions.retry).toBe(false);
  });

  it("allows polling to be disabled for dashboard metadata", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockResolvedValue(MOCK_STATUS);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugStatusQuery({ refetchInterval: false }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.debug.status() });
    expect(query).toBeDefined();
    const queryOptions = query!.options as { refetchInterval?: unknown };
    expect(queryOptions.refetchInterval).toBe(false);
  });

  it("does not fetch debug status when disabled", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockResolvedValue(MOCK_STATUS);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugStatusQuery({ enabled: false }), {
      wrapper: Wrapper,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(debugClient.fetchDebugStatus).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("preserves backend-provided error messages and does not retry", async () => {
    vi.spyOn(debugClient, "fetchDebugStatus").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 503,
        code: "DEBUG_STATUS_UNAVAILABLE",
        message: "Operation metadata is unavailable.",
      }),
    );
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugStatusQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(debugClient.fetchDebugStatus).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(debugClient.ApiClientError);
    expect((result.current.error as Error).message).toBe("Operation metadata is unavailable.");
  });
});
