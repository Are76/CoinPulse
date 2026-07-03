import "server-only";

import {
  readEndedHexStakeObservations,
  type PersistedEndedHexStakeObservation,
} from "@/services/hexmining/ended-stake-observation-store";
import type { EndedHexStakeDto, EndedHexStakeListDto } from "@/services/hexmining/types";
import { getDb } from "@/lib/db";

// ─── Input ────────────────────────────────────────────────────────────────────

export type ReadEndedHexStakesInput = {
  chainId: number;
  walletAddress: string;
};

// ─── Narrow client type ───────────────────────────────────────────────────────

type ReaderClient = Parameters<typeof readEndedHexStakeObservations>[1];

// ─── Reader ───────────────────────────────────────────────────────────────────
//
// Reads all persisted RawEndedHexStakeObservation rows for a wallet+chain and
// assembles them into EndedHexStakeListDto. Source of truth is the DB; no RPC.
//
// isComplete on the list is false when any row has isComplete: false (indicating
// that lockedDay, stakeShares, or other fields could not be recovered at
// discovery time). Individual row warnings are aggregated at the list level.

export async function readEndedHexStakes(
  input: ReadEndedHexStakesInput,
  client: ReaderClient = getDb() as unknown as ReaderClient,
): Promise<EndedHexStakeListDto> {
  const walletAddress = input.walletAddress.toLowerCase();

  const rows = await readEndedHexStakeObservations(
    { chainId: input.chainId, walletAddress },
    client,
  );

  const stakes = rows.map(mapObservationToDto);

  const hasIncomplete = stakes.some((s) => !s.isComplete);
  const listWarnings = stakes.flatMap((s) => s.warnings);

  return {
    schemaVersion: "v1",
    chainId: input.chainId,
    walletAddress,
    stakes,
    totalCount: stakes.length,
    isComplete: !hasIncomplete,
    warnings: listWarnings,
  };
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

function mapObservationToDto(row: PersistedEndedHexStakeObservation): EndedHexStakeDto {
  return {
    schemaVersion: "v1",
    id: row.id,
    chainId: row.chainId,
    walletAddress: row.walletAddress,
    stakeId: row.stakeId,
    stakeIndex: row.stakeIndex,
    stakedDays: row.stakedDays,
    lockedDay: row.lockedDay,
    stakeShares: row.stakeShares,
    principalHex: row.principalHex,
    yieldHex: row.yieldHex,
    penaltyHex: row.penaltyHex,
    endTxHash: row.endTxHash,
    endBlockNumber: row.endBlockNumber.toString(),
    startTxHash: row.startTxHash,
    startBlockNumber: row.startBlockNumber == null ? null : row.startBlockNumber.toString(),
    discoveryMethod: row.discoveryMethod,
    observedAt: row.observedAt.toISOString(),
    isComplete: row.isComplete,
    warnings: row.warnings,
  };
}
