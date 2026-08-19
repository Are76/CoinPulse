# Wallet-Forward Completion SUPERVISOR — Operator Runbook

**Status:** Implementation capability only. **No live supervisor run has been
executed or authorized by this document.** This runbook describes what the
supervisor can do — it is not itself an approval to run `--execute`.

## What this is

`scripts/wallet-forward-supervisor.ts` (`npx tsx --conditions react-server
scripts/wallet-forward-supervisor.ts <args>`) is a thin, fail-closed
orchestration layer around the existing, unchanged
`scripts/wallet-forward-campaign-runner.ts` (see
`docs/wallet-forward-campaign-runbook.md` for that runner's full contract).
The supervisor's only job is to invoke the campaign runner repeatedly, as a
child process, until one immutable operator-authorized final block is
reached — it owns none of the campaign runner's safety logic.

## What the supervisor owns

- immutable fixed-target authorization (`--authorized-final-block`),
- bounded child-campaign segmentation (`--campaign-max-windows` per child),
- a genuinely non-mutating dry-run planning/simulation path (see "Dry-run
  behavior" below) — dry-run is never subjected to execute-mode's
  cursor-mutation postconditions,
- resume-safe child campaign identity, derived from canonical persisted
  policy labels rather than a hardcoded starting number (see "Resume-safe
  child identity" below),
- sequential child invocation, one at a time, via an injectable child-process
  runner, bounded by an explicit process timeout (see "Child-process
  timeout" below),
- verification that each child's terminal result is an EXACT clean
  completion (a non-signal-terminated process, zero exit code, an
  allowlisted `stoppedReason`, and a window count that exactly matches what
  was requested for the current mode),
- re-verification of canonical PostgreSQL cursor state between children,
- verification that a "target already reached" resume state is backed by
  genuinely clean persisted terminal evidence, not merely a matching cursor
  value (see "Target-already-reached verification" below),
- repository HEAD/working-tree drift checks AND backend environment identity
  (`app.env`) drift checks between children,
- supervisor-level append-only evidence that references, but never
  duplicates, child campaign evidence — including the child's actual
  effective evidence path, even when the operator relied on its default,
- the fail-closed stop/continue decision, including on unexpected dependency
  failures between children (a rejected cursor read, git check, or health
  check still produces `stop` evidence, not just a top-level process exit).

## What the campaign runner still owns, unchanged

Everything else: cursor invariants, contamination detection, duplicate
`RawTransaction`/`RawTokenTransfer`/`LedgerEntry` checks, warning
classification, checkpoint invariants, ambiguous-submission reconciliation,
recovery, and per-window canonical evidence. The supervisor never imports the
campaign runner's orchestration function directly — it only ever invokes it
as a separate child process with a fixed CLI contract, so the campaign
runner's own review and tests remain the authority on its behavior.

## Authorization model

`--authorized-final-block` is a single, immutable, operator-supplied block
number. The supervisor:

- never queries chain head,
- never computes a "latest safe block" or "head minus N" target,
- never expands the target after startup,
- never changes the target while running.

That policy (how an operator picks a safe target block) lives outside this
script. The supervisor only ever executes toward a block already chosen and
approved before the invocation started.

**The product owner separately approves the fixed total
`--authorized-final-block` before execution.** Once that approval exists, the
supervisor may sequentially invoke bounded child campaigns within that
immutable authorization without a fresh approval for each individual clean
child — a passing child does not require re-approval, exactly like a passing
checkpoint inside the campaign runner does not. Any failure or ambiguity is a
hard stop that requires new human review and a fresh authorized-final-block
approval before any further mutation.

## Bounded child campaigns

`--campaign-max-windows` bounds each CHILD campaign (same `[1, 1000]` range
and same fixed `--window-size = 1000` rule as the campaign runner itself —
`scripts/wallet-forward-campaign-runner.ts`'s own hard cap and window-size
gate are reused unchanged via its exported validators). Before invoking each
child, the supervisor derives that child's own `--max-windows` and
`--authorized-final-block` as the smaller of `--campaign-max-windows` and
whatever remains to reach the immutable overall target — so a child never
receives an authorization that exceeds the operator's original approval, and
a clean child reaching its own local `max-windows` (with authorized budget
still remaining) is not a failure, it simply triggers the next bounded child.
`--checkpoint-interval` is validated against the exact same `[1, 25]` bound
the campaign runner enforces (also reused unchanged), both at CLI parse time
and again at runtime — an out-of-range value is rejected before any child
evidence is written or any child is spawned, rather than surfacing later as
a confusing child-side rejection after the supervisor already committed to
that child.

## Window alignment

The campaign runner does not support a partial final window
(`validateAuthorizedFinalBlockAlignment` in
`scripts/wallet-forward-campaign-runner.ts`). The supervisor preserves this
exactly: `--authorized-final-block` must align to full `--window-size`
windows starting from the canonical cursor's current `toBlock + 1`. A
misaligned target is rejected before any child runs — the supervisor never
rounds or silently adjusts the operator-authorized value.

## Dry-run behavior

Dry-run (the default, no `--execute`) invokes each child in the campaign
runner's own dry-run mode, which never submits an HTTP POST and never
mutates PostgreSQL — the campaign runner deliberately reports
`windowsCompleted: 0` in dry-run while still advancing `lastWindowNumber`
for each simulated window. The supervisor holds a dry-run child to that same
non-mutating contract, not to execute-mode's "cursor advanced to the
authorized boundary" postcondition: after a clean dry-run child, the
supervisor re-reads the canonical cursor and requires it to be **byte-for-
byte unchanged** from before that child ran (`verifyDryRunNoCanonicalMutation`)
— any drift there is an immediate, unexpected-mutation hard stop, since
`--execute` was never passed. To let a dry run still preview multiple
sequential bounded children toward the target, the supervisor tracks its own
in-memory simulated cursor across dry-run children (mirroring the exact
simulation pattern the campaign runner already uses internally for its own
dry-run windows) — this is never treated as canonical, is never persisted,
and only ever advances planning within a single invocation.

## Resume-safe child identity

A restarted supervisor invocation does not start child numbering at `c1`.
The child campaign runner's own `validateNoPolicyLabelCollision` gate
rejects ANY previously-used policy label for the chain, forever — it is not
scoped to "active" runs. If the supervisor always started at `c1`, the first
window of a resumed `c1` would collide with a real label a prior invocation
already persisted. Instead, at every startup the supervisor scans canonical
persisted policy labels (the same query the campaign runner itself already
uses for its own collision check) for the pattern
`<policyLabelPrefix>-<campaignIdPrefix>-c<N>-w<windowNumber>` and starts
numbering at one past the highest `N` it finds — always derived from
canonical PostgreSQL, never from a local resume-state file. The fully built
id for every child (not just the `--campaign-id-prefix`) is also
re-validated against the campaign runner's own 64-character id contract
immediately before that child's evidence is written or it is spawned, since
a prefix near that ceiling — or a large child number after many resumes —
can build an overlong id even when the prefix alone passed.

## Target-already-reached verification

A canonical cursor sitting exactly at `--authorized-final-block` at startup
is not, by itself, proof that the campaign that put it there was clean. A
prior campaign can advance `SyncCursor.toBlock` and then still stop
non-clean (for example `invariant_failed_after_run` because its terminal
`SyncRun` carried warnings, or `evidence_append_failed`) — cursor mutation
is a side effect of the sync pipeline, independent of whether the campaign
runner's own post-run gates judged that run clean. Before reporting
`authorized_final_block_already_reached`, the supervisor looks up the
persisted `SyncRun` whose `endBlock` matches the cursor's current position
and requires it to show a clean terminal state (`status: COMPLETED`,
`warningCount: 0`, empty `warningDetails`, no `errorMessage`, no
`failedSourceFamily`) — the same fields the campaign runner itself judges a
run's own cleanliness by, without re-running its contamination/duplicate-row
checks (those already ran against this exact range when the window was
originally submitted). Zero or more than one matching row both fail closed.
The one exception is a wallet whose cursor has never moved past its own
anchor block (`fromBlock === toBlock`) — there is no terminal operation to
verify there, and nothing to falsify.

## Child-process timeout

`spawn` is given a bounded timeout derived from the child's own window
budget and poll timeout (`computeChildProcessTimeoutMs`), so a child hung
before it even reaches its own `--poll-timeout-ms` loop — for example while
`npx` resolves `tsx`, while `tsx` compiles, or while the child connects to
PostgreSQL — cannot make the supervisor wait forever. A killed child is
**never** treated as an ordinary clean/unclean exit: because the supervisor
cannot know whether the child had already submitted its manual-sync request
before being killed, a signal-terminated process is reported as the distinct
`child_process_ambiguous_termination` stop reason, explicitly flagging that
canonical state may already have been mutated and that human review — never
automatic continuation or retry — is required.

## Canonical state

PostgreSQL remains canonical. At every iteration — including the very first
child of a fresh invocation, and every child after that — the supervisor
re-reads the live `TRANSFERS` `SyncCursor` from the database and derives the
next bounded child directly from it. It never trusts an in-memory count of
"how many children have run so far." This is what lets a new invocation
resume correctly after a crash or a hard stop: it reads canonical state and
reasons from there, not from any local supervisor file or process memory.
The supervisor never mutates `SyncCursor`, canonical ledger tables, raw
tables, or derived state directly — every mutation still flows through the
campaign runner's own `POST /api/sync/manual` call.

## Stop conditions

The supervisor fails closed on: a non-zero child exit code; a signal-
terminated child process (reported distinctly, as ambiguous); a child result
whose `stoppedReason` is not on the campaign runner's own allowlisted clean
set (`max_windows_reached` / `authorized_final_block_reached`); a child
window count that does not exactly match what was requested for the current
mode; a canonical cursor, after an execute-mode child completes, that does
not move exactly as expected; any canonical mutation at all after a dry-run
child (dry-run must change nothing); an unverifiable "already at target"
resume state; an overlong generated child campaign id; an invalid
`--checkpoint-interval`; repository HEAD drift or an unexpected dirty
working tree between children; backend environment (`app.env`) drift between
children; a failed `/api/debug/health` check; an evidence-append failure; a
child process that could not even be spawned; an otherwise-uncaught
dependency rejection between children (cursor read, git check, health
check); and `SIGINT` received before another child campaign starts. None of
these ever trigger an automatic retry, automatic recovery, or a next-child
invocation.

## Automatic actions strictly prohibited

The supervisor never automatically retries a failed or ambiguous child,
invokes `--recovery-mode`/`--recovery-of-run-id` on any child, rebuilds,
materializes, triggers pricing, mutates a cursor directly, expands the
authorized target, or skips a warning/checkpoint. There is no CLI flag on
the supervisor that can reach a child's recovery mode at all. A recovery
decision always requires a separate, explicit operator-run invocation of the
campaign runner itself, per
`docs/wallet-forward-campaign-runbook.md`.

## Evidence

Append-only JSONL (default
`operator-evidence/wallet-forward-supervisor/evidence.jsonl`, gitignored —
operator-local output, never committed). Record kinds: `supervisor_start`,
`child_campaign_start`, `child_campaign_result`, `stop`, `supervisor_summary`.
Each record captures wallet/chain/source-family identity, the canonical
cursor before/after a child, the immutable `--authorized-final-block`, the
child campaign number and its expected range, and a reference to the
child's own EFFECTIVE evidence file path — the child's own default
(`operator-evidence/wallet-forward-campaign-runner/evidence.jsonl`) when
`--child-evidence-file` is not passed, never a bare `null`, since that
default path is exactly where the child's own window-level evidence needed
to audit or investigate a later stop actually lives. The supervisor never
duplicates every child window record. Evidence-append failure is itself a
gate: if a canonical child campaign completes but its result cannot be
recorded, the supervisor does not advance to the next child.

## Process lifetime

This is an interactive operator script — not a daemon, cron job, Redis
queue, or background worker. `Ctrl-C`/`SIGINT` stops the supervisor before
it starts another child campaign; it never kills or restarts automatically.
A new invocation always re-verifies canonical PostgreSQL state before
planning its next child.

## Non-goals

- No database supervisor/campaign model.
- No change to `scripts/wallet-forward-campaign-runner.ts`,
  `scripts/lib/wallet-forward-sync-primitives.ts`, `/api/sync/manual`, or any
  cursor/invariant/recovery code.
- No chain-head or "latest safe block" policy — that remains a separate,
  unbuilt decision.
- No automatic execution of any live window. This document authorizes zero
  live windows. Live supervisor execution requires a separate, explicit
  product-owner approval of one immutable total `--authorized-final-block`
  before the supervisor is invoked — per "Authorization model" above, clean
  bounded child campaigns then proceed sequentially within that single
  approval, with no fresh per-child approval required. This is a different
  authorization shape than `docs/wallet-forward-campaign-runbook.md`'s staged
  10 → 50 → 250 → 1000 rollout table, which still governs any standalone
  campaign-runner execution or recovery invocation run outside a supervisor
  session — it is not an additional per-child approval requirement layered
  on top of an already-authorized supervisor run.
