# Wallet-Forward Completion SUPERVISOR — Operator Runbook

**Status:** Implementation capability only. **No live supervisor run has been
executed or authorized by this document.** This runbook describes what the
supervisor can do — it is not itself an approval to run `--execute`.

## What this is

`scripts/wallet-forward-supervisor.ts` (`npx tsx --conditions react-server
scripts/wallet-forward-supervisor.ts -- <args>`) is a thin, fail-closed
orchestration layer around the existing, unchanged
`scripts/wallet-forward-campaign-runner.ts` (see
`docs/wallet-forward-campaign-runbook.md` for that runner's full contract).
The supervisor's only job is to invoke the campaign runner repeatedly, as a
child process, until one immutable operator-authorized final block is
reached — it owns none of the campaign runner's safety logic.

## What the supervisor owns

- immutable fixed-target authorization (`--authorized-final-block`),
- bounded child-campaign segmentation (`--campaign-max-windows` per child),
- sequential child invocation, one at a time, via an injectable child-process
  runner,
- verification that each child's terminal result is an EXACT clean
  completion (zero exit code, an allowlisted `stoppedReason`, and a window
  count that exactly matches what was requested),
- re-verification of canonical PostgreSQL cursor state between children,
- repository HEAD/working-tree drift checks between children,
- supervisor-level append-only evidence that references, but never
  duplicates, child campaign evidence,
- the fail-closed stop/continue decision.

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

## Window alignment

The campaign runner does not support a partial final window
(`validateAuthorizedFinalBlockAlignment` in
`scripts/wallet-forward-campaign-runner.ts`). The supervisor preserves this
exactly: `--authorized-final-block` must align to full `--window-size`
windows starting from the canonical cursor's current `toBlock + 1`. A
misaligned target is rejected before any child runs — the supervisor never
rounds or silently adjusts the operator-authorized value.

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

The supervisor fails closed on: a non-zero child exit code; a child result
whose `stoppedReason` is not on the campaign runner's own allowlisted clean
set (`max_windows_reached` / `authorized_final_block_reached`); a child
window count that does not exactly match what was requested; a canonical
cursor, after a child completes, that does not move exactly as expected;
repository HEAD drift or an unexpected dirty working tree between children;
a failed `/api/debug/health` check; an evidence-append failure; a child
process that could not even be spawned; and `SIGINT` received before another
child campaign starts. None of these ever trigger an automatic retry,
automatic recovery, or a next-child invocation.

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
child campaign number and its expected range, and a reference to the child's
own evidence file path — the supervisor never duplicates every child window
record. Evidence-append failure is itself a gate: if a canonical child
campaign completes but its result cannot be recorded, the supervisor does
not advance to the next child.

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
  live windows; see `docs/wallet-forward-campaign-runbook.md`'s staged
  rollout table for how live child-campaign authorization is granted.
