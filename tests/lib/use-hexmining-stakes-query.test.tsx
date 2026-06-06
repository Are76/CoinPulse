import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as hexminingClient from "@/lib/api/hexmining-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";
import type { HexStakeListDto } from "@/services/hexmining/types";

// ── Wrapper helpers ───────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const OBSERVED_AT = "2026-06-06T00:00:00.000Z";

const EMPTY_STAKE_LIST: HexStakeListDto = {
  schemaVersion: "v1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakeSource: "native",
  stakes: [],
  totalCount: 0,
  isComplete: true,
  observedAtBlock: "12345678",
  observedAt: OBSERVED_AT,
  warnings: [],
};

const DEGRADED_DTO: HexStakeListDto = {
  schemaVersion: "v1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakeSource: "native",
  stakes: [],
  totalCount: 0,
  isComplete: false,
  observedAtBlock: null,
  observedAt: OBSERVED_AT,
  warnings: ["hexmining-provenance-block-unavailable"],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useHexMiningStakesQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Disabled states ───────────────────────────────────────────────────────

  it("does not fetch when walletAddress is undefined", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is null", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: null, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is an empty string", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: "", chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is whitespace only", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: "   ", chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () =>
        useHexMiningStakesQuery({
          walletAddress: WALLET_ADDRESS,
          chainId: CHAIN_ID,
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(hexminingClient.fetchHexMiningStakes).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  // ── Enabled state ─────────────────────────────────────────────────────────

  it("fetches when walletAddress is a non-empty string", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hexminingClient.fetchHexMiningStakes).toHaveBeenCalledOnce();
  });

  // ── API client call args ──────────────────────────────────────────────────

  it("calls fetchHexMiningStakes with trimmed walletAddress and chainId 369 by default", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hexminingClient.fetchHexMiningStakes).toHaveBeenCalledWith({
      walletAddress: WALLET_ADDRESS,
      chainId: 369,
    });
  });

  it("trims walletAddress whitespace before passing to fetchHexMiningStakes", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () =>
        useHexMiningStakesQuery({
          walletAddress: `  ${WALLET_ADDRESS}  `,
          chainId: CHAIN_ID,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hexminingClient.fetchHexMiningStakes).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: WALLET_ADDRESS }),
    );
  });

  it("forwards provided chainId to fetchHexMiningStakes", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: 1 }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hexminingClient.fetchHexMiningStakes).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1 }),
    );
  });

  // ── Query key ─────────────────────────────────────────────────────────────

  it("uses the shared hexmining.stakes query key with normalised address and chainId", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    const expectedKey = queryKeys.hexmining.stakes({
      walletAddress: WALLET_ADDRESS.toLowerCase(),
      chainId: CHAIN_ID,
    });

    renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    expect(cachedQuery.queryKey).toEqual(expectedKey);
  });

  it("normalises walletAddress to lowercase in the query key", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";

    renderHook(
      () => useHexMiningStakesQuery({ walletAddress: mixedCase, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    const params = (cachedQuery.queryKey as unknown[])[2] as Record<string, unknown>;
    expect(params.walletAddress).toBe(mixedCase.toLowerCase());
    expect(params.walletAddress).not.toBe(mixedCase);
  });

  it("includes chainId in the query key", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    const params = (cachedQuery.queryKey as unknown[])[2] as Record<string, unknown>;
    expect(params.chainId).toBe(CHAIN_ID);
  });

  // ── DTO passthrough ───────────────────────────────────────────────────────

  it("returns HexStakeListDto from API client unchanged", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(EMPTY_STAKE_LIST);
    expect(result.current.data?.schemaVersion).toBe("v1");
    expect(result.current.data?.stakeSource).toBe("native");
  });

  it("passes degraded reader DTO through without transformation", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(DEGRADED_DTO);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.isComplete).toBe(false);
    expect(result.current.data?.observedAtBlock).toBeNull();
    expect(result.current.data?.warnings).toContain("hexmining-provenance-block-unavailable");
  });

  it("does not derive pricing, valuation, pnl, or yield from the DTO", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data;
    expect(data).not.toHaveProperty("price");
    expect(data).not.toHaveProperty("valuation");
    expect(data).not.toHaveProperty("pnl");
    expect(data).not.toHaveProperty("yield");
    expect(data).not.toHaveProperty("estimatedYieldHex");
  });

  // ── Cache behaviour ───────────────────────────────────────────────────────

  it("staleTime and gcTime come from QUERY_DEFAULTS.hexminingStakes", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockResolvedValue(EMPTY_STAKE_LIST);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [q] = queryClient.getQueryCache().getAll();
    const opts = q.options as { staleTime?: unknown; gcTime?: unknown };
    expect(opts.staleTime).toBe(QUERY_DEFAULTS.hexminingStakes.staleTime);
    expect(opts.gcTime).toBe(QUERY_DEFAULTS.hexminingStakes.gcTime);
  });

  it("does not retry failed queries", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockRejectedValue(
      new hexminingClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      }),
    );

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hexminingClient.fetchHexMiningStakes).toHaveBeenCalledTimes(1);
  });

  // ── Error propagation ─────────────────────────────────────────────────────

  it("propagates ApiClientError through the query error state", async () => {
    vi.spyOn(hexminingClient, "fetchHexMiningStakes").mockRejectedValue(
      new hexminingClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      }),
    );

    const { result } = renderHook(
      () => useHexMiningStakesQuery({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(hexminingClient.ApiClientError);
    expect((result.current.error as hexminingClient.ApiClientError).code).toBe("INTERNAL_ERROR");
  });
});
