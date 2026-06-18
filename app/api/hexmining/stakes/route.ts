import "server-only";

import { z, ZodError } from "zod";

import { createPublicClientForChain } from "@/services/chains/public-client";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import { readNativeHexStakes } from "@/services/hexmining/reader";
import { getObservationEvidenceWithPayloadForRange } from "@/services/hexmining/observation-evidence-provider";
import { estimateHexMiningYield } from "@/services/hexmining/yield-estimator";
import {
  readFreshHexStakeSnapshot,
  writeHexStakeSnapshot,
} from "@/services/hexmining/stake-snapshot-store";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseSearchParams,
} from "@/services/api/validation";

const hexminingStakesRequestSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Wallet address must be a valid EVM address.")
    .transform((v) => v.toLowerCase()),
  chainId: z.coerce
    .number()
    .int()
    .positive("Chain ID must be a positive integer.")
    .default(369),
});

export async function GET(request: Request) {
  try {
    const input = parseSearchParams(hexminingStakesRequestSchema, request);

    let cached = null;
    try {
      cached = await readFreshHexStakeSnapshot({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
      });
    } catch {
      // Snapshot read failure is non-fatal — fall through to live RPC.
    }
    if (cached) {
      return Response.json({ data: cached });
    }

    const publicClient =
      createPublicClientForChain() as unknown as HexMiningReadClient;
    const stakes = await readNativeHexStakes({
      publicClient,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      estimateYield: (args) =>
        estimateHexMiningYield(args, {
          fetchEvidence: getObservationEvidenceWithPayloadForRange,
        }),
    });

    if (stakes.isComplete) {
      try {
        await writeHexStakeSnapshot({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          dto: stakes,
        });
      } catch {
        // Snapshot write failure is non-fatal — live data is still returned.
      }
    }

    return Response.json({ data: stakes });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }
    return buildInternalErrorResponse();
  }
}
