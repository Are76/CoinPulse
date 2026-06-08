// HexMining Phase 4B — dailyDataRange observation persistence wiring tests
//
// Verifies:
//   1. acquireAndPersistHexDailyDataObservation calls the read boundary with
//      inclusive rangeStartDay / rangeEndDay.
//   2. rawDailyData bigint[] is encoded to decimal strings in canonicalPayload.
//   3. canonicalPayload contains no bigint values and no numeric JSON values.
//   4. rawDailyData element order is preserved exactly.
//   5. Inclusive rangeEndDay is used for persistence, not rpcEndDay.
//   6. observedAtBlock, observedAt, chainId, rpcEndpointLabel, and warnings are
//      forwarded correctly to the persistence layer.
//   7. validateCanonicalPayload is called before persistence.
//   8. persistHexDailyDataObservation is called after validation with the
//      encoded canonicalPayload.
//   9. Dedup path is reused — when persistence returns an existing id, the
//      service returns that id without manually creating a row.
//  10. If reader returns ok:false, persistence is not called.
//  11. If validateCanonicalPayload throws, persistence is not called.
//  12. If persistence throws, service returns ok:false with sanitized code.
//  13. encodeDailyDataPayload produces deterministic output for identical input.
//  14. No live RPC/network — all contract reads use injected mock clients.
//  15. No yield/APY/pricing/valuation/PnL/frontend/hooks introduced.
//
// See docs/v2-hexmining-roadmap.md §11.12 for acceptance criteria.

import { describe, expect, it, vi } from "vitest";

import type { HexMiningReadClient } from "@/services/hexmining/reader";
import {
  DAILY_DATA_PAYLOAD_VERSION,
  acquireAndPersistHexDailyDataObservation,
  encodeDailyDataPayload,
} from "@/services/hexmining/daily-data-observation-service";
import { validateCanonicalPayload } from "@/services/hexmining/observation-store";

// ─── Shared constants ─────────────────────────────────────────────────────────

const DEFAULT_CURRENT_DAY = 5_000n;
const DEFAULT_BLOCK = 21_000_000n;
const DEFAULT_OBSERVED_AT = new Date("2026-06-06T00:00:00.000Z");
const MOCK_RAW_DAILY_DATA = [100_000_000_000n, 200_000_000_000n, 300_000_000_000n];

// ─── Client factory ────────────────────────────────────────────────────────────

type MockReadContractArgs = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

function makePublicClient(opts?: {
  rawDailyData?: readonly bigint[];
  currentDay?: bigint;
  blockNumber?: bigint;
  readContractImpl?: (args: MockReadContractArgs) => Promise<unknown>;
}): HexMiningReadClient {
  const rawData = opts?.rawDailyData ?? MOCK_RAW_DAILY_DATA;
  const currentDay = opts?.currentDay ?? DEFAULT_CURRENT_DAY;
  const blockNumber = opts?.blockNumber ?? DEFAULT_BLOCK;

  return {
    getBlockNumber: vi.fn(async () => blockNumber),
    readContract: vi.fn(
      opts?.readContractImpl ??
        (async ({ functionName }: MockReadContractArgs) => {
          if (functionName === "currentDay") return currentDay;
          if (functionName === "dailyDataRange") return rawData;
          throw new Error(`unexpected function: ${functionName}`);
        }),
    ),
  } as unknown as HexMiningReadClient;
}

function makePersistMock(id = "obs_123") {
  return vi.fn(async () => ({ id }));
}

// ─── encodeDailyDataPayload (unit) ────────────────────────────────────────────

describe("encodeDailyDataPayload", () => {
  it("encodes bigint[] to decimal strings in dailyData array", () => {
    const payload = encodeDailyDataPayload([100_000_000_000n, 200_000_000_000n]);
    const parsed = JSON.parse(payload) as { schemaVersion: string; dailyData: string[] };
    expect(parsed.dailyData).toEqual(["100000000000", "200000000000"]);
  });

  it("includes schemaVersion in payload", () => {
    const payload = encodeDailyDataPayload([42n]);
    const parsed = JSON.parse(payload) as { schemaVersion: string };
    expect(parsed.schemaVersion).toBe(DAILY_DATA_PAYLOAD_VERSION);
  });

  it("preserves element order exactly", () => {
    const input = [3n, 1n, 4n, 1n, 5n, 9n, 2n, 6n];
    const payload = encodeDailyDataPayload(input);
    const parsed = JSON.parse(payload) as { dailyData: string[] };
    expect(parsed.dailyData).toEqual(["3", "1", "4", "1", "5", "9", "2", "6"]);
  });

  it("handles empty array", () => {
    const payload = encodeDailyDataPayload([]);
    const parsed = JSON.parse(payload) as { dailyData: string[] };
    expect(parsed.dailyData).toEqual([]);
  });

  it("handles large uint72-range bigints", () => {
    const UINT72_MAX = 4_722_366_482_869_645_213_695n;
    const payload = encodeDailyDataPayload([UINT72_MAX]);
    const parsed = JSON.parse(payload) as { dailyData: string[] };
    expect(parsed.dailyData[0]).toBe("4722366482869645213695");
  });

  it("produces no numeric JSON values — passes validateCanonicalPayload", () => {
    const payload = encodeDailyDataPayload(MOCK_RAW_DAILY_DATA);
    expect(() => validateCanonicalPayload(payload)).not.toThrow();
  });

  it("is deterministic — same input always produces same output", () => {
    const input = [111n, 222n, 333n];
    expect(encodeDailyDataPayload(input)).toBe(encodeDailyDataPayload(input));
    expect(encodeDailyDataPayload(input)).toBe(encodeDailyDataPayload([111n, 222n, 333n]));
  });
});

// ─── acquireAndPersistHexDailyDataObservation ─────────────────────────────────

describe("acquireAndPersistHexDailyDataObservation", () => {
  // ── 1. Nominal path — full round trip ────────────────────────────────────

  it("returns ok:true with observationId and metadata on successful acquire+persist", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock("obs_abc");

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observationId).toBe("obs_abc");
      expect(result.rangeStartDay).toBe(1000);
      expect(result.rangeEndDay).toBe(1002);
    }
  });

  // ── 2. canonicalPayload encodes bigints as decimal strings ────────────────

  it("encodes rawDailyData bigints to decimal strings in canonicalPayload passed to persistObservation", async () => {
    const client = makePublicClient({ rawDailyData: [987_654_321_098n, 111_222_333_444n] });
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1001, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(persistMock).toHaveBeenCalledOnce();
    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as { canonicalPayload: string };
    const parsed = JSON.parse(callArg.canonicalPayload) as { dailyData: string[] };
    expect(parsed.dailyData).toEqual(["987654321098", "111222333444"]);
  });

  // ── 3. No numeric JSON values in canonicalPayload ─────────────────────────

  it("produces canonicalPayload with no numeric JSON values (bigint-safe policy)", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as { canonicalPayload: string };
    // validateCanonicalPayload throws on any numeric JSON value
    expect(() => validateCanonicalPayload(callArg.canonicalPayload)).not.toThrow();
    // Confirm the payload string itself contains no bare JSON numbers
    const raw = callArg.canonicalPayload;
    expect(raw).not.toMatch(/:[ ]*[0-9]/);
  });

  // ── 4. rawDailyData order preserved ──────────────────────────────────────

  it("preserves rawDailyData element order in the encoded canonicalPayload", async () => {
    const ordered = [10n, 20n, 30n, 40n, 50n];
    const client = makePublicClient({ rawDailyData: ordered });
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1004, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as { canonicalPayload: string };
    const parsed = JSON.parse(callArg.canonicalPayload) as { dailyData: string[] };
    expect(parsed.dailyData).toEqual(["10", "20", "30", "40", "50"]);
  });

  // ── 5. Uses inclusive rangeEndDay, not rpcEndDay ──────────────────────────

  it("passes inclusive rangeEndDay (not rpcEndDay) to persistObservation", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 500, rangeEndDay: 599, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as {
      rangeStartDay: number;
      rangeEndDay: number;
    };
    expect(callArg.rangeStartDay).toBe(500);
    expect(callArg.rangeEndDay).toBe(599); // inclusive stored bound, not 600 (rpcEndDay)
  });

  // ── 6. Provenance fields forwarded correctly ──────────────────────────────

  it("forwards observedAtBlock, observedAt, chainId, rpcEndpointLabel, and warnings to persistObservation", async () => {
    const client = makePublicClient({ blockNumber: 99_000_000n });
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      {
        publicClient: client,
        rangeStartDay: 1000,
        rangeEndDay: 1002,
        rpcEndpointLabel: "pulsechain-primary",
        asOf: DEFAULT_OBSERVED_AT,
      },
      { persistObservation: persistMock },
    );

    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as {
      chainId: number;
      observedAtBlock: bigint;
      observedAt: Date;
      rpcEndpointLabel: string | null;
      warnings: string[];
    };
    expect(callArg.chainId).toBe(369);
    expect(callArg.observedAtBlock).toBe(99_000_000n);
    expect(callArg.observedAt).toEqual(DEFAULT_OBSERVED_AT);
    expect(callArg.rpcEndpointLabel).toBe("pulsechain-primary");
    expect(Array.isArray(callArg.warnings)).toBe(true);
  });

  it("returns observedAtBlock as decimal string in the result", async () => {
    const client = makePublicClient({ blockNumber: 12_345_678n });
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observedAtBlock).toBe("12345678");
      expect(typeof result.observedAtBlock).toBe("string");
    }
  });

  it("returns observedAt as ISO 8601 string in the result", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observedAt).toBe("2026-06-06T00:00:00.000Z");
    }
  });

  // ── 7. validateCanonicalPayload called before persistence ─────────────────

  it("calls validatePayload before calling persistObservation", async () => {
    const callOrder: string[] = [];
    const validateSpy = vi.fn(() => {
      callOrder.push("validate");
    });
    const persistMock = vi.fn(async () => {
      callOrder.push("persist");
      return { id: "obs_999" };
    });
    const client = makePublicClient();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock, validatePayload: validateSpy },
    );

    expect(validateSpy).toHaveBeenCalledOnce();
    expect(persistMock).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["validate", "persist"]);
  });

  // ── 8. persistHexDailyDataObservation called after validation ─────────────

  it("calls persistObservation with correct payloadVersion", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();

    await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    const callArg = (persistMock.mock.calls as unknown[][])[0][0] as { payloadVersion: string };
    expect(callArg.payloadVersion).toBe(DAILY_DATA_PAYLOAD_VERSION);
  });

  // ── 9. Dedup path reused — existing id returned ───────────────────────────

  it("returns the existing observationId when persistObservation returns a deduplicated id", async () => {
    const EXISTING_ID = "obs_existing_dedup";
    const client = makePublicClient();
    const persistMock = vi.fn(async () => ({ id: EXISTING_ID }));

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observationId).toBe(EXISTING_ID);
    }
    // persistObservation was called exactly once — no manual row creation
    expect(persistMock).toHaveBeenCalledOnce();
  });

  // ── 10. Reader failure — persistence not called ───────────────────────────

  it("returns ok:false and does not call persistence when the read boundary fails", async () => {
    const client = makePublicClient({
      readContractImpl: async () => {
        throw new Error("RPC unavailable");
      },
    });
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002 },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(false);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("returns the reader's error code when the read boundary fails", async () => {
    // Trigger an invalid range to get a deterministic reader error
    const client = makePublicClient();
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: -1, rangeEndDay: 100 },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-invalid-range-negative-start");
    }
    expect(persistMock).not.toHaveBeenCalled();
  });

  // ── 11. Validation failure — persistence not called ───────────────────────

  it("returns ok:false and does not call persistence when validatePayload throws", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();
    const throwingValidate = vi.fn(() => {
      throw new Error("Non-canonical payload: numeric JSON values are not allowed.");
    });

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock, validatePayload: throwingValidate },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-invalid-canonical-payload");
    }
    expect(persistMock).not.toHaveBeenCalled();
    expect(throwingValidate).toHaveBeenCalledOnce();
  });

  // ── 12. Persistence failure — sanitized error returned ────────────────────

  it("returns ok:false with sanitized code when persistObservation throws", async () => {
    const client = makePublicClient();
    const persistMock = vi.fn(async () => {
      throw new Error("DB connection failed: password=secret");
    });

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("hexmining-persistence-failed");
      // No raw exception message or credentials in the returned code
      expect(result.code).not.toContain("password");
      expect(result.code).not.toContain("DB connection");
    }
  });

  // ── 13. canonicalPayload not exposed in result ────────────────────────────

  it("does not include canonicalPayload in the returned result", async () => {
    const client = makePublicClient();
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    // canonicalPayload must not be in the result shape
    expect(JSON.stringify(result)).not.toContain("canonicalPayload");
    expect(JSON.stringify(result)).not.toContain("dailyData");
    expect(JSON.stringify(result)).not.toContain("schemaVersion");
  });

  // ── 14. No live RPC ───────────────────────────────────────────────────────

  it("uses only injected mock clients — no live network calls", async () => {
    // All calls flow through the injected publicClient mock.
    // The HexMiningReadClient interface has no URL or network side effects.
    const getBlockNumberMock = vi.fn(async () => DEFAULT_BLOCK);
    const readContractMock = vi.fn(async ({ functionName }: MockReadContractArgs) => {
      if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
      if (functionName === "dailyDataRange") return MOCK_RAW_DAILY_DATA;
      throw new Error(`unexpected: ${functionName}`);
    });
    const client: HexMiningReadClient = {
      getBlockNumber: getBlockNumberMock,
      readContract: readContractMock,
    } as unknown as HexMiningReadClient;
    const persistMock = makePersistMock();

    const result = await acquireAndPersistHexDailyDataObservation(
      { publicClient: client, rangeStartDay: 1000, rangeEndDay: 1002, asOf: DEFAULT_OBSERVED_AT },
      { persistObservation: persistMock },
    );

    expect(result.ok).toBe(true);
    // Confirm only the mock methods were called — no network side effects
    expect(getBlockNumberMock).toHaveBeenCalledOnce();
    expect(readContractMock).toHaveBeenCalledTimes(2); // currentDay + dailyDataRange
    expect(persistMock).toHaveBeenCalledOnce();
  });
});
