import { afterEach, describe, expect, it, vi } from "vitest";

const createPublicClientForChain = vi.fn();
const readNativeHexStakes = vi.fn();
const readCurrentDay = vi.fn();
const getObservationEvidenceForRange = vi.fn();
const estimateHexMiningYield = vi.fn();
const acquireAndPersistHexDailyDataObservation = vi.fn();

vi.mock("@/services/chains/public-client", () => ({ createPublicClientForChain }));
vi.mock("@/services/hexmining/reader", () => ({ readNativeHexStakes }));
vi.mock("@/services/hexmining/daily-data-reader", () => ({ readCurrentDay }));
vi.mock("@/services/hexmining/observation-evidence-provider", () => ({
  getObservationEvidenceForRange,
}));
vi.mock("@/services/hexmining/yield-estimator", () => ({ estimateHexMiningYield }));
vi.mock("@/services/hexmining/daily-data-observation-service", () => ({
  acquireAndPersistHexDailyDataObservation,
}));

function makeStake(overrides: Record<string, unknown> = {}) {
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
      estimatedYieldHearts: null,
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

describe("GET /api/hexmining/evidence/missing route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns per-active-stake exact evidence coverage summary", async () => {
    createPublicClientForChain.mockReturnValue({});
    readCurrentDay.mockResolvedValue({ ok: true, currentDay: 1050 });
    readNativeHexStakes.mockResolvedValue({
      schemaVersion: "v1",
      chainId: 369,
      walletAddress: "0x1111111111111111111111111111111111111111",
      stakeSource: "native",
      stakes: [makeStake({ stakeId: "1001", lockedDay: 1000, stakedDays: 365 })],
      totalCount: 1,
      isComplete: true,
      observedAtBlock: "123",
      observedAt: "2026-06-15T00:00:00.000Z",
      warnings: [],
    });
    getObservationEvidenceForRange.mockResolvedValue({
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

    const { GET } = await import("../../app/api/hexmining/evidence/missing/route");
    const response = await GET(
      new Request(
        "http://localhost/api/hexmining/evidence/missing?walletAddress=0x1111111111111111111111111111111111111111",
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.summary).toEqual({
      chainId: 369,
      sourceFamily: "HEXMINING",
      totalActiveStakes: 1,
      coveredStakes: 1,
      missingEvidenceStakes: 0,
      stakeReadIsComplete: true,
      stakeReadWarnings: [],
    });
    expect(body.data.stakes).toEqual([
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
  });

  it("reads native stakes without yield estimation and does not fetch dailyData or persist observations", async () => {
    createPublicClientForChain.mockReturnValue({});
    readCurrentDay.mockResolvedValue({ ok: true, currentDay: 2385 });
    readNativeHexStakes.mockResolvedValue({
      schemaVersion: "v1",
      chainId: 369,
      walletAddress: "0x1111111111111111111111111111111111111111",
      stakeSource: "native",
      stakes: [makeStake({ stakeId: "942663", lockedDay: 2310, stakedDays: 365 })],
      totalCount: 1,
      isComplete: true,
      observedAtBlock: "123",
      observedAt: "2026-06-15T00:00:00.000Z",
      warnings: [],
    });
    getObservationEvidenceForRange.mockResolvedValue(null);

    const { GET } = await import("../../app/api/hexmining/evidence/missing/route");
    await GET(
      new Request(
        "http://localhost/api/hexmining/evidence/missing?walletAddress=0x1111111111111111111111111111111111111111",
      ),
    );

    expect(readNativeHexStakes).toHaveBeenCalledWith({
      publicClient: {},
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    expect(getObservationEvidenceForRange).toHaveBeenCalledWith({
      chainId: 369,
      rangeStartDay: 2310,
      rangeEndDay: 2384,
    });
    expect(estimateHexMiningYield).not.toHaveBeenCalled();
    expect(acquireAndPersistHexDailyDataObservation).not.toHaveBeenCalled();
  });
});
