import { ZodError } from "zod";

import { runWalletSync } from "@/services/sync";
import {
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
    return buildInternalErrorResponse();
  }
}
