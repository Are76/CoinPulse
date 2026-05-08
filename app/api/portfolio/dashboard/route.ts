import { ZodError } from "zod";

import { assemblePortfolioDashboard } from "@/services/dashboard";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  dashboardRequestSchema,
  parseSearchParams,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

export async function GET(request: Request) {
  try {
    const input = parseSearchParams(dashboardRequestSchema, request);
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    const dashboard = await assemblePortfolioDashboard({
      wallet,
      quoteAsset: input.quoteAsset,
      asOf: input.asOf ?? new Date(),
    });

    return Response.json({ data: dashboard });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
