// HexMining Phase 4 — raw dailyData observation schema contract tests
//
// This file verifies:
//
//   1. SourceFamily.HEXMINING is exported by the Prisma client.
//   2. RawHexDailyDataObservation type has the expected field shape.
//   3. RawHexDailyDataObservationInvalidation type has the expected shape
//      and can reference an observation without mutating it (append-only).
//   4. Bigint-safe payload encoding examples: viem-shaped bigint values
//      must be converted to base-10 decimal strings before JSON serialisation.
//      The test documents the rule rather than testing a runtime validator
//      (no runtime validator exists in this PR).
//   5. Dedup key fields are present on the model.
//
// No RPC, no live database, no readers, no yield calculation, no API routes,
// no frontend. Only Prisma-generated types and pure in-memory assertions.
//
// See docs/v2-hexmining-roadmap.md §11.8–11.10 for the full policy.

import { describe, expect, it } from "vitest";

import { type Prisma, SourceFamily } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────────

const PULSECHAIN_CHAIN_ID = 369;
const PHEX_ASSET_ID =
  "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";

// ─── 1. SourceFamily.HEXMINING ────────────────────────────────────────────────

describe("SourceFamily.HEXMINING", () => {
  it("is defined and equals the string literal 'HEXMINING'", () => {
    expect(SourceFamily.HEXMINING).toBe("HEXMINING");
  });

  it("is distinct from SourceFamily.STAKING", () => {
    expect(SourceFamily.HEXMINING).not.toBe(SourceFamily.STAKING);
  });

  it("is distinct from all existing source families", () => {
    const existingFamilies: SourceFamily[] = [
      SourceFamily.TRANSFERS,
      SourceFamily.DEX,
      SourceFamily.LP,
      SourceFamily.STAKING,
      SourceFamily.NATIVE,
    ];
    for (const family of existingFamilies) {
      expect(SourceFamily.HEXMINING).not.toBe(family);
    }
  });
});

// ─── 2. RawHexDailyDataObservation shape ─────────────────────────────────────

describe("RawHexDailyDataObservation model shape", () => {
  // Build a value that satisfies the Prisma UncheckedCreateInput type.
  // This compiles only if every required field is present and correctly typed.
  it("has the required field types for a minimal observation", () => {
    const obs: Prisma.RawHexDailyDataObservationUncheckedCreateInput = {
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: 1000,
      rangeEndDay: 1099,
      observedAtBlock: BigInt("23456789"),
      observedAt: new Date("2026-06-06T00:00:00.000Z"),
      rpcEndpointLabel: "pulsechain-primary",
      payloadVersion: "v1",
      canonicalPayload: JSON.stringify([
        {
          // All numeric values are base-10 decimal strings — never bigint.
          // This is the canonical encoding contract (§11.8 bigint-safe policy).
          dayPayoutTotal: "123456789012345678",
          dayStakeSharesTotal: "9876543210",
          dayUnclaimedSatoshisTotal: "0",
        },
      ]),
      payloadHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      warnings: [],
    };

    expect(obs.chainId).toBe(PULSECHAIN_CHAIN_ID);
    expect(obs.sourceFamily).toBe("HEXMINING");
    expect(obs.rangeStartDay).toBe(1000);
    expect(obs.rangeEndDay).toBe(1099);
    // observedAtBlock is bigint in the Prisma type (BigInt → PostgreSQL BIGINT).
    // The bigint-safe encoding rule applies to canonicalPayload, not this field.
    expect(obs.observedAtBlock).toBe(BigInt("23456789"));
    expect(obs.payloadVersion).toBe("v1");
    expect(obs.warnings).toEqual([]);
  });

  it("accepts an optional rpcEndpointLabel (nullable endpoint label)", () => {
    const obs: Prisma.RawHexDailyDataObservationUncheckedCreateInput = {
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: 500,
      rangeEndDay: 600,
      observedAtBlock: BigInt("10000000"),
      observedAt: new Date("2026-06-01T12:00:00.000Z"),
      payloadVersion: "v1",
      canonicalPayload: "[]",
      payloadHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };
    // rpcEndpointLabel omitted — field is nullable in the schema
    expect(obs.rpcEndpointLabel).toBeUndefined();
  });

  it("accepts multiple warnings as a string array", () => {
    const obs: Prisma.RawHexDailyDataObservationUncheckedCreateInput = {
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: 0,
      rangeEndDay: 0,
      observedAtBlock: BigInt("1"),
      observedAt: new Date(),
      payloadVersion: "v1",
      canonicalPayload: "[]",
      payloadHash: "abc",
      warnings: [
        "hexmining-yield-rpc-rate-limited",
        "hexmining-yield-data-gap-day-500",
      ],
    };
    const w = obs.warnings as string[];
    expect(w).toHaveLength(2);
    expect(w[0]).toBe("hexmining-yield-rpc-rate-limited");
  });

  it("enforces inclusive rangeStartDay ≤ rangeEndDay by contract expectation", () => {
    // rangeEndDay = min(currentDay, lockedDay + stakedDays - 1) — §11.4 invariant #2.
    // The DB stores whatever the service provides; the valid-range invariant is
    // checked at the service layer, not with a DB constraint.
    const lockedDay = 1000;
    const stakedDays = 365;
    const currentDay = 1050;
    const expectedRangeEndDay = Math.min(
      currentDay,
      lockedDay + stakedDays - 1,
    );
    const obs: Prisma.RawHexDailyDataObservationUncheckedCreateInput = {
      chainId: PULSECHAIN_CHAIN_ID,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: lockedDay,
      rangeEndDay: expectedRangeEndDay,
      observedAtBlock: BigInt("20000000"),
      observedAt: new Date(),
      payloadVersion: "v1",
      canonicalPayload: "[]",
      payloadHash: "def",
    };
    expect(obs.rangeStartDay).toBe(1000);
    expect(obs.rangeEndDay).toBe(1050); // min(1050, 1000 + 365 - 1) = min(1050, 1364) = 1050
    expect(obs.rangeStartDay).toBeLessThanOrEqual(obs.rangeEndDay as number);
  });

  it("type has correct Prisma model name", () => {
    // This is a compile-time check: if RawHexDailyDataObservation is not in the
    // generated client, this import will fail at typecheck/build time.
    const modelName = "RawHexDailyDataObservation" satisfies keyof Prisma.TypeMap["model"];
    expect(modelName).toBe("RawHexDailyDataObservation");
  });
});

// ─── 3. RawHexDailyDataObservationInvalidation shape ─────────────────────────

describe("RawHexDailyDataObservationInvalidation model shape (append-only)", () => {
  it("has the required fields for a reorg invalidation record", () => {
    const inv: Prisma.RawHexDailyDataObservationInvalidationUncheckedCreateInput =
      {
        observationId: "obs_cuid_placeholder",
        reason: "reorg",
        reorgBlockHash:
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      };

    expect(inv.observationId).toBe("obs_cuid_placeholder");
    expect(inv.reason).toBe("reorg");
    expect(inv.reorgBlockHash).toBeTruthy();
    // supersededByObservationId omitted — nullable: invalidation without replacement
    expect(inv.supersededByObservationId).toBeUndefined();
  });

  it("can record a supersession with a replacement observation id", () => {
    const inv: Prisma.RawHexDailyDataObservationInvalidationUncheckedCreateInput =
      {
        observationId: "old_obs_id",
        reason: "superseded-by-later-read",
        supersededByObservationId: "new_obs_id",
      };

    expect(inv.observationId).toBe("old_obs_id");
    expect(inv.supersededByObservationId).toBe("new_obs_id");
    expect(inv.reorgBlockHash).toBeUndefined();
  });

  it("references the observation by id — does not embed the observation data", () => {
    // The invalidation model stores only the reference (observationId), not a
    // copy of the observation. The raw observation row remains intact (immutable).
    const inv: Prisma.RawHexDailyDataObservationInvalidationUncheckedCreateInput =
      {
        observationId: "cuid_of_invalidated_obs",
        reason: "reorg",
      };

    // Only the ID is stored — the original row is never mutated.
    expect(typeof inv.observationId).toBe("string");
    // No 'observation' embed in this type (FK only)
    expect("canonicalPayload" in inv).toBe(false);
    expect("rangeStartDay" in inv).toBe(false);
  });

  it("type has correct Prisma model name", () => {
    const modelName =
      "RawHexDailyDataObservationInvalidation" satisfies keyof Prisma.TypeMap["model"];
    expect(modelName).toBe("RawHexDailyDataObservationInvalidation");
  });
});

// ─── 4. Bigint-safe payload encoding policy ───────────────────────────────────

describe("bigint-safe canonicalPayload encoding (§11.8 policy)", () => {
  // viem returns dailyDataRange results with uint*/int* fields as JavaScript
  // bigint values. JSON.stringify throws on bigint; naive encoding is unsafe.
  // The canonical encoding rule: all uint*/int* values must be serialised as
  // base-10 decimal strings. This test documents the rule with examples.

  it("serialises viem-shaped uint values as base-10 decimal strings", () => {
    // Simulated viem dailyDataRange output (bigint values from the contract)
    const viemShapedDayData = {
      dayPayoutTotal: BigInt("123456789012345678901234567890"),
      dayStakeSharesTotal: BigInt("987654321098765432109876543"),
      dayUnclaimedSatoshisTotal: BigInt("0"),
    };

    // Canonical encoding: convert each bigint to a decimal string before JSON.
    function encodeForStorage(raw: {
      dayPayoutTotal: bigint;
      dayStakeSharesTotal: bigint;
      dayUnclaimedSatoshisTotal: bigint;
    }): {
      dayPayoutTotal: string;
      dayStakeSharesTotal: string;
      dayUnclaimedSatoshisTotal: string;
    } {
      return {
        dayPayoutTotal: raw.dayPayoutTotal.toString(10),
        dayStakeSharesTotal: raw.dayStakeSharesTotal.toString(10),
        dayUnclaimedSatoshisTotal: raw.dayUnclaimedSatoshisTotal.toString(10),
      };
    }

    const canonical = encodeForStorage(viemShapedDayData);

    // All values are now decimal strings
    expect(typeof canonical.dayPayoutTotal).toBe("string");
    expect(typeof canonical.dayStakeSharesTotal).toBe("string");
    expect(canonical.dayPayoutTotal).toBe("123456789012345678901234567890");
    expect(canonical.dayStakeSharesTotal).toBe("987654321098765432109876543");
    expect(canonical.dayUnclaimedSatoshisTotal).toBe("0");

    // JSON.stringify does not throw on the canonical form
    const json = JSON.stringify([canonical]);
    expect(() => JSON.parse(json)).not.toThrow();

    // The resulting JSON contains no bigint literals — it is storable in
    // canonicalPayload without precision loss.
    expect(json).toContain('"dayPayoutTotal":"123456789012345678901234567890"');
  });

  it("demonstrates that raw bigint values cannot be JSON-serialised directly", () => {
    // This documents WHY the encoding rule exists.
    // JSON.stringify with a bigint value throws a TypeError at runtime.
    const viemValue = BigInt("99999999999999999999");
    expect(() =>
      JSON.stringify({ dayPayoutTotal: viemValue }),
    ).toThrow();
  });

  it("decimal-string values round-trip through JSON.parse without precision loss", () => {
    // Large uint values that exceed JavaScript's safe integer range must not be
    // coerced to numbers. The canonical payload stores them as strings, which
    // JSON.parse preserves as strings (no numeric coercion).
    const largeValue = "123456789012345678901234567890";
    const json = JSON.stringify([{ dayPayoutTotal: largeValue }]);
    const parsed = JSON.parse(json) as Array<{ dayPayoutTotal: string }>;

    expect(parsed[0]?.dayPayoutTotal).toBe(largeValue);
    expect(typeof parsed[0]?.dayPayoutTotal).toBe("string");
  });

  it("encodes base-10 (not hex, not scientific notation)", () => {
    const value = BigInt("255");
    const decimal = value.toString(10);
    const hex = value.toString(16);

    expect(decimal).toBe("255");
    expect(hex).toBe("ff");

    // Canonical payload must use decimal ("255"), not hex ("ff")
    expect(decimal).not.toBe(hex);
    expect(decimal).toMatch(/^\d+$/); // only digits, no 0x prefix
  });
});

// ─── 5. Dedup key field presence ─────────────────────────────────────────────

describe("dedup key fields are present on the observation model", () => {
  // The service-layer dedup check uses:
  //   (chainId, sourceFamily, rangeStartDay, rangeEndDay,
  //    observedAtBlock, rpcEndpointLabel, payloadHash)
  // All these fields must be present on the model.

  it("observation UncheckedCreateInput includes all service-layer dedup fields", () => {
    const obs: Prisma.RawHexDailyDataObservationUncheckedCreateInput = {
      chainId: 369,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: 100,
      rangeEndDay: 200,
      observedAtBlock: BigInt("5000000"),
      observedAt: new Date(),
      rpcEndpointLabel: "pulsechain-primary-sha256-abc123",
      payloadVersion: "v1",
      canonicalPayload: "[]",
      payloadHash: "sha256hexvalue",
    };

    // All dedup key fields are accessible
    expect(obs.chainId).toBeDefined();
    expect(obs.sourceFamily).toBeDefined();
    expect(obs.rangeStartDay).toBeDefined();
    expect(obs.rangeEndDay).toBeDefined();
    expect(obs.observedAtBlock).toBeDefined();
    expect(obs.rpcEndpointLabel).toBeDefined();
    expect(obs.payloadHash).toBeDefined();
  });

  it("two observations with different rpcEndpointLabel are not the same dedup key", () => {
    // Even at the same block and range, different endpoint labels produce
    // different dedup keys and should be stored as separate rows.
    const baseDedup = {
      chainId: 369,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: 100,
      rangeEndDay: 200,
      observedAtBlock: BigInt("5000000"),
      payloadHash: "same-hash",
    };

    const dedupA = { ...baseDedup, rpcEndpointLabel: "endpoint-a" };
    const dedupB = { ...baseDedup, rpcEndpointLabel: "endpoint-b" };

    expect(dedupA.rpcEndpointLabel).not.toBe(dedupB.rpcEndpointLabel);
    // Different endpoint label → different dedup key → different row
    const keyA = `${dedupA.chainId}:${dedupA.sourceFamily}:${dedupA.rangeStartDay}:${dedupA.rangeEndDay}:${dedupA.observedAtBlock}:${dedupA.rpcEndpointLabel}:${dedupA.payloadHash}`;
    const keyB = `${dedupB.chainId}:${dedupB.sourceFamily}:${dedupB.rangeStartDay}:${dedupB.rangeEndDay}:${dedupB.observedAtBlock}:${dedupB.rpcEndpointLabel}:${dedupB.payloadHash}`;
    expect(keyA).not.toBe(keyB);
  });

  it("phex assetId uses chain-aware format — never symbol-only", () => {
    // Observations are keyed by chainId (369), not by symbol "pHEX".
    expect(PHEX_ASSET_ID).toMatch(/^chain:369:erc20:0x/);
    expect(PHEX_ASSET_ID).not.toBe("HEX");
    expect(PHEX_ASSET_ID).not.toBe("pHEX");
  });
});
