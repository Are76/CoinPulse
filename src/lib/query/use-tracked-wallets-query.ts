import { useQuery } from "@tanstack/react-query";

import { fetchTrackedWallets } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

export const TRACKED_WALLETS_STALE_TIME = 30_000;
export const TRACKED_WALLETS_GC_TIME = 10 * 60_000;

export type UseTrackedWalletsQueryParams = {
  chainId?: number;
  enabled?: boolean;
};

/**
 * Shared TanStack Query hook for the tracked wallets DTO.
 *
 * Calls the existing debug client fetcher and surfaces the backend DTO/error as-is.
 * This hook is read-only and does not infer or compute portfolio truth in the UI.
 *
 * chainId is included in the query key for future chain-filtering compatibility.
 * The backend route does not currently filter by chainId, so no query param is sent.
 */
export function useTrackedWalletsQuery({
  chainId = 369,
  enabled = true,
}: UseTrackedWalletsQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.wallets.tracked(chainId),
    queryFn: fetchTrackedWallets,
    enabled,
    retry: false,
    staleTime: TRACKED_WALLETS_STALE_TIME,
    gcTime: TRACKED_WALLETS_GC_TIME,
  });
}
