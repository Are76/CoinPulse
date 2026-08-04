import { useQuery } from "@tanstack/react-query";

import { fetchWalletOnboardingStatus } from "@/lib/api/wallet-onboarding-status-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

export type UseWalletOnboardingStatusQueryParams = {
  walletAddress: string;
  chainId: number;
  enabled?: boolean;
};

export function useWalletOnboardingStatusQuery({
  walletAddress,
  chainId,
  enabled = true,
}: UseWalletOnboardingStatusQueryParams) {
  return useQuery({
    queryKey: queryKeys.wallets.onboardingStatus({ walletAddress, chainId }),
    queryFn: () => fetchWalletOnboardingStatus({ walletAddress: walletAddress.trim(), chainId }),
    enabled: enabled && walletAddress.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.walletOnboardingStatus.staleTime,
    gcTime: QUERY_DEFAULTS.walletOnboardingStatus.gcTime,
  });
}
