import "server-only";

import { decodeDailyDataPayload } from "@/services/hexmining/daily-data-payload-decoder";
import {
  decodePackedDailyDataRange,
  type DecodedDailyDataEntry,
} from "@/services/hexmining/daily-data-packed-decoder";
import type { ObservationEvidenceMetadata } from "@/services/hexmining/observation-evidence-provider";

export type { ObservationEvidenceMetadata };

const PULSECHAIN_CHAIN_ID = 369;

// ─── Args ─────────────────────────────────────────────────────────────────────

export type HexMiningYieldEstimateArgs = {
  chainId: number;
  stakeId: string;
  stakeShares: bigint;
  lockedDay: number;
  stakedDays: number;
  currentDay: number;
  rangeStartDay: number;
  rangeEndDay: number;
};

// ─── Internal calculation boundary ───────────────────────────────────────────

// Not exported — internal scaffold only. Never included in public result types.
type YieldCalculationResult =
  | { status: "estimated"; yieldHex: string }
  | { status: "calculation_not_implemented" | "insufficient_formula_evidence" };

// Yield formula from docs/hex-dailydata-packing-spec.md §8.
// Per-day: (stakeShares × dayPayoutTotal) / dayStakeSharesTotal (bigint floor; multiply-first).
// dayStakeSharesTotal === 0n → 0n contribution (no active stakers; guard against divide-by-zero).
// BPD (day 353) is not detected at this layer — entries carry no day numbers.
// Test vectors A–E in §8 must pass before this function may be changed.
function defaultApplyCalculation(
  entries: readonly DecodedDailyDataEntry[],
  args: HexMiningYieldEstimateArgs,
): YieldCalculationResult {
  let total = 0n;
  for (const entry of entries) {
    if (entry.dayStakeSharesTotal === 0n) continue;
    total += (args.stakeShares * entry.dayPayoutTotal) / entry.dayStakeSharesTotal;
  }
  return { status: "estimated", yieldHex: total.toString() };
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

// canonicalPayload is needed by the decode layer (steps 6–7) but is never
// included in result types or surfaced to callers.
type EvidenceWithPayload = ObservationEvidenceMetadata & {
  canonicalPayload: string;
};

export type HexMiningYieldEstimatorDeps = {
  fetchEvidence: (args: {
    chainId: number;
    rangeStartDay: number;
    rangeEndDay: number;
  }) => Promise<EvidenceWithPayload | null>;
  // Injectable for tests — defaults to defaultApplyCalculation.
  applyCalculation?: (
    entries: readonly DecodedDailyDataEntry[],
    args: HexMiningYieldEstimateArgs,
  ) => YieldCalculationResult;
};

// ─── Result ───────────────────────────────────────────────────────────────────

export type HexMiningYieldEstimateProvenance = {
  chainId: number;
  sourceFamily: "HEXMINING";
  observationId: string | null;
  rangeStartDay: number | null;
  rangeEndDay: number | null;
};

export type HexMiningYieldEstimateResult =
  | {
      status: "estimated";
      schemaVersion: "v1";
      yieldHex: string;
      provenance: HexMiningYieldEstimateProvenance;
      warnings: string[];
    }
  | {
      status: "evidence_available";
      schemaVersion: "v1";
      yieldHex: null;
      provenance: HexMiningYieldEstimateProvenance;
      warnings: string[];
    }
  | {
      status: "insufficient_observations" | "invalid_observation" | "unavailable" | "unsupported";
      schemaVersion: "v1";
      yieldHex: null;
      provenance: HexMiningYieldEstimateProvenance;
      warnings: string[];
    };

// ─── Service ──────────────────────────────────────────────────────────────────

export async function estimateHexMiningYield(
  args: HexMiningYieldEstimateArgs,
  deps: HexMiningYieldEstimatorDeps,
): Promise<HexMiningYieldEstimateResult> {
  // 1. Chain guard
  if (args.chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      status: "unsupported",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: null,
        rangeEndDay: null,
      },
      warnings: [`hexmining-yield-unsupported-chain-${args.chainId}`],
    };
  }

  // 1.5. Validate stakeShares — must be strictly positive; zero or negative is invalid.
  if (args.stakeShares <= 0n) {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      },
      warnings: ["hexmining-yield-invalid-stake-shares"],
    };
  }

  // 2. Fetch evidence via injected provider (no RPC)
  let evidence: EvidenceWithPayload | null;
  try {
    evidence = await deps.fetchEvidence({
      chainId: args.chainId,
      rangeStartDay: args.rangeStartDay,
      rangeEndDay: args.rangeEndDay,
    });
  } catch {
    return {
      status: "unavailable",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      },
      warnings: ["hexmining-yield-evidence-provider-failed"],
    };
  }

  // 3. No evidence available
  if (evidence === null) {
    return {
      status: "insufficient_observations",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      },
      warnings: ["hexmining-yield-no-observation-evidence"],
    };
  }

  // 4. Observation invalidated
  if (evidence.isInvalidated) {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-observation-invalidated"],
    };
  }

  // 5. Payload schema invalid (provider pre-validation guard)
  if (!evidence.payloadSchemaValid) {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-invalid-observation-payload"],
    };
  }

  // 5.5. Elapsed-days coverage check
  // HEX currentDay is the active (not-yet-finalized) day; only days strictly before it are elapsed.
  // Required range: [lockedDay, elapsedEndDay] inclusive, where
  //   elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1).
  const elapsedEndDay = Math.min(args.currentDay - 1, args.lockedDay + args.stakedDays - 1);

  if (args.currentDay <= args.lockedDay) {
    return {
      status: "insufficient_observations",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-no-elapsed-days"],
    };
  }

  if (evidence.rangeStartDay > args.lockedDay || evidence.rangeEndDay < elapsedEndDay) {
    return {
      status: "insufficient_observations",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-insufficient-elapsed-day-coverage"],
    };
  }

  // 6. Decode canonicalPayload → bigint[]
  const payloadResult = decodeDailyDataPayload(evidence.canonicalPayload);
  if (!payloadResult.ok) {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-payload-decode-failed"],
    };
  }

  // 7. Decode packed uint256 entries — rejects values outside valid 200-bit range
  const packedResult = decodePackedDailyDataRange(payloadResult.dailyData);
  if (!packedResult.ok) {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: [...evidence.warnings, "hexmining-yield-packed-decode-failed"],
    };
  }

  // 8. Apply internal calculation boundary with decoded entries
  const applyCalculation = deps.applyCalculation ?? defaultApplyCalculation;
  applyCalculation(packedResult.entries, args);

  // 9. Calculation proven internally; public output is evidence_available.
  // The "estimated" path is gated until public DTO wiring is approved.
  return {
    status: "evidence_available",
    schemaVersion: "v1",
    yieldHex: null,
    provenance: {
      chainId: args.chainId,
      sourceFamily: "HEXMINING",
      observationId: evidence.observationId,
      rangeStartDay: evidence.rangeStartDay,
      rangeEndDay: evidence.rangeEndDay,
    },
    warnings: evidence.warnings,
  };
}
