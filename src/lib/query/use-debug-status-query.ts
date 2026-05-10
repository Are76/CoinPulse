import { useQuery } from "@tanstack/react-query";

import { fetchDebugStatus } from "@/lib/api/debug-client";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_STATUS_STALE_TIME = 10_000;
export const DEBUG_STATUS_GC_TIME = 5 * 60_000;
export const DEBUG_STATUS_REFETCH_INTERVAL = 10_000;

/**
 * Shared TanStack Query hook for the debug status DTO.
 *
 * Calls the existing debug client fetcher and uses the shared
 * queryKeys.debug.status() key. The hook never computes or infers backend
 * truth — it surfaces the backend DTO as-is. Deterministic API/client errors
 * are not retried.
 *
 * Polls every 10 seconds, matching the operator-screen cadence defined in
 * docs/data-fetching-architecture.md.
 */
export function useDebugStatusQuery() {
  return useQuery({
    queryKey: queryKeys.debug.status(),
    queryFn: fetchDebugStatus,
    retry: false,
    staleTime: DEBUG_STATUS_STALE_TIME,
    gcTime: DEBUG_STATUS_GC_TIME,
    refetchInterval: DEBUG_STATUS_REFETCH_INTERVAL,
  });
}
