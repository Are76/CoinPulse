import "server-only";

// Verified bit layout from docs/hex-dailydata-packing-spec.md §2 (Sources A, B, C).
// Each element returned by dailyDataRange(beginDay, endDay) packs three fields:
//   bits   0–71:  dayPayoutTotal            (uint72)
//   bits  72–143: dayStakeSharesTotal        (uint72)
//   bits 144–199: dayUnclaimedSatoshisTotal  (uint56)
//   bits 200–255: zero padding

const MAX_PACKED = (2n ** 200n) - 1n;
const HEARTS_MASK = (2n ** 72n) - 1n; // uint72 mask
const SATS_MASK = (2n ** 56n) - 1n;   // uint56 mask

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecodedDailyDataEntry = {
  dayPayoutTotal: bigint;
  dayStakeSharesTotal: bigint;
  dayUnclaimedSatoshisTotal: bigint;
};

export type DecodeDailyDataEntryErrorCode =
  | "hexmining-packed-negative"
  | "hexmining-packed-exceeds-max";

export type DecodeDailyDataEntryResult =
  | { ok: true; entry: DecodedDailyDataEntry }
  | { ok: false; code: DecodeDailyDataEntryErrorCode };

export type DecodeDailyDataRangeResult =
  | { ok: true; entries: readonly DecodedDailyDataEntry[] }
  | { ok: false; code: DecodeDailyDataEntryErrorCode; index: number };

// ─── Single-entry decoder ─────────────────────────────────────────────────────

export function decodePackedDailyDataEntry(
  packed: bigint,
): DecodeDailyDataEntryResult {
  if (packed < 0n) {
    return { ok: false, code: "hexmining-packed-negative" };
  }
  if (packed > MAX_PACKED) {
    return { ok: false, code: "hexmining-packed-exceeds-max" };
  }
  return {
    ok: true,
    entry: {
      dayPayoutTotal: packed & HEARTS_MASK,
      dayStakeSharesTotal: (packed >> 72n) & HEARTS_MASK,
      dayUnclaimedSatoshisTotal: (packed >> 144n) & SATS_MASK,
    },
  };
}

// ─── Array decoder ────────────────────────────────────────────────────────────

export function decodePackedDailyDataRange(
  packed: readonly bigint[],
): DecodeDailyDataRangeResult {
  const entries: DecodedDailyDataEntry[] = [];
  for (let i = 0; i < packed.length; i++) {
    const result = decodePackedDailyDataEntry(packed[i]!);
    if (!result.ok) {
      return { ok: false, code: result.code, index: i };
    }
    entries.push(result.entry);
  }
  return { ok: true, entries };
}
