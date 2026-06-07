import "server-only";

import { createHash } from "crypto";

import { SourceFamily } from "@prisma/client";

import { getDb } from "@/lib/db";

// Narrow typed client — subset of PrismaClient needed by this module.
// This interface drives the mock in tests and keeps the module free of
// the full Prisma import at the persistence call-sites.
type ObservationStoreClient = {
  rawHexDailyDataObservation: {
    create(args: {
      data: {
        chainId: number;
        sourceFamily: SourceFamily;
        rangeStartDay: number;
        rangeEndDay: number;
        observedAtBlock: bigint;
        observedAt: Date;
        rpcEndpointLabel: string | null;
        payloadVersion: string;
        canonicalPayload: string;
        payloadHash: string;
        warnings: string[];
      };
    }): Promise<{ id: string }>;
  };
  rawHexDailyDataObservationInvalidation: {
    create(args: {
      data: {
        observationId: string;
        reason: string;
        reorgBlockHash: string | null;
        supersededByObservationId: string | null;
      };
    }): Promise<{ id: string }>;
  };
};

// ─── Input types ──────────────────────────────────────────────────────────────

// sourceFamily is intentionally absent — the service always writes HEXMINING.
// payloadHash is intentionally absent — the service derives it from canonicalPayload.
export type CreateRawHexDailyDataObservationInput = {
  chainId: number;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  observedAt: Date;
  rpcEndpointLabel?: string | null;
  payloadVersion: string;
  canonicalPayload: string;
  warnings?: string[];
};

export type CreateRawHexDailyDataObservationInvalidationInput = {
  observationId: string;
  reason: string;
  reorgBlockHash?: string | null;
  supersededByObservationId?: string | null;
};

// ─── Hash helper ──────────────────────────────────────────────────────────────

// Returns the SHA-256 hex digest of the canonical payload string.
// All uint*/int* viem values must already be base-10 decimal strings inside
// canonicalPayload before this is called (§11.8 bigint-safe encoding policy).
export function computePayloadHash(canonicalPayload: string): string {
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

// ─── Persistence functions ────────────────────────────────────────────────────

export async function persistHexDailyDataObservation(
  input: CreateRawHexDailyDataObservationInput,
  client: ObservationStoreClient = getDb(),
): Promise<{ id: string }> {
  return client.rawHexDailyDataObservation.create({
    data: {
      chainId: input.chainId,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: input.rangeStartDay,
      rangeEndDay: input.rangeEndDay,
      observedAtBlock: input.observedAtBlock,
      observedAt: input.observedAt,
      rpcEndpointLabel: input.rpcEndpointLabel ?? null,
      payloadVersion: input.payloadVersion,
      canonicalPayload: input.canonicalPayload,
      payloadHash: computePayloadHash(input.canonicalPayload),
      warnings: input.warnings ?? [],
    },
  });
}

export async function persistHexDailyDataObservationInvalidation(
  input: CreateRawHexDailyDataObservationInvalidationInput,
  client: ObservationStoreClient = getDb(),
): Promise<{ id: string }> {
  return client.rawHexDailyDataObservationInvalidation.create({
    data: {
      observationId: input.observationId,
      reason: input.reason,
      reorgBlockHash: input.reorgBlockHash ?? null,
      supersededByObservationId: input.supersededByObservationId ?? null,
    },
  });
}
