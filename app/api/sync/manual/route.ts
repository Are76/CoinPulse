import { ZodError } from "zod";

import { isOperationConflictError } from "@/services/operations/operation-lock";
import { runWalletSync } from "@/services/sync";
import {
  buildConflictResponse,
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  manualSyncRequestSchema,
  parseJsonBody,
  serializeForJson,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(manualSyncRequestSchema, request);
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    const result = await runWalletSync({
      wallet,
      sourceFamilies: input.sourceFamilies,
      startBlock: input.startBlock,
      endBlock: input.endBlock,
      policyLabel: input.policyLabel,
      trigger: "MANUAL",
    });

    return Response.json({ data: serializeForJson(result) });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    if (isOperationConflictError(error)) {
      return buildConflictResponse(error.code, error.message, error.details);
    }

    console.error("Manual sync route failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return buildInternalErrorResponse();
  }
}
