import { after } from "next/server";
import { ZodError } from "zod";

import {
  isOperationConflictError,
  previewOperationConflict,
  reserveOperationRun,
} from "@/services/operations/operation-lock";
import { runWalletSync } from "@/services/sync";
import { classifySyncError } from "@/services/sync/sync-error-classifier";
import {
  buildConflictResponse,
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  manualSyncRequestSchema,
  MANUAL_SYNC_MAX_BLOCK_SPAN,
  parseJsonBody,
  serializeForJson,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

type ManualSyncRoutePhase = "parse_input" | "resolve_wallet" | "dry_run_preview" | "reserve_run";

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

    if (input.mode === "dry-run") {
      phase = "dry_run_preview";
      // startBlock is guaranteed defined here — the schema's dry-run
      // refinement rejects an omitted startBlock before this code runs.
      const startBlock = input.startBlock as bigint;
      // Single timestamp shared by the response's generatedAt and the
      // conflict-staleness check below, so both describe the same instant.
      const now = new Date();
      const conflict = await previewOperationConflict({
        walletId: wallet.id,
        chainId: input.chainId,
        trigger: "MANUAL",
        now,
      });

      // The ingestion range is inclusive on both ends (the sync pipeline
      // scans every block from startBlock through endBlock), so a
      // startBlock === endBlock request scans exactly one block, not zero.
      // MANUAL_SYNC_MAX_BLOCK_SPAN caps endBlock - startBlock (the existing
      // execute-mode schema refinement in src/services/api/validation.ts),
      // which permits at most MANUAL_SYNC_MAX_BLOCK_SPAN + 1 inclusive
      // blocks — maxInclusiveBlockCount below makes that limit explicit so
      // requestedBlockCount can be compared directly against it.
      const requestedBlockCount = input.endBlock - startBlock + 1n;
      const maxInclusiveBlockCount = MANUAL_SYNC_MAX_BLOCK_SPAN + 1n;

      return Response.json({
        data: {
          mode: "dry-run" as const,
          wallet: { chainId: input.chainId, address: input.walletAddress },
          requestedRange: {
            startBlock: serializeForJson(startBlock),
            endBlock: serializeForJson(input.endBlock),
          },
          sourceFamilies: input.sourceFamilies,
          policyLabel: input.policyLabel,
          limits: {
            maxBlockSpan: serializeForJson(MANUAL_SYNC_MAX_BLOCK_SPAN),
            maxInclusiveBlockCount: serializeForJson(maxInclusiveBlockCount),
            requestedBlockCount: serializeForJson(requestedBlockCount),
          },
          executable: conflict.allowed,
          blockers: conflict.allowed ? [] : [conflict],
          generatedAt: now.toISOString(),
        },
      });
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
