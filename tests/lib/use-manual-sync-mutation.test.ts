import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useManualSyncMutation } from "@/lib/query/use-manual-sync-mutation";

const SYNC_ARGS: Parameters<typeof debugClient.runManualSync>[0] = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  sourceFamilies: ["TRANSFERS", "DEX"],
  endBlock: "1000100",
  policyLabel: "frontend-debug",
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

describe("useManualSyncMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls runManualSync with the provided args", async () => {
    vi.spyOn(debugClient, "runManualSync").mockResolvedValue({
      data: { syncRuns: [] },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useManualSyncMutation(), { wrapper });

    act(() => {
      result.current.mutate(SYNC_ARGS);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(debugClient.runManualSync).toHaveBeenCalledWith(SYNC_ARGS, expect.anything());
  });

  it("invalidates debug/status and debug/health query keys after success", async () => {
    vi.spyOn(debugClient, "runManualSync").mockResolvedValue({
      data: { syncRuns: [] },
    });

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useManualSyncMutation(), { wrapper });

    act(() => {
      result.current.mutate(SYNC_ARGS);
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
    vi.spyOn(debugClient, "runManualSync").mockRejectedValue(
      new debugClient.ApiClientError({
        status: 409,
        code: "CONFLICT",
        message: "Sync already running.",
      }),
    );

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useManualSyncMutation(), { wrapper });

    act(() => {
      result.current.mutate(SYNC_ARGS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.status() }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.debug.health() }),
    );
  });

  it("does not invalidate dashboard query keys after sync", async () => {
    vi.spyOn(debugClient, "runManualSync").mockResolvedValue({
      data: { syncRuns: [] },
    });

    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useManualSyncMutation(), { wrapper });

    act(() => {
      result.current.mutate(SYNC_ARGS);
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
      message: "A sync is already running for this wallet.",
    });
    vi.spyOn(debugClient, "runManualSync").mockRejectedValue(conflictError);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useManualSyncMutation(), { wrapper });

    act(() => {
      result.current.mutate(SYNC_ARGS);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(conflictError);
    expect((result.current.error as debugClient.ApiClientError).message).toBe(
      "A sync is already running for this wallet.",
    );
  });
});
