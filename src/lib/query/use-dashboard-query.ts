import { useQuery } from "@tanstack/react-query";

import { fetchPortfolioDashboard } from "@/lib/api/dashboard-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

const DASHBOARD_SCHEMA_VERSION = "v1" as const;

export type UseDashboardQueryParams = {
  walletAddress: string;
  chainId: number;
  quoteAsset?: string;
  asOf?: string | null;
  enabled?: boolean;
};

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
    staleTime: QUERY_DEFAULTS.dashboard.staleTime,
    gcTime: QUERY_DEFAULTS.dashboard.gcTime,
  });
}
