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
 * This is NOT the campaign runner (`scripts/transfer-backfill-runner.ts`),
 * which plans a large *descending* historical-recovery campaign from
 * hardcoded campaign constants for a different wallet. This runner:
 *   - never repurposes or imports campaign constants from that runner,
 *   - requires the wallet, chain, cursor, first-window start, and policy
 *     label prefix as explicit CLI arguments (nothing is inferred),
 *   - only ever extends the cursor's `toBlock` forward, keeping `fromBlock`
 *     anchored,
 *   - never submits a rebuild, materialization, or pricing request — no such
 *     code path exists in this file,
 *   - is hard-capped at 5 windows per invocation.
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
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

// ─── Fixed safety constants (not operator-overridable) ────────────────────────

/** PulseChain only — CoinPulse V1 execution target (D-009). No other chain,
 * including 8453 (Base), is accepted by this runner. */
export const SUPPORTED_CHAIN_ID = 369;

export const WALLET_FORWARD_SYNC_SOURCE_FAMILIES = ["TRANSFERS"] as const;

export const MAX_WINDOWS_HARD_CAP = 5;
export const DEFAULT_MAX_WINDOWS = 1;

/** Max inclusive blocks per window: mirrors MANUAL_SYNC_MAX_BLOCK_SPAN + 1
 * (src/services/api/validation.ts) — the schema caps endBlock - startBlock at
 * MANUAL_SYNC_MAX_BLOCK_SPAN, which permits at most that + 1 inclusive
 * blocks. */
export const WINDOW_SIZE_HARD_CAP_BLOCKS = 1_001n;
export const MIN_WINDOW_SIZE_BLOCKS = 1n;

// ─── Window planning (pure) ────────────────────────────────────────────────────

export type WindowPlan = {
  windowNumber: number;
  startBlock: bigint;
  endBlock: bigint;
  policyLabel: string;
  blockCount: bigint;
};

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
  const startBlock = args.liveCursorToBlock + 1n;
  const endBlock = startBlock + args.windowSizeBlocks - 1n;
  return {
    windowNumber: args.windowNumber,
    startBlock,
    endBlock,
    policyLabel: policyLabelForBatchWindow(args.policyLabelPrefix, args.windowNumber),
    blockCount: endBlock - startBlock + 1n,
  };
}

// ─── Pre-submit validation gates (pure) ────────────────────────────────────────

export type GateResult = { ok: true } | { ok: false; reason: string };

export function validateSupportedChain(args: { chainId: number }): GateResult {
  if (args.chainId !== SUPPORTED_CHAIN_ID) {
    return {
      ok: false,
      reason: `chainId must be ${SUPPORTED_CHAIN_ID} (PulseChain); got ${args.chainId}. This runner accepts no other chain, including 8453 (Base).`,
    };
  }
  return { ok: true };
}

export function validateWindowSize(args: { windowSizeBlocks: bigint }): GateResult {
  if (args.windowSizeBlocks < MIN_WINDOW_SIZE_BLOCKS) {
    return { ok: false, reason: `--window-size must be a positive integer, got ${args.windowSizeBlocks}` };
  }
  if (args.windowSizeBlocks > WINDOW_SIZE_HARD_CAP_BLOCKS) {
    return {
      ok: false,
      reason: `--window-size ${args.windowSizeBlocks} exceeds the project hard cap of ${WINDOW_SIZE_HARD_CAP_BLOCKS} inclusive blocks (MANUAL_SYNC_MAX_BLOCK_SPAN + 1)`,
    };
  }
  return { ok: true };
}

export function validateExpectedLiveCursor(args: {
  liveCursor: { fromBlock: bigint; toBlock: bigint } | null;
  expectedCursorFromBlock: bigint;
  expectedCursorToBlock: bigint;
}): GateResult {
  if (!args.liveCursor) {
    return {
      ok: false,
      reason:
        "TRANSFERS SyncCursor does not exist for this wallet; this runner only extends an existing cursor forward",
    };
  }
  if (
    args.liveCursor.fromBlock !== args.expectedCursorFromBlock ||
    args.liveCursor.toBlock !== args.expectedCursorToBlock
  ) {
    return {
      ok: false,
      reason: `live TRANSFERS cursor [${args.liveCursor.fromBlock}, ${args.liveCursor.toBlock}] does not match the operator-supplied expected cursor [${args.expectedCursorFromBlock}, ${args.expectedCursorToBlock}]`,
    };
  }
  return { ok: true };
}

export function validateFirstWindowStart(args: {
  computedStartBlock: bigint;
  expectedFirstWindowStart: bigint;
}): GateResult {
  if (args.computedStartBlock !== args.expectedFirstWindowStart) {
    return {
      ok: false,
      reason: `computed first window startBlock ${args.computedStartBlock} does not match the operator-supplied --first-window-start ${args.expectedFirstWindowStart}`,
    };
  }
  return { ok: true };
}

export function validateForwardAdjacency(args: {
  liveCursorToBlock: bigint;
  proposedStartBlock: bigint;
}): GateResult {
  if (args.proposedStartBlock !== args.liveCursorToBlock + 1n) {
    return {
      ok: false,
      reason: `proposed startBlock ${args.proposedStartBlock} is not directly adjacent to the live cursor toBlock ${args.liveCursorToBlock}`,
    };
  }
  return { ok: true };
}

export function validateNoActiveOperation(args: { activeRunCount: number }): GateResult {
  if (args.activeRunCount > 0) {
    return {
      ok: false,
      reason: `${args.activeRunCount} active (PENDING/RUNNING) SyncRun(s) exist; refusing to submit while an operation is active`,
    };
  }
  return { ok: true };
}

export function validateNoPolicyLabelCollision(args: {
  policyLabel: string;
  existingPolicyLabels: readonly string[];
}): GateResult {
  if (args.existingPolicyLabels.includes(args.policyLabel)) {
    return {
      ok: false,
      reason: `a SyncRun with policyLabel "${args.policyLabel}" already exists`,
    };
  }
  return { ok: true };
}

// ─── Request body builder (pure) ───────────────────────────────────────────────

export function buildManualSyncRequestBody(args: {
  walletAddress: string;
  chainId: number;
  window: Pick<WindowPlan, "startBlock" | "endBlock" | "policyLabel">;
}) {
  return {
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
    startBlock: args.window.startBlock.toString(),
    endBlock: args.window.endBlock.toString(),
    policyLabel: args.window.policyLabel,
  };
}

// ─── Terminal-state / postcondition verification (pure) ───────────────────────

export type RunnerSyncRunRecord = {
  id: string;
  trigger: string;
  status: string;
  stage: string;
  chainId: number;
  walletId: string | null;
  policyLabel: string;
  sourceFamilies: readonly string[];
  startBlock: bigint | null;
  endBlock: bigint | null;
  latestSafeBlock: bigint | null;
  warningCount: number;
  warningDetails: unknown;
  errorMessage: string | null;
  failedSourceFamily: string | null;
  failedFromBlock: bigint | null;
  failedToBlock: bigint | null;
};

export function verifyWindowTerminalState(args: {
  run: RunnerSyncRunRecord;
  expectedWalletId: string;
  expectedChainId: number;
  expectedPolicyLabel: string;
  expectedStartBlock: bigint;
  expectedEndBlock: bigint;
}): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const { run } = args;

  if (run.trigger !== "MANUAL") {
    reasons.push(`expected trigger MANUAL, got ${run.trigger}`);
  }
  if (run.status !== "COMPLETED") {
    reasons.push(`expected status COMPLETED, got ${run.status}`);
  }
  if (run.warningCount !== 0) {
    reasons.push(`expected warningCount 0, got ${run.warningCount}`);
  }
  if (!Array.isArray(run.warningDetails) || run.warningDetails.length !== 0) {
    reasons.push(`expected warningDetails to be empty, got ${JSON.stringify(run.warningDetails)}`);
  }
  if (run.errorMessage !== null) {
    reasons.push(`expected errorMessage null, got ${JSON.stringify(run.errorMessage)}`);
  }
  if (run.failedSourceFamily !== null) {
    reasons.push(`expected failedSourceFamily null, got ${run.failedSourceFamily}`);
  }
  if (run.failedFromBlock !== null || run.failedToBlock !== null) {
    reasons.push("expected failedFromBlock/failedToBlock null");
  }
  if (
    run.sourceFamilies.length !== 1 ||
    run.sourceFamilies[0] !== WALLET_FORWARD_SYNC_SOURCE_FAMILIES[0]
  ) {
    reasons.push(`expected sourceFamilies ["TRANSFERS"], got ${JSON.stringify(run.sourceFamilies)}`);
  }
  // The runner always submits a wallet-scoped request, so the reserved
  // SyncRun must carry the exact resolved wallet id — a null walletId (e.g.
  // a chain-wide run) must never satisfy a wallet-scoped window verification.
  if (run.walletId !== args.expectedWalletId) {
    reasons.push(`expected walletId ${args.expectedWalletId}, got ${run.walletId}`);
  }
  if (run.chainId !== args.expectedChainId) {
    reasons.push(`expected chainId ${args.expectedChainId}, got ${run.chainId}`);
  }
  if (run.policyLabel !== args.expectedPolicyLabel) {
    reasons.push(`expected policyLabel ${args.expectedPolicyLabel}, got ${run.policyLabel}`);
  }
  if (run.startBlock !== args.expectedStartBlock) {
    reasons.push(`expected startBlock ${args.expectedStartBlock}, got ${run.startBlock}`);
  }
  if (run.endBlock !== args.expectedEndBlock) {
    reasons.push(`expected endBlock ${args.expectedEndBlock}, got ${run.endBlock}`);
  }
  if (run.latestSafeBlock !== args.expectedEndBlock) {
    reasons.push(`expected latestSafeBlock ${args.expectedEndBlock}, got ${run.latestSafeBlock}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function verifyForwardCursorPostcondition(args: {
  cursorAfter: { fromBlock: bigint; toBlock: bigint } | null;
  anchorFromBlock: bigint;
  expectedToBlock: bigint;
}): GateResult {
  if (!args.cursorAfter) {
    return { ok: false, reason: "TRANSFERS SyncCursor is missing after the run completed" };
  }
  if (args.cursorAfter.fromBlock !== args.anchorFromBlock) {
    return {
      ok: false,
      reason: `expected cursor fromBlock to remain anchored at ${args.anchorFromBlock}, got ${args.cursorAfter.fromBlock}`,
    };
  }
  if (args.cursorAfter.toBlock !== args.expectedToBlock) {
    return {
      ok: false,
      reason: `expected cursor toBlock ${args.expectedToBlock} after the run, got ${args.cursorAfter.toBlock}`,
    };
  }
  return { ok: true };
}

/**
 * Builds one distinct, operator-readable failure reason per failed post-run
 * safety gate — never just the generic "post-run invariant check failed"
 * with an empty list. Every gate is independent: a run can fail multiple
 * gates simultaneously (e.g. contamination AND a duplicate group), and every
 * one of them must show up here, not just the first one checked.
 */
export function buildPostRunFailureReasons(args: {
  terminalVerification: { ok: true } | { ok: false; reasons: string[] };
  cursorGatePost: GateResult;
  postContaminationRowCount: number;
  duplicateRawTransactionGroups: number;
  duplicateRawTokenTransferGroups: number;
  duplicateLedgerEntryGroups: number;
  activeOperationsAfter: number;
}): string[] {
  const reasons: string[] = [];

  if (!args.terminalVerification.ok) {
    reasons.push(...args.terminalVerification.reasons);
  }
  if (!args.cursorGatePost.ok) {
    reasons.push(args.cursorGatePost.reason);
  }
  if (args.postContaminationRowCount > 0) {
    reasons.push(
      `post-run fabricated-transfer contamination: ${args.postContaminationRowCount} row(s) detected in the completed window's range`,
    );
  }
  if (args.duplicateRawTransactionGroups > 0) {
    reasons.push(
      `duplicate RawTransaction identity (chainId+txHash+blockHash) groups: ${args.duplicateRawTransactionGroups}`,
    );
  }
  if (args.duplicateRawTokenTransferGroups > 0) {
    reasons.push(
      `duplicate RawTokenTransfer identity (chainId+txHash+logIndex+blockHash) groups: ${args.duplicateRawTokenTransferGroups}`,
    );
  }
  if (args.duplicateLedgerEntryGroups > 0) {
    reasons.push(`duplicate LedgerEntry dedupeKey groups: ${args.duplicateLedgerEntryGroups}`);
  }
  if (args.activeOperationsAfter > 0) {
    reasons.push(
      `${args.activeOperationsAfter} active (PENDING/RUNNING) SyncRun(s) remain after the run completed`,
    );
  }

  return reasons;
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
  "",
  "  Dry-run is the default and never submits an HTTP POST.",
  "  --max-windows defaults to 1 and is hard-capped at 5.",
  "  --window-size is hard-capped at 1001 inclusive blocks.",
  "  --wallet-address, --chain-id, --expected-cursor-from,",
  "  --expected-cursor-to, --first-window-start, --window-size, and",
  "  --policy-label-prefix are all required — nothing is inferred.",
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      execute = true;
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
    },
  };
}

// ─── Env validation ────────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export type EnvCheckResult = { ok: true } | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Evidence records ──────────────────────────────────────────────────────────

export type EvidenceRecord = {
  kind: "preflight" | "window" | "stop" | "summary";
  at: string;
  [key: string]: unknown;
};

/** JSON.stringify replacer that serializes bigint as a decimal string. */
function bigintSafeReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function serializeEvidence(record: EvidenceRecord): string {
  return JSON.stringify(record, bigintSafeReplacer);
}

export async function writeEvidenceLine(evidenceFile: string, record: EvidenceRecord): Promise<void> {
  const dir = path.dirname(evidenceFile);
  await mkdir(dir, { recursive: true });
  await appendFile(evidenceFile, `${serializeEvidence(record)}\n`, "utf8");
}

// ─── Backend response sanitization (for stop evidence only) ───────────────────

const SANITIZED_RESPONSE_TEXT_MAX_LENGTH = 2_000;

/** Key names that must never appear verbatim in evidence, even if a backend
 * response body somehow included one (defense in depth — the API routes this
 * runner calls do not emit these fields today). */
const SECRET_LIKE_KEY_PATTERN =
  /(database_url|redis_url|password|secret|token|api[-_]?key|authorization|cookie)/i;

function redactSecretLikeFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecretLikeFields);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_LIKE_KEY_PATTERN.test(key) ? "[redacted]" : redactSecretLikeFields(val);
    }
    return out;
  }
  return value;
}

/**
 * Prepares a backend HTTP response body for inclusion in stop evidence: caps
 * an oversized/non-JSON string body, redacts any secret-like key a JSON body
 * might carry, and never throws — an unparseable or missing body degrades to
 * a safe placeholder rather than being silently dropped, so the original HTTP
 * failure (status code, caller-provided detail string) is never masked.
 */
export function sanitizeBackendResponseBody(body: unknown): unknown {
  if (body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return body.length > SANITIZED_RESPONSE_TEXT_MAX_LENGTH
      ? `${body.slice(0, SANITIZED_RESPONSE_TEXT_MAX_LENGTH)}...[truncated]`
      : body;
  }
  try {
    return redactSecretLikeFields(body);
  } catch {
    return "[unavailable: response body could not be sanitized]";
  }
}

// ─── Runner DB client (narrow, injectable) ─────────────────────────────────────

export type RunnerDbClient = {
  syncCursor: {
    findUnique: (args: unknown) => Promise<{
      fromBlock: bigint;
      toBlock: bigint;
      blockHash: string | null;
    } | null>;
  };
  syncRun: {
    findMany: (args: unknown) => Promise<RunnerSyncRunRecord[]>;
    findUnique: (args: unknown) => Promise<RunnerSyncRunRecord | null>;
    count: (args: unknown) => Promise<number>;
  };
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

export async function getLiveTransfersCursor(
  db: RunnerDbClient,
  walletId: string,
  chainId: number,
): Promise<{ fromBlock: bigint; toBlock: bigint } | null> {
  const cursor = await db.syncCursor.findUnique({
    where: {
      walletId_chainId_sourceFamily: {
        walletId,
        chainId,
        sourceFamily: "TRANSFERS",
      },
    },
    select: { fromBlock: true, toBlock: true, blockHash: true },
  });
  return cursor ? { fromBlock: cursor.fromBlock, toBlock: cursor.toBlock } : null;
}

export async function listActivePolicyLabels(db: RunnerDbClient, chainId: number): Promise<string[]> {
  const runs = await db.syncRun.findMany({
    where: { chainId },
    select: { policyLabel: true },
  });
  return (runs as unknown as Array<{ policyLabel: string }>).map((r) => r.policyLabel);
}

export async function countActiveOperations(db: RunnerDbClient): Promise<number> {
  return db.syncRun.count({
    where: { status: { in: ["PENDING", "RUNNING"] } },
  });
}

const TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function checkFabricatedContamination(
  db: RunnerDbClient,
  args: { chainId: number; walletAddress: string; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const wallet = args.walletAddress.toLowerCase();
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
    FROM "RawTokenTransfer" t
    JOIN "RawLog" l
      ON l."chainId" = t."chainId" AND l."txHash" = t."txHash"
     AND l."logIndex" = t."logIndex" AND l."blockHash" = t."blockHash"
    WHERE t."chainId" = ${args.chainId} AND t.status = 'ACTIVE'
      AND t."blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
      AND (lower(t."fromAddress") = ${wallet} OR lower(t."toAddress") = ${wallet})
      AND (l."topic0" IS NULL OR lower(l."topic0") <> ${TRANSFER_TOPIC0})
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateRawTransactions(
  db: RunnerDbClient,
  args: { chainId: number; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ txHash: string }>>`
    SELECT "txHash", "blockHash", count(*)
    FROM "RawTransaction"
    WHERE "chainId" = ${args.chainId}
      AND "blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY "txHash", "blockHash"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateRawTokenTransfers(
  db: RunnerDbClient,
  args: { chainId: number; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ txHash: string }>>`
    SELECT "txHash", "logIndex", "blockHash", count(*)
    FROM "RawTokenTransfer"
    WHERE "chainId" = ${args.chainId}
      AND "blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY "txHash", "logIndex", "blockHash"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateLedgerEntries(
  db: RunnerDbClient,
  args: { startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ dedupeKey: string }>>`
    SELECT e."dedupeKey", count(*)
    FROM "LedgerEntry" e
    JOIN "LedgerActionGroup" g ON g.id = e."actionGroupId"
    WHERE g."blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY e."dedupeKey"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

// ─── HTTP + polling ─────────────────────────────────────────────────────────────

export type HttpResponse = { status: number; body: unknown };
export type HttpPost = (url: string, body: unknown) => Promise<HttpResponse>;
export type HttpGet = (url: string) => Promise<HttpResponse>;

/**
 * Reads an HTTP response body safely regardless of content type: JSON is
 * parsed; a non-JSON or malformed body falls back to the raw text (still
 * useful in stop evidence, capped later by sanitizeBackendResponseBody)
 * rather than being silently discarded as `undefined`. Never throws.
 */
export async function readHttpResponseBody(res: { text: () => Promise<string> }): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function checkServerHealth(httpGet: HttpGet, baseUrl: string): Promise<GateResult> {
  let response: HttpResponse;
  try {
    response = await httpGet(`${baseUrl}/api/debug/health`);
  } catch (err) {
    return {
      ok: false,
      reason: `health check request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const body = response.body as { data?: { status?: string } } | undefined;
  if (response.status !== 200 || body?.data?.status !== "ok") {
    return { ok: false, reason: `server health check did not report ok (status ${response.status})` };
  }
  return { ok: true };
}

export async function pollSyncRunToTerminal(
  db: RunnerDbClient,
  runId: string,
  deps: { now: () => Date; sleep: (ms: number) => Promise<void>; pollIntervalMs: number; pollTimeoutMs: number },
): Promise<
  | { ok: true; run: RunnerSyncRunRecord }
  | { ok: false; reason: "timeout"; lastRun: RunnerSyncRunRecord | null }
> {
  const deadline = deps.now().getTime() + deps.pollTimeoutMs;

  for (;;) {
    const run = await db.syncRun.findUnique({ where: { id: runId } });
    if (run && (run.status === "COMPLETED" || run.status === "FAILED")) {
      return { ok: true, run };
    }
    if (deps.now().getTime() >= deadline) {
      return { ok: false, reason: "timeout", lastRun: run };
    }
    await deps.sleep(deps.pollIntervalMs);
  }
}

// ─── Wallet lookup (local Prisma client only — no global DB resolver) ─────────
//
// Deliberately narrow and self-contained: takes only the one Prisma method it
// needs, so the CLI can pass its single already-open local client instead of
// pulling in a service function that opens the module-global getDb() client.
// Mirrors resolveTrackedWalletByAddress's exact where/select shape.

export type WalletLookupClient = {
  wallet: {
    findUnique: (args: {
      where: { chainId_addressLower: { chainId: number; addressLower: string } };
      select: { id: true; address: true; chainId: true };
    }) => Promise<{ id: string; address: string; chainId: number } | null>;
  };
};

export async function resolveWalletUsingPrismaClient(
  client: WalletLookupClient,
  args: { walletAddress: string; chainId: number },
): Promise<{ id: string; address: string } | null> {
  const wallet = await client.wallet.findUnique({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower: args.walletAddress.toLowerCase(),
      },
    },
    select: { id: true, address: true, chainId: true },
  });
  return wallet ? { id: wallet.id, address: wallet.address } : null;
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
        expectedFirstWindowStart: options.firstWindowStart,
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
      return {
        stoppedReason: "invariant_failed_after_run",
        detail: postRunFailureReasons.join("; "),
        windowsCompleted,
        lastWindowNumber: plan.windowNumber,
      };
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
  });

  return { stoppedReason: "max_windows_reached", windowsCompleted, lastWindowNumber };
}

/**
 * Writes a "stop" evidence record and returns the stop summary. `extra` is
 * spread FIRST so the fixed identity fields below (`kind`, `at`, `reason`,
 * `detail`) always win, regardless of what a caller passes in `extra` —
 * a caller can never override the record's `kind` to something other than
 * `"stop"`, which would otherwise let an evidence consumer filtering for stop
 * records silently miss a hard stop.
 */
export async function stop(
  deps: RunnerDeps,
  reason: string,
  detail: string | undefined,
  windowsCompleted: number,
  lastWindowNumber: number | null,
  extra?: Record<string, unknown>,
): Promise<RunnerSummary> {
  await deps.writeEvidence({
    ...extra,
    kind: "stop",
    at: deps.now().toISOString(),
    reason,
    detail,
  });
  return { stoppedReason: reason, detail, windowsCompleted, lastWindowNumber };
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
export const CLEAN_STOP_REASONS: ReadonlySet<string> = new Set(["max_windows_reached"]);

export function computeExitCode(stoppedReason: string): 0 | 1 {
  return CLEAN_STOP_REASONS.has(stoppedReason) ? 0 : 1;
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(value, bigintSafeReplacer, 2);
}

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
