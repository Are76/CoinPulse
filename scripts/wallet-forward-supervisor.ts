/**
 * Wallet-forward TRANSFERS completion SUPERVISOR — operator utility only.
 *
 * Thin orchestration layer that sequentially invokes the existing, unchanged
 * `scripts/wallet-forward-campaign-runner.ts` (as a child process) to reach
 * one immutable, operator-authorized final block. This file owns none of the
 * campaign runner's safety logic — cursor invariants, contamination/
 * duplicate checks, warning classification, checkpoint invariants, ambiguous
 * submission reconciliation, and recovery all remain exactly where they are.
 * See `docs/wallet-forward-supervisor-runbook.md` for the full operator
 * contract.
 *
 * What this file owns:
 *   - immutable fixed-target authorization (`--authorized-final-block`,
 *     never derived from chain head, never expanded after startup),
 *   - bounded child-campaign segmentation (`--campaign-max-windows` per
 *     child, respecting the child runner's own hard cap),
 *   - sequential child invocation via an injectable process-runner
 *     abstraction (never a direct import of the child runner's internal
 *     orchestration function),
 *   - child terminal-result verification (exit code, allowlisted clean
 *     `stoppedReason`, exact expected window count and cursor movement),
 *   - canonical PostgreSQL re-verification between children (cursor, repo
 *     HEAD, working tree),
 *   - supervisor-level append-only evidence referencing child evidence,
 *   - fail-closed stop/continue decisions.
 *
 * What this file NEVER does:
 *   - query chain head or derive/expand the authorized target,
 *   - retry a failed or ambiguous child campaign,
 *   - invoke `--recovery-mode` or any recovery flag on the child runner,
 *   - mutate `SyncCursor` or any canonical table directly,
 *   - rebuild, materialize, or trigger pricing,
 *   - run as a daemon/cron/queue — one invocation performs one bounded,
 *     interruptible sequence of child campaigns and then exits.
 *
 * Usage (dry-run, the safe default):
 *   npx tsx --conditions react-server scripts/wallet-forward-supervisor.ts \
 *     --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
 *     --chain-id 369 \
 *     --authorized-final-block 25088548 \
 *     --campaign-max-windows 10 --window-size 1000 \
 *     --campaign-id-prefix stage1-2026-08-19 \
 *     --policy-label-prefix wallet-forward-campaign \
 *     --base-url http://localhost:3000
 *
 * Required environment variables (identical to the campaign runner):
 *   DATABASE_URL  PostgreSQL connection string (canonical read-only state)
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * Exit behaviour:
 *   - Exits 0 only for genuine non-error completion: the immutable
 *     `--authorized-final-block` was reached (`authorized_final_block_reached`)
 *     or was already reached before any child ran
 *     (`authorized_final_block_already_reached`).
 *   - Exits 1 on invalid arguments, missing environment, or any gate,
 *     drift, or evidence failure.
 *   - Never prints DATABASE_URL, REDIS_URL, RPC URLs, secrets, or headers.
 */

import { fileURLToPath } from "url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  SUPPORTED_CHAIN_ID,
  WALLET_FORWARD_SYNC_SOURCE_FAMILIES,
  type GateResult,
  validateSupportedChain,
  validateWindowSize,
  checkEnv,
  type EvidenceRecord,
  writeEvidenceLine,
  buildStopEvidenceRecord,
  type RunnerDbClient,
  getLiveTransfersCursor,
  type HttpResponse,
  type HttpGet,
  readHttpResponseBody,
  type WalletLookupClient,
  resolveWalletUsingPrismaClient,
  safeStringify,
} from "./lib/wallet-forward-sync-primitives";
import {
  CAMPAIGN_MAX_WINDOWS_HARD_CAP,
  CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS,
  CAMPAIGN_ID_PATTERN,
  CAMPAIGN_CLEAN_STOP_REASONS,
  validateCampaignWindowSize,
  validateCampaignMaxWindows,
  type CampaignSummary,
} from "./wallet-forward-campaign-runner";

const execFileAsync = promisify(execFile);

// ─── Supervisor-specific safety constants (not operator-overridable) ──────────

export const HTTP_REQUEST_TIMEOUT_MS = 60_000;

// ─── Pure planning: next bounded child campaign from canonical state ─────────

export type NextChildPlan =
  | {
      done: false;
      childCampaignNumber: number;
      anchorFromBlock: bigint;
      firstWindowStart: bigint;
      expectedCursorFromBlock: bigint;
      expectedCursorToBlock: bigint;
      childMaxWindows: number;
      childAuthorizedFinalBlock: bigint;
    }
  | { done: true; reason: "authorized_final_block_already_reached" };

/**
 * Derives the next bounded child campaign purely from canonical cursor state
 * plus the immutable operator inputs — never from any in-memory count of
 * previously-run children. Every call is independent and re-derivable, which
 * is what lets a fresh supervisor invocation resume correctly after a crash:
 * it reads canonical PostgreSQL and reasons from there, not from local
 * process memory.
 */
export function computeNextChildPlan(args: {
  liveCursor: { fromBlock: bigint; toBlock: bigint };
  windowSizeBlocks: bigint;
  campaignMaxWindows: number;
  authorizedFinalBlock: bigint;
  childCampaignNumber: number;
}): NextChildPlan | { done: false; error: string } {
  const { liveCursor, windowSizeBlocks, campaignMaxWindows, authorizedFinalBlock, childCampaignNumber } = args;

  if (liveCursor.toBlock > authorizedFinalBlock) {
    return {
      done: false,
      error: `canonical cursor toBlock ${liveCursor.toBlock} is already beyond --authorized-final-block ${authorizedFinalBlock}`,
    };
  }
  if (liveCursor.toBlock === authorizedFinalBlock) {
    return { done: true, reason: "authorized_final_block_already_reached" };
  }

  const remainingBlocks = authorizedFinalBlock - liveCursor.toBlock;
  if (remainingBlocks % windowSizeBlocks !== 0n) {
    return {
      done: false,
      error: `remaining span ${remainingBlocks} (from canonical cursor toBlock ${liveCursor.toBlock} to --authorized-final-block ${authorizedFinalBlock}) does not align to full ${windowSizeBlocks}-block windows`,
    };
  }
  const remainingWindows = remainingBlocks / windowSizeBlocks;
  const childWindowsBig =
    remainingWindows < BigInt(campaignMaxWindows) ? remainingWindows : BigInt(campaignMaxWindows);
  const childMaxWindows = Number(childWindowsBig);
  const firstWindowStart = liveCursor.toBlock + 1n;
  const childAuthorizedFinalBlock = firstWindowStart + childWindowsBig * windowSizeBlocks - 1n;

  if (childAuthorizedFinalBlock > authorizedFinalBlock) {
    // Defense in depth: this can never happen given the arithmetic above
    // (childWindowsBig <= remainingWindows by construction), but the
    // immutable target boundary is re-checked explicitly rather than only
    // trusted implicitly.
    return {
      done: false,
      error: `internal error: derived child authorized-final-block ${childAuthorizedFinalBlock} would exceed the immutable --authorized-final-block ${authorizedFinalBlock}`,
    };
  }

  return {
    done: false,
    childCampaignNumber,
    anchorFromBlock: liveCursor.fromBlock,
    firstWindowStart,
    expectedCursorFromBlock: liveCursor.fromBlock,
    expectedCursorToBlock: liveCursor.toBlock,
    childMaxWindows,
    childAuthorizedFinalBlock,
  };
}

// ─── Pure verification: exact clean child terminal result ────────────────────

export type ChildProcessResult = { exitCode: number; stdout: string; stderr: string };

export type ChildResultVerification = { ok: true; summary: CampaignSummary } | { ok: false; reason: string };

/**
 * Parses the child runner's stdout (its single `console.log(safeStringify(summary))`
 * line) and verifies it represents an EXACT clean terminal completion for the
 * exact bounded child campaign the supervisor asked for. Anything else —
 * non-zero exit, unparseable stdout, a `stoppedReason` outside the child
 * runner's own allowlist, or a window/cursor count that does not exactly
 * match what was requested — fails closed. The supervisor never infers a
 * partial success.
 */
export function verifyChildCleanResult(args: {
  processResult: ChildProcessResult;
  expectedWindowsCompleted: number;
}): ChildResultVerification {
  const { processResult, expectedWindowsCompleted } = args;

  if (processResult.exitCode !== 0) {
    return {
      ok: false,
      reason: `child process exited with code ${processResult.exitCode}: ${processResult.stderr.trim() || "(no stderr)"}`,
    };
  }

  const lines = processResult.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) {
    return { ok: false, reason: "child process produced no stdout output to parse a campaign summary from" };
  }

  let summary: CampaignSummary;
  try {
    summary = JSON.parse(lastLine) as CampaignSummary;
  } catch (err) {
    return {
      ok: false,
      reason: `child process stdout could not be parsed as JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof summary !== "object" || summary === null || typeof summary.stoppedReason !== "string") {
    return { ok: false, reason: "child process summary is missing a valid stoppedReason" };
  }

  if (!CAMPAIGN_CLEAN_STOP_REASONS.has(summary.stoppedReason)) {
    return {
      ok: false,
      reason: `child campaign stoppedReason "${summary.stoppedReason}" is not an allowlisted clean completion${summary.detail ? `: ${summary.detail}` : ""}`,
    };
  }

  if (summary.windowsCompleted !== expectedWindowsCompleted) {
    return {
      ok: false,
      reason: `child campaign completed ${summary.windowsCompleted} window(s), expected exactly ${expectedWindowsCompleted}`,
    };
  }

  if (summary.lastWindowNumber !== expectedWindowsCompleted) {
    return {
      ok: false,
      reason: `child campaign lastWindowNumber ${summary.lastWindowNumber} does not match expected final logical window number ${expectedWindowsCompleted}`,
    };
  }

  return { ok: true, summary };
}

/** Verifies the canonical PostgreSQL cursor after a child campaign completed
 * moved EXACTLY as expected — anchor unchanged, toBlock at exactly the
 * child's authorized boundary. Never inferred from the child's self-reported
 * summary alone. */
export function verifyCanonicalCursorAfterChild(args: {
  liveCursorAfter: { fromBlock: bigint; toBlock: bigint } | null;
  expectedAnchorFromBlock: bigint;
  expectedToBlock: bigint;
}): GateResult {
  if (!args.liveCursorAfter) {
    return { ok: false, reason: "canonical TRANSFERS SyncCursor is missing after the child campaign completed" };
  }
  if (args.liveCursorAfter.fromBlock !== args.expectedAnchorFromBlock) {
    return {
      ok: false,
      reason: `expected canonical cursor fromBlock to remain anchored at ${args.expectedAnchorFromBlock}, got ${args.liveCursorAfter.fromBlock}`,
    };
  }
  if (args.liveCursorAfter.toBlock !== args.expectedToBlock) {
    return {
      ok: false,
      reason: `expected canonical cursor toBlock ${args.expectedToBlock} after the child campaign, got ${args.liveCursorAfter.toBlock}`,
    };
  }
  return { ok: true };
}

/** Between-campaign repository drift gate — only local HEAD identity and
 * working-tree cleanliness are checked, exactly like the campaign runner's
 * own checkpoint gate. `origin/main` moving is explicitly not a drift
 * failure. */
export function evaluateRepositoryDrift(args: {
  supervisorStartHead: string;
  currentHead: string;
  workingTreeClean: boolean;
}): GateResult {
  if (args.currentHead !== args.supervisorStartHead) {
    return {
      ok: false,
      reason: `local HEAD changed from ${args.supervisorStartHead} to ${args.currentHead} since supervisor start`,
    };
  }
  if (!args.workingTreeClean) {
    return { ok: false, reason: "working tree is not clean" };
  }
  return { ok: true };
}

// ─── Supervisor-scoped validation gates (pure) ────────────────────────────────

export function validateCampaignMaxWindowsForSupervisor(args: { campaignMaxWindows: number }): GateResult {
  return validateCampaignMaxWindows({ maxWindows: args.campaignMaxWindows });
}

export function validateCampaignIdPrefix(args: { campaignIdPrefix: string }): GateResult {
  // The supervisor builds each child's --campaign-id as
  // `${campaignIdPrefix}-c${childCampaignNumber}`. The child runner enforces
  // its own CAMPAIGN_ID_PATTERN on the fully-built id, so validating the
  // prefix here with the same charset (a prefix is itself a valid, shorter
  // campaign id) catches an invalid prefix before any child is invoked,
  // rather than surfacing as a confusing child-side failure later.
  if (!CAMPAIGN_ID_PATTERN.test(args.campaignIdPrefix)) {
    return {
      ok: false,
      reason:
        '--campaign-id-prefix must start with a letter or digit and contain only letters, digits, "-", or "_", 1-64 characters total',
    };
  }
  return { ok: true };
}

export function buildChildCampaignId(campaignIdPrefix: string, childCampaignNumber: number): string {
  return `${campaignIdPrefix}-c${childCampaignNumber}`;
}

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type SupervisorCliOptions = {
  execute: boolean;
  walletAddress: string;
  chainId: number;
  authorizedFinalBlock: bigint;
  campaignMaxWindows: number;
  windowSizeBlocks: bigint;
  campaignIdPrefix: string;
  policyLabelPrefix: string;
  checkpointIntervalWindows: number;
  baseUrl: string;
  evidenceFile: string;
  childEvidenceFile: string | undefined;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  runnerScriptPath: string;
};

export type SupervisorCliParseResult =
  | { ok: true; options: SupervisorCliOptions }
  | { ok: false; error: string };

export const SUPERVISOR_CLI_USAGE = [
  "Usage: wallet-forward-supervisor --wallet-address <0x..> --chain-id <n>",
  "         --authorized-final-block <blockNumber>",
  "         --campaign-max-windows <1-1000> --window-size 1000",
  "         --campaign-id-prefix <id> --policy-label-prefix <label>",
  "         --base-url <url> [--checkpoint-interval <1-25>] [--execute]",
  "         [--evidence-file <path>] [--child-evidence-file <path>]",
  "         [--poll-interval-ms <n>] [--poll-timeout-ms <n>]",
  "         [--runner-script <path>]",
  "",
  "  Dry-run is the default and never submits an HTTP POST (it invokes the",
  "  child campaign runner in dry-run mode).",
  "  --authorized-final-block is an IMMUTABLE operator input. The supervisor",
  "  never queries chain head, never computes a new target, and never",
  "  expands this value while running.",
  "  --campaign-max-windows bounds each CHILD campaign (same [1,1000] range",
  "  and same fixed --window-size=1000 rule as the campaign runner). The",
  "  supervisor may invoke multiple bounded children sequentially to reach",
  "  --authorized-final-block.",
  "  --campaign-id-prefix builds each child's --campaign-id as",
  "  \"<prefix>-c<childCampaignNumber>\".",
  "  All of --wallet-address, --chain-id, --authorized-final-block,",
  "  --campaign-max-windows, --window-size, --campaign-id-prefix,",
  "  --policy-label-prefix, and --base-url are required.",
  "  There is no --recovery-mode flag: the supervisor never invokes child",
  "  recovery. A recovery decision always requires a separate, explicit",
  "  operator-run invocation of the campaign runner itself.",
].join("\n");

const DEFAULT_EVIDENCE_FILE = "operator-evidence/wallet-forward-supervisor/evidence.jsonl";
const DEFAULT_CHECKPOINT_INTERVAL = 25;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_RUNNER_SCRIPT_PATH = "scripts/wallet-forward-campaign-runner.ts";

function readValue(argv: readonly string[], index: number): string | null {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return null;
  }
  return value;
}

export function parseSupervisorCliArgs(argv: readonly string[]): SupervisorCliParseResult {
  let execute = false;
  let walletAddress: string | undefined;
  let chainId: number | undefined;
  let authorizedFinalBlock: bigint | undefined;
  let campaignMaxWindows: number | undefined;
  let windowSizeBlocks: bigint | undefined;
  let campaignIdPrefix: string | undefined;
  let policyLabelPrefix: string | undefined;
  let checkpointIntervalWindows = DEFAULT_CHECKPOINT_INTERVAL;
  let baseUrl: string | undefined;
  let evidenceFile = DEFAULT_EVIDENCE_FILE;
  let childEvidenceFile: string | undefined;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;
  let runnerScriptPath = DEFAULT_RUNNER_SCRIPT_PATH;

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
    if (arg === "--authorized-final-block") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value)) {
        return { ok: false, error: "--authorized-final-block must be an unsigned integer." };
      }
      authorizedFinalBlock = BigInt(value);
      index += 1;
      continue;
    }
    if (arg === "--campaign-max-windows") {
      const value = readValue(argv, index);
      if (value === null || !/^-?\d+$/.test(value)) {
        return { ok: false, error: "--campaign-max-windows must be an integer." };
      }
      campaignMaxWindows = Number(value);
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
    if (arg === "--campaign-id-prefix") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--campaign-id-prefix requires a value." };
      campaignIdPrefix = value;
      index += 1;
      continue;
    }
    if (arg === "--policy-label-prefix") {
      const value = readValue(argv, index);
      if (value === null || value.length === 0) {
        return { ok: false, error: "--policy-label-prefix must be a non-empty string." };
      }
      if (value !== value.trim()) {
        return {
          ok: false,
          error: "--policy-label-prefix must not have leading or trailing whitespace.",
        };
      }
      policyLabelPrefix = value;
      index += 1;
      continue;
    }
    if (arg === "--checkpoint-interval") {
      const value = readValue(argv, index);
      if (value === null || !/^\d+$/.test(value) || Number(value) < 1) {
        return { ok: false, error: "--checkpoint-interval must be a positive integer." };
      }
      checkpointIntervalWindows = Number(value);
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
    if (arg === "--child-evidence-file") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--child-evidence-file requires a value." };
      childEvidenceFile = value;
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
    if (arg === "--runner-script") {
      const value = readValue(argv, index);
      if (value === null || value.length === 0) {
        return { ok: false, error: "--runner-script must be a non-empty path." };
      }
      runnerScriptPath = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (walletAddress === undefined) return { ok: false, error: "--wallet-address is required." };
  if (chainId === undefined) return { ok: false, error: "--chain-id is required." };
  if (authorizedFinalBlock === undefined) {
    return { ok: false, error: "--authorized-final-block is required." };
  }
  if (campaignMaxWindows === undefined) return { ok: false, error: "--campaign-max-windows is required." };
  if (windowSizeBlocks === undefined) return { ok: false, error: "--window-size is required." };
  if (campaignIdPrefix === undefined) return { ok: false, error: "--campaign-id-prefix is required." };
  if (policyLabelPrefix === undefined) {
    return { ok: false, error: "--policy-label-prefix is required." };
  }
  if (baseUrl === undefined) {
    return { ok: false, error: "--base-url is required and must be passed explicitly." };
  }

  const chainGate = validateSupportedChain({ chainId });
  if (!chainGate.ok) return { ok: false, error: chainGate.reason };

  const windowSizeGate = validateWindowSize({ windowSizeBlocks });
  if (!windowSizeGate.ok) return { ok: false, error: windowSizeGate.reason };

  const campaignWindowSizeGate = validateCampaignWindowSize({ windowSizeBlocks });
  if (!campaignWindowSizeGate.ok) return { ok: false, error: campaignWindowSizeGate.reason };

  const maxWindowsGate = validateCampaignMaxWindowsForSupervisor({ campaignMaxWindows });
  if (!maxWindowsGate.ok) return { ok: false, error: maxWindowsGate.reason };

  const campaignIdPrefixGate = validateCampaignIdPrefix({ campaignIdPrefix });
  if (!campaignIdPrefixGate.ok) return { ok: false, error: campaignIdPrefixGate.reason };

  return {
    ok: true,
    options: {
      execute,
      walletAddress,
      chainId,
      authorizedFinalBlock,
      campaignMaxWindows,
      windowSizeBlocks,
      campaignIdPrefix,
      policyLabelPrefix,
      checkpointIntervalWindows,
      baseUrl,
      evidenceFile,
      childEvidenceFile,
      pollIntervalMs,
      pollTimeoutMs,
      runnerScriptPath,
    },
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export type SupervisorDeps = {
  db: RunnerDbClient;
  resolveWallet: (args: { walletAddress: string; chainId: number }) => Promise<{ id: string; address: string } | null>;
  httpGet: HttpGet;
  now: () => Date;
  writeEvidence: (record: EvidenceRecord) => Promise<void>;
  getGitHead: () => Promise<string>;
  isWorkingTreeClean: () => Promise<boolean>;
  /** Injectable child-process runner — the ONLY way this file ever invokes
   * the campaign runner. Never a direct import of its orchestration
   * function, so the child remains a truly separate, independently
   * reviewable process boundary. */
  runChildCampaign: (args: string[]) => Promise<ChildProcessResult>;
  isInterrupted: () => boolean;
};

export type SupervisorSummary = {
  stoppedReason: string;
  detail?: string;
  childCampaignsCompleted: number;
  lastChildCampaignNumber: number | null;
};

/** Genuine, non-error supervisor completion. Every other stoppedReason is a
 * hard stop and exits nonzero. */
export const SUPERVISOR_CLEAN_STOP_REASONS: ReadonlySet<string> = new Set([
  "authorized_final_block_reached",
  "authorized_final_block_already_reached",
]);

export function computeSupervisorExitCode(stoppedReason: string): 0 | 1 {
  return SUPERVISOR_CLEAN_STOP_REASONS.has(stoppedReason) ? 0 : 1;
}

async function writeEvidenceOrNull(
  deps: SupervisorDeps,
  record: EvidenceRecord,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await deps.writeEvidence(record);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function stopSupervisor(
  deps: SupervisorDeps,
  reason: string,
  detail: string | undefined,
  childCampaignsCompleted: number,
  lastChildCampaignNumber: number | null,
  extra?: Record<string, unknown>,
): Promise<SupervisorSummary> {
  await writeEvidenceOrNull(
    deps,
    buildStopEvidenceRecord({ at: deps.now().toISOString(), reason, detail, extra }),
  );
  return { stoppedReason: reason, detail, childCampaignsCompleted, lastChildCampaignNumber };
}

async function checkServerHealth(httpGet: HttpGet, baseUrl: string): Promise<GateResult> {
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

function buildChildArgs(args: {
  options: SupervisorCliOptions;
  plan: Extract<NextChildPlan, { done: false; error?: undefined }>;
}): string[] {
  const { options, plan } = args;
  const childArgs = [
    options.runnerScriptPath,
    "--wallet-address",
    options.walletAddress,
    "--chain-id",
    String(options.chainId),
    "--expected-cursor-from",
    plan.expectedCursorFromBlock.toString(),
    "--expected-cursor-to",
    plan.expectedCursorToBlock.toString(),
    "--first-window-start",
    plan.firstWindowStart.toString(),
    "--window-size",
    options.windowSizeBlocks.toString(),
    "--max-windows",
    String(plan.childMaxWindows),
    "--authorized-final-block",
    plan.childAuthorizedFinalBlock.toString(),
    "--campaign-id",
    buildChildCampaignId(options.campaignIdPrefix, plan.childCampaignNumber),
    "--policy-label-prefix",
    options.policyLabelPrefix,
    "--checkpoint-interval",
    String(options.checkpointIntervalWindows),
    "--base-url",
    options.baseUrl,
    "--poll-interval-ms",
    String(options.pollIntervalMs),
    "--poll-timeout-ms",
    String(options.pollTimeoutMs),
  ];
  if (options.childEvidenceFile) {
    childArgs.push("--evidence-file", options.childEvidenceFile);
  }
  if (options.execute) {
    childArgs.push("--execute");
  }
  // Deliberately never appended: --recovery-mode, --recovery-of-run-id. The
  // supervisor never has a code path that can pass these.
  return childArgs;
}

export async function runWalletForwardSupervisor(
  options: SupervisorCliOptions,
  deps: SupervisorDeps,
): Promise<SupervisorSummary> {
  const startedAt = deps.now().toISOString();

  // ── Step 1: re-validate immutable options at runtime — never trust that
  // CLI parsing already validated these, since a direct caller (including a
  // test) can construct SupervisorCliOptions without going through
  // parseSupervisorCliArgs. ──
  const windowSizeGate = validateCampaignWindowSize({ windowSizeBlocks: options.windowSizeBlocks });
  if (!windowSizeGate.ok) {
    return stopSupervisor(deps, "invalid_window_size", windowSizeGate.reason, 0, null);
  }
  const maxWindowsGate = validateCampaignMaxWindowsForSupervisor({ campaignMaxWindows: options.campaignMaxWindows });
  if (!maxWindowsGate.ok) {
    return stopSupervisor(deps, "invalid_campaign_max_windows", maxWindowsGate.reason, 0, null);
  }
  const campaignIdPrefixGate = validateCampaignIdPrefix({ campaignIdPrefix: options.campaignIdPrefix });
  if (!campaignIdPrefixGate.ok) {
    return stopSupervisor(deps, "invalid_campaign_id_prefix", campaignIdPrefixGate.reason, 0, null);
  }

  // ── Step 2: obtain approved local HEAD. ──
  let supervisorStartHead: string;
  try {
    supervisorStartHead = await deps.getGitHead();
  } catch (err) {
    return stopSupervisor(deps, "git_head_unavailable", err instanceof Error ? err.message : String(err), 0, null);
  }

  // ── Step 3: mandatory startup gate — clean working tree. ──
  const workingTreeCleanAtStart = await deps.isWorkingTreeClean();
  if (!workingTreeCleanAtStart) {
    return stopSupervisor(deps, "working_tree_dirty", "working tree is not clean at supervisor start", 0, null);
  }

  // ── Step 4: healthy environment baseline. ──
  const startHealth = await checkServerHealth(deps.httpGet, options.baseUrl);
  if (!startHealth.ok) {
    return stopSupervisor(deps, "initial_health_baseline_failed", startHealth.reason, 0, null);
  }

  // ── Step 5: resolve wallet. ──
  const wallet = await deps.resolveWallet({ walletAddress: options.walletAddress, chainId: options.chainId });
  if (!wallet) {
    return stopSupervisor(deps, "wallet_not_found", undefined, 0, null);
  }

  // ── Step 6: persist supervisor_start evidence. ──
  const startWrite = await writeEvidenceOrNull(deps, {
    kind: "supervisor_start",
    at: startedAt,
    mode: options.execute ? "execute" : "dry-run",
    walletAddress: options.walletAddress,
    chainId: options.chainId,
    sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
    authorizedFinalBlock: options.authorizedFinalBlock.toString(),
    campaignMaxWindows: options.campaignMaxWindows,
    windowSizeBlocks: options.windowSizeBlocks.toString(),
    campaignIdPrefix: options.campaignIdPrefix,
    policyLabelPrefix: options.policyLabelPrefix,
    supervisorStartHead,
    baseUrl: options.baseUrl,
  });
  if (!startWrite.ok) {
    return { stoppedReason: "evidence_append_failed", detail: startWrite.message, childCampaignsCompleted: 0, lastChildCampaignNumber: null };
  }

  let childCampaignsCompleted = 0;
  let lastChildCampaignNumber: number | null = null;
  let childCampaignNumber = 1;

  for (;;) {
    // ── SIGINT must stop before another child campaign starts. Checked at
    // the top of every iteration, including the first. ──
    if (deps.isInterrupted()) {
      return stopSupervisor(deps, "interrupted", "SIGINT received before starting the next child campaign", childCampaignsCompleted, lastChildCampaignNumber);
    }

    // ── Read/verify canonical starting state fresh on every iteration —
    // never trust an in-memory cursor value carried over from a previous
    // child. This is also what lets a fresh supervisor invocation resume
    // correctly after a crash. ──
    const liveCursor = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
    if (!liveCursor) {
      return stopSupervisor(deps, "canonical_cursor_missing", "no TRANSFERS SyncCursor exists for this wallet/chain", childCampaignsCompleted, lastChildCampaignNumber);
    }

    // ── Repository drift gate — HEAD and working tree, re-checked before
    // every child (not merely at supervisor start). ──
    const currentHead = await deps.getGitHead();
    const workingTreeClean = await deps.isWorkingTreeClean();
    const driftGate = evaluateRepositoryDrift({ supervisorStartHead, currentHead, workingTreeClean });
    if (!driftGate.ok) {
      return stopSupervisor(deps, "repository_drift_detected", driftGate.reason, childCampaignsCompleted, lastChildCampaignNumber);
    }

    // ── Environment health, re-checked before every child. ──
    const health = await checkServerHealth(deps.httpGet, options.baseUrl);
    if (!health.ok) {
      return stopSupervisor(deps, "health_check_failed", health.reason, childCampaignsCompleted, lastChildCampaignNumber);
    }

    const plan = computeNextChildPlan({
      liveCursor,
      windowSizeBlocks: options.windowSizeBlocks,
      campaignMaxWindows: options.campaignMaxWindows,
      authorizedFinalBlock: options.authorizedFinalBlock,
      childCampaignNumber,
    });

    if ("error" in plan) {
      return stopSupervisor(deps, "canonical_state_invalid", plan.error, childCampaignsCompleted, lastChildCampaignNumber);
    }
    if (plan.done) {
      const summaryWrite = await writeEvidenceOrNull(deps, {
        kind: "supervisor_summary",
        at: deps.now().toISOString(),
        stoppedReason: plan.reason,
        childCampaignsCompleted,
        lastChildCampaignNumber,
        authorizedFinalBlock: options.authorizedFinalBlock.toString(),
      });
      if (!summaryWrite.ok) {
        return { stoppedReason: "evidence_append_failed", detail: summaryWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
      }
      return { stoppedReason: plan.reason, childCampaignsCompleted, lastChildCampaignNumber };
    }

    const childArgs = buildChildArgs({ options, plan });
    const childCampaignId = buildChildCampaignId(options.campaignIdPrefix, plan.childCampaignNumber);

    const childStartWrite = await writeEvidenceOrNull(deps, {
      kind: "child_campaign_start",
      at: deps.now().toISOString(),
      childCampaignNumber: plan.childCampaignNumber,
      childCampaignId,
      walletAddress: options.walletAddress,
      chainId: options.chainId,
      sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
      canonicalCursorBefore: { fromBlock: liveCursor.fromBlock.toString(), toBlock: liveCursor.toBlock.toString() },
      authorizedFinalBlock: options.authorizedFinalBlock.toString(),
      expectedChildRange: { startBlock: plan.firstWindowStart.toString(), endBlock: plan.childAuthorizedFinalBlock.toString() },
      childMaxWindows: plan.childMaxWindows,
      childEvidenceFile: options.childEvidenceFile ?? null,
    });
    if (!childStartWrite.ok) {
      return { stoppedReason: "evidence_append_failed", detail: childStartWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
    }

    let processResult: ChildProcessResult;
    try {
      processResult = await deps.runChildCampaign(childArgs);
    } catch (err) {
      // The child process itself could not even be spawned/awaited (e.g. the
      // OS refused to spawn it). This is never treated as an ambiguous
      // submission requiring reconciliation — that logic belongs entirely to
      // the child runner for its own HTTP POST. Here it is simply a hard
      // stop: the supervisor never guesses whether the child mutated
      // anything.
      return stopSupervisor(
        deps,
        "child_process_spawn_failed",
        err instanceof Error ? err.message : String(err),
        childCampaignsCompleted,
        lastChildCampaignNumber,
        { childCampaignNumber: plan.childCampaignNumber, childCampaignId },
      );
    }

    const verification = verifyChildCleanResult({
      processResult,
      expectedWindowsCompleted: plan.childMaxWindows,
    });

    if (!verification.ok) {
      const resultWrite = await writeEvidenceOrNull(deps, {
        kind: "child_campaign_result",
        at: deps.now().toISOString(),
        childCampaignNumber: plan.childCampaignNumber,
        childCampaignId,
        ok: false,
        reason: verification.reason,
        exitCode: processResult.exitCode,
      });
      if (!resultWrite.ok) {
        return { stoppedReason: "evidence_append_failed", detail: resultWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
      }
      return stopSupervisor(
        deps,
        "child_result_not_clean",
        verification.reason,
        childCampaignsCompleted,
        lastChildCampaignNumber,
        { childCampaignNumber: plan.childCampaignNumber, childCampaignId },
      );
    }

    // ── Verify canonical cursor moved EXACTLY as expected. Never trust the
    // child's self-reported summary alone for this. ──
    const liveCursorAfter = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
    const cursorGate = verifyCanonicalCursorAfterChild({
      liveCursorAfter,
      expectedAnchorFromBlock: plan.anchorFromBlock,
      expectedToBlock: plan.childAuthorizedFinalBlock,
    });
    if (!cursorGate.ok) {
      const resultWrite = await writeEvidenceOrNull(deps, {
        kind: "child_campaign_result",
        at: deps.now().toISOString(),
        childCampaignNumber: plan.childCampaignNumber,
        childCampaignId,
        ok: false,
        reason: cursorGate.reason,
        exitCode: processResult.exitCode,
      });
      if (!resultWrite.ok) {
        return { stoppedReason: "evidence_append_failed", detail: resultWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
      }
      return stopSupervisor(
        deps,
        "canonical_cursor_mismatch_after_child",
        cursorGate.reason,
        childCampaignsCompleted,
        lastChildCampaignNumber,
        { childCampaignNumber: plan.childCampaignNumber, childCampaignId },
      );
    }

    const resultWrite = await writeEvidenceOrNull(deps, {
      kind: "child_campaign_result",
      at: deps.now().toISOString(),
      childCampaignNumber: plan.childCampaignNumber,
      childCampaignId,
      ok: true,
      exitCode: processResult.exitCode,
      stoppedReason: verification.summary.stoppedReason,
      windowsCompleted: verification.summary.windowsCompleted,
      canonicalCursorAfter: { fromBlock: plan.anchorFromBlock.toString(), toBlock: plan.childAuthorizedFinalBlock.toString() },
      childEvidenceFile: options.childEvidenceFile ?? null,
    });
    if (!resultWrite.ok) {
      return { stoppedReason: "evidence_append_failed", detail: resultWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
    }

    childCampaignsCompleted += 1;
    lastChildCampaignNumber = plan.childCampaignNumber;
    childCampaignNumber += 1;

    if (plan.childAuthorizedFinalBlock === options.authorizedFinalBlock) {
      const summaryWrite = await writeEvidenceOrNull(deps, {
        kind: "supervisor_summary",
        at: deps.now().toISOString(),
        stoppedReason: "authorized_final_block_reached",
        childCampaignsCompleted,
        lastChildCampaignNumber,
        authorizedFinalBlock: options.authorizedFinalBlock.toString(),
      });
      if (!summaryWrite.ok) {
        return { stoppedReason: "evidence_append_failed", detail: summaryWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
      }
      return { stoppedReason: "authorized_final_block_reached", childCampaignsCompleted, lastChildCampaignNumber };
    }

    // Loop continues: next iteration re-reads canonical state fresh.
  }
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

async function defaultGetGitHead(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  return stdout.trim();
}

async function defaultIsWorkingTreeClean(): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"]);
  return stdout.trim().length === 0;
}

/** Real child-process runner: spawns `npx tsx --conditions react-server
 * <runner-script> <args>` and collects its exit code / stdout / stderr. This
 * is the ONLY place the supervisor's real implementation touches the child
 * runner — it never imports its orchestration function directly. */
function defaultRunChildCampaign(args: string[]): Promise<ChildProcessResult> {
  return new Promise((resolve, reject) => {
    const [scriptPath, ...rest] = args;
    const child = spawn("npx", ["tsx", "--conditions", "react-server", scriptPath, ...rest], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function main(): Promise<void> {
  const parsed = parseSupervisorCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`wallet-forward-supervisor: ${parsed.error}`);
    console.error(SUPERVISOR_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(`wallet-forward-supervisor: missing required environment variables: ${envCheck.missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // Deferred imports so argument/env validation always runs first.
  const { PrismaClient } = await import("@prisma/client");
  const { createPrismaAdapter } = await import("@/lib/prisma-adapter");

  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
  };
  process.on("SIGINT", onSigint);

  const deps: SupervisorDeps = {
    db: prisma as unknown as RunnerDbClient,
    resolveWallet: (args) => resolveWalletUsingPrismaClient(prisma as unknown as WalletLookupClient, args),
    httpGet: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS) });
      return { status: res.status, body: await readHttpResponseBody(res) };
    },
    now: () => new Date(),
    writeEvidence: (record) => writeEvidenceLine(parsed.options.evidenceFile, record),
    getGitHead: defaultGetGitHead,
    isWorkingTreeClean: defaultIsWorkingTreeClean,
    runChildCampaign: defaultRunChildCampaign,
    isInterrupted: () => interrupted,
  };

  try {
    const summary = await runWalletForwardSupervisor(parsed.options, deps);
    console.log(safeStringify(summary));
    process.exitCode = computeSupervisorExitCode(summary.stoppedReason);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-supervisor error: ${message}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSigint);
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-supervisor error: ${message}`);
    process.exitCode = 1;
  });
}

// Re-exported for reuse/testing convenience.
export { SUPPORTED_CHAIN_ID, CAMPAIGN_MAX_WINDOWS_HARD_CAP, CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS };
