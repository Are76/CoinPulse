// HexMining Phase 5 Slice 4 — ended stakes route contract tests
//
// Verifies GET /api/hexmining/ended-stakes wires readEndedHexStakes correctly.
// The reader is mocked — no DB, no RPC, no network.
//
// Covers:
//   1. Returns 400 when walletAddress is missing.
//   2. Returns 400 when walletAddress is malformed.
//   3. Returns 400 when walletAddress is missing 0x prefix.
//   4. Returns 400 for malformed chainId values.
//   5. Defaults chainId to 369 when omitted.
//   6. Returns 200 with { data: EndedHexStakeListDto } for valid request.
//   7. Passes normalized (lowercase) walletAddress to reader.
//   8. Passes chainId to reader.
//   9. Propagates warnings from reader unchanged.
//  10. Returns sanitized 500 when reader throws unexpectedly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EndedHexStakeDto, EndedHexStakeListDto } from "@/services/hexmining/types";

// Keep in outer scope so mock factory closes over it across vi.resetModules() cycles.
const readEndedHexStakes = vi.fn();

vi.mock("@/services/hexmining/ended-stake-reader", () => ({
  readEndedHexStakes,
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const OBSERVED_AT = "2026-06-14T12:00:00.000Z";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeEmptyListDto(
  walletAddress = WALLET_ADDRESS.toLowerCase(),
  chainId = CHAIN_ID,
): EndedHexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId,
    walletAddress,
    stakes: [],
    totalCount: 0,
    isComplete: true,
    warnings: [],
  };
}

function makeStakeDto(): EndedHexStakeDto {
  return {
    schemaVersion: "v1",
    id: "obs-1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakeId: "942663",
    stakeIndex: 0,
    stakedDays: 5555,
    lockedDay: 2310,
    stakeShares: "1414291579679",
    principalHex: "1000000000000000",
    yieldHex: "20589444841",
    penaltyHex: null,
    endTxHash: "0xabc123",
    endBlockNumber: "21000000",
    startTxHash: "0xdef456",
    startBlockNumber: "18000000",
    discoveryMethod: "raw_stake_action",
    observedAt: OBSERVED_AT,
    isComplete: true,
    warnings: [],
    evidenceRecoveryMethod: null,
    evidenceRecoveryBlockNumber: null,
    evidenceRecoverySourceContract: null,
    evidenceRecoverySourceFunction: null,
    evidenceRecoveryReturnedStakeId: null,
    evidenceRecoveredAt: null,
  };
}

function makeSingleStakeListDto(): EndedHexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakes: [makeStakeDto()],
    totalCount: 1,
    isComplete: true,
    warnings: [],
  };
}

function makeDegradedListDto(): EndedHexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_ADDRESS.toLowerCase(),
    stakes: [
      {
        ...makeStakeDto(),
        id: "obs-incomplete",
        stakeId: "999999",
        lockedDay: null,
        stakeShares: null,
        stakeIndex: null,
        principalHex: null,
        yieldHex: null,
        startTxHash: null,
        startBlockNumber: null,
        isComplete: false,
        warnings: ["hexmining-ended-stake-lockedday-unknown"],
      },
    ],
    totalCount: 1,
    isComplete: false,
    warnings: ["hexmining-ended-stake-lockedday-unknown"],
  };
}

function makeUrl(params: Record<string, string | number | undefined>): string {
  const url = new URL("http://localhost/api/hexmining/ended-stakes");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/hexmining/ended-stakes route contract", () => {
  beforeEach(() => {
    // No additional setup needed; reader is a vi.fn()
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Missing walletAddress → 400 ────────────────────────────────────────

  it("returns 400 with stable error envelope when walletAddress is missing", async () => {
    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(new Request(makeUrl({ chainId: CHAIN_ID })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("stack");
    expect(readEndedHexStakes).not.toHaveBeenCalled();
  });

  // ── 2. Malformed walletAddress → 400 ──────────────────────────────────────

  it("returns 400 when walletAddress is not a valid EVM address", async () => {
    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: "not-an-address", chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(readEndedHexStakes).not.toHaveBeenCalled();
  });

  // ── 3. Missing 0x prefix → 400 ────────────────────────────────────────────

  it("returns 400 when walletAddress is missing the 0x prefix", async () => {
    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
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
    expect(readEndedHexStakes).not.toHaveBeenCalled();
  });

  // ── 4. Malformed chainId → 400 ────────────────────────────────────────────

  it.each([
    ["abc", "non-numeric string"],
    ["369abc", "mixed alphanumeric"],
    ["369.5", "non-integer float"],
  ])("returns 400 for malformed chainId '%s' (%s)", async (badChainId) => {
    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: badChainId })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(readEndedHexStakes).not.toHaveBeenCalled();
  });

  // ── 5. Omitted chainId defaults to 369 ────────────────────────────────────

  it("defaults chainId to 369 when omitted and calls reader with chainId 369", async () => {
    readEndedHexStakes.mockResolvedValue(makeEmptyListDto());

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS })),
    );

    expect(response.status).toBe(200);
    expect(readEndedHexStakes).toHaveBeenCalledOnce();
    expect(readEndedHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 369 }),
    );
  });

  // ── 6. Valid request → 200 with EndedHexStakeListDto envelope ─────────────

  it("returns 200 with stable { data: EndedHexStakeListDto } envelope", async () => {
    const fixture = makeEmptyListDto();
    readEndedHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.chainId).toBe(CHAIN_ID);
    expect(body.data.walletAddress).toBe(WALLET_ADDRESS.toLowerCase());
    expect(Array.isArray(body.data.stakes)).toBe(true);
    expect(typeof body.data.totalCount).toBe("number");
    expect(typeof body.data.isComplete).toBe("boolean");
    expect(Array.isArray(body.data.warnings)).toBe(true);
    expect(readEndedHexStakes).toHaveBeenCalledOnce();
  });

  // ── 7. walletAddress normalized to lowercase before reader call ────────────

  it("normalizes walletAddress to lowercase before calling reader", async () => {
    readEndedHexStakes.mockResolvedValue(makeEmptyListDto());

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    expect(readEndedHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
  });

  // ── 8. chainId forwarded to reader ────────────────────────────────────────

  it("passes chainId from query param to reader", async () => {
    readEndedHexStakes.mockResolvedValue(makeEmptyListDto());

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(readEndedHexStakes).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: CHAIN_ID }),
    );
  });

  // ── 9. Reader DTO returned unchanged — stake fields preserved ─────────────

  it("returns all EndedHexStakeDto fields unchanged", async () => {
    const fixture = makeSingleStakeListDto();
    readEndedHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.stakes).toHaveLength(1);

    const stake = body.data.stakes[0];
    expect(stake.schemaVersion).toBe("v1");
    expect(stake.id).toBe("obs-1");
    expect(stake.chainId).toBe(CHAIN_ID);
    expect(stake.walletAddress).toBe(WALLET_ADDRESS.toLowerCase());
    expect(stake.stakeId).toBe("942663");
    expect(stake.stakeIndex).toBe(0);
    expect(stake.stakedDays).toBe(5555);
    expect(stake.lockedDay).toBe(2310);
    expect(stake.stakeShares).toBe("1414291579679");
    expect(stake.principalHex).toBe("1000000000000000");
    expect(stake.yieldHex).toBe("20589444841");
    expect(stake.penaltyHex).toBeNull();
    expect(stake.endTxHash).toBe("0xabc123");
    expect(stake.endBlockNumber).toBe("21000000");
    expect(stake.startTxHash).toBe("0xdef456");
    expect(stake.startBlockNumber).toBe("18000000");
    expect(stake.discoveryMethod).toBe("raw_stake_action");
    expect(stake.observedAt).toBe(OBSERVED_AT);
    expect(stake.isComplete).toBe(true);
    expect(Array.isArray(stake.warnings)).toBe(true);
    expect(stake.evidenceRecoveryMethod).toBeNull();
    expect(stake.evidenceRecoveryBlockNumber).toBeNull();
    expect(stake.evidenceRecoverySourceContract).toBeNull();
    expect(stake.evidenceRecoverySourceFunction).toBeNull();
    expect(stake.evidenceRecoveryReturnedStakeId).toBeNull();
    expect(stake.evidenceRecoveredAt).toBeNull();
  });

  // ── 11. Historical-state-recovered stake exposes provenance, discoveryMethod
  //        unchanged, bigint fields as exact decimal strings ─────────────────

  it("exposes evidenceRecovery* provenance for a historically-recovered stake without changing discoveryMethod", async () => {
    const recoveredStake: EndedHexStakeDto = {
      ...makeStakeDto(),
      id: "obs-2",
      warnings: [],
      evidenceRecoveryMethod: "historical_contract_state",
      evidenceRecoveryBlockNumber: "15767881",
      evidenceRecoverySourceContract: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      evidenceRecoverySourceFunction: "stakeLists",
      evidenceRecoveryReturnedStakeId: "942663",
      evidenceRecoveredAt: "2026-07-23T12:00:00.000Z",
    };
    const fixture: EndedHexStakeListDto = {
      ...makeSingleStakeListDto(),
      stakes: [recoveredStake],
    };
    readEndedHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const stake = body.data.stakes[0];

    // Original END-discovery provenance is untouched by recovery.
    expect(stake.discoveryMethod).toBe("raw_stake_action");
    expect(stake.isComplete).toBe(true);

    // Recovery provenance surfaced additively, all as strings — never a JSON
    // number for the block number or stakeId (bigint/string-safe end to end).
    expect(stake.evidenceRecoveryMethod).toBe("historical_contract_state");
    expect(typeof stake.evidenceRecoveryBlockNumber).toBe("string");
    expect(stake.evidenceRecoveryBlockNumber).toBe("15767881");
    expect(stake.evidenceRecoverySourceContract).toBe(
      "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    );
    expect(stake.evidenceRecoverySourceFunction).toBe("stakeLists");
    expect(typeof stake.evidenceRecoveryReturnedStakeId).toBe("string");
    expect(stake.evidenceRecoveryReturnedStakeId).toBe("942663");
    expect(stake.evidenceRecoveredAt).toBe("2026-07-23T12:00:00.000Z");
  });

  // ── 10. Degraded reader DTO propagated unchanged ───────────────────────────

  it("propagates incomplete stakes and list-level warnings unchanged", async () => {
    const fixture = makeDegradedListDto();
    readEndedHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.isComplete).toBe(false);
    expect(body.data.warnings).toContain("hexmining-ended-stake-lockedday-unknown");

    const stake = body.data.stakes[0];
    expect(stake.isComplete).toBe(false);
    expect(stake.lockedDay).toBeNull();
    expect(stake.stakeShares).toBeNull();
    expect(stake.stakeIndex).toBeNull();
    expect(stake.principalHex).toBeNull();
    expect(stake.yieldHex).toBeNull();
    expect(stake.startTxHash).toBeNull();
    expect(stake.startBlockNumber).toBeNull();
    expect(stake.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  // ── 11. Reader throws → sanitized 500 ─────────────────────────────────────

  it("returns sanitized HTTP 500 without leaking internal details when reader throws", async () => {
    const secretDetail = "secret-db-host:5432/internal-key";
    readEndedHexStakes.mockRejectedValue(
      new Error(`DB connection failed: ${secretDetail}`),
    );

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
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
    expect(bodyText).not.toContain("DB connection failed");
    expect(bodyText).not.toContain("stack");
  });

  // ── 12. No pricing/valuation/PnL fields on ended stake DTO ────────────────

  it("response body contains no pricing, valuation, or PnL fields", async () => {
    const fixture = makeSingleStakeListDto();
    readEndedHexStakes.mockResolvedValue(fixture);

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain('"pricing"');
    expect(bodyText).not.toContain('"valuation"');
    expect(bodyText).not.toContain('"pnl"');
    expect(bodyText).not.toContain('"yield"');
  });

  // ── 13. Empty list at 200 ─────────────────────────────────────────────────

  it("returns 200 with empty stakes array when reader returns no rows", async () => {
    readEndedHexStakes.mockResolvedValue(makeEmptyListDto());

    const { GET } = await import("../../app/api/hexmining/ended-stakes/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.stakes).toEqual([]);
    expect(body.data.totalCount).toBe(0);
    expect(body.data.isComplete).toBe(true);
    expect(body.data.warnings).toEqual([]);
  });
});
