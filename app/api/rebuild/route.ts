import { ZodError } from "zod";

import { runRebuildOperation } from "@/services/rebuild";
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

    const operation = await runRebuildOperation({
      wallet,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      sourceFamilies: input.sourceFamilies,
    });

    return Response.json({
      data: {
        rebuild: serializeForJson(operation.rebuild),
        materialized: serializeForJson(operation.materialized),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
