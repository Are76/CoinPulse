import "server-only";

import { getDb } from "@/lib/db";

// ─── Input types ──────────────────────────────────────────────────────────────

export type PersistHsiStakeObservationInput = {
  chainId: number;
  walletAddress: string;
  hsiTokenId: bigint;
  hsiAddress: string;
  stakeId: string | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  observedAtBlock: bigint;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
};

export type ReadHsiStakeObservationsInput = {
  chainId: number;
  walletAddress: string;
};

// ─── Output types ─────────────────────────────────────────────────────────────

export type PersistedHsiStakeObservation = {
  id: string;
  chainId: number;
  walletAddress: string;
  hsiTokenId: bigint;
  hsiAddress: string;
  stakeId: string | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  observedAtBlock: bigint;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
};

// ─── Dedup key ────────────────────────────────────────────────────────────────
//
// Deduplication uses (chainId, walletAddress, hsiTokenId, observedAtBlock).
// The same HSI token observed at the same block is the same observation.
// A new block produces a new row, preserving the full observation history.

export function buildHsiObservationDedupeKey(args: {
  chainId: number;
  walletAddress: string;
  hsiTokenId: bigint;
  observedAtBlock: bigint;
}): string {
  return [
    args.chainId,
    args.walletAddress.toLowerCase(),
    args.hsiTokenId.toString(),
    args.observedAtBlock.toString(),
  ].join(":");
}

// ─── Narrow typed client ──────────────────────────────────────────────────────

type StoreClient = {
  rawHsiStakeObservation: {
    findFirst(args: {
      where: {
        chainId: number;
        walletAddress: string;
        hsiTokenId: bigint;
        observedAtBlock: bigint;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        chainId: number;
        walletAddress: string;
        hsiTokenId: bigint;
        hsiAddress: string;
        stakeId: string | null;
        stakeIndex: number | null;
        stakedDays: number | null;
        lockedDay: number | null;
        stakeShares: string | null;
        principalHex: string | null;
        observedAtBlock: bigint;
        observedAt: Date;
        isComplete: boolean;
        warnings: string[];
      };
    }): Promise<{ id: string }>;
    findMany(args: {
      where: { chainId: number; walletAddress: string };
      orderBy: (
        | { observedAtBlock: "asc" | "desc" }
        | { hsiTokenId: "asc" | "desc" }
        | { id: "asc" | "desc" }
      )[];
    }): Promise<
      {
        id: string;
        chainId: number;
        walletAddress: string;
        hsiTokenId: bigint;
        hsiAddress: string;
        stakeId: string | null;
        stakeIndex: number | null;
        stakedDays: number | null;
        lockedDay: number | null;
        stakeShares: string | null;
        principalHex: string | null;
        observedAtBlock: bigint;
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

export async function persistHsiStakeObservation(
  input: PersistHsiStakeObservationInput,
  client: StoreClient = getDb() as unknown as StoreClient,
): Promise<{ id: string; created: boolean }> {
  const walletAddress = input.walletAddress.toLowerCase();

  const existing = await client.rawHsiStakeObservation.findFirst({
    where: {
      chainId: input.chainId,
      walletAddress,
      hsiTokenId: input.hsiTokenId,
      observedAtBlock: input.observedAtBlock,
    },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await client.rawHsiStakeObservation.create({
    data: {
      chainId: input.chainId,
      walletAddress,
      hsiTokenId: input.hsiTokenId,
      hsiAddress: input.hsiAddress,
      stakeId: input.stakeId,
      stakeIndex: input.stakeIndex,
      stakedDays: input.stakedDays,
      lockedDay: input.lockedDay,
      stakeShares: input.stakeShares,
      principalHex: input.principalHex,
      observedAtBlock: input.observedAtBlock,
      observedAt: input.observedAt,
      isComplete: input.isComplete,
      warnings: input.warnings,
    },
  });

  return { id: created.id, created: true };
}

// ─── Read ──────────────────────────────────────────────────────────────────────
//
// Returns all HSI stake observations for a wallet+chain, ordered by
// observedAtBlock ascending, then hsiTokenId ascending as a tie-breaker.

export async function readHsiStakeObservations(
  input: ReadHsiStakeObservationsInput,
  client: StoreClient = getDb() as unknown as StoreClient,
): Promise<PersistedHsiStakeObservation[]> {
  const records = await client.rawHsiStakeObservation.findMany({
    where: {
      chainId: input.chainId,
      walletAddress: input.walletAddress.toLowerCase(),
    },
    orderBy: [
      { observedAtBlock: "asc" },
      { hsiTokenId: "asc" },
      { id: "asc" },
    ],
  });

  return records.map((r) => ({
    id: r.id,
    chainId: r.chainId,
    walletAddress: r.walletAddress,
    hsiTokenId: r.hsiTokenId as bigint,
    hsiAddress: r.hsiAddress,
    stakeId: r.stakeId,
    stakeIndex: r.stakeIndex,
    stakedDays: r.stakedDays,
    lockedDay: r.lockedDay,
    stakeShares: r.stakeShares,
    principalHex: r.principalHex,
    observedAtBlock: r.observedAtBlock as bigint,
    observedAt: r.observedAt,
    isComplete: r.isComplete,
    warnings: r.warnings,
    createdAt: r.createdAt,
  }));
}
