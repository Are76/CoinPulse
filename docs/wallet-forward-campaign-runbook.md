# Wallet-Forward TRANSFERS Campaign Runner — Operator Runbook

**Status:** Stage 0 — implementation capability only. **No live campaign has
been executed or authorized by this document.** This runbook describes what
the campaign runner can do and the staged approval process required before
any live window runs — it is not itself an approval.

## What this is

`scripts/wallet-forward-campaign-runner.ts` (`npm run
backfill:wallet-forward-campaign -- <args>`) is a checkpointed, bounded
campaign layer built on top of the exact same tested atomic-window safety
primitives already used by the existing 5-window
`scripts/wallet-forward-sync-runner.ts` (see
`docs/wallet-scoped-historical-sync-runbook.md` for that runner's full
operator sequence, contamination-check requirements, and the manual
`POST /api/sync/manual` request contract both runners submit against). Those
shared primitives live in `scripts/lib/wallet-forward-sync-primitives.ts`.

## Why a separate campaign layer instead of raising the 5-window cap

The existing 5-window runner's external CLI contract, dry-run/execute
behavior, evidence format, and hard cap of 5 are unchanged by this PR — every
existing regression test for that file still passes against the exact same
observable behavior. Simply changing `MAX_WINDOWS_HARD_CAP = 5` to `1000`
would have quietly turned a small, easily-reviewed batch tool into a
different kind of operation (checkpointing, campaign identity, an
independent final-block boundary, and ambiguous-submission recovery all
become necessary at that scale) without any of the additional safety
machinery those larger runs require. Building a separate, explicitly bounded
campaign runner keeps the 5-window tool exactly as reviewed, and adds the
larger-scale capability as its own auditable unit that reuses — never
duplicates — the underlying gates.

## Implementation ceiling vs. live authorization

**`--max-windows` accepts 1–1000. This is an implementation ceiling, not live
authorization for a 1000-window campaign.** Every atomic window is still a
1,000-block, sequential, single `POST /api/sync/manual` request — the same
request the existing runner and the manual runbook already use. Live
execution of any bounded batch beyond a single window still requires an
explicit product-owner approval per the staged rollout below.

## Architecture

- **Atomic window:** exactly 1,000 blocks. `--window-size` must equal exactly
  `1000` for the campaign runner — a stricter, campaign-specific gate
  (`validateCampaignWindowSize`) than the shared `validateWindowSize`
  primitive the 5-window runner keeps using unchanged. This is what makes the
  1,000-window implementation ceiling map exactly to a 1,000,000-block
  maximum campaign span. `MANUAL_SYNC_MAX_BLOCK_SPAN`
  (`src/services/api/validation.ts`) is not modified.
- **Sequence, per window (identical to the existing runner):** pre-submit
  gates → one `POST /api/sync/manual` → exact submitted `runId` → exact
  `SyncRun` verification → cursor verification → contamination/duplicate/
  invariant gates → evidence persistence → only then the next window. No
  parallelization, no concurrent windows.
- **Campaign max:** `1 <= --max-windows <= 1000`.
- **`--authorized-final-block`:** an independent, mandatory boundary. A
  campaign stops at whichever of `{--max-windows, --authorized-final-block}`
  is reached first. The boundary is enforced at CLI validation, at campaign
  planning (deriving the effective window count), on every next-window
  calculation, and immediately before every HTTP POST
  (`validateWithinAuthorizedFinalBlock`) — so even if the `--max-windows`
  arithmetic were somehow wrong, no request whose `endBlock` exceeds
  `--authorized-final-block` is ever submitted.
- **Window alignment:** `--authorized-final-block` must equal
  `--first-window-start + N * --window-size - 1` for a positive integer N.
  An unaligned value is rejected before anything runs. No partial final
  window is supported in this PR.
- **Campaign identity:** an operator-supplied `--campaign-id` (restricted
  charset: starts with a letter/digit, then letters/digits/`-`/`_`, 1–64
  characters). It is not a database model and must never be confused with a
  `SyncRun.id`. It stays fixed for the whole invocation and is embedded in
  every generated policy label.
- **Policy labels:** deterministic, `<prefix>-<campaignId>-w<logicalWindowNumber>`.
  The logical window number is derived from block position
  (`computeLogicalCampaignWindowNumber`), not from the invocation's loop
  counter. The longest label the approved `--max-windows` could ever produce
  is checked against the real manual-sync `policyLabel` limit (128
  characters, `src/services/api/validation.ts`) at CLI/preflight time, and
  every planned label is collision-checked against existing `SyncRun` rows
  using the same query the 5-window runner already uses — `policyLabel` is
  not assumed to be a database-unique column.
- **Checkpoints:** every `--checkpoint-interval` windows (default 25).
  **25 is a maximum spacing, not merely a default suggestion** —
  `--checkpoint-interval` is bounded to `[1, 25]`; an operator may checkpoint
  more often, never less. A checkpoint re-verifies campaign-level properties
  not already covered by the per-window gates: local `git HEAD` unchanged
  since campaign start, working tree still clean, backend
  `/api/debug/health` still reports `ok`, the `--base-url`/environment
  classification (`app.env`) unchanged, the expected campaign cursor still
  matches live state exactly, campaign boundaries remain valid, and the
  evidence destination remains writable. **A PASSING checkpoint requires no
  fresh product-owner approval** — the campaign continues automatically
  inside its already-approved boundaries. **Any checkpoint FAILURE is a hard
  stop before the next POST, exactly like any other hard stop described in
  "Process errors and crash/restart" below: remaining campaign authorization
  expires immediately, and resuming requires canonical-state inspection, a
  fresh dry-run, and a new explicit product-owner approval.** `origin/main`
  moving while local `HEAD` stays unchanged is explicitly **not** a
  checkpoint failure — only local `HEAD` identity is checked.
- **Startup gates (before `campaign_start` and before any window can reach
  POST):** in order — validate immutable options (alignment, `--max-windows`,
  `--campaign-id`, fixed `--window-size`), obtain local `git HEAD`, require a
  clean working tree (`working_tree_dirty` otherwise), establish a healthy
  environment baseline via `/api/debug/health` (`initial_health_baseline_failed`
  otherwise — this also captures the `app.env` value every later checkpoint's
  drift check compares against), resolve the wallet
  (`wallet_not_found` otherwise), and only then persist the `campaign_start`
  evidence record. These are independent of, and run strictly before, the
  periodic checkpoint gate — with Stage 1 sized at 10 windows and a default
  checkpoint interval of 25, a short campaign could otherwise complete
  entirely from a dirty working tree or an unverified backend without either
  ever being checked.
- **HTTP request timeout:** the default real HTTP client
  (`GET /api/debug/health`, `POST /api/sync/manual`) applies a fixed 60-second
  request timeout (`HTTP_REQUEST_TIMEOUT_MS`, via `AbortSignal.timeout`). A
  timed-out GET fails the relevant health gate closed, identically to any
  other network error. A timed-out POST throws exactly like any other network
  failure and flows through the same ambiguous-submission recovery path
  below — never an automatic retry of the POST itself. This matters because
  `pollTimeoutMs` only starts once the POST call resolves; without a request
  timeout, a stuck POST could otherwise block a campaign indefinitely before
  the poll-timeout gate ever engages.

## Ambiguous-submission recovery

If a `POST /api/sync/manual` call itself throws (a network error — the
runner never received a `runId`, but the server may have already accepted
and processed the request), the runner may search canonical PostgreSQL for a
candidate `SyncRun` by the exact expected `policyLabel`. Recovery is accepted
**only** if exactly one row matches the full expected identity: `policyLabel`,
`walletId`, `chainId`, `sourceFamilies === ["TRANSFERS"]`, `startBlock`, and
`endBlock`. Zero matches, more than one match, or a candidate that matches on
`policyLabel` but differs on any other field all fail closed — the campaign
stops with `ambiguous_submission_unrecoverable` and is never automatically
resubmitted.

## Explicit recovery mode

`--recovery-mode` and `--recovery-of-run-id <SyncRun id>` (both required
together — either alone is rejected, and neither present leaves ordinary
campaign behavior byte-for-byte unchanged) let an operator explicitly recover
exactly one prior window whose only structured warning was the proven-benign
`RAW_BLOCKS_ALREADY_PERSISTED` code, without weakening the ordinary strict
`warningCount === 0` gate for every other window. See the PR description for
the full eligibility contract (R1–R6): historical `null`/malformed/truncated
classification, `UNKNOWN`, mixed codes, any future code, and a zero-warning
source run are all rejected.

- **The recovery window is derived from the CLI, not the live cursor.** It is
  exactly `[--first-window-start, --first-window-start + --window-size - 1]`.
  `--expected-cursor-to` must already equal that window's `endBlock` —
  recovery only ever targets the current cursor frontier, never an arbitrary
  historical window.
- **Recovery is a single bounded pre-loop step, run at most once.** After a
  successful recovery (or a dry-run eligibility proof), the runner falls
  through into the ordinary campaign loop with fully unchanged, strict
  behavior — no persistent "tolerant campaign" state, and no window after the
  first can ever use the recovery exception.
- **A live campaign span must authorize at least one ordinary window after
  the recovered range.** `--authorized-final-block` is validated against the
  *post-recovery* effective first ordinary window
  (`options.firstWindowStart + windowSizeBlocks`), not the recovery window's
  own start, so recovery never silently consumes one ordinary window's worth
  of authorized budget. This also means **campaign recovery is not currently
  a "recover-only and exit" operation** — `validateAuthorizedFinalBlockAlignment`
  requires at least one full ordinary window's span past the recovered range,
  so an `--authorized-final-block` that covers only the recovery window
  itself is rejected as misaligned (or as covering zero ordinary windows).
  An operator must authorize at minimum `recovery window + one ordinary
  post-recovery window` before campaign execution is valid. If this
  minimum-span requirement is ever intentionally relaxed to support a genuine
  recover-only invocation, that is a distinct, separately-reviewed change —
  not something this runbook currently describes as supported.
- **Ambiguous-submission recovery applies to the recovery POST too.** If the
  recovery request itself throws (network error), the runner reconciles
  against canonical PostgreSQL using the exact same identity proof described
  above in "Ambiguous-submission recovery" (policyLabel + walletId + chainId
  + sourceFamilies + exact block range) — never a second, blind-retry POST.
- **The recovery flow has its own exception boundary.** If any operation
  inside the recovery attempt throws unexpectedly after canonical state may
  already have changed (a DB read, the ambiguous-submission lookup, polling,
  a post-run cursor/contamination/duplicate check), the runner never rejects
  uncaught: it returns a controlled `stoppedReason: "unexpected_error"`
  result that preserves every recovery fact already known (a reconciled/
  observed `runId`, `submittedAt`, `terminalAt`, `terminalStatus`,
  `warningCount`, `postconditionsPassed`) and makes a best-effort attempt to
  write an `unexpected_error` evidence record. No automatic retry and no
  ordinary next-window POST ever follow it.
- **Evidence:** a dedicated `recovery_window` record kind, written both for a
  dry-run eligibility proof (`outcome: "dry_run_planned"`) and for an
  execute-mode attempt (`outcome: "recovered"` or `"failed_invariant"`).
  Fields include `sourceRunId`, `policyLabel`, the recovery `runId` (execute
  mode only), the expected/actual range, `submittedAt`/`terminalAt`,
  `terminalStatus`, `warningCount`, `warningDetails`, and
  `invariantFailures`. The final `campaign_summary` record additionally
  carries a `recovery` object (`sourceRunId`, `window`, `eligible`,
  `recovered`, `runId`, `terminalStatus`, `warningCount`,
  `postconditionsPassed`, `submittedAt`, `terminalAt`,
  `recoveredFromAmbiguousSubmission`, and `reason` when rejected) — this is
  the same shape returned as `CampaignSummary.recovery` to the CLI caller.
  **Canonical recovery outcome and evidence-write outcome are tracked
  separately:** `recovery.recovered`/`recovery.postconditionsPassed` reflect
  what canonical PostgreSQL state actually shows, set the moment that
  outcome is known — they are never reset to `false` merely because a later
  evidence write (or an unrelated later exception) failed. If evidence
  writing itself fails after a canonical recovery outcome is known, the
  runner reports `stoppedReason: "evidence_append_failed"` (or
  `"unexpected_error"` for the exception-boundary case above) while still
  exposing the true canonical outcome and `runId` in `recovery`.

## Evidence

Append-only JSONL (default
`operator-evidence/wallet-forward-campaign-runner/evidence.jsonl`, gitignored
— operator-local output, never committed). Record kinds: `campaign_start`,
`window`, `checkpoint`, `stop`, `campaign_summary`. Each relevant record
includes `campaignId`, the logical window number where applicable,
wallet/chain identity, source family, the initial approved cursor, window
size, approved `--max-windows`, `--authorized-final-block`, `policyLabel`,
the exact submitted `runId` when available, the range, cursor before/after,
gate outcome, and `stoppedReason` where applicable. No secrets are ever
written (the same redaction/sanitization used by the 5-window runner is
reused unchanged). **Every `stop` record includes `campaignId`** — this is
enforced centrally by the stop-writing path itself, not left to individual
call sites to remember, since append-only evidence may span multiple
invocations and a stop record without campaign identity could not be
reliably attributed.

**Evidence append failure is itself a gate.** If a canonical window
completes successfully but its evidence record cannot be written, the
already-committed PostgreSQL state is never rolled back, but the runner
never submits the next window — it exits non-zero with
`evidence_append_failed` and requires a fresh recovery/approval decision
before any continuation. This also applies to the final `campaign_summary`
record: if every canonical window in the approved batch completed but the
summary record itself fails to write, the runner still reports
`evidence_append_failed` and exits non-zero rather than a clean
`max_windows_reached` / `authorized_final_block_reached` — an operator must
never see a clean completion status when mandatory final provenance was not
actually recorded.

## Process errors and crash/restart

Unexpected errors anywhere in the campaign loop (including a DB failure) are
caught, a best-effort `stop` evidence record is written (its own failure
never masks the original error), no further window is ever submitted, and
the process exits non-zero with `unexpected_error`. There is no automatic
retry and no automatic skip of a failed window.

A hard stop or process crash **expires the remaining campaign authorization
immediately.** This runner implements no persistent campaign state and no
automatic resume. A later invocation requires, in order: canonical `SyncRun`
inspection for the last attempted window, coverage and integrity proof (per
the identity/coverage/integrity procedure already defined in
`docs/wallet-scoped-historical-sync-runbook.md`'s "Resuming after a hard
stop" section — this runner reuses that same procedure, not a new one), a
live `SyncCursor` read, a freshly derived next range, collision-free labels,
and a new, explicitly bounded product-owner approval.

## Environment

`--base-url` is a **required** CLI argument for the campaign runner with no
default — unlike the 5-window runner (which falls back to
`OPERATOR_RUNNER_BASE_URL` or `http://localhost:3000` if `--base-url` is
omitted), the campaign CLI parser rejects the command outright when
`--base-url` is not supplied, and `OPERATOR_RUNNER_BASE_URL` is never
consulted. This is a stricter rule than "always pass it explicitly" (the
5-window runner's rule — see "Target-environment binding" in
`docs/wallet-scoped-historical-sync-runbook.md`): for the campaign runner it
is enforced by the parser itself, not merely documented practice. This PR
does not build
production deployment infrastructure and does not attempt to solve
dev-vs-production server-mode detection beyond the existing
`/api/debug/health` `app.env` check already reused from the 5-window runner
pattern. Per `docs/operator-environments.md` §2.1, initial live rollout
remains **Local Operator Workstation only**.

## Staged live rollout (documentation only — this PR authorizes zero live windows)

Implementation capability of up to 1,000 windows does **not** authorize a
1000-window live campaign. Each stage below requires a fresh, explicit
product-owner approval, requires a successful dry-run/preflight immediately
before it, does not automatically authorize the next stage, and stops
immediately on any failed gate:

| Stage | `--max-windows` | Requires |
|---|---|---|
| 1 | 10 | Fresh approval + successful dry-run |
| 2 | 50 | Fresh approval + successful dry-run (after Stage 1 evidence reviewed) |
| 3 | 250 | Fresh approval + successful dry-run (after Stage 2 evidence reviewed) |
| 4 | 1000 | Fresh approval + successful dry-run (after Stage 3 evidence reviewed) |

**This implementation PR executes zero live campaign windows.** The
merge-time live ceiling is **Stage 1: 10 windows**, and only after a separate
explicit product-owner approval — not 1000, regardless of what
`--max-windows` accepts.

## Non-goals

- No database campaign model.
- No Redis queue, cron job, or background worker.
- No change to `/api/sync/manual`, `MANUAL_SYNC_MAX_BLOCK_SPAN`, the sync
  orchestrator, or operation-lock semantics.
- No rebuild, materialization, or pricing request — this runner has no such
  code path, identical to the 5-window runner.
- No repair of the existing ~11,528 still-ACTIVE fabricated transfer rows —
  out of scope, same as the 5-window runner.
- No continuation of the separately-governed paused chain-wide `TRANSFERS`
  backfill campaign (`scripts/transfer-backfill-runner.ts` and its own
  runbook) — entirely unrelated authorization.

## Related: the completion supervisor

`scripts/wallet-forward-supervisor.ts` is a separate, thin orchestration
layer that repeatedly invokes this campaign runner (as a child process, one
bounded child at a time) toward one immutable operator-authorized final
block, without changing anything described in this runbook. See
`docs/wallet-forward-supervisor-runbook.md` for its full contract.
