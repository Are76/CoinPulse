import { ZodError } from "zod";

import { materializeCurrentPortfolioPositions } from "@/services/portfolio";
import { rebuildCanonicalLedger } from "@/services/rebuild";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  parseJsonBody,
  rebuildRequestSchema,
  serializeForJson,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(rebuildRequestSchema, request);
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    const rebuild = await rebuildCanonicalLedger({
      wallet,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      sourceFamilies: input.sourceFamilies,
    });
    const materialized = await materializeCurrentPortfolioPositions({
      wallet,
    });

    return Response.json({
      data: {
        rebuild: serializeForJson(rebuild),
        materialized: serializeForJson(materialized),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
