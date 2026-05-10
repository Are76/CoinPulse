import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as debugClient from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useWalletImportMutation } from "@/lib/query/use-wallet-import-mutation";

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

const IMPORT_ARGS: Parameters<typeof debugClient.importWallet>[0] = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "my-wallet",
};

const IMPORT_RESPONSE = {
  data: {
    id: "wallet-1",
  },
};

describe("useWalletImportMutation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the wallet import client with the exact args and invalidates debug metadata on success", async () => {
    vi.spyOn(debugClient, "importWallet").mockResolvedValue(IMPORT_RESPONSE);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWalletImportMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(IMPORT_ARGS)).resolves.toEqual(IMPORT_RESPONSE);
    });

    expect(debugClient.importWallet).toHaveBeenCalledWith(IMPORT_ARGS);
    expect(debugClient.importWallet).toHaveBeenCalledTimes(1);
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
      status: 400,
      code: "WALLET_ALREADY_TRACKED",
      message: "Wallet is already tracked.",
    });
    vi.spyOn(debugClient, "importWallet").mockRejectedValue(backendError);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWalletImportMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(IMPORT_ARGS)).rejects.toBe(backendError);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(backendError);
    expect((result.current.error as Error).message).toBe("Wallet is already tracked.");
    expect(debugClient.importWallet).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.status() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.debug.health() });
    expect(
      invalidateQueries.mock.calls.some(([filters]) =>
        Array.isArray(filters?.queryKey) && filters.queryKey[0] === "dashboard",
      ),
    ).toBe(false);
  });

  it("does not invalidate dashboard queries", async () => {
    vi.spyOn(debugClient, "importWallet").mockResolvedValue(IMPORT_RESPONSE);
    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWalletImportMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(IMPORT_ARGS);
    });

    expect(
      invalidateQueries.mock.calls.some(([filters]) =>
        Array.isArray(filters?.queryKey) && filters.queryKey[0] === "dashboard",
      ),
    ).toBe(false);
  });

  it("does not block the mutation result on debug metadata invalidation promises", async () => {
    vi.spyOn(debugClient, "importWallet").mockResolvedValue(IMPORT_RESPONSE);
    const { queryClient, Wrapper } = makeWrapper();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useWalletImportMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(IMPORT_ARGS)).resolves.toEqual(IMPORT_RESPONSE);
    });
  });
});
