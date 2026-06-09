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
  | { status: "calculation_not_implemented" | "insufficient_formula_evidence" | "bpd_not_implemented" }
  | { status: "calculated"; totalYieldHearts: bigint };

// HEX Big Pay Day — protocol day 353. BPD yield is separate and must never be
// silently included in the per-day formula sum (roadmap §11.4 invariant #5).
const BPD_DAY = 353;

// Default calculation boundary.
// Formula per docs/hex-dailydata-packing-spec.md §8 (test vectors A–E):
//   perDayYield = (stakeShares × dayPayoutTotal) / dayStakeSharesTotal  (bigint floor)
//   zero dayStakeSharesTotal → 0n contribution for that day
//   BPD (day 353) → bpd_not_implemented if the range spans it
// All arithmetic is bigint-only; no Number conversion.
function defaultApplyCalculation(
  entries: readonly DecodedDailyDataEntry[],
  args: HexMiningYieldEstimateArgs,
): YieldCalculationResult {
  if (args.rangeStartDay <= BPD_DAY && BPD_DAY <= args.rangeEndDay) {
    return { status: "bpd_not_implemented" };
  }
  let total = 0n;
  for (const entry of entries) {
    if (entry.dayStakeSharesTotal === 0n) continue;
    total += (args.stakeShares * entry.dayPayoutTotal) / entry.dayStakeSharesTotal;
  }
  return { status: "calculated", totalYieldHearts: total };
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
  const calcResult = applyCalculation(packedResult.entries, args);

  // 9. Calculation succeeded — return estimated with bigint-safe decimal string yieldHex
  if (calcResult.status === "calculated") {
    return {
      status: "estimated",
      schemaVersion: "v1",
      yieldHex: calcResult.totalYieldHearts.toString(),
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

  // 10. Formula deferred (not_implemented / bpd_not_implemented) → evidence_available
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
