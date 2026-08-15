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

- **Atomic window:** 1,000 blocks, unchanged. `MANUAL_SYNC_MAX_BLOCK_SPAN`
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
- **Checkpoints:** every `--checkpoint-interval` windows (default and
  required baseline: 25). A checkpoint re-verifies campaign-level
  properties not already covered by the per-window gates: local `git HEAD`
  unchanged since campaign start, working tree still clean, backend
  `/api/debug/health` still reports `ok`, the `--base-url`/environment
  classification (`app.env`) unchanged, the expected campaign cursor still
  matches live state exactly, campaign boundaries remain valid, and the
  evidence destination remains writable. A checkpoint failure is a hard stop
  before the next POST — it does not require a fresh product-owner approval
  as long as the campaign remains inside its already-approved boundaries,
  but it does stop the run. `origin/main` moving while local `HEAD` stays
  unchanged is explicitly **not** a checkpoint failure — only local `HEAD`
  identity is checked.

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
reused unchanged).

**Evidence append failure is itself a gate.** If a canonical window
completes successfully but its evidence record cannot be written, the
already-committed PostgreSQL state is never rolled back, but the runner
never submits the next window — it exits non-zero with
`evidence_append_failed` and requires a fresh recovery/approval decision
before any continuation.

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

`--base-url` must always be passed explicitly (same rule as the 5-window
runner — see "Target-environment binding" in
`docs/wallet-scoped-historical-sync-runbook.md`). This PR does not build
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
