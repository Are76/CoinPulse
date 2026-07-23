# HexMining Ended-Stake Historical-State Recovery — Operator Runbook

**Status:** Operator recovery tooling. This document and its companion script do
**not** by themselves recover anything — an operator must run the script against
a real local server, database, and PulseChain RPC endpoint, review the dry-run
report, then explicitly re-run with `--execute`.

**Scope:** Native pHEX ended stakes on PulseChain (`chainId: 369`) only. No HSI,
no eHEX, no Ethereum, no Base. No pricing, valuation, yield, or PnL — this tool
recovers exactly two fields (`lockedDay`, `stakeShares`) for stakes that already
have a persisted `RawEndedHexStakeObservation` row but lack transaction-backed
START evidence.

## Purpose

Some native PulseChain ended stakes have no matching `RawStakeAction` START
record — either the START transaction predates the wallet's synced history, or
the stake was cloned into PulseChain contract state at the fork with no native
`stakeStart` transaction ever existing. For these stakes,
[`discoverEndedHexStakes()`](../src/services/hexmining/ended-stake-discovery.ts)
persists an observation with `isComplete: false`, `lockedDay: null`,
`stakeShares: null`, and warning `hexmining-ended-stake-lockedday-unknown` — by
design (see `docs/project-decisions.md` D-028).

This tool recovers those two fields from the HEX contract's own historical
state — `stakeLists(wallet, index)` pinned to `endBlockNumber - 1` (the last
block before the stake's `StakeEnd` transaction) — and upgrades the existing
observation row **in place**. It never scans transaction history, never
fabricates a `RawStakeAction` row (no genuine transaction exists to cite for
these stakes), and never creates a new canonical observation row.

## What this tool does NOT do

- Does not create any `RawEndedHexStakeObservation` row. It can only update an
  already-persisted, already-incomplete row.
- Does not touch `RawStakeAction` at all — reads or writes.
- Does not change `discoveryMethod` on any row. `discoveryMethod` continues to
  describe how the END event itself was discovered (`raw_stake_action`); the
  new `evidenceRecovery*` columns separately record how the missing
  `lockedDay`/`stakeShares` were later recovered (`historical_contract_state`).
- Does not touch pricing, valuation, yield, or PnL.
- Does not compute anything from `HEX Stake Analyzer.mhtml` or any other
  third-party tool — that file was used only as secondary, out-of-repo design
  corroboration during the design phase and is never read by production code.

## Prerequisites

- **PostgreSQL** reachable, containing the target wallet's persisted
  `RawEndedHexStakeObservation` rows (i.e. ended-stake discovery has already run
  for this wallet).
- **PulseChain RPC** reachable via `PULSECHAIN_RPC_URL` (or `--rpc-url`).
  Archive-capable access is required — historical `stakeLists`/`stakeCount`
  reads are pinned to arbitrary past blocks, which some RPC providers do not
  serve for very old blocks.

## Required environment variables (by name only)

Never print or record the values of these — presence only.

- `PULSECHAIN_RPC_URL` — required (or supply `--rpc-url`).
- `DATABASE_URL` — required by the Prisma client this script's underlying
  service uses to read/write observations.

## How to run

Dry-run (the safe default — no database writes):

```bash
PULSECHAIN_RPC_URL='https://...' \
  npm run recover:ended-stake-evidence -- \
  --wallet 0x...
```

Execute (writes recovered evidence to the database):

```bash
PULSECHAIN_RPC_URL='https://...' \
  npm run recover:ended-stake-evidence -- \
  --wallet 0x... \
  --execute
```

Optional flags:

- `--chain-id <id>` — only `369` (PulseChain) is supported; defaults to `369`.
- `--rpc-url <url>` — overrides `PULSECHAIN_RPC_URL`.
- `--evidence-dir <path>` — when set, appends the JSON report as one line to
  `<dir>/ended-stake-historical-state-recovery-evidence.jsonl`. Defaults to
  `operator-evidence/hexmining-ended-stake-historical-state-recovery/`.

## Interpreting the report

The report is JSON on stdout with per-category counts and a per-stake
`outcomes` array. Categories:

| Field | Meaning |
|---|---|
| `alreadyComplete` | Row was already complete before this run — skipped, no RPC read issued for it. |
| `recovered` | Valid evidence found via the pinned historical read (dry-run: would be written; execute: about to be written). |
| `updated` | Execute only — rows actually upgraded in place this run. |
| `noMatch` | No entry in `stakeLists(wallet, 0..stakeCount-1)` at the historical block returned the target `stakeId`. |
| `multipleMatch` | More than one entry returned the target `stakeId` — should be structurally impossible; fails closed. |
| `concurrentMatchingCompletion` | The row became complete (with identical values) between the read and the write — no mutation performed. |
| `concurrentConflict` | The row became complete (with *different* values) between the read and the write — no mutation performed; needs investigation. |
| `stateChanged` | The row's identity or state changed unexpectedly between the read and the write — no mutation performed. |
| `observationMissing` | The row no longer exists at write time — no mutation performed. |
| `rpcFailures` | The pinned RPC read failed (timeout, rate limit, provider unavailable, etc. — see `classifyRpcFailure`). No automatic retry. |
| `validationFailures` | The RPC response was malformed, or returned a negative/non-digit `stakeShares`, an unsafe `lockedDay`, or a returned `stakeId` that didn't match the target on re-validation. |
| `totalFailures` | Sum of every non-success category above. |

Exit codes: `0` — clean run, zero failures. `1` — one or more entries fell into
a failure category (see report for which). `2` — hard input/setup error (bad
flags, missing RPC URL, unsupported chain) — no RPC or DB call was made.

## If a defect is discovered

Per this task's bounded scope: **stop.** Record the defect (report JSON,
inputs, and the specific stakeId/outcome) as evidence. Do not attempt further
fixes to the reader/store/discovery pipeline in this same PR — that is a
separate, scoped change.

## Known limitation — canonical uniqueness remains application-enforced

`RawEndedHexStakeObservation` has no database-level `@@unique` constraint
independent of `discoveryMethod`. The existing, already-tested `raw_stake_action`
discovery/persist path (`persistEndedHexStakeObservation`) intentionally allows
a second row for the same stake under a different `discoveryMethod` value — see
its test suite. This recovery tool avoids that risk entirely by never calling
`persistEndedHexStakeObservation` and never writing `discoveryMethod` — it only
performs an atomic conditional `updateMany` bound to an existing row's full
canonical identity (`id` + `chainId` + `walletAddress` + `stakeId` +
`endBlockNumber`). Hardening the schema itself with a chain-wide unique
constraint independent of `discoveryMethod` is a separate, out-of-scope task —
it would require deciding what happens to the existing tested semantics that
allow multiple `discoveryMethod` rows per stake, which this PR does not decide.

## Private and sanitized material

Keep the following out of git, logs, and PR comments:

- `PULSECHAIN_RPC_URL` / `DATABASE_URL` values (presence only).
- Any provider credentials embedded in an RPC URL.
- The `HEX Stake Analyzer.mhtml` file itself, or any content extracted from it
  — it is design-phase corroboration only and must never be committed or
  parsed by production code.

## Post-recovery verification

After a successful `--execute` run, re-run the existing, unmodified verification
tooling to confirm the canonical read path now reports the recovered rows as
complete:

```bash
npx tsx scripts/hexmining-ended-stake-api-verification.ts --wallet 0x...
```

See
[`docs/hexmining-ended-stake-api-verification-runbook.md`](./hexmining-ended-stake-api-verification-runbook.md)
for interpreting that report. This recovery PR does not run that verification —
it is the operator's next step after merge.
