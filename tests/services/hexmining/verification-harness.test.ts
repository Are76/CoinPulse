import { describe, expect, it } from "vitest";

import {
  verifyHexMiningYieldEvidence,
  type HexMiningVerificationHarnessInput,
} from "@/services/hexmining/verification-harness";

function packDailyDataEntry(args: {
  dayPayoutTotal: bigint;
  dayStakeSharesTotal: bigint;
  dayUnclaimedSatoshisTotal?: bigint;
}): bigint {
  return (
    args.dayPayoutTotal |
    (args.dayStakeSharesTotal << 72n) |
    ((args.dayUnclaimedSatoshisTotal ?? 0n) << 144n)
  );
}

function makePayload(...entries: bigint[]): string {
  return JSON.stringify({
    schemaVersion: "v1",
    dailyData: entries.map((entry) => entry.toString()),
  });
}

const VALID_PAYLOAD = makePayload(
  packDailyDataEntry({ dayPayoutTotal: 1000n, dayStakeSharesTotal: 500n }),
  packDailyDataEntry({ dayPayoutTotal: 750n, dayStakeSharesTotal: 250n }),
);

const BASE_INPUT: HexMiningVerificationHarnessInput = {
  observationId: "obs-live-fixture-1",
  rangeStartDay: 1000,
  rangeEndDay: 1001,
  observedAtBlock: 123456789n,
  canonicalPayload: VALID_PAYLOAD,
  stakeShares: 100n,
  rpcEndpointLabel: "sanitized-pulsechain-rpc",
};

describe("verifyHexMiningYieldEvidence", () => {
  it("passes valid evidence and keeps the estimator gated at evidence_available", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT);

    expect(result.passed).toBe(true);
    expect(result.failureCode).toBeNull();
    expect(result.estimatorStatus).toBe("evidence_available");
    expect(result.formula.reproducedYieldHex).toBe("500");
    expect(result.formula.estimatorInternalYieldHex).toBe("500");
    expect(result.formula.entryCount).toBe(2);
  });

  it("fails invalid payloads before estimator execution", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      canonicalPayload: JSON.stringify({ schemaVersion: "v1", dailyData: [123] }),
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-invalid-payload");
    expect(result.estimatorStatus).toBeNull();
    expect(result.warnings).toContain("hexmining-payload-numeric-json-value");
  });

  it("fails invalidated observations", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      isInvalidated: true,
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-observation-invalidated");
    expect(result.warnings).toContain("hexmining-yield-observation-invalidated");
  });

  it("fails when independently reproduced bigint math does not match estimator math", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT, {
      estimatorCalculation: () => ({ status: "estimated", yieldHex: "499" }),
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-estimator-mismatch");
    expect(result.estimatorStatus).toBe("evidence_available");
    expect(result.formula.reproducedYieldHex).toBe("500");
    expect(result.formula.estimatorInternalYieldHex).toBe("499");
  });

  it("preserves sanitized provenance from the verification input", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT);

    expect(result.provenance).toEqual({
      chainId: 369,
      sourceFamily: "HEXMINING",
      observationId: "obs-live-fixture-1",
      rangeStartDay: 1000,
      rangeEndDay: 1001,
      observedAtBlock: "123456789",
      rpcEndpointLabel: "sanitized-pulsechain-rpc",
    });
  });

  it("produces deterministic output for identical inputs", async () => {
    const first = await verifyHexMiningYieldEvidence(BASE_INPUT);
    const second = await verifyHexMiningYieldEvidence(BASE_INPUT);

    expect(second).toEqual(first);
  });
});
