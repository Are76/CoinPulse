import { useQuery } from "@tanstack/react-query";

import { fetchPricingStatus } from "@/lib/api/prices-client";
import { queryKeys } from "@/lib/query/query-keys";

export const PRICING_STATUS_STALE_TIME = 15_000;
export const PRICING_STATUS_GC_TIME = 5 * 60_000;

export type UsePricingStatusQueryParams = {
  chainId?: number;
  enabled?: boolean;
};

/**
 * Shared TanStack Query hook for the pricing status DTO.
 *
 * Calls the prices client fetcher and surfaces the backend DTO/error as-is.
 * This hook is read-only and does not infer or compute pricing truth in the UI.
 */
export function usePricingStatusQuery({
  chainId = 369,
  enabled = true,
}: UsePricingStatusQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.prices.status(chainId),
    queryFn: fetchPricingStatus,
    enabled,
    retry: false,
    staleTime: PRICING_STATUS_STALE_TIME,
    gcTime: PRICING_STATUS_GC_TIME,
  });
}
