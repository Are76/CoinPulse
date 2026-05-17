import { useQuery } from "@tanstack/react-query";

import { fetchDebugStatus } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_STATUS_STALE_TIME = 10_000;
export const DEBUG_STATUS_GC_TIME = 5 * 60_000;
export const DEBUG_STATUS_REFETCH_INTERVAL = 10_000;

export type UseDebugStatusQueryParams = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

/**
 * Shared TanStack Query hook for the debug status DTO.
 *
 * Calls the existing debug client fetcher and surfaces the backend DTO/error as-is.
 * This hook is read-only and does not infer or compute operational truth in the UI.
 */
export function useDebugStatusQuery({
  enabled = true,
  refetchInterval = DEBUG_STATUS_REFETCH_INTERVAL,
}: UseDebugStatusQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.debug.status(),
    queryFn: fetchDebugStatus,
    enabled,
    retry: false,
    staleTime: DEBUG_STATUS_STALE_TIME,
    gcTime: DEBUG_STATUS_GC_TIME,
    refetchInterval,
  });
}
