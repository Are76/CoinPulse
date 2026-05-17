import { useQuery } from "@tanstack/react-query";

import { fetchDebugHealth } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_HEALTH_STALE_TIME = 15_000;
export const DEBUG_HEALTH_GC_TIME = 5 * 60_000;
export const DEBUG_HEALTH_REFETCH_INTERVAL = 30_000;

export type UseDebugHealthQueryParams = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

/**
 * Shared TanStack Query hook for the debug health DTO.
 *
 * Calls the existing debug client fetcher and surfaces the backend DTO/error as-is.
 * This hook is read-only and does not infer or compute operational truth in the UI.
 */
export function useDebugHealthQuery({
  enabled = true,
  refetchInterval = DEBUG_HEALTH_REFETCH_INTERVAL,
}: UseDebugHealthQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.debug.health(),
    queryFn: fetchDebugHealth,
    enabled,
    retry: false,
    staleTime: DEBUG_HEALTH_STALE_TIME,
    gcTime: DEBUG_HEALTH_GC_TIME,
    refetchInterval,
  });
}
