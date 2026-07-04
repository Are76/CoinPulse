import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";

// ─── Purpose ────────────────────────────────────────────────────────────────────
//
// Operator verification tooling only. This is the native-HEX equivalent of the
// shipped HSI live verification runner. It drives the *existing* native active
// stake read path
//
//     stakeCount → stakeLists (enumerated)
//
// against a known PulseChain wallet and assembles a factual report of what each
// read produced. It orchestrates the same on-chain reads the native stake sync
// already performs — it contains no new product logic, persists nothing, and does
// NO pricing, valuation, yield, ROI, APR/APY, or PnL math. Every check is a
// presence/consistency assertion, never a numeric or financial comparison.
//
// It never fabricates values: the report is built strictly from what the RPC
// returned. When run with mock deps (tests) it exercises the same assembly
// deterministically; when run from the CLI wrapper it uses a real viem client.

const PULSECHAIN_CHAIN_ID = 369;

// Upper bound on the number of native stakes we will enumerate. Real wallets
// hold at most a few thousand; this cap fails closed if `stakeCount` decodes to
// a corrupt/absurd value (e.g. a uint256 beyond Number.MAX_SAFE_INTEGER, which
// would otherwise make the enumeration loop hang instead of erroring).
const MAX_REASONABLE_STAKE_COUNT = 100_000n;

// ─── HEX native stake ABI ─────────────────────────────────────────────────────
//
// Same reads the native stake sync uses. `stakeLists` returns the packed stake
// struct; viem decodes sizes <= 48 bits as `number` and > 48 bits as `bigint`,
// so stakeId/lockedDay/stakedDays/unlockedDay are numbers and stakedHearts/
// stakeShares are bigints. No stake struct field is interpreted financially here.
const PHEX_STAKE_ABI = parseAbi([
  "function stakeCount(address stakerAddr) view returns (uint256)",
  "function stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type NativeStakeLiveVerificationReadClient = Pick<
  PublicClient,
  "readContract" | "getBlockNumber"
>;

export type NativeStakeLiveVerificationInput = {
  chainId: number;
  walletAddress: string;
  /** The pHEX contract address the native stakes live on. */
  hexAddress: string;
  /** Optional block override; defaults to the captured latest block. */
  observedAtBlock?: bigint;
};

export type NativeStakeLiveVerificationDeps = {
  publicClient: NativeStakeLiveVerificationReadClient;
};

/**
 * One enumerated native stake, recorded for presence only. Bigint stake values
 * are carried as decimal strings (never scaled, priced, or compared).
 */
export type NativeStakeObservation = {
  stakeIndex: number;
  stakeId: string | null;
  stakeHearts: string | null;
  stakeShares: string | null;
  lockedDay: number | null;
  stakedDays: number | null;
};

export type NativeStakeLiveVerificationChecks = {
  stakeCountMatchesEnumerated: boolean;
  everyStakeHasStakeId: boolean;
  everyStakeHasStakeShares: boolean;
  everyStakeHasLockedDay: boolean;
  everyStakeHasStakedDays: boolean;
  everyStakeHasStakeHearts: boolean;
  noDuplicateStakeIds: boolean;
  allReadsFromSingleBlock: boolean;
};

export type NativeStakeLiveVerificationReport = {
  schemaVersion: "v1";
  chainId: number;
  walletAddress: string;
  hexAddress: string;
  observedAtBlock: string | null;
  ok: boolean;
  code: string | null;
  stakeCount: number | null;
  enumeratedCount: number;
  stakes: NativeStakeObservation[];
  warnings: string[];
  checks: NativeStakeLiveVerificationChecks;
  allChecksPassed: boolean;
};

// The raw stakeLists tuple shape (see ABI above).
type StakeListsTuple = readonly [
  number | bigint | null | undefined, // stakeId (uint40)
  bigint | null | undefined, // stakedHearts (uint72)
  bigint | null | undefined, // stakeShares (uint72)
  number | bigint | null | undefined, // lockedDay (uint16)
  number | bigint | null | undefined, // stakedDays (uint16)
  number | bigint | null | undefined, // unlockedDay (uint16)
  boolean | null | undefined, // isAutoStake
];

// ─── Runner ─────────────────────────────────────────────────────────────────────

export async function runNativeStakeLiveVerification(
  input: NativeStakeLiveVerificationInput,
  deps: NativeStakeLiveVerificationDeps,
): Promise<NativeStakeLiveVerificationReport> {
  const walletAddress = input.walletAddress.toLowerCase();
  const hexAddress = input.hexAddress.toLowerCase();

  const report: NativeStakeLiveVerificationReport = {
    schemaVersion: "v1",
    chainId: input.chainId,
    walletAddress,
    hexAddress,
    observedAtBlock: null,
    ok: false,
    code: null,
    stakeCount: null,
    enumeratedCount: 0,
    stakes: [],
    warnings: [],
    checks: {
      stakeCountMatchesEnumerated: false,
      everyStakeHasStakeId: false,
      everyStakeHasStakeShares: false,
      everyStakeHasLockedDay: false,
      everyStakeHasStakedDays: false,
      everyStakeHasStakeHearts: false,
      noDuplicateStakeIds: false,
      allReadsFromSingleBlock: false,
    },
    allChecksPassed: false,
  };

  // Guardrail: PulseChain only. Fail closed before any RPC.
  if (!isPulsechainVerificationChain(input.chainId)) {
    report.code = "hexmining-native-verification-unsupported-chain";
    return finalize(report);
  }

  // ── Step 1: capture a single observed block so every read is consistent ───────
  let observedAtBlock: bigint;
  try {
    observedAtBlock = input.observedAtBlock ?? (await deps.publicClient.getBlockNumber());
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    report.code = `hexmining-native-verification-block-rpc-${failure.code}`;
    return finalize(report);
  }
  report.observedAtBlock = observedAtBlock.toString();

  // ── Step 2: read the wallet's native stake count ─────────────────────────────
  let stakeCount: number;
  try {
    const raw = (await deps.publicClient.readContract({
      address: hexAddress as `0x${string}`,
      abi: PHEX_STAKE_ABI,
      functionName: "stakeCount",
      args: [walletAddress as `0x${string}`],
      blockNumber: observedAtBlock,
    })) as bigint;
    // Fail closed on a corrupt/absurd count rather than entering an unbounded
    // (potentially hanging) enumeration loop.
    if (raw < 0n || raw > MAX_REASONABLE_STAKE_COUNT) {
      report.code = "hexmining-native-verification-stakecount-out-of-range";
      return finalize(report);
    }
    stakeCount = Number(raw);
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    report.code = `hexmining-native-verification-stakecount-rpc-${failure.code}`;
    return finalize(report);
  }

  report.ok = true;
  report.stakeCount = stakeCount;

  // ── Step 3: enumerate each stake at the captured block ───────────────────────
  for (let i = 0; i < stakeCount; i++) {
    let tuple: StakeListsTuple;
    try {
      tuple = (await deps.publicClient.readContract({
        address: hexAddress as `0x${string}`,
        abi: PHEX_STAKE_ABI,
        functionName: "stakeLists",
        args: [walletAddress as `0x${string}`, BigInt(i)],
        blockNumber: observedAtBlock,
      })) as StakeListsTuple;
    } catch (error) {
      const failure = classifyRpcFailure({ error });
      report.warnings.push(
        `hexmining-native-verification-stakelist-rpc-${failure.code}:index=${i}`,
      );
      // Skip — a stake we could not read is a count/consistency failure, never
      // a fabricated observation.
      continue;
    }

    report.stakes.push({
      stakeIndex: i,
      stakeId: toIntString(tuple[0]),
      stakeHearts: toBigintString(tuple[1]),
      stakeShares: toBigintString(tuple[2]),
      lockedDay: toNumber(tuple[3]),
      stakedDays: toNumber(tuple[4]),
    });
  }

  report.enumeratedCount = report.stakes.length;

  // ── Checks (presence/consistency only — never financial comparisons) ─────────
  const observedStakeIds = report.stakes
    .map((s) => s.stakeId)
    .filter((id): id is string => id != null);

  report.checks = {
    stakeCountMatchesEnumerated: report.enumeratedCount === stakeCount,
    everyStakeHasStakeId: report.stakes.every((s) => s.stakeId != null),
    everyStakeHasStakeShares: report.stakes.every((s) => s.stakeShares != null),
    everyStakeHasLockedDay: report.stakes.every((s) => s.lockedDay != null),
    everyStakeHasStakedDays: report.stakes.every((s) => s.stakedDays != null),
    everyStakeHasStakeHearts: report.stakes.every((s) => s.stakeHearts != null),
    noDuplicateStakeIds: new Set(observedStakeIds).size === observedStakeIds.length,
    // Asserts a single block was captured up front; that same `observedAtBlock`
    // is threaded into every `readContract` call above by construction, so this
    // confirms "a block was captured and all reads were pinned to it" — it is
    // not (and cannot be) a post-hoc check that the node honored the pin.
    allReadsFromSingleBlock: report.observedAtBlock != null,
  };

  return finalize(report);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function finalize(
  report: NativeStakeLiveVerificationReport,
): NativeStakeLiveVerificationReport {
  // Overall status requires a successful read of at least one stake and every
  // presence/consistency check true. An empty wallet is not a passing fixture.
  report.allChecksPassed =
    report.ok &&
    report.enumeratedCount > 0 &&
    Object.values(report.checks).every(Boolean);
  return report;
}

function toIntString(value: number | bigint | null | undefined): string | null {
  return value == null ? null : value.toString();
}

function toBigintString(value: bigint | null | undefined): string | null {
  return value == null ? null : value.toString();
}

function toNumber(value: number | bigint | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export function isPulsechainVerificationChain(chainId: number): boolean {
  return chainId === PULSECHAIN_CHAIN_ID;
}
