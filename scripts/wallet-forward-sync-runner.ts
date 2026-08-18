/**
 * Wallet-scoped forward TRANSFERS sync batch runner — operator utility only.
 *
 * Executes a small, explicitly bounded batch of *forward* (ascending) TRANSFERS
 * sync windows that extend an existing wallet's live `SyncCursor` upward, one
 * window at a time. It does not execute the sync pipeline itself: it POSTs to
 * the running server's existing `/api/sync/manual` route (the already-reviewed
 * accounting entry point) and reads Postgres directly only to plan windows,
 * gate invariants, and verify outcomes.
 *
 * This is NOT the campaign runner (`scripts/wallet-forward-campaign-runner.ts`,
 * which composes the same tested primitives below for a much larger, checkpointed,
 * independently-bounded campaign) and NOT the older backward campaign runner
 * (`scripts/transfer-backfill-runner.ts`), which plans a large *descending*
 * historical-recovery campaign from hardcoded campaign constants for a
 * different wallet. This runner:
 *   - never repurposes or imports campaign constants from that runner,
 *   - requires the wallet, chain, cursor, first-window start, and policy
 *     label prefix as explicit CLI arguments (nothing is inferred),
 *   - only ever extends the cursor's `toBlock` forward, keeping `fromBlock`
 *     anchored,
 *   - never submits a rebuild, materialization, or pricing request — no such
 *     code path exists in this file,
 *   - is hard-capped at 5 windows per invocation.
 *
 * The safety-critical gates, request builder, terminal-state/cursor
 * verification, duplicate/contamination checks, evidence primitives, and
 * env/wallet-lookup helpers live in
 * `scripts/lib/wallet-forward-sync-primitives.ts` and are imported here
 * unchanged — this file adds only its own CLI contract (5-window hard cap,
 * `<prefix>-<n>` policy labels, invocation-local window numbering) and
 * orchestration loop on top of them.
 *
 * Safety defaults:
 *   - Dry-run unless --execute is passed.
 *   - --max-windows defaults to 1 and is hard-capped at 5.
 *   - --window-size is hard-capped at 1001 inclusive blocks (consistent with
 *     MANUAL_SYNC_MAX_BLOCK_SPAN in src/services/api/validation.ts).
 *   - --chain-id must be 369 (PulseChain); every other chain, including 8453
 *     (Base), is rejected before any planning happens.
 *   - Every invariant violation is a hard stop; nothing is auto-retried and
 *     execution never continues past a failed window.
 *   - --recovery-only (requires --recovery-mode/--recovery-of-run-id) bounds
 *     the entire invocation to exactly one recovery action: it never plans or
 *     submits an ordinary forward window afterward, regardless of
 *     --max-windows.
 *
 * Usage (dry-run, the safe default):
 *   npx tsx --conditions react-server scripts/wallet-forward-sync-runner.ts \
 *     --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
 *     --chain-id 369 \
 *     --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
 *     --first-window-start 25078549 --window-size 1000 \
 *     --max-windows 5 --policy-label-prefix wallet-forward-sync-window
 *
 * Usage (execute exactly one window):
 *   npx tsx --conditions react-server scripts/wallet-forward-sync-runner.ts \
 *     --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
 *     --chain-id 369 \
 *     --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
 *     --first-window-start 25078549 --window-size 1000 \
 *     --max-windows 1 --policy-label-prefix wallet-forward-sync-window \
 *     --execute
 *
 * Usage (recovery-only: recover exactly one eligible prior benign-warning
 * window and stop — never plans or submits an ordinary forward window):
 *   npx tsx --conditions react-server scripts/wallet-forward-sync-runner.ts \
 *     --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
 *     --chain-id 369 \
 *     --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
 *     --first-window-start 25078549 --window-size 1000 \
 *     --max-windows 1 --policy-label-prefix wallet-forward-sync-window \
 *     --recovery-mode --recovery-of-run-id <SyncRun id> --recovery-only \
 *     [--execute]
 *
 * See docs/wallet-scoped-historical-sync-runbook.md for the full operator
 * runbook and required contamination pre/post-checks.
 *
 * Required environment variables:
 *   DATABASE_URL  PostgreSQL connection string (direct read-only planning
 *                 queries; all mutations happen through the HTTP route)
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * The --conditions react-server flag is required because imported service
 * modules use the server-only guard, which is a no-op only under that export
 * condition.
 *
 * Exit behaviour:
 *   - Exits 0 whenever the runner reaches a clean stop (including dry-run
 *     completion and "max windows reached") and prints a JSON summary to
 *     stdout.
 *   - Exits 1 on invalid arguments, missing environment, or any invariant
 *     failure encountered while executing.
 *   - Never prints DATABASE_URL, REDIS_URL, RPC URLs, secrets, or headers.
 */

import { fileURLToPath } from "url";

import {
  SUPPORTED_CHAIN_ID,
  WALLET_FORWARD_SYNC_SOURCE_FAMILIES,
  WINDOW_SIZE_HARD_CAP_BLOCKS,
  MIN_WINDOW_SIZE_BLOCKS,
  type WindowPlan,
  computeNextWindowRange,
  type GateResult,
  validateSupportedChain,
  validateWindowSize,
  validateExpectedLiveCursor,
  validateFirstWindowStart,
  validateForwardAdjacency,
  validateNoActiveOperation,
  validateNoPolicyLabelCollision,
  validatePolicyLabelLength,
  buildManualSyncRequestBody,
  type RunnerSyncRunRecord,
  verifyWindowTerminalState,
  verifyForwardCursorPostcondition,
  buildPostRunFailureReasons,
  checkEnv,
  type EnvCheckResult,
  type EvidenceRecord,
  serializeEvidence,
  writeEvidenceLine,
  buildStopEvidenceRecord,
  sanitizeBackendResponseBody,
  type RunnerDbClient,
  getLiveTransfersCursor,
  listActivePolicyLabels,
  countActiveOperations,
  checkFabricatedContamination,
  checkDuplicateRawTransactions,
  checkDuplicateRawTokenTransfers,
  checkDuplicateLedgerEntries,
  type HttpResponse,
  type HttpPost,
  type HttpGet,
  readHttpResponseBody,
  checkServerHealth,
  pollSyncRunToTerminal,
  type WalletLookupClient,
  resolveWalletUsingPrismaClient,
  safeStringify,
  type RecoveryCliOptions,
  type RecoveryGateResult,
  parseRecoveryFlags,
  verifyRecoveryEligibility,
  verifyRecoveryWindowTerminalState,
  recoveryPolicyLabel,
} from "./lib/wallet-forward-sync-primitives";

// Re-exported so existing imports/tests of this file keep working unchanged.
export {
  SUPPORTED_CHAIN_ID,
  WALLET_FORWARD_SYNC_SOURCE_FAMILIES,
  WINDOW_SIZE_HARD_CAP_BLOCKS,
  MIN_WINDOW_SIZE_BLOCKS,
  validateSupportedChain,
  validateWindowSize,
  validateExpectedLiveCursor,
  validateFirstWindowStart,
  validateForwardAdjacency,
  validateNoActiveOperation,
  validateNoPolicyLabelCollision,
  validatePolicyLabelLength,
  buildManualSyncRequestBody,
  verifyWindowTerminalState,
  verifyForwardCursorPostcondition,
  buildPostRunFailureReasons,
  checkEnv,
  serializeEvidence,
  writeEvidenceLine,
  sanitizeBackendResponseBody,
  getLiveTransfersCursor,
  listActivePolicyLabels,
  countActiveOperations,
  checkFabricatedContamination,
  checkDuplicateRawTransactions,
  checkDuplicateRawTokenTransfers,
  checkDuplicateLedgerEntries,
  readHttpResponseBody,
  checkServerHealth,
  pollSyncRunToTerminal,
  resolveWalletUsingPrismaClient,
  parseRecoveryFlags,
  verifyRecoveryEligibility,
  verifyRecoveryWindowTerminalState,
  recoveryPolicyLabel,
};
export type {
  WindowPlan,
  GateResult,
  RunnerSyncRunRecord,
  EnvCheckResult,
  EvidenceRecord,
  RunnerDbClient,
  HttpResponse,
  HttpPost,
  HttpGet,
  WalletLookupClient,
  RecoveryCliOptions,
  RecoveryGateResult,
};

// ─── Runner-specific safety constants (not operator-overridable) ──────────────

export const MAX_WINDOWS_HARD_CAP = 5;
export const DEFAULT_MAX_WINDOWS = 1;

// ─── Runner-specific window planning (pure) ────────────────────────────────────

export function policyLabelForBatchWindow(prefix: string, windowNumber: number): string {
  return `${prefix}-${windowNumber}`;
}

/**
 * Computes the next forward window from the current cursor's upper edge.
 * `windowNumber` is 1-based within this single invocation's batch, not a
 * campaign-wide count — this runner has no notion of a total campaign size.
 */
export function computeForwardWindowPlan(args: {
  liveCursorToBlock: bigint;
  windowSizeBlocks: bigint;
  windowNumber: number;
  policyLabelPrefix: string;
}): WindowPlan {
  const range = computeNextWindowRange({
    liveCursorToBlock: args.liveCursorToBlock,
    windowSizeBlocks: args.windowSizeBlocks,
  });
  return {
    windowNumber: args.windowNumber,
    startBlock: range.startBlock,
    endBlock: range.endBlock,
    policyLabel: policyLabelForBatchWindow(args.policyLabelPrefix, args.windowNumber),
    blockCount: range.blockCount,
  };
}

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type RunnerCliOptions = {
  execute: boolean;
  walletAddress: string;
  chainId: number;
  expectedCursorFromBlock: bigint;
  expectedCursorToBlock: bigint;
  firstWindowStart: bigint;
  windowSizeBlocks: bigint;
  maxWindows: number;
  policyLabelPrefix: string;
  baseUrl: string;
  evidenceFile: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  /**
   * Explicit, opt-in recovery of exactly one prior benign-warning window.
   * Undefined (the default) means normal behavior is byte-for-byte
   * unchanged from before this option existed. When set, --first-window-start
   * and --window-size define the exact [start,end] window being recovered
   * (not a live-cursor-derived forward window), and --expected-cursor-to
   * must already equal that window's endBlock — recovery only ever targets
   * the current cursor frontier, never an arbitrary historical window.
   */
  recovery?: RecoveryCliOptions;
  /**
   * Explicit, opt-in bounded-recovery-execution mode. Requires --recovery-mode
   * (and therefore --recovery-of-run-id) to also be set — false (the default)
   * means normal behavior, including ordinary recovery-then-forward-window
   * behavior, is byte-for-byte unchanged from before this option existed.
   * When true, the runner performs exactly the one recovery action described
   * by `recovery` above and then returns — it never enters the ordinary
   * forward-window loop, regardless of --max-windows.
   */
  recoveryOnly: boolean;
};

export type RunnerCliParseResult =
  | { ok: true; options: RunnerCliOptions }
  | { ok: false; error: string };

export const RUNNER_CLI_USAGE = [
  "Usage: wallet-forward-sync-runner --wallet-address <0x..> --chain-id <n>",
  "         --expected-cursor-from <blockNumber> --expected-cursor-to <blockNumber>",
  "         --first-window-start <blockNumber> --window-size <blocks>",
  "         --policy-label-prefix <label> [--max-windows <1-5>] [--execute]",
  "         [--base-url <url>] [--evidence-file <path>]",
  "         [--poll-interval-ms <n>] [--poll-timeout-ms <n>]",
  "         [--recovery-mode --recovery-of-run-id <SyncRun id> [--recovery-only]]",
  "",
  "  Dry-run is the default and never submits an HTTP POST.",
  "  --max-windows defaults to 1 and is hard-capped at 5.",
  "  --window-size is hard-capped at 1001 inclusive blocks.",
  "  --wallet-address, --chain-id, --expected-cursor-from,",
  "  --expected-cursor-to, --first-window-start, --window-size, and",
  "  --policy-label-prefix are all required — nothing is inferred.",
  "  --recovery-mode and --recovery-of-run-id must be passed together or",
  "  not at all. Recovery targets exactly the window [--first-window-start,",
  "  --first-window-start + --window-size - 1], which --expected-cursor-to",
  "  must already equal (the current cursor frontier).",
  "  --recovery-only requires --recovery-mode (and therefore",
  "  --recovery-of-run-id). When set, the runner performs exactly the one",
  "  recovery action and stops — it never plans or submits an ordinary",
  "  forward window, regardless of --max-windows.",
].join("\n");

const DEFAULT_BASE_URL = process.env.OPERATOR_RUNNER_BASE_URL ?? "http://localhost:3000";
const DEFAULT_EVIDENCE_FILE = "operator-evidence/wallet-forward-sync-batch-runner/evidence.jsonl";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000;

function readValue(argv: readonly string[], index: number): string | null {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return null;
  }
  return value;
}

export function parseRunnerCliArgs(argv: readonly string[]): RunnerCliParseResult {
  let execute = false;
  let walletAddress: string | undefined;
  let chainId: number | undefined;
  let expectedCursorFromBlock: bigint | undefined;
  let expectedCursorToBlock: bigint | undefined;
  let firstWindowStart: bigint | undefined;
  let windowSizeBlocks: bigint | undefined;
  let maxWindows = DEFAULT_MAX_WINDOWS;
  let policyLabelPrefix: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let evidenceFile = DEFAULT_EVIDENCE_FILE;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;
  let recoveryMode = false;
  let recoveryOfRunId: string | null = null;
  let recoveryOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      execute = true;
      continue;
    }
    if (arg === "--recovery-mode") {
      recoveryMode = true;
      continue;
    }
    if (arg === "--recovery-only") {
      recoveryOnly = true;
      continue;
    }
    if (arg === "--recovery-of-run-id") {
      const value = readValue(argv, index);
      if (value === null || value.trim().length === 0) {
        return { ok: false, error: "--recovery-of-run-id requires a non-empty value." };
      }
      recoveryOfRunId = value;
      index += 1;
      continue;
    }
    if (arg === "--wallet-address") {
      const value = readValue(argv, index);
      if (value === null || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return { ok: false, error: "--wallet-address must be a valid EVM address." };
      }
      walletAddress = value.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--chain-id") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--chain-id must be an unsigned integer." };
      }
      chainId = Number(value);
      index += 1;
      continue;
    }
    if (arg === "--expected-cursor-from") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--expected-cursor-from must be an unsigned integer." };
      }
      expectedCursorFromBlock = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--expected-cursor-to") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--expected-cursor-to must be an unsigned integer." };
      }
      expectedCursorToBlock = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--first-window-start") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--first-window-start must be an unsigned integer." };
      }
      firstWindowStart = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--window-size") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value) || value === "0") {
        return { ok: false, error: "--window-size must be a positive integer." };
      }
      windowSizeBlocks = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--max-windows") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--max-windows requires a value." };
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_WINDOWS_HARD_CAP) {
        return {
          ok: false,
          error: `--max-windows must be an integer between 1 and ${MAX_WINDOWS_HARD_CAP}.`,
        };
      }
      maxWindows = parsed;
      index += 1;
      continue;
    }
    if (arg === "--policy-label-prefix") {
      const value = readValue(argv, index);
      if (value === null || value.trim().length === 0) {
        return { ok: false, error: "--policy-label-prefix must be a non-empty string." };
      }
      policyLabelPrefix = value;
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--base-url requires a value." };
      baseUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--evidence-file") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--evidence-file requires a value." };
      evidenceFile = value;
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value) || Number(value) <= 0) {
        return { ok: false, error: "--poll-interval-ms must be a positive integer." };
      }
      pollIntervalMs = Number(value);
      index += 1;
      continue;
    }
    if (arg === "--poll-timeout-ms") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value) || Number(value) <= 0) {
        return { ok: false, error: "--poll-timeout-ms must be a positive integer." };
      }
      pollTimeoutMs = Number(value);
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (walletAddress === undefined) return { ok: false, error: "--wallet-address is required." };
  if (chainId === undefined) return { ok: false, error: "--chain-id is required." };
  if (expectedCursorFromBlock === undefined) {
    return { ok: false, error: "--expected-cursor-from is required." };
  }
  if (expectedCursorToBlock === undefined) {
    return { ok: false, error: "--expected-cursor-to is required." };
  }
  if (firstWindowStart === undefined) return { ok: false, error: "--first-window-start is required." };
  if (windowSizeBlocks === undefined) return { ok: false, error: "--window-size is required." };
  if (policyLabelPrefix === undefined) {
    return { ok: false, error: "--policy-label-prefix is required." };
  }

  const chainGate = validateSupportedChain({ chainId });
  if (!chainGate.ok) return { ok: false, error: chainGate.reason };

  const windowSizeGate = validateWindowSize({ windowSizeBlocks });
  if (!windowSizeGate.ok) return { ok: false, error: windowSizeGate.reason };

  const recoveryFlags = parseRecoveryFlags({ recoveryMode, recoveryOfRunId });
  if (!recoveryFlags.ok) return { ok: false, error: recoveryFlags.error };

  if (recoveryOnly && !recoveryMode) {
    return { ok: false, error: "--recovery-only requires --recovery-mode (and --recovery-of-run-id)." };
  }

  return {
    ok: true,
    options: {
      execute,
      walletAddress,
      chainId,
      expectedCursorFromBlock,
      expectedCursorToBlock,
      firstWindowStart,
      windowSizeBlocks,
      maxWindows,
      policyLabelPrefix,
      baseUrl,
      evidenceFile,
      pollIntervalMs,
      pollTimeoutMs,
      recovery: recoveryFlags.recovery,
      recoveryOnly,
    },
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export type RunnerDeps = {
  db: RunnerDbClient;
  resolveWallet: (args: { walletAddress: string; chainId: number }) => Promise<{ id: string; address: string } | null>;
  httpGet: HttpGet;
  httpPost: HttpPost;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  writeEvidence: (record: EvidenceRecord) => Promise<void>;
};

export type RunnerSummary = {
  stoppedReason: string;
  detail?: string;
  windowsCompleted: number;
  lastWindowNumber: number | null;
  /** Present only when --recovery-mode/--recovery-of-run-id were passed —
   * absent on every ordinary invocation. Never fabricated: `recovered` is
   * true only when the recovery window's own post-run gates all passed. */
  recovery?: {
    sourceRunId: string;
    window: { startBlock: string; endBlock: string };
    eligible: boolean;
    recovered: boolean;
    reason?: string;
  };
};

export async function runWalletForwardSyncRunner(
  options: RunnerCliOptions,
  deps: RunnerDeps,
): Promise<RunnerSummary> {
  await deps.writeEvidence({
    kind: "preflight",
    at: deps.now().toISOString(),
    mode: options.execute ? "execute" : "dry-run",
    walletAddress: options.walletAddress,
    chainId: options.chainId,
    expectedCursor: {
      fromBlock: options.expectedCursorFromBlock.toString(),
      toBlock: options.expectedCursorToBlock.toString(),
    },
    firstWindowStart: options.firstWindowStart.toString(),
    windowSizeBlocks: options.windowSizeBlocks.toString(),
    maxWindows: options.maxWindows,
    policyLabelPrefix: options.policyLabelPrefix,
  });

  const wallet = await deps.resolveWallet({
    walletAddress: options.walletAddress,
    chainId: options.chainId,
  });
  if (!wallet) {
    return stop(deps, "wallet_not_found", undefined, 0, null);
  }

  let windowsCompleted = 0;
  let lastWindowNumber: number | null = null;
  let recoverySummary: RunnerSummary["recovery"];
  // Reused as the ordinary loop's expected first-window start below. Left at
  // options.firstWindowStart for a normal invocation; advanced to exactly
  // one window past the recovered range when recovery mode ran, so the
  // ordinary loop's own (unchanged) first-window gate compares against the
  // right value instead of the CLI value that named the *recovery* window.
  let effectiveFirstWindowStart = options.firstWindowStart;

  // ── Explicit recovery mode (PR B): a single bounded pre-loop step that
  // resubmits exactly one prior benign-warning window, then falls through
  // to the ordinary forward loop below with fully unchanged, strict
  // behavior. Skipped entirely — byte-for-byte — when options.recovery is
  // undefined (the default). ──
  if (options.recovery) {
    const recoveryStart = options.firstWindowStart;
    const recoveryEnd = options.firstWindowStart + options.windowSizeBlocks - 1n;
    effectiveFirstWindowStart = recoveryEnd + 1n;
    recoverySummary = {
      sourceRunId: options.recovery.sourceRunId,
      window: { startBlock: recoveryStart.toString(), endBlock: recoveryEnd.toString() },
      eligible: false,
      recovered: false,
    };

    // Recovery only ever targets the current cursor frontier — never a
    // historical window with newer windows already built on top of it.
    if (options.expectedCursorToBlock !== recoveryEnd) {
      recoverySummary.reason = `--expected-cursor-to ${options.expectedCursorToBlock} must equal the recovery window's endBlock ${recoveryEnd}`;
      return stop(
        deps,
        "recovery_window_not_at_cursor_frontier",
        recoverySummary.reason,
        0,
        null,
        undefined,
        recoverySummary,
      );
    }

    const liveCursor = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
    const cursorGate = validateExpectedLiveCursor({
      liveCursor,
      expectedCursorFromBlock: options.expectedCursorFromBlock,
      expectedCursorToBlock: options.expectedCursorToBlock,
    });
    if (!cursorGate.ok) {
      recoverySummary.reason = cursorGate.reason;
      return stop(deps, "cursor_expectation_mismatch", cursorGate.reason, 0, null, undefined, recoverySummary);
    }

    const sourceRun = await deps.db.syncRun.findUnique({ where: { id: options.recovery.sourceRunId } });
    const eligibility = verifyRecoveryEligibility({
      run: sourceRun,
      expectedRunId: options.recovery.sourceRunId,
      expectedWalletId: wallet.id,
      expectedChainId: options.chainId,
      expectedStartBlock: recoveryStart,
      expectedEndBlock: recoveryEnd,
    });
    if (!eligibility.ok) {
      recoverySummary.reason = eligibility.reason;
      return stop(
        deps,
        "recovery_source_run_ineligible",
        eligibility.reason,
        0,
        null,
        { sourceRunId: options.recovery.sourceRunId },
        recoverySummary,
      );
    }
    recoverySummary.eligible = true;

    const recoveryLabel = recoveryPolicyLabel(options.policyLabelPrefix, options.recovery.sourceRunId);

    const labelLenGate = validatePolicyLabelLength({ policyLabel: recoveryLabel });
    if (!labelLenGate.ok) {
      recoverySummary.reason = labelLenGate.reason;
      return stop(deps, "policy_label_overlong", labelLenGate.reason, 0, null, undefined, recoverySummary);
    }

    const labelGate = validateNoPolicyLabelCollision({
      policyLabel: recoveryLabel,
      existingPolicyLabels: await listActivePolicyLabels(deps.db, options.chainId),
    });
    if (!labelGate.ok) {
      recoverySummary.reason = labelGate.reason;
      return stop(deps, "policy_label_collision", labelGate.reason, 0, null, undefined, recoverySummary);
    }

    const activeOpGate = validateNoActiveOperation({ activeRunCount: await countActiveOperations(deps.db) });
    if (!activeOpGate.ok) {
      recoverySummary.reason = activeOpGate.reason;
      return stop(deps, "active_operation_conflict", activeOpGate.reason, 0, null, undefined, recoverySummary);
    }

    const healthGate = await checkServerHealth(deps.httpGet, options.baseUrl);
    if (!healthGate.ok) {
      recoverySummary.reason = healthGate.reason;
      return stop(deps, "server_unhealthy", healthGate.reason, 0, null, undefined, recoverySummary);
    }

    const preContamination = await checkFabricatedContamination(deps.db, {
      chainId: options.chainId,
      walletAddress: options.walletAddress,
      startBlock: recoveryStart,
      endBlock: recoveryEnd,
    });
    if (preContamination.rowCount > 0) {
      recoverySummary.reason = `${preContamination.rowCount} contaminated row(s) detected in the recovery range; do not submit`;
      return stop(
        deps,
        "fabricated_contamination_pre_gate",
        recoverySummary.reason,
        0,
        null,
        undefined,
        recoverySummary,
      );
    }

    if (!options.execute) {
      await deps.writeEvidence({
        kind: "recovery_window",
        at: deps.now().toISOString(),
        outcome: "dry_run_planned",
        sourceRunId: options.recovery.sourceRunId,
        policyLabel: recoveryLabel,
        range: { startBlock: recoveryStart.toString(), endBlock: recoveryEnd.toString() },
      });
      // Dry-run never mutates canonical state; report eligibility proven
      // but not actually recovered.
    } else {
      const submittedAt = deps.now().toISOString();
      const requestBody = buildManualSyncRequestBody({
        walletAddress: options.walletAddress,
        chainId: options.chainId,
        window: { startBlock: recoveryStart, endBlock: recoveryEnd, policyLabel: recoveryLabel },
      });
      const postResponse = await deps.httpPost(`${options.baseUrl}/api/sync/manual`, requestBody);
      const runId = (postResponse.body as { data?: { runId?: string } } | undefined)?.data?.runId;
      if (postResponse.status !== 202 || !runId) {
        recoverySummary.reason = `POST /api/sync/manual returned status ${postResponse.status}`;
        return stop(
          deps,
          "recovery_manual_sync_submit_failed",
          recoverySummary.reason,
          0,
          null,
          {
            sourceRunId: options.recovery.sourceRunId,
            policyLabel: recoveryLabel,
            submittedAt,
            httpStatus: postResponse.status,
            responseBody: sanitizeBackendResponseBody(postResponse.body),
          },
          recoverySummary,
        );
      }

      const polled = await pollSyncRunToTerminal(deps.db, runId, {
        now: deps.now,
        sleep: deps.sleep,
        pollIntervalMs: options.pollIntervalMs,
        pollTimeoutMs: options.pollTimeoutMs,
      });
      if (!polled.ok) {
        recoverySummary.reason = `SyncRun ${runId} did not reach a terminal state within ${options.pollTimeoutMs}ms`;
        return stop(
          deps,
          "recovery_poll_timeout",
          recoverySummary.reason,
          0,
          null,
          { sourceRunId: options.recovery.sourceRunId, policyLabel: recoveryLabel, runId, submittedAt },
          recoverySummary,
        );
      }
      const terminalAt = deps.now().toISOString();

      const terminalVerification = verifyRecoveryWindowTerminalState({
        run: polled.run,
        expectedWalletId: wallet.id,
        expectedChainId: options.chainId,
        expectedPolicyLabel: recoveryLabel,
        expectedStartBlock: recoveryStart,
        expectedEndBlock: recoveryEnd,
      });

      const cursorAfterRecord = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
      const cursorGatePost = terminalVerification.ok
        ? verifyForwardCursorPostcondition({
            cursorAfter: cursorAfterRecord,
            anchorFromBlock: options.expectedCursorFromBlock,
            expectedToBlock: recoveryEnd,
          })
        : ({ ok: false, reason: "skipped: terminal state already failed" } as const);

      const postContamination = await checkFabricatedContamination(deps.db, {
        chainId: options.chainId,
        walletAddress: options.walletAddress,
        startBlock: recoveryStart,
        endBlock: recoveryEnd,
      });
      const duplicateTransactions = await checkDuplicateRawTransactions(deps.db, {
        chainId: options.chainId,
        startBlock: recoveryStart,
        endBlock: recoveryEnd,
      });
      const duplicateTransfers = await checkDuplicateRawTokenTransfers(deps.db, {
        chainId: options.chainId,
        startBlock: recoveryStart,
        endBlock: recoveryEnd,
      });
      const duplicateLedgerEntries = await checkDuplicateLedgerEntries(deps.db, {
        startBlock: recoveryStart,
        endBlock: recoveryEnd,
      });
      const activeAfterCount = await countActiveOperations(deps.db);

      const postRunFailureReasons = buildPostRunFailureReasons({
        terminalVerification,
        cursorGatePost,
        postContaminationRowCount: postContamination.rowCount,
        duplicateRawTransactionGroups: duplicateTransactions.rowCount,
        duplicateRawTokenTransferGroups: duplicateTransfers.rowCount,
        duplicateLedgerEntryGroups: duplicateLedgerEntries.rowCount,
        activeOperationsAfter: activeAfterCount,
      });
      const allOk = postRunFailureReasons.length === 0;

      await deps.writeEvidence({
        kind: "recovery_window",
        at: terminalAt,
        outcome: allOk ? "recovered" : "failed_invariant",
        sourceRunId: options.recovery.sourceRunId,
        policyLabel: recoveryLabel,
        runId,
        expectedRange: { startBlock: recoveryStart.toString(), endBlock: recoveryEnd.toString() },
        actualRange: {
          startBlock: polled.run.startBlock?.toString() ?? null,
          endBlock: polled.run.endBlock?.toString() ?? null,
        },
        submittedAt,
        terminalAt,
        terminalStatus: polled.run.status,
        warningCount: polled.run.warningCount,
        warningDetails: polled.run.warningDetails,
        invariantFailures: postRunFailureReasons,
      });

      if (!allOk) {
        recoverySummary.reason = postRunFailureReasons.join("; ");
        return stop(
          deps,
          "recovery_invariant_failed_after_run",
          recoverySummary.reason,
          0,
          null,
          { sourceRunId: options.recovery.sourceRunId, policyLabel: recoveryLabel, runId },
          recoverySummary,
        );
      }

      recoverySummary.recovered = true;
    }

    // ── Recovery-only bounded exit: the recovery action above is the entire
    // authorized operation. Stop here — never plan or submit an ordinary
    // forward window, regardless of --max-windows. Only reached when the
    // recovery step itself did not already hard-stop (every eligibility/
    // invariant failure above returns earlier with its own reason and exit
    // code, unaffected by this flag). ──
    if (options.recoveryOnly) {
      await deps.writeEvidence({
        kind: "summary",
        at: deps.now().toISOString(),
        stoppedReason: "recovery_only_completed",
        windowsCompleted: 0,
        lastWindowNumber: null,
        recovery: recoverySummary,
      });
      return {
        stoppedReason: "recovery_only_completed",
        windowsCompleted: 0,
        lastWindowNumber: null,
        recovery: recoverySummary,
      };
    }
  }

  // Dry-run only: in-memory simulated cursor upper edge so --max-windows N
  // previews N distinct sequential windows. Never consulted in execute
  // mode — execute planning always uses the live persisted cursor.
  let simulatedCursorToBlock: bigint | null = null;

  // The live cursor's [fromBlock, toBlock] is validated against this
  // expectation before every submission (not just the first), so unexpected
  // cursor movement between windows — another process, a manual edit, a
  // concurrent operation — stops the batch before the next POST. The anchor
  // (fromBlock) never changes across a forward batch; toBlock is advanced
  // only after a window passes every post-run gate, to the exact value this
  // runner itself just verified.
  let expectedCursorToBlock = options.expectedCursorToBlock;

  for (let iteration = 0; iteration < options.maxWindows; iteration += 1) {
    const windowNumber = iteration + 1;

    const cursor = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);

    const cursorGate = validateExpectedLiveCursor({
      liveCursor: cursor,
      expectedCursorFromBlock: options.expectedCursorFromBlock,
      expectedCursorToBlock,
    });
    if (!cursorGate.ok) {
      return stop(deps, "cursor_expectation_mismatch", cursorGate.reason, windowsCompleted, lastWindowNumber);
    }

    const planningToBlock =
      !options.execute && simulatedCursorToBlock !== null ? simulatedCursorToBlock : cursor!.toBlock;

    const plan = computeForwardWindowPlan({
      liveCursorToBlock: planningToBlock,
      windowSizeBlocks: options.windowSizeBlocks,
      windowNumber,
      policyLabelPrefix: options.policyLabelPrefix,
    });

    if (windowNumber === 1) {
      const firstWindowGate = validateFirstWindowStart({
        computedStartBlock: plan.startBlock,
        expectedFirstWindowStart: effectiveFirstWindowStart,
      });
      if (!firstWindowGate.ok) {
        return stop(deps, "first_window_start_mismatch", firstWindowGate.reason, windowsCompleted, lastWindowNumber);
      }
    }

    const adjacencyGate = validateForwardAdjacency({
      liveCursorToBlock: planningToBlock,
      proposedStartBlock: plan.startBlock,
    });
    if (!adjacencyGate.ok) {
      return stop(deps, "adjacency_violation", adjacencyGate.reason, windowsCompleted, lastWindowNumber);
    }

    const activeRunCount = await countActiveOperations(deps.db);
    const activeOpGate = validateNoActiveOperation({ activeRunCount });
    if (!activeOpGate.ok) {
      return stop(deps, "active_operation_conflict", activeOpGate.reason, windowsCompleted, lastWindowNumber);
    }

    const existingLabels = await listActivePolicyLabels(deps.db, options.chainId);
    const labelGate = validateNoPolicyLabelCollision({
      policyLabel: plan.policyLabel,
      existingPolicyLabels: existingLabels,
    });
    if (!labelGate.ok) {
      return stop(deps, "policy_label_collision", labelGate.reason, windowsCompleted, lastWindowNumber);
    }

    const healthGate = await checkServerHealth(deps.httpGet, options.baseUrl);
    if (!healthGate.ok) {
      return stop(deps, "server_unhealthy", healthGate.reason, windowsCompleted, lastWindowNumber);
    }

    const preContamination = await checkFabricatedContamination(deps.db, {
      chainId: options.chainId,
      walletAddress: options.walletAddress,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    if (preContamination.rowCount > 0) {
      return stop(
        deps,
        "fabricated_contamination_pre_gate",
        `${preContamination.rowCount} contaminated row(s) detected in the proposed range; do not submit`,
        windowsCompleted,
        lastWindowNumber,
      );
    }

    if (!options.execute) {
      await deps.writeEvidence({
        kind: "window",
        at: deps.now().toISOString(),
        outcome: "dry_run_planned",
        windowNumber: plan.windowNumber,
        policyLabel: plan.policyLabel,
        proposedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
        cursorBefore: cursor
          ? { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() }
          : null,
      });
      lastWindowNumber = plan.windowNumber;
      simulatedCursorToBlock = plan.endBlock;
      continue;
    }

    // ── Execute: submit exactly one manual sync request ──
    const submittedAt = deps.now().toISOString();
    const requestBody = buildManualSyncRequestBody({
      walletAddress: options.walletAddress,
      chainId: options.chainId,
      window: plan,
    });
    const postResponse = await deps.httpPost(`${options.baseUrl}/api/sync/manual`, requestBody);
    const runId = (postResponse.body as { data?: { runId?: string } } | undefined)?.data?.runId;
    if (postResponse.status !== 202 || !runId) {
      // Preserve the sanitized backend response body (operation-conflict and
      // validation error envelopes carry a `code`/`details` the operator
      // needs) without ever leaking secrets or letting a malformed/missing
      // body mask the primary HTTP-status failure.
      return stop(
        deps,
        "manual_sync_submit_failed",
        `POST /api/sync/manual returned status ${postResponse.status}`,
        windowsCompleted,
        lastWindowNumber,
        {
          windowNumber: plan.windowNumber,
          policyLabel: plan.policyLabel,
          submittedAt,
          httpStatus: postResponse.status,
          responseBody: sanitizeBackendResponseBody(postResponse.body),
        },
      );
    }

    const polled = await pollSyncRunToTerminal(deps.db, runId, {
      now: deps.now,
      sleep: deps.sleep,
      pollIntervalMs: options.pollIntervalMs,
      pollTimeoutMs: options.pollTimeoutMs,
    });
    if (!polled.ok) {
      return stop(
        deps,
        "poll_timeout",
        `SyncRun ${runId} did not reach a terminal state within ${options.pollTimeoutMs}ms`,
        windowsCompleted,
        lastWindowNumber,
        { windowNumber: plan.windowNumber, policyLabel: plan.policyLabel, runId, submittedAt },
      );
    }
    const terminalAt = deps.now().toISOString();

    const terminalVerification = verifyWindowTerminalState({
      run: polled.run,
      expectedWalletId: wallet.id,
      expectedChainId: options.chainId,
      expectedPolicyLabel: plan.policyLabel,
      expectedStartBlock: plan.startBlock,
      expectedEndBlock: plan.endBlock,
    });

    const cursorAfterRecord = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
    const cursorGatePost = terminalVerification.ok
      ? verifyForwardCursorPostcondition({
          cursorAfter: cursorAfterRecord,
          anchorFromBlock: options.expectedCursorFromBlock,
          expectedToBlock: plan.endBlock,
        })
      : ({ ok: false, reason: "skipped: terminal state already failed" } as const);

    const postContamination = await checkFabricatedContamination(deps.db, {
      chainId: options.chainId,
      walletAddress: options.walletAddress,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const duplicateTransactions = await checkDuplicateRawTransactions(deps.db, {
      chainId: options.chainId,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const duplicateTransfers = await checkDuplicateRawTokenTransfers(deps.db, {
      chainId: options.chainId,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const duplicateLedgerEntries = await checkDuplicateLedgerEntries(deps.db, {
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const activeAfterCount = await countActiveOperations(deps.db);

    const postRunFailureReasons = buildPostRunFailureReasons({
      terminalVerification,
      cursorGatePost,
      postContaminationRowCount: postContamination.rowCount,
      duplicateRawTransactionGroups: duplicateTransactions.rowCount,
      duplicateRawTokenTransferGroups: duplicateTransfers.rowCount,
      duplicateLedgerEntryGroups: duplicateLedgerEntries.rowCount,
      activeOperationsAfter: activeAfterCount,
    });
    const allOk = postRunFailureReasons.length === 0;

    await deps.writeEvidence({
      kind: "window",
      at: terminalAt,
      outcome: allOk ? "completed" : "failed_invariant",
      windowNumber: plan.windowNumber,
      policyLabel: plan.policyLabel,
      runId,
      expectedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
      actualRange: {
        startBlock: polled.run.startBlock?.toString() ?? null,
        endBlock: polled.run.endBlock?.toString() ?? null,
      },
      submittedAt,
      terminalAt,
      terminalStatus: polled.run.status,
      warningCount: polled.run.warningCount,
      warningDetails: polled.run.warningDetails,
      errorMessage: polled.run.errorMessage,
      cursorBefore: cursor
        ? { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() }
        : null,
      cursorAfter: cursorAfterRecord
        ? { fromBlock: cursorAfterRecord.fromBlock.toString(), toBlock: cursorAfterRecord.toBlock.toString() }
        : null,
      contaminationPre: preContamination.rowCount,
      contaminationPost: postContamination.rowCount,
      duplicateRawTransactionGroups: duplicateTransactions.rowCount,
      duplicateRawTokenTransferGroups: duplicateTransfers.rowCount,
      duplicateLedgerEntryGroups: duplicateLedgerEntries.rowCount,
      activeOperationsAfter: activeAfterCount,
      invariantFailures: postRunFailureReasons,
    });

    if (!allOk) {
      // Route through stop() (in addition to the window record already
      // written above) so this — the most serious outcome — also emits a
      // dedicated kind: "stop" evidence record. Without this, an evidence
      // consumer filtering for kind === "stop" would miss it entirely, since
      // every other hard-stop path in this function goes through stop().
      return stop(
        deps,
        "invariant_failed_after_run",
        postRunFailureReasons.join("; "),
        windowsCompleted,
        plan.windowNumber,
        { windowNumber: plan.windowNumber, policyLabel: plan.policyLabel, runId },
      );
    }

    windowsCompleted += 1;
    lastWindowNumber = plan.windowNumber;
    // Only reached when every post-run gate passed: the verified live cursor
    // now sits at plan.endBlock, so that becomes the expectation the next
    // iteration's live read must match.
    expectedCursorToBlock = plan.endBlock;
  }

  await deps.writeEvidence({
    kind: "summary",
    at: deps.now().toISOString(),
    stoppedReason: "max_windows_reached",
    windowsCompleted,
    lastWindowNumber,
    recovery: recoverySummary,
  });

  return { stoppedReason: "max_windows_reached", windowsCompleted, lastWindowNumber, recovery: recoverySummary };
}

/**
 * Writes a "stop" evidence record and returns the stop summary. Delegates
 * the "extra spread first, identity fields win" invariant to
 * `buildStopEvidenceRecord` in the shared primitives module — a caller can
 * never override the record's `kind` to something other than `"stop"`.
 */
export async function stop(
  deps: RunnerDeps,
  reason: string,
  detail: string | undefined,
  windowsCompleted: number,
  lastWindowNumber: number | null,
  extra?: Record<string, unknown>,
  recovery?: RunnerSummary["recovery"],
): Promise<RunnerSummary> {
  await deps.writeEvidence(
    buildStopEvidenceRecord({ at: deps.now().toISOString(), reason, detail, extra }),
  );
  return { stoppedReason: reason, detail, windowsCompleted, lastWindowNumber, recovery };
}

// ─── Exit-code gate ─────────────────────────────────────────────────────────────

/**
 * The only stoppedReason values that represent genuine, non-error completion.
 * Every other reason — including any reason not in this set, whether it
 * exists in this file today or is added later — is treated as a hard stop
 * and exits nonzero. This is an explicit allowlist, not a suffix/pattern
 * match: adding a new stop reason to the orchestrator without adding it here
 * fails closed (exit 1) rather than silently succeeding.
 */
export const CLEAN_STOP_REASONS: ReadonlySet<string> = new Set([
  "max_windows_reached",
  "recovery_only_completed",
]);

export function computeExitCode(stoppedReason: string): 0 | 1 {
  return CLEAN_STOP_REASONS.has(stoppedReason) ? 0 : 1;
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseRunnerCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`wallet-forward-sync-runner: ${parsed.error}`);
    console.error(RUNNER_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `wallet-forward-sync-runner: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  // Deferred imports so argument/env validation always runs first and the
  // server-only service modules never load for an invalid invocation. Note:
  // the wallet lookup uses this same local `prisma` instance directly
  // (resolveWalletUsingPrismaClient) rather than a service function backed by
  // the module-global getDb() client, so the process has exactly one open
  // Prisma client to disconnect in the `finally` block below.
  const { PrismaClient } = await import("@prisma/client");
  const { createPrismaAdapter } = await import("@/lib/prisma-adapter");

  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

  const deps: RunnerDeps = {
    db: prisma as unknown as RunnerDbClient,
    resolveWallet: (args) => resolveWalletUsingPrismaClient(prisma as unknown as WalletLookupClient, args),
    httpGet: async (url) => {
      const res = await fetch(url);
      return { status: res.status, body: await readHttpResponseBody(res) };
    },
    httpPost: async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await readHttpResponseBody(res) };
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeEvidence: (record) => writeEvidenceLine(parsed.options.evidenceFile, record),
  };

  try {
    const summary = await runWalletForwardSyncRunner(parsed.options, deps);
    console.log(safeStringify(summary));
    process.exitCode = computeExitCode(summary.stoppedReason);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-sync-runner error: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-sync-runner error: ${message}`);
    process.exitCode = 1;
  });
}
