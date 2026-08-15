# Wallet-Scoped Historical Sync — Operator Runbook

**Status:** Implemented (this PR). Never executed — dry-run and execute windows require
explicit product-owner approval before use.

**Purpose:** Recover missing historical native PLS and PRC-20 transfer evidence for a single
tracked wallet, one bounded block window at a time, using the existing `POST /api/sync/manual`
route and canonical ingestion pipeline. This is **not** a new ingestion system — it is a `mode`
addition (`"dry-run" | "execute"`) to the existing manual sync request contract.

## What this is not

- Not automatic wallet-import enrichment. Historical sync is never triggered by wallet import.
- Not a replacement for the paused chain-wide `TRANSFERS` backfill campaign
  (`docs/transfer-history-backfill-operator-plan.md`, `docs/transfer-backfill-runner-runbook.md`).
  That campaign's cursor state and Window 61 approval gate are untouched by this feature.
- Not automatic. Every window is a single explicit operator-submitted request.
- Not a materialization rebuild. `POST /api/sync/manual` never materializes positions — a
  separate, explicit `POST /api/rebuild` call is required after ingestion is verified.

## Request contract

`POST /api/sync/manual` (unchanged route, extended request body):

```json
{
  "walletAddress": "0x75f808367720951e789d47e9e9db51148d9aa765",
  "chainId": 369,
  "sourceFamilies": ["TRANSFERS"],
  "startBlock": "<candidate-start-block>",
  "endBlock": "<candidate-end-block>",
  "policyLabel": "wallet-scoped-historical-sync-window-<n>",
  "mode": "dry-run"
}
```

`<candidate-start-block>` / `<candidate-end-block>` are placeholders only. No production
recovery window has been proposed, reviewed, or approved by this PR — the exact starting block
is operator-determined per the "Recommended sequence" section below, using evidence read from
the live database and explorer, never guessed or pre-filled.

- `mode` is optional and defaults to `"execute"` — existing callers (e.g. the dashboard's manual
  sync mutation, which never sends `mode`) are unaffected.
- `mode: "dry-run"` requires an explicit `startBlock` (unlike ordinary execute-mode manual sync,
  which may omit `startBlock` to resume from the cursor). Historical recovery must always target
  an explicit, reviewable window — never an implicit chain-wide range.
- `endBlock - startBlock` is capped at `MANUAL_SYNC_MAX_BLOCK_SPAN` (currently 1,000 blocks) in
  both modes, enforced by the existing schema refinement in `src/services/api/validation.ts`. The
  scan range is **inclusive on both ends** — the sync pipeline reads every block from `startBlock`
  through `endBlock` — so the maximum block span of 1,000 permits at most **1,001 inclusive
  blocks** per request (`startBlock === endBlock` scans exactly 1 block, not 0).
- `sourceFamilies` must be a non-empty array drawn from `SUPPORTED_SYNC_SOURCE_FAMILIES`. For
  native PLS + PRC-20 recovery, use `["TRANSFERS"]` — that family's ingestion already scans both
  native block/transaction evidence and topic-filtered ERC-20 transfer logs for the wallet.
- `policyLabel` is required in both modes.

## Dry-run behavior

`mode: "dry-run"`:

1. Validates input against the same schema as execute mode (wallet, chain, range, span, source
   families, policy label).
2. Resolves the wallet — returns `404 WALLET_NOT_FOUND` if the address is not a tracked wallet on
   chain 369.
3. Checks whether the operation would be blocked by an existing active `SyncRun`
   (`previewOperationConflict`, a read-only variant of the same conflict check
   `reserveOperationRun` uses) — **never reserves a run**.
4. Returns a report and performs **no mutation**: no `SyncRun` row, no raw/ledger writes, no
   materialization.

Example response shape (illustrative — actual values depend on the request; this is not a
recorded operator run):

```json
{
  "data": {
    "mode": "dry-run",
    "wallet": { "chainId": 369, "address": "0x75f808367720951e789d47e9e9db51148d9aa765" },
    "requestedRange": { "startBlock": "<candidate-start-block>", "endBlock": "<candidate-end-block>" },
    "sourceFamilies": ["TRANSFERS"],
    "policyLabel": "wallet-scoped-historical-sync-window-<n>",
    "limits": {
      "maxBlockSpan": "1000",
      "maxInclusiveBlockCount": "1001",
      "requestedBlockCount": "<endBlock - startBlock + 1>"
    },
    "executable": true,
    "blockers": [],
    "generatedAt": "<server ISO-8601 UTC timestamp>"
  }
}
```

`limits.requestedBlockCount` is the exact inclusive number of blocks this window will scan —
compare it directly against `limits.maxInclusiveBlockCount` (both already account for the
inclusive range; `maxBlockSpan` is the raw underlying `endBlock - startBlock` limit the schema
enforces). `generatedAt` is the server-generated UTC timestamp of when this preview was computed
— it describes only the instant the operation-lock state (`executable`/`blockers`) was read, not
an approval, and it does not remain valid: a subsequent `mode: "execute"` request always performs
its own fresh lock reservation regardless of how recent the dry-run's `generatedAt` is. The API
itself performs no contamination check at any point — the operator must rerun the contamination
query required by steps 4 and 5 below before submission; `generatedAt` says nothing about
contamination status.

When `executable: false`, `blockers` contains the same conflict-detail shape used by the existing
409 responses (`conflictingOperationId`, `status`, `appearsStale`, etc.) — nothing is inferred or
fabricated; it is the live operation-lock state as of `generatedAt`.

## Execute behavior

`mode: "execute"` (or `mode` omitted) is the existing, unchanged manual sync behavior: reserves a
`SyncRun`, returns `202 { runId }` immediately, and runs ingestion (raw persistence →
normalization → canonical ledger) asynchronously. Existing operation locking, idempotent
`skipDuplicates` persistence, and deterministic ledger IDs apply exactly as before — this PR adds
no new dedup or locking mechanism.

## Recommended sequence for the target wallet

Target wallet: `0x75f808367720951e789d47e9e9db51148d9aa765` (40 hex characters after `0x` — do not
reuse the shorter, mistyped variant seen in some legacy notes). This wallet is distinct from the
Live Portfolio test wallet `0x08Ac26d74013Af7430C350C97eAcd8BE0bDc5613` — never mix the two in a
request, fixture, or evidence record.

1. **Preflight** (every session): confirm no active `SyncRun` (`GET /api/debug/health`,
   `SELECT id, status FROM "SyncRun" WHERE status IN ('PENDING','RUNNING')`), confirm Postgres and
   Redis are healthy, confirm `git status`/`origin/main` state if code changes are also planned.
2. **Determine the wallet's earliest relevant activity block** — cross-check the PulseChain
   explorer's "first seen" block for the wallet against the earliest `OUT` ledger entry for each
   negative-balance asset (see `docs/transfer-history-backfill-operator-plan.md` §3 Q2 for the
   exact query pattern; reuse it, do not re-derive it).
3. **Dry-run the candidate window** (`<candidate-start-block>` / `<candidate-end-block>` are
   placeholders — substitute the exact values determined in step 2, never a guess):
   ```bash
   curl -s -X POST http://localhost:3000/api/sync/manual \
     -H 'content-type: application/json' \
     -d '{
       "walletAddress": "0x75f808367720951e789d47e9e9db51148d9aa765",
       "chainId": 369,
       "sourceFamilies": ["TRANSFERS"],
       "startBlock": "<candidate-start-block>",
       "endBlock": "<candidate-end-block>",
       "policyLabel": "wallet-scoped-historical-sync-window-<n>",
       "mode": "dry-run"
     }'
   ```
   Confirm `executable: true` and the reported range matches intent exactly.
4. **Mandatory pre-execution contamination gate.** Before proposing or submitting any execute
   window (`mode: "execute"`), run the existing fabricated-transfer contamination pre-submit
   query over the exact candidate `[startBlock, endBlock]` range — the same query and gate
   already defined in `docs/transfer-history-backfill-operator-plan.md` §3 Q5 ("Detection
   query") and enforced as the V8 check in that plan's §7 verification checklist. Do not invent
   a different contamination check for this feature; reuse that one exactly, since it reads
   against the same canonical `RawTokenTransfer`/`RawLog` tables this feature's ingestion also
   writes to.
   - **If the contamination query returns zero rows:** the window may be proposed for execution.
   - **If the contamination query returns any row (count > 0): STOP.** Do not submit the
     `mode: "execute"` request for that window. Do not run `POST /api/rebuild`. Investigate and
     report the exact row identities to the product owner per the existing plan's remediation
     path (`docs/transfer-history-backfill-operator-plan.md` §3 Q5, §8 risk R4) before any further
     action on this wallet. This is an explicit operator gate, not an automated check performed
     by the API — the dry-run response's `executable` field reflects only operation-lock state,
     not contamination status, so this query must be run separately every time.
5. **Propose the first bounded execution window** to the product owner for explicit approval —
   this PR implements the capability only; it does not execute it. Approval and submission can
   happen well after step 4 was run, and the API does not enforce contamination checks itself
   (the dry-run response's `executable` field reflects only operation-lock state, not
   contamination status — see `generatedAt` above). **Immediately before submitting the approved
   `mode: "execute"` request, rerun the exact same contamination query from step 4 over the exact
   same `[startBlock, endBlock]` range.** If it returns any row, stop per step 4's remediation
   path and do not submit the execute request — a fabricated row could have appeared between step
   4 and approval. This rerun is required in addition to, not instead of, step 4's earlier check.
6. **After an approved execute window completes**, run the full per-window verification checklist
   already documented in `docs/transfer-history-backfill-operator-plan.md` §7 (SyncRun status,
   warning triage, post-run contamination re-check, duplicate check, cursor/coverage check) —
   this feature reuses the same canonical pipeline, so the same invariants apply.
7. **Repeat** for the next adjacent window only after the previous window's evidence is verified
   and both contamination checks (step 4's pre-proposal gate and step 5's immediate pre-submit
   rerun) passed.
8. **Materialization rebuild is a separate, explicit `POST /api/rebuild` call** after ingestion
   across the intended range is verified **and** both contamination checks have passed for every
   window in that range — never automatic, never bundled into a sync window, and never run after
   a contamination stop until the product owner has resolved it.
9. **After rebuild**, re-check all previously-negative assets for the wallet (native PLS,
   `chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39` HEX, the dust token, and the two
   DAI-family assets) against the materialized balances.

## Forward sync batch runner (`scripts/wallet-forward-sync-runner.ts`)

**Tool:** `scripts/wallet-forward-sync-runner.ts` (`npm run backfill:wallet-forward -- <args>`)

This runner automates a small, explicitly bounded batch of the manual
sequence documented above for the common case of extending an already-partly
synced wallet's TRANSFERS coverage **forward** (ascending) from its live
cursor's upper edge. It is a thin, generic tool: wallet, chain, expected
cursor, first window start, window size, and policy label prefix are all
explicit CLI arguments — nothing about a specific wallet or campaign is
hardcoded.

**Difference from the backward campaign runner
(`scripts/transfer-backfill-runner.ts`):** that runner plans a large
*descending* historical-recovery campaign from hardcoded campaign constants
for a different wallet, and can submit checkpoint/final rebuilds. This runner:

- only ever extends a wallet's cursor **forward** (`toBlock` advances;
  `fromBlock` stays anchored),
- takes wallet/chain/cursor/range/policy-label as required CLI arguments —
  it never infers or hardcodes them,
- never submits a rebuild, materialization, or pricing request — no such
  code path exists in the file,
- is hard-capped at **5 windows per invocation** (not 25).

### Dry-run-first workflow

```bash
npm run backfill:wallet-forward -- \
  --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
  --chain-id 369 \
  --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
  --first-window-start 25078549 --window-size 1000 \
  --max-windows 5 --policy-label-prefix wallet-forward-sync-window
```

Dry-run is the default — no `--execute` flag needed. It reads the live
TRANSFERS cursor, verifies it matches `--expected-cursor-from`/
`--expected-cursor-to` exactly, verifies the first computed window's
`startBlock` matches `--first-window-start` exactly, runs every pre-submit
gate (health, active-operation, policy-label collision, adjacency,
fabricated-contamination pre-gate) for each of up to `--max-windows` proposed
windows, writes one evidence record per proposed window, and **never**
submits an HTTP POST or mutates any state.

### Approval semantics: default rule vs. the bounded batch exception

The default operator rule is **one live mutation window per explicit
product-owner approval** — that is what the "Recommended sequence" section
above describes (propose one window, get approval, execute it, verify it,
only then propose the next). That default remains in force for manual
per-window operations, raw direct `POST /api/sync/manual` calls, the backward
campaign runner (`scripts/transfer-backfill-runner.ts`), and any workflow not
explicitly covered by the exception below. Implementing
`wallet-forward-sync-runner.ts` does not change that default and does not by
itself authorize running it against production.

This runner is the one narrow, explicit exception. Three cases:

- **Case A — manual/single-window operation** (raw API call, the "Recommended
  sequence" above, or `wallet-forward-sync-runner.ts` run with
  `--max-windows 1`): fresh approval per window, as always.
- **Case B — `wallet-forward-sync-runner.ts` with an explicit approved
  batch:** one explicit product-owner approval MAY authorize up to 5
  sequential windows in a single invocation (`--max-windows` between 1 and 5),
  and only when all of the following hold:
  1. A fresh dry-run of the **exact same** wallet, chain, expected cursor,
     first-window start, window size, `--max-windows`, and policy-label
     prefix has completed successfully first — exits 0, plans exactly the
     approved windows, shows no policy-label collision, no gap or overlap,
     produces no mutation, and leaves repository/database state untouched
     apart from its own evidence-file append.
  2. The live `--execute` approval states the exact walletAddress, chainId,
     expected cursor, first-window start, window size, `--max-windows`,
     policy-label prefix, and authorized final block/range — not a vague
     "go ahead."
  3. Each window is still independently submitted and verified by the
     runner's own per-window stop gates (below) — the batch approval does not
     relax any single-window gate.
  4. Execution never exceeds the exact approved `--max-windows` or approved
     final block.
  5. The runner's existing hard cap of 5 windows per invocation is unchanged
     by this policy — it does not raise or bypass the cap, it only says one
     approval may cover up to that existing cap in one invocation.
- **Case C — hard stop inside an approved batch:** the moment any per-window
  stop gate fails, the runner halts before the next `POST` (see "Per-window
  stop gates" below). The remaining, unused portion of that batch
  authorization **expires immediately** — nothing auto-retries, and no later
  window in that batch remains authorized. Resuming requires, in order: fresh
  state verification, a fresh dry-run with the same exact parameters, and a
  fresh explicit product-owner approval. A hard stop is never treated as
  "skip this window and continue."

This exception is scoped tightly to `wallet-forward-sync-runner.ts` because of
its specific safety properties (fixed hard cap, mandatory dry-run-first,
per-window pre- and post-submit gates, fail-closed non-zero exit, no
auto-retry). It does **not** mean: every backfill may now batch 5 windows;
every operator command may batch windows; one approval covers an unlimited
campaign; runner failures can be skipped; later windows remain authorized
after a hard stop; dry-run is optional; `--max-windows 5` should be the
default (it is still `1`); manual API calls inherit this batch exception; or
that `scripts/transfer-backfill-runner.ts` inherits this policy. That runner's
own paused-campaign posture (`docs/transfer-history-backfill-operator-plan.md`,
paused after Window 60 pending explicit Window 61 approval) is unchanged.

**Example — allowed batch (Case B):** a fresh dry-run with
`--max-windows 5 --first-window-start 25078549 --window-size 1000` exits 0
and previews exactly windows 1–5 covering `[25078549, 25083548]` with no
collisions or gaps. The product owner approves that exact wallet, chain,
cursor, range, and `--max-windows 5` in one message. The operator runs the
same command with `--execute`. All 5 windows complete and pass every
per-window gate; the runner stops cleanly after window 5
(`stoppedReason: "max_windows_reached"`). No further approval is needed for
windows 1–5 individually — one approval covered the batch.

**Example — hard stop (Case C):** the same approved 5-window batch is
running; window 3 completes its `POST` but fails a post-run gate (say,
`warningCount !== 0`). The runner writes a `kind: "stop"` evidence record with
`reason: "invariant_failed_after_run"` and exits nonzero. It does **not**
submit window 4 or window 5 — the remaining 2 windows of that approval are no
longer authorized. Resuming requires fresh state verification, a fresh
dry-run, and a fresh explicit approval before any further window (4 or
otherwise) can be submitted.

### Executing

```bash
npm run backfill:wallet-forward -- \
  --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
  --chain-id 369 \
  --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
  --first-window-start 25078549 --window-size 1000 \
  --max-windows 5 --policy-label-prefix wallet-forward-sync-window \
  --execute
```

`--max-windows` defaults to `1` and is **hard-capped at 5** — a value above 5
is rejected before anything runs. Windows execute strictly sequentially.

### Per-window stop gates (execute mode)

Before submitting each window: live cursor matches expectation exactly, no
active `PENDING`/`RUNNING` operation, no policy-label collision, server
healthy, zero fabricated-contamination rows in the proposed range. After each
submitted window, before the next: `SyncRun` reached `COMPLETED` for the
exact wallet/chain/policyLabel/range/`sourceFamilies: ["TRANSFERS"]`,
`warningCount === 0` with empty `warningDetails`, `errorMessage` null,
`failedSourceFamily`/`failedFromBlock`/`failedToBlock` null, the live cursor's
`fromBlock` is unchanged from the original anchor and `toBlock` equals the
just-completed window's `endBlock`, zero remaining active operations, zero
post-run contamination rows, and zero duplicate `RawTransaction` /
`RawTokenTransfer` / `LedgerEntry` identity groups. Any single failed gate is
a hard stop before the next `POST`; nothing is retried automatically.

### No rebuild or materialization

This runner never calls `POST /api/rebuild` and has no rebuild code path at
all — TRANSFERS-only manual sync windows do not materialize positions (see
"What this is not" above). A separate, explicit rebuild remains a distinct
operator decision after ingestion is verified.

### Evidence

One JSON line per preflight, planned window, submitted window, completed
window, stop event, and final summary is appended to the file at
`--evidence-file` (default
`operator-evidence/wallet-forward-sync-batch-runner/evidence.jsonl`, gitignored
— operator-local output, not campaign truth). Each completed-window record
includes: window index, policyLabel, runId, exact range, cursor before/after,
warning count/details, contamination pre/post counts, duplicate-group counts,
invariant failures, and outcome. No secret values (connection strings, RPC
URLs, headers) are ever written.

## Non-goals

- No automatic background sync or worker/queue infrastructure.
- No change to materialization arithmetic, pricing, PnL, or yield.
- No repair of the still-ACTIVE fabricated transfer rows (~11,528) — out of scope; see the
  existing contamination pre-gate and repair script referenced in
  `docs/transfer-history-backfill-operator-plan.md` §3 Q5.
- No continuation of the paused chain-wide TRANSFERS backfill campaign — that remains paused
  after Window 60 pending explicit operator approval for Window 61.
