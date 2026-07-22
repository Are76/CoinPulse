import "server-only";

import {
  readStakeStartSnapshotByStakeId,
  readWalletRawStakeActions,
} from "@/services/ingestion/raw-store";
import {
  persistEndedHexStakeObservation,
  type PersistEndedHexStakeObservationInput,
} from "@/services/hexmining/ended-stake-observation-store";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscoverEndedHexStakesInput = {
  chainId: number;
  walletAddress: string;
  fromBlock: bigint;
  toBlock: bigint;
};

export type DiscoverEndedHexStakesResult = {
  discovered: number;
  persisted: number;
  skipped: number;
  warnings: string[];
};

// ─── Narrow client types ─────────────────────────────────────────────────────

type RawActionClient = {
  rawStakeAction: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    findFirst?(args: unknown): Promise<Record<string, unknown> | null>;
  };
};

type ObservationClient = Parameters<typeof persistEndedHexStakeObservation>[1];

type DiscoveryClients = {
  rawClient: RawActionClient;
  observationClient: ObservationClient;
};

// ─── Warning codes ────────────────────────────────────────────────────────────

const WARN_NO_STAKE_ID = "hexmining-ended-stake-stakeid-unknown";
// Signals that the START-time evidence required to complete an ended-stake
// observation (both lockedDay and stakeShares) is missing. The identifier is a
// stable contract consumed by route tests and docs, so it is retained verbatim
// even though completeness now requires both fields rather than lockedDay alone.
const WARN_INCOMPLETE_START_EVIDENCE = "hexmining-ended-stake-lockedday-unknown";

// ─── Discovery ────────────────────────────────────────────────────────────────
//
// Reads endStake RawStakeAction records for a wallet and persists one
// RawEndedHexStakeObservation per ended stake using discoveryMethod
// "raw_stake_action". Skips any record that lacks a stakeId.
//
// lockedDay and stakeShares are read from the matched START snapshot (persisted
// on RawStakeAction START rows). When both are present the observation is marked
// complete; when either is missing the missing value is preserved as null,
// isComplete stays false, and the incomplete-evidence warning is retained.
// Missing values are never fabricated, defaulted, zero-coerced, or inferred.

// Completeness requires BOTH start-time evidence fields. stakeShares must be a
// raw unsigned-integer decimal string (uint72 range); an empty or malformed
// value is treated as missing, never coerced through Number(). This is a local
// pattern matching the project convention, not a shared project-wide validator.
const RAW_UNSIGNED_INTEGER_PATTERN = /^\d+$/;

export async function discoverEndedHexStakes(
  input: DiscoverEndedHexStakesInput,
  clients: DiscoveryClients = {
    rawClient: getDb(),
    observationClient: getDb() as unknown as ObservationClient,
  },
): Promise<DiscoverEndedHexStakesResult> {
  const { chainId, walletAddress, fromBlock, toBlock } = input;
  const { rawClient, observationClient } = clients;

  const allActions = await readWalletRawStakeActions(
    { chainId, walletAddress, fromBlock, toBlock },
    rawClient,
  );

  const endActions = allActions.filter(
    (a) => a.actionKind === "END" && a.protocolSlug === "hex",
  );

  let discovered = 0;
  let persisted = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const action of endActions) {
    if (action.stakeId == null) {
      skipped++;
      warnings.push(`${WARN_NO_STAKE_ID}:tx=${action.txHash}`);
      continue;
    }

    discovered++;

    const startRecord = await readStakeStartSnapshotByStakeId(
      { chainId, walletAddress, stakeId: action.stakeId },
      rawClient,
    );

    const stakeIdStr = action.stakeId.toString();

    // Consume persisted START-time evidence. These are the mapped nullable
    // values from the START snapshot; the missing value is preserved as null.
    const startLockedDay = startRecord?.lockedDay ?? null;
    const startStakeShares = startRecord?.stakeShares ?? null;

    // Completeness is strictly: both present AND stakeShares is a canonical
    // unsigned-integer string. Zero is a valid present value (not missing);
    // empty/malformed stakeShares is treated as missing without coercion.
    const hasCompleteStartEvidence =
      startLockedDay != null &&
      startStakeShares != null &&
      RAW_UNSIGNED_INTEGER_PATTERN.test(startStakeShares);

    const observationInput: PersistEndedHexStakeObservationInput = {
      chainId,
      walletAddress,
      stakeId: stakeIdStr,
      stakeIndex: action.stakeIndex ?? startRecord?.stakeIndex ?? null,
      stakedDays: startRecord?.stakedDays ?? action.stakedDays ?? null,
      lockedDay: startLockedDay,
      stakeShares: startStakeShares,
      principalHex: startRecord?.principalLockedRaw ?? action.principalLockedRaw ?? null,
      yieldHex: action.yieldRaw ?? null,
      penaltyHex: action.penaltyRaw ?? null,
      endTxHash: action.txHash,
      endBlockNumber: action.blockNumber,
      startTxHash: startRecord?.txHash ?? null,
      startBlockNumber: startRecord?.blockNumber ?? null,
      discoveryMethod: "raw_stake_action",
      observedAt: new Date(),
      isComplete: hasCompleteStartEvidence,
      warnings: hasCompleteStartEvidence ? [] : [WARN_INCOMPLETE_START_EVIDENCE],
    };

    if (!hasCompleteStartEvidence) {
      warnings.push(`${WARN_INCOMPLETE_START_EVIDENCE}:stake=${stakeIdStr}`);
    }

    const result = await persistEndedHexStakeObservation(
      observationInput,
      observationClient,
    );

    if (result.created) {
      persisted++;
    } else {
      skipped++;
    }
  }

  return {
    discovered,
    persisted,
    skipped,
    warnings,
  };
}
