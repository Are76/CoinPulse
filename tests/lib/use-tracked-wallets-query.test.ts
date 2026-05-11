import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import {
  TRACKED_WALLETS_GC_TIME,
  TRACKED_WALLETS_STALE_TIME,
  useTrackedWalletsQuery,
} from "@/lib/query/use-tracked-wallets-query";

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

const MOCK_TRACKED_WALLETS: debugClient.TrackedWalletsDto = {
  schemaVersion: "v1",
  wallets: [
    {
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      label: "Main Wallet",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    },
  ],
};

describe("useTrackedWalletsQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches tracked wallets using the default chain ID query key (369)", async () => {
    vi.spyOn(debugClient, "fetchTrackedWallets").mockResolvedValue(MOCK_TRACKED_WALLETS);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTrackedWalletsQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.fetchTrackedWallets).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(MOCK_TRACKED_WALLETS);

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.wallets.tracked(369) });
    expect(query).toBeDefined();
    const queryOptions = query!.options as {
      queryKey?: unknown;
      staleTime?: unknown;
      gcTime?: unknown;
      retry?: unknown;
    };
    expect(queryOptions.queryKey).toEqual(queryKeys.wallets.tracked(369));
    expect(queryOptions.staleTime).toBe(TRACKED_WALLETS_STALE_TIME);
    expect(queryOptions.gcTime).toBe(TRACKED_WALLETS_GC_TIME);
    expect(queryOptions.retry).toBe(false);
  });

  it("uses a custom chainId in the query key when provided", async () => {
    vi.spyOn(debugClient, "fetchTrackedWallets").mockResolvedValue(MOCK_TRACKED_WALLETS);
    const { queryClient, Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTrackedWalletsQuery({ chainId: 1 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.wallets.tracked(1) });
    expect(query).toBeDefined();
    const queryOptions = query!.options as { queryKey?: unknown };
    expect(queryOptions.queryKey).toEqual(queryKeys.wallets.tracked(1));

    const defaultQuery = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.wallets.tracked(369) });
    expect(defaultQuery).toBeUndefined();
  });

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(debugClient, "fetchTrackedWallets").mockResolvedValue(MOCK_TRACKED_WALLETS);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTrackedWalletsQuery({ enabled: false }), {
      wrapper: Wrapper,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(debugClient.fetchTrackedWallets).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("preserves backend ApiClientError messages and does not retry", async () => {
    vi.spyOn(debugClient, "fetchTrackedWallets").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      }),
    );
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useTrackedWalletsQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(debugClient.fetchTrackedWallets).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(debugClient.ApiClientError);
    expect((result.current.error as Error).message).toBe("Internal server error.");
  });
});
