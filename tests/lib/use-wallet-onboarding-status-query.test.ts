import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";

vi.mock("@/lib/api/wallet-onboarding-status-client", () => ({
  fetchWalletOnboardingStatus: vi.fn(),
}));

import { fetchWalletOnboardingStatus } from "@/lib/api/wallet-onboarding-status-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import { useWalletOnboardingStatusQuery } from "@/lib/query/use-wallet-onboarding-status-query";

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

describe("useWalletOnboardingStatusQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches onboarding status when enabled with a non-empty wallet address", async () => {
    vi.mocked(fetchWalletOnboardingStatus).mockResolvedValue({ schemaVersion: "v1" } as never);

    const { result } = renderHook(
      () =>
        useWalletOnboardingStatusQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchWalletOnboardingStatus).toHaveBeenCalledWith({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
  });

  it("does not fetch when disabled", () => {
    const { result } = renderHook(
      () =>
        useWalletOnboardingStatusQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          enabled: false,
        }),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchWalletOnboardingStatus).not.toHaveBeenCalled();
  });

  it("does not fetch when walletAddress is empty", async () => {
    const { result } = renderHook(
      () => useWalletOnboardingStatusQuery({ walletAddress: "", chainId: 369 }),
      { wrapper },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(fetchWalletOnboardingStatus).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("uses the exact shared onboarding-status query key and cache lifetimes", async () => {
    vi.mocked(fetchWalletOnboardingStatus).mockResolvedValue({ schemaVersion: "v1" } as never);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const expectedQueryKey = queryKeys.wallets.onboardingStatus({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });

    const { result } = renderHook(
      () =>
        useWalletOnboardingStatusQuery({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey: expectedQueryKey });
    expect(matchingQueries).toHaveLength(1);
    const cacheOptions = matchingQueries[0].options as { gcTime?: unknown; staleTime?: unknown };
    expect(cacheOptions.staleTime).toBe(QUERY_DEFAULTS.walletOnboardingStatus.staleTime);
    expect(cacheOptions.gcTime).toBe(QUERY_DEFAULTS.walletOnboardingStatus.gcTime);
  });
});
