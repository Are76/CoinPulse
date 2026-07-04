import "server-only";

import { Prisma } from "@prisma/client";

import { getDb } from "@/lib/db";

// ─── Input types ──────────────────────────────────────────────────────────────

export type PersistHsiStakeObservationInput = {
  chainId: number;
  walletAddress: string;
  hsiTokenId: string;
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

// Enrichment input for an already-persisted incomplete observation. The reader
// slice (Phase 6 Slice 3) resolves the underlying HEX stake struct and back-fills
// these fields on the existing row. Identity fields (chainId, walletAddress,
// hsiAddress, hsiTokenId, observedAtBlock) are never touched — only the stake
// metadata, isComplete, and warnings are updated.
export type EnrichHsiStakeObservationInput = {
  id: string;
  stakeId: string;
  stakeIndex: number;
  stakedDays: number;
  lockedDay: number;
  stakeShares: string;
  principalHex: string;
  warnings: string[];
};

// ─── Output types ─────────────────────────────────────────────────────────────

export type PersistedHsiStakeObservation = {
  id: string;
  chainId: number;
  walletAddress: string;
  hsiTokenId: string;
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

// ─── Validation ───────────────────────────────────────────────────────────────
//
// ERC-721 token IDs are uint256 on-chain. They must be stored as decimal
// strings to avoid int64 truncation. "0" is valid; negatives and fractions
// are not; scientific notation is not accepted.

const DECIMAL_UINT_RE = /^(0|[1-9]\d*)$/;

export function validateHsiTokenId(value: string): void {
  if (!DECIMAL_UINT_RE.test(value)) {
    throw new Error(
      `Invalid hsiTokenId "${value}": must be a non-negative decimal integer string with no fractions or scientific notation.`,
    );
  }
}

// ─── Dedup key ────────────────────────────────────────────────────────────────
//
// Deduplication uses (chainId, walletAddress, hsiAddress, hsiTokenId,
// observedAtBlock). hsiAddress is included because ERC-721 token IDs are
// scoped to their contract — the same token ID on two different Hedron
// contracts is a different HSI.

export function buildHsiObservationDedupeKey(args: {
  chainId: number;
  walletAddress: string;
  hsiAddress: string;
  hsiTokenId: string;
  observedAtBlock: bigint;
}): string {
  return [
    args.chainId,
    args.walletAddress.toLowerCase(),
    args.hsiAddress.toLowerCase(),
    args.hsiTokenId,
    args.observedAtBlock.toString(),
  ].join(":");
}

// ─── Narrow typed client ──────────────────────────────────────────────────────

type StoreClient = {
  rawHsiStakeObservation: {
    create(args: {
      data: {
        chainId: number;
        walletAddress: string;
        hsiTokenId: string;
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
      select: { id: true };
    }): Promise<{ id: string }>;
    findFirst(args: {
      where: {
        chainId: number;
        walletAddress: string;
        hsiAddress: string;
        hsiTokenId: string;
        observedAtBlock: bigint;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
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
        hsiTokenId: string;
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
// Returns the id of the created or pre-existing row and whether this call
// created it. Race-safe: the database unique constraint on the full dedupe
// tuple means concurrent writers will get a P2002 conflict rather than
// duplicate rows. On P2002 we re-read via findFirst and return created: false.

export async function persistHsiStakeObservation(
  input: PersistHsiStakeObservationInput,
  client: StoreClient = getDb() as unknown as StoreClient,
): Promise<{ id: string; created: boolean }> {
  validateHsiTokenId(input.hsiTokenId);

  const walletAddress = input.walletAddress.toLowerCase();
  const hsiAddress = input.hsiAddress.toLowerCase();

  try {
    const row = await client.rawHsiStakeObservation.create({
      data: {
        chainId: input.chainId,
        walletAddress,
        hsiTokenId: input.hsiTokenId,
        hsiAddress,
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
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (err) {
    // Row already exists (idempotent re-write or concurrent writer race).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await client.rawHsiStakeObservation.findFirst({
        where: {
          chainId: input.chainId,
          walletAddress,
          hsiAddress,
          hsiTokenId: input.hsiTokenId,
          observedAtBlock: input.observedAtBlock,
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
}

// ─── Enrichment client ──────────────────────────────────────────────────────────
//
// The enrichment path additionally needs `update`. It is kept as a superset of
// StoreClient (rather than baked into StoreClient) so the write/read contracts
// and their existing mocks stay untouched.

type EnrichStoreClient = StoreClient & {
  rawHsiStakeObservation: {
    update(args: {
      where: { id: string };
      data: {
        stakeId: string;
        stakeIndex: number;
        stakedDays: number;
        lockedDay: number;
        stakeShares: string;
        principalHex: string;
        isComplete: boolean;
        warnings: string[];
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

// ─── Enrichment update ──────────────────────────────────────────────────────────
//
// Back-fills the underlying HEX stake metadata on an existing incomplete
// observation and flips isComplete to true. The row is located by primary key
// (id) only — the identity tuple is left untouched, so this never affects
// deduplication. Warnings are replaced wholesale with the caller-supplied set
// (the reader strips the discovery "stake-fields-unknown" warning before
// calling). Stake fields are written verbatim from the caller with no coercion.
//
// This is the only mutation path for RawHsiStakeObservation. It is used strictly
// to complete the discover → enrich lifecycle; it never rewrites identity fields
// and never deletes rows.

export async function enrichHsiStakeObservation(
  input: EnrichHsiStakeObservationInput,
  client: EnrichStoreClient = getDb() as unknown as EnrichStoreClient,
): Promise<{ id: string }> {
  const row = await client.rawHsiStakeObservation.update({
    where: { id: input.id },
    data: {
      stakeId: input.stakeId,
      stakeIndex: input.stakeIndex,
      stakedDays: input.stakedDays,
      lockedDay: input.lockedDay,
      stakeShares: input.stakeShares,
      principalHex: input.principalHex,
      isComplete: true,
      warnings: input.warnings,
    },
    select: { id: true },
  });
  return { id: row.id };
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
    hsiTokenId: r.hsiTokenId,
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
