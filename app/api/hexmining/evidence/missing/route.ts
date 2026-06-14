import "server-only";

import { z, ZodError } from "zod";

import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseSearchParams,
} from "@/services/api/validation";
import { createPublicClientForChain } from "@/services/chains/public-client";
import { readCurrentDay } from "@/services/hexmining/daily-data-reader";
import { buildHexMiningEvidenceCoverageReport } from "@/services/hexmining/evidence-coverage-report";
import { getObservationEvidenceForRange } from "@/services/hexmining/observation-evidence-provider";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import { readNativeHexStakes } from "@/services/hexmining/reader";

const PULSECHAIN_CHAIN_ID = 369;

const hexminingMissingEvidenceRequestSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Wallet address must be a valid EVM address.")
    .transform((v) => v.toLowerCase()),
  chainId: z.coerce
    .number()
    .int()
    .refine((value) => value === PULSECHAIN_CHAIN_ID, {
      message: "HexMining missing evidence report only supports PulseChain chainId 369.",
    })
    .default(PULSECHAIN_CHAIN_ID),
});

export async function GET(request: Request) {
  try {
    const input = parseSearchParams(hexminingMissingEvidenceRequestSchema, request);
    const publicClient =
      createPublicClientForChain() as unknown as HexMiningReadClient;

    const currentDayResult = await readCurrentDay({ publicClient });
    if (!currentDayResult.ok) {
      return buildInternalErrorResponse(
        "Unable to read HexMining currentDay for evidence coverage report.",
      );
    }

    const stakeList = await readNativeHexStakes({
      publicClient,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
    });

    const report = await buildHexMiningEvidenceCoverageReport({
      chainId: input.chainId,
      currentDay: currentDayResult.currentDay,
      stakes: stakeList.stakes,
      fetchEvidence: getObservationEvidenceForRange,
    });

    return Response.json({ data: report });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse(
      "Unable to build HexMining missing evidence report.",
    );
  }
}
