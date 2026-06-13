// HexMining dailyData observation fetch script — focused unit tests.
//
// All network, RPC, and DB dependencies are mocked. No live calls.
//
// Verifies:
//   Import safety:
//     1. Importing the module does not execute main() or mutate process.exitCode.
//     2. parseInput can be called without REDIS_URL — it is a pure function
//        that does not trigger server-env loading.
//
//   parseInput:
//     3. Missing DATABASE_URL → ok:false (sanitized, no credential values)
//     4. Missing --rangeStartDay → ok:false
//     5. Missing --rangeEndDay → ok:false
//     6. Missing --rpcEndpointLabel → ok:false
//     7. Missing --rpcUrl → ok:false
//     8. Flag given another flag as its value → ok:false (fail-fast)
//     9. Negative rangeStartDay → ok:false
//    10. Fractional rangeStartDay → ok:false
//    11. rangeEndDay < rangeStartDay → ok:false
//    12. Valid args → ok:true with correct parsed values
//    13. rpcUrl value does not appear in any error message
//
//   Chain ID verification:
//    14. chainId 369 → acquireAndPersist is called
//    15. non-369 chainId → acquireAndPersist not called, ok:false, code "wrong-chain"
//    16. getChainId() throws → acquireAndPersist not called, ok:false, code "chain-id-unavailable"
//    17. error output for wrong chain does not contain rpcUrl or credentials
//
//   runHexMiningDailyDataObservationFetch:
//    18. Calls acquireAndPersist with correct rangeStartDay/rangeEndDay/rpcEndpointLabel
//    19. Forwards publicClient to acquireAndPersist
//    20. Success result has chainId=369, status="persisted", payloadVersion="v1"
//    21. Success result does not contain canonicalPayload or rpcUrl
//    22. Failure from acquireAndPersist → ok:false with code and warnings
//    23. Propagates warnings from successful acquire result

import { describe, expect, it, vi } from "vitest";

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

function makePublicClientMock(opts?: {
  chainId?: number;
  chainIdThrows?: boolean;
}): ObservationFetchDeps["publicClient"] {
  const chainId = opts?.chainId ?? 369;
  const chainIdThrows = opts?.chainIdThrows ?? false;
  return {
    getBlockNumber: vi.fn(async () => 99999999n),
    getChainId: vi.fn(async () => {
      if (chainIdThrows) throw new Error("mock: getChainId failed");
      return chainId;
    }),
    readContract: vi.fn(async () => {
      throw new Error("mock: readContract not expected in these unit tests");
    }),
  } as unknown as ObservationFetchDeps["publicClient"];
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

// ─── Import safety ────────────────────────────────────────────────────────────

describe("import safety", () => {
  it("importing the module does not mutate process.exitCode", () => {
    // The module is already imported at the top of this file via the import statement.
    // If main() had run on import, it would have parsed process.argv (vitest argv),
    // found no valid CLI args, and set process.exitCode = 1.
    expect(process.exitCode).not.toBe(1);
  });

  it("parseInput can be called without REDIS_URL in env", () => {
    // parseInput is pure — it only inspects argv and env["DATABASE_URL"].
    // No service module is loaded; no REDIS_URL validation is triggered.
    const result = parseInput([], {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("DATABASE_URL");
    }
  });

  it("missing DATABASE_URL returns sanitized error without leaking values", () => {
    const result = parseInput(makeArgv(), {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("DATABASE_URL");
      expect(result.error).not.toMatch(/postgresql|password|secret|redis/i);
    }
  });
});

// ─── parseInput ───────────────────────────────────────────────────────────────

describe("parseInput", () => {
  it("returns ok:false when --rangeStartDay is missing", () => {
    const full = makeArgv();
    const withoutStart = full.filter(
      (_, i, arr) => arr[i - 1] !== "--rangeStartDay" && arr[i] !== "--rangeStartDay",
    );
    const result = parseInput(withoutStart, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rangeEndDay is missing", () => {
    const full = makeArgv();
    const withoutEnd = full.filter(
      (_, i, arr) => arr[i - 1] !== "--rangeEndDay" && arr[i] !== "--rangeEndDay",
    );
    const result = parseInput(withoutEnd, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rpcEndpointLabel is missing", () => {
    const full = makeArgv();
    const without = full.filter(
      (_, i, arr) => arr[i - 1] !== "--rpcEndpointLabel" && arr[i] !== "--rpcEndpointLabel",
    );
    const result = parseInput(without, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when --rpcUrl is missing", () => {
    const full = makeArgv();
    const without = full.filter(
      (_, i, arr) => arr[i - 1] !== "--rpcUrl" && arr[i] !== "--rpcUrl",
    );
    const result = parseInput(without, VALID_ENV);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when a flag is given another flag as its value", () => {
    const argv = [
      "--rangeStartDay", "--rangeEndDay",
      "1001", "--rpcEndpointLabel", "label",
      "--rpcUrl", "https://rpc.example.invalid",
    ];
    const result = parseInput(argv, VALID_ENV);
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

// ─── Chain ID verification ────────────────────────────────────────────────────

describe("chain ID verification", () => {
  it("calls acquireAndPersist when chainId is 369", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock({ chainId: 369 });

    await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(acquireMock).toHaveBeenCalledOnce();
  });

  it("returns ok:false and does not call acquireAndPersist when chainId is not 369", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock({ chainId: 1 });

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("wrong-chain");
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("returns ok:false and does not call acquireAndPersist when getChainId throws", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock({ chainIdThrows: true });

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("chain-id-unavailable");
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("error output for wrong chain does not contain rpcUrl or credentials", async () => {
    const acquireMock = makeAcquireMock(VALID_ACQUIRE_RESULT);
    const publicClient = makePublicClientMock({ chainId: 1 });

    const result = await runHexMiningDailyDataObservationFetch(
      { rangeStartDay: 1000, rangeEndDay: 1001, rpcEndpointLabel: "label" },
      { publicClient, acquireAndPersist: acquireMock },
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain("https://");
    expect(json).not.toContain("rpcUrl");
    expect(json).not.toContain("DATABASE_URL");
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
    expect(result.payloadVersion).toBe("v1");
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
