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
const WARN_LOCKED_DAY_UNKNOWN = "hexmining-ended-stake-lockedday-unknown";

// ─── Discovery ────────────────────────────────────────────────────────────────
//
// Reads endStake RawStakeAction records for a wallet and persists one
// RawEndedHexStakeObservation per ended stake using discoveryMethod
// "raw_stake_action". Skips any record that lacks a stakeId.
//
// lockedDay and stakeShares are not available in RawStakeAction; they are
// always null and isComplete is false when either is missing.

export async function discoverEndedHexStakes(
  input: DiscoverEndedHexStakesInput,
  clients: DiscoveryClients = {
    rawClient: getDb(),
    observationClient: getDb() as ObservationClient,
  },
): Promise<DiscoverEndedHexStakesResult> {
  const { chainId, walletAddress, fromBlock, toBlock } = input;
  const { rawClient, observationClient } = clients;

  const allActions = await readWalletRawStakeActions(
    { chainId, walletAddress, fromBlock, toBlock },
    rawClient,
  );

  const endActions = allActions.filter((a) => a.actionKind === "END");

  let persisted = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const action of endActions) {
    if (action.stakeId == null) {
      skipped++;
      warnings.push(`${WARN_NO_STAKE_ID}:tx=${action.txHash}`);
      continue;
    }

    const startRecord = await readStakeStartSnapshotByStakeId(
      { chainId, walletAddress, stakeId: action.stakeId },
      rawClient,
    );

    const stakeIdStr = action.stakeId.toString();
    const actionWarnings: string[] = [WARN_LOCKED_DAY_UNKNOWN];

    const observationInput: PersistEndedHexStakeObservationInput = {
      chainId,
      walletAddress,
      stakeId: stakeIdStr,
      stakeIndex: action.stakeIndex ?? startRecord?.stakeIndex ?? null,
      stakedDays: startRecord?.stakedDays ?? action.stakedDays ?? null,
      lockedDay: null,
      stakeShares: null,
      principalHex: startRecord?.principalLockedRaw ?? action.principalLockedRaw ?? null,
      yieldHex: action.yieldRaw ?? null,
      penaltyHex: action.penaltyRaw ?? null,
      endTxHash: action.txHash,
      endBlockNumber: action.blockNumber,
      startTxHash: startRecord?.txHash ?? null,
      startBlockNumber: startRecord?.blockNumber ?? null,
      discoveryMethod: "raw_stake_action",
      observedAt: new Date(),
      isComplete: false,
      warnings: actionWarnings,
    };

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
    discovered: endActions.length,
    persisted,
    skipped,
    warnings,
  };
}
