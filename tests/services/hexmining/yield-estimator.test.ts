import { describe, expect, it, vi, type Mock } from "vitest";

import type { ObservationEvidenceMetadata } from "@/services/hexmining/observation-evidence-provider";
import {
  estimateHexMiningYield,
  type HexMiningYieldEstimateArgs,
  type HexMiningYieldEstimatorDeps,
} from "@/services/hexmining/yield-estimator";

const BASE_ARGS: HexMiningYieldEstimateArgs = {
  chainId: 369,
  stakeId: "12345",
  stakeShares: 1000n,
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

function makeFormulaPayload(...packedValues: bigint[]): string {
  return JSON.stringify({
    schemaVersion: "v1",
    dailyData: packedValues.map((v) => v.toString()),
  });
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

    it("does not return invalid_observation when all packed entries are within valid range", async () => {
      // All spec §4 vectors are well within (2n**200n)-1n.
      // Uses stub so the packed-decode assertion is not conflated with formula output.
      const deps = {
        ...makeDeps(),
        applyCalculation: vi.fn().mockReturnValue({ status: "calculation_not_implemented" as const }),
      };
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });
  });

  describe("evidence available with valid default payload", () => {
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
      // Default deps: returns evidence_available (not estimated — public estimated path is gated)
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

    it("yieldHex is null for all statuses (estimated path is gated)", async () => {
      const unsupported = await estimateHexMiningYield({ ...BASE_ARGS, chainId: 1 }, makeDeps());
      const unavailable = await estimateHexMiningYield(BASE_ARGS, {
        fetchEvidence: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const noEvidence = await estimateHexMiningYield(BASE_ARGS, makeDeps(null));
      // Default deps now returns evidence_available directly (no injectable stub required)
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

  describe("internal calculation boundary scaffold", () => {
    // ── Test 1: decoded evidence reaches the calculation boundary ─────────────

    it("calls applyCalculation with decoded entries when evidence is valid", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(applyCalculation).toHaveBeenCalledOnce();
    });

    it("passes decoded entries with correct field values to applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      await estimateHexMiningYield(BASE_ARGS, deps);

      // DEFAULT_CANONICAL_PAYLOAD contains 3 entries: vectors 1, 2, 3 from §4
      const [entries] = applyCalculation.mock.calls[0] as [
        Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint; dayUnclaimedSatoshisTotal: bigint }>,
        unknown,
      ];
      expect(entries).toHaveLength(3);
      // Vector 1 — zero packed value
      expect(entries[0]!.dayPayoutTotal).toBe(0n);
      expect(entries[0]!.dayStakeSharesTotal).toBe(0n);
      expect(entries[0]!.dayUnclaimedSatoshisTotal).toBe(0n);
      // Vector 2 — payout=1000, shares=500
      expect(entries[1]!.dayPayoutTotal).toBe(1000n);
      expect(entries[1]!.dayStakeSharesTotal).toBe(500n);
      // Vector 3 — payout=uint72max, shares=1
      expect(entries[2]!.dayPayoutTotal).toBe(2n ** 72n - 1n);
      expect(entries[2]!.dayStakeSharesTotal).toBe(1n);
    });

    it("passes the original args to applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      await estimateHexMiningYield(BASE_ARGS, deps);

      const [, receivedArgs] = applyCalculation.mock.calls[0] as [unknown, typeof BASE_ARGS];
      expect(receivedArgs.stakeShares).toBe(BASE_ARGS.stakeShares);
      expect(receivedArgs.lockedDay).toBe(BASE_ARGS.lockedDay);
      expect(receivedArgs.stakedDays).toBe(BASE_ARGS.stakedDays);
      expect(receivedArgs.currentDay).toBe(BASE_ARGS.currentDay);
      expect(receivedArgs.rangeStartDay).toBe(BASE_ARGS.rangeStartDay);
      expect(receivedArgs.rangeEndDay).toBe(BASE_ARGS.rangeEndDay);
    });

    // ── Test 2: formula not implemented → non-estimated status ────────────────

    it("calculation_not_implemented returns evidence_available, never estimated", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.status).not.toBe("estimated");
      expect(result.yieldHex).toBeNull();
    });

    it("insufficient_formula_evidence returns evidence_available, never estimated", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "insufficient_formula_evidence" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.status).not.toBe("estimated");
      expect(result.yieldHex).toBeNull();
    });

    // ── Test 3: invalid_observation still short-circuits before boundary ──────

    it("does not call applyCalculation when observation is invalidated", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = {
        ...makeDeps(makeEvidence({ isInvalidated: true })),
        applyCalculation,
      };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(applyCalculation).not.toHaveBeenCalled();
    });

    it("does not call applyCalculation when packed decode fails", async () => {
      const applyCalculation: Mock = vi.fn();
      const tooLarge = (2n ** 200n).toString();
      const badPayload = JSON.stringify({ schemaVersion: "v1", dailyData: [tooLarge] });
      const deps = {
        ...makeDeps(makeEvidence({ canonicalPayload: badPayload })),
        applyCalculation,
      };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("invalid_observation");
      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 4: no yieldHex / APY / pricing fields ─────────────────────────────

    it("never exposes yieldHex, APY, pricing, valuation, or PnL fields in result", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);
      const serialized = JSON.stringify(result);
      const keys = Object.keys(result);

      expect(result.yieldHex).toBeNull();
      expect(serialized).not.toContain("apy");
      expect(serialized).not.toContain("apr");
      expect(serialized).not.toContain("estimatedYield");
      expect(serialized).not.toContain("yieldUsd");
      expect(keys).not.toContain("pricing");
      expect(keys).not.toContain("valuation");
      expect(keys).not.toContain("pnl");
    });

    it("decoded fields (dayPayoutTotal etc.) are not in the public result", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("dayPayoutTotal");
      expect(serialized).not.toContain("dayStakeSharesTotal");
      expect(serialized).not.toContain("dayUnclaimedSatoshisTotal");
      expect(serialized).not.toContain("canonicalPayload");
      expect(serialized).not.toContain("dailyData");
    });

    // ── Test 8: default pipeline runs and returns evidence_available ──────────

    it("default (no applyCalculation dep) runs pipeline and returns evidence_available", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
    });

    it("applyCalculation is not called when evidence is null", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = { ...makeDeps(null), applyCalculation };

      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(applyCalculation).not.toHaveBeenCalled();
    });
  });

  describe("stakeShares validation and passthrough", () => {
    // ── Test 1: valid stakeShares reaches applyCalculation ───────────────────

    it("positive stakeShares is passed through to applyCalculation as bigint", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const shares = 4722366482869645213696n; // 2n**72n — beyond Number.MAX_SAFE_INTEGER
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: shares }, deps);

      expect(result.status).toBe("evidence_available");
      expect(applyCalculation).toHaveBeenCalledOnce();
      const [, receivedArgs] = applyCalculation.mock.calls[0] as [unknown, HexMiningYieldEstimateArgs];
      expect(receivedArgs.stakeShares).toBe(shares);
      expect(typeof receivedArgs.stakeShares).toBe("bigint");
    });

    // ── Test 2: stakeShares is bigint-safe (not coerced to Number) ───────────

    it("stakeShares larger than Number.MAX_SAFE_INTEGER is received exactly as bigint", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      // 2n**64n = 18446744073709551616n — well beyond Number.MAX_SAFE_INTEGER
      const largeShares = 2n ** 64n;
      const deps = { ...makeDeps(), applyCalculation };

      await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: largeShares }, deps);

      const [, receivedArgs] = applyCalculation.mock.calls[0] as [unknown, HexMiningYieldEstimateArgs];
      expect(receivedArgs.stakeShares).toBe(largeShares);
      expect(receivedArgs.stakeShares).toBe(2n ** 64n);
      // If coerced to Number, precision would be lost; bigint comparison is exact.
      expect(receivedArgs.stakeShares).not.toBe(Number(largeShares));
    });

    // ── Test 3: zero stakeShares is rejected ─────────────────────────────────

    it("zero stakeShares returns invalid_observation before evidence fetch", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: 0n }, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.warnings).toContain("hexmining-yield-invalid-stake-shares");
      expect(deps.fetchEvidence).not.toHaveBeenCalled();
    });

    it("zero stakeShares does not reach applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = { ...makeDeps(), applyCalculation };

      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: 0n }, deps);

      expect(result.status).toBe("invalid_observation");
      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 4: negative stakeShares is rejected ──────────────────────────────

    it("negative stakeShares returns invalid_observation before evidence fetch", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: -1n }, deps);

      expect(result.status).toBe("invalid_observation");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-invalid-stake-shares");
      expect(deps.fetchEvidence).not.toHaveBeenCalled();
    });

    it("negative stakeShares does not reach applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = { ...makeDeps(), applyCalculation };

      await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: -100n }, deps);

      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 5: invalid stakeShares short-circuits before invalid observation ─

    it("invalid stakeShares provenance has null observationId", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: 0n }, deps);

      expect(result.provenance.observationId).toBeNull();
      expect(result.provenance.chainId).toBe(369);
      expect(result.provenance.rangeStartDay).toBe(BASE_ARGS.rangeStartDay);
      expect(result.provenance.rangeEndDay).toBe(BASE_ARGS.rangeEndDay);
    });

    // ── Test 6: stakeShares not exposed in public result ────────────────────

    it("stakeShares value is not exposed in any public result field", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(), applyCalculation };
      const result = await estimateHexMiningYield({ ...BASE_ARGS, stakeShares: 999n }, deps);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("stakeShares");
      expect(serialized).not.toContain("999");
    });
  });

  // ─── §8 yield formula test vectors ────────────────────────────────────────
  //
  // Vectors A–E from docs/hex-dailydata-packing-spec.md §8.
  // The public estimateHexMiningYield returns evidence_available (not "estimated").
  // Formula correctness is verified via injectable applyCalculation: the test captures
  // decoded entries and computes the §8 formula directly, asserting the expected result.
  //
  // Packed encoding: bits 0–71 = dayPayoutTotal (uint72),
  //                  bits 72–143 = dayStakeSharesTotal (uint72),
  //                  bits 144–199 = dayUnclaimedSatoshisTotal (uint56)

  describe("yield formula — §8 test vectors", () => {
    // §8 formula: Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal  (bigint floor, per day)
    // dayStakeSharesTotal === 0n → skip (zero-division guard)
    function applyFormula(
      entries: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }>,
      stakeShares: bigint,
    ): bigint {
      let total = 0n;
      for (const entry of entries) {
        if (entry.dayStakeSharesTotal === 0n) continue;
        total += (stakeShares * entry.dayPayoutTotal) / entry.dayStakeSharesTotal;
      }
      return total;
    }

    // ── Vector A: exact division, 1% stake, 1 day ─────────────────────────

    it("vector A — single day, exact division: decoded entries yield 100 hearts via §8 formula", async () => {
      // stakeShares=1000n, dayPayoutTotal=10000n, dayStakeSharesTotal=100000n
      // (1000n × 10000n) / 100000n = 100n
      const packed = 10000n | (100000n << 72n);
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 1000n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      expect(result.status).toBe("evidence_available");
      expect(applyFormula(captured, 1000n)).toBe(100n);
    });

    // ── Vector B: floor division, 1 day ──────────────────────────────────

    it("vector B — single day, floor division: decoded entries yield 3 hearts via §8 formula", async () => {
      // stakeShares=1n, dayPayoutTotal=10n, dayStakeSharesTotal=3n
      // (1n × 10n) / 3n = 3n (floor of 3.333...)
      const packed = 10n | (3n << 72n);
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 1n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      expect(result.status).toBe("evidence_available");
      expect(applyFormula(captured, 1n)).toBe(3n);
    });

    // ── Vector C: constant 3-day range ───────────────────────────────────

    it("vector C — three-day range, constant fields: decoded entries yield 300 hearts via §8 formula", async () => {
      // stakeShares=500n, dayPayoutTotal=2000n, dayStakeSharesTotal=10000n, 3 identical days
      // Per day: (500n × 2000n) / 10000n = 100n. Total: 300n.
      const packed = 2000n | (10000n << 72n);
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed, packed, packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 500n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      expect(result.status).toBe("evidence_available");
      expect(captured).toHaveLength(3);
      expect(applyFormula(captured, 500n)).toBe(300n);
    });

    // ── Vector D: varying fields, zero-payout day ────────────────────────

    it("vector D — three-day range, varying fields: day with payout=0 contributes 0, total=900 hearts", async () => {
      // stakeShares=100n
      // Day 0: payout=5000, shares=1000 → 500n
      // Day 1: payout=8000, shares=2000, sats=75 (sats not used) → 400n
      // Day 2: payout=0,    shares=5000 → 0n
      const day1000 = 5000n | (1000n << 72n);
      const day1001 = 8000n | (2000n << 72n) | (75n << 144n);
      const day1002 = 0n | (5000n << 72n);
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(day1000, day1001, day1002) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 100n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      expect(result.status).toBe("evidence_available");
      expect(applyFormula(captured, 100n)).toBe(900n);
    });

    // ── Vector E: sole staker (100% of shares) ───────────────────────────

    it("vector E — sole staker: decoded entries yield full dayPayoutTotal (12000 hearts)", async () => {
      // stakeShares=5000n, dayPayoutTotal=12000n, dayStakeSharesTotal=5000n
      // (5000n × 12000n) / 5000n = 12000n
      const packed = 12000n | (5000n << 72n);
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 5000n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      expect(result.status).toBe("evidence_available");
      expect(applyFormula(captured, 5000n)).toBe(12000n);
    });

    // ── Zero-division guard ───────────────────────────────────────────────

    it("dayStakeSharesTotal === 0n contributes 0 to formula total (no division by zero)", async () => {
      const zeroSharesDay = 500n | (0n << 72n);   // payout=500, shares=0 (guard)
      const normalDay = 1000n | (2000n << 72n);   // payout=1000, shares=2000
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(zeroSharesDay, normalDay) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 100n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      // zeroSharesDay → guard → 0n; normalDay: (100n × 1000n) / 2000n = 50n
      expect(result.status).toBe("evidence_available");
      expect(applyFormula(captured, 100n)).toBe(50n);
    });

    // ── Formula result is a bigint-safe decimal integer ───────────────────

    it("§8 formula total is a bigint integer (no float, no truncation loss beyond bigint floor)", async () => {
      const packed = 10000n | (100000n << 72n); // Vector A
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: 1000n },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      const total = applyFormula(captured, 1000n);
      expect(typeof total).toBe("bigint");
      expect(total).toBe(100n);
      // Ensure decimal string has no float characters
      expect(total.toString()).toBe("100");
      expect(total.toString()).not.toContain(".");
      expect(total.toString()).not.toContain("e");
    });

    // ── Large uint72-scale inputs remain exact (bigint-safe) ─────────────

    it("uint72-scale stakeShares and payout stay exact (never coerced to Number)", async () => {
      // stakeShares at uint72 max, payout=2, shares=1 → formula total = uint72max × 2
      const maxShares = (2n ** 72n) - 1n;
      const packed = 2n | (1n << 72n); // payout=2, shares=1
      const evidence = makeEvidence({ canonicalPayload: makeFormulaPayload(packed) });
      const captured: Array<{ dayPayoutTotal: bigint; dayStakeSharesTotal: bigint }> = [];
      await estimateHexMiningYield(
        { ...BASE_ARGS, stakeShares: maxShares },
        { ...makeDeps(evidence), applyCalculation: (entries) => { captured.push(...entries); return { status: "calculation_not_implemented" as const }; } },
      );
      // (maxShares × 2n) / 1n — exceeds Number.MAX_SAFE_INTEGER, must stay exact bigint
      const expected = maxShares * 2n;
      expect(applyFormula(captured, maxShares)).toBe(expected);
    });
  });

  // ─── Elapsed-days coverage rule ───────────────────────────────────────────
  //
  // Only days strictly before currentDay are finalized and available for yield
  // calculation. Required coverage: [lockedDay, elapsedEndDay] (inclusive), where:
  //   elapsedEndDay = Math.min(currentDay - 1, lockedDay + stakedDays - 1)
  //
  // If currentDay <= lockedDay: no elapsed days → insufficient_observations.
  // If evidence.rangeStartDay > lockedDay OR evidence.rangeEndDay < elapsedEndDay:
  //   coverage gap → insufficient_observations.

  describe("elapsed-days coverage rule", () => {
    // ── Test 1: full elapsed coverage → evidence_available ────────────────

    it("full elapsed coverage returns evidence_available with yieldHex null", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1200
      // elapsedEndDay = min(1199, 1364) = 1199; evidence covers [1000, 1199] exactly
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1199 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1200 },
        deps,
      );

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.schemaVersion).toBe("v1");
    });

    // ── Test 2: missing first elapsed day → insufficient_observations ──────

    it("evidence starting after lockedDay returns insufficient_observations", async () => {
      // elapsedEndDay = min(1199, 1364) = 1199
      // evidence starts at 1001, missing lockedDay 1000
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1199 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1200 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
    });

    it("missing first elapsed day does not call applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = {
        ...makeDeps(makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1199 })),
        applyCalculation,
      };
      await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1200 },
        deps,
      );

      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 3: missing last elapsed day → insufficient_observations ───────

    it("evidence ending before elapsedEndDay returns insufficient_observations", async () => {
      // elapsedEndDay = min(1199, 1364) = 1199
      // evidence ends at 1198, missing day 1199
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1198 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1200 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
    });

    it("missing last elapsed day does not call applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = {
        ...makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1198 })),
        applyCalculation,
      };
      await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1200 },
        deps,
      );

      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 4: no elapsed days (currentDay <= lockedDay) → insufficient ───

    it("currentDay equal to lockedDay returns insufficient_observations (no elapsed days)", async () => {
      // currentDay=1000, lockedDay=1000 → currentDay <= lockedDay → no elapsed days
      const deps = makeDeps();
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, currentDay: 1000 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-no-elapsed-days");
    });

    it("currentDay before lockedDay returns insufficient_observations (stake not started)", async () => {
      // currentDay=999, lockedDay=1000 → currentDay < lockedDay → no elapsed days
      const deps = makeDeps();
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, currentDay: 999 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-no-elapsed-days");
    });

    it("no-elapsed-days result carries evidence observationId in provenance", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, currentDay: 1000 },
        deps,
      );

      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.chainId).toBe(369);
    });

    // ── Test 5: completed stake uses lockedDay + stakedDays - 1 as upper bound

    it("completed stake: evidence covering [lockedDay, lockedDay+stakedDays-1] is accepted", async () => {
      // lockedDay=1000, stakedDays=100, currentDay=2000
      // elapsedEndDay = min(1999, 1099) = 1099 — capped at stake end
      // evidence covers [1000, 1099] — exactly the completed stake term
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1099 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 100, currentDay: 2000, rangeStartDay: 1000, rangeEndDay: 1099 },
        deps,
      );

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });

    it("completed stake: evidence ending at currentDay-1 is rejected if stake ended earlier", async () => {
      // lockedDay=1000, stakedDays=100, currentDay=2000
      // elapsedEndDay = min(1999, 1099) = 1099
      // evidence ends at 1099 = correct; ending at 1098 (one day short of stake end) is rejected
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1098 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 100, currentDay: 2000, rangeStartDay: 1000, rangeEndDay: 1099 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
    });

    // ── Test 6: active stake uses currentDay - 1 (not currentDay) ──────────

    it("active stake: evidence ending at currentDay-1 is accepted (currentDay is not elapsed)", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1050
      // elapsedEndDay = min(1049, 1364) = 1049
      // evidence covers [1000, 1049] — correct boundary
      // If the guard required currentDay (1050), rangeEndDay=1049 would fail; it must not
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1049 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1050, rangeStartDay: 1000, rangeEndDay: 1049 },
        deps,
      );

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });

    // ── Test 7: off-by-one protection (inclusive start and end) ────────────

    it("exact boundary [lockedDay, elapsedEndDay] is accepted (inclusive both ends)", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1100
      // elapsedEndDay = min(1099, 1364) = 1099
      // evidence covers exactly [1000, 1099]
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1099 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1100, rangeStartDay: 1000, rangeEndDay: 1099 },
        deps,
      );

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });

    it("start at lockedDay+1 is rejected (must include lockedDay itself)", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1100
      // elapsedEndDay = min(1099, 1364) = 1099
      // evidence starts at 1001 — off by one at the start
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1099 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1100, rangeStartDay: 1000, rangeEndDay: 1099 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
    });

    it("end at elapsedEndDay-1 is rejected (must include elapsedEndDay itself)", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1100
      // elapsedEndDay = min(1099, 1364) = 1099
      // evidence ends at 1098 — off by one at the end
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1098 }));
      const result = await estimateHexMiningYield(
        { ...BASE_ARGS, lockedDay: 1000, stakedDays: 365, currentDay: 1100, rangeStartDay: 1000, rangeEndDay: 1099 },
        deps,
      );

      expect(result.status).toBe("insufficient_observations");
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
    });
  });

  // ─── BPD attribution gate ─────────────────────────────────────────────────
  //
  // HEX Big Pay Day (BPD) is protocol day 353. Stakes active during day 353
  // received a one-time bonus payout that is packed into dayPayoutTotal for that
  // day — it is not separately identified by the §8 formula. Until BPD yield is
  // explicitly modeled per §11.4 invariant #5, any elapsed range that includes
  // day 353 must carry "hexmining-yield-bpd-attribution-unresolved" in warnings.
  //
  // The check is based on the elapsed range [lockedDay, elapsedEndDay]:
  //   elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)
  // If lockedDay <= 353 <= elapsedEndDay, the BPD warning is added.

  describe("BPD attribution gate", () => {
    // Shared scenario: lockedDay=300, stakedDays=200, currentDay=400
    // elapsedEndDay = min(399, 499) = 399; range [300, 399] includes BPD day 353.
    const BPD_ARGS: HexMiningYieldEstimateArgs = {
      ...BASE_ARGS,
      lockedDay: 300,
      stakedDays: 200,
      currentDay: 400,
      rangeStartDay: 300,
      rangeEndDay: 399,
    };

    function makeBpdEvidence(overrides: Partial<Parameters<typeof makeEvidence>[0]> = {}) {
      return makeEvidence({ rangeStartDay: 300, rangeEndDay: 399, ...overrides });
    }

    // ── Test 1: BPD-spanning range → evidence_available with BPD warning ─

    it("stake spanning BPD day 353 returns evidence_available with bpd-attribution-unresolved warning", async () => {
      const deps = makeDeps(makeBpdEvidence());
      const result = await estimateHexMiningYield(BPD_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 2: non-BPD range → no BPD warning ────────────────────────

    it("stake not spanning BPD day 353 returns evidence_available without BPD warning", async () => {
      // BASE_ARGS: lockedDay=1000, so BPD day 353 is far before this stake
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 3: public status is never "estimated" for BPD-spanning range ─

    it("BPD-spanning range never returns estimated status or non-null yieldHex", async () => {
      const deps = makeDeps(makeBpdEvidence());
      const result = await estimateHexMiningYield(BPD_ARGS, deps);

      expect(result.status).not.toBe("estimated");
      expect(result.yieldHex).toBeNull();
    });

    // ── Test 4: applyCalculation is called internally for BPD-spanning range ─

    it("BPD-spanning range still calls applyCalculation internally, result not surfaced publicly", async () => {
      const applyCalculation: Mock = vi.fn().mockReturnValue({
        status: "calculation_not_implemented" as const,
      });
      const deps = { ...makeDeps(makeBpdEvidence()), applyCalculation };
      const result = await estimateHexMiningYield(BPD_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(applyCalculation).toHaveBeenCalledOnce();
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 5: coverage failure short-circuits before BPD check ─────────

    it("coverage failure for BPD-spanning range short-circuits without BPD warning", async () => {
      // Evidence starts at 301, missing lockedDay=300 → insufficient_observations
      const deps = makeDeps(makeEvidence({ rangeStartDay: 301, rangeEndDay: 399 }));
      const result = await estimateHexMiningYield(BPD_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 6: no-elapsed-days for BPD-spanning stake → no BPD warning ──

    it("no-elapsed-days short-circuit for BPD-spanning stake does not include BPD warning", async () => {
      // currentDay=300 == lockedDay=300: no elapsed days → short-circuits at step 5.5
      const deps = makeDeps();
      const result = await estimateHexMiningYield({ ...BPD_ARGS, currentDay: 300 }, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.warnings).toContain("hexmining-yield-no-elapsed-days");
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 7: stake starting exactly on BPD day 353 → BPD warning ─────

    it("stake starting exactly on BPD day 353 includes BPD warning", async () => {
      // lockedDay=353, stakedDays=100, currentDay=460
      // elapsedEndDay = min(459, 452) = 452; range [353, 452] includes day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 353,
        stakedDays: 100,
        currentDay: 460,
        rangeStartDay: 353,
        rangeEndDay: 459,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 353, rangeEndDay: 459 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 8: stake ending exactly on BPD day 353 → BPD warning ───────

    it("stake ending exactly on BPD day 353 includes BPD warning", async () => {
      // lockedDay=300, stakedDays=54, stakeEndDay = 300 + 54 − 1 = 353
      // currentDay=400, elapsedEndDay = min(399, 353) = 353; range [300, 353] includes day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 300,
        stakedDays: 54,
        currentDay: 400,
        rangeStartDay: 300,
        rangeEndDay: 399,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 300, rangeEndDay: 399 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 9: stake ending one day before BPD (day 352) → no warning ──

    it("stake whose elapsed range ends on day 352 does not include BPD warning", async () => {
      // lockedDay=300, stakedDays=53, stakeEndDay = 300 + 53 − 1 = 352
      // currentDay=400, elapsedEndDay = min(399, 352) = 352; range [300, 352] excludes day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 300,
        stakedDays: 53,
        currentDay: 400,
        rangeStartDay: 300,
        rangeEndDay: 399,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 300, rangeEndDay: 399 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 10: stake starting one day after BPD (day 354) → no warning ─

    it("stake starting one day after BPD day 354 does not include BPD warning", async () => {
      // lockedDay=354, elapsedEndDay = min(459, 453) = 453; range [354, 453] excludes day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 354,
        stakedDays: 100,
        currentDay: 460,
        rangeStartDay: 354,
        rangeEndDay: 459,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 354, rangeEndDay: 459 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 11: elapsed range has not yet reached BPD → no warning ─────

    it("stake that spans BPD but elapsed range has not yet reached day 353 has no BPD warning", async () => {
      // lockedDay=300, stakedDays=200, currentDay=350
      // elapsedEndDay = min(349, 499) = 349; range [300, 349] has not yet reached day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 300,
        stakedDays: 200,
        currentDay: 350,
        rangeStartDay: 300,
        rangeEndDay: 349,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 300, rangeEndDay: 349 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).not.toContain("hexmining-yield-bpd-attribution-unresolved");
    });

    // ── Test 12: upstream evidence warnings preserved alongside BPD warning ─

    it("BPD warning is appended to upstream evidence warnings, not a replacement", async () => {
      const deps = makeDeps(makeBpdEvidence({ warnings: ["hexmining-some-upstream-warning"] }));
      const result = await estimateHexMiningYield(BPD_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.warnings).toContain("hexmining-some-upstream-warning");
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
    });
  });

  // ─── §11.9 provenance and formula-input audit trail ───────────────────────
  //
  // Verifies that the estimator boundary carries enough provenance to audit
  // which observed daily-data range was accepted for internal calculation,
  // per §11.9 minimum requirements:
  //   chainId, sourceFamily, observationId, rangeStartDay, rangeEndDay (from evidence)
  //
  // The accepted formula-input coverage interval [lockedDay, elapsedEndDay]
  // is proved correct through boundary acceptance/rejection tests rather than
  // a new public DTO field (§11.14 step 4 is where full wiring lives).

  describe("§11.9 provenance and formula-input audit trail", () => {
    // ── Test 1: all required provenance fields present in evidence_available ──

    it("evidence_available result carries all required provenance fields", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.chainId).toBe(369);
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    // ── Test 2: provenance reflects accepted evidence range, not args range ──

    it("provenance rangeStartDay/rangeEndDay reflect accepted evidence range, not args", async () => {
      // Evidence covers a wider window than the required elapsed interval.
      // Provenance must carry the evidence's own range, not args.rangeStartDay/rangeEndDay.
      const deps = makeDeps(makeEvidence({ rangeStartDay: 999, rangeEndDay: 1250 }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.provenance.rangeStartDay).toBe(999);
      expect(result.provenance.rangeEndDay).toBe(1250);
    });

    // ── Test 3: active stake — elapsedEndDay is currentDay - 1 ────────────

    it("active stake: evidence at exact elapsedEndDay=currentDay-1 is accepted with correct provenance", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1050
      // elapsedEndDay = min(1049, 1364) = 1049  (bounded by currentDay - 1)
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 1000,
        stakedDays: 365,
        currentDay: 1050,
        rangeStartDay: 1000,
        rangeEndDay: 1049,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1049 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1049);
    });

    it("active stake: evidence ending one day short of elapsedEndDay is rejected", async () => {
      // lockedDay=1000, stakedDays=365, currentDay=1050
      // elapsedEndDay=1049; evidence ends at 1048 → coverage gap
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 1000,
        stakedDays: 365,
        currentDay: 1050,
        rangeStartDay: 1000,
        rangeEndDay: 1049,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1048 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1048);
    });

    // ── Test 4: completed stake — elapsedEndDay is lockedDay + stakedDays - 1

    it("completed stake: evidence at exact elapsedEndDay=lockedDay+stakedDays-1 is accepted with correct provenance", async () => {
      // lockedDay=1000, stakedDays=100, currentDay=2000
      // elapsedEndDay = min(1999, 1099) = 1099  (bounded by stake term)
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 1000,
        stakedDays: 100,
        currentDay: 2000,
        rangeStartDay: 1000,
        rangeEndDay: 1099,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1099 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1099);
    });

    it("completed stake: evidence ending one day short is rejected", async () => {
      // lockedDay=1000, stakedDays=100, currentDay=2000
      // elapsedEndDay=1099; evidence ends at 1098 → gap
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 1000,
        stakedDays: 100,
        currentDay: 2000,
        rangeStartDay: 1000,
        rangeEndDay: 1099,
      };
      const deps = makeDeps(makeEvidence({ rangeStartDay: 1000, rangeEndDay: 1098 }));
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1098);
    });

    // ── Test 5: BPD warning (PR #226) preserves all provenance fields ─────

    it("BPD warning does not alter provenance fields", async () => {
      // lockedDay=300, stakedDays=200, currentDay=400
      // elapsedEndDay = min(399, 499) = 399; range [300, 399] includes BPD day 353
      const args: HexMiningYieldEstimateArgs = {
        ...BASE_ARGS,
        lockedDay: 300,
        stakedDays: 200,
        currentDay: 400,
        rangeStartDay: 300,
        rangeEndDay: 399,
      };
      const deps = makeDeps(
        makeEvidence({ rangeStartDay: 300, rangeEndDay: 399, observationId: "obs-bpd-provenance" }),
      );
      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
      expect(result.provenance.chainId).toBe(369);
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.observationId).toBe("obs-bpd-provenance");
      expect(result.provenance.rangeStartDay).toBe(300);
      expect(result.provenance.rangeEndDay).toBe(399);
    });

    // ── Test 6: coverage failure carries evidence provenance ──────────────

    it("coverage failure result carries evidence observationId and range in provenance", async () => {
      // Evidence starts at 1001 — misses lockedDay=1000 → insufficient_observations
      const deps = makeDeps(
        makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1199, observationId: "obs-cov-fail" }),
      );
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-insufficient-elapsed-day-coverage");
      expect(result.provenance.chainId).toBe(369);
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.observationId).toBe("obs-cov-fail");
      expect(result.provenance.rangeStartDay).toBe(1001);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    // ── Test 7: coverage failure does not call applyCalculation ──────────

    it("coverage failure does not call applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = {
        ...makeDeps(makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1199 })),
        applyCalculation,
      };
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 8: no-elapsed-days carries evidence provenance ───────────────

    it("no-elapsed-days result carries evidence observationId and range in provenance", async () => {
      // currentDay=1000 == lockedDay=1000 → no elapsed days
      const deps = makeDeps(
        makeEvidence({ observationId: "obs-no-elapsed", rangeStartDay: 1000, rangeEndDay: 1199 }),
      );
      const result = await estimateHexMiningYield({ ...BASE_ARGS, currentDay: 1000 }, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(result.yieldHex).toBeNull();
      expect(result.warnings).toContain("hexmining-yield-no-elapsed-days");
      expect(result.provenance.chainId).toBe(369);
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.observationId).toBe("obs-no-elapsed");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    // ── Test 9: no-elapsed-days does not call applyCalculation ───────────

    it("no-elapsed-days does not call applyCalculation", async () => {
      const applyCalculation: Mock = vi.fn();
      const deps = { ...makeDeps(), applyCalculation };
      const result = await estimateHexMiningYield({ ...BASE_ARGS, currentDay: 1000 }, deps);

      expect(result.status).toBe("insufficient_observations");
      expect(applyCalculation).not.toHaveBeenCalled();
    });

    // ── Test 10: no estimated status, no non-null yieldHex in any scenario ─

    it("evidence_available, coverage failure, and no-elapsed-days never expose estimated or non-null yieldHex", async () => {
      const evidenceAvailable = await estimateHexMiningYield(BASE_ARGS, makeDeps());
      const coverageFailure = await estimateHexMiningYield(
        BASE_ARGS,
        makeDeps(makeEvidence({ rangeStartDay: 1001, rangeEndDay: 1199 })),
      );
      const noElapsedDays = await estimateHexMiningYield(
        { ...BASE_ARGS, currentDay: 1000 },
        makeDeps(),
      );

      expect(evidenceAvailable.status).not.toBe("estimated");
      expect(evidenceAvailable.yieldHex).toBeNull();
      expect(coverageFailure.status).not.toBe("estimated");
      expect(coverageFailure.yieldHex).toBeNull();
      expect(noElapsedDays.status).not.toBe("estimated");
      expect(noElapsedDays.yieldHex).toBeNull();
    });
  });
});
