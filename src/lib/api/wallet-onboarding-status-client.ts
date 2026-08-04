import type { WalletOnboardingStatusDto } from "@/services/operations/wallet-onboarding-status";

import { fetchJson, type ApiDataResponse } from "@/lib/api/api-client";

export type WalletOnboardingStatusResponseDto = {
  schemaVersion: "v1";
  wallet: {
    id: string;
    address: string;
    chainId: number;
  };
  onboarding: WalletOnboardingStatusDto;
};

export async function fetchWalletOnboardingStatus(args: {
  walletAddress: string;
  chainId: number;
}) {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId),
  });

  const response = await fetchJson<ApiDataResponse<WalletOnboardingStatusResponseDto>>(
    `/api/wallets/onboarding-status?${params.toString()}`,
  );

  return response.data;
}
