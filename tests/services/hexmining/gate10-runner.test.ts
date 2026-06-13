import { describe, expect, it, vi } from "vitest";

import {
  runGate10Verification,
  type Gate10RunnerInput,
} from "@/services/hexmining/gate10-runner";

// ─── Payload helpers (mirrors verification-harness.test.ts) ──────────────────

function packDailyDataEntry(args: {
  dayPayoutTotal: bigint;
  dayStakeSharesTotal: bigint;
}): bigint {
  return args.dayPayoutTotal | (args.dayStakeSharesTotal << 72n);
}

function makePayload(...entries: bigint[]): string {
  return JSON.stringify({
    schemaVersion: "v1",
    dailyData: entries.map((e) => e.toString()),
  });
}

const VALID_PAYLOAD = makePayload(
  packDailyDataEntry({ dayPayoutTotal: 1000n, dayStakeSharesTotal: 500n }),
  packDailyDataEntry({ dayPayoutTotal: 750n, dayStakeSharesTotal: 250n }),
);

const BASE_OBS = {
  id: "obs-gate10-fixture",
  chainId: 369,
  sourceFamily: "HEXMINING",
  rangeStartDay: 1000,
  rangeEndDay: 1001,
  observedAtBlock: 99999999n,
  canonicalPayload: VALID_PAYLOAD,
  rpcEndpointLabel: "sanitized-pulsechain-rpc",
  warnings: [] as string[],
};

// ─── Mock DB factory ──────────────────────────────────────────────────────────

function makeDb(
  obs: typeof BASE_OBS | null,
  invalidationCount: number = 0,
) {
  return {
    rawHexDailyDataObservation: {
      findUnique: vi.fn().mockResolvedValue(obs),
    },
    rawHexDailyDataObservationInvalidation: {
      count: vi.fn().mockResolvedValue(invalidationCount),
    },
  };
}

const VALID_INPUT: Gate10RunnerInput = {
  observationId: BASE_OBS.id,
  stakeShares: 100n,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runGate10Verification", () => {
  it("returns invalid-stake-shares when stakeShares is negative", async () => {
    const db = makeDb(null);
    const result = await runGate10Verification({ ...VALID_INPUT, stakeShares: -1n }, db);
    expect(result).toEqual({ error: "invalid-stake-shares", stakeShares: "-1" });
    expect(db.rawHexDailyDataObservation.findUnique).not.toHaveBeenCalled();
    expect(db.rawHexDailyDataObservationInvalidation.count).not.toHaveBeenCalled();
  });

  it("returns observation-not-found error when observation does not exist", async () => {
    const db = makeDb(null);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect(result).toEqual({
      error: "observation-not-found",
      observationId: VALID_INPUT.observationId,
    });
    expect(db.rawHexDailyDataObservation.findUnique).toHaveBeenCalledWith({
      where: { id: VALID_INPUT.observationId },
      select: expect.objectContaining({ id: true, chainId: true, canonicalPayload: true }),
    });
  });

  it("does not query invalidations when observation is not found", async () => {
    const db = makeDb(null);
    await runGate10Verification(VALID_INPUT, db);
    expect(db.rawHexDailyDataObservationInvalidation.count).not.toHaveBeenCalled();
  });

  it("returns observation-wrong-source when chainId does not match 369", async () => {
    const obs = { ...BASE_OBS, chainId: 1, sourceFamily: "HEXMINING" };
    const db = makeDb(obs);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect(result).toMatchObject({
      error: "observation-wrong-source",
      observationId: BASE_OBS.id,
      chainId: 1,
    });
    expect(db.rawHexDailyDataObservationInvalidation.count).not.toHaveBeenCalled();
  });

  it("returns observation-wrong-source when sourceFamily does not match HEXMINING", async () => {
    const obs = { ...BASE_OBS, chainId: 369, sourceFamily: "OTHER" };
    const db = makeDb(obs);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect(result).toMatchObject({
      error: "observation-wrong-source",
      observationId: BASE_OBS.id,
      sourceFamily: "OTHER",
    });
  });

  it("passes valid evidence through harness with passed: true", async () => {
    const db = makeDb(BASE_OBS, 0);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.passed).toBe(true);
    expect(result.failureCode).toBeNull();
    expect(result.estimatorStatus).toBe("evidence_available");
    expect(result.formula.reproducedYieldHex).not.toBeNull();
    expect(result.formula.entryCount).toBe(2);
    expect(result.formula.expectedEntryCount).toBe(2);
  });

  it("sanitized output does not contain canonicalPayload or raw payload data", async () => {
    const db = makeDb(BASE_OBS, 0);
    const result = await runGate10Verification(VALID_INPUT, db);
    const json = JSON.stringify(result);
    expect(json).not.toContain("canonicalPayload");
    expect(json).not.toContain("schemaVersion");
    expect(json).not.toContain("dailyData");
  });

  it("marks observation as invalidated when invalidation records exist", async () => {
    const db = makeDb(BASE_OBS, 1);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("hexmining-verification-observation-invalidated");
  });

  it("propagates upstream warnings from the observation record", async () => {
    const obs = {
      ...BASE_OBS,
      warnings: ["hexmining-yield-bpd-attribution-unresolved"],
    };
    const db = makeDb(obs, 0);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
  });

  it("includes sanitized provenance in the result", async () => {
    const db = makeDb(BASE_OBS, 0);
    const result = await runGate10Verification(VALID_INPUT, db);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.provenance).toMatchObject({
      chainId: 369,
      sourceFamily: "HEXMINING",
      observationId: BASE_OBS.id,
      rangeStartDay: BASE_OBS.rangeStartDay,
      rangeEndDay: BASE_OBS.rangeEndDay,
      observedAtBlock: BASE_OBS.observedAtBlock.toString(),
      rpcEndpointLabel: BASE_OBS.rpcEndpointLabel,
    });
  });
});
