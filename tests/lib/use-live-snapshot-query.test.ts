import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";

vi.mock("@/lib/api/live-snapshot-client", () => ({
  fetchLiveHoldingsSnapshot: vi.fn(),
}));

import { fetchLiveHoldingsSnapshot } from "@/lib/api/live-snapshot-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import { useLiveSnapshotQuery } from "@/lib/query/use-live-snapshot-query";

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function makeQueryClientWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, Wrapper };
}

describe("useLiveSnapshotQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the snapshot when enabled with a non-empty wallet address", async () => {
    vi.mocked(fetchLiveHoldingsSnapshot).mockResolvedValue({ schemaVersion: "v1" } as never);

    const { result } = renderHook(
      () => useLiveSnapshotQuery({ walletAddress: "0x1111111111111111111111111111111111111111", chainId: 369 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchLiveHoldingsSnapshot).toHaveBeenCalledWith({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      quoteAsset: "fiat:usd",
    });
  });

  it("does not fetch when disabled", () => {
    const { result } = renderHook(
      () =>
        useLiveSnapshotQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          enabled: false,
        }),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchLiveHoldingsSnapshot).not.toHaveBeenCalled();
  });

  it("does not fetch when walletAddress is empty", async () => {
    const { result } = renderHook(
      () => useLiveSnapshotQuery({ walletAddress: "", chainId: 369 }),
      { wrapper },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(fetchLiveHoldingsSnapshot).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is whitespace only", async () => {
    const { result } = renderHook(
      () => useLiveSnapshotQuery({ walletAddress: "   ", chainId: 369 }),
      { wrapper },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(fetchLiveHoldingsSnapshot).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("uses the exact shared live-snapshot query key and cache lifetimes", async () => {
    vi.mocked(fetchLiveHoldingsSnapshot).mockResolvedValue({ schemaVersion: "v1" } as never);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const expectedQueryKey = queryKeys.liveSnapshot({
      chainId: 369,
      walletAddress: "0x1111111111111111111111111111111111111111",
      quoteAsset: "fiat:usd",
    });

    const { result } = renderHook(
      () =>
        useLiveSnapshotQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey: expectedQueryKey });
    expect(matchingQueries).toHaveLength(1);
    const cacheOptions = matchingQueries[0].options as { gcTime?: unknown; staleTime?: unknown };
    expect(cacheOptions.staleTime).toBe(QUERY_DEFAULTS.dashboard.staleTime);
    expect(cacheOptions.gcTime).toBe(QUERY_DEFAULTS.dashboard.gcTime);
  });
});
