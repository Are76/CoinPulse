import { useQuery } from "@tanstack/react-query";

import { fetchHexMiningEvidenceMissing } from "@/lib/api/hexmining-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseHexMiningEvidenceMissingQueryParams = {
  walletAddress?: string | null;
  chainId?: number;
  enabled?: boolean;
};

export function useHexMiningEvidenceMissingQuery({
  walletAddress,
  chainId = 369,
  enabled = true,
}: UseHexMiningEvidenceMissingQueryParams = {}) {
  const address = walletAddress ?? "";
  const normalizedAddress = address.trim().toLowerCase();

  return useQuery({
    queryKey: queryKeys.hexmining.evidenceMissing({ walletAddress: normalizedAddress, chainId }),
    queryFn: () =>
      fetchHexMiningEvidenceMissing({
        walletAddress: address.trim(),
        chainId,
      }),
    enabled: enabled && address.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.hexminingEvidenceMissing.staleTime,
    gcTime: QUERY_DEFAULTS.hexminingEvidenceMissing.gcTime,
  });
}
