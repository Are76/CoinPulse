import "server-only";

import { decodePackedDailyDataRange, type DecodedDailyDataEntry } from "@/services/hexmining/daily-data-packed-decoder";
import { decodeDailyDataPayload } from "@/services/hexmining/daily-data-payload-decoder";
import {
  estimateHexMiningYield,
  type HexMiningYieldEstimateArgs,
  type HexMiningYieldEstimatorDeps,
} from "@/services/hexmining/yield-estimator";

const PULSECHAIN_CHAIN_ID = 369;

export type HexMiningVerificationHarnessInput = {
  observationId: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: string | bigint;
  canonicalPayload: string;
  stakeShares: bigint;
  isInvalidated?: boolean;
  rpcEndpointLabel?: string | null;
};

export type HexMiningVerificationProvenanceSummary = {
  chainId: 369;
  sourceFamily: "HEXMINING";
  observationId: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: string;
  rpcEndpointLabel: string | null;
};

export type HexMiningVerificationHarnessResult = {
  passed: boolean;
  failureCode: string | null;
  warnings: string[];
  provenance: HexMiningVerificationProvenanceSummary;
  formula: {
    reproducedYieldHex: string | null;
    estimatorInternalYieldHex: string | null;
    entryCount: number | null;
  };
  estimatorStatus: string | null;
};

type VerificationHarnessDeps = {
  estimatorCalculation?: (
    entries: readonly DecodedDailyDataEntry[],
    args: HexMiningYieldEstimateArgs,
  ) => { status: "estimated"; yieldHex: string };
};

function makeProvenance(
  input: HexMiningVerificationHarnessInput,
): HexMiningVerificationProvenanceSummary {
  return {
    chainId: PULSECHAIN_CHAIN_ID,
    sourceFamily: "HEXMINING",
    observationId: input.observationId,
    rangeStartDay: input.rangeStartDay,
    rangeEndDay: input.rangeEndDay,
    observedAtBlock: input.observedAtBlock.toString(),
    rpcEndpointLabel: input.rpcEndpointLabel ?? null,
  };
}

function fail(
  input: HexMiningVerificationHarnessInput,
  failureCode: string,
  warnings: string[],
  formula: HexMiningVerificationHarnessResult["formula"] = {
    reproducedYieldHex: null,
    estimatorInternalYieldHex: null,
    entryCount: null,
  },
  estimatorStatus: string | null = null,
): HexMiningVerificationHarnessResult {
  return {
    passed: false,
    failureCode,
    warnings,
    provenance: makeProvenance(input),
    formula,
    estimatorStatus,
  };
}

function calculateYieldHex(
  entries: readonly DecodedDailyDataEntry[],
  stakeShares: bigint,
): string {
  let total = 0n;
  for (const entry of entries) {
    if (entry.dayStakeSharesTotal === 0n) continue;
    total += (stakeShares * entry.dayPayoutTotal) / entry.dayStakeSharesTotal;
  }
  return total.toString();
}

function makeEstimatorArgs(
  input: HexMiningVerificationHarnessInput,
): HexMiningYieldEstimateArgs {
  const elapsedDays = input.rangeEndDay - input.rangeStartDay + 1;
  return {
    chainId: PULSECHAIN_CHAIN_ID,
    stakeId: input.observationId,
    stakeShares: input.stakeShares,
    lockedDay: input.rangeStartDay,
    stakedDays: elapsedDays,
    currentDay: input.rangeEndDay + 1,
    rangeStartDay: input.rangeStartDay,
    rangeEndDay: input.rangeEndDay,
  };
}

export async function verifyHexMiningYieldEvidence(
  input: HexMiningVerificationHarnessInput,
  deps: VerificationHarnessDeps = {},
): Promise<HexMiningVerificationHarnessResult> {
  const payloadResult = decodeDailyDataPayload(input.canonicalPayload);
  if (!payloadResult.ok) {
    return fail(input, "hexmining-verification-invalid-payload", payloadResult.warnings);
  }

  if (input.isInvalidated === true) {
    return fail(input, "hexmining-verification-observation-invalidated", [
      "hexmining-yield-observation-invalidated",
    ]);
  }

  const packedResult = decodePackedDailyDataRange(payloadResult.dailyData);
  if (!packedResult.ok) {
    return fail(input, "hexmining-verification-packed-decode-failed", [
      `hexmining-verification-${packedResult.code}-at-${packedResult.index}`,
    ]);
  }

  const reproducedYieldHex = calculateYieldHex(packedResult.entries, input.stakeShares);
  let estimatorInternalYieldHex: string | null = null;

  const args = makeEstimatorArgs(input);
  const estimatorDeps: HexMiningYieldEstimatorDeps = {
    fetchEvidence: async () => ({
      observationId: input.observationId,
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: "HEXMINING",
      rangeStartDay: input.rangeStartDay,
      rangeEndDay: input.rangeEndDay,
      observedAtBlock: input.observedAtBlock.toString(),
      observedAt: "1970-01-01T00:00:00.000Z",
      payloadVersion: payloadResult.schemaVersion,
      payloadSchemaValid: true,
      isInvalidated: false,
      warnings: [],
      canonicalPayload: input.canonicalPayload,
    }),
    applyCalculation: (entries, estimatorArgs) => {
      const result = deps.estimatorCalculation?.(entries, estimatorArgs) ?? {
        status: "estimated" as const,
        yieldHex: calculateYieldHex(entries, estimatorArgs.stakeShares),
      };
      estimatorInternalYieldHex = result.yieldHex;
      return result;
    },
  };

  const estimatorResult = await estimateHexMiningYield(args, estimatorDeps);
  const formula = {
    reproducedYieldHex,
    estimatorInternalYieldHex,
    entryCount: packedResult.entries.length,
  };

  if (estimatorResult.status !== "evidence_available") {
    return fail(
      input,
      "hexmining-verification-estimator-not-evidence-available",
      estimatorResult.warnings,
      formula,
      estimatorResult.status,
    );
  }

  if (estimatorInternalYieldHex !== reproducedYieldHex) {
    return fail(
      input,
      "hexmining-verification-estimator-mismatch",
      ["hexmining-verification-estimator-mismatch"],
      formula,
      estimatorResult.status,
    );
  }

  return {
    passed: true,
    failureCode: null,
    warnings: estimatorResult.warnings,
    provenance: makeProvenance(input),
    formula,
    estimatorStatus: estimatorResult.status,
  };
}
