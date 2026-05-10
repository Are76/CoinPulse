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

const MOCK_HEALTH: debugClient.HealthReportDto = {
  status: "ok",
  timestamp: "2026-05-10T00:00:00.000Z",
  app: { env: "development" },
  dependencies: {
    database: { status: "ready" },
    redis: { status: "ready" },
  },
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

describe("useDebugHealthQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses queryKeys.debug.health() as the query key", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockResolvedValue(MOCK_HEALTH);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useDebugHealthQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData(queryKeys.debug.health());
    expect(cached).toEqual(MOCK_HEALTH);
  });

  it("calls fetchDebugHealth as the query function", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockResolvedValue(MOCK_HEALTH);

    const { result } = renderHook(() => useDebugHealthQuery(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.fetchDebugHealth).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_HEALTH);
  });

  it("does not retry on deterministic ApiClientError", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Backend is unavailable.",
      }),
    );

    const { result } = renderHook(() => useDebugHealthQuery(), {
      wrapper: makeRetryingWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(debugClient.fetchDebugHealth).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch errors through the query error state", async () => {
    vi.spyOn(debugClient, "fetchDebugHealth").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(() => useDebugHealthQuery(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Network error");
  });

  it("exports the expected staleTime, gcTime, and refetchInterval constants", () => {
    expect(DEBUG_HEALTH_STALE_TIME).toBe(15_000);
    expect(DEBUG_HEALTH_GC_TIME).toBe(5 * 60_000);
    expect(DEBUG_HEALTH_REFETCH_INTERVAL).toBe(30_000);
  });
});
