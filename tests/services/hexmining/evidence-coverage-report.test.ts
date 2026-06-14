import { describe, expect, it, vi } from "vitest";

import type { HexStakeDto } from "@/services/hexmining/types";
import { buildHexMiningEvidenceCoverageReport } from "@/services/hexmining/evidence-coverage-report";

function makeStake(overrides: Partial<HexStakeDto>): HexStakeDto {
  return {
    schemaVersion: "v1",
    stakeId: "1001",
    stakeIndex: 0,
    stakeSource: "native",
    chainId: 369,
    assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    walletAddress: "0x1111111111111111111111111111111111111111",
    stakeStatus: "active",
    lockedDay: 1000,
    stakedDays: 365,
    unlockedDay: null,
    principalHex: null,
    stakeShares: "123",
    tShares: null,
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
    yield: {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    },
    provenance: {
      chainId: 369,
      walletAddress: "0x1111111111111111111111111111111111111111",
      stakeId: "1001",
      stakeIndex: 0,
      stakeSource: "native",
      observedAtBlock: "123",
      observedAt: "2026-06-15T00:00:00.000Z",
      rpcEndpoint: null,
      warnings: [],
    },
    warnings: [],
    ...overrides,
  };
}

describe("buildHexMiningEvidenceCoverageReport", () => {
  it("marks an active stake covered when exact range evidence exists", async () => {
    const fetchEvidence = vi.fn().mockResolvedValue({
      observationId: "obs-exact",
      chainId: 369,
      sourceFamily: "HEXMINING",
      rangeStartDay: 1000,
      rangeEndDay: 1049,
      observedAtBlock: "234",
      observedAt: "2026-06-15T00:00:00.000Z",
      payloadVersion: "v1",
      payloadSchemaValid: true,
      isInvalidated: false,
      warnings: [],
    });

    const report = await buildHexMiningEvidenceCoverageReport({
      chainId: 369,
      currentDay: 1050,
      stakes: [makeStake({ stakeId: "1001", lockedDay: 1000, stakedDays: 365 })],
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith({
      chainId: 369,
      rangeStartDay: 1000,
      rangeEndDay: 1049,
    });
    expect(report.stakes).toEqual([
      {
        stakeId: "1001",
        lockedDay: 1000,
        currentDay: 1050,
        rangeStartDay: 1000,
        rangeEndDay: 1049,
        covered: true,
        observationId: "obs-exact",
        missingReason: null,
      },
    ]);
    expect(report.summary).toMatchObject({
      totalActiveStakes: 1,
      coveredStakes: 1,
      missingEvidenceStakes: 0,
    });
  });

  it("marks an active stake missing when no exact range evidence exists", async () => {
    const fetchEvidence = vi.fn().mockResolvedValue(null);

    const report = await buildHexMiningEvidenceCoverageReport({
      chainId: 369,
      currentDay: 1050,
      stakes: [makeStake({ stakeId: "1002", lockedDay: 1000, stakedDays: 365 })],
      fetchEvidence,
    });

    expect(report.stakes[0]).toMatchObject({
      stakeId: "1002",
      rangeStartDay: 1000,
      rangeEndDay: 1049,
      covered: false,
      observationId: null,
      missingReason: "missing_exact_observation",
    });
  });

  it("uses currentDay minus one as rangeEndDay", async () => {
    const fetchEvidence = vi.fn().mockResolvedValue(null);

    const report = await buildHexMiningEvidenceCoverageReport({
      chainId: 369,
      currentDay: 2385,
      stakes: [makeStake({ stakeId: "942663", lockedDay: 2310, stakedDays: 5555 })],
      fetchEvidence,
    });

    expect(fetchEvidence).toHaveBeenCalledWith({
      chainId: 369,
      rangeStartDay: 2310,
      rangeEndDay: 2384,
    });
    expect(report.stakes[0]?.rangeEndDay).toBe(2384);
  });

  it("summarizes covered and missing active native stakes only", async () => {
    const fetchEvidence = vi
      .fn()
      .mockResolvedValueOnce({
        observationId: "obs-covered",
        chainId: 369,
        sourceFamily: "HEXMINING",
        rangeStartDay: 1000,
        rangeEndDay: 1049,
        observedAtBlock: "234",
        observedAt: "2026-06-15T00:00:00.000Z",
        payloadVersion: "v1",
        payloadSchemaValid: true,
        isInvalidated: false,
        warnings: [],
      })
      .mockResolvedValueOnce(null);

    const report = await buildHexMiningEvidenceCoverageReport({
      chainId: 369,
      currentDay: 1050,
      stakes: [
        makeStake({ stakeId: "covered", lockedDay: 1000, stakedDays: 365 }),
        makeStake({ stakeId: "missing", lockedDay: 900, stakedDays: 365 }),
        makeStake({ stakeId: "pending", lockedDay: 2000, stakedDays: 365 }),
        makeStake({ stakeId: "overdue", lockedDay: 1, stakedDays: 10 }),
      ],
      fetchEvidence,
    });

    expect(report.summary).toEqual({
      chainId: 369,
      sourceFamily: "HEXMINING",
      totalActiveStakes: 2,
      coveredStakes: 1,
      missingEvidenceStakes: 1,
    });
    expect(report.stakes.map((stake) => stake.stakeId)).toEqual(["covered", "missing"]);
  });
});
