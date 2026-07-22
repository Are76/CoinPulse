import "server-only";

import { z, ZodError } from "zod";

import { discoverEndedHexStakes } from "@/services/hexmining/ended-stake-discovery";
import {
  buildInternalErrorResponse,
  buildInvalidInputResponse,
  parseJsonBody,
} from "@/services/api/validation";

// ─── Operator-triggered ended-stake discovery ──────────────────────────────────
//
// This is the production call site for the existing Phase 5 ended-stake
// discovery pipeline (`discoverEndedHexStakes`). Without it, discovery never
// runs in normal operation and `GET /api/hexmining/ended-stakes` has no data to
// read. The route only invokes the existing service and returns a structured,
// safe evidence envelope — it does not redesign discovery, persistence, DTOs, or
// the frontend.
//
// Discovery reads persisted `RawStakeAction` rows and persists idempotently via
// `persistEndedHexStakeObservation`; there are no RPC/provider reads in this
// pipeline, so no public client is constructed here. Idempotency, provenance,
// captured-block semantics, and the always-incomplete (`lockedDay: null`)
// contract are all owned by the existing service and are preserved unchanged.
//
// The route is gated behind an operator env flag (mirrors
// `HEXMINING_OBSERVATION_ADMIN_ENABLED`) and returns 404 when disabled, so it is
// never an unrestricted public mutation endpoint.

const PULSECHAIN_CHAIN_ID = 369;

const blockNumberSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Block numbers must be unsigned integer strings.")
  .transform((value) => BigInt(value));

// Defaults to "0" before the transform so the fallback still becomes a bigint.
const optionalFromBlockSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Block numbers must be unsigned integer strings.")
  .default("0")
  .transform((value) => BigInt(value));

// No block-span cap here (unlike manual sync/rebuild): discovery scans persisted
// DB rows rather than expanding an RPC payload per block, and ended stakes span
// millions of blocks. Bounding the scan is left to the operator-supplied range.
const discoverEndedStakesRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .trim()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Wallet address must be a valid EVM address.")
      .transform((value) => value.toLowerCase()),
    chainId: z.coerce
      .number()
      .int()
      .refine((value) => value === PULSECHAIN_CHAIN_ID, {
        message: "Ended-stake discovery only supports PulseChain chainId 369.",
      })
      .default(PULSECHAIN_CHAIN_ID),
    fromBlock: optionalFromBlockSchema,
    toBlock: blockNumberSchema,
  })
  .refine((value) => value.fromBlock <= value.toBlock, {
    path: ["fromBlock"],
    message: "fromBlock must be less than or equal to toBlock.",
  });

export async function POST(request: Request) {
  if (process.env.HEXMINING_ENDED_STAKE_DISCOVERY_ADMIN_ENABLED !== "true") {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  }

  try {
    const input = await parseJsonBody(discoverEndedStakesRequestSchema, request);

    const result = await discoverEndedHexStakes({
      chainId: input.chainId,
      walletAddress: input.walletAddress,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
    });

    return Response.json({
      data: {
        schemaVersion: "v1",
        status: "completed",
        scope: {
          chainId: input.chainId,
          walletAddress: input.walletAddress,
          fromBlock: input.fromBlock.toString(),
          toBlock: input.toBlock.toString(),
        },
        discovered: result.discovered,
        persisted: result.persisted,
        skipped: result.skipped,
        warnings: result.warnings,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return buildInvalidInputResponse(error);
    }

    console.error("HexMining ended-stake discovery route failed", {
      route: "POST /api/hexmining/ended-stakes/discover",
      errorName: error instanceof Error ? error.name : typeof error,
    });

    return buildInternalErrorResponse();
  }
}
