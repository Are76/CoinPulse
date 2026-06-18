import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HexStakeDto, HexStakeListDto } from "@/services/hexmining/types";

// Keep in outer scope so mock factories close over them across vi.resetModules() cycles.
const readNativeHexStakes = vi.fn();
const createPublicClientForChain = vi.fn();
const estimateHexMiningYield = vi.fn();
const getObservationEvidenceWithPayloadForRange = vi.fn();
const readFreshHexStakeSnapshot = vi.fn();
const writeHexStakeSnapshot = vi.fn();

vi.mock("@/services/hexmining/reader", () => ({
  readNativeHexStakes,
}));

vi.mock("@/services/chains/public-client", () => ({
  createPublicClientForChain,
}));

vi.mock("@/services/hexmining/yield-estimator", () => ({
  estimateHexMiningYield,
}));

vi.mock("@/services/hexmining/observation-evidence-provider", () => ({
  getObservationEvidenceWithPayloadForRange,
}));

vi.mock("@/services/hexmining/stake-snapshot-store", () => ({
  readFreshHexStakeSnapshot,
  writeHexStakeSnapshot,
}));

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const OBSERVED_AT = "2026-06-06T00:00:00.000Z";

// ── Deterministic fixture DTOs ─────────────────────────────────────────────

function makeEmptyStakeList(
  walletAddress = WALLET_ADDRESS.toLowerCase(),
  chainId = CHAIN_ID,
): HexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId,
    walletAddress,
    stakeSource: "native",
    stakes: [],
    totalCount: 0,
    isComplete: true,
    observedAtBlock: "12345678",
    observedAt: OBSERVED_AT,
    warnings: [],
  };
}

function makeUnsupportedChainDto(chainId: number): HexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakeSource: "native",
    stakes: [],
    totalCount: 0,
    isComplete: false,
    observedAtBlock: null,
    observedAt: OBSERVED_AT,
    warnings: [`hexmining-unsupported-chain-${chainId}`],
  };
}

function makeDegradedDto(): HexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakeSource: "native",
    stakes: [],
    totalCount: 0,
    isComplete: false,
    observedAtBlock: null,
    observedAt: OBSERVED_AT,
    warnings: [
      "hexmining-provenance-block-unavailable",
      "hexmining-stake-count-rpc-timeout",
    ],
  };
}

function makeSingleStakeDto(): HexStakeListDto {
  const stake: HexStakeDto = {
    schemaVersion: "v1",
    stakeId: "42",
    stakeIndex: 0,
    stakeSource: "native",
    chainId: CHAIN_ID,
    assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakeStatus: "active",
    lockedDay: 1000,
    stakedDays: 5555,
    unlockedDay: null,
    principalHex: "1.00000000",
    stakeShares: "1000000000000",
    tShares: "1.000000",
    isAutoStake: false,
    pricing: {
      status: "unsupported",
      sourceType: null,
      sourceId: null,
      observedAt: null,
    },
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
      chainId: CHAIN_ID,
      walletAddress: WALLET_ADDRESS.toLowerCase(),
      stakeId: "42",
      stakeIndex: 0,
      stakeSource: "native",
      observedAtBlock: "12345678",
      observedAt: OBSERVED_AT,
      rpcEndpoint: null,
      warnings: [],
    },
    warnings: ["hexmining-valuation-unsupported-v1"],
  };

  return {
    schemaVersion: "v1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakeSource: "native",
    stakes: [stake],
    totalCount: 1,
    isComplete: true,
    observedAtBlock: "12345678",
    observedAt: OBSERVED_AT,
    warnings: [],
  };
}

function makeYieldDtoFromEstimate(result: {
  status: string;
  yieldHex: string | null;
  bpdYieldHex?: string | null;
  provenance: {
    chainId: number;
    sourceFamily: "HEXMINING";
    observationId: string | null;
    rangeStartDay: number | null;
    rangeEndDay: number | null;
  } | null;
  warnings: string[];
}): HexStakeDto["yield"] {
  if (
    result.status === "estimated" &&
    result.provenance !== null &&
    result.yieldHex !== null
  ) {
    const provenance = {
      chainId: result.provenance.chainId,
      sourceFamily: result.provenance.sourceFamily,
      observationId: result.provenance.observationId ?? "unknown",
      rangeStartDay: result.provenance.rangeStartDay ?? 0,
      rangeEndDay: result.provenance.rangeEndDay ?? 0,
    };

    if (result.bpdYieldHex !== undefined && result.bpdYieldHex !== null) {
      return {
        status: "estimated",
        estimatedYieldHearts: result.yieldHex,
        bpdYieldHex: result.bpdYieldHex,
        bpdYieldStatus: "applicable",
        provenance,
        warnings: result.warnings,
      };
    }

    return {
      status: "estimated",
      estimatedYieldHearts: result.yieldHex,
      bpdYieldHex: null,
      bpdYieldStatus: "unknown",
      provenance,
      warnings: result.warnings,
    };
  }

  if (result.status === "unsupported") {
    return {
      status: "unsupported",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
  }

  const provenance =
    result.provenance !== null &&
    result.provenance.observationId !== null &&
    result.provenance.rangeStartDay !== null &&
    result.provenance.rangeEndDay !== null
      ? {
          chainId: result.provenance.chainId,
          sourceFamily: result.provenance.sourceFamily,
          observationId: result.provenance.observationId,
          rangeStartDay: result.provenance.rangeStartDay,
          rangeEndDay: result.provenance.rangeEndDay,
        }
      : null;

  return {
    status: "unavailable",
    estimatedYieldHearts: null,
    bpdYieldHex: null,
    bpdYieldStatus: "unknown",
    provenance,
    warnings: result.warnings,
  };
}

function mockReaderInvokesRouteYieldDependency() {
  readNativeHexStakes.mockImplementation(
    async (args: {
      estimateYield?: (estimateArgs: {
        chainId: number;
        stakeId: string;
        stakeShares: bigint;
        lockedDay: number;
        stakedDays: number;
        currentDay: number;
        rangeStartDay: number;
        rangeEndDay: number;
      }) => Promise<{
        status: string;
        yieldHex: string | null;
        bpdYieldHex?: string | null;
        provenance: {
          chainId: number;
          sourceFamily: "HEXMINING";
          observationId: string | null;
          rangeStartDay: number | null;
          rangeEndDay: number | null;
        } | null;
        warnings: string[];
      }>;
    }) => {
      const fixture = makeSingleStakeDto();
      if (!args.estimateYield) return fixture;

      let result;
      try {
        result = await args.estimateYield({
          chainId: CHAIN_ID,
          stakeId: "42",
          stakeShares: 1000000000000n,
          lockedDay: 1000,
          stakedDays: 5555,
          currentDay: 1002,
          rangeStartDay: 1000,
          rangeEndDay: 1001,
        });
      } catch {
        result = {
          status: "unavailable",
          yieldHex: null,
          provenance: null,
          warnings: ["hexmining-yield-estimator-threw"],
        };
      }

      return {
        ...fixture,
        stakes: [
          {
            ...fixture.stakes[0],
            yield: makeYieldDtoFromEstimate(result),
          },
        ],
      };
    },
  );
}

function makeEstimateResult(status: string, warnings: string[] = []) {
  return {
    status,
    schemaVersion: "v1",
    yieldHex: null,
    provenance: {
      chainId: CHAIN_ID,
      sourceFamily: "HEXMINING" as const,
      observationId: status === "insufficient_observations" ? null : "obs-1",
      rangeStartDay: status === "insufficient_observations" ? null : 1000,
      rangeEndDay: status === "insufficient_observations" ? null : 1001,
    },
    warnings,
  };
}

function makeUrl(params: Record<string, string | number | undefined>): string {
  const url = new URL("http://localhost/api/hexmining/stakes");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

describe("GET /api/hexmining/stakes route contract", () => {
  beforeEach(() => {
    readFreshHexStakeSnapshot.mockResolvedValue(null);
    writeHexStakeSnapshot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Missing walletAddress → 400, reader not called ──────────────────────

  it("returns 400 with stable error envelope when walletAddress is missing", async () => {
    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(new Request(makeUrl({ chainId: CHAIN_ID })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("stack");
    expect(readNativeHexStakes).not.toHaveBeenCalled();
    expect(createPublicClientForChain).not.toHaveBeenCalled();
  });

  // ── 2. Malformed walletAddress → 400, reader not called ───────────────────

  it("returns 400 when walletAddress is not a valid EVM address", async () => {
    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: "not-an-address", chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(readNativeHexStakes).not.toHaveBeenCalled();
    expect(createPublicClientForChain).not.toHaveBeenCalled();
  });

  it("returns 400 when walletAddress is missing the 0x prefix", async () => {
    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({
          walletAddress: "1111111111111111111111111111111111111111",
          chainId: CHAIN_ID,
        }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(readNativeHexStakes).not.toHaveBeenCalled();
  });

  // ── 3. Omitted chainId defaults to 369 ────────────────────────────────────

  it("defaults chainId to 369 when omitted and calls reader with chainId 369", async () => {
    const mockClient = {};
    createPublicClientForChain.mockReturnValue(mockClient);
    readNativeHexStakes.mockResolvedValue(makeEmptyStakeList());

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS })),
    );

    expect(response.status).toBe(200);
    expect(readNativeHexStakes).toHaveBeenCalledOnce();
    expect(readNativeHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({
        publicClient: mockClient,
        walletAddress: WALLET_ADDRESS.toLowerCase(),
        chainId: 369,
      }),
    );
  });

  // ── 4. chainId=369 → reader called, DTO returned unchanged ────────────────

  it("returns 200 with stable { data: HexStakeListDto } envelope for chainId=369", async () => {
    const fixture = makeEmptyStakeList();
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.chainId).toBe(CHAIN_ID);
    expect(body.data.walletAddress).toBe(WALLET_ADDRESS.toLowerCase());
    expect(body.data.stakeSource).toBe("native");
    expect(Array.isArray(body.data.stakes)).toBe(true);
    expect(typeof body.data.isComplete).toBe("boolean");
    expect(typeof body.data.totalCount).toBe("number");
    expect(Array.isArray(body.data.warnings)).toBe(true);
    expect(readNativeHexStakes).toHaveBeenCalledOnce();
  });

  // ── 5. Malformed chainId values → 400 ─────────────────────────────────────

  it.each([
    ["abc", "non-numeric string"],
    ["369abc", "mixed alphanumeric"],
    ["369.5", "non-integer float"],
  ])("returns 400 for malformed chainId '%s' (%s)", async (badChainId) => {
    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: badChainId }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(readNativeHexStakes).not.toHaveBeenCalled();
    expect(createPublicClientForChain).not.toHaveBeenCalled();
  });

  // ── 6. Unsupported but valid integer chainId → HTTP 200 with DTO ──────────

  it("delegates unsupported chainId to reader and returns HTTP 200 with unsupported-chain DTO", async () => {
    const unsupportedChainId = 1;
    const fixture = makeUnsupportedChainDto(unsupportedChainId);
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: unsupportedChainId }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.chainId).toBe(unsupportedChainId);
    expect(body.data.isComplete).toBe(false);
    expect(body.data.warnings).toContain("hexmining-unsupported-chain-1");
    expect(readNativeHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: unsupportedChainId }),
    );
  });

  // ── 7. Degraded reader DTO returned unchanged ──────────────────────────────

  it("returns degraded reader DTO unchanged at HTTP 200", async () => {
    const fixture = makeDegradedDto();
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.isComplete).toBe(false);
    expect(body.data.observedAtBlock).toBeNull();
    expect(body.data.warnings).toContain(
      "hexmining-provenance-block-unavailable",
    );
    expect(body.data.warnings).toContain("hexmining-stake-count-rpc-timeout");
  });

  // ── 8. Unexpected reader throw → sanitized HTTP 500 ──────────────────────

  it("returns sanitized HTTP 500 without leaking internal details when reader throws unexpectedly", async () => {
    const secretDetail = "secret-rpc-host:8545/internal-key";
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockRejectedValue(
      new Error(`RPC connection failed: ${secretDetail}`),
    );

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error.");
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("RPC connection failed");
    expect(bodyText).not.toContain("stack");
  });

  // ── 9. Pricing/valuation/PnL/yield fields are reader-supplied only ────────

  it("preserves pricing/valuation/pnl/yield as reader-supplied unsupported sentinels without transformation", async () => {
    const fixture = makeSingleStakeDto();
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const stake = body.data.stakes[0];

    expect(stake.pricing.status).toBe("unsupported");
    expect(stake.pricing.sourceType).toBeNull();
    expect(stake.pricing.sourceId).toBeNull();
    expect(stake.pricing.observedAt).toBeNull();

    expect(stake.valuation.status).toBe("unsupported");
    expect(stake.valuation.valueQuote).toBeNull();

    expect(stake.pnl.status).toBe("unsupported");
    expect(stake.pnl.averageCost).toBeNull();
    expect(stake.pnl.realizedPnl).toBeNull();
    expect(stake.pnl.unrealizedPnl).toBeNull();
    expect(stake.pnl.markPrice).toBeNull();
    expect(stake.pnl.costBasisPolicy).toBeNull();

    expect(stake.yield.status).toBe("unsupported");
    expect(stake.yield.estimatedYieldHearts).toBeNull();
    expect(stake.yield.bpdYieldHex).toBeNull();
    expect(stake.yield.bpdYieldStatus).toBeNull();
  });

  // ── 10. Route uses backend service path; no live RPC ─────────────────────

  it("resolves stakes through mocked backend service without live RPC or network calls", async () => {
    const fixture = makeEmptyStakeList();
    const mockClient = { getBlockNumber: vi.fn(), readContract: vi.fn() };
    createPublicClientForChain.mockReturnValue(mockClient);
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    expect(createPublicClientForChain).toHaveBeenCalledOnce();
    expect(readNativeHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({
        publicClient: mockClient,
        walletAddress: WALLET_ADDRESS.toLowerCase(),
        chainId: CHAIN_ID,
      }),
    );
    // The mocked client methods were NOT called directly — reader is mocked
    expect(mockClient.getBlockNumber).not.toHaveBeenCalled();
    expect(mockClient.readContract).not.toHaveBeenCalled();
  });

  // ── Stake field completeness ──────────────────────────────────────────────

  it("returns single native stake with all required DTO fields present", async () => {
    const fixture = makeSingleStakeDto();
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.stakes).toHaveLength(1);

    const stake = body.data.stakes[0];
    expect(stake.schemaVersion).toBe("v1");
    expect(stake.stakeSource).toBe("native");
    expect(stake.chainId).toBe(CHAIN_ID);
    expect(typeof stake.stakeId).toBe("string");
    expect(typeof stake.stakeIndex).toBe("number");
    expect(typeof stake.principalHex).toBe("string");
    expect(typeof stake.stakeShares).toBe("string");
    expect(typeof stake.tShares).toBe("string");
    expect(typeof stake.isAutoStake).toBe("boolean");
    expect(stake.provenance).toBeDefined();
    expect(typeof stake.provenance.observedAtBlock).toBe("string");
    expect(stake.provenance.stakeSource).toBe("native");
    expect(stake.warnings).toContain("hexmining-valuation-unsupported-v1");
  });

  // ── Route-level HexMining yield dependency wiring ────────────────────────

  it("passes estimateYield into readNativeHexStakes", async () => {
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(makeEmptyStakeList());

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    expect(readNativeHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({ estimateYield: expect.any(Function) }),
    );
  });

  it("invokes the yield estimator and evidence provider through the route dependency path", async () => {
    createPublicClientForChain.mockReturnValue({});
    mockReaderInvokesRouteYieldDependency();
    getObservationEvidenceWithPayloadForRange.mockResolvedValue(null);
    estimateHexMiningYield.mockImplementation(async (args, deps) => {
      await deps.fetchEvidence({
        chainId: args.chainId,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      });
      return makeEstimateResult("insufficient_observations", [
        "hexmining-yield-no-observation-evidence",
      ]);
    });

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    expect(estimateHexMiningYield).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN_ID,
        stakeId: "42",
        rangeStartDay: 1000,
        rangeEndDay: 1001,
      }),
      { fetchEvidence: getObservationEvidenceWithPayloadForRange },
    );
    expect(getObservationEvidenceWithPayloadForRange).toHaveBeenCalledWith({
      chainId: CHAIN_ID,
      rangeStartDay: 1000,
      rangeEndDay: 1001,
    });
  });

  it.each([
    ["evidence_available", ["hexmining-yield-bpd-attribution-unresolved"]],
    ["insufficient_observations", ["hexmining-yield-no-observation-evidence"]],
    ["invalid_observation", ["hexmining-yield-invalid-observation-payload"]],
  ])(
    "maps %s to public unavailable with deterministic provenance and warnings",
    async (status, warnings) => {
      createPublicClientForChain.mockReturnValue({});
      mockReaderInvokesRouteYieldDependency();
      estimateHexMiningYield.mockResolvedValue(
        makeEstimateResult(status, warnings),
      );

      const { GET } = await import("../../app/api/hexmining/stakes/route");
      const response = await GET(
        new Request(
          makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
        ),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      const yieldDto = body.data.stakes[0].yield;
      expect(yieldDto.status).toBe("unavailable");
      expect(yieldDto.estimatedYieldHearts).toBeNull();
      expect(yieldDto.bpdYieldHex).toBeNull();
      if (status === "insufficient_observations") {
        expect(yieldDto.provenance).toBeNull();
      } else {
        expect(yieldDto.provenance).toEqual(
          expect.objectContaining({
            chainId: CHAIN_ID,
            sourceFamily: "HEXMINING",
          }),
        );
      }
      expect(yieldDto.warnings).toEqual(warnings);
    },
  );

  it("maps estimator throws safely without leaking internals", async () => {
    createPublicClientForChain.mockReturnValue({});
    mockReaderInvokesRouteYieldDependency();
    estimateHexMiningYield.mockRejectedValue(
      new Error("secret estimator failure"),
    );

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    const bodyText = await response.text();
    expect(response.status).toBe(200);
    expect(bodyText).toContain("hexmining-yield-estimator-threw");
    expect(bodyText).not.toContain("secret estimator failure");
    const body = JSON.parse(bodyText);
    expect(body.data.stakes[0].yield).toMatchObject({
      status: "unavailable",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      provenance: null,
      warnings: ["hexmining-yield-estimator-threw"],
    });
  });

  it("preserves unsupported fallback and does not fabricate estimatedYieldHearts", async () => {
    createPublicClientForChain.mockReturnValue({});
    mockReaderInvokesRouteYieldDependency();
    estimateHexMiningYield.mockResolvedValue(makeEstimateResult("unsupported"));

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.stakes[0].yield).toMatchObject({
      status: "unsupported",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    });
  });

  it("only exposes non-null estimatedYieldHearts when estimator returns a valid estimated result with provenance", async () => {
    createPublicClientForChain.mockReturnValue({});
    mockReaderInvokesRouteYieldDependency();
    estimateHexMiningYield.mockResolvedValue({
      status: "estimated",
      schemaVersion: "v1",
      yieldHex: "12345",
      bpdYieldHex: null,
      provenance: {
        chainId: CHAIN_ID,
        sourceFamily: "HEXMINING",
        observationId: "obs-estimated",
        rangeStartDay: 1000,
        rangeEndDay: 1001,
      },
      warnings: ["hexmining-yield-public-estimate-test"],
    });

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.stakes).toHaveLength(1);
    expect(body.data.stakes[0].yield).toMatchObject({
      status: "estimated",
      estimatedYieldHearts: "12345",
      bpdYieldHex: null,
      bpdYieldStatus: "unknown",
      provenance: expect.objectContaining({ observationId: "obs-estimated" }),
      warnings: ["hexmining-yield-public-estimate-test"],
    });
    expect(Array.isArray(body.data.stakes[0].yield.warnings)).toBe(true);
  });

  // ── Yield gate — route must never expose estimated yield ──────────────────

  // Coverage item 4: every stake in a multi-stake successful response must carry
  // only the gated "unsupported" yield, not "estimated" or "evidence_available".
  it("yield gate preserved for every stake when route response contains multiple stakes", async () => {
    const base = makeSingleStakeDto();
    const second: HexStakeDto = {
      ...base.stakes[0],
      stakeId: "99",
      stakeIndex: 1,
    };
    const fixture: HexStakeListDto = {
      ...base,
      stakes: [base.stakes[0], second],
      totalCount: 2,
    };
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.stakes).toHaveLength(2);
    for (const stake of body.data.stakes) {
      expect(stake.yield.status).toBe("unsupported");
      expect(stake.yield.estimatedYieldHearts).toBeNull();
      expect(stake.yield.bpdYieldHex).toBeNull();
      expect(stake.yield.bpdYieldStatus).toBeNull();
    }
  });

  // Coverage item 3: if the reader passes a BPD attribution warning through to the stake,
  // the route must preserve it in warnings but still not compute yield (yield stays gated).
  it("route preserves BPD attribution warning from reader output but does not compute yield", async () => {
    const base = makeSingleStakeDto();
    const stakeWithBpdWarning: HexStakeDto = {
      ...base.stakes[0],
      warnings: [
        ...base.stakes[0].warnings,
        "hexmining-yield-bpd-attribution-unresolved",
      ],
    };
    const fixture: HexStakeListDto = { ...base, stakes: [stakeWithBpdWarning] };
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const stake = body.data.stakes[0];
    // Warning must be preserved in the pass-through
    expect(stake.warnings).toContain(
      "hexmining-yield-bpd-attribution-unresolved",
    );
    // Yield stays gated: route must not compute yield because a BPD warning is present
    expect(stake.yield.status).toBe("unsupported");
    expect(stake.yield.estimatedYieldHearts).toBeNull();
    expect(stake.yield.bpdYieldHex).toBeNull();
  });

  // Coverage item 6: regression — serialized yield block must never contain
  // "estimated" status or non-null estimatedYieldHearts anywhere in the response.
  it("regression: serialized route response yield block does not expose estimated status or non-null estimatedYieldHearts", async () => {
    const fixture = makeSingleStakeDto();
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const stake = body.data.stakes[0];
    const yieldSerialized = JSON.stringify(stake.yield);
    expect(yieldSerialized).not.toContain('"estimated"');
    expect(yieldSerialized).not.toContain('"evidence_available"');
    const parsed = JSON.parse(yieldSerialized) as {
      estimatedYieldHearts: unknown;
    };
    expect(parsed.estimatedYieldHearts).toBeNull();
  });

  // Coverage item 5: when the reader throws (backend/evidence unavailable), the route
  // must return a sanitized error and must not invent or leak any yield fields.
  it("error response body does not contain yield, estimatedYieldHearts, or yieldHex fields", async () => {
    createPublicClientForChain.mockReturnValue({});
    readNativeHexStakes.mockRejectedValue(new Error("backend unavailable"));

    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
      ),
    );

    expect(response.status).toBe(500);
    const bodyText = await response.text();
    expect(bodyText).not.toContain("estimatedYieldHearts");
    expect(bodyText).not.toContain('"yieldHex"');
    expect(bodyText).not.toContain('"estimated"');
  });
});
