import { useQuery } from "@tanstack/react-query";

import { fetchDebugHealth } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_HEALTH_STALE_TIME = 15_000;
export const DEBUG_HEALTH_GC_TIME = 5 * 60_000;
export const DEBUG_HEALTH_REFETCH_INTERVAL = 30_000;

/**
 * Shared TanStack Query hook for the debug health DTO.
 *
 * Calls the existing debug client fetcher and uses the shared
 * queryKeys.debug.health() key. The hook never computes or infers backend
 * truth — it surfaces the backend DTO as-is. Deterministic API/client errors
 * are not retried.
 *
 * Polls every 30 seconds, matching the operator-screen cadence defined in
 * docs/data-fetching-architecture.md.
 */
export function useDebugHealthQuery() {
  return useQuery({
    queryKey: queryKeys.debug.health(),
    queryFn: fetchDebugHealth,
    retry: false,
    staleTime: DEBUG_HEALTH_STALE_TIME,
    gcTime: DEBUG_HEALTH_GC_TIME,
    refetchInterval: DEBUG_HEALTH_REFETCH_INTERVAL,
  });
}
