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
  it("passes valid evidence and surfaces the estimated yield", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT);

    expect(result.passed).toBe(true);
    expect(result.failureCode).toBeNull();
    expect(result.estimatorStatus).toBe("estimated");
    expect(result.formula.reproducedYieldHex).toBe("500");
    expect(result.formula.estimatorInternalYieldHex).toBe("500");
    expect(result.formula.entryCount).toBe(2);
    expect(result.formula.expectedEntryCount).toBe(2);
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

  it("fails when the payload is shorter than the requested range", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      canonicalPayload: makePayload(
        packDailyDataEntry({ dayPayoutTotal: 1000n, dayStakeSharesTotal: 500n }),
      ),
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-payload-range-mismatch");
    expect(result.formula.entryCount).toBe(1);
    expect(result.formula.expectedEntryCount).toBe(2);
    expect(result.warnings).toContain("hexmining-verification-expected-2-entries-got-1");
  });

  it("fails when the payload is longer than the requested range", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      canonicalPayload: makePayload(
        packDailyDataEntry({ dayPayoutTotal: 1000n, dayStakeSharesTotal: 500n }),
        packDailyDataEntry({ dayPayoutTotal: 750n, dayStakeSharesTotal: 250n }),
        packDailyDataEntry({ dayPayoutTotal: 400n, dayStakeSharesTotal: 200n }),
      ),
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-payload-range-mismatch");
    expect(result.formula.entryCount).toBe(3);
    expect(result.formula.expectedEntryCount).toBe(2);
    expect(result.warnings).toContain("hexmining-verification-expected-2-entries-got-3");
  });

  it("fails closed for a zero-width invalid day range", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      rangeStartDay: 1000,
      rangeEndDay: 999,
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-invalid-range");
    expect(result.formula.expectedEntryCount).toBeNull();
  });

  it("fails closed for a negative start day", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      rangeStartDay: -1,
      rangeEndDay: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-invalid-range");
  });

  it("fails closed for a negative end day", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      rangeStartDay: 0,
      rangeEndDay: -1,
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-invalid-range");
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

  it("passes the normal path without overriding the estimator calculation", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT);

    expect(result.passed).toBe(true);
    expect(result.estimatorStatus).toBe("estimated");
    expect(result.formula.reproducedYieldHex).toBe("500");
    expect(result.formula.estimatorInternalYieldHex).toBe("500");
  });

  it("fails when test-only estimator math does not match independently reproduced bigint math", async () => {
    const result = await verifyHexMiningYieldEvidence(BASE_INPUT, {
      estimatorCalculation: () => ({ status: "estimated", yieldHex: "499" }),
    });

    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-estimator-mismatch");
    expect(result.estimatorStatus).toBe("estimated");
    expect(result.formula.reproducedYieldHex).toBe("500");
    expect(result.formula.estimatorInternalYieldHex).toBe("499");
  });

  it("preserves upstream observation warnings in the final verification result", async () => {
    const result = await verifyHexMiningYieldEvidence({
      ...BASE_INPUT,
      warnings: ["hexmining-rpc-slow"],
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("hexmining-rpc-slow");
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
