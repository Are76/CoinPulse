import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as hexminingClient from "@/lib/api/hexmining-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import { useHexMiningEndedStakesQuery } from "@/lib/query/use-hexmining-ended-stakes-query";
import type { EndedHexStakeListDto } from "@/services/hexmining/types";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, Wrapper };
}

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;

const EMPTY_ENDED_LIST: EndedHexStakeListDto = {
  schemaVersion: "v1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakes: [],
  totalCount: 0,
  isComplete: true,
  warnings: [],
};

const INCOMPLETE_LIST: EndedHexStakeListDto = {
  ...EMPTY_ENDED_LIST,
  isComplete: false,
  warnings: ["ended-stake-locked-day-unavailable"],
};

describe("useHexMiningEndedStakesQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch when walletAddress is absent", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);

    const { result } = renderHook(
      () => useHexMiningEndedStakesQuery({ chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningEndedStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is whitespace only", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);

    const { result } = renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: "   ", chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningEndedStakes).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);

    renderHook(
      () =>
        useHexMiningEndedStakesQuery({
          walletAddress: WALLET_ADDRESS,
          chainId: CHAIN_ID,
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningEndedStakes).not.toHaveBeenCalled();
  });

  it("fetches with trimmed walletAddress and chainId 369 by default", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);

    const { result } = renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: `  ${WALLET_ADDRESS}  ` }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hexminingClient.fetchHexMiningEndedStakes).toHaveBeenCalledWith({
      walletAddress: WALLET_ADDRESS,
      chainId: 369,
    });
  });

  it("uses the shared hexmining.endedStakes query key with normalised address and chainId", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    const expectedKey = queryKeys.hexmining.endedStakes({
      walletAddress: WALLET_ADDRESS.toLowerCase(),
      chainId: CHAIN_ID,
    });

    renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    expect(cachedQuery.queryKey).toEqual(expectedKey);
  });

  it("normalises walletAddress to lowercase in the query key", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";

    renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: mixedCase, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    const params = (cachedQuery.queryKey as unknown[])[2] as Record<string, unknown>;
    expect(params.walletAddress).toBe(mixedCase.toLowerCase());
    expect(params.chainId).toBe(CHAIN_ID);
  });

  it("passes incomplete DTO through without transformation", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(INCOMPLETE_LIST);

    const { result } = renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(INCOMPLETE_LIST);
    expect(result.current.data?.isComplete).toBe(false);
    expect(result.current.data?.warnings).toContain("ended-stake-locked-day-unavailable");
  });

  it("staleTime and gcTime come from QUERY_DEFAULTS.hexminingEndedStakes", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockResolvedValue(EMPTY_ENDED_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [q] = queryClient.getQueryCache().getAll();
    const opts = q.options as { staleTime?: unknown; gcTime?: unknown };
    expect(opts.staleTime).toBe(QUERY_DEFAULTS.hexminingEndedStakes.staleTime);
    expect(opts.gcTime).toBe(QUERY_DEFAULTS.hexminingEndedStakes.gcTime);
  });

  it("does not retry failed queries and propagates ApiClientError", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningEndedStakes").mockRejectedValue(
      new hexminingClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      }),
    );

    const { result } = renderHook(
      () => useHexMiningEndedStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hexminingClient.fetchHexMiningEndedStakes).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(hexminingClient.ApiClientError);
    expect((result.current.error as hexminingClient.ApiClientError).code).toBe("INTERNAL_ERROR");
  });
});
