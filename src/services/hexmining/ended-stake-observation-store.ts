import "server-only";

import { Prisma } from "@prisma/client";

import { getDb } from "@/lib/db";

// ─── Discovery method vocabulary ─────────────────────────────────────────────
//
// raw_stake_action — observation sourced from an existing RawStakeAction endStake
//                   record that was indexed by the V1 sync pipeline.
// rpc_history      — observation sourced from a direct RPC transaction history
//                   scan (Phase 5 fallback path, used when RawStakeAction is
//                   absent or incomplete for the wallet).
//
// discoveryMethod records HOW the end event was found; it is not part of the
// canonical identity of the stake itself (see the canonical-identity note on
// the buildEndedStakeDedupeKey helper below and D-033).

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

// ─── Canonical identity dedupe key ───────────────────────────────────────────
//
// The canonical identity of an ended stake for native pHEX Phase 1 (D-032,
// D-033) is (chainId, lowercase walletAddress, stakeId). endBlockNumber,
// endTxHash, and discoveryMethod are evidence/attributes recorded on the row,
// not identity — they no longer participate in the dedupe key, and the
// database enforces this identity via a unique constraint.

export function buildEndedStakeDedupeKey(args: {
  chainId: number;
  walletAddress: string;
  stakeId: string;
}): string {
  return [args.chainId, args.walletAddress.toLowerCase(), args.stakeId].join(":");
}

// ─── Narrow typed client ──────────────────────────────────────────────────────

type StoreClient = {
  rawEndedHexStakeObservation: {
    findFirst(args: {
      where: {
        chainId: number;
        walletAddress: string;
        stakeId: string;
      };
      select: {
        id: true;
        isComplete: true;
        endBlockNumber: true;
        endTxHash: true;
      };
    }): Promise<{
      id: string;
      isComplete: boolean;
      endBlockNumber: bigint;
      endTxHash: string;
    } | null>;
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
      orderBy: (
        | { endBlockNumber: "asc" | "desc" }
        | { endTxHash: "asc" | "desc" }
        | { stakeId: "asc" | "desc" }
        | { id: "asc" | "desc" }
      )[];
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
// Lookup identity is exactly the canonical identity enforced by the database:
// (chainId, lowercase walletAddress, stakeId). endBlockNumber/endTxHash/
// discoveryMethod never contribute to the lookup — they are evidence attached
// to the canonical row.
//
// Outcomes:
//   - created:  no canonical row existed; a new row was written.
//   - updated:  a canonical row existed but was previously incomplete, and the
//               incoming observation is complete; the existing row is upgraded
//               in place (lockedDay, stakeShares, isComplete, warnings). The
//               canonical row's identity is never rewritten. This reconciles
//               stale rows persisted before START-time evidence was available.
//   - conflict: a canonical row exists, and the incoming end evidence
//               (endBlockNumber and/or endTxHash) disagrees with the persisted
//               canonical row. Neither a create nor an in-place mutation
//               happens; the caller receives an operator-safe reason string
//               so the discovery/route layer can count and surface conflicts
//               explicitly instead of silently overwriting or duplicating.
//   - neither created nor updated nor conflict: the canonical row already
//               exists with matching or non-conflicting evidence; the row is
//               left unchanged (already complete, or incoming observation is
//               not complete). A complete row is never downgraded.

export type PersistEndedHexStakeObservationResult =
  | { id: string; created: boolean; updated: boolean; conflict: false }
  | {
      id: string;
      created: false;
      updated: false;
      conflict: true;
      conflictReason: string;
    };

// End-evidence attributes compared during conflict detection. endBlockNumber
// and endTxHash together identify the on-chain end event; a disagreement on
// either signals two distinct end events being reported for the same
// canonical stake identity, which the persistence layer must surface rather
// than silently pick a winner or duplicate the row.
//
// The returned string describes *only* which field disagreed and both values —
// it does not include the warning-code prefix. Callers (discovery, route)
// own the prefix so it appears exactly once in operator-visible warnings.
function detectEndEvidenceConflict(
  persisted: { endBlockNumber: bigint; endTxHash: string },
  incoming: { endBlockNumber: bigint; endTxHash: string },
): string | null {
  if (persisted.endBlockNumber !== incoming.endBlockNumber) {
    return (
      `endBlockNumber ` +
      `persisted=${persisted.endBlockNumber.toString()} ` +
      `incoming=${incoming.endBlockNumber.toString()}`
    );
  }
  if (persisted.endTxHash.toLowerCase() !== incoming.endTxHash.toLowerCase()) {
    return (
      `endTxHash ` +
      `persisted=${persisted.endTxHash} ` +
      `incoming=${incoming.endTxHash}`
    );
  }
  return null;
}

export async function persistEndedHexStakeObservation(
  input: PersistEndedHexStakeObservationInput,
  client: StoreClient = getDb(),
): Promise<PersistEndedHexStakeObservationResult> {
  const walletAddress = input.walletAddress.toLowerCase();

  const existing = await client.rawEndedHexStakeObservation.findFirst({
    where: {
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
    },
    select: {
      id: true,
      isComplete: true,
      endBlockNumber: true,
      endTxHash: true,
    },
  });

  if (existing) {
    return reconcileWithExisting(existing, input, client);
  }

  // No canonical row yet — attempt the insert. A concurrent writer may win the
  // race and cause the DB unique constraint to fire P2002; that path re-reads
  // the canonical row and reconciles by the same identity/evidence rules used
  // above. Every other Prisma error is rethrown unchanged.
  try {
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

    return { id: created.id, created: true, updated: false, conflict: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await client.rawEndedHexStakeObservation.findFirst({
        where: {
          chainId: input.chainId,
          walletAddress,
          stakeId: input.stakeId,
        },
        select: {
          id: true,
          isComplete: true,
          endBlockNumber: true,
          endTxHash: true,
        },
      });
      if (raced) {
        return reconcileWithExisting(raced, input, client);
      }
      // P2002 without a discoverable row is an invariant break — surface it
      // rather than silently returning a fake success.
      throw err;
    }
    throw err;
  }
}

async function reconcileWithExisting(
  existing: {
    id: string;
    isComplete: boolean;
    endBlockNumber: bigint;
    endTxHash: string;
  },
  input: PersistEndedHexStakeObservationInput,
  client: StoreClient,
): Promise<PersistEndedHexStakeObservationResult> {
  const conflictReason = detectEndEvidenceConflict(
    { endBlockNumber: existing.endBlockNumber, endTxHash: existing.endTxHash },
    { endBlockNumber: input.endBlockNumber, endTxHash: input.endTxHash },
  );

  if (conflictReason) {
    return {
      id: existing.id,
      created: false,
      updated: false,
      conflict: true,
      conflictReason,
    };
  }

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

    return { id: upgraded.id, created: false, updated: true, conflict: false };
  }

  return { id: existing.id, created: false, updated: false, conflict: false };
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

// The obsolete incomplete-evidence warning discovery attaches to every
// incomplete row (see WARN_INCOMPLETE_START_EVIDENCE in
// ended-stake-discovery.ts). Enrichment removes only this exact warning code —
// every other persisted warning is preserved verbatim, in order. This constant
// mirrors that one intentionally rather than importing it: the same pattern is
// already used independently in ended-stake-api-verification-runner.ts.
const WARN_INCOMPLETE_START_EVIDENCE = "hexmining-ended-stake-lockedday-unknown";

export type EnrichEndedHexStakeObservationInput = {
  id: string;
  chainId: number;
  walletAddress: string;
  stakeId: string;
  endBlockNumber: bigint;
  lockedDay: number;
  stakeShares: string;
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

type EnrichObservationSnapshot = {
  chainId: number;
  walletAddress: string;
  stakeId: string;
  endBlockNumber: bigint;
  isComplete: boolean;
  lockedDay: number | null;
  stakeShares: string | null;
  warnings: string[];
};

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
        // Bound to the exact warnings array just read, so a concurrent write
        // that changes warnings (adds a new diagnostic, or another process
        // races the same enrichment) fails this conditional update closed
        // instead of silently overwriting the newer persisted warnings.
        warnings: { equals: string[] };
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
        warnings: true;
      };
    }): Promise<EnrichObservationSnapshot | null>;
  };
};

function classifyAgainstSnapshot(
  snapshot: EnrichObservationSnapshot | null,
  input: EnrichEndedHexStakeObservationInput,
  walletAddress: string,
): { outcome: EnrichEndedHexStakeObservationOutcome } | null {
  if (snapshot == null) {
    return { outcome: "observation_missing" };
  }

  const identityMatches =
    snapshot.chainId === input.chainId &&
    snapshot.walletAddress === walletAddress &&
    snapshot.stakeId === input.stakeId &&
    snapshot.endBlockNumber === input.endBlockNumber;

  if (!identityMatches) {
    return { outcome: "state_changed" };
  }

  if (snapshot.isComplete) {
    const matches =
      snapshot.lockedDay === input.lockedDay && snapshot.stakeShares === input.stakeShares;
    return { outcome: matches ? "concurrent_matching_completion" : "concurrent_conflict" };
  }

  return null;
}

export async function enrichEndedHexStakeObservation(
  input: EnrichEndedHexStakeObservationInput,
  client: EnrichStoreClient = getDb() as unknown as EnrichStoreClient,
): Promise<{ outcome: EnrichEndedHexStakeObservationOutcome }> {
  const walletAddress = input.walletAddress.toLowerCase();

  // Read current identity/state/warnings first. This lets the write preserve
  // every unrelated warning exactly (filtering only the obsolete
  // lockedday-unknown code) and binds the write to warnings staying exactly
  // what was just read — see the updateMany where clause below.
  const before = await client.rawEndedHexStakeObservation.findUnique({
    where: { id: input.id },
    select: {
      chainId: true,
      walletAddress: true,
      stakeId: true,
      endBlockNumber: true,
      isComplete: true,
      lockedDay: true,
      stakeShares: true,
      warnings: true,
    },
  });

  const preClassified = classifyAgainstSnapshot(before, input, walletAddress);
  if (preClassified) return preClassified;
  // before is non-null and still incomplete beyond this point (guaranteed by
  // classifyAgainstSnapshot returning null only in that case).
  const current = before!;

  const nextWarnings = current.warnings.filter((w) => w !== WARN_INCOMPLETE_START_EVIDENCE);

  const result = await client.rawEndedHexStakeObservation.updateMany({
    where: {
      id: input.id,
      isComplete: false,
      chainId: input.chainId,
      walletAddress,
      stakeId: input.stakeId,
      endBlockNumber: input.endBlockNumber,
      warnings: { equals: current.warnings },
    },
    data: {
      lockedDay: input.lockedDay,
      stakeShares: input.stakeShares,
      isComplete: true,
      warnings: nextWarnings,
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

  // count === 0: something changed since `before` was read (isComplete
  // flipped, identity changed, or warnings changed concurrently). Re-read and
  // classify why, rather than assuming failure. Never write in any of these
  // branches.
  const after = await client.rawEndedHexStakeObservation.findUnique({
    where: { id: input.id },
    select: {
      chainId: true,
      walletAddress: true,
      stakeId: true,
      endBlockNumber: true,
      isComplete: true,
      lockedDay: true,
      stakeShares: true,
      warnings: true,
    },
  });

  const postClassified = classifyAgainstSnapshot(after, input, walletAddress);
  if (postClassified) return postClassified;

  // Identity matches, still incomplete, yet the conditional update matched
  // zero rows — warnings (or some other unmodeled field) changed concurrently.
  // Fail closed rather than guess or overwrite.
  return { outcome: "state_changed" };
}
