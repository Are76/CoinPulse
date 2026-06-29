import "server-only";

import { getDb } from "@/lib/db";

// ─── Discovery method vocabulary ─────────────────────────────────────────────
//
// raw_stake_action — observation sourced from an existing RawStakeAction endStake
//                   record that was indexed by the V1 sync pipeline.
// rpc_history      — observation sourced from a direct RPC transaction history
//                   scan (Phase 5 fallback path, used when RawStakeAction is
//                   absent or incomplete for the wallet).

export type EndedStakeDiscoveryMethod = "raw_stake_action" | "rpc_history";

// ─── Input types ──────────────────────────────────────────────────────────────

export type PersistEndedHexStakeObservationInput = {
  chainId: number;
  walletAddress: string;
  stakeId: string;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  yieldHex: string | null;
  penaltyHex: string | null;
  endTxHash: string;
  endBlockNumber: bigint;
  startTxHash: string | null;
  startBlockNumber: bigint | null;
  discoveryMethod: EndedStakeDiscoveryMethod;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
};

export type ReadEndedHexStakeObservationsInput = {
  chainId: number;
  walletAddress: string;
};

// ─── Output types ─────────────────────────────────────────────────────────────

export type PersistedEndedHexStakeObservation = {
  id: string;
  chainId: number;
  walletAddress: string;
  stakeId: string;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  yieldHex: string | null;
  penaltyHex: string | null;
  endTxHash: string;
  endBlockNumber: bigint;
  startTxHash: string | null;
  startBlockNumber: bigint | null;
  discoveryMethod: string;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
};

// ─── Dedup key ────────────────────────────────────────────────────────────────
//
// Deduplication uses (chainId, walletAddress, stakeId, endBlockNumber,
// discoveryMethod). Multiple rows for the same stake are allowed if they
// were discovered via a different method or at a different block.

export function buildEndedStakeDedupeKey(args: {
  chainId: number;
  walletAddress: string;
  stakeId: string;
  endBlockNumber: bigint;
  discoveryMethod: EndedStakeDiscoveryMethod;
}): string {
  return [
    args.chainId,
    args.walletAddress.toLowerCase(),
    args.stakeId,
    args.endBlockNumber.toString(),
    args.discoveryMethod,
  ].join(":");
}

// ─── Narrow typed client ──────────────────────────────────────────────────────

type StoreClient = {
  rawEndedHexStakeObservation: {
    findFirst(args: {
      where: {
        chainId: number;
        walletAddress: string;
        stakeId: string;
        endBlockNumber: bigint;
        discoveryMethod: string;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        chainId: number;
        walletAddress: string;
        stakeId: string;
        stakeIndex: number | null;
        stakedDays: number | null;
        lockedDay: number | null;
        stakeShares: string | null;
        principalHex: string | null;
        yieldHex: string | null;
        penaltyHex: string | null;
        endTxHash: string;
        endBlockNumber: bigint;
        startTxHash: string | null;
        startBlockNumber: bigint | null;
        discoveryMethod: string;
        observedAt: Date;
        isComplete: boolean;
        warnings: string[];
      };
    }): Promise<{ id: string }>;
    findMany(args: {
      where: { chainId: number; walletAddress: string };
      orderBy: { endBlockNumber: "asc" | "desc" }[];
    }): Promise<
      {
        id: string;
        chainId: number;
        walletAddress: string;
        stakeId: string;
        stakeIndex: number | null;
        stakedDays: number | null;
        lockedDay: number | null;
        stakeShares: string | null;
        principalHex: string | null;
        yieldHex: string | null;
        penaltyHex: string | null;
        endTxHash: string;
        endBlockNumber: bigint;
        startTxHash: string | null;
        startBlockNumber: bigint | null;
        discoveryMethod: string;
        observedAt: Date;
        isComplete: boolean;
        warnings: string[];
        createdAt: Date;
      }[]
    >;
  };
};

// ─── Persistence ──────────────────────────────────────────────────────────────
//
// Returns the id of the created or pre-existing row.
// Skips write if a row with the same dedup key already exists.

export async function persistEndedHexStakeObservation(
  input: PersistEndedHexStakeObservationInput,
  client: StoreClient = getDb(),
): Promise<{ id: string; created: boolean }> {
  const walletAddress = input.walletAddress.toLowerCase();

  const existing = await client.rawEndedHexStakeObservation.findFirst({
    where: {
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
      endBlockNumber: input.endBlockNumber,
      discoveryMethod: input.discoveryMethod,
    },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await client.rawEndedHexStakeObservation.create({
    data: {
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
      stakeIndex: input.stakeIndex,
      stakedDays: input.stakedDays,
      lockedDay: input.lockedDay,
      stakeShares: input.stakeShares,
      principalHex: input.principalHex,
      yieldHex: input.yieldHex,
      penaltyHex: input.penaltyHex,
      endTxHash: input.endTxHash,
      endBlockNumber: input.endBlockNumber,
      startTxHash: input.startTxHash,
      startBlockNumber: input.startBlockNumber,
      discoveryMethod: input.discoveryMethod,
      observedAt: input.observedAt,
      isComplete: input.isComplete,
      warnings: input.warnings,
    },
  });

  return { id: created.id, created: true };
}

// ─── Read ──────────────────────────────────────────────────────────────────────
//
// Returns all ended stake observations for a wallet+chain, ordered by
// endBlockNumber ascending (earliest ended first).

export async function readEndedHexStakeObservations(
  input: ReadEndedHexStakeObservationsInput,
  client: StoreClient = getDb(),
): Promise<PersistedEndedHexStakeObservation[]> {
  const records = await client.rawEndedHexStakeObservation.findMany({
    where: {
      chainId: input.chainId,
      walletAddress: input.walletAddress.toLowerCase(),
    },
    orderBy: [{ endBlockNumber: "asc" }],
  });

  return records.map((r) => ({
    id: r.id,
    chainId: r.chainId,
    walletAddress: r.walletAddress,
    stakeId: r.stakeId,
    stakeIndex: r.stakeIndex,
    stakedDays: r.stakedDays,
    lockedDay: r.lockedDay,
    stakeShares: r.stakeShares,
    principalHex: r.principalHex,
    yieldHex: r.yieldHex,
    penaltyHex: r.penaltyHex,
    endTxHash: r.endTxHash,
    endBlockNumber: r.endBlockNumber as bigint,
    startTxHash: r.startTxHash,
    startBlockNumber:
      r.startBlockNumber == null ? null : (r.startBlockNumber as bigint),
    discoveryMethod: r.discoveryMethod,
    observedAt: r.observedAt,
    isComplete: r.isComplete,
    warnings: r.warnings,
    createdAt: r.createdAt,
  }));
}
