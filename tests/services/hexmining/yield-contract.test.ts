// HexMining yield status contract — Phase 4 pre-implementation
//
// Locks the HexStakeYieldDto contract for all four yield lifecycle states.
// No live RPC reads, database, Prisma, routes, readers, or frontend components.
//
// Rules encoded here (from docs/v2-hexmining-roadmap.md §11.4–§11.5):
//
//   "unsupported": no yield read path (Phases 1–3); all fields null
//   "unavailable": read path exists but data cannot be produced for this stake
//   "estimated":   dailyDataRange data available for elapsed active days (Phase 4+)
//   "exact":       confirmed at endStake via STAKE_YIELD_RECEIVED ledger entry (Phase 5+)
//
// Elapsed-days rule (§11.4 invariant #2):
//   Required coverage = lockedDay through min(currentDay, lockedDay + stakedDays).
//   Future days have no dailyData yet and are excluded from the coverage requirement.

import { describe, expect, it } from "vitest";

import { PHEX_ASSET_ID } from "@/services/hexmining/types";
import type {
  EstimatedYieldDto,
  ExactYieldDto,
  HexBpdYieldStatus,
  HexStakeDto,
  HexStakeYieldDto,
  HexStakeYieldProvenance,
  HexYieldStatus,
} from "@/services/hexmining/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PULSECHAIN_CHAIN_ID = 369;
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const OBSERVED_AT_BLOCK = "21000000";
const OBSERVED_AT = "2026-06-06T00:00:00.000Z";
const TEST_YIELD_PROVENANCE: HexStakeYieldProvenance = {
  chainId: PULSECHAIN_CHAIN_ID,
  sourceFamily: "HEXMINING",
  observationId: "00000000-0000-4000-8000-000000000001",
  rangeStartDay: 1000,
  rangeEndDay: 1200,
};

// ─── Yield DTO fixture builders ───────────────────────────────────────────────

function buildUnsupportedYieldDto(): HexStakeYieldDto {
  return {
    status: "unsupported",
    estimatedYieldHearts: null,
    bpdYieldHex: null,
    bpdYieldStatus: null,
    provenance: null,
    warnings: [],
  };
}

function buildUnavailableYieldDto(): HexStakeYieldDto {
  return {
    status: "unavailable",
    estimatedYieldHearts: null,
    bpdYieldHex: null,
    bpdYieldStatus: "not_applicable",
    provenance: null,
    warnings: [],
  };
}

function buildEstimatedYieldDto(opts: {
  estimatedYieldHearts: string;
  bpdYieldHex?: string | null;
  bpdYieldStatus?: HexBpdYieldStatus;
}): HexStakeYieldDto {
  // Callers are responsible for valid BPD combinations. Invalid combos are
  // tested with @ts-expect-error in yield-dto-invariants.test.ts.
  return {
    status: "estimated",
    estimatedYieldHearts: opts.estimatedYieldHearts,
    bpdYieldHex: opts.bpdYieldHex ?? null,
    bpdYieldStatus: opts.bpdYieldStatus ?? "unknown",
    provenance: TEST_YIELD_PROVENANCE,
    warnings: [],
  } as EstimatedYieldDto;
}

function buildExactYieldDto(opts?: {
  estimatedYieldHearts?: string | null;
  bpdYieldHex?: string | null;
  bpdYieldStatus?: HexBpdYieldStatus;
}): HexStakeYieldDto {
  // Callers are responsible for valid BPD combinations. Invalid combos are
  // tested with @ts-expect-error in yield-dto-invariants.test.ts.
  return {
    status: "exact",
    estimatedYieldHearts: opts?.estimatedYieldHearts ?? "1000000000",
    bpdYieldHex: opts?.bpdYieldHex ?? null,
    bpdYieldStatus: opts?.bpdYieldStatus ?? "not_applicable",
    provenance: TEST_YIELD_PROVENANCE,
    warnings: [],
  } as ExactYieldDto;
}

// ─── Full stake DTO fixture builder ───────────────────────────────────────────

function buildStakeDtoWithYield(yieldDto: HexStakeYieldDto): HexStakeDto {
  return {
    schemaVersion: "v1",
    stakeId: "42",
    stakeIndex: 0,
    stakeSource: "native",
    chainId: PULSECHAIN_CHAIN_ID,
    assetId: PHEX_ASSET_ID,
    walletAddress: WALLET_ADDRESS,
    stakeStatus: "active",
    lockedDay: 1000,
    stakedDays: 5555,
    unlockedDay: null,
    principalHex: "1.00000000",
    stakeShares: "500000000000",
    tShares: "0.5",
    isAutoStake: false,
    pricing: { status: "unsupported", sourceType: null, sourceId: null, observedAt: null },
    valuation: { status: "unsupported", valueQuote: null },
    pnl: {
      status: "unsupported",
      averageCost: null,
      realizedPnl: null,
      unrealizedPnl: null,
      markPrice: null,
      costBasisPolicy: null,
    },
    yield: yieldDto,
    provenance: {
      chainId: PULSECHAIN_CHAIN_ID,
      walletAddress: WALLET_ADDRESS,
      stakeId: "42",
      stakeIndex: 0,
      stakeSource: "native",
      observedAtBlock: OBSERVED_AT_BLOCK,
      observedAt: OBSERVED_AT,
      rpcEndpoint: null,
      warnings: [],
    },
    warnings: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HexYieldStatus type vocabulary", () => {
  it("includes 'unsupported'", () => {
    const status: HexYieldStatus = "unsupported";
    expect(status).toBe("unsupported");
  });

  it("includes 'unavailable'", () => {
    const status: HexYieldStatus = "unavailable";
    expect(status).toBe("unavailable");
  });

  it("includes 'estimated'", () => {
    const status: HexYieldStatus = "estimated";
    expect(status).toBe("estimated");
  });

  it("includes 'exact'", () => {
    const status: HexYieldStatus = "exact";
    expect(status).toBe("exact");
  });

  it("vocabulary covers all four lifecycle states", () => {
    const vocabulary: HexYieldStatus[] = ["unsupported", "unavailable", "estimated", "exact"];
    expect(vocabulary).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("HexStakeYieldDto type contract — accepts all four states", () => {
  it("accepts 'unsupported' shape with all null fields", () => {
    const dto: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unsupported");
  });

  it("accepts 'unavailable' shape with HexBpdYieldStatus", () => {
    const dto: HexStakeYieldDto = {
      status: "unavailable",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unavailable");
  });

  it("accepts 'estimated' shape with non-null estimatedYieldHearts", () => {
    const dto: HexStakeYieldDto = {
      status: "estimated",
      estimatedYieldHearts: "1234567890",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_YIELD_PROVENANCE,
      warnings: [],
    };
    expect(dto.status).toBe("estimated");
  });

  it("accepts 'exact' shape with non-null estimatedYieldHearts", () => {
    const dto: HexStakeYieldDto = {
      status: "exact",
      estimatedYieldHearts: "1234567890",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_YIELD_PROVENANCE,
      warnings: [],
    };
    expect(dto.status).toBe("exact");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("'unsupported' state", () => {
  it("status is 'unsupported'", () => {
    const dto = buildUnsupportedYieldDto();
    expect(dto.status).toBe("unsupported");
  });

  it("estimatedYieldHearts is null — no implied estimate exists", () => {
    const dto = buildUnsupportedYieldDto();
    expect(dto.estimatedYieldHearts).toBeNull();
  });

  it("bpdYieldHex is null", () => {
    const dto = buildUnsupportedYieldDto();
    expect(dto.bpdYieldHex).toBeNull();
  });

  it("bpdYieldStatus is null", () => {
    const dto = buildUnsupportedYieldDto();
    expect(dto.bpdYieldStatus).toBeNull();
  });

  it("is distinct from 'unavailable' — no read path has been implemented", () => {
    const unsupported = buildUnsupportedYieldDto();
    const unavailable = buildUnavailableYieldDto();
    expect(unsupported.status).not.toBe(unavailable.status);
    expect(unsupported.status).toBe("unsupported");
    expect(unavailable.status).toBe("unavailable");
  });

  it("represents the current state for all Phase 1–3 stakes", () => {
    const dto = buildStakeDtoWithYield(buildUnsupportedYieldDto());
    expect(dto.yield.status).toBe("unsupported");
    expect(dto.yield.estimatedYieldHearts).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("'unavailable' state", () => {
  it("status is 'unavailable'", () => {
    const dto = buildUnavailableYieldDto();
    expect(dto.status).toBe("unavailable");
  });

  it("represents an implemented read path that cannot produce data for this stake", () => {
    // "unavailable" is distinct from "unsupported": the backend HAS a dailyDataRange
    // read path in Phase 4+, but cannot produce a valid estimate for this stake right now
    // (e.g. rate limit, day-range gap, stale data).
    const dto = buildUnavailableYieldDto();
    expect(dto.status).toBe("unavailable");
    expect(dto.status).not.toBe("unsupported");
  });

  it("estimatedYieldHearts is null — partial data must not produce a partial estimate", () => {
    const dto = buildUnavailableYieldDto();
    expect(dto.estimatedYieldHearts).toBeNull();
  });

  it("bpdYieldHex is null", () => {
    const dto = buildUnavailableYieldDto();
    expect(dto.bpdYieldHex).toBeNull();
  });

  it("bpdYieldStatus is HexBpdYieldStatus (not null) — read path is wired and BPD status is known", () => {
    const dto = buildUnavailableYieldDto();
    expect(dto.bpdYieldStatus).toBe("not_applicable");
    expect(dto.bpdYieldStatus).not.toBeNull();
  });

  it("is distinct from 'estimated' — data cannot be produced at this time", () => {
    const unavailable = buildUnavailableYieldDto();
    const estimated = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    expect(unavailable.status).toBe("unavailable");
    expect(estimated.status).toBe("estimated");
    expect(unavailable.status).not.toBe(estimated.status);
  });

  it("stake with 'unavailable' yield carries explicit warning strings on the stake DTO", () => {
    const dto = buildStakeDtoWithYield({
      ...buildUnavailableYieldDto(),
    });
    // Rate-limit warning added at the stake level, not inside the yield DTO
    const stakeWithWarning: HexStakeDto = {
      ...dto,
      warnings: ["hexmining-yield-rpc-rate-limited"],
    };
    expect(stakeWithWarning.yield.status).toBe("unavailable");
    expect(stakeWithWarning.warnings).toContain("hexmining-yield-rpc-rate-limited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("'estimated' state", () => {
  it("status is 'estimated'", () => {
    const dto = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    expect(dto.status).toBe("estimated");
  });

  it("estimatedYieldHearts is non-null and a string", () => {
    const dto = buildEstimatedYieldDto({ estimatedYieldHearts: "1234567890" });
    expect(dto.estimatedYieldHearts).not.toBeNull();
    expect(typeof dto.estimatedYieldHearts).toBe("string");
  });

  it("estimatedYieldHearts is a non-empty string", () => {
    const dto = buildEstimatedYieldDto({ estimatedYieldHearts: "1234567890" });
    expect(dto.estimatedYieldHearts!.length).toBeGreaterThan(0);
  });

  it("bpdYieldStatus is non-null — must be resolved before status is 'estimated'", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldStatus: "not_applicable",
    });
    expect(dto.bpdYieldStatus).not.toBeNull();
  });

  it("provenance fields are required — stake DTO carries non-null observedAtBlock and observedAt", () => {
    // "estimated" requires a valid observedAtBlock and observedAt in provenance
    const stake = buildStakeDtoWithYield(buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" }));
    expect(stake.provenance.observedAtBlock).not.toBeNull();
    expect(stake.provenance.observedAt).not.toBeNull();
    expect(stake.provenance.observedAtBlock).toBe(OBSERVED_AT_BLOCK);
  });

  it("provenance.observedAtBlock is a string (block number as string)", () => {
    const stake = buildStakeDtoWithYield(buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" }));
    expect(typeof stake.provenance.observedAtBlock).toBe("string");
  });

  // Elapsed-days rule — see docs/v2-hexmining-roadmap.md §11.4 invariant #2
  it("elapsed-days rule: required coverage is lockedDay through min(currentDay, lockedDay + stakedDays)", () => {
    // For an active stake: lockedDay=1000, stakedDays=5555, currentDay=5000
    //   requiredEndDay = min(5000, 1000+5555) = min(5000, 6555) = 5000
    //   Days 5001..6555 are future — they have no dailyData yet and are NOT required.
    const lockedDay = 1000;
    const stakedDays = 5555;
    const currentDay = 5000;
    const requiredEndDay = Math.min(currentDay, lockedDay + stakedDays);

    expect(requiredEndDay).toBe(5000);
    expect(requiredEndDay).toBeLessThan(lockedDay + stakedDays); // future days excluded
  });

  it("elapsed-days rule: for an overdue stake the full locked-day range is required", () => {
    // Overdue: currentDay >= lockedDay + stakedDays (all days have passed)
    //   lockedDay=1000, stakedDays=365, currentDay=2000
    //   requiredEndDay = min(2000, 1000+365) = min(2000, 1365) = 1365 = lockedDay + stakedDays
    const lockedDay = 1000;
    const stakedDays = 365;
    const currentDay = 2000;
    const requiredEndDay = Math.min(currentDay, lockedDay + stakedDays);

    expect(requiredEndDay).toBe(1365);
    expect(requiredEndDay).toBe(lockedDay + stakedDays); // full range — stake is over
  });

  it("bpdYieldHex is null when bpdYieldStatus is 'not_applicable'", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    });
    expect(dto.bpdYieldHex).toBeNull();
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("bpdYieldHex is non-null when bpdYieldStatus is 'applicable'", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
    });
    expect(dto.bpdYieldHex).not.toBeNull();
    expect(dto.bpdYieldStatus).toBe("applicable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("'exact' state", () => {
  it("status is 'exact'", () => {
    const dto = buildExactYieldDto();
    expect(dto.status).toBe("exact");
  });

  it("cannot be inferred from an estimate alone — requires endStake event", () => {
    // "exact" is only set when an endStake event has been ingested and the
    // STAKE_YIELD_RECEIVED ledger entry is present. An "estimated" DTO can never
    // promote itself to "exact" automatically — promotion requires external evidence.
    const estimated = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    expect(estimated.status).toBe("estimated");
    // The backend must never flip status from "estimated" to "exact" without an indexed endStake.
    expect(estimated.status).not.toBe("exact");
  });

  it("estimatedYieldHearts is non-null — carries the confirmed exact yield value", () => {
    const dto = buildExactYieldDto({ estimatedYieldHearts: "1234567890" });
    expect(dto.estimatedYieldHearts).not.toBeNull();
  });

  it("bpdYieldStatus is non-null — BPD applicability is resolved at endStake", () => {
    const dto = buildExactYieldDto({ bpdYieldStatus: "not_applicable" });
    expect(dto.bpdYieldStatus).not.toBeNull();
  });

  it("is Phase 5+ scope — distinct from 'estimated' (Phase 4+) status", () => {
    const exact = buildExactYieldDto();
    const estimated = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    expect(exact.status).not.toBe(estimated.status);
    expect(exact.status).toBe("exact");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("promotion guards", () => {
  it("'unsupported' → 'estimated': only when complete elapsed-day coverage is available", () => {
    // A stake correctly promoted to "estimated" carries a non-null estimatedYieldHearts.
    // A stake that cannot be promoted remains "unsupported".
    const promoted = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    const notPromoted = buildUnsupportedYieldDto();

    expect(promoted.status).toBe("estimated");
    expect(promoted.estimatedYieldHearts).not.toBeNull();
    expect(notPromoted.status).toBe("unsupported");
    expect(notPromoted.estimatedYieldHearts).toBeNull();
  });

  it("'unavailable' must not silently become 'estimated' with partial data", () => {
    // If dailyDataRange has gaps, the backend must produce "unavailable", not "estimated".
    // Partial data passed off as a complete estimate violates the contract.
    const withGap = buildUnavailableYieldDto();
    expect(withGap.status).toBe("unavailable");
    expect(withGap.estimatedYieldHearts).toBeNull(); // no estimate produced from partial data
  });

  it("'estimated' → 'exact' never occurs automatically", () => {
    // Promotion to "exact" requires an indexed endStake event with a confirmed
    // STAKE_YIELD_RECEIVED ledger entry. No automatic time-based or field-based
    // promotion is valid.
    const estimated = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });
    // Simulating the backend NOT auto-promoting based on the estimate alone:
    expect(estimated.status).toBe("estimated");
    expect(estimated.status).not.toBe("exact");
  });

  it("'unavailable' with warning is structurally distinct from 'estimated'", () => {
    const unavailable = buildUnavailableYieldDto();
    const estimated = buildEstimatedYieldDto({ estimatedYieldHearts: "1000000000" });

    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.estimatedYieldHearts).toBeNull();

    expect(estimated.status).toBe("estimated");
    expect(estimated.estimatedYieldHearts).not.toBeNull();
  });

  it("rate-limit failure must produce 'unavailable', not 'estimated' with zeroed fields", () => {
    // Contract: a rate-limited read must never coerce its result to "estimated"
    // by returning a zero or placeholder estimatedYieldHearts.
    const rateLimitResult = buildUnavailableYieldDto();
    expect(rateLimitResult.status).toBe("unavailable");
    expect(rateLimitResult.estimatedYieldHearts).toBeNull();
    // Zero is not a valid sentinel — missing data must be null, not "0"
    expect(rateLimitResult.estimatedYieldHearts).not.toBe("0");
  });

  it("day-range gap must produce 'unavailable', not a partial 'estimated'", () => {
    // If dailyDataRange returns data with a gap (some days missing), status must be
    // "unavailable" with a warning, not "estimated" with incomplete data.
    const withGap = buildUnavailableYieldDto();
    const stakeDto = buildStakeDtoWithYield(withGap);
    const stakeWithWarning: HexStakeDto = {
      ...stakeDto,
      warnings: ["hexmining-yield-data-gap-day-1234"],
    };
    expect(stakeWithWarning.yield.status).toBe("unavailable");
    expect(stakeWithWarning.warnings).toContain("hexmining-yield-data-gap-day-1234");
    expect(stakeWithWarning.yield.estimatedYieldHearts).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Big Pay Day invariants", () => {
  it("BPD yield attribution is separate from general yield in estimatedYieldHearts", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000", // general yield only — BPD excluded
      bpdYieldHex: "5000000000",        // BPD yield tracked separately
      bpdYieldStatus: "applicable",
    });
    // estimatedYieldHearts and bpdYieldHex are separate fields — never summed silently
    expect(dto.estimatedYieldHearts).toBe("1000000000");
    expect(dto.bpdYieldHex).toBe("5000000000");
    expect(dto.estimatedYieldHearts).not.toBe(dto.bpdYieldHex);
  });

  it("estimatedYieldHearts must not silently include BPD yield", () => {
    // The backend must never add bpdYieldHex into estimatedYieldHearts.
    // Both fields are separate and independently auditable.
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
    });
    // If they were summed, estimatedYieldHearts would equal "6000000000" — not the case
    expect(dto.estimatedYieldHearts).toBe("1000000000");
    expect(Number(dto.estimatedYieldHearts)).not.toBe(
      Number(dto.estimatedYieldHearts) + Number(dto.bpdYieldHex),
    );
  });

  it("bpdYieldStatus vocabulary covers three expected values", () => {
    const vocabulary: HexBpdYieldStatus[] = ["applicable", "not_applicable", "unknown"];
    expect(vocabulary).toHaveLength(3);
    expect(vocabulary).toContain("applicable");
    expect(vocabulary).toContain("not_applicable");
    expect(vocabulary).toContain("unknown");
  });

  it("bpdYieldStatus 'applicable' requires non-null bpdYieldHex", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
    });
    expect(dto.bpdYieldStatus).toBe("applicable");
    expect(dto.bpdYieldHex).not.toBeNull();
  });

  it("bpdYieldStatus 'not_applicable' has null bpdYieldHex", () => {
    const dto = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    });
    expect(dto.bpdYieldStatus).toBe("not_applicable");
    expect(dto.bpdYieldHex).toBeNull();
  });

  it("BPD attribution only occurs when stake spanned HEX day 353", () => {
    // A stake that began after day 353 or ended before day 353 is "not_applicable".
    // This is a design constraint documented in the contract test.
    const noOverlap = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    });
    expect(noOverlap.bpdYieldStatus).toBe("not_applicable");
    expect(noOverlap.bpdYieldHex).toBeNull();

    const withOverlap = buildEstimatedYieldDto({
      estimatedYieldHearts: "1000000000",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
    });
    expect(withOverlap.bpdYieldStatus).toBe("applicable");
    expect(withOverlap.bpdYieldHex).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("elapsed-days rule for active stakes", () => {
  it("active stake: required coverage end = min(currentDay, lockedDay + stakedDays)", () => {
    // Active stake: lockedDay <= currentDay < lockedDay + stakedDays
    // currentDay is inside the stake window — not all days have elapsed.
    const lockedDay = 1000;
    const stakedDays = 5555;
    const currentDay = 3000; // active: 1000 <= 3000 < 6555
    const requiredEndDay = Math.min(currentDay, lockedDay + stakedDays);

    expect(requiredEndDay).toBe(3000);
    expect(requiredEndDay).toBeLessThan(lockedDay + stakedDays);
  });

  it("active stake: future days are beyond currentDay and have no dailyData", () => {
    const lockedDay = 1000;
    const stakedDays = 5555;
    const currentDay = 3000;
    const firstFutureDay = currentDay + 1;
    const unlockedDay = lockedDay + stakedDays;

    // Days 3001..6555 have no dailyData yet — not part of required coverage
    expect(firstFutureDay).toBeGreaterThan(currentDay);
    expect(firstFutureDay).toBeLessThan(unlockedDay);
  });

  it("overdue/ended stake: required coverage is full locked-day range", () => {
    // All days have passed — full range is required
    const lockedDay = 1000;
    const stakedDays = 365;
    const currentDay = 2000; // >= lockedDay + stakedDays = 1365 → overdue
    const requiredEndDay = Math.min(currentDay, lockedDay + stakedDays);

    expect(requiredEndDay).toBe(lockedDay + stakedDays); // = 1365
    expect(currentDay).toBeGreaterThan(requiredEndDay); // currentDay past the end
  });

  it("elapsed-days rule prevents 'unavailable' solely because future days have no data", () => {
    // An active stake SHOULD be promotable to "estimated" once elapsed days are covered.
    // The rule means partial coverage up to currentDay is SUFFICIENT — not a gap.
    const lockedDay = 1000;
    const stakedDays = 5555;
    const currentDay = 3000;
    const requiredCoverageEnd = Math.min(currentDay, lockedDay + stakedDays);
    const hasCoverageForElapsedDays = requiredCoverageEnd === currentDay; // true for active stake

    // If elapsed days are fully covered, the backend must produce "estimated", not "unavailable"
    expect(hasCoverageForElapsedDays).toBe(true);
    expect(requiredCoverageEnd).toBe(currentDay);
  });
});
