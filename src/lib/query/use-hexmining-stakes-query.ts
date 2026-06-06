import { useQuery } from "@tanstack/react-query";

import { fetchHexMiningStakes } from "@/lib/api/hexmining-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseHexMiningStakesQueryParams = {
  walletAddress?: string | null;
  chainId?: number;
  enabled?: boolean;
};

export function useHexMiningStakesQuery({
  walletAddress,
  chainId = 369,
  enabled = true,
}: UseHexMiningStakesQueryParams = {}) {
  const address = walletAddress ?? "";
  const normalizedAddress = address.trim().toLowerCase();

  return useQuery({
    queryKey: queryKeys.hexmining.stakes({ walletAddress: normalizedAddress, chainId }),
    queryFn: () =>
      fetchHexMiningStakes({
        walletAddress: address.trim(),
        chainId,
      }),
    enabled: enabled && address.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.hexminingStakes.staleTime,
    gcTime: QUERY_DEFAULTS.hexminingStakes.gcTime,
  });
}
