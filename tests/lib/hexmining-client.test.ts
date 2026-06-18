import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  fetchHexMiningStakes,
} from "@/lib/api/hexmining-client";
import type { HexStakeListDto } from "@/services/hexmining/types";

const originalFetch = global.fetch;

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const OBSERVED_AT = "2026-06-06T00:00:00.000Z";

const EMPTY_STAKE_LIST: HexStakeListDto = {
  schemaVersion: "v1",
  chainId: CHAIN_ID,
  walletAddress: WALLET_ADDRESS,
  stakeSource: "native",
  stakes: [],
  totalCount: 0,
  isComplete: true,
  observedAtBlock: "12345678",
  observedAt: OBSERVED_AT,
  warnings: [],
};

const UNSUPPORTED_CHAIN_DTO: HexStakeListDto = {
  schemaVersion: "v1",
  chainId: 1,
  walletAddress: WALLET_ADDRESS,
  stakeSource: "native",
  stakes: [],
  totalCount: 0,
  isComplete: false,
  observedAtBlock: null,
  observedAt: OBSERVED_AT,
  warnings: ["hexmining-unsupported-chain-1"],
};

describe("hexmining client — fetchHexMiningStakes", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── URL construction ──────────────────────────────────────────────────────

  it("requests GET /api/hexmining/stakes with walletAddress and chainId 369", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_STAKE_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/hexmining/stakes?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("defaults chainId to 369 when omitted", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_STAKE_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("chainId=369");
  });

  it("uses cache: no-store", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_STAKE_LIST }), { status: 200 }),
    ) as typeof fetch;

    await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  // ── DTO passthrough ─────────────────────────────────────────────────────────

  it("unwraps { data } envelope and returns HexStakeListDto unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: EMPTY_STAKE_LIST }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(result).toEqual(EMPTY_STAKE_LIST);
    expect(result.schemaVersion).toBe("v1");
    expect(result.stakeSource).toBe("native");
    expect(result.chainId).toBe(CHAIN_ID);
    expect(Array.isArray(result.stakes)).toBe(true);
    expect(result.isComplete).toBe(true);
  });

  it("preserves unsupported pricing/valuation/pnl/yield sentinel statuses unchanged", async () => {
    const dtoWithStake: HexStakeListDto = {
      ...EMPTY_STAKE_LIST,
      stakes: [
        {
          schemaVersion: "v1",
          stakeId: "42",
          stakeIndex: 0,
          stakeSource: "native",
          chainId: CHAIN_ID,
          assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
          walletAddress: WALLET_ADDRESS,
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
            walletAddress: WALLET_ADDRESS,
            stakeId: "42",
            stakeIndex: 0,
            stakeSource: "native",
            observedAtBlock: "12345678",
            observedAt: OBSERVED_AT,
            rpcEndpoint: null,
            warnings: [],
          },
          warnings: ["hexmining-valuation-unsupported-v1"],
        },
      ],
      totalCount: 1,
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: dtoWithStake }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(result.stakes).toHaveLength(1);
    const stake = result.stakes[0];
    expect(stake.pricing.status).toBe("unsupported");
    expect(stake.pricing.sourceType).toBeNull();
    expect(stake.valuation.status).toBe("unsupported");
    expect(stake.valuation.valueQuote).toBeNull();
    expect(stake.pnl.status).toBe("unsupported");
    expect(stake.pnl.averageCost).toBeNull();
    expect(stake.yield.status).toBe("unsupported");
    expect(stake.yield.estimatedYieldHearts).toBeNull();
  });

  it("returns unsupported-chain DTO unchanged when route returns degraded response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: UNSUPPORTED_CHAIN_DTO }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: 1 });

    expect(result.isComplete).toBe(false);
    expect(result.observedAtBlock).toBeNull();
    expect(result.warnings).toContain("hexmining-unsupported-chain-1");
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  it("throws ApiClientError with structured fields on a 400 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INPUT",
            message: "Wallet address must be a valid EVM address.",
            details: [{ path: "walletAddress", message: "invalid" }],
          },
        }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchHexMiningStakes({ walletAddress: "bad-address", chainId: CHAIN_ID }),
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
      fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("throws ApiClientError with UNKNOWN_ERROR code when error body lacks a code", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 503 }),
    ) as typeof fetch;

    await expect(
      fetchHexMiningStakes({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 503,
      code: "UNKNOWN_ERROR",
    });
  });

  it("thrown ApiClientError is an instance of ApiClientError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "bad" } }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchHexMiningStakes({ walletAddress: "bad", chainId: CHAIN_ID }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
