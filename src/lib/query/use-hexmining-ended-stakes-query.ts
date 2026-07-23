import { useQuery } from "@tanstack/react-query";

import { fetchHexMiningEndedStakes } from "@/lib/api/hexmining-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseHexMiningEndedStakesQueryParams = {
  walletAddress?: string | null;
  chainId?: number;
  enabled?: boolean;
};

export function useHexMiningEndedStakesQuery({
  walletAddress,
  chainId = 369,
  enabled = true,
}: UseHexMiningEndedStakesQueryParams = {}) {
  const address = walletAddress ?? "";
  const normalizedAddress = address.trim().toLowerCase();

  return useQuery({
    queryKey: queryKeys.hexmining.endedStakes({ walletAddress: normalizedAddress, chainId }),
    queryFn: () =>
      fetchHexMiningEndedStakes({
        walletAddress: address.trim(),
        chainId,
      }),
    enabled: enabled && address.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.hexminingEndedStakes.staleTime,
    gcTime: QUERY_DEFAULTS.hexminingEndedStakes.gcTime,
  });
}
