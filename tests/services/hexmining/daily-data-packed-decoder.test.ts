// HexMining Phase 4C — packed uint256 entry decoder tests
//
// Tests decodePackedDailyDataEntry and decodePackedDailyDataRange using the
// deterministic test vectors from docs/hex-dailydata-packing-spec.md §4.
//
// Verified bit layout (§2):
//   bits   0–71:  dayPayoutTotal            uint72   mask = (2n**72n)-1n
//   bits  72–143: dayStakeSharesTotal        uint72   mask = (2n**72n)-1n
//   bits 144–199: dayUnclaimedSatoshisTotal  uint56   mask = (2n**56n)-1n
//   bits 200–255: zero padding — values above (2n**200n)-1n are rejected
//
// No live DB, no RPC, no viem, no routes. Pure deterministic unit tests.

import { describe, expect, it } from "vitest";

import {
  decodePackedDailyDataEntry,
  decodePackedDailyDataRange,
  type DecodeDailyDataEntryResult,
  type DecodeDailyDataRangeResult,
} from "@/services/hexmining/daily-data-packed-decoder";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertOk(
  result: DecodeDailyDataEntryResult,
): asserts result is Extract<DecodeDailyDataEntryResult, { ok: true }> {
  expect(result.ok).toBe(true);
}

function assertFail(
  result: DecodeDailyDataEntryResult,
): asserts result is Extract<DecodeDailyDataEntryResult, { ok: false }> {
  expect(result.ok).toBe(false);
}

function assertRangeOk(
  result: DecodeDailyDataRangeResult,
): asserts result is Extract<DecodeDailyDataRangeResult, { ok: true }> {
  expect(result.ok).toBe(true);
}

function assertRangeFail(
  result: DecodeDailyDataRangeResult,
): asserts result is Extract<DecodeDailyDataRangeResult, { ok: false }> {
  expect(result.ok).toBe(false);
}

// ─── Constants (mirrors decoder internals for test derivation) ────────────────

const HEARTS_MASK = (2n ** 72n) - 1n;
const SATS_MASK = (2n ** 56n) - 1n;
const MAX_PACKED = (2n ** 200n) - 1n;

// ─── decodePackedDailyDataEntry ───────────────────────────────────────────────

describe("decodePackedDailyDataEntry", () => {
  // ── §4 Vector 1 — zero value ─────────────────────────────────────────────

  it("vector 1: zero packed value returns all-zero fields", () => {
    const result = decodePackedDailyDataEntry(0n);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(0n);
    expect(result.entry.dayStakeSharesTotal).toBe(0n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  // ── §4 Vector 2 — payout and shares, no satoshis ─────────────────────────

  it("vector 2: payout=1000, shares=500, satoshis=0", () => {
    // packed = 1000n + (500n * 2n**72n) = 2361183241434822606849000n
    const packed = 1000n + (500n * (2n ** 72n));
    expect(packed).toBe(2361183241434822606849000n);

    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(1000n);
    expect(result.entry.dayStakeSharesTotal).toBe(500n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  // ── §4 Vector 3 — max dayPayoutTotal, non-zero shares ─────────────────────

  it("vector 3: payout=uint72max, shares=1, satoshis=0", () => {
    // packed = (2n**72n - 1n) + (1n * 2n**72n) = 9444732965739290427391n
    const packed = (2n ** 72n - 1n) + (1n * (2n ** 72n));
    expect(packed).toBe(9444732965739290427391n);

    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(2n ** 72n - 1n);
    expect(result.entry.dayStakeSharesTotal).toBe(1n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  // ── §4 Vector 4 — valid packed upper bound ────────────────────────────────

  it("vector 4: max valid packed value (2n**200n - 1n) decodes without error", () => {
    const result = decodePackedDailyDataEntry(MAX_PACKED);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(HEARTS_MASK);
    expect(result.entry.dayStakeSharesTotal).toBe(HEARTS_MASK);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(SATS_MASK);
  });

  // ── All three fields non-zero including satoshis ──────────────────────────

  it("all three fields non-zero: payout=42, shares=100, satoshis=7", () => {
    const packed = 42n | (100n << 72n) | (7n << 144n);
    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(42n);
    expect(result.entry.dayStakeSharesTotal).toBe(100n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(7n);
  });

  // ── Bit 72 set (from PR #213 ABI fix test) ────────────────────────────────

  it("bit 72 set (2n**72n): dayStakeSharesTotal=1, other fields=0", () => {
    // This value proves the decoder treats the input as uint256, not uint72.
    // If the decoder incorrectly masked to 72 bits before shifting, shares would be wrong.
    const packed = 2n ** 72n; // = 4722366482869645213696n
    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(0n);
    expect(result.entry.dayStakeSharesTotal).toBe(1n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  // ── max per-field values ──────────────────────────────────────────────────

  it("max dayStakeSharesTotal (uint72 max) at correct bit offset", () => {
    const packed = HEARTS_MASK << 72n;
    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(0n);
    expect(result.entry.dayStakeSharesTotal).toBe(HEARTS_MASK);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  it("max dayUnclaimedSatoshisTotal (uint56 max) at correct bit offset", () => {
    const packed = SATS_MASK << 144n;
    const result = decodePackedDailyDataEntry(packed);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(0n);
    expect(result.entry.dayStakeSharesTotal).toBe(0n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(SATS_MASK);
  });

  // ── Rejection — negative value ────────────────────────────────────────────

  it("rejects negative value with hexmining-packed-negative", () => {
    const result = decodePackedDailyDataEntry(-1n);
    assertFail(result);
    expect(result.code).toBe("hexmining-packed-negative");
  });

  it("rejects -1n", () => {
    const result = decodePackedDailyDataEntry(-1n);
    assertFail(result);
    expect(result.code).toBe("hexmining-packed-negative");
  });

  // ── Rejection — exceeds max (bits 200–255 non-zero) ───────────────────────

  it("rejects value exactly one above max (2n**200n) with hexmining-packed-exceeds-max", () => {
    const result = decodePackedDailyDataEntry(2n ** 200n);
    assertFail(result);
    expect(result.code).toBe("hexmining-packed-exceeds-max");
  });

  it("rejects value with bit 200 set", () => {
    const result = decodePackedDailyDataEntry(1n << 200n);
    assertFail(result);
    expect(result.code).toBe("hexmining-packed-exceeds-max");
  });

  it("rejects uint256 max (2n**256n - 1n)", () => {
    const result = decodePackedDailyDataEntry(2n ** 256n - 1n);
    assertFail(result);
    expect(result.code).toBe("hexmining-packed-exceeds-max");
  });

  // ── Fields are isolated ───────────────────────────────────────────────────

  it("fields do not bleed into adjacent fields", () => {
    // All bits of payout set, shares=0, satoshis=0
    const result = decodePackedDailyDataEntry(HEARTS_MASK);
    assertOk(result);
    expect(result.entry.dayPayoutTotal).toBe(HEARTS_MASK);
    expect(result.entry.dayStakeSharesTotal).toBe(0n);
    expect(result.entry.dayUnclaimedSatoshisTotal).toBe(0n);
  });
});

// ─── decodePackedDailyDataRange ───────────────────────────────────────────────

describe("decodePackedDailyDataRange", () => {
  it("empty array returns ok with empty entries", () => {
    const result = decodePackedDailyDataRange([]);
    assertRangeOk(result);
    expect(result.entries).toHaveLength(0);
  });

  it("single valid entry returns correct fields", () => {
    const packed = 1000n + (500n * (2n ** 72n));
    const result = decodePackedDailyDataRange([packed]);
    assertRangeOk(result);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.dayPayoutTotal).toBe(1000n);
    expect(result.entries[0]!.dayStakeSharesTotal).toBe(500n);
    expect(result.entries[0]!.dayUnclaimedSatoshisTotal).toBe(0n);
  });

  it("multiple entries are decoded in order", () => {
    const v1 = 0n;
    const v2 = 1000n + (500n * (2n ** 72n));
    const v3 = 42n | (100n << 72n) | (7n << 144n);
    const result = decodePackedDailyDataRange([v1, v2, v3]);
    assertRangeOk(result);
    expect(result.entries).toHaveLength(3);

    expect(result.entries[0]!.dayPayoutTotal).toBe(0n);
    expect(result.entries[0]!.dayStakeSharesTotal).toBe(0n);
    expect(result.entries[0]!.dayUnclaimedSatoshisTotal).toBe(0n);

    expect(result.entries[1]!.dayPayoutTotal).toBe(1000n);
    expect(result.entries[1]!.dayStakeSharesTotal).toBe(500n);

    expect(result.entries[2]!.dayPayoutTotal).toBe(42n);
    expect(result.entries[2]!.dayStakeSharesTotal).toBe(100n);
    expect(result.entries[2]!.dayUnclaimedSatoshisTotal).toBe(7n);
  });

  it("fails at the first invalid entry and returns its index", () => {
    const valid = 1000n;
    const invalid = -1n;
    const result = decodePackedDailyDataRange([valid, valid, invalid, valid]);
    assertRangeFail(result);
    expect(result.code).toBe("hexmining-packed-negative");
    expect(result.index).toBe(2);
  });

  it("fails on out-of-range entry and returns its index", () => {
    const valid = 0n;
    const tooLarge = 2n ** 200n;
    const result = decodePackedDailyDataRange([valid, tooLarge]);
    assertRangeFail(result);
    expect(result.code).toBe("hexmining-packed-exceeds-max");
    expect(result.index).toBe(1);
  });

  it("preserves entry order for spec test vectors", () => {
    // Vector 1, 2, 3 in order
    const vec1 = 0n;
    const vec2 = 2361183241434822606849000n;
    const vec3 = 9444732965739290427391n;
    const result = decodePackedDailyDataRange([vec1, vec2, vec3]);
    assertRangeOk(result);

    expect(result.entries[0]!.dayPayoutTotal).toBe(0n);
    expect(result.entries[1]!.dayPayoutTotal).toBe(1000n);
    expect(result.entries[1]!.dayStakeSharesTotal).toBe(500n);
    expect(result.entries[2]!.dayPayoutTotal).toBe(2n ** 72n - 1n);
    expect(result.entries[2]!.dayStakeSharesTotal).toBe(1n);
  });
});
