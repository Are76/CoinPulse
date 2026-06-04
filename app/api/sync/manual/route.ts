import { ZodError } from "zod";

import { isOperationConflictError } from "@/services/operations/operation-lock";
import { runWalletSync } from "@/services/sync";
import { classifySyncError } from "@/services/sync/sync-error-classifier";
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

type ManualSyncRoutePhase = "parse_input" | "resolve_wallet" | "run_wallet_sync";

export async function POST(request: Request) {
  let phase: ManualSyncRoutePhase = "parse_input";

  try {
    const input = await parseJsonBody(manualSyncRequestSchema, request);

    phase = "resolve_wallet";
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    phase = "run_wallet_sync";
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

    // DEBUG TEMP
    console.error("DEBUG SYNC ERROR FULL:", error);
    console.error("Manual sync route failed", {
      route: "POST /api/sync/manual",
      phase,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCategory: classifySyncError(error),
    });

    return buildInternalErrorResponse();
  }
}
