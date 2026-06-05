import { useQuery } from "@tanstack/react-query";

import { fetchTrackedWallets } from "@/lib/api/debug-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseTrackedWalletsQueryParams = {
  chainId?: number;
  enabled?: boolean;
};

// chainId is included in the query key for future chain-filtering compatibility.
// The backend route does not currently filter by chainId, so no query param is sent.
export function useTrackedWalletsQuery({
  chainId = 369,
  enabled = true,
}: UseTrackedWalletsQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.wallets.tracked(chainId),
    queryFn: fetchTrackedWallets,
    enabled,
    retry: false,
    staleTime: QUERY_DEFAULTS.wallets.staleTime,
    gcTime: QUERY_DEFAULTS.wallets.gcTime,
  });
}
