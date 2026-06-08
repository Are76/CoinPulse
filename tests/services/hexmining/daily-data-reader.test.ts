// HexMining Phase 4B — dailyDataRange read boundary tests
//
// Verifies:
//   1. readCurrentDay calls the contract and returns the day as a number.
//   2. readDailyDataRangeObservation calls dailyDataRange(rangeStartDay, rangeEndDay + 1):
//      the HEX contract endDay argument is end-exclusive; the stored rangeEndDay is inclusive.
//   3. Inclusive rangeEndDay is preserved in the result separately from the end-exclusive rpcEndDay.
//   4. Negative rangeStartDay is rejected.
//   5. Negative rangeEndDay is rejected.
//   6. rangeEndDay < rangeStartDay is rejected.
//   7. rangeEndDay > currentDay is rejected (future days have no dailyDataRange data).
//   8. bigint values from viem are returned raw in rawDailyData without encoding.
//   9. observedAtBlock from getBlockNumber is included in the observation.
//  10. currentDay is included in the result for provenance.
//  11. RPC failures produce classified error codes, not raw messages.
//  12. No persistence method is called.
//  13. No live network — all contract reads use injected mock clients.
//
// See docs/v2-hexmining-roadmap.md §11.12 for acceptance criteria.

import { describe, expect, it, vi } from "vitest";

import type { HexMiningReadClient } from "@/services/hexmining/reader";
import {
  readCurrentDay,
  readDailyDataRangeObservation,
} from "@/services/hexmining/daily-data-reader";

// ─── Shared test constants ─────────────────────────────────────────────────────

const DEFAULT_CURRENT_DAY = 5_000n;
const DEFAULT_BLOCK = 21_000_000n;
const MOCK_DAILY_DATA = [100_000_000_000n, 200_000_000_000n, 300_000_000_000n];

// ─── Client factory ────────────────────────────────────────────────────────────

type MockReadContractArgs = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

function makeClient(opts?: {
  readContract?: (args: MockReadContractArgs) => Promise<unknown>;
  getBlockNumber?: () => Promise<bigint>;
}): HexMiningReadClient {
  const defaultReadContract = async ({ functionName }: MockReadContractArgs): Promise<unknown> => {
    if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
    if (functionName === "dailyDataRange") return MOCK_DAILY_DATA;
    throw new Error(`unexpected function: ${functionName}`);
  };

  return {
    getBlockNumber: vi.fn(opts?.getBlockNumber ?? (async () => DEFAULT_BLOCK)),
    readContract: vi.fn(opts?.readContract ?? defaultReadContract),
  } as unknown as HexMiningReadClient;
}

// ─── readCurrentDay ────────────────────────────────────────────────────────────

describe("readCurrentDay", () => {
  it("calls the contract currentDay function and returns the protocol day as a number", async () => {
    const readContractMock = vi.fn(async ({ functionName }: MockReadContractArgs) => {
      if (functionName === "currentDay") return 4_800n;
      throw new Error(`unexpected: ${functionName}`);
    });
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: readContractMock,
    } as unknown as HexMiningReadClient;

    const result = await readCurrentDay({ publicClient: client });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentDay).toBe(4800);
      expect(typeof result.currentDay).toBe("number");
    }
    expect(readContractMock).toHaveBeenCalledOnce();
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "currentDay" }),
    );
  });

  it("returns ok:false with a classified error code when the contract call throws", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async () => {
        throw new Error("rate limit exceeded");
      }),
    } as unknown as HexMiningReadClient;

    const result = await readCurrentDay({ publicClient: client });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/^hexmining-current-day-rpc-/);
      expect(result.code).toBe("hexmining-current-day-rpc-rate_limited");
    }
  });
});

// ─── readDailyDataRangeObservation ─────────────────────────────────────────────

describe("readDailyDataRangeObservation", () => {
  // ── 1. End-exclusive RPC argument ──────────────────────────────────────────
  //
  // The HEX contract dailyDataRange(beginDay, endDay) is end-exclusive:
  // it returns data for days [beginDay, endDay). The stored rangeEndDay is the
  // inclusive last day. The reader must call dailyDataRange(rangeStartDay, rangeEndDay + 1).

  it("calls dailyDataRange with beginDay = rangeStartDay and endDay = rangeEndDay + 1", async () => {
    const readContractMock = vi.fn(async ({ functionName }: MockReadContractArgs) => {
      if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
      if (functionName === "dailyDataRange") return MOCK_DAILY_DATA;
      throw new Error(`unexpected: ${functionName}`);
    });
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: readContractMock,
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002, // inclusive stored bound → RPC uses 1003
    });

    expect(result.ok).toBe(true);

    // Confirm the RPC call received rangeEndDay + 1 = 1003 as the endDay argument
    const calls = readContractMock.mock.calls as Array<[MockReadContractArgs]>;
    const dailyDataRangeCall = calls.find((call) => call[0].functionName === "dailyDataRange");
    expect(dailyDataRangeCall).toBeDefined();
    expect(dailyDataRangeCall![0].args).toEqual([1000n, 1003n]);
  });

  // ── 2. Inclusive/exclusive metadata separation ─────────────────────────────

  it("preserves inclusive rangeEndDay in result metadata separately from end-exclusive rpcEndDay", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 500,
      rangeEndDay: 599,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.rangeEndDay).toBe(599); // inclusive stored bound
      expect(result.observation.rpcEndDay).toBe(600);   // end-exclusive RPC argument
      expect(result.observation.rangeStartDay).toBe(500);
    }
  });

  // ── 3. Input validation — negative rangeStartDay ───────────────────────────

  it("returns ok:false when rangeStartDay is negative", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: -1,
      rangeEndDay: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/negative/);
    }
  });

  // ── 4. Input validation — negative rangeEndDay ────────────────────────────

  it("returns ok:false when rangeEndDay is negative", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 0,
      rangeEndDay: -1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/negative/);
    }
  });

  // ── 5. Input validation — rangeEndDay < rangeStartDay ─────────────────────

  it("returns ok:false when rangeEndDay is less than rangeStartDay", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 500,
      rangeEndDay: 499,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-invalid-range-end-before-start");
    }
  });

  // ── 6. rangeEndDay must not exceed currentDay ─────────────────────────────

  it("returns ok:false when rangeEndDay exceeds currentDay (future days have no data)", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return 100n;
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 0,
      rangeEndDay: 101, // exceeds currentDay = 100
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-range-exceeds-current-day");
    }
  });

  // ── 7. bigint shape preserved in rawDailyData ─────────────────────────────

  it("returns viem bigint values in rawDailyData without conversion", async () => {
    // These are uint72-range bigints as viem would return from the contract
    const VIEM_BIGINT_VALUES = [
      4722366482869645213695n, // uint72 max
      100000000000000000000n,
    ];
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "dailyDataRange") return VIEM_BIGINT_VALUES;
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1001,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.rawDailyData).toEqual(VIEM_BIGINT_VALUES);
      expect(typeof result.observation.rawDailyData[0]).toBe("bigint");
      expect(typeof result.observation.rawDailyData[1]).toBe("bigint");
    }
  });

  // ── 8. observedAtBlock from getBlockNumber ────────────────────────────────

  it("includes observedAtBlock from getBlockNumber in the observation", async () => {
    const BLOCK = 99_999_999n;
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => BLOCK),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "dailyDataRange") return MOCK_DAILY_DATA;
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.observedAtBlock).toBe(BLOCK);
      expect(typeof result.observation.observedAtBlock).toBe("bigint");
    }
  });

  // ── 9. currentDay included in result for provenance ───────────────────────

  it("includes the protocol currentDay in the result for provenance", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return 4_999n;
        if (functionName === "dailyDataRange") return MOCK_DAILY_DATA;
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentDay).toBe(4999);
      expect(typeof result.currentDay).toBe("number");
    }
  });

  // ── 10. chainId is always 369 ─────────────────────────────────────────────

  it("sets chainId to 369 (PulseChain) in the observation", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.chainId).toBe(369);
    }
  });

  // ── 11. rpcEndpointLabel forwarded ────────────────────────────────────────

  it("forwards rpcEndpointLabel to the observation", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
      rpcEndpointLabel: "pulsechain-primary",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.rpcEndpointLabel).toBe("pulsechain-primary");
    }
  });

  it("defaults rpcEndpointLabel to null when not provided", async () => {
    const client = makeClient();

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.rpcEndpointLabel).toBeNull();
    }
  });

  // ── 12. getBlockNumber failure ─────────────────────────────────────────────

  it("returns ok:false with classified code when getBlockNumber throws", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => {
        throw new Error("timeout");
      }),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/^hexmining-block-number-rpc-/);
      expect(result.code).toBe("hexmining-block-number-rpc-timeout");
    }
  });

  // ── 13. currentDay RPC failure ────────────────────────────────────────────

  it("returns ok:false with classified code when currentDay RPC throws", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async () => {
        throw new Error("service unavailable");
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/^hexmining-current-day-rpc-/);
    }
  });

  // ── 14. dailyDataRange RPC failure ────────────────────────────────────────

  it("returns ok:false with classified code when dailyDataRange RPC throws", async () => {
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: vi.fn(async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "dailyDataRange") throw new Error("too many requests");
        throw new Error(`unexpected: ${functionName}`);
      }),
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-daily-data-range-rpc-rate_limited");
    }
  });

  // ── 15. No persistence called ─────────────────────────────────────────────

  it("does not call any persistence methods (read boundary only)", async () => {
    // This test is structural: the module has no persistence imports.
    // We confirm the result is a pure read result with no DB side effects.
    const getBlockNumberMock = vi.fn(async () => DEFAULT_BLOCK);
    const readContractMock = vi.fn(async ({ functionName }: MockReadContractArgs) => {
      if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
      if (functionName === "dailyDataRange") return MOCK_DAILY_DATA;
      throw new Error(`unexpected: ${functionName}`);
    });
    const client: HexMiningReadClient = {
      getBlockNumber: getBlockNumberMock,
      readContract: readContractMock,
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1002,
    });

    expect(result.ok).toBe(true);
    // Only two client methods — getBlockNumber and readContract — were called.
    // No DB/persistence client exists in the call stack.
    expect(getBlockNumberMock).toHaveBeenCalledOnce();
    // readContract should have been called for currentDay + dailyDataRange
    expect(readContractMock).toHaveBeenCalledTimes(2);
  });

  // ── 16. Zero-width range is valid (single day) ────────────────────────────

  it("accepts rangeStartDay === rangeEndDay (single-day range)", async () => {
    const readContractMock = vi.fn(async ({ functionName }: MockReadContractArgs) => {
      if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
      if (functionName === "dailyDataRange") return [999_000_000_000n];
      throw new Error(`unexpected: ${functionName}`);
    });
    const client: HexMiningReadClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_BLOCK),
      readContract: readContractMock,
    } as unknown as HexMiningReadClient;

    const result = await readDailyDataRangeObservation({
      publicClient: client,
      rangeStartDay: 1000,
      rangeEndDay: 1000, // same day — range contains exactly one day
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.rangeEndDay).toBe(1000);
      expect(result.observation.rpcEndDay).toBe(1001); // still +1 for end-exclusive
    }

    const calls = readContractMock.mock.calls as Array<[MockReadContractArgs]>;
    const dailyDataRangeCall = calls.find((call) => call[0].functionName === "dailyDataRange");
    expect(dailyDataRangeCall![0].args).toEqual([1000n, 1001n]);
  });
});
