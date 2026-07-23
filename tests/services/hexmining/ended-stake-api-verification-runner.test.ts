// HexMining — ended-stake API verification runner contract tests
//
// The runner drives the existing backend read path (GET /api/hexmining/ended-
// stakes → EndedHexStakeListDto) read-only and assembles a factual PASS/WARN/FAIL
// report. These tests exercise the real check + classification logic with an
// injected fake fetch — no live server, no DB, no RPC, no network. They assert
// NO financial value, only presence/consistency/scoping, mirroring the runner's
// own guardrail.

import { describe, expect, it, vi } from "vitest";

import {
  runEndedStakeApiVerification,
  buildRequestUrl,
  isPulsechainVerificationChain,
  type EndedStakeApiVerificationDeps,
  type FetchLike,
} from "@/services/hexmining/ended-stake-api-verification-runner";
import type { EndedHexStakeDto, EndedHexStakeListDto } from "@/services/hexmining/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAIN_ID = 369;
const WALLET = "0x1111111111111111111111111111111111111111";
const BASE_URL = "http://localhost:3000";
const UINT72_MAX = "4722366482869645213695";

// ─── DTO fixture helpers ───────────────────────────────────────────────────────

function completeStake(overrides: Partial<EndedHexStakeDto> = {}): EndedHexStakeDto {
  return {
    schemaVersion: "v1",
    id: "obs-1",
    chainId: CHAIN_ID,
    walletAddress: WALLET,
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
    observedAt: "2026-06-14T12:00:00.000Z",
    isComplete: true,
    warnings: [],
    ...overrides,
  };
}

function incompleteStake(overrides: Partial<EndedHexStakeDto> = {}): EndedHexStakeDto {
  return completeStake({
    id: "obs-incomplete",
    stakeId: "999999",
    stakeIndex: null,
    stakedDays: null,
    lockedDay: null,
    stakeShares: null,
    principalHex: null,
    yieldHex: null,
    startTxHash: null,
    startBlockNumber: null,
    endTxHash: "0xincomplete",
    endBlockNumber: "22000000",
    isComplete: false,
    warnings: ["hexmining-ended-stake-lockedday-unknown"],
    ...overrides,
  });
}

function listDto(stakes: EndedHexStakeDto[]): EndedHexStakeListDto {
  const hasIncomplete = stakes.some((s) => !s.isComplete);
  return {
    schemaVersion: "v1",
    chainId: CHAIN_ID,
    walletAddress: WALLET,
    stakes,
    totalCount: stakes.length,
    isComplete: !hasIncomplete,
    warnings: stakes.flatMap((s) => s.warnings),
  };
}

// ─── Fake fetch ────────────────────────────────────────────────────────────────

function makeFetch(config: {
  status?: number;
  ok?: boolean;
  body?: unknown;
  jsonThrows?: boolean;
  fetchThrows?: unknown;
}): { deps: EndedStakeApiVerificationDeps; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    if (config.fetchThrows) throw config.fetchThrows;
    return {
      ok: config.ok ?? true,
      status: config.status ?? 200,
      json: async () => {
        if (config.jsonThrows) throw new SyntaxError("bad json");
        return config.body;
      },
    };
  };
  return { deps: { fetchImpl }, urls };
}

const BASE_INPUT = { chainId: CHAIN_ID, walletAddress: WALLET, baseUrl: BASE_URL };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runEndedStakeApiVerification", () => {
  it("PASS: reachable API, all observations complete and consistent", async () => {
    const { deps, urls } = makeFetch({
      body: { data: listDto([completeStake(), completeStake({ id: "obs-2", stakeId: "1", endTxHash: "0xz", endBlockNumber: "19000000", stakeShares: UINT72_MAX })]) },
    });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("PASS");
    expect(report.httpStatus).toBe(200);
    expect(report.totalObservations).toBe(2);
    expect(report.completeObservations).toBe(2);
    expect(report.incompleteObservations).toBe(0);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    // Read-only single GET against the shipped route.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      "http://localhost:3000/api/hexmining/ended-stakes?walletAddress=0x1111111111111111111111111111111111111111&chainId=369",
    );
  });

  it("PASS: a PR #335-style upgraded row (now complete) passes cleanly", async () => {
    // A row that was previously incomplete and has since been upgraded presents
    // to the API as a normal complete observation with digit-only stakeShares.
    const upgraded = completeStake({ id: "obs-upgraded", stakeId: "700001", lockedDay: 1810, stakeShares: UINT72_MAX });
    const { deps } = makeFetch({ body: { data: listDto([upgraded]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("PASS");
    expect(report.checks.everyCompleteHasDigitOnlyStakeShares).toBe(true);
    expect(report.checks.everyCompleteHasLockedDay).toBe(true);
  });

  it("WARN: reachable but no observations — honest 'no rows', not proof of ingestion", async () => {
    const { deps } = makeFetch({ body: { data: listDto([]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("WARN");
    expect(report.totalObservations).toBe(0);
    expect(report.notes.join(" ")).toContain("not proof of successful ended-stake ingestion");
    // Structural checks over an empty set hold; classification still WARN.
    expect(report.checks.stakeSharesAlwaysStringOrNull).toBe(true);
  });

  it("WARN: a legitimately incomplete observation carrying its warning is partial, not PASS", async () => {
    const { deps } = makeFetch({
      body: { data: listDto([completeStake(), incompleteStake()]) },
    });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("WARN");
    expect(report.incompleteObservations).toBe(1);
    expect(report.checks.everyIncompleteHasWarning).toBe(true);
    expect(report.notes.join(" ")).toContain("legitimately incomplete");
  });

  it("FAIL: an incomplete observation missing its warning signal", async () => {
    const silentlyIncomplete = incompleteStake({ warnings: [] });
    const { deps } = makeFetch({ body: { data: listDto([silentlyIncomplete]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.everyIncompleteHasWarning).toBe(false);
  });

  it("FAIL: a complete observation missing lockedDay (no fabrication tolerated)", async () => {
    const badComplete = completeStake({ lockedDay: null });
    const { deps } = makeFetch({ body: { data: listDto([badComplete]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.everyCompleteHasLockedDay).toBe(false);
  });

  it("FAIL: a complete observation with non-digit stakeShares", async () => {
    const badShares = completeStake({ stakeShares: "1.4e12" });
    const { deps } = makeFetch({ body: { data: listDto([badShares]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.everyCompleteHasDigitOnlyStakeShares).toBe(false);
    expect(report.checks.stakeSharesAlwaysStringOrNull).toBe(true); // still a string
  });

  it("FAIL: stakeShares present as a JSON number instead of a string", async () => {
    // Simulate a serialization regression that leaked a Number into the DTO.
    const numericShares = completeStake({ stakeShares: 1414291579679 as unknown as string });
    const { deps } = makeFetch({ body: { data: listDto([numericShares]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.stakeSharesAlwaysStringOrNull).toBe(false);
  });

  it("FAIL: an observation scoped to a different wallet leaks into the result", async () => {
    const foreign = completeStake({
      id: "obs-foreign",
      walletAddress: "0x2222222222222222222222222222222222222222",
    });
    const { deps } = makeFetch({ body: { data: listDto([completeStake(), foreign]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.allScopedToRequestedWallet).toBe(false);
  });

  it("FAIL: an observation scoped to a different chain leaks into the result", async () => {
    const foreign = completeStake({ id: "obs-eth", chainId: 1 });
    const { deps } = makeFetch({ body: { data: listDto([foreign]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.allScopedToRequestedChain).toBe(false);
  });

  it("FAIL: duplicate observation identities", async () => {
    const a = completeStake();
    const dup = completeStake({ id: "obs-dup" }); // same dedupe identity fields
    const { deps } = makeFetch({ body: { data: listDto([a, dup]) } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.noDuplicateObservationIdentities).toBe(false);
  });

  it("FAIL: non-200 HTTP status short-circuits", async () => {
    const { deps } = makeFetch({ ok: false, status: 500, body: {} });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.apiReachable).toBe(false);
    expect(report.httpStatus).toBe(500);
    expect(report.warnings.some((w) => w.includes("http-500"))).toBe(true);
  });

  it("FAIL: fetch throws (server not running) is coded, not crashed", async () => {
    const { deps } = makeFetch({ fetchThrows: new Error("ECONNREFUSED") });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.apiReachable).toBe(false);
    expect(report.warnings.some((w) => w.includes("fetch-failed"))).toBe(true);
  });

  it("FAIL: malformed envelope (missing data.stakes) is rejected", async () => {
    const { deps } = makeFetch({ body: { data: { chainId: CHAIN_ID, walletAddress: WALLET } } });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.envelopeShapeValid).toBe(false);
  });

  it("FAIL: unsupported chain fails closed before any fetch", async () => {
    const fetchImpl = vi.fn();
    const report = await runEndedStakeApiVerification(
      { ...BASE_INPUT, chainId: 1 },
      { fetchImpl: fetchImpl as unknown as FetchLike },
    );

    expect(report.classification).toBe("FAIL");
    expect(report.warnings).toContain("hexmining-ended-stake-verification-unsupported-chain");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never records or leaks the base URL value (presence flag only)", async () => {
    const secretBase = "https://secret-host.internal:8443";
    const { deps } = makeFetch({ body: { data: listDto([completeStake()]) } });

    const report = await runEndedStakeApiVerification(
      { ...BASE_INPUT, baseUrl: secretBase },
      deps,
    );

    expect(report.baseUrlProvided).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret-host.internal");
    expect(serialized).not.toContain("8443");
  });

  it("exposes a stable report shape with boolean-only checks", async () => {
    const { deps } = makeFetch({ body: { data: listDto([completeStake()]) } });
    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(Object.keys(report.checks).sort()).toEqual(
      [
        "apiReachable",
        "envelopeShapeValid",
        "allScopedToRequestedChain",
        "allScopedToRequestedWallet",
        "everyCompleteHasLockedDay",
        "everyCompleteHasDigitOnlyStakeShares",
        "everyIncompleteHasWarning",
        "stakeSharesAlwaysStringOrNull",
        "noDuplicateObservationIdentities",
      ].sort(),
    );
    for (const value of Object.values(report.checks)) {
      expect(typeof value).toBe("boolean");
    }
    expect(["PASS", "WARN", "FAIL"]).toContain(report.classification);
  });
});

// ─── P2-1: malformed stake entries never throw — deterministic FAIL ─────────────

describe("runEndedStakeApiVerification: malformed stake entries fail closed", () => {
  // Build a 200 envelope whose `stakes` array carries an arbitrary (possibly
  // malformed) entry alongside the typed shape, bypassing the fixture types.
  function listWithRawStakes(rawStakes: unknown[]): unknown {
    return {
      data: {
        schemaVersion: "v1",
        chainId: CHAIN_ID,
        walletAddress: WALLET,
        stakes: rawStakes,
        totalCount: rawStakes.length,
        isComplete: true,
        warnings: [],
      },
    };
  }

  it("FAIL (no throw): a null stake entry", async () => {
    const { deps } = makeFetch({ body: listWithRawStakes([completeStake(), null]) });

    // Must resolve to a report, never reject/throw.
    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.warnings).toContain("hexmining-ended-stake-verification-malformed-stake-entry");
  });

  it("FAIL (no throw): an object missing walletAddress", async () => {
    const noWallet: Record<string, unknown> = { ...completeStake() };
    delete noWallet.walletAddress;
    const { deps } = makeFetch({ body: listWithRawStakes([noWallet]) });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.warnings).toContain("hexmining-ended-stake-verification-malformed-stake-entry");
  });

  it("FAIL (no throw): a primitive stake entry", async () => {
    const { deps } = makeFetch({ body: listWithRawStakes(["not-an-object", 42]) });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.warnings).toContain("hexmining-ended-stake-verification-malformed-stake-entry");
  });

  it("FAIL (no throw): an object missing endBlockNumber (identity dereference)", async () => {
    // endBlockNumber feeds observationIdentity; a missing/non-string value would
    // previously slip through and skew identity. It must fail closed structurally.
    const noEndBlock: Record<string, unknown> = { ...completeStake() };
    delete noEndBlock.endBlockNumber;
    const { deps } = makeFetch({ body: listWithRawStakes([noEndBlock]) });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.warnings).toContain("hexmining-ended-stake-verification-malformed-stake-entry");
  });

  it("does not reject the promise for a malformed array (returns a report)", async () => {
    const { deps } = makeFetch({ body: listWithRawStakes([null, "x", {}]) });
    await expect(runEndedStakeApiVerification(BASE_INPUT, deps)).resolves.toBeDefined();
  });
});

// ─── P2-2: list-level scope validated before the empty-result branch ────────────

describe("runEndedStakeApiVerification: list-level scope guards empty results", () => {
  function emptyListWithScope(chainId: number, walletAddress: string): { data: EndedHexStakeListDto } {
    return {
      data: {
        schemaVersion: "v1",
        chainId,
        walletAddress,
        stakes: [],
        totalCount: 0,
        isComplete: true,
        warnings: [],
      },
    };
  }

  it("FAIL: empty stakes but list-level chainId does not match the request", async () => {
    const { deps } = makeFetch({ body: emptyListWithScope(1, WALLET) });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.allScopedToRequestedChain).toBe(false);
    expect(report.totalObservations).toBe(0);
  });

  it("FAIL: empty stakes but list-level walletAddress does not match the request", async () => {
    const { deps } = makeFetch({
      body: emptyListWithScope(CHAIN_ID, "0x2222222222222222222222222222222222222222"),
    });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("FAIL");
    expect(report.checks.allScopedToRequestedWallet).toBe(false);
    expect(report.totalObservations).toBe(0);
  });

  it("WARN: empty stakes with correct list-level scope keeps the honest no-rows path", async () => {
    const { deps } = makeFetch({ body: emptyListWithScope(CHAIN_ID, WALLET) });

    const report = await runEndedStakeApiVerification(BASE_INPUT, deps);

    expect(report.classification).toBe("WARN");
    expect(report.checks.allScopedToRequestedChain).toBe(true);
    expect(report.checks.allScopedToRequestedWallet).toBe(true);
    expect(report.notes.join(" ")).toContain("not proof of successful ended-stake ingestion");
  });
});

describe("buildRequestUrl", () => {
  it("builds the ended-stakes GET URL and strips a trailing slash on base", () => {
    expect(buildRequestUrl("http://localhost:3000/", 369, WALLET)).toBe(
      "http://localhost:3000/api/hexmining/ended-stakes?walletAddress=0x1111111111111111111111111111111111111111&chainId=369",
    );
  });
});

describe("isPulsechainVerificationChain", () => {
  it("accepts only chain 369", () => {
    expect(isPulsechainVerificationChain(369)).toBe(true);
    expect(isPulsechainVerificationChain(1)).toBe(false);
    expect(isPulsechainVerificationChain(8453)).toBe(false);
  });
});
