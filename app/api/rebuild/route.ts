import { after } from "next/server";
import { ZodError } from "zod";

import { isOperationConflictError, reserveOperationRun } from "@/services/operations/operation-lock";
import { runRebuildOperation } from "@/services/rebuild";
import { classifySyncError } from "@/services/sync/sync-error-classifier";
import {
  buildConflictResponse,
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  parseJsonBody,
  rebuildRequestSchema,
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

    // Reserve the SyncRun record now so the runId is available immediately.
    const run = await reserveOperationRun({
      walletId: wallet.id,
      chainId: input.chainId,
      trigger: "REBUILD",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: input.sourceFamilies,
      startBlock: input.fromBlock,
      endBlock: input.toBlock,
      policyLabel: "manual-rebuild",
    });

    // Run the rebuild pipeline after the response is sent so the caller
    // receives the runId immediately without waiting for the full rebuild.
    after(async () => {
      try {
        await runRebuildOperation({
          wallet,
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
          sourceFamilies: input.sourceFamilies,
          // Skip the second reservation — the run already exists.
          dependencies: { reserveOperationRun: async () => ({ id: run.id }) },
        });
      } catch (error) {
        // runRebuildOperation already marks the SyncRun as FAILED; log for ops visibility.
        console.error("Async rebuild failed after 202 response", {
          route: "POST /api/rebuild",
          runId: run.id,
          errorName: error instanceof Error ? error.name : typeof error,
          errorCategory: classifySyncError(error),
        });
      }
    });

    return Response.json({ data: { runId: run.id } }, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    if (isOperationConflictError(error)) {
      return buildConflictResponse(error.code, error.message, error.details);
    }
    return buildInternalErrorResponse();
  }
}
