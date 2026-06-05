import { useQuery } from "@tanstack/react-query";

import { fetchPricingStatus } from "@/lib/api/prices-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UsePricingStatusQueryParams = {
  enabled?: boolean;
};

export function usePricingStatusQuery({
  enabled = true,
}: UsePricingStatusQueryParams = {}) {
  return useQuery({
    // Pricing status is PulseChain-only until backend route/DTO accepts chain scope.
    queryKey: queryKeys.prices.status(369),
    queryFn: fetchPricingStatus,
    enabled,
    retry: false,
    staleTime: QUERY_DEFAULTS.pricesStatus.staleTime,
    gcTime: QUERY_DEFAULTS.pricesStatus.gcTime,
  });
}
