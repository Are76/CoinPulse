/**
 * Wallet-scoped forward TRANSFERS sync CAMPAIGN runner — operator utility only.
 *
 * STAGE 0 IMPLEMENTATION ONLY. This file adds *implementation capability* for
 * a bounded, checkpointed, sequential campaign of up to 1,000 atomic
 * 1,000-block forward TRANSFERS windows. Implementation capability is not
 * live authorization: no window this file can plan or submit has been
 * approved for execution, and running it with `--execute` against a real
 * server is a decision entirely outside this PR. See
 * `docs/wallet-forward-campaign-runbook.md` for the staged live-rollout plan
 * (10 → 50 → 250 → 1000 windows, each requiring fresh product-owner
 * approval).
 *
 * This is a separate layer on top of, not a replacement for, the existing
 * 5-window-hard-capped `scripts/wallet-forward-sync-runner.ts`. That runner's
 * external CLI contract, hard cap, and behavior are unchanged by this file.
 * Both runners compose the exact same tested atomic-window safety primitives
 * from `scripts/lib/wallet-forward-sync-primitives.ts` — this file does not
 * duplicate that safety logic, only adds a campaign-scoped layer around it:
 *
 *   - up to 1,000 sequential atomic windows (vs. the 5-window runner's cap
 *     of 5),
 *   - an independent, mandatory `--authorized-final-block` boundary enforced
 *     at CLI validation, campaign planning, every next-window calculation,
 *     and immediately before every HTTP POST — a campaign stops at whichever
 *     of {max-windows, authorized-final-block} is reached first, and no
 *     request whose endBlock exceeds authorized-final-block is ever
 *     submitted, even if the max-windows arithmetic were somehow wrong,
 *   - an operator-supplied, restricted-charset `--campaign-id` used to build
 *     deterministic, collision-checked, length-verified policy labels whose
 *     logical window numbering is derived from block position (not this
 *     invocation's loop counter),
 *   - a fixed checkpoint every `--checkpoint-interval` windows (default 25,
 *     capped at 25) that re-verifies campaign-level invariants (local HEAD
 *     unchanged, clean working tree, backend health, environment/base-url
 *     classification unchanged, exact cursor, valid boundaries, writable
 *     evidence destination) before continuing. A PASSING checkpoint requires
 *     no fresh product-owner approval — the campaign continues automatically
 *     inside its already-approved boundaries. Any checkpoint FAILURE is a
 *     hard stop before the next POST like any other hard stop: remaining
 *     campaign authorization expires immediately (see below), and resuming
 *     requires a fresh bounded approval,
 *   - append-only JSONL evidence with `campaign_start` / `window` /
 *     `checkpoint` / `stop` / `campaign_summary` records — evidence append
 *     failure is itself a gate: canonical PostgreSQL state is never rolled
 *     back, but the next window is never submitted,
 *   - explicit, narrow ambiguous-submission recovery: if a `POST
 *     /api/sync/manual` call throws (the runner never received a `runId`,
 *     but the server may have accepted the request), the campaign runner may
 *     search for a candidate `SyncRun` by `policyLabel`, but only proceeds if
 *     canonical PostgreSQL returns EXACTLY ONE row matching the full expected
 *     identity (policyLabel, walletId, chainId, sourceFamilies, startBlock,
 *     endBlock). Zero matches, more than one match, or any identity mismatch
 *     fails closed — never an automatic resubmit,
 *   - no automatic retry, no automatic skip, and no automatic resume after a
 *     crash or hard stop: remaining campaign authorization expires
 *     immediately, and a later invocation requires fresh canonical-state
 *     verification and a fresh bounded approval (see
 *     `docs/wallet-forward-campaign-runbook.md`).
 *
 * This file, like the 5-window runner, never submits a rebuild,
 * materialization, or pricing request, never parallelizes windows, never
 * changes `MANUAL_SYNC_MAX_BLOCK_SPAN` or the `/api/sync/manual` contract,
 * and defaults to dry-run (`--execute` is required for any mutation).
 *
 * Usage (dry-run, the safe default):
 *   npx tsx --conditions react-server scripts/wallet-forward-campaign-runner.ts \
 *     --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
 *     --chain-id 369 \
 *     --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
 *     --first-window-start 25078549 --window-size 1000 \
 *     --max-windows 10 --authorized-final-block 25088548 \
 *     --campaign-id stage1-2026-08-15 \
 *     --policy-label-prefix wallet-forward-campaign \
 *     --checkpoint-interval 25 \
 *     --base-url http://localhost:3000
 *
 * Required environment variables (identical to the 5-window runner):
 *   DATABASE_URL  PostgreSQL connection string (direct read-only planning
 *                 queries and checkpoint verification; all mutations happen
 *                 through the HTTP route)
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * Exit behaviour:
 *   - Exits 0 only for genuine non-error completion: `max_windows_reached`
 *     or `authorized_final_block_reached`.
 *   - Exits 1 on invalid arguments, missing environment, or any invariant,
 *     checkpoint, or evidence failure.
 *   - Never prints DATABASE_URL, REDIS_URL, RPC URLs, secrets, or headers.
 */

import { fileURLToPath } from "url";
import { execFile } from "node:child_process";
import { access, constants as fsConstants, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  SUPPORTED_CHAIN_ID,
  WALLET_FORWARD_SYNC_SOURCE_FAMILIES,
  WINDOW_SIZE_HARD_CAP_BLOCKS,
  MIN_WINDOW_SIZE_BLOCKS,
  POLICY_LABEL_MAX_LENGTH,
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
  type EvidenceRecord,
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
  pollSyncRunToTerminal,
  type WalletLookupClient,
  resolveWalletUsingPrismaClient,
  safeStringify,
  type RecoveryCliOptions,
  parseRecoveryFlags,
  verifyRecoveryEligibility,
  verifyRecoveryWindowTerminalState,
  recoveryPolicyLabel,
} from "./lib/wallet-forward-sync-primitives";

const execFileAsync = promisify(execFile);

// ─── Campaign-specific safety constants (not operator-overridable) ────────────

/** Implementation ceiling only — see the module doc comment and
 * `docs/wallet-forward-campaign-runbook.md`. This value does NOT authorize a
 * 1000-window live campaign; live rollout is staged separately. */
export const CAMPAIGN_MAX_WINDOWS_HARD_CAP = 1000;
export const DEFAULT_CAMPAIGN_CHECKPOINT_INTERVAL = 25;
/** 25 is the MAXIMUM allowed checkpoint spacing, not merely a default
 * suggestion — an operator may checkpoint more often, never less. */
export const MAX_CAMPAIGN_CHECKPOINT_INTERVAL = 25;

/** Fixed HTTP request timeout for the campaign runner's default real HTTP
 * client (GET /api/debug/health, POST /api/sync/manual). A stuck POST is
 * especially dangerous because pollTimeoutMs only starts after the POST
 * resolves — without this, a hung request could block a campaign
 * indefinitely before the poll-timeout gate ever engages. */
export const HTTP_REQUEST_TIMEOUT_MS = 60_000;

export const CAMPAIGN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** The approved campaign architecture fixes the atomic window at exactly
 * 1,000 blocks so that the 1,000-window implementation ceiling maps exactly
 * to a 1,000,000-block maximum campaign span. The shared
 * `validateWindowSize` primitive intentionally keeps the existing 5-window
 * runner's broader (up to 1,001 inclusive blocks) semantics — that runner's
 * external behavior is out of scope here — so the campaign runner enforces
 * its own stricter, additional gate on top of it. */
export const CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS = 1_000n;

export function validateCampaignWindowSize(args: { windowSizeBlocks: bigint }): GateResult {
  if (args.windowSizeBlocks !== CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS) {
    return {
      ok: false,
      reason: `--window-size must equal exactly ${CAMPAIGN_REQUIRED_WINDOW_SIZE_BLOCKS} for the campaign runner (the atomic window is fixed at 1,000 blocks so that ${CAMPAIGN_MAX_WINDOWS_HARD_CAP} windows maps exactly to a 1,000,000-block maximum campaign span); got ${args.windowSizeBlocks}`,
    };
  }
  return { ok: true };
}

// ─── Campaign window planning (pure) ───────────────────────────────────────────

/**
 * Derives a window's logical campaign number purely from its block position
 * relative to `--first-window-start`, never from an invocation-local loop
 * counter. This is what "logical numbering must not depend on
 * invocation-local loop numbering" means in practice: even though Stage 0
 * has no persisted resume state (a fresh invocation's first planned window is
 * always logical window 1), the number is computed independently of the
 * loop's iteration index, so a future resume that recomputes
 * `--first-window-start` from live state would still (given that same
 * parameter) produce numbers consistent with block position, not with
 * "how many windows this process happened to loop over."
 */
export function computeLogicalCampaignWindowNumber(args: {
  startBlock: bigint;
  firstWindowStart: bigint;
  windowSizeBlocks: bigint;
}): number {
  const offset = args.startBlock - args.firstWindowStart;
  if (offset < 0n || offset % args.windowSizeBlocks !== 0n) {
    throw new Error(
      `internal error: startBlock ${args.startBlock} does not align to firstWindowStart ${args.firstWindowStart} with windowSize ${args.windowSizeBlocks}`,
    );
  }
  return Number(offset / args.windowSizeBlocks) + 1;
}

export function campaignWindowPolicyLabel(
  prefix: string,
  campaignId: string,
  logicalWindowNumber: number,
): string {
  return `${prefix}-${campaignId}-w${logicalWindowNumber}`;
}

export function computeCampaignWindowPlan(args: {
  liveCursorToBlock: bigint;
  windowSizeBlocks: bigint;
  firstWindowStart: bigint;
  policyLabelPrefix: string;
  campaignId: string;
}): WindowPlan {
  const range = computeNextWindowRange({
    liveCursorToBlock: args.liveCursorToBlock,
    windowSizeBlocks: args.windowSizeBlocks,
  });
  const logicalWindowNumber = computeLogicalCampaignWindowNumber({
    startBlock: range.startBlock,
    firstWindowStart: args.firstWindowStart,
    windowSizeBlocks: args.windowSizeBlocks,
  });
  return {
    windowNumber: logicalWindowNumber,
    startBlock: range.startBlock,
    endBlock: range.endBlock,
    policyLabel: campaignWindowPolicyLabel(args.policyLabelPrefix, args.campaignId, logicalWindowNumber),
    blockCount: range.blockCount,
  };
}

// ─── Campaign-scoped validation gates (pure) ───────────────────────────────────

export function validateCampaignMaxWindows(args: { maxWindows: number }): GateResult {
  if (!Number.isInteger(args.maxWindows) || args.maxWindows < 1 || args.maxWindows > CAMPAIGN_MAX_WINDOWS_HARD_CAP) {
    return {
      ok: false,
      reason: `--max-windows must be an integer between 1 and ${CAMPAIGN_MAX_WINDOWS_HARD_CAP}`,
    };
  }
  return { ok: true };
}

export function validateCampaignId(args: { campaignId: string }): GateResult {
  if (!CAMPAIGN_ID_PATTERN.test(args.campaignId)) {
    return {
      ok: false,
      reason:
        '--campaign-id must start with a letter or digit and contain only letters, digits, "-", or "_", 1-64 characters total',
    };
  }
  return { ok: true };
}

/**
 * Checkpoint spacing is bounded to `[1, MAX_CAMPAIGN_CHECKPOINT_INTERVAL]`.
 * An operator may checkpoint MORE often than every 25 windows (tighter
 * spacing only strengthens the safety net); a wider spacing is rejected
 * outright, since it would defeat the approved 25-window checkpoint
 * baseline.
 */
export function validateCheckpointInterval(args: { checkpointIntervalWindows: number }): GateResult {
  if (!Number.isInteger(args.checkpointIntervalWindows) || args.checkpointIntervalWindows < 1) {
    return { ok: false, reason: "--checkpoint-interval must be a positive integer" };
  }
  if (args.checkpointIntervalWindows > MAX_CAMPAIGN_CHECKPOINT_INTERVAL) {
    return {
      ok: false,
      reason: `--checkpoint-interval must not exceed ${MAX_CAMPAIGN_CHECKPOINT_INTERVAL} (that is the maximum allowed checkpoint spacing, not merely a default); got ${args.checkpointIntervalWindows}`,
    };
  }
  return { ok: true };
}

/**
 * `authorizedFinalBlock` must equal `firstWindowStart + N * windowSizeBlocks - 1`
 * for a positive integer N — i.e. it must align exactly to full windows
 * starting at `--first-window-start`. No partial final window is permitted
 * in this PR. Returns the implied window count N so callers can derive the
 * tighter of {--max-windows, N} without re-deriving the arithmetic.
 */
export function validateAuthorizedFinalBlockAlignment(args: {
  firstWindowStart: bigint;
  windowSizeBlocks: bigint;
  authorizedFinalBlock: bigint;
}): { ok: true; windowCount: number } | { ok: false; reason: string } {
  if (args.authorizedFinalBlock < args.firstWindowStart) {
    return {
      ok: false,
      reason: `--authorized-final-block ${args.authorizedFinalBlock} is below --first-window-start ${args.firstWindowStart}`,
    };
  }
  const span = args.authorizedFinalBlock - args.firstWindowStart + 1n;
  if (span % args.windowSizeBlocks !== 0n) {
    return {
      ok: false,
      reason: `--authorized-final-block ${args.authorizedFinalBlock} does not align to full ${args.windowSizeBlocks}-block windows starting at --first-window-start ${args.firstWindowStart} (no partial final window permitted)`,
    };
  }
  const windowCountBigint = span / args.windowSizeBlocks;
  if (windowCountBigint < 1n) {
    return { ok: false, reason: "--authorized-final-block must cover at least one full window" };
  }
  if (windowCountBigint > BigInt(CAMPAIGN_MAX_WINDOWS_HARD_CAP)) {
    return {
      ok: false,
      reason: `--authorized-final-block implies ${windowCountBigint} windows, exceeding the campaign hard cap of ${CAMPAIGN_MAX_WINDOWS_HARD_CAP}`,
    };
  }
  return { ok: true, windowCount: Number(windowCountBigint) };
}

/**
 * Independent pre-POST boundary gate. Checked immediately before every HTTP
 * POST, in addition to the aligned-window-count derivation above — so even
 * if `--max-windows` arithmetic somehow allowed a window past the
 * authorization boundary, this gate alone still prevents the request.
 */
export function validateWithinAuthorizedFinalBlock(args: {
  endBlock: bigint;
  authorizedFinalBlock: bigint;
}): GateResult {
  if (args.endBlock > args.authorizedFinalBlock) {
    return {
      ok: false,
      reason: `window endBlock ${args.endBlock} exceeds --authorized-final-block ${args.authorizedFinalBlock}`,
    };
  }
  return { ok: true };
}

export function validateLongestGeneratedLabel(args: {
  policyLabelPrefix: string;
  campaignId: string;
  startingLogicalWindowNumber: number;
  maxWindows: number;
}): GateResult {
  const worstCaseWindowNumber = args.startingLogicalWindowNumber + args.maxWindows - 1;
  const label = campaignWindowPolicyLabel(args.policyLabelPrefix, args.campaignId, worstCaseWindowNumber);
  return validatePolicyLabelLength({ policyLabel: label });
}

// ─── Ambiguous-submission recovery (pure classification) ──────────────────────

/**
 * Classifies whether an ambiguous POST (the HTTP call itself threw — the
 * runner never received a `runId`, but the server may have already accepted
 * and persisted the request) can be safely treated as the exact submitted
 * attempt.
 *
 * `candidates` must be every canonical `SyncRun` row sharing the exact
 * expected `policyLabel` (the caller's DB query is not narrowed by any other
 * field) — `policyLabel` is not database-unique
 * (`prisma/schema.prisma`: no `@unique`), so more than one row can share a
 * label. The candidate-SET size is checked FIRST, independent of identity:
 * zero rows or more than one row sharing the label both fail closed
 * immediately, even if exactly one of several same-label rows would
 * otherwise match the full expected identity. Only when the label uniquely
 * identifies a single canonical row is that sole row then checked against
 * the full expected identity (policyLabel, walletId, chainId,
 * sourceFamilies === ["TRANSFERS"], startBlock, endBlock); any mismatch
 * there also fails closed. This ordering means the mere presence of an
 * unrelated same-label row is itself treated as a red flag — proof that the
 * label-collision discipline broke down somewhere — rather than something a
 * coincidental full-identity match on a different row can silently paper
 * over. Never an automatic resubmit, and never an inference from range
 * alone.
 */
export function classifyAmbiguousSubmissionRecovery(args: {
  candidates: readonly RunnerSyncRunRecord[];
  expectedPolicyLabel: string;
  expectedWalletId: string;
  expectedChainId: number;
  expectedStartBlock: bigint;
  expectedEndBlock: bigint;
}): { ok: true; run: RunnerSyncRunRecord } | { ok: false; reason: string } {
  if (args.candidates.length === 0) {
    return {
      ok: false,
      reason: `ambiguous submission for policyLabel "${args.expectedPolicyLabel}": zero SyncRun candidates share this policyLabel — failing closed, no auto-resubmit`,
    };
  }
  if (args.candidates.length > 1) {
    return {
      ok: false,
      reason: `ambiguous submission for policyLabel "${args.expectedPolicyLabel}": ${args.candidates.length} SyncRun candidates share this policyLabel (policyLabel is not database-unique) — failing closed regardless of which one, if any, would otherwise match the full expected identity, no auto-resubmit`,
    };
  }

  const [sole] = args.candidates;
  const matchesFullIdentity =
    sole.policyLabel === args.expectedPolicyLabel &&
    sole.walletId === args.expectedWalletId &&
    sole.chainId === args.expectedChainId &&
    sole.sourceFamilies.length === 1 &&
    sole.sourceFamilies[0] === WALLET_FORWARD_SYNC_SOURCE_FAMILIES[0] &&
    sole.startBlock === args.expectedStartBlock &&
    sole.endBlock === args.expectedEndBlock;

  if (!matchesFullIdentity) {
    return {
      ok: false,
      reason: `ambiguous submission for policyLabel "${args.expectedPolicyLabel}": the sole matching-policyLabel SyncRun candidate does not match the full expected identity (walletId, chainId, sourceFamilies, startBlock, endBlock) — failing closed, no auto-resubmit`,
    };
  }

  return { ok: true, run: sole };
}

// ─── Checkpoint evaluation (pure) ──────────────────────────────────────────────

export type CheckpointFacts = {
  campaignStartHead: string;
  currentHead: string;
  workingTreeClean: boolean;
  healthGate: GateResult;
  baseUrl: string;
  campaignStartBaseUrl: string;
  appEnv: string | undefined;
  campaignStartAppEnv: string | undefined;
  expectedCursor: { fromBlock: bigint; toBlock: bigint };
  liveCursor: { fromBlock: bigint; toBlock: bigint } | null;
  authorizedFinalBlock: bigint;
  lastPlannedEndBlock: bigint | null;
  evidenceWritable: boolean;
};

export function evaluateCheckpoint(facts: CheckpointFacts): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  if (facts.currentHead !== facts.campaignStartHead) {
    reasons.push(`local HEAD changed from ${facts.campaignStartHead} to ${facts.currentHead}`);
  }
  if (!facts.workingTreeClean) {
    reasons.push("working tree is not clean");
  }
  if (!facts.healthGate.ok) {
    reasons.push(`backend health check failed: ${facts.healthGate.reason}`);
  }
  if (facts.baseUrl !== facts.campaignStartBaseUrl) {
    reasons.push(`--base-url changed from ${facts.campaignStartBaseUrl} to ${facts.baseUrl} since campaign start`);
  }
  if (facts.appEnv !== facts.campaignStartAppEnv) {
    reasons.push(
      `environment/base-url classification (app.env) changed from ${facts.campaignStartAppEnv} to ${facts.appEnv}`,
    );
  }
  if (
    !facts.liveCursor ||
    facts.liveCursor.fromBlock !== facts.expectedCursor.fromBlock ||
    facts.liveCursor.toBlock !== facts.expectedCursor.toBlock
  ) {
    reasons.push("expected campaign cursor does not match the live TRANSFERS cursor exactly");
  }
  if (facts.lastPlannedEndBlock !== null && facts.lastPlannedEndBlock > facts.authorizedFinalBlock) {
    reasons.push(
      `campaign boundary invalid: last planned endBlock ${facts.lastPlannedEndBlock} exceeds --authorized-final-block ${facts.authorizedFinalBlock}`,
    );
  }
  if (!facts.evidenceWritable) {
    reasons.push("evidence destination is not writable");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Origin/main moving is explicitly NOT a checkpoint failure — only local
 * HEAD identity (a literal string comparison) is checked. This function
 * exists purely to document that intent; callers should never diff against
 * origin/main inside a checkpoint. */
export const CHECKPOINT_NEVER_CHECKS_ORIGIN_MAIN = true as const;

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type CampaignCliOptions = {
  execute: boolean;
  walletAddress: string;
  chainId: number;
  expectedCursorFromBlock: bigint;
  expectedCursorToBlock: bigint;
  firstWindowStart: bigint;
  windowSizeBlocks: bigint;
  maxWindows: number;
  authorizedFinalBlock: bigint;
  campaignId: string;
  policyLabelPrefix: string;
  checkpointIntervalWindows: number;
  baseUrl: string;
  evidenceFile: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  /**
   * Explicit, opt-in recovery of exactly one prior benign-warning window,
   * attempted once before the ordinary campaign loop begins. Undefined (the
   * default) leaves campaign behavior byte-for-byte unchanged. See
   * scripts/wallet-forward-sync-runner.ts's identical field for the full
   * contract — the campaign runner reuses the same shared primitives.
   */
  recovery?: RecoveryCliOptions;
};

export type CampaignCliParseResult =
  | { ok: true; options: CampaignCliOptions }
  | { ok: false; error: string };

export const CAMPAIGN_CLI_USAGE = [
  "Usage: wallet-forward-campaign-runner --wallet-address <0x..> --chain-id <n>",
  "         --expected-cursor-from <blockNumber> --expected-cursor-to <blockNumber>",
  "         --first-window-start <blockNumber> --window-size 1000",
  "         --max-windows <1-1000> --authorized-final-block <blockNumber>",
  "         --campaign-id <id> --policy-label-prefix <label>",
  "         --base-url <url> [--checkpoint-interval <1-25>] [--execute]",
  "         [--evidence-file <path>]",
  "         [--poll-interval-ms <n>] [--poll-timeout-ms <n>]",
  "",
  "  Dry-run is the default and never submits an HTTP POST.",
  "  --max-windows is bounded to [1, 1000] (implementation ceiling only —",
  "  see docs/wallet-forward-campaign-runbook.md for staged live rollout).",
  "  --window-size must equal exactly 1000 — the campaign atomic window is",
  "  fixed, unlike the generic positive --window-size accepted elsewhere.",
  "  --authorized-final-block must align to full --window-size windows",
  "  starting at --first-window-start.",
  "  --checkpoint-interval defaults to 25 and may not exceed 25 (that is a",
  "  maximum spacing, not merely a default — more frequent is allowed).",
  "  --base-url is REQUIRED and explicit for the campaign runner — it does",
  "  NOT fall back to OPERATOR_RUNNER_BASE_URL or a localhost default.",
  "  All of --wallet-address, --chain-id, --expected-cursor-from,",
  "  --expected-cursor-to, --first-window-start, --window-size,",
  "  --max-windows, --authorized-final-block, --campaign-id,",
  "  --policy-label-prefix, and --base-url are required — nothing is",
  "  inferred or defaulted.",
  "  [--recovery-mode --recovery-of-run-id <SyncRun id>] recovers exactly",
  "  one prior benign-warning window at [--first-window-start,",
  "  --first-window-start + --window-size - 1] before the campaign loop",
  "  begins; --expected-cursor-to must already equal that window's endBlock.",
].join("\n");

const DEFAULT_EVIDENCE_FILE = "operator-evidence/wallet-forward-campaign-runner/evidence.jsonl";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000;

function readValue(argv: readonly string[], index: number): string | null {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return null;
  }
  return value;
}

export function parseCampaignCliArgs(argv: readonly string[]): CampaignCliParseResult {
  let execute = false;
  let walletAddress: string | undefined;
  let chainId: number | undefined;
  let expectedCursorFromBlock: bigint | undefined;
  let expectedCursorToBlock: bigint | undefined;
  let firstWindowStart: bigint | undefined;
  let windowSizeBlocks: bigint | undefined;
  let maxWindows: number | undefined;
  let authorizedFinalBlock: bigint | undefined;
  let campaignId: string | undefined;
  let policyLabelPrefix: string | undefined;
  let checkpointIntervalWindows = DEFAULT_CAMPAIGN_CHECKPOINT_INTERVAL;
  // No default — --base-url must be explicit for the campaign runner (see
  // Blocker 3 / docs/wallet-forward-campaign-runbook.md). Unlike the
  // 5-window runner, OPERATOR_RUNNER_BASE_URL is never consulted here.
  let baseUrl: string | undefined;
  let evidenceFile = DEFAULT_EVIDENCE_FILE;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS;
  let recoveryMode = false;
  let recoveryOfRunId: string | null = null;

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
      if (value === null || !/^-?\d+$/.test(value)) {
        return { ok: false, error: "--max-windows must be an integer." };
      }
      maxWindows = Number(value);
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
    if (arg === "--campaign-id") {
      const value = readValue(argv, index);
      if (value === null) return { ok: false, error: "--campaign-id requires a value." };
      campaignId = value;
      index += 1;
      continue;
    }
    if (arg === "--policy-label-prefix") {
      const value = readValue(argv, index);
      if (value === null || value.length === 0) {
        return { ok: false, error: "--policy-label-prefix must be a non-empty string." };
      }
      // Reject rather than silently normalize: manualSyncRequestSchema trims
      // policyLabel server-side, so a prefix with leading/trailing
      // whitespace would make the runner's collision-check identity differ
      // from the backend-persisted identity. This also rejects a
      // whitespace-only value (its trimmed form is empty, so it always
      // differs from the raw value).
      if (value !== value.trim()) {
        return {
          ok: false,
          error: "--policy-label-prefix must not have leading or trailing whitespace (it would not match the backend's trimmed policyLabel identity).",
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
  if (maxWindows === undefined) return { ok: false, error: "--max-windows is required." };
  if (authorizedFinalBlock === undefined) {
    return { ok: false, error: "--authorized-final-block is required." };
  }
  if (campaignId === undefined) return { ok: false, error: "--campaign-id is required." };
  if (policyLabelPrefix === undefined) {
    return { ok: false, error: "--policy-label-prefix is required." };
  }
  if (baseUrl === undefined) {
    return {
      ok: false,
      error:
        "--base-url is required and must be passed explicitly for the campaign runner (it does not fall back to OPERATOR_RUNNER_BASE_URL or a localhost default).",
    };
  }

  const chainGate = validateSupportedChain({ chainId });
  if (!chainGate.ok) return { ok: false, error: chainGate.reason };

  const windowSizeGate = validateWindowSize({ windowSizeBlocks });
  if (!windowSizeGate.ok) return { ok: false, error: windowSizeGate.reason };

  const campaignWindowSizeGate = validateCampaignWindowSize({ windowSizeBlocks });
  if (!campaignWindowSizeGate.ok) return { ok: false, error: campaignWindowSizeGate.reason };

  const maxWindowsGate = validateCampaignMaxWindows({ maxWindows });
  if (!maxWindowsGate.ok) return { ok: false, error: maxWindowsGate.reason };

  const campaignIdGate = validateCampaignId({ campaignId });
  if (!campaignIdGate.ok) return { ok: false, error: campaignIdGate.reason };

  const checkpointGate = validateCheckpointInterval({ checkpointIntervalWindows });
  if (!checkpointGate.ok) return { ok: false, error: checkpointGate.reason };

  const alignmentGate = validateAuthorizedFinalBlockAlignment({
    firstWindowStart,
    windowSizeBlocks,
    authorizedFinalBlock,
  });
  if (!alignmentGate.ok) return { ok: false, error: alignmentGate.reason };

  const recoveryFlags = parseRecoveryFlags({ recoveryMode, recoveryOfRunId });
  if (!recoveryFlags.ok) return { ok: false, error: recoveryFlags.error };

  // The first window of a fresh (non-resumed) invocation is always logical
  // window 1 — see computeLogicalCampaignWindowNumber's doc comment. When
  // recovery mode is enabled, the recovery window itself occupies logical
  // window 1 and the ordinary campaign loop's windows are shifted to start
  // at logical window 2 — the label-length preflight must validate the
  // shifted range up front, not the un-shifted one, or an overlong label at
  // a digit boundary (e.g. w999 -> w1000) would only be caught hundreds of
  // windows into a live campaign instead of before the first POST.
  const startingLogicalWindowNumber = recoveryFlags.recovery ? 2 : 1;
  const labelLengthGate = validateLongestGeneratedLabel({
    policyLabelPrefix,
    campaignId,
    startingLogicalWindowNumber,
    maxWindows,
  });
  if (!labelLengthGate.ok) return { ok: false, error: labelLengthGate.reason };

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
      authorizedFinalBlock,
      campaignId,
      policyLabelPrefix,
      checkpointIntervalWindows,
      baseUrl,
      evidenceFile,
      pollIntervalMs,
      pollTimeoutMs,
      recovery: recoveryFlags.recovery,
    },
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export type CampaignDeps = {
  db: RunnerDbClient;
  resolveWallet: (args: { walletAddress: string; chainId: number }) => Promise<{ id: string; address: string } | null>;
  httpGet: HttpGet;
  httpPost: HttpPost;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  writeEvidence: (record: EvidenceRecord) => Promise<void>;
  getGitHead: () => Promise<string>;
  isWorkingTreeClean: () => Promise<boolean>;
  checkEvidenceWritable: () => Promise<boolean>;
};

/**
 * Everything known about the window currently being submitted, tracked in
 * outer-loop-iteration scope and enriched as more becomes known (plan →
 * runId → terminal/verification outcome). Carried into the returned
 * `CampaignSummary` when a failure occurs AFTER canonical PostgreSQL state
 * has already been mutated but BEFORE that outcome could be durably
 * recorded as evidence (`evidence_append_failed` on the window write, or an
 * `unexpected_error` thrown after POST) — so canonical truth about the
 * attempted window is never silently lost from the operator-facing result,
 * even though the evidence record itself could not be written. `runId` is
 * `null`, never fabricated, when the attempt failed before one was
 * received or recovered.
 */
export type CampaignWindowAttempt = {
  logicalWindowNumber: number;
  policyLabel: string;
  expectedRange: { startBlock: string; endBlock: string };
  runId: string | null;
  recoveredFromAmbiguousSubmission: boolean;
  actualRange?: { startBlock: string | null; endBlock: string | null };
  terminalStatus?: string | null;
  canonicallyClean?: boolean;
  invariantFailures?: string[];
};

export type CampaignSummary = {
  stoppedReason: string;
  detail?: string;
  windowsCompleted: number;
  lastWindowNumber: number | null;
  checkpointsPassed: number;
  /** Present only when a failure occurred mid-window-attempt after POST —
   * see `CampaignWindowAttempt`'s doc comment. Absent on every clean
   * completion and on any pre-POST stop. */
  lastAttemptedWindow?: CampaignWindowAttempt;
  /** Present only when --recovery-mode/--recovery-of-run-id were passed —
   * absent on every ordinary campaign. Never fabricated: `recovered` is
   * true only when the recovery window's own post-run gates all passed. */
  recovery?: {
    sourceRunId: string;
    window: { startBlock: string; endBlock: string };
    eligible: boolean;
    recovered: boolean;
    reason?: string;
    /**
     * Populated as soon as each fact becomes known during the recovery POST
     * attempt — specifically BEFORE the recovery evidence write, not after —
     * so that if evidence append fails after canonical PostgreSQL state has
     * already been mutated (the recovery run reached a terminal state and
     * its postconditions were evaluated), the operator-facing summary still
     * exposes exactly what canonical truth is, rather than silently looking
     * like recovery never happened. `recovered` above reflects this same
     * canonical outcome the moment it is known, independent of whether the
     * evidence write later succeeds.
     */
    runId?: string;
    recoveredFromAmbiguousSubmission?: boolean;
    terminalStatus?: string;
    warningCount?: number;
    postconditionsPassed?: boolean;
    submittedAt?: string;
    terminalAt?: string;
  };
};

/** Genuine, non-error campaign completion. Every other stoppedReason —
 * including any not in this set — is a hard stop and exits nonzero. Explicit
 * allowlist, not a suffix/pattern match. */
export const CAMPAIGN_CLEAN_STOP_REASONS: ReadonlySet<string> = new Set([
  "max_windows_reached",
  "authorized_final_block_reached",
]);

export function computeCampaignExitCode(stoppedReason: string): 0 | 1 {
  return CAMPAIGN_CLEAN_STOP_REASONS.has(stoppedReason) ? 0 : 1;
}

async function writeEvidenceOrNull(
  deps: CampaignDeps,
  record: EvidenceRecord,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await deps.writeEvidence(record);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Central stop-writing path. `campaignId` is always included in the written
 * stop record — callers do not need to remember to add it themselves, since
 * append-only campaign evidence may contain records from multiple
 * invocations and a stop record without campaignId could not reliably be
 * attributed to this campaign. `campaignId` is the raw operator-supplied
 * value (even when the campaign itself is being rejected for an invalid
 * campaignId) — never an invented identity.
 */
async function stopCampaign(
  deps: CampaignDeps,
  campaignId: string,
  reason: string,
  detail: string | undefined,
  windowsCompleted: number,
  lastWindowNumber: number | null,
  checkpointsPassed: number,
  extra?: Record<string, unknown>,
  recovery?: CampaignSummary["recovery"],
): Promise<CampaignSummary> {
  // Best-effort: a stop record failing to write must never mask the
  // original stop reason, and must never trigger a further POST.
  await writeEvidenceOrNull(
    deps,
    buildStopEvidenceRecord({ at: deps.now().toISOString(), reason, detail, extra: { campaignId, ...extra } }),
  );
  return { stoppedReason: reason, detail, windowsCompleted, lastWindowNumber, checkpointsPassed, recovery };
}

async function checkServerHealthDetailed(
  httpGet: HttpGet,
  baseUrl: string,
): Promise<{ gate: GateResult; appEnv: string | undefined }> {
  let response: HttpResponse;
  try {
    response = await httpGet(`${baseUrl}/api/debug/health`);
  } catch (err) {
    return {
      gate: { ok: false, reason: `health check request failed: ${err instanceof Error ? err.message : String(err)}` },
      appEnv: undefined,
    };
  }
  const body = response.body as { data?: { status?: string; app?: { env?: string } } } | undefined;
  const appEnv = body?.data?.app?.env;
  if (response.status !== 200 || body?.data?.status !== "ok") {
    return {
      gate: { ok: false, reason: `server health check did not report ok (status ${response.status})` },
      appEnv,
    };
  }
  return { gate: { ok: true }, appEnv };
}

export async function runWalletForwardCampaignRunner(
  options: CampaignCliOptions,
  deps: CampaignDeps,
): Promise<CampaignSummary> {
  const campaignStartAt = deps.now().toISOString();
  const campaignId = options.campaignId;

  // Recovery (when enabled) resubmits exactly the window
  // [options.firstWindowStart, options.firstWindowStart + windowSizeBlocks -
  // 1] as a bounded pre-loop step — it is not one of the ordinary campaign
  // windows bounded by --max-windows/--authorized-final-block. Every place
  // that computes "how many ordinary windows remain" (the alignment/
  // effectiveMaxWindows derivation below, and the ordinary loop's own
  // first-window gate later) must therefore reason from the window
  // immediately AFTER the recovered range, not from options.firstWindowStart
  // itself — otherwise recovery would silently consume one ordinary window's
  // worth of authorized budget.
  const effectiveFirstWindowStart = options.recovery
    ? options.firstWindowStart + options.windowSizeBlocks
    : options.firstWindowStart;

  // ── Step 1: validate immutable options. Re-derived at runtime — never
  // trust that CLI parsing already validated these, since orchestrator
  // callers (including tests) may construct CampaignCliOptions directly. ──
  const alignment = validateAuthorizedFinalBlockAlignment({
    firstWindowStart: effectiveFirstWindowStart,
    windowSizeBlocks: options.windowSizeBlocks,
    authorizedFinalBlock: options.authorizedFinalBlock,
  });
  if (!alignment.ok) {
    return stopCampaign(deps, campaignId, "authorized_final_block_misaligned", alignment.reason, 0, null, 0);
  }
  const maxWindowsGate = validateCampaignMaxWindows({ maxWindows: options.maxWindows });
  if (!maxWindowsGate.ok) {
    return stopCampaign(deps, campaignId, "invalid_max_windows", maxWindowsGate.reason, 0, null, 0);
  }
  const campaignIdGate = validateCampaignId({ campaignId: options.campaignId });
  if (!campaignIdGate.ok) {
    return stopCampaign(deps, campaignId, "invalid_campaign_id", campaignIdGate.reason, 0, null, 0);
  }
  const campaignWindowSizeGate = validateCampaignWindowSize({ windowSizeBlocks: options.windowSizeBlocks });
  if (!campaignWindowSizeGate.ok) {
    return stopCampaign(deps, campaignId, "invalid_window_size", campaignWindowSizeGate.reason, 0, null, 0);
  }
  // Re-derive at runtime — same validator the CLI parser already uses
  // (validateCheckpointInterval), never a duplicated check. CLI parsing
  // alone is not sufficient because a direct caller (including a test) can
  // construct a CampaignCliOptions object and bypass parseCampaignCliArgs
  // entirely.
  const checkpointIntervalGate = validateCheckpointInterval({
    checkpointIntervalWindows: options.checkpointIntervalWindows,
  });
  if (!checkpointIntervalGate.ok) {
    return stopCampaign(deps, campaignId, "invalid_checkpoint_interval", checkpointIntervalGate.reason, 0, null, 0);
  }

  const effectiveMaxWindows = Math.min(options.maxWindows, alignment.windowCount);

  // ── Step 2: obtain approved local HEAD. ──
  let campaignStartHead: string;
  try {
    campaignStartHead = await deps.getGitHead();
  } catch (err) {
    return stopCampaign(
      deps,
      campaignId,
      "git_head_unavailable",
      err instanceof Error ? err.message : String(err),
      0,
      null,
      0,
    );
  }

  // ── Step 3: verify clean worktree. This is a mandatory STARTUP gate,
  // independent of the periodic checkpoint gate — with Stage 1 = 10 windows
  // and a default checkpoint interval of 25, a short campaign could
  // otherwise complete entirely from a dirty working tree without this ever
  // being checked. No window may reach POST before this passes. ──
  const workingTreeCleanAtStart = await deps.isWorkingTreeClean();
  if (!workingTreeCleanAtStart) {
    return stopCampaign(
      deps,
      campaignId,
      "working_tree_dirty",
      "working tree is not clean at campaign start",
      0,
      null,
      0,
    );
  }

  // ── Step 4: establish a healthy environment baseline. Fail closed — a
  // campaign must never begin from an unreachable or non-OK backend, and
  // campaignStartAppEnv (used by every later checkpoint's drift check) must
  // only ever be captured from a verified-OK baseline, never from a failed
  // check. ──
  const startHealth = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
  if (!startHealth.gate.ok) {
    return stopCampaign(
      deps,
      campaignId,
      "initial_health_baseline_failed",
      (startHealth.gate as { ok: false; reason: string }).reason,
      0,
      null,
      0,
    );
  }
  const campaignStartAppEnv = startHealth.appEnv;
  const campaignStartBaseUrl = options.baseUrl;

  // ── Step 5: resolve wallet / canonical preflight. ──
  const wallet = await deps.resolveWallet({ walletAddress: options.walletAddress, chainId: options.chainId });
  if (!wallet) {
    return stopCampaign(deps, campaignId, "wallet_not_found", undefined, 0, null, 0);
  }

  // ── Step 6: persist campaign_start evidence. Only reached once every
  // mandatory startup safety gate above has passed — a written
  // campaign_start record therefore never implies a valid campaign started
  // before those gates ran. ──
  const startWrite = await writeEvidenceOrNull(deps, {
    kind: "campaign_start",
    at: campaignStartAt,
    mode: options.execute ? "execute" : "dry-run",
    campaignId,
    walletAddress: options.walletAddress,
    chainId: options.chainId,
    sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
    expectedCursor: {
      fromBlock: options.expectedCursorFromBlock.toString(),
      toBlock: options.expectedCursorToBlock.toString(),
    },
    firstWindowStart: options.firstWindowStart.toString(),
    windowSizeBlocks: options.windowSizeBlocks.toString(),
    approvedMaxWindows: options.maxWindows,
    effectiveMaxWindows,
    authorizedFinalBlock: options.authorizedFinalBlock.toString(),
    policyLabelPrefix: options.policyLabelPrefix,
    checkpointIntervalWindows: options.checkpointIntervalWindows,
    campaignStartHead,
    baseUrl: campaignStartBaseUrl,
  });
  if (!startWrite.ok) {
    return { stoppedReason: "evidence_append_failed", detail: startWrite.message, windowsCompleted: 0, lastWindowNumber: null, checkpointsPassed: 0 };
  }

  // ── Step 6.5: explicit recovery mode (PR B). A single bounded pre-loop
  // step that resubmits exactly one prior benign-warning window, then falls
  // through to the ordinary campaign loop with fully unchanged, strict
  // behavior. Skipped entirely — byte-for-byte — when options.recovery is
  // undefined (the default). No persistent "tolerant campaign" state: this
  // block runs at most once, before any ordinary window, and never again. ──
  let recoverySummary: CampaignSummary["recovery"];
  if (options.recovery) {
    const recoveryStart = options.firstWindowStart;
    const recoveryEnd = options.firstWindowStart + options.windowSizeBlocks - 1n;
    recoverySummary = {
      sourceRunId: options.recovery.sourceRunId,
      window: { startBlock: recoveryStart.toString(), endBlock: recoveryEnd.toString() },
      eligible: false,
      recovered: false,
    };

    if (options.expectedCursorToBlock !== recoveryEnd) {
      recoverySummary.reason = `--expected-cursor-to ${options.expectedCursorToBlock} must equal the recovery window's endBlock ${recoveryEnd}`;
      return stopCampaign(
        deps,
        campaignId,
        "recovery_window_not_at_cursor_frontier",
        recoverySummary.reason,
        0,
        null,
        0,
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
      return stopCampaign(
        deps,
        campaignId,
        "cursor_expectation_mismatch",
        cursorGate.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
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
      return stopCampaign(
        deps,
        campaignId,
        "recovery_source_run_ineligible",
        eligibility.reason,
        0,
        null,
        0,
        { sourceRunId: options.recovery.sourceRunId },
        recoverySummary,
      );
    }
    recoverySummary.eligible = true;

    const recoveryLabel = recoveryPolicyLabel(options.policyLabelPrefix, options.recovery.sourceRunId);

    const labelLenGate = validatePolicyLabelLength({ policyLabel: recoveryLabel });
    if (!labelLenGate.ok) {
      recoverySummary.reason = labelLenGate.reason;
      return stopCampaign(
        deps,
        campaignId,
        "policy_label_overlong",
        labelLenGate.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
    }

    const labelGate = validateNoPolicyLabelCollision({
      policyLabel: recoveryLabel,
      existingPolicyLabels: await listActivePolicyLabels(deps.db, options.chainId),
    });
    if (!labelGate.ok) {
      recoverySummary.reason = labelGate.reason;
      return stopCampaign(
        deps,
        campaignId,
        "policy_label_collision",
        labelGate.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
    }

    const activeOpGate = validateNoActiveOperation({ activeRunCount: await countActiveOperations(deps.db) });
    if (!activeOpGate.ok) {
      recoverySummary.reason = activeOpGate.reason;
      return stopCampaign(
        deps,
        campaignId,
        "active_operation_conflict",
        activeOpGate.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
    }

    const healthCheck = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
    if (!healthCheck.gate.ok) {
      recoverySummary.reason = (healthCheck.gate as { ok: false; reason: string }).reason;
      return stopCampaign(
        deps,
        campaignId,
        "server_unhealthy",
        recoverySummary.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
    }

    const preContamination = await checkFabricatedContamination(deps.db, {
      chainId: options.chainId,
      walletAddress: options.walletAddress,
      startBlock: recoveryStart,
      endBlock: recoveryEnd,
    });
    if (preContamination.rowCount > 0) {
      recoverySummary.reason = `${preContamination.rowCount} contaminated row(s) detected in the recovery range; do not submit`;
      return stopCampaign(
        deps,
        campaignId,
        "fabricated_contamination_pre_gate",
        recoverySummary.reason,
        0,
        null,
        0,
        undefined,
        recoverySummary,
      );
    }

    if (!options.execute) {
      const write = await writeEvidenceOrNull(deps, {
        kind: "recovery_window",
        at: deps.now().toISOString(),
        outcome: "dry_run_planned",
        campaignId,
        sourceRunId: options.recovery.sourceRunId,
        policyLabel: recoveryLabel,
        range: { startBlock: recoveryStart.toString(), endBlock: recoveryEnd.toString() },
      });
      if (!write.ok) {
        return {
          stoppedReason: "evidence_append_failed",
          detail: write.message,
          windowsCompleted: 0,
          lastWindowNumber: null,
          checkpointsPassed: 0,
          recovery: recoverySummary,
        };
      }
    } else {
      const submittedAt = deps.now().toISOString();
      const requestBody = buildManualSyncRequestBody({
        walletAddress: options.walletAddress,
        chainId: options.chainId,
        window: { startBlock: recoveryStart, endBlock: recoveryEnd, policyLabel: recoveryLabel },
      });

      // Ambiguous-submission recovery, identical in spirit to the ordinary
      // campaign POST handling: if the HTTP call itself throws (timeout,
      // dropped connection, ...) the backend may already have accepted and
      // persisted the request. Never blindly retry — reconcile against
      // canonical PostgreSQL state via the exact same
      // classifyAmbiguousSubmissionRecovery identity proof the ordinary
      // loop uses, and fail closed on anything but exactly one matching run.
      let postResponse: HttpResponse | undefined;
      let recoveredRunId: string | undefined;
      try {
        postResponse = await deps.httpPost(`${options.baseUrl}/api/sync/manual`, requestBody);
      } catch (err) {
        const candidates = await deps.db.syncRun.findMany({
          where: { policyLabel: recoveryLabel, chainId: options.chainId },
        });
        const recovery = classifyAmbiguousSubmissionRecovery({
          candidates,
          expectedPolicyLabel: recoveryLabel,
          expectedWalletId: wallet.id,
          expectedChainId: options.chainId,
          expectedStartBlock: recoveryStart,
          expectedEndBlock: recoveryEnd,
        });
        if (!recovery.ok) {
          recoverySummary.reason = `POST /api/sync/manual threw (${err instanceof Error ? err.message : String(err)}); ${recovery.reason}`;
          return stopCampaign(
            deps,
            campaignId,
            "recovery_ambiguous_submission_unrecoverable",
            recoverySummary.reason,
            0,
            null,
            0,
            { sourceRunId: options.recovery.sourceRunId, policyLabel: recoveryLabel, submittedAt },
            recoverySummary,
          );
        }
        recoveredRunId = recovery.run.id;
      }

      const runId =
        recoveredRunId ?? (postResponse?.body as { data?: { runId?: string } } | undefined)?.data?.runId;

      if (runId) {
        recoverySummary.runId = runId;
        recoverySummary.recoveredFromAmbiguousSubmission = recoveredRunId !== undefined;
        recoverySummary.submittedAt = submittedAt;
      }

      if (!recoveredRunId && (!postResponse || postResponse.status !== 202 || !runId)) {
        recoverySummary.reason = `POST /api/sync/manual returned status ${postResponse?.status ?? "unknown"}`;
        return stopCampaign(
          deps,
          campaignId,
          "recovery_manual_sync_submit_failed",
          recoverySummary.reason,
          0,
          null,
          0,
          {
            sourceRunId: options.recovery.sourceRunId,
            policyLabel: recoveryLabel,
            submittedAt,
            httpStatus: postResponse?.status,
            responseBody: sanitizeBackendResponseBody(postResponse?.body),
          },
          recoverySummary,
        );
      }

      const polled = await pollSyncRunToTerminal(deps.db, runId!, {
        now: deps.now,
        sleep: deps.sleep,
        pollIntervalMs: options.pollIntervalMs,
        pollTimeoutMs: options.pollTimeoutMs,
      });
      if (!polled.ok) {
        recoverySummary.reason = `SyncRun ${runId} did not reach a terminal state within ${options.pollTimeoutMs}ms`;
        return stopCampaign(
          deps,
          campaignId,
          "recovery_poll_timeout",
          recoverySummary.reason,
          0,
          null,
          0,
          { sourceRunId: options.recovery.sourceRunId, policyLabel: recoveryLabel, runId, submittedAt },
          recoverySummary,
        );
      }
      const terminalAt = deps.now().toISOString();
      recoverySummary.terminalAt = terminalAt;
      recoverySummary.terminalStatus = polled.run.status;
      recoverySummary.warningCount = polled.run.warningCount;

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

      // Canonical truth is now fully known — record it on recoverySummary
      // BEFORE the evidence write below, so that if the write itself fails,
      // the returned summary still reflects reality (a genuinely successful
      // canonical recovery must never be reported back as recovered=false).
      recoverySummary.postconditionsPassed = allOk;
      recoverySummary.recovered = allOk;

      const windowWrite = await writeEvidenceOrNull(deps, {
        kind: "recovery_window",
        at: terminalAt,
        outcome: allOk ? "recovered" : "failed_invariant",
        campaignId,
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
      if (!windowWrite.ok) {
        return {
          stoppedReason: "evidence_append_failed",
          detail: windowWrite.message,
          windowsCompleted: 0,
          lastWindowNumber: null,
          checkpointsPassed: 0,
          recovery: recoverySummary,
        };
      }

      if (!allOk) {
        recoverySummary.reason = postRunFailureReasons.join("; ");
        return stopCampaign(
          deps,
          campaignId,
          "recovery_invariant_failed_after_run",
          recoverySummary.reason,
          0,
          null,
          0,
          { sourceRunId: options.recovery.sourceRunId, policyLabel: recoveryLabel, runId },
          recoverySummary,
        );
      }
      // recoverySummary.recovered/postconditionsPassed were already set to
      // true above, before the evidence write — nothing further to do here.
    }
  }

  // ── Step 7: begin window planning. ──
  let windowsCompleted = 0;
  let lastWindowNumber: number | null = null;
  let checkpointsPassed = 0;
  // A successful execute-mode recovery is a real mutating sync operation
  // (identical in kind to an ordinary window), so it must count toward
  // checkpoint spacing exactly like one — otherwise a campaign could submit
  // the recovery plus a full MAX_CAMPAIGN_CHECKPOINT_INTERVAL of ordinary
  // windows before the first checkpoint ever runs. A dry-run recovery never
  // mutates anything and must not consume checkpoint spacing.
  let processedCount = recoverySummary?.recovered ? 1 : 0;
  let lastPlannedEndBlock: bigint | null = null;

  // Dry-run only: in-memory simulated cursor upper edge, mirroring the
  // 5-window runner's dry-run simulation so --max-windows previews N
  // distinct sequential windows without mutating anything.
  let simulatedCursorToBlock: bigint | null = null;
  let expectedCursorToBlock = options.expectedCursorToBlock;

  // Tracks the current iteration's execute-mode attempt so a failure after
  // POST (evidence-append failure or an unexpected exception) can still
  // report canonical attempt identity — see CampaignWindowAttempt's doc
  // comment. Reset at the top of every iteration; never carried across
  // iterations.
  let currentAttempt: CampaignWindowAttempt | null = null;

  for (let iteration = 0; iteration < effectiveMaxWindows; iteration += 1) {
    currentAttempt = null;
    try {
      const cursor = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);

      const cursorGate = validateExpectedLiveCursor({
        liveCursor: cursor,
        expectedCursorFromBlock: options.expectedCursorFromBlock,
        expectedCursorToBlock,
      });
      if (!cursorGate.ok) {
        return stopCampaign(deps, campaignId, "cursor_expectation_mismatch", cursorGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const planningToBlock =
        !options.execute && simulatedCursorToBlock !== null ? simulatedCursorToBlock : cursor!.toBlock;

      // Compute the raw [startBlock, endBlock] range first and validate
      // first-window-start/adjacency against it BEFORE deriving the logical
      // campaign window number — computeLogicalCampaignWindowNumber throws
      // on a misaligned/negative offset, and a first-window-start or
      // adjacency mismatch is exactly the situation that would produce one.
      // Validating those gates first means a genuine operator input mistake
      // is always reported as its own specific gate failure, never as an
      // opaque unexpected_error.
      const range = computeNextWindowRange({
        liveCursorToBlock: planningToBlock,
        windowSizeBlocks: options.windowSizeBlocks,
      });

      if (iteration === 0) {
        const firstWindowGate = validateFirstWindowStart({
          computedStartBlock: range.startBlock,
          expectedFirstWindowStart: effectiveFirstWindowStart,
        });
        if (!firstWindowGate.ok) {
          return stopCampaign(deps, campaignId, "first_window_start_mismatch", firstWindowGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
        }
      }

      const adjacencyGate = validateForwardAdjacency({
        liveCursorToBlock: planningToBlock,
        proposedStartBlock: range.startBlock,
      });
      if (!adjacencyGate.ok) {
        return stopCampaign(deps, campaignId, "adjacency_violation", adjacencyGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const plan = computeCampaignWindowPlan({
        liveCursorToBlock: planningToBlock,
        windowSizeBlocks: options.windowSizeBlocks,
        firstWindowStart: options.firstWindowStart,
        policyLabelPrefix: options.policyLabelPrefix,
        campaignId: options.campaignId,
      });

      // Independent pre-POST authorized-final-block gate — checked every
      // iteration regardless of the effectiveMaxWindows derivation above.
      const finalBlockGate = validateWithinAuthorizedFinalBlock({
        endBlock: plan.endBlock,
        authorizedFinalBlock: options.authorizedFinalBlock,
      });
      if (!finalBlockGate.ok) {
        return stopCampaign(deps, campaignId, "authorized_final_block_exceeded", finalBlockGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const labelLengthGate = validatePolicyLabelLength({ policyLabel: plan.policyLabel });
      if (!labelLengthGate.ok) {
        return stopCampaign(deps, campaignId, "policy_label_overlong", labelLengthGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const activeRunCount = await countActiveOperations(deps.db);
      const activeOpGate = validateNoActiveOperation({ activeRunCount });
      if (!activeOpGate.ok) {
        return stopCampaign(deps, campaignId, "active_operation_conflict", activeOpGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const existingLabels = await listActivePolicyLabels(deps.db, options.chainId);
      const labelGate = validateNoPolicyLabelCollision({
        policyLabel: plan.policyLabel,
        existingPolicyLabels: existingLabels,
      });
      if (!labelGate.ok) {
        return stopCampaign(deps, campaignId, "policy_label_collision", labelGate.reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const healthCheck = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
      if (!healthCheck.gate.ok) {
        return stopCampaign(deps, campaignId, "server_unhealthy", (healthCheck.gate as { ok: false; reason: string }).reason, windowsCompleted, lastWindowNumber, checkpointsPassed);
      }

      const preContamination = await checkFabricatedContamination(deps.db, {
        chainId: options.chainId,
        walletAddress: options.walletAddress,
        startBlock: plan.startBlock,
        endBlock: plan.endBlock,
      });
      if (preContamination.rowCount > 0) {
        return stopCampaign(
          deps,
          campaignId,
          "fabricated_contamination_pre_gate",
          `${preContamination.rowCount} contaminated row(s) detected in the proposed range; do not submit`,
          windowsCompleted,
          lastWindowNumber,
          checkpointsPassed,
        );
      }

      lastPlannedEndBlock = plan.endBlock;

      if (!options.execute) {
        const write = await writeEvidenceOrNull(deps, {
          kind: "window",
          at: deps.now().toISOString(),
          outcome: "dry_run_planned",
          campaignId: options.campaignId,
          logicalWindowNumber: plan.windowNumber,
          policyLabel: plan.policyLabel,
          proposedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
          cursorBefore: cursor ? { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() } : null,
        });
        if (!write.ok) {
          return { stoppedReason: "evidence_append_failed", detail: write.message, windowsCompleted, lastWindowNumber, checkpointsPassed };
        }
        lastWindowNumber = plan.windowNumber;
        simulatedCursorToBlock = plan.endBlock;
        processedCount += 1;
      } else {
        // ── Execute: submit exactly one manual sync request, with narrow
        // ambiguous-submission recovery if the POST itself throws. ──
        const submittedAt = deps.now().toISOString();
        const requestBody = buildManualSyncRequestBody({
          walletAddress: options.walletAddress,
          chainId: options.chainId,
          window: plan,
        });

        // Seed the attempt context as soon as window identity is known —
        // before the POST — so any failure from this point forward, however
        // it happens, has at least this much to report.
        currentAttempt = {
          logicalWindowNumber: plan.windowNumber,
          policyLabel: plan.policyLabel,
          expectedRange: { startBlock: plan.startBlock.toString(), endBlock: plan.endBlock.toString() },
          runId: null,
          recoveredFromAmbiguousSubmission: false,
        };

        let postResponse: HttpResponse | undefined;
        let recoveredRunId: string | undefined;

        try {
          postResponse = await deps.httpPost(`${options.baseUrl}/api/sync/manual`, requestBody);
        } catch (err) {
          const candidates = await deps.db.syncRun.findMany({
            where: { policyLabel: plan.policyLabel, chainId: options.chainId },
          });
          const recovery = classifyAmbiguousSubmissionRecovery({
            candidates,
            expectedPolicyLabel: plan.policyLabel,
            expectedWalletId: wallet.id,
            expectedChainId: options.chainId,
            expectedStartBlock: plan.startBlock,
            expectedEndBlock: plan.endBlock,
          });
          if (!recovery.ok) {
            return stopCampaign(
              deps,
              campaignId,
              "ambiguous_submission_unrecoverable",
              `POST /api/sync/manual threw (${err instanceof Error ? err.message : String(err)}); ${recovery.reason}`,
              windowsCompleted,
              lastWindowNumber,
              checkpointsPassed,
              { logicalWindowNumber: plan.windowNumber, policyLabel: plan.policyLabel },
            );
          }
          recoveredRunId = recovery.run.id;
        }

        const runId =
          recoveredRunId ??
          (postResponse?.body as { data?: { runId?: string } } | undefined)?.data?.runId;

        // runId is now known (whether from a normal 202 response or from
        // ambiguous-submission recovery) — record it. Left null on the
        // manual_sync_submit_failed path below, since no runId was ever
        // actually received or recovered there.
        if (runId) {
          currentAttempt = {
            ...currentAttempt!,
            runId,
            recoveredFromAmbiguousSubmission: recoveredRunId !== undefined,
          };
        }

        if (!recoveredRunId && (!postResponse || postResponse.status !== 202 || !runId)) {
          return stopCampaign(
            deps,
            campaignId,
            "manual_sync_submit_failed",
            `POST /api/sync/manual returned status ${postResponse?.status ?? "unknown"}`,
            windowsCompleted,
            lastWindowNumber,
            checkpointsPassed,
            {
              logicalWindowNumber: plan.windowNumber,
              policyLabel: plan.policyLabel,
              submittedAt,
              httpStatus: postResponse?.status,
              responseBody: sanitizeBackendResponseBody(postResponse?.body),
            },
          );
        }

        const polled = await pollSyncRunToTerminal(deps.db, runId!, {
          now: deps.now,
          sleep: deps.sleep,
          pollIntervalMs: options.pollIntervalMs,
          pollTimeoutMs: options.pollTimeoutMs,
        });
        if (!polled.ok) {
          return stopCampaign(
            deps,
            campaignId,
            "poll_timeout",
            `SyncRun ${runId} did not reach a terminal state within ${options.pollTimeoutMs}ms`,
            windowsCompleted,
            lastWindowNumber,
            checkpointsPassed,
            { logicalWindowNumber: plan.windowNumber, policyLabel: plan.policyLabel, runId, submittedAt },
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

        // Canonical terminal verification is now fully known — enrich the
        // attempt context so it survives even if the evidence write below
        // fails.
        currentAttempt = {
          ...currentAttempt!,
          actualRange: {
            startBlock: polled.run.startBlock?.toString() ?? null,
            endBlock: polled.run.endBlock?.toString() ?? null,
          },
          terminalStatus: polled.run.status,
          canonicallyClean: allOk,
          invariantFailures: postRunFailureReasons,
        };

        // Evidence-failure-is-a-gate: canonical PostgreSQL state (the just-
        // completed SyncRun/SyncCursor writes) is never rolled back, but if
        // this record cannot be appended, the next window must never be
        // submitted.
        const windowWrite = await writeEvidenceOrNull(deps, {
          kind: "window",
          at: terminalAt,
          outcome: allOk ? "completed" : "failed_invariant",
          campaignId: options.campaignId,
          logicalWindowNumber: plan.windowNumber,
          policyLabel: plan.policyLabel,
          runId,
          recoveredFromAmbiguousSubmission: recoveredRunId !== undefined,
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
          cursorBefore: cursor ? { fromBlock: cursor.fromBlock.toString(), toBlock: cursor.toBlock.toString() } : null,
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
        if (!windowWrite.ok) {
          // Canonical PostgreSQL state (the SyncRun/SyncCursor writes this
          // window just made) is authoritative and is never rolled back or
          // retried — but the caller must still be able to see exactly what
          // was attempted (window identity, runId, terminal status, and
          // whether it was canonically clean or already had invariant
          // failures) even though the evidence record itself could not be
          // written. windowsCompleted/lastWindowNumber are deliberately NOT
          // advanced here: they track windows whose evidence was durably
          // recorded, and this one's was not.
          return {
            stoppedReason: "evidence_append_failed",
            detail: windowWrite.message,
            windowsCompleted,
            lastWindowNumber,
            checkpointsPassed,
            lastAttemptedWindow: currentAttempt ?? undefined,
          };
        }

        if (!allOk) {
          return stopCampaign(
            deps,
            campaignId,
            "invariant_failed_after_run",
            postRunFailureReasons.join("; "),
            windowsCompleted,
            plan.windowNumber,
            checkpointsPassed,
            { logicalWindowNumber: plan.windowNumber, policyLabel: plan.policyLabel, runId },
          );
        }

        windowsCompleted += 1;
        lastWindowNumber = plan.windowNumber;
        expectedCursorToBlock = plan.endBlock;
        processedCount += 1;
      }

      // ── Checkpoint: every --checkpoint-interval processed windows ──
      if (processedCount > 0 && processedCount % options.checkpointIntervalWindows === 0) {
        const currentHead = await deps.getGitHead();
        const workingTreeClean = await deps.isWorkingTreeClean();
        const checkpointHealth = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
        const liveCursor = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
        const evidenceWritable = await deps.checkEvidenceWritable();

        const checkpointResult = evaluateCheckpoint({
          campaignStartHead,
          currentHead,
          workingTreeClean,
          healthGate: checkpointHealth.gate,
          baseUrl: options.baseUrl,
          campaignStartBaseUrl,
          appEnv: checkpointHealth.appEnv,
          campaignStartAppEnv,
          expectedCursor: { fromBlock: options.expectedCursorFromBlock, toBlock: expectedCursorToBlock },
          liveCursor,
          authorizedFinalBlock: options.authorizedFinalBlock,
          lastPlannedEndBlock,
          evidenceWritable,
        });

        const checkpointWrite = await writeEvidenceOrNull(deps, {
          kind: "checkpoint",
          at: deps.now().toISOString(),
          campaignId: options.campaignId,
          processedCount,
          windowsCompleted,
          ok: checkpointResult.ok,
          reasons: checkpointResult.ok ? [] : checkpointResult.reasons,
        });
        if (!checkpointWrite.ok) {
          return {
            stoppedReason: "evidence_append_failed",
            detail: checkpointWrite.message,
            windowsCompleted,
            lastWindowNumber,
            checkpointsPassed,
          };
        }

        if (!checkpointResult.ok) {
          return stopCampaign(
            deps,
            campaignId,
            "checkpoint_failed",
            checkpointResult.reasons.join("; "),
            windowsCompleted,
            lastWindowNumber,
            checkpointsPassed,
          );
        }
        checkpointsPassed += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Never auto-retry, never submit another window. Best-effort stop
      // record — its own failure must not mask the original error or throw
      // out of this function. currentAttempt carries whatever window
      // identity (policyLabel, range, and — only if actually known —
      // runId) was established before the exception, so canonical recovery
      // never has to guess which window/run may have mutated PostgreSQL.
      // runId is left null/absent rather than fabricated when the exception
      // happened before one was received or recovered.
      await writeEvidenceOrNull(
        deps,
        buildStopEvidenceRecord({
          at: deps.now().toISOString(),
          reason: "unexpected_error",
          detail: message,
          extra: { campaignId, lastAttemptedWindow: currentAttempt ?? undefined },
        }),
      );
      return {
        stoppedReason: "unexpected_error",
        detail: message,
        windowsCompleted,
        lastWindowNumber,
        checkpointsPassed,
        lastAttemptedWindow: currentAttempt ?? undefined,
      };
    }
  }

  const stoppedReason =
    options.maxWindows <= alignment.windowCount ? "max_windows_reached" : "authorized_final_block_reached";

  // Capture the campaign_summary write result. All canonical windows have
  // already completed at this point — there is no further POST to gate —
  // but the operator must never receive a clean completion status (exit 0)
  // when this mandatory final provenance record was not actually written.
  // Canonical completed windows are never rolled back or retried because of
  // this; only the reported outcome changes.
  const summaryWrite = await writeEvidenceOrNull(deps, {
    kind: "campaign_summary",
    at: deps.now().toISOString(),
    campaignId,
    stoppedReason,
    windowsCompleted,
    lastWindowNumber,
    checkpointsPassed,
    approvedMaxWindows: options.maxWindows,
    authorizedFinalBlock: options.authorizedFinalBlock.toString(),
    recovery: recoverySummary,
  });
  if (!summaryWrite.ok) {
    return {
      stoppedReason: "evidence_append_failed",
      detail: summaryWrite.message,
      windowsCompleted,
      lastWindowNumber,
      checkpointsPassed,
      recovery: recoverySummary,
    };
  }

  return { stoppedReason, windowsCompleted, lastWindowNumber, checkpointsPassed, recovery: recoverySummary };
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

function defaultCheckEvidenceWritable(evidenceFile: string): () => Promise<boolean> {
  return async () => {
    try {
      const dir = path.dirname(evidenceFile);
      await mkdir(dir, { recursive: true });
      await access(dir, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
}

async function main(): Promise<void> {
  const parsed = parseCampaignCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`wallet-forward-campaign-runner: ${parsed.error}`);
    console.error(CAMPAIGN_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `wallet-forward-campaign-runner: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  // Deferred imports so argument/env validation always runs first and the
  // server-only service modules never load for an invalid invocation.
  const { PrismaClient } = await import("@prisma/client");
  const { createPrismaAdapter } = await import("@/lib/prisma-adapter");

  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

  const deps: CampaignDeps = {
    db: prisma as unknown as RunnerDbClient,
    resolveWallet: (args) => resolveWalletUsingPrismaClient(prisma as unknown as WalletLookupClient, args),
    // Fixed request timeout on both calls (see HTTP_REQUEST_TIMEOUT_MS doc
    // comment). A timed-out GET fails the health gate closed (identical to
    // any other network error). A timed-out POST throws exactly like any
    // other network failure, so it flows through the existing
    // ambiguous-submission recovery path unchanged — never an automatic
    // retry of the POST itself.
    httpGet: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS) });
      return { status: res.status, body: await readHttpResponseBody(res) };
    },
    httpPost: async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      });
      return { status: res.status, body: await readHttpResponseBody(res) };
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeEvidence: (record) => writeEvidenceLine(parsed.options.evidenceFile, record),
    getGitHead: defaultGetGitHead,
    isWorkingTreeClean: defaultIsWorkingTreeClean,
    checkEvidenceWritable: defaultCheckEvidenceWritable(parsed.options.evidenceFile),
  };

  try {
    const summary = await runWalletForwardCampaignRunner(parsed.options, deps);
    console.log(safeStringify(summary));
    process.exitCode = computeCampaignExitCode(summary.stoppedReason);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-campaign-runner error: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`wallet-forward-campaign-runner error: ${message}`);
    process.exitCode = 1;
  });
}

// Re-exported for reuse/testing convenience.
export {
  SUPPORTED_CHAIN_ID,
  WINDOW_SIZE_HARD_CAP_BLOCKS,
  MIN_WINDOW_SIZE_BLOCKS,
  POLICY_LABEL_MAX_LENGTH,
  validatePolicyLabelLength,
};
