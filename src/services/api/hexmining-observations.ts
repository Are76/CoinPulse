import "server-only";

import { SourceFamily } from "@prisma/client";

import { getDb } from "@/lib/db";

// PulseChain is the only supported chain in V1.
const PULSECHAIN_CHAIN_ID = 369;

// ─── Narrow DB client ─────────────────────────────────────────────────────────

type ObsRow = {
  id: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  rpcEndpointLabel: string | null;
  payloadHash: string;
  createdAt: Date;
};

type HexObsStatusDbClient = {
  rawHexDailyDataObservation: {
    findFirst(args: {
      where: { chainId: number; sourceFamily: SourceFamily };
      orderBy: { observedAtBlock: "desc" };
      select: {
        id: true;
        rangeStartDay: true;
        rangeEndDay: true;
        observedAtBlock: true;
        rpcEndpointLabel: true;
        payloadHash: true;
        createdAt: true;
      };
    }): Promise<ObsRow | null>;
  };
};

// ─── DTO types ────────────────────────────────────────────────────────────────

export type HexMiningObservationStatusDto = {
  schemaVersion: "v1";
  chainId: number;
  sourceFamily: "HEXMINING";
  status: "available" | "missing";
  asOf: string;
  latestObservation: {
    id: string;
    rangeStartDay: number;
    rangeEndDay: number;
    observedAtBlock: string; // bigint serialized as base-10 decimal string (§11.8 policy)
    rpcEndpointLabel: string | null;
    payloadHash: string;
    createdAt: string; // ISO timestamp
  } | null;
  provenance: {
    source: "rawHexDailyDataObservation";
    storage: "postgres";
  };
  warnings: string[];
};

// ─── Service function ─────────────────────────────────────────────────────────

export async function getHexMiningObservationStatus(
  dependencies: { db?: HexObsStatusDbClient; now?: Date } = {},
): Promise<HexMiningObservationStatusDto> {
  const db = dependencies.db ?? (getDb() as unknown as HexObsStatusDbClient);
  const now = dependencies.now ?? new Date();

  const latest = await db.rawHexDailyDataObservation.findFirst({
    where: {
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: SourceFamily.HEXMINING,
    },
    orderBy: { observedAtBlock: "desc" },
    select: {
      id: true,
      rangeStartDay: true,
      rangeEndDay: true,
      observedAtBlock: true,
      rpcEndpointLabel: true,
      payloadHash: true,
      createdAt: true,
    },
  });

  return {
    schemaVersion: "v1",
    chainId: PULSECHAIN_CHAIN_ID,
    sourceFamily: "HEXMINING",
    status: latest ? "available" : "missing",
    asOf: now.toISOString(),
    latestObservation: latest
      ? {
          id: latest.id,
          rangeStartDay: latest.rangeStartDay,
          rangeEndDay: latest.rangeEndDay,
          observedAtBlock: latest.observedAtBlock.toString(),
          rpcEndpointLabel: latest.rpcEndpointLabel,
          payloadHash: latest.payloadHash,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
    provenance: {
      source: "rawHexDailyDataObservation",
      storage: "postgres",
    },
    warnings: [],
  };
}
