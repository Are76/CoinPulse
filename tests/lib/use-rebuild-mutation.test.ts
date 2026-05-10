import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useRebuildMutation } from "@/lib/query/use-rebuild-mutation";

const REBUILD_ARGS: Parameters<typeof debugClient.runRebuild>[0] = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  sourceFamilies: ["LP", "STAKING"],
  fromBlock: "1000000",
  toBlock: "1000100",
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

describe("useRebuildMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls runRebuild with the provided args", async () => {
    vi.spyOn(debugClient, "runRebuild").mockResolvedValue({
      data: { rebuild: {} },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebuildMutation(), { wrapper });

    act(() => {
      result.current.mutate(REBUILD_ARGS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.runRebuild).toHaveBeenCalledWith(REBUILD_ARGS, expect.anything());
  });

  it("invalidates debug/status and debug/health query keys after success", async () => {
    vi.spyOn(debugClient, "runRebuild").mockResolvedValue({
      data: { rebuild: {} },
    });

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRebuildMutation(), { wrapper });

    act(() => {
      result.current.mutate(REBUILD_ARGS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.status() }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.health() }),
    );
  });

  it("invalidates debug/status and debug/health query keys after failure", async () => {
    vi.spyOn(debugClient, "runRebuild").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 409,
        code: "CONFLICT",
        message: "A rebuild is already running.",
      }),
    );

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRebuildMutation(), { wrapper });

    act(() => {
      result.current.mutate(REBUILD_ARGS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.status() }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.health() }),
    );
  });

  it("does not invalidate dashboard query keys after rebuild", async () => {
    vi.spyOn(debugClient, "runRebuild").mockResolvedValue({
      data: { rebuild: {} },
    });

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRebuildMutation(), { wrapper });

    act(() => {
      result.current.mutate(REBUILD_ARGS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledKeys = invalidate.mock.calls.map(
      (call) => (call[0] as { queryKey?: unknown }).queryKey,
    );
    const invalidatedDashboard = calledKeys.some(
      (key) => Array.isArray(key) && key[0] === "dashboard",
    );
    expect(invalidatedDashboard).toBe(false);
  });

  it("preserves the backend error message on conflict/failure", async () => {
    const conflictError = new debugClient.ApiClientError({
      status: 409,
      code: "CONFLICT",
      message: "A rebuild is already in progress for this wallet.",
    });
    vi.spyOn(debugClient, "runRebuild").mockRejectedValue(conflictError);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebuildMutation(), { wrapper });

    act(() => {
      result.current.mutate(REBUILD_ARGS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(conflictError);
    expect((result.current.error as debugClient.ApiClientError).message).toBe(
      "A rebuild is already in progress for this wallet.",
    );
  });
});
