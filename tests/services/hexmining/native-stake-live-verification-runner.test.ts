// HexMining — native active-stake live verification runner contract tests
//
// The runner drives the existing native read path (stakeCount → stakeLists) and
// assembles a factual presence/consistency report. These tests exercise the
// assembly deterministically with in-memory mocks — no live RPC, no database, no
// network. They assert NO financial value, only presence/consistency, mirroring
// the runner's own guardrail.
//
//   1.  Happy path: healthy wallet produces an all-checks-passed report.
//   2.  Zero stakes: handled cleanly; not a passing fixture.
//   3.  Duplicate stake ids → noDuplicateStakeIds false.
//   4.  Missing field → the matching presence check fails, no fabrication.
//   5.  Inconsistent counts (a stake read fails) → count mismatch, warning kept.
//   6.  RPC failure (stakeCount / getBlockNumber) → ok false, coded, checks fail.
//   7.  Captured block propagation: one block captured, pinned to every read.
//   8.  Output shape: stable report/checks shape, all checks boolean.

import { describe, expect, it } from "vitest";

import {
  runNativeStakeLiveVerification,
  isPulsechainVerificationChain,
  type NativeStakeLiveVerificationDeps,
} from "@/services/hexmining/native-stake-live-verification-runner";

// ─── Constants ────────────────────────────────────────────────────────────────

const PHEX = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const WALLET = "0x75f808367720951e789d47e9e9db51148d9aa765";
const CHAIN_ID = 369;
const BLOCK = 26_944_323n;

// stakeLists tuple: [stakeId, stakedHearts, stakeShares, lockedDay, stakedDays,
//                    unlockedDay, isAutoStake]
type StakeTuple = readonly [
  number | null,
  bigint | null,
  bigint | null,
  number | null,
  number | null,
  number,
  boolean,
];

const STAKE_A: StakeTuple = [942663, 1_000_000_000_000_000n, 1_414_291_579_679n, 2310, 5555, 0, false];
const STAKE_B: StakeTuple = [942664, 2_000_000_000_000_000n, 2_828_583_159_358n, 2311, 3639, 0, false];

// ─── Read client mock ────────────────────────────────────────────────────────────

type ReadCall = { functionName: string; blockNumber?: bigint; index?: number };

function makePublicClient(config: {
  blockNumber?: bigint;
  blockError?: unknown;
  stakeCount?: bigint;
  stakeCountError?: unknown;
  stakes?: StakeTuple[];
  throwIndices?: number[];
  rpcChainId?: number;
  chainIdError?: unknown;
}) {
  const calls: ReadCall[] = [];
  let getBlockNumberCalls = 0;
  let getChainIdCalls = 0;

  const client = {
    async getChainId() {
      getChainIdCalls++;
      if (config.chainIdError) throw config.chainIdError;
      return config.rpcChainId ?? CHAIN_ID;
    },
    async getBlockNumber() {
      getBlockNumberCalls++;
      if (config.blockError) throw config.blockError;
      return config.blockNumber ?? BLOCK;
    },
    async readContract(args: { functionName: string; address: string; args?: unknown[]; blockNumber?: bigint }) {
      switch (args.functionName) {
        case "stakeCount": {
          calls.push({ functionName: "stakeCount", blockNumber: args.blockNumber });
          if (config.stakeCountError) throw config.stakeCountError;
          return config.stakeCount ?? 0n;
        }
        case "stakeLists": {
          const idx = Number((args.args as [unknown, bigint])[1]);
          calls.push({ functionName: "stakeLists", blockNumber: args.blockNumber, index: idx });
          if (config.throwIndices?.includes(idx)) {
            throw new Error("execution reverted");
          }
          const tuple = config.stakes?.[idx];
          if (!tuple) throw new Error(`no stake configured for index ${idx}`);
          return tuple;
        }
        default:
          throw new Error(`Unexpected readContract call: ${args.functionName}`);
      }
    },
  } as unknown as NativeStakeLiveVerificationDeps["publicClient"];

  return {
    deps: { publicClient: client } as NativeStakeLiveVerificationDeps,
    calls,
    getBlockNumberCallCount: () => getBlockNumberCalls,
    getChainIdCallCount: () => getChainIdCalls,
  };
}

const BASE_INPUT = {
  chainId: CHAIN_ID,
  walletAddress: WALLET,
  hexAddress: PHEX,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runNativeStakeLiveVerification", () => {
  it("produces an all-checks-passed report for a healthy native-stake wallet", async () => {
    const { deps } = makePublicClient({ stakeCount: 2n, stakes: [STAKE_A, STAKE_B] });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(true);
    expect(report.code).toBeNull();
    expect(report.observedAtBlock).toBe("26944323");
    expect(report.stakeCount).toBe(2);
    expect(report.enumeratedCount).toBe(2);
    expect(report.stakes).toHaveLength(2);

    expect(report.stakes[0]).toEqual({
      stakeIndex: 0,
      stakeId: "942663",
      stakeHearts: "1000000000000000",
      stakeShares: "1414291579679",
      lockedDay: 2310,
      stakedDays: 5555,
    });

    expect(report.checks).toEqual({
      stakeCountMatchesEnumerated: true,
      everyStakeHasStakeId: true,
      everyStakeHasStakeShares: true,
      everyStakeHasLockedDay: true,
      everyStakeHasStakedDays: true,
      everyStakeHasStakeHearts: true,
      noDuplicateStakeIds: true,
      allReadsFromSingleBlock: true,
    });
    expect(report.allChecksPassed).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("handles a zero-stake wallet without fabricating a passing fixture", async () => {
    const { deps, calls } = makePublicClient({ stakeCount: 0n, stakes: [] });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(true);
    expect(report.stakeCount).toBe(0);
    expect(report.enumeratedCount).toBe(0);
    expect(report.stakes).toEqual([]);
    // Vacuous presence/consistency checks hold, but an empty wallet is not a PASS.
    expect(report.checks.stakeCountMatchesEnumerated).toBe(true);
    expect(report.allChecksPassed).toBe(false);
    // No stakeLists reads were attempted.
    expect(calls.some((c) => c.functionName === "stakeLists")).toBe(false);
  });

  it("flags duplicate stake ids", async () => {
    const dupB: StakeTuple = [942663, 2_000_000_000_000_000n, 2_828_583_159_358n, 2311, 3639, 0, false];
    const { deps } = makePublicClient({ stakeCount: 2n, stakes: [STAKE_A, dupB] });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.enumeratedCount).toBe(2);
    expect(report.checks.stakeCountMatchesEnumerated).toBe(true);
    expect(report.checks.noDuplicateStakeIds).toBe(false);
    expect(report.allChecksPassed).toBe(false);
  });

  it("fails the matching presence check when a field is missing, without fabricating", async () => {
    const missingShares: StakeTuple = [942664, 2_000_000_000_000_000n, null, 2311, 3639, 0, false];
    const { deps } = makePublicClient({ stakeCount: 2n, stakes: [STAKE_A, missingShares] });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.stakes[1].stakeShares).toBeNull();
    expect(report.checks.everyStakeHasStakeShares).toBe(false);
    // Other fields on that stake remain present and are not coerced.
    expect(report.checks.everyStakeHasStakeId).toBe(true);
    expect(report.checks.everyStakeHasStakeHearts).toBe(true);
    expect(report.allChecksPassed).toBe(false);
  });

  it("reports a count mismatch (and keeps a warning) when a stake read fails mid-enumeration", async () => {
    const { deps } = makePublicClient({
      stakeCount: 3n,
      stakes: [STAKE_A, STAKE_A, STAKE_B],
      throwIndices: [1],
    });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(true);
    expect(report.stakeCount).toBe(3);
    expect(report.enumeratedCount).toBe(2); // index 1 skipped
    expect(report.checks.stakeCountMatchesEnumerated).toBe(false);
    expect(report.warnings.some((w) => w.includes("stakelist-rpc") && w.includes("index=1"))).toBe(true);
    expect(report.allChecksPassed).toBe(false);
  });

  it("fails closed when the stakeCount RPC read throws", async () => {
    const { deps } = makePublicClient({ stakeCountError: new Error("request timed out") });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-stakecount-rpc-timeout");
    expect(report.observedAtBlock).toBe("26944323"); // block was captured first
    expect(report.stakeCount).toBeNull();
    expect(report.allChecksPassed).toBe(false);
  });

  it("fails closed on an absurd/corrupt stakeCount instead of enumerating", async () => {
    const huge = 1_000_000n; // beyond MAX_REASONABLE_STAKE_COUNT (100_000)
    const { deps, calls } = makePublicClient({ stakeCount: huge });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-stakecount-out-of-range");
    expect(report.stakeCount).toBeNull();
    expect(report.allChecksPassed).toBe(false);
    // No enumeration was attempted.
    expect(calls.some((c) => c.functionName === "stakeLists")).toBe(false);
  });

  it("fails closed when the block RPC read throws", async () => {
    const { deps } = makePublicClient({ blockError: new Error("ECONNREFUSED") });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-block-rpc-network_unreachable");
    expect(report.observedAtBlock).toBeNull();
    expect(report.allChecksPassed).toBe(false);
  });

  it("captures one block and pins every read to it", async () => {
    const customBlock = 30_000_000n;
    const { deps, calls, getBlockNumberCallCount } = makePublicClient({
      blockNumber: customBlock,
      stakeCount: 2n,
      stakes: [STAKE_A, STAKE_B],
    });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(getBlockNumberCallCount()).toBe(1);
    expect(report.observedAtBlock).toBe("30000000");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.blockNumber).toBe(customBlock);
    }
    expect(report.checks.allReadsFromSingleBlock).toBe(true);
  });

  it("uses an explicit observedAtBlock override without calling getBlockNumber", async () => {
    const { deps, calls, getBlockNumberCallCount } = makePublicClient({
      stakeCount: 1n,
      stakes: [STAKE_A],
    });

    const report = await runNativeStakeLiveVerification(
      { ...BASE_INPUT, observedAtBlock: 12_345_678n },
      deps,
    );

    expect(getBlockNumberCallCount()).toBe(0);
    expect(report.observedAtBlock).toBe("12345678");
    for (const call of calls) {
      expect(call.blockNumber).toBe(12_345_678n);
    }
  });

  it("short-circuits on an unsupported chain before any RPC", async () => {
    const { deps, calls, getBlockNumberCallCount, getChainIdCallCount } = makePublicClient({ stakeCount: 2n, stakes: [STAKE_A, STAKE_B] });

    const report = await runNativeStakeLiveVerification({ ...BASE_INPUT, chainId: 1 }, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-unsupported-chain");
    expect(report.allChecksPassed).toBe(false);
    // Declared-chain guard fails closed before touching the node at all.
    expect(getChainIdCallCount()).toBe(0);
    expect(getBlockNumberCallCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the connected RPC serves a non-PulseChain chain", async () => {
    // Declared chainId is 369, but the node reports Ethereum mainnet (1): the
    // HEX stake ABI exists there too, so this must not emit PulseChain evidence.
    const { deps, calls, getBlockNumberCallCount } = makePublicClient({
      rpcChainId: 1,
      stakeCount: 2n,
      stakes: [STAKE_A, STAKE_B],
    });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-rpc-chain-mismatch");
    expect(report.warnings.some((w) => w.includes("expected=369") && w.includes("got=1"))).toBe(true);
    expect(report.allChecksPassed).toBe(false);
    // No block capture and no stake reads once the chain mismatch is detected.
    expect(report.observedAtBlock).toBeNull();
    expect(getBlockNumberCallCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the getChainId RPC read throws", async () => {
    const { deps, calls, getBlockNumberCallCount } = makePublicClient({
      chainIdError: new Error("request timed out"),
      stakeCount: 2n,
      stakes: [STAKE_A, STAKE_B],
    });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(report.ok).toBe(false);
    expect(report.code).toBe("hexmining-native-verification-chainid-rpc-timeout");
    expect(report.allChecksPassed).toBe(false);
    expect(report.observedAtBlock).toBeNull();
    expect(getBlockNumberCallCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("exposes a stable report and checks shape with boolean-only checks", async () => {
    const { deps } = makePublicClient({ stakeCount: 1n, stakes: [STAKE_A] });

    const report = await runNativeStakeLiveVerification(BASE_INPUT, deps);

    expect(Object.keys(report).sort()).toEqual(
      [
        "allChecksPassed",
        "chainId",
        "checks",
        "code",
        "enumeratedCount",
        "hexAddress",
        "observedAtBlock",
        "ok",
        "schemaVersion",
        "stakeCount",
        "stakes",
        "walletAddress",
        "warnings",
      ].sort(),
    );
    expect(report.schemaVersion).toBe("v1");
    expect(Object.keys(report.checks).sort()).toEqual(
      [
        "stakeCountMatchesEnumerated",
        "everyStakeHasStakeId",
        "everyStakeHasStakeShares",
        "everyStakeHasLockedDay",
        "everyStakeHasStakedDays",
        "everyStakeHasStakeHearts",
        "noDuplicateStakeIds",
        "allReadsFromSingleBlock",
      ].sort(),
    );
    for (const value of Object.values(report.checks)) {
      expect(typeof value).toBe("boolean");
    }
    expect(Object.keys(report.stakes[0]).sort()).toEqual(
      ["lockedDay", "stakeHearts", "stakeId", "stakeIndex", "stakeShares", "stakedDays"].sort(),
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
