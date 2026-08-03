import { ZodError } from "zod";

import { assembleLiveHoldingsSnapshot } from "@/services/portfolio/live-holdings-snapshot";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  buildNotFoundResponse,
  liveSnapshotRequestSchema,
  parseSearchParams,
} from "@/services/api/validation";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";

export async function GET(request: Request) {
  try {
    const input = parseSearchParams(liveSnapshotRequestSchema, request);
    const wallet = await resolveTrackedWalletByAddress({
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    if (!wallet) {
      return buildNotFoundResponse("WALLET_NOT_FOUND", "Wallet not found for the requested chain.");
    }

    const snapshot = await assembleLiveHoldingsSnapshot({
      wallet: { address: wallet.address, chainId: wallet.chainId },
      quoteAsset: input.quoteAsset,
      asOf: new Date(),
    });

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
