import { useQuery } from "@tanstack/react-query";

import { fetchPortfolioDashboard } from "@/lib/api/dashboard-client";
import { queryKeys } from "@/lib/query/query-keys";

const DASHBOARD_SCHEMA_VERSION = "v1" as const;
export const DASHBOARD_STALE_TIME = 30_000;
export const DASHBOARD_GC_TIME = 10 * 60_000;

export type UseDashboardQueryParams = {
  walletAddress: string;
  chainId: number;
  quoteAsset?: string;
  asOf?: string | null;
  enabled?: boolean;
};

/**
 * Shared TanStack Query hook for the portfolio dashboard DTO.
 *
 * Calls the existing dashboard client fetcher and uses the shared dashboard
 * query key (including schemaVersion, chainId, walletAddress, quoteAsset, and
 * optional asOf). The hook never computes balances, prices, or PnL — it only
 * surfaces the versioned backend DTO as-is.
 *
 * The fetch is skipped automatically when walletAddress is empty or when
 * `enabled` is set to false.
 */
export function useDashboardQuery({
  walletAddress,
  chainId,
  quoteAsset = "fiat:usd",
  asOf,
  enabled = true,
}: UseDashboardQueryParams) {
  return useQuery({
    queryKey: queryKeys.dashboard({
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      chainId,
      walletAddress,
      quoteAsset,
      asOf,
    }),
    queryFn: () =>
      fetchPortfolioDashboard({
        walletAddress: walletAddress.trim(),
        chainId,
        quoteAsset,
        asOf,
      }),
    enabled: enabled && walletAddress.trim().length > 0,
    retry: false,
    staleTime: DASHBOARD_STALE_TIME,
    gcTime: DASHBOARD_GC_TIME,
  });
}
