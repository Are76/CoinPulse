/**
 * TRANSFERS history backfill campaign runner — operator utility only.
 *
 * Drives the descending TRANSFERS backfill campaign documented in
 * `docs/transfer-history-backfill-operator-plan.md` one bounded batch at a
 * time. It does NOT execute the sync pipeline itself: it POSTs to the
 * running server's `/api/sync/manual` and `/api/rebuild` routes (the
 * existing, already-reviewed accounting entry points) and reads Postgres
 * directly only to plan windows, gate invariants, and verify outcomes.
 *
 * Safety defaults:
 *   - Dry-run unless --execute is passed.
 *   - --max-windows defaults to 1 and is hard-capped at 25 per invocation.
 *   - Checkpoint/final rebuild is planned but never submitted unless
 *     --allow-checkpoint-rebuild is also passed.
 *   - Every invariant violation is a hard stop; nothing is auto-retried.
 *
 * Usage (dry-run, the safe default):
 *   npx tsx --conditions react-server scripts/transfer-backfill-runner.ts
 *
 * Usage (execute exactly one window):
 *   npx tsx --conditions react-server scripts/transfer-backfill-runner.ts \
 *     --execute --max-windows 1
 *
 * Usage (execute a small batch and allow a due checkpoint rebuild):
 *   npx tsx --conditions react-server scripts/transfer-backfill-runner.ts \
 *     --execute --max-windows 5 --allow-checkpoint-rebuild
 *
 * See docs/transfer-backfill-runner-runbook.md for the full operator runbook.
 *
 * Required environment variables:
 *   DATABASE_URL  PostgreSQL connection string (direct read-only planning
 *                 queries; all mutations happen through the HTTP routes)
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * The --conditions react-server flag is required because the imported
 * ingestion service uses the server-only guard, which is a no-op only under
 * that export condition.
 *
 * Exit behaviour:
 *   - Exits 0 whenever the runner reaches a clean stop (including dry-run
 *     completion, campaign-complete, and "stopped before checkpoint
 *     rebuild") and prints a JSON summary to stdout.
 *   - Exits 1 on invalid arguments, missing environment, or any invariant
 *     failure encountered while executing.
 *   - Never prints DATABASE_URL, REDIS_URL, RPC URLs, secrets, or headers.
 */

import { fileURLToPath } from "url";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

// ─── Campaign constants (fixed; not operator-overridable) ─────────────────────

export const TRANSFER_BACKFILL_CHAIN_ID = 369;
export const TRANSFER_BACKFILL_SOURCE_FAMILIES = ["TRANSFERS"] as const;
export const TRANSFER_BACKFILL_WALLET_ADDRESS =
  "0x75f808367720951e789d47e9e9db51148d9aa765";

/** Original (pre-campaign) TRANSFERS SyncCursor lower edge. */
export const ORIGINAL_CURSOR_FROM_BLOCK = 26_697_999n;
/** Fixed TRANSFERS SyncCursor upper edge; never changes during descending backfill. */
export const FIXED_CURSOR_TO_BLOCK = 26_698_010n;
/** Authoritative earliest target block (wallet's first-ever on-chain activity). */
export const FIRST_ACTIVITY_BLOCK = 13_010_696n;
/** Full window size in inclusive blocks. */
export const FULL_WINDOW_BLOCKS = 1_000n;
/** Checkpoint rebuild cadence, in completed windows. */
export const CHECKPOINT_INTERVAL = 25;
/** Conservative hard maximum windows per invocation. */
export const MAX_WINDOWS_HARD_CAP = 25;
export const DEFAULT_MAX_WINDOWS = 1;

const POLICY_LABEL_PREFIX = "transfer-history-backfill-window-";

export function policyLabelForWindow(windowNumber: number): string {
  return `${POLICY_LABEL_PREFIX}${windowNumber}`;
}

/** ceil(gap / windowSize) using only bigint arithmetic (integer-safe). */
export function computeTotalWindows(args: {
  originalCursorFromBlock: bigint;
  firstActivityBlock: bigint;
  fullWindowBlocks?: bigint;
}): number {
  const fullWindowBlocks = args.fullWindowBlocks ?? FULL_WINDOW_BLOCKS;
  const gap = args.originalCursorFromBlock - args.firstActivityBlock;
  if (gap < 0n) {
    throw new Error(
      "originalCursorFromBlock must be >= firstActivityBlock to compute a campaign size",
    );
  }
  return Number((gap + fullWindowBlocks - 1n) / fullWindowBlocks);
}

export const TOTAL_CAMPAIGN_WINDOWS = computeTotalWindows({
  originalCursorFromBlock: ORIGINAL_CURSOR_FROM_BLOCK,
  firstActivityBlock: FIRST_ACTIVITY_BLOCK,
});

// ─── Window planning (pure) ────────────────────────────────────────────────────

export type WindowPlan = {
  status: "next_window";
  windowNumber: number;
  startBlock: bigint;
  endBlock: bigint;
  policyLabel: string;
  isFinalWindow: boolean;
  blockCount: bigint;
  totalWindows: number;
};

export type WindowPlanResult =
  | WindowPlan
  | { status: "campaign_complete"; totalWindows: number }
  | { status: "misaligned_cursor"; detail: string };

/**
 * Computes the next window to run from the planning cursor lower edge: the
 * live persisted TRANSFERS cursor in execute mode, or the in-memory simulated
 * cursor for later dry-run previews. Never trusts a hardcoded "windows
 * completed" count — in execute mode the live cursor is the only source of
 * truth for campaign progress.
 */
export function computeWindowPlan(args: {
  planningCursorFromBlock: bigint;
  originalCursorFromBlock?: bigint;
  firstActivityBlock?: bigint;
  fullWindowBlocks?: bigint;
}): WindowPlanResult {
  const originalCursorFromBlock =
    args.originalCursorFromBlock ?? ORIGINAL_CURSOR_FROM_BLOCK;
  const firstActivityBlock = args.firstActivityBlock ?? FIRST_ACTIVITY_BLOCK;
  const fullWindowBlocks = args.fullWindowBlocks ?? FULL_WINDOW_BLOCKS;
  const totalWindows = computeTotalWindows({
    originalCursorFromBlock,
    firstActivityBlock,
    fullWindowBlocks,
  });

  if (args.planningCursorFromBlock <= firstActivityBlock) {
    return { status: "campaign_complete", totalWindows };
  }

  if (args.planningCursorFromBlock > originalCursorFromBlock) {
    return {
      status: "misaligned_cursor",
      detail: `planning cursor fromBlock ${args.planningCursorFromBlock} is above the original campaign cursor ${originalCursorFromBlock}`,
    };
  }

  const diff = originalCursorFromBlock - args.planningCursorFromBlock;
  if (diff % fullWindowBlocks !== 0n) {
    return {
      status: "misaligned_cursor",
      detail: `planning cursor fromBlock ${args.planningCursorFromBlock} is not aligned to the ${fullWindowBlocks}-block campaign grid (offset ${diff} from ${originalCursorFromBlock})`,
    };
  }

  const windowNumber = Number(diff / fullWindowBlocks) + 1;
  const rawStart = args.planningCursorFromBlock - fullWindowBlocks;
  const startBlock = rawStart < firstActivityBlock ? firstActivityBlock : rawStart;
  const endBlock = args.planningCursorFromBlock - 1n;
  const isFinalWindow = startBlock === firstActivityBlock;
  const blockCount = endBlock - startBlock + 1n;

  return {
    status: "next_window",
    windowNumber,
    startBlock,
    endBlock,
    policyLabel: policyLabelForWindow(windowNumber),
    isFinalWindow,
    blockCount,
    totalWindows,
  };
}

export function isCheckpointDue(
  windowNumber: number,
  checkpointInterval: number = CHECKPOINT_INTERVAL,
): boolean {
  return windowNumber > 0 && windowNumber % checkpointInterval === 0;
}

export function isFinalRebuildDue(
  windowNumber: number,
  totalWindows: number = TOTAL_CAMPAIGN_WINDOWS,
): boolean {
  return windowNumber === totalWindows;
}

// ─── Pre-submit validation gates (pure) ────────────────────────────────────────

export type GateResult = { ok: true } | { ok: false; reason: string };

export function validateExpectedCursor(args: {
  liveCursorFromBlock: bigint;
  expectedCursorFromBlock?: bigint;
}): GateResult {
  if (args.expectedCursorFromBlock === undefined) {
    return { ok: true };
  }
  if (args.liveCursorFromBlock !== args.expectedCursorFromBlock) {
    return {
      ok: false,
      reason: `live TRANSFERS cursor fromBlock ${args.liveCursorFromBlock} does not match the operator-supplied expected cursor ${args.expectedCursorFromBlock}`,
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

export function validateNoActiveOperation(args: {
  activeRunCount: number;
}): GateResult {
  if (args.activeRunCount > 0) {
    return {
      ok: false,
      reason: `${args.activeRunCount} active (PENDING/RUNNING) SyncRun(s) exist; refusing to submit while an operation is active`,
    };
  }
  return { ok: true };
}

export function validateAdjacency(args: {
  planningCursorFromBlock: bigint;
  proposedEndBlock: bigint;
}): GateResult {
  if (args.proposedEndBlock + 1n !== args.planningCursorFromBlock) {
    return {
      ok: false,
      reason: `proposed endBlock ${args.proposedEndBlock} is not directly adjacent to the planning cursor fromBlock ${args.planningCursorFromBlock}`,
    };
  }
  return { ok: true };
}

export function validateRangeSize(args: {
  startBlock: bigint;
  endBlock: bigint;
  isFinalWindow: boolean;
  fullWindowBlocks?: bigint;
}): GateResult {
  const fullWindowBlocks = args.fullWindowBlocks ?? FULL_WINDOW_BLOCKS;
  const blockCount = args.endBlock - args.startBlock + 1n;
  if (blockCount <= 0n) {
    return { ok: false, reason: `window range is empty or inverted (${blockCount} blocks)` };
  }
  if (!args.isFinalWindow && blockCount !== fullWindowBlocks) {
    return {
      ok: false,
      reason: `non-final window must span exactly ${fullWindowBlocks} inclusive blocks, got ${blockCount}`,
    };
  }
  if (args.isFinalWindow && blockCount > fullWindowBlocks) {
    return {
      ok: false,
      reason: `final window must span at most ${fullWindowBlocks} inclusive blocks, got ${blockCount}`,
    };
  }
  return { ok: true };
}

export function validateFixedCampaignScope(args: {
  chainId: number;
  sourceFamilies: readonly string[];
}): GateResult {
  if (args.chainId !== TRANSFER_BACKFILL_CHAIN_ID) {
    return {
      ok: false,
      reason: `chainId must be ${TRANSFER_BACKFILL_CHAIN_ID} (PulseChain); got ${args.chainId}`,
    };
  }
  if (
    args.sourceFamilies.length !== 1 ||
    args.sourceFamilies[0] !== TRANSFER_BACKFILL_SOURCE_FAMILIES[0]
  ) {
    return {
      ok: false,
      reason: `sourceFamilies must be exactly ["TRANSFERS"]; got ${JSON.stringify(args.sourceFamilies)}`,
    };
  }
  return { ok: true };
}

// ─── Request body builders (pure) ──────────────────────────────────────────────

export function buildManualSyncRequestBody(args: {
  walletAddress: string;
  window: Pick<WindowPlan, "startBlock" | "endBlock" | "policyLabel">;
}) {
  return {
    walletAddress: args.walletAddress,
    chainId: TRANSFER_BACKFILL_CHAIN_ID,
    sourceFamilies: [...TRANSFER_BACKFILL_SOURCE_FAMILIES],
    startBlock: args.window.startBlock.toString(),
    endBlock: args.window.endBlock.toString(),
    policyLabel: args.window.policyLabel,
  };
}

export function buildRebuildRequestBody(args: {
  walletAddress: string;
  window: Pick<WindowPlan, "startBlock" | "endBlock">;
}) {
  return {
    walletAddress: args.walletAddress,
    chainId: TRANSFER_BACKFILL_CHAIN_ID,
    fromBlock: args.window.startBlock.toString(),
    toBlock: args.window.endBlock.toString(),
    sourceFamilies: [...TRANSFER_BACKFILL_SOURCE_FAMILIES],
  };
}

// ─── Terminal-state / postcondition verification (pure) ───────────────────────

export type RunnerSyncRunRecord = {
  id: string;
  trigger: string;
  status: string;
  stage: string;
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

// A checkpoint/final REBUILD re-materializes the entire wallet from a still-
// incomplete descending backfill (docs/transfer-history-backfill-operator-plan.md
// facts 10-11, §3 Q6): `negative-token-balance:<assetId>:<qty>` warnings are the
// documented, expected byproduct until the history is contiguous. MANUAL sync
// windows do not materialize at all, so they have no such expected class and
// must stay held to warningCount === 0.
const EXPECTED_REBUILD_WARNING_PREFIX = "negative-token-balance:";

export function isExpectedRebuildWarningDetail(detail: unknown): boolean {
  return typeof detail === "string" && detail.startsWith(EXPECTED_REBUILD_WARNING_PREFIX);
}

/**
 * Classifies a REBUILD run's warningDetails against the one documented
 * expected class. Fails closed: missing/non-array details, or any detail
 * outside the expected class (including the truncation marker from
 * `capWarningDetails` in sync-state-store.ts, which hides unverifiable
 * entries), is treated as unexpected.
 */
export function classifyRebuildWarningDetails(
  warningDetails: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(warningDetails) || warningDetails.length === 0) {
    return {
      ok: false,
      reason: "warningCount > 0 but warningDetails is missing, empty, or not an array; cannot verify rebuild warnings are the documented negative-token-balance class",
    };
  }
  const unexpected = warningDetails.filter((detail) => !isExpectedRebuildWarningDetail(detail));
  if (unexpected.length > 0) {
    return {
      ok: false,
      reason: `rebuild produced ${unexpected.length} unexpected warning(s) outside the documented negative-token-balance class: ${JSON.stringify(unexpected.slice(0, 5))}`,
    };
  }
  return { ok: true };
}

export function verifySyncRunTerminalState(args: {
  run: RunnerSyncRunRecord;
  expectedTrigger: "MANUAL" | "REBUILD";
  /**
   * Required context for a REBUILD trigger: only a mid-campaign "checkpoint"
   * rebuild gets the negative-token-balance warning allowance. A "final"
   * rebuild (the one submitted after the last window) must meet the strict
   * campaign-completion criteria in
   * docs/transfer-history-backfill-operator-plan.md §9 — zero
   * negative-token-balance warnings, since the whole point of the campaign is
   * for that warning class to have disappeared by then. Omitted/undefined is
   * treated as "final" (the strict default) so a caller can never silently
   * fall into the lenient path.
   */
  rebuildKind?: "checkpoint" | "final";
  expectedStartBlock: bigint;
  expectedEndBlock: bigint;
}): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const { run } = args;

  if (run.trigger !== args.expectedTrigger) {
    reasons.push(`expected trigger ${args.expectedTrigger}, got ${run.trigger}`);
  }
  if (run.status !== "COMPLETED") {
    reasons.push(`expected status COMPLETED, got ${run.status}`);
  }
  if (args.expectedTrigger === "REBUILD" && args.rebuildKind === "checkpoint") {
    if (run.warningCount > 0) {
      const classification = classifyRebuildWarningDetails(run.warningDetails);
      if (!classification.ok) {
        reasons.push(classification.reason);
      }
    }
  } else if (run.warningCount !== 0) {
    reasons.push(`expected warningCount 0, got ${run.warningCount}`);
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
    run.sourceFamilies[0] !== TRANSFER_BACKFILL_SOURCE_FAMILIES[0]
  ) {
    reasons.push(`expected sourceFamilies ["TRANSFERS"], got ${JSON.stringify(run.sourceFamilies)}`);
  }
  if (run.startBlock !== args.expectedStartBlock) {
    reasons.push(`expected startBlock ${args.expectedStartBlock}, got ${run.startBlock}`);
  }
  if (run.endBlock !== args.expectedEndBlock) {
    reasons.push(`expected endBlock ${args.expectedEndBlock}, got ${run.endBlock}`);
  }
  if (args.expectedTrigger === "MANUAL" && run.latestSafeBlock !== args.expectedEndBlock) {
    reasons.push(`expected latestSafeBlock ${args.expectedEndBlock}, got ${run.latestSafeBlock}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function verifyCursorPostcondition(args: {
  cursorAfter: { fromBlock: bigint; toBlock: bigint } | null;
  expectedFromBlock: bigint;
  expectedToBlock: bigint;
}): GateResult {
  if (!args.cursorAfter) {
    return { ok: false, reason: "TRANSFERS SyncCursor is missing after the run completed" };
  }
  if (args.cursorAfter.fromBlock !== args.expectedFromBlock) {
    return {
      ok: false,
      reason: `expected cursor fromBlock ${args.expectedFromBlock} after the run, got ${args.cursorAfter.fromBlock}`,
    };
  }
  if (args.cursorAfter.toBlock !== args.expectedToBlock) {
    return {
      ok: false,
      reason: `expected cursor toBlock ${args.expectedToBlock} to remain unchanged, got ${args.cursorAfter.toBlock}`,
    };
  }
  return { ok: true };
}

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type RunnerCliOptions = {
  execute: boolean;
  maxWindows: number;
  allowCheckpointRebuild: boolean;
  walletAddress: string;
  baseUrl: string;
  expectedCursorFromBlock?: bigint;
  evidenceDir: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
};

export type RunnerCliParseResult =
  | { ok: true; options: RunnerCliOptions }
  | { ok: false; error: string };

export const RUNNER_CLI_USAGE = [
  "Usage: transfer-backfill-runner [--execute] [--max-windows <1-25>]",
  "         [--allow-checkpoint-rebuild] [--wallet-address <0x..>]",
  "         [--base-url <url>] [--expected-cursor-from <blockNumber>]",
  "         [--evidence-dir <path>] [--poll-interval-ms <n>] [--poll-timeout-ms <n>]",
  "",
  "  Dry-run is the default and never submits an HTTP POST or rebuild.",
  "  --max-windows defaults to 1 and is hard-capped at 25 per invocation.",
  "  --allow-checkpoint-rebuild is required to submit a due checkpoint or",
  "  final rebuild; without it the runner stops before the rebuild.",
].join("\n");

const DEFAULT_BASE_URL = process.env.OPERATOR_RUNNER_BASE_URL ?? "http://localhost:3000";
const DEFAULT_EVIDENCE_DIR = "operator-evidence/transfers-backfill";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000;

export function parseRunnerCliArgs(argv: readonly string[]): RunnerCliParseResult {
  let execute = false;
  let maxWindows = DEFAULT_MAX_WINDOWS;
  let allowCheckpointRebuild = false;
  let walletAddress = TRANSFER_BACKFILL_WALLET_ADDRESS;
  let baseUrl = DEFAULT_BASE_URL;
  let expectedCursorFromBlock: bigint | undefined;
  let evidenceDir = DEFAULT_EVIDENCE_DIR;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;

  const readValue = (flag: string, index: number): string | null => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return null;
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      execute = true;
      continue;
    }
    if (arg === "--allow-checkpoint-rebuild") {
      allowCheckpointRebuild = true;
      continue;
    }
    if (arg === "--max-windows") {
      const value = readValue(arg, index);
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
    if (arg === "--wallet-address") {
      const value = readValue(arg, index);
      if (value === null || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return { ok: false, error: "--wallet-address must be a valid EVM address." };
      }
      walletAddress = value.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      const value = readValue(arg, index);
      if (value === null) return { ok: false, error: "--base-url requires a value." };
      baseUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--expected-cursor-from") {
      const value = readValue(arg, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--expected-cursor-from must be an unsigned integer." };
      }
      expectedCursorFromBlock = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--evidence-dir") {
      const value = readValue(arg, index);
      if (value === null) return { ok: false, error: "--evidence-dir requires a value." };
      evidenceDir = value;
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms") {
      const value = readValue(arg, index);
      if (value === null || !/^\d+$/.test(value) || Number(value) <= 0) {
        return { ok: false, error: "--poll-interval-ms must be a positive integer." };
      }
      pollIntervalMs = Number(value);
      index += 1;
      continue;
    }
    if (arg === "--poll-timeout-ms") {
      const value = readValue(arg, index);
      if (value === null || !/^\d+$/.test(value) || Number(value) <= 0) {
        return { ok: false, error: "--poll-timeout-ms must be a positive integer." };
      }
      pollTimeoutMs = Number(value);
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return {
    ok: true,
    options: {
      execute,
      maxWindows,
      allowCheckpointRebuild,
      walletAddress,
      baseUrl,
      expectedCursorFromBlock,
      evidenceDir,
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

// ─── Decimal-serialization capability probe ────────────────────────────────────
//
// Behavioural capability check (not brittle source-text inspection): exercises
// the REAL production read-back function with an injected large-Decimal probe
// record and confirms the returned amountRaw is fixed-point digit-only output,
// reproducing the exact regression coverage added in PR #330/#331. If a future
// change reintroduces exponential-notation serialization, this probe fails
// closed and the runner refuses to submit real windows.

export type DecimalCapabilityResult = { ok: true } | { ok: false; detail: string };

export async function verifyDecimalSerializationCapability(
  readTransfers?: (
    args: { chainId: number; walletAddress: string; fromBlock: bigint; toBlock: bigint },
    client: unknown,
  ) => Promise<Array<{ amountRaw: string }>>,
): Promise<DecimalCapabilityResult> {
  const { Prisma } = await import("@prisma/client");
  const reader =
    readTransfers ??
    (await import("@/services/ingestion/raw-store")).readWalletTransferRawTokenTransfers;

  const probeAmount = new Prisma.Decimal("28000000000000000000140"); // ~2.8e22, exercises the >=1e21 exponential threshold
  if (!probeAmount.toString().includes("e+")) {
    return {
      ok: false,
      detail: "decimal capability probe setup is invalid: probe value did not reproduce exponential toString() output",
    };
  }

  const fakeClient = {
    rawTokenTransfer: {
      findMany: async () => [
        {
          chainId: TRANSFER_BACKFILL_CHAIN_ID,
          tokenId: "probe-token",
          tokenAddress: "0x0000000000000000000000000000000000000001",
          assetIdSnapshot: "chain:369:erc20:0x0000000000000000000000000000000000000001",
          decimalsSnapshot: 18,
          txHash: "0xprobe",
          blockNumber: 1n,
          blockHash: "0xprobeblock",
          logIndex: 0,
          fromAddress: TRANSFER_BACKFILL_WALLET_ADDRESS,
          toAddress: "0x0000000000000000000000000000000000000002",
          amountRaw: probeAmount,
        },
      ],
    },
  };

  const [record] = await reader(
    {
      chainId: TRANSFER_BACKFILL_CHAIN_ID,
      walletAddress: TRANSFER_BACKFILL_WALLET_ADDRESS,
      fromBlock: 0n,
      toBlock: 1n,
    },
    fakeClient,
  );

  const digitOnly = /^\d+$/;
  if (!record || !digitOnly.test(record.amountRaw) || record.amountRaw.includes("e")) {
    return {
      ok: false,
      detail: `decimal serialization capability check failed: readWalletTransferRawTokenTransfers returned amountRaw=${JSON.stringify(record?.amountRaw)}, expected a digit-only fixed-point string`,
    };
  }

  return { ok: true };
}

// ─── Evidence records ──────────────────────────────────────────────────────────

export type EvidenceRecord = {
  kind: "window" | "rebuild" | "stop";
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

export async function writeEvidenceLine(
  evidenceDir: string,
  record: EvidenceRecord,
): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  const filePath = path.join(evidenceDir, "transfers-backfill-evidence.jsonl");
  await appendFile(filePath, `${serializeEvidence(record)}\n`, "utf8");
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
): Promise<{ fromBlock: bigint; toBlock: bigint } | null> {
  const cursor = await db.syncCursor.findUnique({
    where: {
      walletId_chainId_sourceFamily: {
        walletId,
        chainId: TRANSFER_BACKFILL_CHAIN_ID,
        sourceFamily: "TRANSFERS",
      },
    },
    select: { fromBlock: true, toBlock: true, blockHash: true },
  });
  return cursor ? { fromBlock: cursor.fromBlock, toBlock: cursor.toBlock } : null;
}

export async function listActivePolicyLabels(db: RunnerDbClient): Promise<string[]> {
  const runs = await db.syncRun.findMany({
    where: { chainId: TRANSFER_BACKFILL_CHAIN_ID },
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

export async function checkServerHealth(httpGet: HttpGet, baseUrl: string): Promise<GateResult> {
  let response: HttpResponse;
  try {
    response = await httpGet(`${baseUrl}/api/debug/health`);
  } catch (err) {
    return { ok: false, reason: `health check request failed: ${err instanceof Error ? err.message : String(err)}` };
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
): Promise<{ ok: true; run: RunnerSyncRunRecord } | { ok: false; reason: "timeout"; lastRun: RunnerSyncRunRecord | null }> {
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

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export type RunnerDeps = {
  db: RunnerDbClient;
  resolveWallet: (args: { walletAddress: string; chainId: number }) => Promise<{ id: string; address: string } | null>;
  httpGet: HttpGet;
  httpPost: HttpPost;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  writeEvidence: (record: EvidenceRecord) => Promise<void>;
  verifyDecimalCapability: () => Promise<DecimalCapabilityResult>;
};

export type RunnerSummary = {
  stoppedReason: string;
  detail?: string;
  windowsCompleted: number;
  lastWindowNumber: number | null;
};

export async function runTransferBackfillRunner(
  options: RunnerCliOptions,
  deps: RunnerDeps,
): Promise<RunnerSummary> {
  const scopeGate = validateFixedCampaignScope({
    chainId: TRANSFER_BACKFILL_CHAIN_ID,
    sourceFamilies: TRANSFER_BACKFILL_SOURCE_FAMILIES,
  });
  if (!scopeGate.ok) {
    await deps.writeEvidence({ kind: "stop", at: deps.now().toISOString(), reason: "invalid_campaign_scope", detail: scopeGate.reason });
    return { stoppedReason: "invalid_campaign_scope", detail: scopeGate.reason, windowsCompleted: 0, lastWindowNumber: null };
  }

  const decimalCapability = await deps.verifyDecimalCapability();
  if (!decimalCapability.ok) {
    await deps.writeEvidence({ kind: "stop", at: deps.now().toISOString(), reason: "decimal_capability_check_failed", detail: decimalCapability.detail });
    return { stoppedReason: "decimal_capability_check_failed", detail: decimalCapability.detail, windowsCompleted: 0, lastWindowNumber: null };
  }

  const wallet = await deps.resolveWallet({
    walletAddress: options.walletAddress,
    chainId: TRANSFER_BACKFILL_CHAIN_ID,
  });
  if (!wallet) {
    await deps.writeEvidence({ kind: "stop", at: deps.now().toISOString(), reason: "wallet_not_found" });
    return { stoppedReason: "wallet_not_found", windowsCompleted: 0, lastWindowNumber: null };
  }

  let windowsCompleted = 0;
  let lastWindowNumber: number | null = null;

  // Internal live-cursor expectation. Seeded from the operator's
  // --expected-cursor-from (validated against the real live cursor before the
  // first submission, exactly as before) and advanced to the verified
  // postcondition value only after a window passes every post-run gate. Once
  // set, unexpected live-cursor movement between windows stops the batch
  // before the next submission — even when the operator omitted the flag.
  let expectedCursorFromBlock = options.expectedCursorFromBlock;

  // Dry-run only: in-memory simulated cursor so --max-windows N previews N
  // distinct sequential windows. Never consulted in execute mode — execute
  // planning always uses the live persisted cursor as the sole truth.
  let simulatedCursorFromBlock: bigint | null = null;

  for (let iteration = 0; iteration < options.maxWindows; iteration += 1) {
    const cursor = await getLiveTransfersCursor(deps.db, wallet.id);
    if (!cursor) {
      return stop(deps, "no_transfers_cursor", "TRANSFERS SyncCursor does not exist for this wallet; Case B (ascending) is out of scope for this runner", windowsCompleted, lastWindowNumber);
    }

    const cursorSource: "live" | "simulated" =
      !options.execute && simulatedCursorFromBlock !== null ? "simulated" : "live";
    const planningFromBlock =
      cursorSource === "simulated" && simulatedCursorFromBlock !== null
        ? simulatedCursorFromBlock
        : cursor.fromBlock;

    const plan = computeWindowPlan({ planningCursorFromBlock: planningFromBlock });
    if (plan.status === "campaign_complete") {
      return stop(deps, "campaign_complete", undefined, windowsCompleted, lastWindowNumber);
    }
    if (plan.status === "misaligned_cursor") {
      return stop(deps, "misaligned_cursor", plan.detail, windowsCompleted, lastWindowNumber);
    }

    // Always validated against the REAL live cursor (never the simulation):
    // detects operator-expectation mismatch on the first iteration and
    // unexpected live-cursor movement on every later one.
    const cursorGate = validateExpectedCursor({ liveCursorFromBlock: cursor.fromBlock, expectedCursorFromBlock });
    if (!cursorGate.ok) return stop(deps, "cursor_expectation_mismatch", cursorGate.reason, windowsCompleted, lastWindowNumber);
    if (expectedCursorFromBlock === undefined) {
      expectedCursorFromBlock = cursor.fromBlock;
    }

    const adjacencyGate = validateAdjacency({ planningCursorFromBlock: planningFromBlock, proposedEndBlock: plan.endBlock });
    if (!adjacencyGate.ok) return stop(deps, "adjacency_violation", adjacencyGate.reason, windowsCompleted, lastWindowNumber);

    const rangeGate = validateRangeSize({ startBlock: plan.startBlock, endBlock: plan.endBlock, isFinalWindow: plan.isFinalWindow });
    if (!rangeGate.ok) return stop(deps, "range_size_violation", rangeGate.reason, windowsCompleted, lastWindowNumber);

    const activeRunCount = await countActiveOperations(deps.db);
    const activeOpGate = validateNoActiveOperation({ activeRunCount });
    if (!activeOpGate.ok) return stop(deps, "active_operation_conflict", activeOpGate.reason, windowsCompleted, lastWindowNumber);

    const existingLabels = await listActivePolicyLabels(deps.db);
    const labelGate = validateNoPolicyLabelCollision({ policyLabel: plan.policyLabel, existingPolicyLabels: existingLabels });
    if (!labelGate.ok) return stop(deps, "policy_label_collision", labelGate.reason, windowsCompleted, lastWindowNumber);

    const healthGate = await checkServerHealth(deps.httpGet, options.baseUrl);
    if (!healthGate.ok) return stop(deps, "server_unhealthy", healthGate.reason, windowsCompleted, lastWindowNumber);

    const preContamination = await checkFabricatedContamination(deps.db, {
      chainId: TRANSFER_BACKFILL_CHAIN_ID,
      walletAddress: options.walletAddress,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    if (preContamination.rowCount > 0) {
      return stop(deps, "fabricated_contamination_pre_gate", `${preContamination.rowCount} contaminated row(s) detected in the proposed range; do not submit`, windowsCompleted, lastWindowNumber);
    }

    if (!options.execute) {
      await deps.writeEvidence({
        kind: "window",
        at: deps.now().toISOString(),
        outcome: "dry_run_planned",
        windowNumber: plan.windowNumber,
        policyLabel: plan.policyLabel,
        expectedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
        cursorBefore: { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() },
        // Additive fields only: cursorSource distinguishes a preview planned
        // from the real live cursor from one planned from the in-memory
        // simulation; simulatedCursorFromBlock is present only when simulated.
        cursorSource,
        ...(cursorSource === "simulated"
          ? { simulatedCursorFromBlock: planningFromBlock.toString() }
          : {}),
      });
      lastWindowNumber = plan.windowNumber;
      // Advance the in-memory simulation so the next dry-run iteration
      // previews the next sequential window. No database state changes.
      simulatedCursorFromBlock = plan.startBlock;
      continue;
    }

    // ── Execute: submit exactly one manual sync request ──
    const submittedAt = deps.now().toISOString();
    const requestBody = buildManualSyncRequestBody({ walletAddress: options.walletAddress, window: plan });
    const postResponse = await deps.httpPost(`${options.baseUrl}/api/sync/manual`, requestBody);
    const runId = (postResponse.body as { data?: { runId?: string } } | undefined)?.data?.runId;
    if (postResponse.status !== 202 || !runId) {
      return stop(deps, "manual_sync_submit_failed", `POST /api/sync/manual returned status ${postResponse.status}`, windowsCompleted, lastWindowNumber, {
        kind: "window",
        windowNumber: plan.windowNumber,
        policyLabel: plan.policyLabel,
        submittedAt,
      });
    }

    const polled = await pollSyncRunToTerminal(deps.db, runId, {
      now: deps.now,
      sleep: deps.sleep,
      pollIntervalMs: options.pollIntervalMs,
      pollTimeoutMs: options.pollTimeoutMs,
    });
    if (!polled.ok) {
      return stop(deps, "poll_timeout", `SyncRun ${runId} did not reach a terminal state within ${options.pollTimeoutMs}ms`, windowsCompleted, lastWindowNumber, {
        kind: "window",
        windowNumber: plan.windowNumber,
        policyLabel: plan.policyLabel,
        runId,
        submittedAt,
      });
    }
    const terminalAt = deps.now().toISOString();

    const terminalVerification = verifySyncRunTerminalState({
      run: polled.run,
      expectedTrigger: "MANUAL",
      expectedStartBlock: plan.startBlock,
      expectedEndBlock: plan.endBlock,
    });

    const cursorAfterRecord = await getLiveTransfersCursor(deps.db, wallet.id);
    const cursorGatePost = terminalVerification.ok
      ? verifyCursorPostcondition({
          cursorAfter: cursorAfterRecord,
          expectedFromBlock: plan.startBlock,
          expectedToBlock: cursor.toBlock,
        })
      : { ok: false as const, reason: "skipped: terminal state already failed" };

    const postContamination = await checkFabricatedContamination(deps.db, {
      chainId: TRANSFER_BACKFILL_CHAIN_ID,
      walletAddress: options.walletAddress,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const duplicateTransfers = await checkDuplicateRawTokenTransfers(deps.db, {
      chainId: TRANSFER_BACKFILL_CHAIN_ID,
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const duplicateLedgerEntries = await checkDuplicateLedgerEntries(deps.db, {
      startBlock: plan.startBlock,
      endBlock: plan.endBlock,
    });
    const activeAfterCount = await countActiveOperations(deps.db);

    const allOk =
      terminalVerification.ok &&
      cursorGatePost.ok &&
      postContamination.rowCount === 0 &&
      duplicateTransfers.rowCount === 0 &&
      duplicateLedgerEntries.rowCount === 0 &&
      activeAfterCount === 0;

    await deps.writeEvidence({
      kind: "window",
      at: terminalAt,
      outcome: allOk ? "completed" : "failed_invariant",
      windowNumber: plan.windowNumber,
      policyLabel: plan.policyLabel,
      expectedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
      actualRange: { startBlock: polled.run.startBlock?.toString() ?? null, endBlock: polled.run.endBlock?.toString() ?? null },
      runId,
      submittedAt,
      terminalAt,
      terminalStatus: polled.run.status,
      warningCount: polled.run.warningCount,
      errorMessage: polled.run.errorMessage,
      cursorBefore: { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() },
      cursorAfter: cursorAfterRecord
        ? { fromBlock: cursorAfterRecord.fromBlock.toString(), toBlock: cursorAfterRecord.toBlock.toString() }
        : null,
      contamination: { preSubmitRows: preContamination.rowCount, postRunRows: postContamination.rowCount },
      duplicates: { rawTokenTransferGroups: duplicateTransfers.rowCount, ledgerEntryGroups: duplicateLedgerEntries.rowCount },
      activeOperationsAfter: activeAfterCount,
      invariantFailures: !terminalVerification.ok ? terminalVerification.reasons : [],
    });

    if (!allOk) {
      const reasons = [
        ...(!terminalVerification.ok ? terminalVerification.reasons : []),
        ...(!cursorGatePost.ok ? [cursorGatePost.reason] : []),
      ];
      return {
        stoppedReason: "invariant_failed_after_run",
        detail: reasons.join("; ") || "post-run invariant check failed",
        windowsCompleted,
        lastWindowNumber: plan.windowNumber,
      };
    }

    windowsCompleted += 1;
    lastWindowNumber = plan.windowNumber;
    // Only reached when every post-run gate passed (terminal state, cursor
    // postcondition, contamination, duplicates, active operations): the
    // verified live cursor now sits at plan.startBlock, so that becomes the
    // expectation the next iteration's live read must match.
    expectedCursorFromBlock = plan.startBlock;

    // ── Checkpoint / final rebuild gate ──
    const checkpointDue = isCheckpointDue(plan.windowNumber);
    const finalRebuildDue = isFinalRebuildDue(plan.windowNumber, plan.totalWindows);
    if (checkpointDue || finalRebuildDue) {
      if (!options.allowCheckpointRebuild) {
        return stop(
          deps,
          finalRebuildDue ? "stopped_before_final_rebuild" : "stopped_before_checkpoint_rebuild",
          `window ${plan.windowNumber} completed; a rebuild is due but --allow-checkpoint-rebuild was not passed`,
          windowsCompleted,
          lastWindowNumber,
        );
      }

      const rebuildOutcome = await runRebuildStep(options, deps, plan, finalRebuildDue);
      if (!rebuildOutcome.ok) {
        return { stoppedReason: rebuildOutcome.reason, detail: rebuildOutcome.detail, windowsCompleted, lastWindowNumber };
      }
      if (finalRebuildDue) {
        return { stoppedReason: "campaign_complete_after_final_rebuild", windowsCompleted, lastWindowNumber };
      }
    }
  }

  return { stoppedReason: "max_windows_reached", windowsCompleted, lastWindowNumber };
}

async function runRebuildStep(
  options: RunnerCliOptions,
  deps: RunnerDeps,
  plan: WindowPlan,
  isFinal: boolean,
): Promise<{ ok: true } | { ok: false; reason: string; detail: string }> {
  const activeRunCount = await countActiveOperations(deps.db);
  const activeOpGate = validateNoActiveOperation({ activeRunCount });
  if (!activeOpGate.ok) {
    return { ok: false, reason: "active_operation_conflict_before_rebuild", detail: activeOpGate.reason };
  }

  const healthGate = await checkServerHealth(deps.httpGet, options.baseUrl);
  if (!healthGate.ok) {
    return { ok: false, reason: "server_unhealthy_before_rebuild", detail: healthGate.reason };
  }

  const submittedAt = deps.now().toISOString();
  const requestBody = buildRebuildRequestBody({ walletAddress: options.walletAddress, window: plan });
  const postResponse = await deps.httpPost(`${options.baseUrl}/api/rebuild`, requestBody);
  const runId = (postResponse.body as { data?: { runId?: string } } | undefined)?.data?.runId;
  if (postResponse.status !== 202 || !runId) {
    await deps.writeEvidence({ kind: "rebuild", at: submittedAt, outcome: "submit_failed", isFinal, windowNumber: plan.windowNumber });
    return { ok: false, reason: "rebuild_submit_failed", detail: `POST /api/rebuild returned status ${postResponse.status}` };
  }

  const polled = await pollSyncRunToTerminal(deps.db, runId, {
    now: deps.now,
    sleep: deps.sleep,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
  });
  if (!polled.ok) {
    await deps.writeEvidence({ kind: "rebuild", at: deps.now().toISOString(), outcome: "poll_timeout", isFinal, windowNumber: plan.windowNumber, runId, submittedAt });
    return { ok: false, reason: "rebuild_poll_timeout", detail: `Rebuild SyncRun ${runId} did not reach a terminal state in time` };
  }
  const terminalAt = deps.now().toISOString();

  const rebuildKind: "checkpoint" | "final" = isFinal ? "final" : "checkpoint";
  const terminalVerification = verifySyncRunTerminalState({
    run: polled.run,
    expectedTrigger: "REBUILD",
    rebuildKind,
    expectedStartBlock: plan.startBlock,
    expectedEndBlock: plan.endBlock,
  });

  // Preserve the exact accepted warningDetails (no reformatting of quantities)
  // only for a checkpoint rebuild that passed verification with warnings —
  // the one case where warnings are documented-expected rather than absent.
  const acceptedWarningDetails =
    terminalVerification.ok && rebuildKind === "checkpoint" && polled.run.warningCount > 0
      ? polled.run.warningDetails
      : null;

  await deps.writeEvidence({
    kind: "rebuild",
    at: terminalAt,
    outcome: terminalVerification.ok ? "completed" : "failed_invariant",
    isFinal,
    windowNumber: plan.windowNumber,
    runId,
    submittedAt,
    terminalAt,
    terminalStatus: polled.run.status,
    warningCount: polled.run.warningCount,
    acceptedWarningDetails,
    errorMessage: polled.run.errorMessage,
    invariantFailures: !terminalVerification.ok ? terminalVerification.reasons : [],
  });

  if (!terminalVerification.ok) {
    return { ok: false, reason: "rebuild_invariant_failed", detail: terminalVerification.reasons.join("; ") };
  }
  return { ok: true };
}

async function stop(
  deps: RunnerDeps,
  reason: string,
  detail: string | undefined,
  windowsCompleted: number,
  lastWindowNumber: number | null,
  extra?: Record<string, unknown>,
): Promise<RunnerSummary> {
  await deps.writeEvidence({ kind: "stop", at: deps.now().toISOString(), reason, detail, ...extra });
  return { stoppedReason: reason, detail, windowsCompleted, lastWindowNumber };
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(value, bigintSafeReplacer, 2);
}

async function main(): Promise<void> {
  const parsed = parseRunnerCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`transfer-backfill-runner: ${parsed.error}`);
    console.error(RUNNER_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `transfer-backfill-runner: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  // Deferred imports so argument/env validation always runs first and the
  // server-only service modules never load for an invalid invocation.
  const { PrismaClient } = await import("@prisma/client");
  const { createPrismaAdapter } = await import("@/lib/prisma-adapter");
  const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");

  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

  const deps: RunnerDeps = {
    db: prisma as unknown as RunnerDbClient,
    resolveWallet: resolveTrackedWalletByAddress,
    httpGet: async (url) => {
      const res = await fetch(url);
      return { status: res.status, body: await res.json().catch(() => undefined) };
    },
    httpPost: async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => undefined) };
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeEvidence: (record) => writeEvidenceLine(parsed.options.evidenceDir, record),
    verifyDecimalCapability: () => verifyDecimalSerializationCapability(),
  };

  try {
    const summary = await runTransferBackfillRunner(parsed.options, deps);
    console.log(safeStringify(summary));
    if (summary.stoppedReason === "invariant_failed_after_run" || summary.stoppedReason.endsWith("_failed")) {
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`transfer-backfill-runner error: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`transfer-backfill-runner error: ${message}`);
    process.exitCode = 1;
  });
}
