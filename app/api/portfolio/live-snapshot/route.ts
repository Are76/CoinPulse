import { ZodError } from "zod";

import { assembleLiveHoldingsSnapshot, UnsupportedChainError } from "@/services/portfolio/live-holdings-snapshot";
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
    // Defense in depth: the request schema already rejects non-PulseChain
    // chain IDs, but a resolved wallet's stored chainId is a second,
    // independent source, so the assembler asserts it again.
    if (error instanceof UnsupportedChainError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 },
      );
    }
    return buildInternalErrorResponse();
  }
}
