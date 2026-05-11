import { useQuery } from "@tanstack/react-query";

import { fetchPricingStatus } from "@/lib/api/prices-client";
import { queryKeys } from "@/lib/query/query-keys";

export const PRICING_STATUS_STALE_TIME = 30_000;
export const PRICING_STATUS_GC_TIME = 10 * 60_000;

export type UsePricingStatusQueryParams = {
  enabled?: boolean;
};

/**
 * Shared TanStack Query hook for the pricing status DTO.
 *
 * Calls the prices client fetcher and surfaces the backend DTO/error as-is.
 * This hook is read-only and does not infer or compute pricing truth in the UI.
 */
export function usePricingStatusQuery({ enabled = true }: UsePricingStatusQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.prices.status(),
    queryFn: fetchPricingStatus,
    enabled,
    retry: false,
    staleTime: PRICING_STATUS_STALE_TIME,
    gcTime: PRICING_STATUS_GC_TIME,
  });
}
