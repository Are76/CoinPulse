# TRANSFERS Backfill Runner — Operator Runbook

**Tool:** `scripts/transfer-backfill-runner.ts` (`npm run backfill:transfers -- <args>`)

This runner automates the mechanical parts of the campaign described in
`docs/transfer-history-backfill-operator-plan.md` — window math, adjacency,
pre-submit gates, HTTP submission, polling, and post-run verification. It
does not replace that plan: read it first. It does not execute any accounting
logic itself — it only POSTs to the existing `/api/sync/manual` and
`/api/rebuild` routes and reads Postgres directly for planning/verification.

The runner never guesses "how many windows have run." Every invocation reads
the live `SyncCursor` row for the TRANSFERS source family and computes the
next window from that alone. This makes every invocation safe to interrupt
and safe to re-run.

## Prerequisites

- `DATABASE_URL` and `REDIS_URL` set in the shell environment.
- The target server (dev or operator-deployed) is running and reachable at
  `--base-url` (default `http://localhost:3000`, override via
  `OPERATOR_RUNNER_BASE_URL` or `--base-url`).
- The server is running code that includes the Decimal-serialization fixes
  (PR #330/#331). The runner verifies this itself via a behavioral capability
  probe before doing anything else (see "Decimal capability check" below) —
  you do not need to check this manually.
- `docker compose ps` shows Postgres and Redis healthy, or the equivalent for
  a non-local deployment.

## Dry-run (always start here)

```bash
npm run backfill:transfers
```

Dry-run is the default — no flags needed. It:

- reads the live TRANSFERS cursor,
- computes the next window (number, startBlock, endBlock, policyLabel),
- runs every pre-submit gate (health, active-operation, policyLabel
  collision, adjacency, range size, fabricated-contamination pre-gate),
- writes one evidence record per previewed window with
  `outcome: "dry_run_planned"`,
- **never** calls `POST /api/sync/manual` or `POST /api/rebuild`, and never
  mutates `SyncCursor`, `SyncRun`, raw, ledger, or materialized data.

With `--max-windows N`, dry-run previews **N distinct sequential windows**:
the first is planned from the real live cursor; each later one is planned
from an in-memory simulated cursor that advances to the previous preview's
`startBlock`. The simulation exists only inside that single dry-run process —
nothing in PostgreSQL moves, and execute mode never uses it. Each evidence
record carries `cursorSource: "live" | "simulated"` (simulated records also
carry `simulatedCursorFromBlock`) so a simulated preview can never be
mistaken for a live-planned one. `cursorBefore` always reports the real live
cursor. A checkpoint boundary crossed inside the simulation is preview-only —
no rebuild is ever submitted in dry-run, regardless of
`--allow-checkpoint-rebuild`.

Run this before any execution batch and after any interruption, to see
exactly what the next window(s) would be before committing to them.

## Executing one window

```bash
npm run backfill:transfers -- --execute --max-windows 1
```

`--max-windows` defaults to `1` even without this flag — pass it explicitly
for clarity. This submits exactly one `POST /api/sync/manual`, polls the
resulting `SyncRun` to a terminal state (bounded by `--poll-timeout-ms`,
default 20 minutes), and verifies every invariant in
`docs/transfer-history-backfill-operator-plan.md` §7 that is safe to
automate: `COMPLETED` status, `warningCount = 0`, no `errorMessage`, no
`failedSourceFamily`/`failedFromBlock`/`failedToBlock`, exact range match,
cursor moved exactly as predicted, zero fabricated-contamination rows
(pre- and post-run), zero duplicate `RawTokenTransfer`/`LedgerEntry` rows,
and zero remaining active operations. Any single failed invariant is a hard
stop — nothing is retried automatically.

## Executing a small bounded batch

```bash
npm run backfill:transfers -- --execute --max-windows 5
```

The hard cap is **25 windows per invocation** — `--max-windows` above that is
rejected before anything runs. Windows execute strictly sequentially (never
concurrently); a failed invariant on any window stops the batch immediately,
even if earlier windows in the same invocation succeeded.

**Before running any batch larger than 1, a human must first validate a
single-window run's evidence output by hand** (§7 of the execution plan) —
do not scale up batch size on trust alone.

## Cross-checking the expected cursor

```bash
npm run backfill:transfers -- --execute --expected-cursor-from 26679999
```

`--expected-cursor-from` is the operator's **initial preflight assertion**:
if the live persisted cursor does not exactly match the value you expect from
the last approved evidence record, the runner stops with
`cursor_expectation_mismatch` before touching anything. Use it whenever you
are resuming after a gap in your own tracking.

In a multi-window batch the flag is validated once against the live cursor
before the first submission; it is **not** re-compared verbatim after every
window (that would falsely stop window 2, since the cursor legitimately
advances). Instead, after each window completes and passes every post-run
gate (terminal state, warnings, cursor postcondition, contamination,
duplicates, active operations), the runner internally expects the verified
next cursor value — normally the just-completed window's `startBlock`. The
live `SyncCursor` is re-read and checked against that internal expectation
before each later submission, so any unexpected cursor movement between
windows (another process, manual edit, concurrent operation) stops the batch
with `cursor_expectation_mismatch` before the next `POST`. This internal
check stays active even when `--expected-cursor-from` was omitted, once the
first window of the batch has completed. Execute-mode planning always uses
the live persisted cursor — never a simulated or remembered value.

## Resuming safely

Just re-run the same dry-run or execute command. The runner:

1. Reads the live `SyncCursor.fromBlock` — this is the only progress signal
   it trusts.
2. Computes the next window from that value.
3. Checks for an existing `SyncRun` with the computed `policyLabel` before
   submitting — if one already exists (e.g. a previous invocation partially
   completed), the runner refuses with `policy_label_collision` rather than
   risk a duplicate submission.

If the runner was interrupted mid-window (process killed after `POST
/api/sync/manual` but before verification completed), re-run: the sync
pipeline is idempotent (raw + ledger persistence use `skipDuplicates` and
deterministic IDs), so either the window is still `PENDING`/`RUNNING` (the
active-operation gate stops you until it resolves) or it reached a terminal
state that the next dry-run will reveal via the cursor position.

## Checkpoint and final rebuild behavior

A rebuild is due after every 25 completed windows (checkpoint) and once more
after the final window (13,688). By default the runner **stops** the moment
a rebuild becomes due (`stopped_before_checkpoint_rebuild` /
`stopped_before_final_rebuild`) without submitting it. To let the runner also
submit that rebuild in the same invocation:

```bash
npm run backfill:transfers -- --execute --max-windows 25 --allow-checkpoint-rebuild
```

The rebuild request reuses `POST /api/rebuild` (the existing, already-audited
rebuild route) scoped to the just-completed window's range and
`sourceFamilies: ["TRANSFERS"]` — the runner never re-implements rebuild or
materialization logic. On any rebuild warning or error, the runner stops
immediately; it does not proceed to further windows after an unverified or
failed rebuild in the same invocation.

**No rebuild is ever submitted in dry-run mode**, regardless of
`--allow-checkpoint-rebuild`.

## Evidence

One JSON line per event is appended to
`operator-evidence/transfers-backfill/transfers-backfill-evidence.jsonl`
(directory configurable via `--evidence-dir`; gitignored — this is
operator-local output, not campaign truth. Campaign truth is the persisted
`SyncRun`/`SyncCursor` rows in Postgres). Each window record includes: window
number, policyLabel, expected/actual range, `runId`, submission/terminal
timestamps, terminal status, warnings/errors, cursor before/after,
contamination and duplicate-check results, and the active-operations count
after the run. Rebuild records follow the same shape. Stop events record the
reason and detail. No secret values (connection strings, RPC URLs, headers)
are ever written — verified by unit tests.

## Hard stops (the runner refuses to proceed)

| Stop reason | Meaning |
|---|---|
| `decimal_capability_check_failed` | The live codebase's raw read-back no longer serializes large Decimal columns as fixed-point strings. Do not proceed; this is the exact defect PR #330/#331 fixed. |
| `wallet_not_found` | The campaign wallet is not a tracked wallet on the target server. |
| `no_transfers_cursor` | No TRANSFERS `SyncCursor` exists yet (Case B / ascending is out of scope for this runner). |
| `campaign_complete` | Live cursor has reached `FIRST_ACTIVITY_BLOCK`; no more windows to run. |
| `misaligned_cursor` | Live cursor is not on the 1,000-block campaign grid, or is above the original cursor. Needs manual investigation — do not guess a correction. |
| `cursor_expectation_mismatch` | `--expected-cursor-from` did not match the live cursor. |
| `active_operation_conflict` | A `PENDING`/`RUNNING` SyncRun already exists. |
| `policy_label_collision` | A SyncRun with the computed policyLabel already exists. |
| `server_unhealthy` | `GET /api/debug/health` did not report `ok`. |
| `fabricated_contamination_pre_gate` | The pre-submit contamination query found rows in the proposed range; per the execution plan, report to the product owner rather than submit or repair unilaterally. |
| `manual_sync_submit_failed` | `POST /api/sync/manual` did not return `202` with a `runId`. |
| `poll_timeout` | The SyncRun did not reach a terminal state within `--poll-timeout-ms`. |
| `invariant_failed_after_run` | One or more post-run checks failed (status, warnings, errors, range, cursor postcondition, contamination, duplicates, active operations). |
| `stopped_before_checkpoint_rebuild` / `stopped_before_final_rebuild` | A rebuild is due but `--allow-checkpoint-rebuild` was not passed. |
| `rebuild_*` | The rebuild submission, polling, or verification failed. |

## Inspecting a failure without repairing automatically

The runner never deletes, repairs, rolls back, or otherwise mutates data
beyond the one approved `POST /api/sync/manual` (and, if explicitly enabled,
one `POST /api/rebuild`) per window. On any stop:

1. Read the evidence JSONL for the exact reason and detail.
2. Cross-check the live `SyncCursor` and the relevant `SyncRun` row directly
   in Postgres (see `docs/transfer-history-backfill-operator-plan.md` §7 for
   the exact queries).
3. If contamination was found, report the exact row identities to the
   product owner — `scripts/repair-fabricated-token-transfers.ts` is the
   approved bounded remedy, but invoking it is a separate, explicit decision,
   never automatic.
4. If a run is wedged `PENDING`/`RUNNING` past its stale threshold, it must
   be manually marked `FAILED` before the next invocation — the runner will
   not do this for you.
5. Re-run the dry-run command to see the runner's fresh read of the current
   state before deciding on a next step.

## Validate small before scaling up

A human must review the evidence output of a single successfully-executed
window (`--max-windows 1`) before approving any larger `--max-windows` batch.
This mirrors the execution plan's own guidance: do not stop on a single
checkpoint's trend alone, but do require an explicit human check-in before
increasing blast radius.
