import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { PHEX_ADDRESS } from "@/config/assets";
import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";
import {
  enrichEndedHexStakeObservation,
  readEndedHexStakeObservations,
  type EnrichEndedHexStakeObservationInput,
} from "@/services/hexmining/ended-stake-observation-store";
import { getDb } from "@/lib/db";

// ─── Purpose ────────────────────────────────────────────────────────────────────
//
// Recovers lockedDay/stakeShares for native PulseChain (pHEX) ended-stake
// observations that have no transaction-backed RawStakeAction START evidence, by
// reading the HEX contract's own historical state — stakeLists(wallet, index) —
// pinned to endBlockNumber-1 (the last block before the stake's StakeEnd tx). It
// never scans transaction history and never fabricates a RawStakeAction row.
//
// This is strictly an enrichment path over already-discovered, already-persisted
// RawEndedHexStakeObservation rows (Phase 5's discoverEndedHexStakes). It never
// creates a new observation — see ended-stake-observation-store.ts's
// enrichEndedHexStakeObservation for the atomic, identity-bound, create-free
// write path this calls.

const PULSECHAIN_CHAIN_ID = 369;

// Distinct from the store's `discoveryMethod` vocabulary (raw_stake_action,
// rpc_history) — this describes how the *missing evidence fields* were later
// recovered, not how the END event itself was originally discovered.
const EVIDENCE_RECOVERY_METHOD = "historical_contract_state";
const EVIDENCE_RECOVERY_SOURCE_FUNCTION = "stakeLists";

// stakeShares must remain a raw unsigned-integer decimal string end-to-end
// (uint72 range) — never Number()/parseInt()/parseFloat(). Matches the pattern
// used throughout hexmining discovery/reader code.
const RAW_UNSIGNED_INTEGER_PATTERN = /^\d+$/;

const PHEX_STAKE_READ_ABI = parseAbi([
  "function stakeCount(address stakerAddr) view returns (uint256)",
  "function stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type HistoricalStateReadClient = Pick<PublicClient, "readContract">;

// readEndedHexStakeObservations and enrichEndedHexStakeObservation each declare
// their own narrow client type (the former needs findMany; the latter needs
// updateMany + findUnique). Neither is a subtype of the other, so the injected
// dependency here is declared as its own minimal shape covering exactly what
// this service calls, and cast to each callee's expected type at the call
// site — the same narrow-client-cast pattern used throughout this service
// layer (e.g. `getDb() as unknown as ObservationClient`).
type ReadClient = NonNullable<Parameters<typeof readEndedHexStakeObservations>[1]>;
type EnrichClient = NonNullable<Parameters<typeof enrichEndedHexStakeObservation>[1]>;

export type PersistenceClient = {
  rawEndedHexStakeObservation: {
    findMany: ReadClient["rawEndedHexStakeObservation"]["findMany"];
    updateMany: EnrichClient["rawEndedHexStakeObservation"]["updateMany"];
    findUnique: EnrichClient["rawEndedHexStakeObservation"]["findUnique"];
  };
};

export type RecoverEndedHexStakeHistoricalStateInput = {
  chainId: number;
  walletAddress: string;
  dryRun: boolean;
};

export type RecoverEndedHexStakeHistoricalStateDeps = {
  publicClient: HistoricalStateReadClient;
  persistenceClient?: PersistenceClient;
  // Injectable clock for deterministic tests; defaults to real time.
  now?: () => Date;
};

export type RecoveryOutcomeStatus =
  | "already_complete"
  | "would_update"
  | "updated"
  | "no_match"
  | "multiple_match"
  | "rpc_failed"
  | "invalid_evidence"
  | "concurrent_matching_completion"
  | "concurrent_conflict"
  | "state_changed"
  | "observation_missing";

export type RecoveryOutcome = {
  id: string;
  stakeId: string;
  endBlockNumber: string;
  status: RecoveryOutcomeStatus;
  code?: string;
};

export type RecoverEndedHexStakeHistoricalStateResult =
  | {
      ok: true;
      dryRun: boolean;
      scanned: number;
      planned: number;
      alreadyComplete: number;
      recovered: number;
      updated: number;
      noMatch: number;
      multipleMatch: number;
      concurrentMatchingCompletion: number;
      concurrentConflict: number;
      stateChanged: number;
      observationMissing: number;
      rpcFailures: number;
      validationFailures: number;
      totalFailures: number;
      outcomes: RecoveryOutcome[];
    }
  | { ok: false; code: string };

// ─── Recovery orchestration ───────────────────────────────────────────────────
//
// Mirrors the shape of hsi-reader.ts's enrichHsiStakeObservations: reads already-
// persisted observations, skips complete ones, attempts recovery for the rest,
// and reports a structured outcome per row. Never throws on a per-row failure —
// every failure path is a classified outcome with no mutation.

export async function recoverEndedHexStakeHistoricalState(
  input: RecoverEndedHexStakeHistoricalStateInput,
  deps: RecoverEndedHexStakeHistoricalStateDeps,
): Promise<RecoverEndedHexStakeHistoricalStateResult> {
  if (input.chainId !== PULSECHAIN_CHAIN_ID) {
    return { ok: false, code: "hexmining-ended-stake-recovery-unsupported-chain" };
  }

  const persistenceClient =
    deps.persistenceClient ?? (getDb() as unknown as PersistenceClient);
  const now = deps.now ?? (() => new Date());
  const walletAddress = input.walletAddress.toLowerCase();

  const observations = await readEndedHexStakeObservations(
    { chainId: input.chainId, walletAddress },
    persistenceClient as unknown as ReadClient,
  );

  let alreadyComplete = 0;
  let recovered = 0;
  let updated = 0;
  let noMatch = 0;
  let multipleMatch = 0;
  let concurrentMatchingCompletion = 0;
  let concurrentConflict = 0;
  let stateChanged = 0;
  let observationMissing = 0;
  let rpcFailures = 0;
  let validationFailures = 0;

  const outcomes: RecoveryOutcome[] = [];

  for (const observation of observations) {
    const base = {
      id: observation.id,
      stakeId: observation.stakeId,
      endBlockNumber: observation.endBlockNumber.toString(),
    };

    if (observation.isComplete) {
      alreadyComplete++;
      outcomes.push({ ...base, status: "already_complete" });
      continue;
    }

    // Every read for this stake is pinned to the same historical block: the
    // last block before its StakeEnd transaction. Never "latest" — that would
    // read post-fork/current state, not the state that existed when this stake
    // was actually staked.
    const historicalBlock = observation.endBlockNumber - 1n;

    const attempt = await recoverOne({
      publicClient: deps.publicClient,
      walletAddress,
      targetStakeId: observation.stakeId,
      historicalBlock,
    });

    if (!attempt.ok) {
      const classified = classifyAttemptFailure(attempt.code);
      if (classified === "no_match") noMatch++;
      else if (classified === "multiple_match") multipleMatch++;
      else if (classified === "rpc_failed") rpcFailures++;
      else validationFailures++;
      outcomes.push({ ...base, status: classified, code: attempt.code });
      continue;
    }

    recovered++;

    if (input.dryRun) {
      outcomes.push({ ...base, status: "would_update" });
      continue;
    }

    const enrichInput: EnrichEndedHexStakeObservationInput = {
      id: observation.id,
      chainId: input.chainId,
      walletAddress,
      stakeId: observation.stakeId,
      endBlockNumber: observation.endBlockNumber,
      lockedDay: attempt.lockedDay,
      stakeShares: attempt.stakeShares,
      // warnings are no longer supplied here — enrichEndedHexStakeObservation
      // reads the row's current persisted warnings itself and removes only
      // the obsolete lockedday-unknown code, preserving every other warning.
      evidenceRecoveryMethod: EVIDENCE_RECOVERY_METHOD,
      evidenceRecoveryBlockNumber: historicalBlock,
      evidenceRecoverySourceContract: PHEX_ADDRESS.toLowerCase(),
      evidenceRecoverySourceFunction: EVIDENCE_RECOVERY_SOURCE_FUNCTION,
      evidenceRecoveryReturnedStakeId: attempt.returnedStakeId,
      evidenceRecoveredAt: now(),
    };

    const enrichResult = await enrichEndedHexStakeObservation(
      enrichInput,
      persistenceClient as unknown as EnrichClient,
    );

    switch (enrichResult.outcome) {
      case "updated":
        updated++;
        outcomes.push({ ...base, status: "updated" });
        break;
      case "concurrent_matching_completion":
        concurrentMatchingCompletion++;
        outcomes.push({ ...base, status: "concurrent_matching_completion" });
        break;
      case "concurrent_conflict":
        concurrentConflict++;
        outcomes.push({ ...base, status: "concurrent_conflict" });
        break;
      case "state_changed":
        stateChanged++;
        outcomes.push({ ...base, status: "state_changed" });
        break;
      case "observation_missing":
        observationMissing++;
        outcomes.push({ ...base, status: "observation_missing" });
        break;
    }
  }

  const totalFailures =
    noMatch +
    multipleMatch +
    rpcFailures +
    validationFailures +
    concurrentConflict +
    stateChanged +
    observationMissing;

  return {
    ok: true,
    dryRun: input.dryRun,
    scanned: observations.length,
    planned: observations.length - alreadyComplete,
    alreadyComplete,
    recovered,
    updated,
    noMatch,
    multipleMatch,
    concurrentMatchingCompletion,
    concurrentConflict,
    stateChanged,
    observationMissing,
    rpcFailures,
    validationFailures,
    totalFailures,
    outcomes,
  };
}

function classifyAttemptFailure(
  code: string,
): "no_match" | "multiple_match" | "rpc_failed" | "invalid_evidence" {
  if (code === "no_match") return "no_match";
  if (code === "multiple_match") return "multiple_match";
  if (code.startsWith("rpc-")) return "rpc_failed";
  return "invalid_evidence";
}

// ─── Single-stake historical-state read ──────────────────────────────────────

type RecoverOneArgs = {
  publicClient: HistoricalStateReadClient;
  walletAddress: string;
  targetStakeId: string;
  historicalBlock: bigint;
};

type RecoverOneResult =
  | { ok: true; lockedDay: number; stakeShares: string; returnedStakeId: string }
  | { ok: false; code: string };

async function recoverOne(args: RecoverOneArgs): Promise<RecoverOneResult> {
  let stakeCount: bigint;
  try {
    stakeCount = (await args.publicClient.readContract({
      address: PHEX_ADDRESS as `0x${string}`,
      abi: PHEX_STAKE_READ_ABI,
      functionName: "stakeCount",
      args: [args.walletAddress as `0x${string}`],
      blockNumber: args.historicalBlock,
    })) as bigint;
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return { ok: false, code: `rpc-stake-count-${failure.code}` };
  }

  const matches: { lockedDay: number; stakeShares: bigint; returnedStakeId: string }[] = [];

  for (let index = 0n; index < stakeCount; index += 1n) {
    let raw: readonly [number, bigint, bigint, number, number, number, boolean];
    try {
      raw = (await args.publicClient.readContract({
        address: PHEX_ADDRESS as `0x${string}`,
        abi: PHEX_STAKE_READ_ABI,
        functionName: "stakeLists",
        args: [args.walletAddress as `0x${string}`, index],
        blockNumber: args.historicalBlock,
      })) as readonly [number, bigint, bigint, number, number, number, boolean];
    } catch (error) {
      const failure = classifyRpcFailure({ error });
      return { ok: false, code: `rpc-stake-lists-${failure.code}` };
    }

    const returnedStakeId = raw[0].toString();
    if (returnedStakeId === args.targetStakeId) {
      matches.push({ lockedDay: Number(raw[3]), stakeShares: raw[2], returnedStakeId });
    }
  }

  if (matches.length === 0) {
    return { ok: false, code: "no_match" };
  }
  if (matches.length > 1) {
    return { ok: false, code: "multiple_match" };
  }

  const match = matches[0]!;

  // Re-validate before persistence, independently of the filter above: the
  // returned stakeId must exactly equal the target, lockedDay must be a safe
  // non-negative integer (uint16 range), and stakeShares must be a
  // non-negative digit-only string.
  if (match.returnedStakeId !== args.targetStakeId) {
    return { ok: false, code: "stake-id-mismatch" };
  }
  if (!Number.isSafeInteger(match.lockedDay) || match.lockedDay < 0) {
    return { ok: false, code: "invalid-locked-day" };
  }
  const stakeSharesStr = match.stakeShares.toString();
  if (!RAW_UNSIGNED_INTEGER_PATTERN.test(stakeSharesStr)) {
    return { ok: false, code: "invalid-stake-shares" };
  }

  return {
    ok: true,
    lockedDay: match.lockedDay,
    stakeShares: stakeSharesStr,
    returnedStakeId: match.returnedStakeId,
  };
}
