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
 *     child, respecting the child runner's own hard cap and checkpoint
 *     bounds),
 *   - a genuinely non-mutating dry-run planning path, distinct from
 *     execute-mode mutation postconditions,
 *   - sequential child invocation via an injectable process-runner
 *     abstraction (never a direct import of the child runner's internal
 *     orchestration function), with a bounded process timeout that fails
 *     closed to an explicit ambiguous-termination stop rather than an
 *     automatic retry,
 *   - child terminal-result verification (exit code, allowlisted clean
 *     `stoppedReason`, exact expected window count and cursor movement),
 *   - resume-safe child campaign identity derived from canonical persisted
 *     policy labels (never a local resume-state file),
 *   - canonical PostgreSQL re-verification between children (cursor, repo
 *     HEAD, working tree, backend environment identity),
 *   - verification that a "target already reached" resume state is backed
 *     by genuinely clean persisted terminal evidence, not merely a matching
 *     cursor value,
 *   - supervisor-level append-only evidence referencing child evidence,
 *   - fail-closed stop/continue decisions, including on unexpected
 *     dependency failures between children.
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
import { createRequire } from "node:module";
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
  type RunnerSyncRunRecord,
  getLiveTransfersCursor,
  listActivePolicyLabels,
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
  validateCheckpointInterval,
  type CampaignSummary,
} from "./wallet-forward-campaign-runner";

const execFileAsync = promisify(execFile);

// ─── Supervisor-specific safety constants (not operator-overridable) ──────────

export const HTTP_REQUEST_TIMEOUT_MS = 60_000;

/** The child runner's own default evidence path when `--evidence-file` is
 * not passed (see `DEFAULT_EVIDENCE_FILE` in
 * `scripts/wallet-forward-campaign-runner.ts`). Duplicated here as a literal
 * — deliberately, rather than importing/exporting it — so this file never
 * needs a change to the campaign runner's module surface for a single
 * constant. Covered by a regression test that pins this exact value; if the
 * child runner's default ever changes, that test (and this constant) must be
 * updated together. */
export const DEFAULT_CHILD_EVIDENCE_FILE = "operator-evidence/wallet-forward-campaign-runner/evidence.jsonl";

/** Fixed budget for process/tooling startup (npx resolving tsx, tsx
 * compiling, the child connecting to PostgreSQL/Redis) before the child's
 * own per-window polling even begins. */
export const CHILD_PROCESS_STARTUP_MARGIN_MS = 5 * 60_000;
/** Per-window overhead budget beyond the child's own HTTP request timeout
 * and poll timeout (gate/query round-trips, evidence writes, checkpoints). */
export const CHILD_PROCESS_PER_WINDOW_OVERHEAD_MS = 60_000;

/** Node's `child_process.spawn` `timeout` option is implemented on top of
 * `setTimeout`, which silently truncates any delay beyond a 32-bit signed
 * integer (2,147,483,647 ms, ~24.8 days) instead of honoring it — a value
 * past this ceiling does not become "wait longer," it becomes "kill almost
 * immediately." `computeChildProcessTimeoutMs` must never hand `spawn` a
 * value beyond this, or a large, legitimate `--campaign-max-windows` /
 * `--poll-timeout-ms` combination would silently self-sabotage into
 * spurious `child_process_ambiguous_termination` stops. */
export const MAX_CHILD_PROCESS_TIMEOUT_MS = 2_147_483_647;

/** Derives a bounded child-process timeout from the operator-supplied poll
 * timeout and the child's own window budget, so a hung `npx`/`tsx`/startup
 * path (before the child's own `--poll-timeout-ms` loop even engages) can
 * never make the supervisor wait forever. This is NOT the same failure mode
 * as the child's internal poll timeout — it exists purely to bound the
 * supervisor's own wait on the child OS process. Always clamped to
 * `MAX_CHILD_PROCESS_TIMEOUT_MS` — see that constant's doc comment for why
 * an unclamped value would be actively dangerous, not merely generous. */
export function computeChildProcessTimeoutMs(args: { childMaxWindows: number; pollTimeoutMs: number }): number {
  const derived =
    CHILD_PROCESS_STARTUP_MARGIN_MS +
    args.childMaxWindows * (args.pollTimeoutMs + HTTP_REQUEST_TIMEOUT_MS + CHILD_PROCESS_PER_WINDOW_OVERHEAD_MS);
  return Math.min(derived, MAX_CHILD_PROCESS_TIMEOUT_MS);
}

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
 * Derives the next bounded child campaign purely from cursor state (real
 * canonical PostgreSQL state in execute mode; a supervisor-local, in-memory
 * SIMULATED cursor in dry-run mode — see `runWalletForwardSupervisor`'s
 * `simulatedCursorToBlock`, which mirrors the exact same simulation pattern
 * the campaign runner itself already uses for its own dry-run windows)
 * plus the immutable operator inputs — never from any in-memory count of
 * previously-run children. This function itself does not know or care which
 * kind of cursor it was given; the caller is responsible for that
 * distinction.
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

export type ChildProcessResult = { exitCode: number; stdout: string; stderr: string; signal?: string | null };

export type ChildResultVerification = { ok: true; summary: CampaignSummary } | { ok: false; reason: string };

/**
 * Parses the child runner's stdout (its single `console.log(safeStringify(summary))`
 * line) and verifies it represents an EXACT clean terminal completion for the
 * exact bounded child campaign the supervisor asked for. Anything else —
 * a signal-terminated process, non-zero exit, unparseable stdout, a
 * `stoppedReason` outside the child runner's own allowlist, or a window/
 * cursor count that does not exactly match what was requested — fails
 * closed. The supervisor never infers a partial success.
 *
 * `execute` changes only what a CLEAN completion is expected to look like:
 * the campaign runner's own dry-run behavior deliberately leaves
 * `windowsCompleted` at 0 (it never mutates PostgreSQL) while still
 * advancing `lastWindowNumber` for each simulated window — so dry-run
 * verification must never be held to execute-mode's "windowsCompleted
 * equals the requested window count" postcondition.
 */
export function verifyChildCleanResult(args: {
  processResult: ChildProcessResult;
  execute: boolean;
  expectedChildMaxWindows: number;
}): ChildResultVerification {
  const { processResult, execute, expectedChildMaxWindows } = args;

  if (processResult.signal) {
    return {
      ok: false,
      reason: `child process was terminated by signal ${processResult.signal} before reaching a terminal state — this is an AMBIGUOUS execution outcome (canonical state may already have been mutated) and requires human review, never automatic continuation`,
    };
  }

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

  const expectedWindowsCompleted = execute ? expectedChildMaxWindows : 0;
  if (summary.windowsCompleted !== expectedWindowsCompleted) {
    return {
      ok: false,
      reason: `child campaign completed ${summary.windowsCompleted} window(s), expected exactly ${expectedWindowsCompleted}${execute ? "" : " (dry-run never mutates PostgreSQL, so windowsCompleted must stay 0)"}`,
    };
  }

  if (summary.lastWindowNumber !== expectedChildMaxWindows) {
    return {
      ok: false,
      reason: `child campaign lastWindowNumber ${summary.lastWindowNumber} does not match expected final logical window number ${expectedChildMaxWindows}`,
    };
  }

  return { ok: true, summary };
}

/** Verifies the canonical PostgreSQL cursor after an EXECUTE-mode child
 * campaign completed moved EXACTLY as expected — anchor unchanged, toBlock
 * at exactly the child's authorized boundary. Never inferred from the
 * child's self-reported summary alone. Never applied to a dry-run child —
 * see `verifyDryRunNoCanonicalMutation` for that path instead. */
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

/** Verifies a DRY-RUN child genuinely mutated nothing: the canonical cursor
 * read immediately after the child returns must be byte-for-byte identical
 * to what was read immediately before it was invoked. This is the
 * dry-run-specific counterpart to `verifyCanonicalCursorAfterChild` — dry
 * run is never subjected to that function's "cursor advanced to the
 * requested boundary" postcondition, but it IS held to a stricter
 * "absolutely nothing changed" postcondition, since `--execute` was never
 * passed. */
export function verifyDryRunNoCanonicalMutation(args: {
  cursorBefore: { fromBlock: bigint; toBlock: bigint };
  cursorAfter: { fromBlock: bigint; toBlock: bigint } | null;
}): GateResult {
  if (!args.cursorAfter) {
    return { ok: false, reason: "canonical TRANSFERS SyncCursor disappeared during a dry-run child campaign" };
  }
  if (args.cursorAfter.fromBlock !== args.cursorBefore.fromBlock || args.cursorAfter.toBlock !== args.cursorBefore.toBlock) {
    return {
      ok: false,
      reason: `canonical TRANSFERS SyncCursor changed during a dry-run child campaign (before: ${args.cursorBefore.fromBlock}-${args.cursorBefore.toBlock}, after: ${args.cursorAfter.fromBlock}-${args.cursorAfter.toBlock}) — dry-run must never mutate canonical state`,
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

/** Backend environment identity drift gate. HTTP 200 + `status: "ok"` alone
 * is not sufficient — the same base URL can keep responding healthy while
 * `app.env` (dev/staging/prod classification) silently changes underneath
 * it, e.g. a repointed or redeployed endpoint. Captured once at supervisor
 * start and required to match before every child, mirroring the campaign
 * runner's own per-checkpoint `app.env` drift check. */
export function evaluateEnvironmentDrift(args: {
  supervisorStartAppEnv: string | undefined;
  currentAppEnv: string | undefined;
}): GateResult {
  if (args.currentAppEnv !== args.supervisorStartAppEnv) {
    return {
      ok: false,
      reason: `environment/base-url classification (app.env) changed from ${args.supervisorStartAppEnv} to ${args.currentAppEnv} since supervisor start`,
    };
  }
  return { ok: true };
}

/**
 * Verifies that a "target already reached" resume state is backed by
 * genuinely clean persisted evidence, not merely a matching cursor value. A
 * prior campaign can advance `SyncCursor.toBlock` to some block and then
 * still stop non-clean (e.g. `invariant_failed_after_run` because its
 * terminal `SyncRun` carried warnings, or `evidence_append_failed`) — the
 * cursor mutation itself is a side effect of the sync pipeline, independent
 * of whether the campaign runner's own post-run gates judged that run clean.
 * Re-running the supervisor against the same `--authorized-final-block`
 * must not silently convert that unresolved hard stop into a clean
 * `authorized_final_block_already_reached`.
 *
 * This intentionally does NOT re-run or duplicate the campaign runner's
 * contamination/duplicate-row/checkpoint invariant logic (those already ran,
 * against this exact range, when the window was originally submitted) — it
 * only re-reads the same canonical `SyncRun` fields the campaign runner
 * itself uses to judge "was this run's own terminal state clean"
 * (`status`, `warningCount`, `warningDetails`, `errorMessage`,
 * `failedSourceFamily`), for the run(s) whose `endBlock` matches the
 * cursor's current position.
 *
 * `candidates` must already be filtered by chainId/walletId/endBlock (the
 * caller's DB query) — this function additionally requires that the
 * TRANSFERS-only subset of those candidates contains EXACTLY ONE row. Zero
 * matches (no persisted evidence to prove cleanliness) or more than one
 * match (ambiguous — normally prevented by policy-label collision checks,
 * but never assumed) both fail closed.
 */
export function verifyPriorTerminalOperationClean(args: {
  candidates: readonly RunnerSyncRunRecord[];
}): { ok: true } | { ok: false; reason: string } {
  const transfersCandidates = args.candidates.filter(
    (r) => r.sourceFamilies.length === 1 && r.sourceFamilies[0] === WALLET_FORWARD_SYNC_SOURCE_FAMILIES[0],
  );

  if (transfersCandidates.length === 0) {
    return {
      ok: false,
      reason:
        "no persisted TRANSFERS SyncRun evidence was found for the canonical cursor's current endBlock — cannot verify the prior terminal operation that produced this state was clean",
    };
  }
  if (transfersCandidates.length > 1) {
    return {
      ok: false,
      reason: `${transfersCandidates.length} TRANSFERS SyncRun rows share the canonical cursor's endBlock — ambiguous, cannot verify a single clean terminal operation`,
    };
  }

  const [run] = transfersCandidates;
  const reasons: string[] = [];
  if (run.status !== "COMPLETED") reasons.push(`expected status COMPLETED, got ${run.status}`);
  if (run.warningCount !== 0) reasons.push(`expected warningCount 0, got ${run.warningCount}`);
  if (!Array.isArray(run.warningDetails) || run.warningDetails.length !== 0) {
    reasons.push(`expected warningDetails to be empty, got ${JSON.stringify(run.warningDetails)}`);
  }
  if (run.errorMessage !== null) reasons.push(`expected errorMessage null, got ${JSON.stringify(run.errorMessage)}`);
  if (run.failedSourceFamily !== null) {
    reasons.push(`expected failedSourceFamily null, got ${run.failedSourceFamily}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reason: reasons.join("; ") };
}

// ─── Supervisor-scoped validation gates (pure) ────────────────────────────────

export function validateCampaignMaxWindowsForSupervisor(args: { campaignMaxWindows: number }): GateResult {
  return validateCampaignMaxWindows({ maxWindows: args.campaignMaxWindows });
}

export function validateCheckpointIntervalForSupervisor(args: { checkpointIntervalWindows: number }): GateResult {
  // Reuses the child campaign runner's own bound ([1, 25]) unchanged — an
  // invalid supervisor-level value must fail before any evidence is written
  // or any child is spawned, rather than surfacing later as a confusing
  // child-side rejection after the supervisor already committed to that
  // child.
  return validateCheckpointInterval({ checkpointIntervalWindows: args.checkpointIntervalWindows });
}

export function validateCampaignIdPrefix(args: { campaignIdPrefix: string }): GateResult {
  // The supervisor builds each child's --campaign-id as
  // `${campaignIdPrefix}-c${childCampaignNumber}`. The child runner enforces
  // its own CAMPAIGN_ID_PATTERN on the fully-built id, so validating the
  // prefix here with the same charset (a prefix is itself a valid, shorter
  // campaign id) catches an invalid prefix before any child is invoked,
  // rather than surfacing as a confusing child-side failure later. This is
  // a coarse, early check only — the FULLY BUILT id for every child is
  // re-validated by `validateChildCampaignId` immediately before that
  // child's evidence is written or it is spawned, since a prefix close to
  // the 64-character ceiling (or a large child number after many resumes)
  // can still produce an overlong id even when the prefix alone passes.
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

/** Validates the FULLY BUILT child campaign id (not just the prefix) against
 * the exact same `CAMPAIGN_ID_PATTERN` the child runner itself enforces —
 * including the 64-character ceiling. A prefix close to that ceiling, or a
 * large child number after many resumes, can build an id the prefix-only
 * gate would never catch. Must be called for every child, before that
 * child's `child_campaign_start` evidence is written or it is spawned. */
export function validateChildCampaignId(childCampaignId: string): GateResult {
  if (!CAMPAIGN_ID_PATTERN.test(childCampaignId)) {
    return {
      ok: false,
      reason: `generated child --campaign-id "${childCampaignId}" (${childCampaignId.length} characters) does not satisfy the campaign runner's id contract (letters/digits/"-"/"_" only, 1-64 characters total) — choose a shorter --campaign-id-prefix`,
    };
  }
  return { ok: true };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derives the child campaign number a fresh supervisor invocation should
 * start numbering from, purely from canonical persisted policy labels —
 * never from a local resume-state file. A restarted supervisor using the
 * same `--campaign-id-prefix` must not blindly restart at `c1`: the child
 * runner's own repository-wide `validateNoPolicyLabelCollision` gate
 * rejects ANY previously-used policy label forever (it is not scoped to
 * "active" runs only), so re-numbering from 1 after a prior invocation
 * already produced windows under `c1` would make the very first window of
 * the new `c1` collide with a real, already-persisted label.
 *
 * Scans every existing policy label for this chain for the pattern
 * `<policyLabelPrefix>-<campaignIdPrefix>-c<N>-w<windowNumber>` and returns
 * `max(N) + 1` (or `1` if none match) — always safely past every child
 * number this exact prefix pair has ever produced a window under.
 */
export function computeStartingChildCampaignNumber(args: {
  existingPolicyLabels: readonly string[];
  policyLabelPrefix: string;
  campaignIdPrefix: string;
}): number {
  const pattern = new RegExp(
    `^${escapeRegExp(args.policyLabelPrefix)}-${escapeRegExp(args.campaignIdPrefix)}-c(\\d+)-w\\d+$`,
  );
  let maxChildNumber = 0;
  for (const label of args.existingPolicyLabels) {
    const match = pattern.exec(label);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxChildNumber) {
        maxChildNumber = n;
      }
    }
  }
  return maxChildNumber + 1;
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
  "  child campaign runner in dry-run mode, which never mutates PostgreSQL).",
  "  --authorized-final-block is an IMMUTABLE operator input. The supervisor",
  "  never queries chain head, never computes a new target, and never",
  "  expands this value while running.",
  "  --campaign-max-windows bounds each CHILD campaign (same [1,1000] range",
  "  and same fixed --window-size=1000 rule as the campaign runner). The",
  "  supervisor may invoke multiple bounded children sequentially to reach",
  "  --authorized-final-block.",
  "  --campaign-id-prefix builds each child's --campaign-id as",
  "  \"<prefix>-c<childCampaignNumber>\" — the starting number is derived from",
  "  canonical persisted policy labels on each invocation, so re-running the",
  "  supervisor with the same prefix never collides with prior children.",
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

  const checkpointIntervalGate = validateCheckpointIntervalForSupervisor({ checkpointIntervalWindows });
  if (!checkpointIntervalGate.ok) return { ok: false, error: checkpointIntervalGate.reason };

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
   * reviewable process boundary. `timeoutMs` bounds how long the supervisor
   * will wait on the OS process before treating it as a hard, ambiguous
   * stop (see `computeChildProcessTimeoutMs`). */
  runChildCampaign: (args: string[], timeoutMs: number) => Promise<ChildProcessResult>;
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
    return { gate: { ok: false, reason: `server health check did not report ok (status ${response.status})` }, appEnv };
  }
  return { gate: { ok: true }, appEnv };
}

function buildChildArgs(args: {
  options: SupervisorCliOptions;
  plan: Extract<NextChildPlan, { done: false; error?: undefined }>;
  childCampaignId: string;
}): string[] {
  const { options, plan, childCampaignId } = args;
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
    childCampaignId,
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
  const checkpointIntervalGate = validateCheckpointIntervalForSupervisor({
    checkpointIntervalWindows: options.checkpointIntervalWindows,
  });
  if (!checkpointIntervalGate.ok) {
    return stopSupervisor(deps, "invalid_checkpoint_interval", checkpointIntervalGate.reason, 0, null);
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

  // ── Step 4: healthy environment baseline. Captures app.env as the
  // baseline every later iteration's environment-drift check compares
  // against. ──
  const startHealth = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
  if (!startHealth.gate.ok) {
    return stopSupervisor(
      deps,
      "initial_health_baseline_failed",
      (startHealth.gate as { ok: false; reason: string }).reason,
      0,
      null,
    );
  }
  // A missing app.env at baseline must fail closed, not silently disable
  // drift detection: evaluateEnvironmentDrift compares supervisorStartAppEnv
  // against each iteration's currentAppEnv, and undefined === undefined
  // would otherwise let a backend that never reports app.env pass every
  // environment-identity check for the entire run.
  if (startHealth.appEnv === undefined) {
    return stopSupervisor(
      deps,
      "initial_health_baseline_failed",
      "health check response did not include app.env — cannot establish an environment identity baseline required for cross-child drift detection",
      0,
      null,
    );
  }
  const supervisorStartAppEnv = startHealth.appEnv;

  // ── Step 5: resolve wallet. ──
  const wallet = await deps.resolveWallet({ walletAddress: options.walletAddress, chainId: options.chainId });
  if (!wallet) {
    return stopSupervisor(deps, "wallet_not_found", undefined, 0, null);
  }

  // ── Step 5.5: derive a collision-free starting child campaign number from
  // canonical persisted policy labels — never from a hardcoded 1 or any
  // local resume-state file. See computeStartingChildCampaignNumber's doc
  // comment. ──
  const existingPolicyLabels = await listActivePolicyLabels(deps.db, options.chainId);
  const startingChildCampaignNumber = computeStartingChildCampaignNumber({
    existingPolicyLabels,
    policyLabelPrefix: options.policyLabelPrefix,
    campaignIdPrefix: options.campaignIdPrefix,
  });

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
    startingChildCampaignNumber,
    supervisorStartHead,
    supervisorStartAppEnv: supervisorStartAppEnv ?? null,
    baseUrl: options.baseUrl,
  });
  if (!startWrite.ok) {
    return { stoppedReason: "evidence_append_failed", detail: startWrite.message, childCampaignsCompleted: 0, lastChildCampaignNumber: null };
  }

  let childCampaignsCompleted = 0;
  let lastChildCampaignNumber: number | null = null;
  let childCampaignNumber = startingChildCampaignNumber;
  // Dry-run only: in-memory simulated cursor upper edge, mirroring the
  // campaign runner's own dry-run simulation. Never read or written to
  // canonical PostgreSQL — see verifyDryRunNoCanonicalMutation, which
  // actively proves that.
  let simulatedCursorToBlock: bigint | null = null;

  for (;;) {
    // ── SIGINT must stop before another child campaign starts. Checked at
    // the top of every iteration, including the first. ──
    if (deps.isInterrupted()) {
      return stopSupervisor(deps, "interrupted", "SIGINT received before starting the next child campaign", childCampaignsCompleted, lastChildCampaignNumber);
    }

    try {
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

      // ── Environment health AND identity, re-checked before every child. ──
      const health = await checkServerHealthDetailed(deps.httpGet, options.baseUrl);
      if (!health.gate.ok) {
        return stopSupervisor(deps, "health_check_failed", (health.gate as { ok: false; reason: string }).reason, childCampaignsCompleted, lastChildCampaignNumber);
      }
      const envDriftGate = evaluateEnvironmentDrift({ supervisorStartAppEnv, currentAppEnv: health.appEnv });
      if (!envDriftGate.ok) {
        return stopSupervisor(deps, "environment_drift_detected", envDriftGate.reason, childCampaignsCompleted, lastChildCampaignNumber);
      }

      // Dry-run planning uses the in-memory simulated cursor once at least
      // one simulated child has completed; execute mode (and the very first
      // dry-run iteration) always plans from genuine canonical state.
      const planningCursor =
        !options.execute && simulatedCursorToBlock !== null
          ? { fromBlock: liveCursor.fromBlock, toBlock: simulatedCursorToBlock }
          : liveCursor;

      const plan = computeNextChildPlan({
        liveCursor: planningCursor,
        windowSizeBlocks: options.windowSizeBlocks,
        campaignMaxWindows: options.campaignMaxWindows,
        authorizedFinalBlock: options.authorizedFinalBlock,
        childCampaignNumber,
      });

      if ("error" in plan) {
        return stopSupervisor(deps, "canonical_state_invalid", plan.error, childCampaignsCompleted, lastChildCampaignNumber);
      }
      if (plan.done) {
        // This branch is only ever reached using GENUINE canonical state
        // (planningCursor only diverges from liveCursor once a simulated
        // dry-run child has already completed — see the bottom-of-loop
        // return below, which exits before the next iteration's plan.done
        // check could ever be reached via simulation). A cursor that
        // already sits at the target does not by itself prove the run that
        // put it there was clean — verify persisted terminal evidence
        // unless the cursor has never moved from its own anchor (a freshly
        // onboarded wallet with zero synced windows has no terminal
        // operation to verify, and nothing to falsify).
        if (liveCursor.fromBlock !== liveCursor.toBlock) {
          const candidates = await deps.db.syncRun.findMany({
            where: { chainId: options.chainId, walletId: wallet.id, endBlock: liveCursor.toBlock },
          });
          const cleanCheck = verifyPriorTerminalOperationClean({ candidates });
          if (!cleanCheck.ok) {
            return stopSupervisor(
              deps,
              "prior_terminal_operation_not_verified_clean",
              cleanCheck.reason,
              childCampaignsCompleted,
              lastChildCampaignNumber,
            );
          }
        }

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

      const childCampaignId = buildChildCampaignId(options.campaignIdPrefix, plan.childCampaignNumber);

      // ── Validate the FULLY BUILT child id — not just the prefix — before
      // any evidence is written or the child is spawned. ──
      const childIdGate = validateChildCampaignId(childCampaignId);
      if (!childIdGate.ok) {
        return stopSupervisor(
          deps,
          "child_campaign_id_invalid",
          childIdGate.reason,
          childCampaignsCompleted,
          lastChildCampaignNumber,
          { childCampaignNumber: plan.childCampaignNumber },
        );
      }

      const childArgs = buildChildArgs({ options, plan, childCampaignId });
      const effectiveChildEvidenceFile = options.childEvidenceFile ?? DEFAULT_CHILD_EVIDENCE_FILE;

      const childStartWrite = await writeEvidenceOrNull(deps, {
        kind: "child_campaign_start",
        at: deps.now().toISOString(),
        childCampaignNumber: plan.childCampaignNumber,
        childCampaignId,
        walletAddress: options.walletAddress,
        chainId: options.chainId,
        sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
        mode: options.execute ? "execute" : "dry-run",
        canonicalCursorBefore: { fromBlock: liveCursor.fromBlock.toString(), toBlock: liveCursor.toBlock.toString() },
        planningCursorBefore: { fromBlock: planningCursor.fromBlock.toString(), toBlock: planningCursor.toBlock.toString() },
        authorizedFinalBlock: options.authorizedFinalBlock.toString(),
        expectedChildRange: { startBlock: plan.firstWindowStart.toString(), endBlock: plan.childAuthorizedFinalBlock.toString() },
        childMaxWindows: plan.childMaxWindows,
        childEvidenceFile: effectiveChildEvidenceFile,
      });
      if (!childStartWrite.ok) {
        return { stoppedReason: "evidence_append_failed", detail: childStartWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
      }

      const timeoutMs = computeChildProcessTimeoutMs({
        childMaxWindows: plan.childMaxWindows,
        pollTimeoutMs: options.pollTimeoutMs,
      });

      let processResult: ChildProcessResult;
      try {
        processResult = await deps.runChildCampaign(childArgs, timeoutMs);
      } catch (err) {
        // The child process itself could not even be spawned/awaited (e.g.
        // the OS refused to spawn it). This is never treated as an
        // ambiguous submission requiring reconciliation — that logic
        // belongs entirely to the child runner for its own HTTP POST. Here
        // it is simply a hard stop: the supervisor never guesses whether
        // the child mutated anything.
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
        execute: options.execute,
        expectedChildMaxWindows: plan.childMaxWindows,
      });

      if (!verification.ok) {
        // A signal-terminated process (e.g. this supervisor's own bounded
        // timeout killed it) is reported as a distinct, explicitly
        // ambiguous stop reason — never folded into the generic
        // "not clean" bucket — because canonical state may already have
        // been mutated and that must be surfaced for human review, not
        // silently treated the same as an ordinary clean-failure exit.
        const stoppedReason = processResult.signal ? "child_process_ambiguous_termination" : "child_result_not_clean";
        const resultWrite = await writeEvidenceOrNull(deps, {
          kind: "child_campaign_result",
          at: deps.now().toISOString(),
          childCampaignNumber: plan.childCampaignNumber,
          childCampaignId,
          ok: false,
          reason: verification.reason,
          exitCode: processResult.exitCode,
          signal: processResult.signal ?? null,
        });
        if (!resultWrite.ok) {
          return { stoppedReason: "evidence_append_failed", detail: resultWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
        }
        return stopSupervisor(
          deps,
          stoppedReason,
          verification.reason,
          childCampaignsCompleted,
          lastChildCampaignNumber,
          { childCampaignNumber: plan.childCampaignNumber, childCampaignId },
        );
      }

      if (options.execute) {
        // ── Verify canonical cursor moved EXACTLY as expected. Never trust
        // the child's self-reported summary alone for this. ──
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
      } else {
        // ── Dry-run: prove nothing was mutated, rather than checking a
        // mutation postcondition that would never hold. ──
        const liveCursorAfter = await getLiveTransfersCursor(deps.db, wallet.id, options.chainId);
        const noMutationGate = verifyDryRunNoCanonicalMutation({ cursorBefore: liveCursor, cursorAfter: liveCursorAfter });
        if (!noMutationGate.ok) {
          const resultWrite = await writeEvidenceOrNull(deps, {
            kind: "child_campaign_result",
            at: deps.now().toISOString(),
            childCampaignNumber: plan.childCampaignNumber,
            childCampaignId,
            ok: false,
            reason: noMutationGate.reason,
            exitCode: processResult.exitCode,
          });
          if (!resultWrite.ok) {
            return { stoppedReason: "evidence_append_failed", detail: resultWrite.message, childCampaignsCompleted, lastChildCampaignNumber };
          }
          return stopSupervisor(
            deps,
            "dry_run_unexpected_mutation",
            noMutationGate.reason,
            childCampaignsCompleted,
            lastChildCampaignNumber,
            { childCampaignNumber: plan.childCampaignNumber, childCampaignId },
          );
        }
        simulatedCursorToBlock = plan.childAuthorizedFinalBlock;
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
        mode: options.execute ? "execute" : "dry-run",
        canonicalCursorAfter: options.execute
          ? { fromBlock: plan.anchorFromBlock.toString(), toBlock: plan.childAuthorizedFinalBlock.toString() }
          : null,
        simulatedCursorAfter: options.execute
          ? null
          : { fromBlock: plan.anchorFromBlock.toString(), toBlock: plan.childAuthorizedFinalBlock.toString() },
        childEvidenceFile: effectiveChildEvidenceFile,
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
    } catch (err) {
      // Any dependency rejection not already handled above (a canonical
      // cursor read, a git HEAD/working-tree check, a health check, or
      // anything else in this iteration throwing instead of resolving)
      // still produces fail-closed supervisor stop evidence here — it must
      // never bypass the evidence contract by only reaching the top-level
      // `main()` catch, which prints to stderr and exits non-zero but
      // never appends a `stop` evidence record.
      const message = err instanceof Error ? err.message : String(err);
      return stopSupervisor(deps, "unexpected_error", message, childCampaignsCompleted, lastChildCampaignNumber);
    }
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

const require = createRequire(import.meta.url);

/**
 * Resolves the real, on-disk JS entrypoint of the already-installed `tsx`
 * devDependency (its published `"./cli"` export, `tsx/dist/cli.mjs`) via
 * Node's own module resolution — never a hardcoded relative path, so a
 * future `tsx` upgrade or lockfile-driven `node_modules` layout change is
 * still resolved correctly.
 *
 * This is the fix for `spawn npx ENOENT` on Windows, and it is deliberately
 * NOT "spawn npx.cmd instead of npx" — that alternative was tried first and
 * still fails, with a different, more confusing error (`spawn EINVAL`):
 * Node's `child_process.spawn`/`execFile`, even naming the `.cmd` shim
 * explicitly, refuse to launch a `.bat`/`.cmd` file directly on Windows
 * unless `shell: true` is set (Windows batch files are not standalone
 * executables — `CreateProcess` cannot run them without a command
 * interpreter). `npx` itself is shipped as exactly such a `.cmd` shim on
 * Windows, so there is no bare-executable spawn of "npx" that works on
 * Windows without `shell: true`.
 *
 * Resolving straight to `tsx`'s own `.mjs` CLI script and spawning it with
 * `process.execPath` (the real `node`/`node.exe` binary, always a genuine
 * executable on every platform, never a shell shim) sidesteps the
 * batch-file restriction entirely — `npx` is not invoked at all, so its
 * platform-specific shim shape is no longer this file's problem. Arguments
 * remain a plain array passed straight to the child process; nothing is
 * concatenated into a command string, and `shell` is never set.
 */
export function resolveTsxCliPath(): string {
  return require.resolve("tsx/cli");
}

/** Real child-process runner: spawns `<node> <tsx-cli.mjs> --conditions
 * react-server <runner-script> <args>` (see `resolveTsxCliPath`'s doc
 * comment for why this replaces `npx tsx ...`) and collects its exit code /
 * stdout / stderr / termination signal. This is the ONLY place the
 * supervisor's real implementation touches the child runner — it never
 * imports its orchestration function directly. `timeoutMs` is passed
 * straight to `spawn`'s own `timeout` option, which sends `killSignal` if
 * the child has not exited by then — the resulting `close` event's `signal`
 * is what lets `verifyChildCleanResult` distinguish a genuine clean/unclean
 * exit from an ambiguous, supervisor-initiated termination. */
function defaultRunChildCampaign(args: string[], timeoutMs: number): Promise<ChildProcessResult> {
  return new Promise((resolve, reject) => {
    const [scriptPath, ...rest] = args;
    const tsxCliPath = resolveTsxCliPath();
    const child = spawn(process.execPath, [tsxCliPath, "--conditions", "react-server", scriptPath, ...rest], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
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
    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, stdout, stderr, signal: signal ?? null });
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
