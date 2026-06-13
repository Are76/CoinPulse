import {
  verifyHexMiningYieldEvidence,
  type HexMiningVerificationHarnessResult,
} from "@/services/hexmining/verification-harness";

const REQUIRED_CHAIN_ID = 369;
const REQUIRED_SOURCE_FAMILY = "HEXMINING";

// Narrow typed client — only the fields and operations this module uses.
// Drives the mock in tests and keeps the module portable.
type ObservationRow = {
  id: string;
  chainId: number;
  sourceFamily: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  canonicalPayload: string;
  rpcEndpointLabel: string | null;
  warnings: string[];
};

type Gate10RunnerClient = {
  rawHexDailyDataObservation: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        chainId: true;
        sourceFamily: true;
        rangeStartDay: true;
        rangeEndDay: true;
        observedAtBlock: true;
        canonicalPayload: true;
        rpcEndpointLabel: true;
        warnings: true;
      };
    }): Promise<ObservationRow | null>;
  };
  rawHexDailyDataObservationInvalidation: {
    count(args: { where: { observationId: string } }): Promise<number>;
  };
};

export type Gate10RunnerInput = {
  observationId: string;
  stakeShares: bigint;
};

export type Gate10RunnerError =
  | { error: "invalid-stake-shares"; stakeShares: string }
  | { error: "observation-not-found"; observationId: string }
  | {
      error: "observation-wrong-source";
      observationId: string;
      chainId: number;
      sourceFamily: string;
    };

export type Gate10RunnerOutput = HexMiningVerificationHarnessResult | Gate10RunnerError;

export async function runGate10Verification(
  input: Gate10RunnerInput,
  db: Gate10RunnerClient,
): Promise<Gate10RunnerOutput> {
  if (input.stakeShares < 0n) {
    return { error: "invalid-stake-shares", stakeShares: input.stakeShares.toString() };
  }

  const obs = await db.rawHexDailyDataObservation.findUnique({
    where: { id: input.observationId },
    select: {
      id: true,
      chainId: true,
      sourceFamily: true,
      rangeStartDay: true,
      rangeEndDay: true,
      observedAtBlock: true,
      canonicalPayload: true,
      rpcEndpointLabel: true,
      warnings: true,
    },
  });

  if (!obs) {
    return { error: "observation-not-found", observationId: input.observationId };
  }

  if (obs.chainId !== REQUIRED_CHAIN_ID || obs.sourceFamily !== REQUIRED_SOURCE_FAMILY) {
    return {
      error: "observation-wrong-source",
      observationId: obs.id,
      chainId: obs.chainId,
      sourceFamily: obs.sourceFamily,
    };
  }

  const invalidationCount = await db.rawHexDailyDataObservationInvalidation.count({
    where: { observationId: obs.id },
  });

  return verifyHexMiningYieldEvidence({
    observationId: obs.id,
    rangeStartDay: obs.rangeStartDay,
    rangeEndDay: obs.rangeEndDay,
    observedAtBlock: obs.observedAtBlock,
    canonicalPayload: obs.canonicalPayload,
    stakeShares: input.stakeShares,
    isInvalidated: invalidationCount > 0,
    rpcEndpointLabel: obs.rpcEndpointLabel,
    warnings: obs.warnings,
  });
}
