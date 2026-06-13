import "server-only";

import { getDb } from "@/lib/db";
import {
  verifyHexMiningYieldEvidence,
  type HexMiningVerificationHarnessResult,
} from "@/services/hexmining/verification-harness";

// Narrow typed client — only the fields and operations this module uses.
// Drives the mock in tests and keeps the module portable.
type ObservationRow = {
  id: string;
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

export type Gate10RunnerNotFoundError = {
  error: "observation-not-found";
  observationId: string;
};

export type Gate10RunnerOutput = HexMiningVerificationHarnessResult | Gate10RunnerNotFoundError;

export async function runGate10Verification(
  input: Gate10RunnerInput,
  db: Gate10RunnerClient = getDb(),
): Promise<Gate10RunnerOutput> {
  const obs = await db.rawHexDailyDataObservation.findUnique({
    where: { id: input.observationId },
    select: {
      id: true,
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
