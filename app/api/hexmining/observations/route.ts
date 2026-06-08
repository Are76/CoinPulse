import "server-only";

import { z, ZodError } from "zod";

import { createPublicClientForChain } from "@/services/chains/public-client";
import { acquireAndPersistHexDailyDataObservation } from "@/services/hexmining/daily-data-observation-service";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseJsonBody,
} from "@/services/api/validation";

const observationCreateSchema = z
  .object({
    rangeStartDay: z
      .number()
      .int("rangeStartDay must be an integer.")
      .min(0, "rangeStartDay must be >= 0."),
    rangeEndDay: z
      .number()
      .int("rangeEndDay must be an integer.")
      .min(0, "rangeEndDay must be >= 0."),
    rpcEndpointLabel: z.string().nullable().optional(),
  })
  .refine((data) => data.rangeEndDay >= data.rangeStartDay, {
    path: ["rangeEndDay"],
    message: "rangeEndDay must be >= rangeStartDay.",
  });

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(observationCreateSchema, request);
    const publicClient = createPublicClientForChain() as unknown as HexMiningReadClient;

    const result = await acquireAndPersistHexDailyDataObservation({
      publicClient,
      rangeStartDay: input.rangeStartDay,
      rangeEndDay: input.rangeEndDay,
      rpcEndpointLabel: input.rpcEndpointLabel ?? null,
    });

    if (!result.ok) {
      console.error("HexMining observation acquire failed", {
        route: "POST /api/hexmining/observations",
        code: result.code,
      });
      return Response.json(
        { error: { code: "OBSERVATION_FAILED", message: "Unable to acquire and persist observation." } },
        { status: 422 },
      );
    }

    return Response.json({
      data: {
        schemaVersion: "v1",
        status: "persisted",
        observation: {
          id: result.observationId,
          rangeStartDay: result.rangeStartDay,
          rangeEndDay: result.rangeEndDay,
          observedAtBlock: result.observedAtBlock,
          observedAt: result.observedAt,
          warnings: result.warnings,
        },
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }

    console.error("HexMining observation create route failed", {
      route: "POST /api/hexmining/observations",
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return buildInternalErrorResponse();
  }
}
