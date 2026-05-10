import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DEBUG_HEALTH_GC_TIME,
  DEBUG_HEALTH_REFETCH_INTERVAL,
  DEBUG_HEALTH_STALE_TIME,
  useDebugHealthQuery,
} from "@/lib/query/use-debug-health-query";

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

const MOCK_HEALTH = {
  status: "ok" as const,
  timestamp: "2026-01-01T00:00:00.000Z",
  app: { env: "test" },
  dependencies: {
    database: { status: "ready" as const },
    redis: { status: "unavailable" as const },
  },
};

describe("useDebugHealthQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches debug health with the shared debug health query key", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockResolvedValue(MOCK_HEALTH);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugHealthQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.fetchDebugHealth).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_HEALTH);

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.debug.health() });
    expect(query).toBeDefined();
    const queryOptions = query!.options as {
      queryKey?: unknown;
      staleTime?: unknown;
      gcTime?: unknown;
      refetchInterval?: unknown;
      retry?: unknown;
    };
    expect(queryOptions.queryKey).toEqual(queryKeys.debug.health());
    expect(queryOptions.staleTime).toBe(DEBUG_HEALTH_STALE_TIME);
    expect(queryOptions.gcTime).toBe(DEBUG_HEALTH_GC_TIME);
    expect(queryOptions.refetchInterval).toBe(DEBUG_HEALTH_REFETCH_INTERVAL);
    expect(queryOptions.retry).toBe(false);
  });

  it("does not fetch debug health when disabled", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockResolvedValue(MOCK_HEALTH);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugHealthQuery({ enabled: false }), {
      wrapper: Wrapper,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(debugClient.fetchDebugHealth).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("preserves backend-provided error messages and does not retry", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 503,
        code: "HEALTH_UNAVAILABLE",
        message: "Database is unavailable.",
      }),
    );
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDebugHealthQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(debugClient.fetchDebugHealth).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(debugClient.ApiClientError);
    expect((result.current.error as Error).message).toBe("Database is unavailable.");
  });
});
