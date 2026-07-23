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
  evidenceRecoveryMethod: string | null;
  evidenceRecoveryBlockNumber: bigint | null;
  evidenceRecoverySourceContract: string | null;
  evidenceRecoverySourceFunction: string | null;
  evidenceRecoveryReturnedStakeId: string | null;
  evidenceRecoveredAt: Date | null;
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
      select: { id: true; isComplete: true };
    }): Promise<{ id: string; isComplete: boolean } | null>;
    update(args: {
      where: { id: string };
      data: {
        lockedDay: number | null;
        stakeShares: string | null;
        isComplete: boolean;
        warnings: string[];
      };
    }): Promise<{ id: string }>;
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
      orderBy: ({ endBlockNumber: "asc" | "desc" } | { endTxHash: "asc" | "desc" } | { stakeId: "asc" | "desc" } | { id: "asc" | "desc" })[];
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
        evidenceRecoveryMethod: string | null;
        evidenceRecoveryBlockNumber: bigint | null;
        evidenceRecoverySourceContract: string | null;
        evidenceRecoverySourceFunction: string | null;
        evidenceRecoveryReturnedStakeId: string | null;
        evidenceRecoveredAt: Date | null;
      }[]
    >;
  };
};

// ─── Persistence ──────────────────────────────────────────────────────────────
//
// Returns the id of the created, upgraded, or pre-existing row, plus flags
// describing which happened.
//
// - created:  no row existed for the dedupe key; a new row was written.
// - updated:  a row existed but was previously incomplete, and the incoming
//             observation is complete; the row is upgraded in place using the
//             exact evidence on the input (lockedDay, stakeShares, isComplete,
//             warnings). This reconciles stale rows written before START-time
//             evidence was available, so the canonical row never lags behind
//             the completeness the operator result reports.
// - neither:  a row existed and is left unchanged (already complete, or the
//             incoming observation is not complete). A complete row is never
//             downgraded or rewritten; the dedupe identity is never changed.

export async function persistEndedHexStakeObservation(
  input: PersistEndedHexStakeObservationInput,
  client: StoreClient = getDb(),
): Promise<{ id: string; created: boolean; updated: boolean }> {
  const walletAddress = input.walletAddress.toLowerCase();

  const existing = await client.rawEndedHexStakeObservation.findFirst({
    where: {
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
      endBlockNumber: input.endBlockNumber,
      discoveryMethod: input.discoveryMethod,
    },
    select: { id: true, isComplete: true },
  });

  if (existing) {
    if (existing.isComplete === false && input.isComplete === true) {
      const upgraded = await client.rawEndedHexStakeObservation.update({
        where: { id: existing.id },
        data: {
          lockedDay: input.lockedDay,
          stakeShares: input.stakeShares,
          isComplete: input.isComplete,
          warnings: input.warnings,
        },
      });

      return { id: upgraded.id, created: false, updated: true };
    }

    return { id: existing.id, created: false, updated: false };
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

  return { id: created.id, created: true, updated: false };
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
    orderBy: [
      { endBlockNumber: "asc" },
      { endTxHash: "asc" },
      { stakeId: "asc" },
      { id: "asc" },
    ],
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
    evidenceRecoveryMethod: r.evidenceRecoveryMethod,
    evidenceRecoveryBlockNumber:
      r.evidenceRecoveryBlockNumber == null ? null : (r.evidenceRecoveryBlockNumber as bigint),
    evidenceRecoverySourceContract: r.evidenceRecoverySourceContract,
    evidenceRecoverySourceFunction: r.evidenceRecoverySourceFunction,
    evidenceRecoveryReturnedStakeId: r.evidenceRecoveryReturnedStakeId,
    evidenceRecoveredAt: r.evidenceRecoveredAt,
  }));
}

// ─── Historical-state evidence-recovery enrichment ───────────────────────────
//
// Upgrades an existing incomplete observation with lockedDay/stakeShares
// recovered from a pinned historical contract-state read (stakeLists at
// endBlockNumber-1), instead of from a matched RawStakeAction START record.
//
// This is a strictly additive UPDATE-only path:
//   - There is no create/INSERT here. It can only ever complete a row that
//     already exists — it never persists a new canonical observation.
//   - The write is a single atomic conditional UPDATE, bound to the row's full
//     canonical identity (id + chainId + walletAddress + stakeId +
//     endBlockNumber) AND isComplete: false. A caller bug that passes the wrong
//     id, or the right id with a mismatched stakeId/endBlockNumber, can never
//     mutate the wrong row: the WHERE clause simply matches zero rows and the
//     write is a no-op, not a mismatched write.
//   - discoveryMethod and observedAt (original END-discovery provenance) are
//     never touched here — only lockedDay, stakeShares, isComplete, warnings,
//     and the evidenceRecovery* columns are written.

export type EnrichEndedHexStakeObservationInput = {
  id: string;
  chainId: number;
  walletAddress: string;
  stakeId: string;
  endBlockNumber: bigint;
  lockedDay: number;
  stakeShares: string;
  warnings: string[];
  evidenceRecoveryMethod: string;
  evidenceRecoveryBlockNumber: bigint;
  evidenceRecoverySourceContract: string;
  evidenceRecoverySourceFunction: string;
  evidenceRecoveryReturnedStakeId: string;
  evidenceRecoveredAt: Date;
};

export type EnrichEndedHexStakeObservationOutcome =
  | "updated"
  | "concurrent_matching_completion"
  | "concurrent_conflict"
  | "state_changed"
  | "observation_missing";

type EnrichStoreClient = {
  rawEndedHexStakeObservation: {
    updateMany(args: {
      where: {
        id: string;
        isComplete: false;
        chainId: number;
        walletAddress: string;
        stakeId: string;
        endBlockNumber: bigint;
      };
      data: {
        lockedDay: number;
        stakeShares: string;
        isComplete: true;
        warnings: string[];
        evidenceRecoveryMethod: string;
        evidenceRecoveryBlockNumber: bigint;
        evidenceRecoverySourceContract: string;
        evidenceRecoverySourceFunction: string;
        evidenceRecoveryReturnedStakeId: string;
        evidenceRecoveredAt: Date;
      };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: {
        chainId: true;
        walletAddress: true;
        stakeId: true;
        endBlockNumber: true;
        isComplete: true;
        lockedDay: true;
        stakeShares: true;
      };
    }): Promise<
      | {
          chainId: number;
          walletAddress: string;
          stakeId: string;
          endBlockNumber: bigint;
          isComplete: boolean;
          lockedDay: number | null;
          stakeShares: string | null;
        }
      | null
    >;
  };
};

export async function enrichEndedHexStakeObservation(
  input: EnrichEndedHexStakeObservationInput,
  client: EnrichStoreClient = getDb() as unknown as EnrichStoreClient,
): Promise<{ outcome: EnrichEndedHexStakeObservationOutcome }> {
  const walletAddress = input.walletAddress.toLowerCase();

  const result = await client.rawEndedHexStakeObservation.updateMany({
    where: {
      id: input.id,
      isComplete: false,
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
      endBlockNumber: input.endBlockNumber,
    },
    data: {
      lockedDay: input.lockedDay,
      stakeShares: input.stakeShares,
      isComplete: true,
      warnings: input.warnings,
      evidenceRecoveryMethod: input.evidenceRecoveryMethod,
      evidenceRecoveryBlockNumber: input.evidenceRecoveryBlockNumber,
      evidenceRecoverySourceContract: input.evidenceRecoverySourceContract,
      evidenceRecoverySourceFunction: input.evidenceRecoverySourceFunction,
      evidenceRecoveryReturnedStakeId: input.evidenceRecoveryReturnedStakeId,
      evidenceRecoveredAt: input.evidenceRecoveredAt,
    },
  });

  if (result.count === 1) {
    return { outcome: "updated" };
  }

  if (result.count > 1) {
    // id is the primary key, so more than one matched row is structurally
    // impossible. Fail loudly rather than silently accept an invariant break.
    throw new Error(
      `enrichEndedHexStakeObservation: updateMany matched ${result.count} rows for id ${input.id} — invariant violation`,
    );
  }

  // count === 0: the conditional update matched nothing. Re-read and classify
  // why, rather than assuming failure. Never write in any of these branches.
  const current = await client.rawEndedHexStakeObservation.findUnique({
    where: { id: input.id },
    select: {
      chainId: true,
      walletAddress: true,
      stakeId: true,
      endBlockNumber: true,
      isComplete: true,
      lockedDay: true,
      stakeShares: true,
    },
  });

  if (current == null) {
    return { outcome: "observation_missing" };
  }

  const identityMatches =
    current.chainId === input.chainId &&
    current.walletAddress === walletAddress &&
    current.stakeId === input.stakeId &&
    current.endBlockNumber === input.endBlockNumber;

  if (!identityMatches) {
    return { outcome: "state_changed" };
  }

  if (current.isComplete) {
    const matches =
      current.lockedDay === input.lockedDay && current.stakeShares === input.stakeShares;
    return { outcome: matches ? "concurrent_matching_completion" : "concurrent_conflict" };
  }

  // Identity matches, still incomplete, yet the conditional update matched
  // zero rows — some other field changed concurrently in a way this function
  // does not model. Fail closed rather than guess.
  return { outcome: "state_changed" };
}
