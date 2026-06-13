// HexMining dailyData observation fetch script — focused unit tests.
//
// All network, RPC, and DB dependencies are mocked. No live calls.
//
// Verifies:
//   parseInput:
//     1. Missing DATABASE_URL → ok:false (no DATABASE_URL value in error message)
//     2. Missing --rangeStartDay → ok:false
//     3. Missing --rangeEndDay → ok:false
//     4. Missing --rpcEndpointLabel → ok:false
//     5. Missing --rpcUrl → ok:false
//     6. Negative rangeStartDay → ok:false
//     7. Fractional rangeStartDay → ok:false
//     8. rangeEndDay < rangeStartDay → ok:false
//     9. Valid args → ok:true with correct parsed values
//    10. rpcUrl value does not appear in any error message
//
//   runHexMiningDailyDataObservationFetch:
//    11. Success path calls acquireAndPersist with correct rangeStartDay/rangeEndDay/rpcEndpointLabel
//    12. Success result has chainId=369, status="persisted", payloadVersion="v1"
//    13. Success result does not contain canonicalPayload or rpcUrl
//    14. Failure from acquireAndPersist → ok:false with code and warnings
//    15. publicClient is forwarded to acquireAndPersist

import { describe, expect, it, vi } from "vitest";

import type { HexMiningReadClient } from "@/services/hexmining/reader";
import { DAILY_DATA_PAYLOAD_VERSION } from "@/services/hexmining/daily-data-observation-service";
import {
  parseInput,
  runHexMiningDailyDataObservationFetch,
  type ObservationFetchDeps,
} from "../../scripts/hexmining-dailydata-observation-fetch";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_ENV = { DATABASE_URL: "postgresql://user:pass@localhost:5432/coinpulse" };

function makeArgv(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    "--rangeStartDay": "1000",
    "--rangeEndDay": "1001",
    "--rpcEndpointLabel": "sanitized-pulsechain-rpc",
    "--rpcUrl": "https://rpc.example.invalid",
  };
  const merged = { ...defaults, ...overrides };
  return Object.entries(merged).flatMap(([flag, value]) => [flag, value]);
}

function makePublicClientMock(): HexMiningReadClient {
  return {
    getBlockNumber: vi.fn(async () => 99999999n),
    readContract: vi.fn(async () => {
      throw new Error("mock: readContract not expected in these unit tests");
    }),
  } as unknown as HexMiningReadClient;
}

function makeAcquireMock(result: Awaited<ReturnType<ObservationFetchDeps["acquireAndPersist"] & {}>>) {
  return vi.fn(async () => result);
}

const VALID_ACQUIRE_RESULT = {
  ok: true as const,
  observationId: "obs-abc123",
  rangeStartDay: 1000,
  rangeEndDay: 1001,
  observedAtBlock: "99999999",
  observedAt: "2026-06-01T00:00:00.000Z",
  warnings: [] as string[],
};

// ─── parseInput ───────────────────────────────────────────────────────────────

describe("parseInput", () => {
  it("returns ok:false when DATABASE_URL is missing", () => {
    const result = parseInput(makeArgv(), {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("DATABASE_URL");
    expect(result.error).not.toMatch(/postgresql|postgres|password|secret/i);
  });

  it("returns ok:false when --rangeStartDay is missing", () => {
    const argv = makeArgv({ "--rangeStartDay": "" }).filter((v) => v !== "");
    const filtered = makeArgv();
    const withoutStart = filtered.filter((_, i, arr) => arr[i - 1] !== "--rangeStartDay" && arr[i] !== "--rangeStartDay");
    const result = parseInput(withoutStart, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rangeEndDay is missing", () => {
    const full = makeArgv();
    const withoutEnd = full.filter((_, i, arr) => arr[i - 1] !== "--rangeEndDay" && arr[i] !== "--rangeEndDay");
    const result = parseInput(withoutEnd, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rpcEndpointLabel is missing", () => {
    const full = makeArgv();
    const without = full.filter((_, i, arr) => arr[i - 1] !== "--rpcEndpointLabel" && arr[i] !== "--rpcEndpointLabel");
    const result = parseInput(without, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rpcUrl is missing", () => {
    const full = makeArgv();
    const without = full.filter((_, i, arr) => arr[i - 1] !== "--rpcUrl" && arr[i] !== "--rpcUrl");
    const result = parseInput(without, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when rangeStartDay is negative", () => {
    const result = parseInput(makeArgv({ "--rangeStartDay": "-1" }), VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when rangeStartDay is fractional", () => {
    const result = parseInput(makeArgv({ "--rangeStartDay": "1000.5" }), VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when rangeEndDay < rangeStartDay", () => {
    const result = parseInput(
      makeArgv({ "--rangeStartDay": "1001", "--rangeEndDay": "1000" }),
      VALID_ENV,
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok:true with correct parsed values for valid input", () => {
    const result = parseInput(makeArgv(), VALID_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.rangeStartDay).toBe(1000);
    expect(result.input.rangeEndDay).toBe(1001);
    expect(result.input.rpcEndpointLabel).toBe("sanitized-pulsechain-rpc");
    expect(result.input.rpcUrl).toBe("https://rpc.example.invalid");
  });

  it("error messages do not contain the rpcUrl value", () => {
    const secretUrl = "https://secret-rpc.example.invalid/apikey123";
    const argv = makeArgv({ "--rpcUrl": secretUrl, "--rangeStartDay": "-1" });
    const result = parseInput(argv, VALID_ENV);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(secretUrl);
    expect(result.error).not.toContain("secret-rpc");
  });
});

// ─── runHexMiningDailyDataObservationFetch ────────────────────────────────────

describe("runHexMiningDailyDataObservationFetch", () => {
  it("calls acquireAndPersist with correct rangeStartDay, rangeEndDay, rpcEndpointLabel", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock();

    await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "sanitized-pulsechain-rpc" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(acquireMock).toHaveBeenCalledOnce();
    expect(acquireMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rangeStartDay: 1000,
        rangeEndDay: 1001,
        rpcEndpointLabel: "sanitized-pulsechain-rpc",
      }),
    );
  });

  it("forwards publicClient to acquireAndPersist", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock();

    await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(acquireMock).toHaveBeenCalledWith(
      expect.objectContaining({ publicClient }),
    );
  });

  it("success result has chainId=369, status=persisted, payloadVersion=v1", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock();

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "sanitized-pulsechain-rpc" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chainId).toBe(369);
    expect(result.status).toBe("persisted");
    expect(result.payloadVersion).toBe(DAILY_DATA_PAYLOAD_VERSION);
    expect(result.observationId).toBe("obs-abc123");
    expect(result.rangeStartDay).toBe(1000);
    expect(result.rangeEndDay).toBe(1001);
  });

  it("success result does not contain canonicalPayload or rpcUrl", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock();

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain("canonicalPayload");
    expect(json).not.toContain("rpcUrl");
    expect(json).not.toContain("schemaVersion");
    expect(json).not.toContain("dailyData");
  });

  it("returns ok:false with code and warnings when acquireAndPersist fails", async () => {
    const failResult = {
      ok: false as const,
      code: "hexmining-range-exceeds-current-day",
      warnings: ["hexmining-range-exceeds-current-day"],
    };
    const acquireMock = makeAcquireMock(failResult);
    const publicClient = makePublicClientMock();

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 9999, rangeEndDay: 9999, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("hexmining-range-exceeds-current-day");
    expect(result.warnings).toContain("hexmining-range-exceeds-current-day");
  });

  it("propagates warnings from a successful acquire result", async () => {
    const resultWithWarnings = {
      ...VALID_ACQUIRE_RESULT,
      warnings: ["hexmining-yield-bpd-attribution-unresolved"],
    };
    const acquireMock = makeAcquireMock(resultWithWarnings);
    const publicClient = makePublicClientMock();

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain("hexmining-yield-bpd-attribution-unresolved");
  });
});
