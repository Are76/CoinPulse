import { afterEach, describe, expect, it, vi } from "vitest";

import type { HexStakeDto, HexStakeListDto } from "@/services/hexmining/types";

// Keep in outer scope so mock factories close over them across vi.resetModules() cycles.
const readNativeHexStakes = vi.fn();
const createPublicClientForChain = vi.fn();

vi.mock("@/services/hexmining/reader", () => ({
  readNativeHexStakes,
}));

vi.mock("@/services/chains/public-client", () => ({
  createPublicClientForChain,
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
    warnings: ["hexmining-provenance-block-unavailable", "hexmining-stake-count-rpc-timeout"],
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
    yield: { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null },
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

function makeUrl(params: Record<string, string | number | undefined>): string {
  const url = new URL("http://localhost/api/hexmining/stakes");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

describe("GET /api/hexmining/stakes route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Missing walletAddress → 400, reader not called ──────────────────────

  it("returns 400 with stable error envelope when walletAddress is missing", async () => {
    const { GET } = await import("../../app/api/hexmining/stakes/route");
    const response = await GET(
      new Request(makeUrl({ chainId: CHAIN_ID })),
    );

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
      new Request(makeUrl({ walletAddress: "not-an-address", chainId: CHAIN_ID })),
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
      new Request(makeUrl({ walletAddress: "1111111111111111111111111111111111111111", chainId: CHAIN_ID })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: badChainId })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: unsupportedChainId })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.isComplete).toBe(false);
    expect(body.data.observedAtBlock).toBeNull();
    expect(body.data.warnings).toContain("hexmining-provenance-block-unavailable");
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
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
    expect(stake.yield.estimatedYieldHex).toBeNull();
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
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
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
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
});
