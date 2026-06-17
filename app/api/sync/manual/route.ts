import { after } from "next/server";
import { ZodError } from "zod";

import { isOperationConflictError, reserveOperationRun } from "@/services/operations/operation-lock";
import { runWalletSync } from "@/services/sync";
import { classifySyncError } from "@/services/sync/sync-error-classifier";
import {
  buildConflictResponse,
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  manualSyncRequestSchema,
  parseJsonBody,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

type ManualSyncRoutePhase = "parse_input" | "resolve_wallet" | "reserve_run";

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

    // Reserve the SyncRun record now so the runId is available immediately.
    // startBlock defaults to 0n when not supplied; the orchestrator overwrites it
    // with the cursor-derived value once the run transitions to RUNNING.
    phase = "reserve_run";
    const run = await reserveOperationRun({
      walletId: wallet.id,
      chainId: input.chainId,
      trigger: "MANUAL",
      status: "PENDING",
      stage: "PENDING",
      sourceFamilies: input.sourceFamilies,
      startBlock: input.startBlock ?? 0n,
      endBlock: input.endBlock,
      policyLabel: input.policyLabel,
    });

    // Run the ingestion pipeline after the response is sent so the caller
    // receives the runId immediately without waiting for RPC round-trips.
    after(async () => {
      try {
        await runWalletSync({
          wallet,
          sourceFamilies: input.sourceFamilies,
          startBlock: input.startBlock,
          endBlock: input.endBlock,
          policyLabel: input.policyLabel,
          trigger: "MANUAL",
          // Skip the second reservation — the run already exists.
          dependencies: { reserveOperationRun: async () => ({ id: run.id }) },
        });
      } catch (error) {
        // runWalletSync already marks the SyncRun as FAILED; log for ops visibility.
        console.error("Async manual sync failed after 202 response", {
          route: "POST /api/sync/manual",
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

    console.error("Manual sync route failed during reservation", {
      route: "POST /api/sync/manual",
      phase,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCategory: classifySyncError(error),
    });

    return buildInternalErrorResponse();
  }
}
