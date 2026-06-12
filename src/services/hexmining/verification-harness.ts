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
  warnings?: string[];
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
    expectedEntryCount: number | null;
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
    expectedEntryCount: null,
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

function calculateExpectedEntryCount(input: HexMiningVerificationHarnessInput): number | null {
  if (input.rangeStartDay < 0 || input.rangeEndDay < 0) return null;

  const expectedEntryCount = input.rangeEndDay - input.rangeStartDay + 1;
  if (expectedEntryCount <= 0) return null;

  return expectedEntryCount;
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
  expectedEntryCount: number,
): HexMiningYieldEstimateArgs {
  return {
    chainId: PULSECHAIN_CHAIN_ID,
    stakeId: input.observationId,
    stakeShares: input.stakeShares,
    lockedDay: input.rangeStartDay,
    stakedDays: expectedEntryCount,
    currentDay: input.rangeEndDay + 1,
    rangeStartDay: input.rangeStartDay,
    rangeEndDay: input.rangeEndDay,
  };
}

export async function verifyHexMiningYieldEvidence(
  input: HexMiningVerificationHarnessInput,
  deps: VerificationHarnessDeps = {},
): Promise<HexMiningVerificationHarnessResult> {
  const upstreamWarnings = input.warnings ?? [];
  const expectedEntryCount = calculateExpectedEntryCount(input);

  if (expectedEntryCount === null) {
    return fail(input, "hexmining-verification-invalid-range", upstreamWarnings);
  }

  const payloadResult = decodeDailyDataPayload(input.canonicalPayload);
  if (!payloadResult.ok) {
    return fail(input, "hexmining-verification-invalid-payload", [
      ...upstreamWarnings,
      ...payloadResult.warnings,
    ]);
  }

  if (payloadResult.entryCount !== expectedEntryCount) {
    return fail(
      input,
      "hexmining-verification-payload-range-mismatch",
      [
        ...upstreamWarnings,
        `hexmining-verification-expected-${expectedEntryCount}-entries-got-${payloadResult.entryCount}`,
      ],
      {
        reproducedYieldHex: null,
        estimatorInternalYieldHex: null,
        entryCount: payloadResult.entryCount,
        expectedEntryCount,
      },
    );
  }

  if (input.isInvalidated === true) {
    return fail(input, "hexmining-verification-observation-invalidated", [
      ...upstreamWarnings,
      "hexmining-yield-observation-invalidated",
    ]);
  }

  const packedResult = decodePackedDailyDataRange(payloadResult.dailyData);
  if (!packedResult.ok) {
    return fail(input, "hexmining-verification-packed-decode-failed", [
      ...upstreamWarnings,
      `hexmining-verification-${packedResult.code}-at-${packedResult.index}`,
    ]);
  }

  const reproducedYieldHex = calculateYieldHex(packedResult.entries, input.stakeShares);
  let estimatorInternalYieldHex: string | null = null;

  const args = makeEstimatorArgs(input, expectedEntryCount);
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
      warnings: upstreamWarnings,
      canonicalPayload: input.canonicalPayload,
    }),
  };

  if (deps.estimatorCalculation !== undefined) {
    const estimatorCalculation = deps.estimatorCalculation;
    estimatorDeps.applyCalculation = (entries, estimatorArgs) => {
      const result = estimatorCalculation(entries, estimatorArgs);
      estimatorInternalYieldHex = result.yieldHex;
      return result;
    };
  }

  const estimatorResult = await estimateHexMiningYield(args, estimatorDeps);
  const formula = {
    reproducedYieldHex,
    estimatorInternalYieldHex,
    entryCount: packedResult.entries.length,
    expectedEntryCount,
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

  if (
    estimatorInternalYieldHex !== null &&
    estimatorInternalYieldHex !== reproducedYieldHex
  ) {
    return fail(
      input,
      "hexmining-verification-estimator-mismatch",
      [...estimatorResult.warnings, "hexmining-verification-estimator-mismatch"],
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
