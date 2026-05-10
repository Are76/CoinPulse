import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useRebuildMutation } from "@/lib/query/use-rebuild-mutation";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: 3, retryDelay: 1 },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

const REBUILD_ARGS: Parameters<typeof debugClient.runRebuild>[0] = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  sourceFamilies: ["TRANSFERS", "DEX"],
  fromBlock: "100000",
  toBlock: "123456",
};

const REBUILD_RESPONSE = {
  data: {
    operationId: "rebuild-1",
  },
};

describe("useRebuildMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs rebuild with the existing debug client and invalidates debug metadata on success", async () => {
    vi.spyOn(debugClient, "runRebuild").mockResolvedValue(REBUILD_RESPONSE);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRebuildMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(REBUILD_ARGS)).resolves.toEqual(REBUILD_RESPONSE);
    });

    expect(debugClient.runRebuild).toHaveBeenCalledWith(REBUILD_ARGS);
    expect(debugClient.runRebuild).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.status() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.health() });
    expect(
      invalidateQueries.mock.calls.some(([filters]) =>
        Array.isArray(filters?.queryKey) && filters.queryKey[0] === "dashboard",
      ),
    ).toBe(false);
  });

  it("invalidates debug metadata and preserves backend errors on failure or conflict", async () => {
    const backendError = new debugClient.ApiClientError({
      status: 409,
      code: "OPERATION_CONFLICT",
      message: "A rebuild or sync is already running.",
    });
    vi.spyOn(debugClient, "runRebuild").mockRejectedValue(backendError);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRebuildMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(REBUILD_ARGS)).rejects.toBe(backendError);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(backendError);
    expect((result.current.error as Error).message).toBe("A rebuild or sync is already running.");
    expect(debugClient.runRebuild).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.status() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.health() });
    expect(
      invalidateQueries.mock.calls.some(([filters]) =>
        Array.isArray(filters?.queryKey) && filters.queryKey[0] === "dashboard",
      ),
    ).toBe(false);
  });

  it("does not block the mutation result on debug metadata invalidation promises", async () => {
    vi.spyOn(debugClient, "runRebuild").mockResolvedValue(REBUILD_RESPONSE);
    const { queryClient, Wrapper } = makeWrapper();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useRebuildMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(REBUILD_ARGS)).resolves.toEqual(REBUILD_RESPONSE);
    });
  });
});
