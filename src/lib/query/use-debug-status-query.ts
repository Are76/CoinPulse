import { useQuery } from "@tanstack/react-query";

import { fetchDebugStatus } from "@/lib/api/debug-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export const DEBUG_STATUS_REFETCH_INTERVAL = 10_000;

export type UseDebugStatusQueryParams = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

export function useDebugStatusQuery({
  enabled = true,
  refetchInterval = DEBUG_STATUS_REFETCH_INTERVAL,
}: UseDebugStatusQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.debug.status(),
    queryFn: fetchDebugStatus,
    enabled,
    retry: false,
    staleTime: QUERY_DEFAULTS.debugStatus.staleTime,
    gcTime: QUERY_DEFAULTS.debugStatus.gcTime,
    refetchInterval,
  });
}
