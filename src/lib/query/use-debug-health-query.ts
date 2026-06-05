import { useQuery } from "@tanstack/react-query";

import { fetchDebugHealth } from "@/lib/api/debug-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_HEALTH_REFETCH_INTERVAL = 30_000;

export type UseDebugHealthQueryParams = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

export function useDebugHealthQuery({
  enabled = true,
  refetchInterval = DEBUG_HEALTH_REFETCH_INTERVAL,
}: UseDebugHealthQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.debug.health(),
    queryFn: fetchDebugHealth,
    enabled,
    retry: false,
    staleTime: QUERY_DEFAULTS.debugHealth.staleTime,
    gcTime: QUERY_DEFAULTS.debugHealth.gcTime,
    refetchInterval,
  });
}
