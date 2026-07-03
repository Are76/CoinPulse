import "server-only";

import { z, ZodError } from "zod";

import { readEndedHexStakes } from "@/services/hexmining/ended-stake-reader";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseSearchParams,
} from "@/services/api/validation";

const endedStakesRequestSchema = z.object({
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
    const input = parseSearchParams(endedStakesRequestSchema, request);
    const result = await readEndedHexStakes({
      chainId: input.chainId,
      walletAddress: input.walletAddress,
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ZodError) return buildInvalidInputResponse(error);
    return buildInternalErrorResponse();
  }
}
