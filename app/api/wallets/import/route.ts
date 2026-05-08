import { ZodError } from "zod";

import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseJsonBody,
  walletImportRequestSchema,
} from "@/services/api/validation";
import { importTrackedWallet, WalletImportError } from "@/services/api/wallets";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(walletImportRequestSchema, request);
    const wallet = await importTrackedWallet(input);

    return Response.json({ data: wallet });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    if (error instanceof WalletImportError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: 400 },
      );
    }
    return buildInternalErrorResponse();
  }
}
