import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  fetchHexMiningEndedStakes,
} from "@/lib/api/hexmining-client";
import type { EndedHexStakeDto, EndedHexStakeListDto } from "@/services/hexmining/types";

const originalFetch = global.fetch;

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const OBSERVED_AT = "2026-07-01T00:00:00.000Z";

const EMPTY_ENDED_LIST: EndedHexStakeListDto = {
  schemaVersion: "v1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakes: [],
  totalCount: 0,
  isComplete: true,
  warnings: [],
};

// Hearts value larger than Number.MAX_SAFE_INTEGER — must survive round-trip as a string.
const LARGE_HEARTS = "123456789012345678901234567890";

const INCOMPLETE_ENDED_STAKE: EndedHexStakeDto = {
  schemaVersion: "v1",
  id: "obs-1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakeId: "42",
  stakeIndex: null,
  stakedDays: null,
  lockedDay: null,
  stakeShares: null,
  principalHex: LARGE_HEARTS,
  yieldHex: null,
  penaltyHex: null,
  endTxHash: "0xend",
  endBlockNumber: "26000000",
  startTxHash: null,
  startBlockNumber: null,
  discoveryMethod: "raw_stake_action",
  observedAt: OBSERVED_AT,
  isComplete: false,
  warnings: ["ended-stake-locked-day-unavailable"],
  evidenceRecoveryMethod: "historical_state_stake_lists",
  evidenceRecoveryBlockNumber: "25999999",
  evidenceRecoverySourceContract: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  evidenceRecoverySourceFunction: "stakeLists",
  evidenceRecoveryReturnedStakeId: "42",
  evidenceRecoveredAt: OBSERVED_AT,
};

describe("hexmining client — fetchHexMiningEndedStakes", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests GET /api/hexmining/ended-stakes with walletAddress and chainId 369", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_ENDED_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningEndedStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/hexmining/ended-stakes?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("defaults chainId to 369 when omitted", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_ENDED_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningEndedStakes({ walletAddress: WALLET_ADDRESS });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("chainId=369");
  });

  it("performs a GET-only read — no POST, no discovery or recovery trigger", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_ENDED_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningEndedStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(calledUrl).not.toContain("discover");
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("unwraps { data } envelope and returns EndedHexStakeListDto unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_ENDED_LIST }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchHexMiningEndedStakes({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result).toEqual(EMPTY_ENDED_LIST);
    expect(result.schemaVersion).toBe("v1");
    expect(result.chainId).toBe(CHAIN_ID);
    expect(result.isComplete).toBe(true);
  });

  it("preserves nulls, warnings, provenance, and bigint-as-string values without numeric conversion", async () => {
    const dto: EndedHexStakeListDto = {
      ...EMPTY_ENDED_LIST,
      stakes: [INCOMPLETE_ENDED_STAKE],
      totalCount: 1,
      isComplete: false,
      warnings: ["ended-stake-locked-day-unavailable"],
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: dto }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchHexMiningEndedStakes({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain("ended-stake-locked-day-unavailable");

    const stake = result.stakes[0];
    // Nulls stay null — never coerced to zero or defaults.
    expect(stake.lockedDay).toBeNull();
    expect(stake.stakedDays).toBeNull();
    expect(stake.stakeShares).toBeNull();
    expect(stake.yieldHex).toBeNull();
    expect(stake.penaltyHex).toBeNull();
    // Hearts stay strings with full precision — no Number round-trip.
    expect(stake.principalHex).toBe(LARGE_HEARTS);
    expect(typeof stake.principalHex).toBe("string");
    expect(stake.endBlockNumber).toBe("26000000");
    expect(typeof stake.endBlockNumber).toBe("string");
    // Recovery provenance preserved verbatim.
    expect(stake.evidenceRecoveryMethod).toBe("historical_state_stake_lists");
    expect(stake.evidenceRecoveryBlockNumber).toBe("25999999");
    expect(stake.evidenceRecoverySourceFunction).toBe("stakeLists");
    expect(stake.warnings).toContain("ended-stake-locked-day-unavailable");
  });

  it("throws ApiClientError with structured fields on a 400 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INPUT",
            message: "Wallet address must be a valid EVM address.",
          },
        }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchHexMiningEndedStakes({ walletAddress: "bad-address", chainId: CHAIN_ID }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "INVALID_INPUT",
      message: "Wallet address must be a valid EVM address.",
    });
  });

  it("throws ApiClientError with INTERNAL_ERROR code on a 500 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Internal server error." },
        }),
        { status: 500 },
      ),
    ) as typeof fetch;

    await expect(
      fetchHexMiningEndedStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
