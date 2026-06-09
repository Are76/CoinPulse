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

    it("returns estimated when all packed entries are within valid range and formula runs", async () => {
      // All spec §4 vectors are well within (2n**200n)-1n. Formula now implemented → estimated.
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).not.toBeNull();
    });
  });

  describe("estimated — formula implemented", () => {
    it("returns estimated for valid non-invalidated evidence with valid payload", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("estimated");
      expect(result.schemaVersion).toBe("v1");
      expect(result.yieldHex).not.toBeNull();
      expect(result.provenance.observationId).toBe("obs-abc-123");
      expect(result.provenance.rangeStartDay).toBe(1000);
      expect(result.provenance.rangeEndDay).toBe(1199);
    });

    it("propagates evidence warnings into estimated result", async () => {
      const deps = makeDeps(makeEvidence({ warnings: ["hexmining-some-upstream-warning"] }));
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("estimated");
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
      // evidence_available via injected formula returning bpd_not_implemented
      const evidenceAvailable = await estimateHexMiningYield(BASE_ARGS, {
        ...makeDeps(),
        applyCalculation: vi.fn().mockReturnValue({ status: "bpd_not_implemented" as const }),
      });

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

    // ── Test 8: existing evidence_available behavior remains deterministic ─────

    it("default (no applyCalculation dep) returns estimated now that formula is implemented", async () => {
      const deps = makeDeps();
      const result = await estimateHexMiningYield(BASE_ARGS, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).not.toBeNull();
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

  describe("yield formula — §8 test vectors", () => {
    // Pack three fields into a uint256 per docs/hex-dailydata-packing-spec.md §2.
    // Matches the on-chain layout: bits 0–71 payout, 72–143 shares, 144–199 sats.
    function packEntry(payout: bigint, shares: bigint, sats: bigint = 0n): bigint {
      return payout | (shares << 72n) | (sats << 144n);
    }

    function makePayload(...entries: bigint[]): string {
      return JSON.stringify({
        schemaVersion: "v1",
        dailyData: entries.map((e) => e.toString()),
      });
    }

    // ── Vector A — single day, exact division ────────────────────────────────
    it("vector A: stakeShares=1000, payout=10000, totalShares=100000 → 100 hearts", async () => {
      const packed = packEntry(10000n, 100000n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 1000n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("100");
    });

    // ── Vector B — single day, floor truncation ───────────────────────────────
    it("vector B: stakeShares=1, payout=10, totalShares=3 → 3 hearts (floor of 3.333)", async () => {
      const packed = packEntry(10n, 3n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 1n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("3");
    });

    // ── Vector C — 3 days, constant fields ───────────────────────────────────
    it("vector C: stakeShares=500, 3 days constant payout=2000/shares=10000 → 300 hearts", async () => {
      const entry = packEntry(2000n, 10000n);
      const payload = makePayload(entry, entry, entry);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 500n, rangeStartDay: 1000, rangeEndDay: 1002 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("300");
    });

    // ── Vector D — 3 days, varying fields, zero-payout day ───────────────────
    it("vector D: stakeShares=100, 3 days varying (including zero-payout) → 900 hearts", async () => {
      const d1000 = packEntry(5000n, 1000n);
      const d1001 = packEntry(8000n, 2000n, 75n); // sats=75n present but not used
      const d1002 = packEntry(0n, 5000n);
      const payload = makePayload(d1000, d1001, d1002);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 100n, rangeStartDay: 1000, rangeEndDay: 1002 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("900");
    });

    // ── Vector E — sole staker (100% of shares) ──────────────────────────────
    it("vector E: stakeShares=dayStakeSharesTotal=5000, payout=12000 → 12000 hearts (full payout)", async () => {
      const packed = packEntry(12000n, 5000n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 5000n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("12000");
    });

    // ── Zero dayStakeSharesTotal contributes 0n ───────────────────────────────
    it("zero dayStakeSharesTotal day contributes 0n — guard prevents divide-by-zero", async () => {
      // Day 0: dayStakeSharesTotal=0 → contributes 0n. Day 1: gives 100n.
      const d0 = packEntry(50000n, 0n);
      const d1 = packEntry(10000n, 100000n);
      const payload = makePayload(d0, d1);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 1000n, rangeStartDay: 1000, rangeEndDay: 1001 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("100");
    });

    // ── dayUnclaimedSatoshisTotal is not used in yield formula ───────────────
    it("dayUnclaimedSatoshisTotal (sats=75n) does not affect yield — vector D day 1001 alone", async () => {
      // payout=8000, shares=2000, sats=75, stakeShares=100 → (100*8000)/2000 = 400
      const d1001 = packEntry(8000n, 2000n, 75n);
      const payload = makePayload(d1001);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 100n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("400");
    });

    // ── BPD guard: range containing day 353 ──────────────────────────────────
    it("range spanning day 353 returns evidence_available — BPD not silently calculated", async () => {
      const packed = packEntry(5000n, 1000n);
      const payload = makePayload(packed);
      const deps = makeDeps(
        makeEvidence({ canonicalPayload: payload, rangeStartDay: 300, rangeEndDay: 400 }),
      );
      const args = { ...BASE_ARGS, rangeStartDay: 300, rangeEndDay: 400 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });

    it("range exactly at day 353 returns evidence_available (single-day BPD guard)", async () => {
      const packed = packEntry(5000n, 1000n);
      const payload = makePayload(packed);
      const deps = makeDeps(
        makeEvidence({ canonicalPayload: payload, rangeStartDay: 353, rangeEndDay: 353 }),
      );
      const args = { ...BASE_ARGS, rangeStartDay: 353, rangeEndDay: 353 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("evidence_available");
      expect(result.yieldHex).toBeNull();
    });

    it("range ending before day 353 (e.g. 350–352) is calculated normally", async () => {
      const packed = packEntry(10000n, 100000n);
      const payload = makePayload(packed, packed, packed); // 3 entries for days 350–352
      const deps = makeDeps(
        makeEvidence({ canonicalPayload: payload, rangeStartDay: 350, rangeEndDay: 352 }),
      );
      const args = { ...BASE_ARGS, stakeShares: 1000n, rangeStartDay: 350, rangeEndDay: 352 };

      const result = await estimateHexMiningYield(args, deps);

      // 3 identical days each yielding 100n → 300n total
      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe("300");
    });

    // ── yieldHex is a bigint-safe decimal string ──────────────────────────────
    it("yieldHex is a decimal string parseable back to the exact bigint, not hex-encoded", async () => {
      const packed = packEntry(10000n, 100000n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 1000n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      if (result.yieldHex !== null) {
        expect(result.yieldHex.startsWith("0x")).toBe(false);
        expect(BigInt(result.yieldHex)).toBe(100n);
      }
    });

    it("yieldHex survives uint72-scale stakeShares without Number precision loss", async () => {
      const maxShares = 2n ** 72n - 1n;
      // stakeShares === dayStakeSharesTotal → full payout (maxShares hearts)
      const packed = packEntry(maxShares, maxShares);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: maxShares, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.yieldHex).toBe(maxShares.toString());
    });

    // ── estimated result carries correct provenance ───────────────────────────
    it("estimated result carries evidence provenance and schemaVersion", async () => {
      const packed = packEntry(10000n, 100000n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload, observationId: "obs-formula-v1" }));
      const args = { ...BASE_ARGS, stakeShares: 1000n, rangeStartDay: 1000, rangeEndDay: 1000 };

      const result = await estimateHexMiningYield(args, deps);

      expect(result.status).toBe("estimated");
      expect(result.schemaVersion).toBe("v1");
      expect(result.provenance.observationId).toBe("obs-formula-v1");
      expect(result.provenance.sourceFamily).toBe("HEXMINING");
      expect(result.provenance.chainId).toBe(369);
    });

    // ── decoded fields never leak into estimated result ───────────────────────
    it("estimated result does not expose decoded packed fields (dayPayoutTotal etc.)", async () => {
      const packed = packEntry(10000n, 100000n);
      const payload = makePayload(packed);
      const deps = makeDeps(makeEvidence({ canonicalPayload: payload }));
      const args = { ...BASE_ARGS, stakeShares: 1000n };

      const result = await estimateHexMiningYield(args, deps);
      const serialized = JSON.stringify(result);

      expect(result.status).toBe("estimated");
      expect(serialized).not.toContain("dayPayoutTotal");
      expect(serialized).not.toContain("dayStakeSharesTotal");
      expect(serialized).not.toContain("dayUnclaimedSatoshisTotal");
      expect(serialized).not.toContain("canonicalPayload");
      expect(serialized).not.toContain("dailyData");
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
});
