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
  lockedDay: number;
  stakedDays: number;
  currentDay: number;
  rangeStartDay: number;
  rangeEndDay: number;
};

// ─── Internal calculation boundary ───────────────────────────────────────────

// Not exported — internal scaffold only. Never included in public result types.
type YieldCalculationStatus =
  | "calculation_not_implemented"
  | "insufficient_formula_evidence";

type YieldCalculationResult = {
  status: YieldCalculationStatus;
};

// Default calculation boundary.
// Yield formula is documented in docs/hex-dailydata-packing-spec.md §3:
//   per-day contribution ≈ (stakeShares / dayStakeSharesTotal) * dayPayoutTotal
//   summed across elapsed active days: lockedDay to min(currentDay, lockedDay+stakedDays-1)
// (refs: §11.4 yield status policy, §11.9 minimum provenance requirements)
//
// Not implemented because:
//   (a) stakeShares is not yet available in HexMiningYieldEstimateArgs (requires stakeLists wiring)
//   (b) no deterministic test vectors for the full yield formula exist in-repo
// Returns calculation_not_implemented until both prerequisites are met.
function defaultApplyCalculation(
  entries: readonly DecodedDailyDataEntry[],
  args: HexMiningYieldEstimateArgs,
): YieldCalculationResult {
  void entries;
  void args;
  return { status: "calculation_not_implemented" };
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
  // calculation_not_implemented → evidence_available: formula deferred, not an error
  const applyCalculation = deps.applyCalculation ?? defaultApplyCalculation;
  applyCalculation(packedResult.entries, args);

  // 9. Evidence validated and decoded — yield formula deferred
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
