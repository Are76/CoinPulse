import { useQuery } from "@tanstack/react-query";

import { fetchLiveHoldingsSnapshot } from "@/lib/api/live-snapshot-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseLiveSnapshotQueryParams = {
  walletAddress: string;
  chainId: number;
  quoteAsset?: string;
  enabled?: boolean;
};

export function useLiveSnapshotQuery({
  walletAddress,
  chainId,
  quoteAsset = "fiat:usd",
  enabled = true,
}: UseLiveSnapshotQueryParams) {
  return useQuery({
    queryKey: queryKeys.liveSnapshot({ chainId, walletAddress, quoteAsset }),
    queryFn: () => fetchLiveHoldingsSnapshot({ walletAddress: walletAddress.trim(), chainId, quoteAsset }),
    enabled: enabled && walletAddress.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.dashboard.staleTime,
    gcTime: QUERY_DEFAULTS.dashboard.gcTime,
  });
}
