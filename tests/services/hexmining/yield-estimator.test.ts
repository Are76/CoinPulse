import { describe, expect, it, vi } from "vitest";

import type { ObservationEvidenceMetadata } from "@/services/hexmining/observation-evidence-provider";
import {
  estimateHexMiningYield,
  type HexMiningYieldEstimateArgs,
  type HexMiningYieldEstimatorDeps,
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

// Valid canonical payload using spec §4 test vectors (bigint-safe decimal strings).
const DEFAULT_CANONICAL_PAYLOAD = JSON.stringify({
  schemaVersion: "v1",
  dailyData: [
    "0", // vector 1 — zero
    "2361183241434822606849000", // vector 2 — payout=1000, shares=500
    "9444732965739290427391", // vector 3 — payout=uint72max, shares=1
  ],
});

// EvidenceWithPayload = ObservationEvidenceMetadata & { canonicalPayload: string }
type EvidenceWithPayload = ObservationEvidenceMetadata & { canonicalPayload: string };

function makeEvidence(
  overrides: Partial<EvidenceWithPayload> = {},
): EvidenceWithPayload {
  return {
    observationId: "obs-abc-123",
    chainId: 369,
    sourceFamily: "HEXMINING",
    rangeStartDay: 1000,
    rangeEndDay: 1199,
    observedAtBlock: "1234567",
    observedAt: "2024-01-01T00:00:00.000Z",
    payloadVersion: "v1",
    payloadSchemaValid: true,
    isInvalidated: false,
    warnings: [],
    canonicalPayload: DEFAULT_CANONICAL_PAYLOAD,
    ...overrides,
  };
}

function makeDeps(
  evidence: EvidenceWithPayload | null = makeEvidence(),
): HexMiningYieldEstimatorDeps {
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
    it("calls fetchEvidence dep with chainId, rangeStartDay, rangeEndDay — not RPC", async () => {
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

  describe("observation validation", () => {
    it("returns invalid_observation for invalidated observation", async () => {
      const deps = makeDeps(makeEvidence({ isInvalidated: true }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.warnings).toContain("hexmining-yield-observation-invalidated");
    });

    it("returns invalid_observation when payloadSchemaValid is false", async () => {
      const deps = makeDeps(makeEvidence({ payloadSchemaValid: false }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.warnings).toContain("hexmining-yield-invalid-observation-payload");
    });

    it("invalid_observation takes precedence over invalid payload", async () => {
      const deps = makeDeps(makeEvidence({ isInvalidated: true, payloadSchemaValid: false }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-observation-invalidated");
    });
  });

  describe("payload decode layer", () => {
    it("returns invalid_observation when canonicalPayload fails decodeDailyDataPayload", async () => {
      // payloadSchemaValid:true but schemaVersion is "v2" — provider accepts it,
      // decodeDailyDataPayload rejects it as unsupported-schema-version.
      const invalidPayload = JSON.stringify({
        schemaVersion: "v2",
        dailyData: ["1000"],
      });
      const deps = makeDeps(makeEvidence({ canonicalPayload: invalidPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-payload-decode-failed");
    });

    it("returns invalid_observation when canonicalPayload contains non-decimal entry", async () => {
      const invalidPayload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: ["1000", "not-a-number"],
      });
      const deps = makeDeps(makeEvidence({ canonicalPayload: invalidPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-payload-decode-failed");
    });

    it("negative packed value string is rejected by payload decoder before packed decoder", async () => {
      // "-1" fails isValidUnsignedDecimalString — decodeDailyDataPayload rejects it.
      const negativePayload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: ["-1"],
      });
      const deps = makeDeps(makeEvidence({ canonicalPayload: negativePayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.warnings).toContain("hexmining-yield-payload-decode-failed");
    });
  });

  describe("packed decode layer", () => {
    it("returns invalid_observation when a dailyData entry exceeds (2n**200n)-1n", async () => {
      // 2n**200n = 1606938044258990275541962092341162602522202993782792835301376n
      // Valid decimal string, passes payload decoder, fails packed decoder.
      const tooLarge = (2n ** 200n).toString();
      const oversizedPayload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: ["1000", tooLarge],
      });
      const deps = makeDeps(makeEvidence({ canonicalPayload: oversizedPayload }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-packed-decode-failed");
    });

    it("returns evidence_available when all packed entries are within valid range", async () => {
      // All spec §4 vectors are well within (2n**200n)-1n.
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });
  });

  describe("evidence available — formula deferred", () => {
    it("returns evidence_available for valid non-invalidated evidence with valid payload", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    it("propagates evidence warnings into evidence_available result", async () => {
      const deps = makeDeps(makeEvidence({ warnings: ["hexmining-some-upstream-warning"] }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).toContain("hexmining-some-upstream-warning");
    });
  });

  describe("result shape invariants", () => {
    it("never exposes canonicalPayload, rawDailyData, or payloadHash in result", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("canonicalPayload");
      expect(serialized).not.toContain("rawDailyData");
      expect(serialized).not.toContain("payloadHash");
      expect(serialized).not.toContain("dailyData");
    });

    it("never exposes decoded packed fields in result", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("dayPayoutTotal");
      expect(serialized).not.toContain("dayStakeSharesTotal");
      expect(serialized).not.toContain("dayUnclaimedSatoshisTotal");
    });

    it("always includes schemaVersion v1 regardless of status", async () => {
      const unsupported = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 1 }, makeDeps());
      const unavailable = await estimateHexMiningYield(BASE_ARGS, {
        fetchEvidence: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const noEvidence = await estimateHexMiningYield(BASE_ARGS, makeDeps(null));
      const invalidated = await estimateHexMiningYield(
        BASE_ARGS,
        makeDeps(makeEvidence({ isInvalidated: true })),
      );
      const evidenceAvailable = await estimateHexMiningYield(BASE_ARGS, makeDeps());

      expect(unsupported.schemaVersion).toBe("v1");
      expect(unavailable.schemaVersion).toBe("v1");
      expect(noEvidence.schemaVersion).toBe("v1");
      expect(invalidated.schemaVersion).toBe("v1");
      expect(evidenceAvailable.schemaVersion).toBe("v1");
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
      const evidenceAvailable = await estimateHexMiningYield(BASE_ARGS, makeDeps());

      expect(unsupported.yieldHex).toBeNull();
      expect(unavailable.yieldHex).toBeNull();
      expect(noEvidence.yieldHex).toBeNull();
      expect(evidenceAvailable.yieldHex).toBeNull();
    });

    it("result contains no pricing, valuation, pnl, APY, or yield-calculation fields", async () => {
      const result = await estimateHexMiningYield(BASE_ARGS, makeDeps());
      const keys = Object.keys(result);

      expect(keys).not.toContain("price");
      expect(keys).not.toContain("pricing");
      expect(keys).not.toContain("valuation");
      expect(keys).not.toContain("pnl");
      expect(keys).not.toContain("apy");
      expect(keys).not.toContain("apr");
      expect(keys).not.toContain("estimatedYield");
    });
  });
});
