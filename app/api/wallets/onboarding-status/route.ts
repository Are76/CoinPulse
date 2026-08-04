import { ZodError } from "zod";

import { getWalletOnboardingStatus } from "@/services/operations/wallet-onboarding-status";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  parseSearchParams,
  walletOnboardingStatusRequestSchema,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

export async function GET(request: Request) {
  try {
    const input = parseSearchParams(walletOnboardingStatusRequestSchema, request);
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    const onboarding = await getWalletOnboardingStatus({
      walletId: wallet.id,
      chainId: wallet.chainId,
    });

    return Response.json({
      data: {
        schemaVersion: "v1",
        wallet,
        onboarding,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
