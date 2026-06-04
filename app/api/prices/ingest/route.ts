import { ZodError } from "zod";

import { runPriceIngestion } from "@/services/pricing/price-ingestion";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseJsonBody,
  priceIngestRequestSchema,
  serializeForJson,
} from "@/services/api/validation";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(priceIngestRequestSchema, request);

    const result = await runPriceIngestion({
      chainId: input.chainId,
      blockNumber: input.blockNumber,
      observedAt: input.observedAt,
      assets: input.assets,
    });

    return Response.json({
      data: {
        schemaVersion: "v1" as const,
        ...serializeForJson(result),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }

    logError("Price ingest route failed", {
      route: "POST /api/prices/ingest",
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return buildInternalErrorResponse();
  }
}
