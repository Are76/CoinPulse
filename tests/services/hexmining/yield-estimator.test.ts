import { describe, expect, it, vi } from "vitest";

import {
  estimateHexMiningYield,
  type HexMiningYieldEstimateArgs,
  type HexMiningYieldEstimatorDeps,
  type ObservationEvidence,
} from "@/services/hexmining/yield-estimator";

const BASE_ARGS: HexMiningYieldEstimateArgs = {
  chainId: 369,
  stakeId: "12345",
  lockedDay: 1000,
  stakedDays: 365,
  currentDay: 1200,
  rangeStartDay: 1000,
  rangeEndDay: 1199,
};

const VALID_PAYLOAD = JSON.stringify({
  schemaVersion: "v1",
  dailyData: ["100000000000000000000", "200000000000000000000"],
});

function makeEvidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    observationId: "obs-abc-123",
    rangeStartDay: 1000,
    rangeEndDay: 1199,
    canonicalPayload: VALID_PAYLOAD,
    warnings: [],
    ...overrides,
  };
}

function makeDeps(evidence: ObservationEvidence | null = makeEvidence()): HexMiningYieldEstimatorDeps {
  return {
    fetchEvidence: vi.fn().mockResolvedValue(evidence),
  };
}

describe("estimateHexMiningYield", () => {
  describe("chain guard", () => {
    it("returns unsupported for chainId !== 369", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 1 }, deps);

      expect(result.status).toBe("unsupported");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.chainId).toBe(1);
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.observationId).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-unsupported-chain-1");
      expect(deps.fetchEvidence).not.toHaveBeenCalled();
    });

    it("returns unsupported for chainId 137 with correct warning slug", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 137 }, deps);

      expect(result.status).toBe("unsupported");
      expect(result.warnings).toContain("hexmining-yield-unsupported-chain-137");
    });
  });

  describe("evidence fetching", () => {
    it("calls fetchEvidence dep with chainId, rangeStartDay, rangeEndDay", async () => {
      const deps = makeDeps();
      await estimateHexMiningYield(BASE_ARGS, deps);

      expect(deps.fetchEvidence).toHaveBeenCalledOnce();
      expect(deps.fetchEvidence).toHaveBeenCalledWith({
        chainId: 369,
        rangeStartDay: BASE_ARGS.rangeStartDay,
        rangeEndDay: BASE_ARGS.rangeEndDay,
      });
    });

    it("returns insufficient_observations when fetchEvidence returns null", async () => {
      const deps = makeDeps(null);
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBeNull();
      expect(result.provenance.rangeStartDay).toBe(BASE_ARGS.rangeStartDay);
      expect(result.provenance.rangeEndDay).toBe(BASE_ARGS.rangeEndDay);
      expect(result.warnings).toContain("hexmining-yield-no-observation-evidence");
    });

    it("returns unavailable when fetchEvidence throws", async () => {
      const deps: HexMiningYieldEstimatorDeps = {
        fetchEvidence: vi.fn().mockRejectedValue(new Error("db-connection-error")),
      };
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("unavailable");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-evidence-provider-failed");
    });
  });

  describe("payload validation", () => {
    it("returns invalid_observation for invalid JSON payload", async () => {
      const deps = makeDeps(makeEvidence({ canonicalPayload: "not-valid-json{{{" }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.warnings).toContain("hexmining-yield-invalid-observation-payload");
    });

    it("returns invalid_observation for payload with numeric JSON values", async () => {
      const numericPayload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: [100000000000000, 200000000000000],
      });
      const deps = makeDeps(makeEvidence({ canonicalPayload: numericPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-invalid-observation-payload");
    });

    it("returns invalid_observation for payload missing dailyData array", async () => {
      const badPayload = JSON.stringify({ schemaVersion: "v1", otherField: "foo" });
      const deps = makeDeps(makeEvidence({ canonicalPayload: badPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-invalid-observation-payload");
    });

    it("returns invalid_observation for payload missing schemaVersion", async () => {
      const badPayload = JSON.stringify({ dailyData: ["100", "200"] });
      const deps = makeDeps(makeEvidence({ canonicalPayload: badPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-invalid-observation-payload");
    });
  });

  describe("estimation deferred — formula not yet implemented", () => {
    it("returns insufficient_observations with not-implemented warning for valid evidence", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-calculation-not-implemented");
    });

    it("includes observationId in provenance when evidence is present", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    it("propagates evidence warnings into result", async () => {
      const deps = makeDeps(makeEvidence({ warnings: ["hexmining-some-upstream-warning"] }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.warnings).toContain("hexmining-some-upstream-warning");
      expect(result.warnings).toContain("hexmining-yield-calculation-not-implemented");
    });
  });

  describe("result shape invariants", () => {
    it("never exposes canonicalPayload in the result", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("canonicalPayload");
      expect(serialized).not.toContain("dailyData");
      expect(serialized).not.toContain("payloadHash");
    });

    it("always includes schemaVersion v1 regardless of status", async () => {
      const unsupported = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 1 }, makeDeps());
      const unavailable = await estimateHexMiningYield(BASE_ARGS, {
        fetchEvidence: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const noEvidence = await estimateHexMiningYield(BASE_ARGS, makeDeps(null));
      const deferred = await estimateHexMiningYield(BASE_ARGS, makeDeps());

      expect(unsupported.schemaVersion).toBe("v1");
      expect(unavailable.schemaVersion).toBe("v1");
      expect(noEvidence.schemaVersion).toBe("v1");
      expect(deferred.schemaVersion).toBe("v1");
    });

    it("always includes sourceFamily HEXMINING in provenance", async () => {
      const result = await estimateHexMiningYield(BASE_ARGS, makeDeps());
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
    });

    it("yieldHex is null for all non-estimated statuses", async () => {
      const unsupported = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 1 }, makeDeps());
      const unavailable = await estimateHexMiningYield(BASE_ARGS, {
        fetchEvidence: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const noEvidence = await estimateHexMiningYield(BASE_ARGS, makeDeps(null));
      const deferred = await estimateHexMiningYield(BASE_ARGS, makeDeps());

      expect(unsupported.yieldHex).toBeNull();
      expect(unavailable.yieldHex).toBeNull();
      expect(noEvidence.yieldHex).toBeNull();
      expect(deferred.yieldHex).toBeNull();
    });

    it("result contains no pricing, valuation, pnl, or APY fields", async () => {
      const result = await estimateHexMiningYield(BASE_ARGS, makeDeps());
      const keys = Object.keys(result);

      expect(keys).not.toContain("price");
      expect(keys).not.toContain("pricing");
      expect(keys).not.toContain("valuation");
      expect(keys).not.toContain("pnl");
      expect(keys).not.toContain("apy");
      expect(keys).not.toContain("apr");
    });
  });
});
