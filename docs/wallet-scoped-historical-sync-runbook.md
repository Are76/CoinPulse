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
  --max-windows 5 --policy-label-prefix wallet-forward-sync-window \
  --base-url http://localhost:3000
```

`--base-url` is passed explicitly here rather than relying on the default —
see "Target-environment binding" below for why an implicit default (which
`OPERATOR_RUNNER_BASE_URL` can silently change) must never be trusted for a
multi-window batch.

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
     first-window start, window size, `--max-windows`, policy-label prefix,
     and target environment (see "Target-environment binding" below) has
     completed successfully first — exits 0, plans exactly the approved
     windows, shows no policy-label collision, no gap or overlap, produces
     no mutation, and leaves repository/database state untouched apart from
     its own evidence-file append.
  2. The live `--execute` approval states the exact walletAddress, chainId,
     expected cursor, first-window start, window size, `--max-windows`,
     policy-label prefix, authorized final block/range, and the target
     environment (below) — not a vague "go ahead."
  3. Each window is still independently submitted and verified by the
     runner's own per-window stop gates (below) — the batch approval does not
     relax any single-window gate.
  4. Execution never exceeds the exact approved `--max-windows` or approved
     final block.
  5. The runner's existing hard cap of 5 windows per invocation is unchanged
     by this policy — it does not raise or bypass the cap, it only says one
     approval may cover up to that existing cap in one invocation.
  6. The dry-run and the `--execute` invocation target the exact same
     operator environment — a successful dry-run against one environment
     does not authorize `--execute` against a different one, even if every
     other field matches exactly (see "Target-environment binding" below).
- **Case C — hard stop inside an approved batch:** the moment any per-window
  stop gate fails, the runner halts before the next `POST` (see "Per-window
  stop gates" below). The remaining, unused portion of that batch
  authorization **expires immediately** — nothing auto-retries, and no later
  window in that batch remains authorized. Resuming requires, in order: fresh
  state verification, a fresh dry-run whose parameters are derived from that
  live state (see "Resuming after a hard stop" below — **not** the original
  batch's `--expected-cursor-to`, `--first-window-start`, or
  `--policy-label-prefix` reused verbatim), and a fresh explicit
  product-owner approval matching those newly derived parameters exactly. A
  hard stop is never treated as "skip this window and continue."

### Target-environment binding

This runner reads planning and verification state through `DATABASE_URL` (a
direct Postgres connection) but submits every mutation through `--base-url`
(an HTTP call to `/api/sync/manual`, default `http://localhost:3000` unless
`OPERATOR_RUNNER_BASE_URL` or `--base-url` overrides it). Nothing in the
runner or the API it calls proves those two point at the same backend.
`GET /api/debug/health` (the per-window health gate) proves only that *the
server answering `--base-url`* can reach *its own* configured database and
Redis, and returns `app.env` (`NODE_ENV`: `"development"` / `"test"` /
`"production"`) — a coarse runtime mode, not a unique environment or
database identifier. It cannot, without a code change, confirm that the
database identified by that server's own `DATABASE_URL` matches the database
identified by the runner's own `DATABASE_URL`. No other repository-defined
environment-identity mechanism exists today —
`docs/operator-environments.md` documents *execution contexts* (Local
Operator Workstation vs. Claude/Codex Cloud), not a
staging/production database-identity scheme.

Per `docs/operator-environments.md` §2.1, the only environment this runner
can actually run against today is a **Local Operator Workstation**, where
`DATABASE_URL`, `REDIS_URL`, and the API server (`npm run dev`, serving
`--base-url`'s default `http://localhost:3000`) are all sourced from the same
operator-configured `.env` on the same machine — cloud sessions (Claude
Cloud, Codex Cloud) have no `DATABASE_URL`/`REDIS_URL` at all and cannot run
this runner (§2.2, §2.3). That single-machine, single-`.env` case is the only
one this runbook can currently describe as environment-correspondent,
because "the same operator, the same checkout, the same `.env`" is itself
the only evidence available.

**Fail-closed rule:** if `--base-url` is pointed anywhere other than the
default local server backed by that same operator's `.env` — including any
staging or production HTTP target — multi-window batch execution
(`--max-windows` greater than 1) is not permitted, because API-target/
database-environment correspondence cannot be established from the
repository's existing trusted environment configuration or operator
evidence. In that case, use Case A (single-window, fresh approval per
window) instead, so a human checks each mutation individually, or first land
a separately authorized runtime change to this runner (out of scope for this
docs-only PR) before relying on a multi-window batch approval against a
non-default target.

**Always pass `--base-url` explicitly — never rely on the default.** The CLI
parser (`parseRunnerCliArgs`) initializes `baseUrl` from
`OPERATOR_RUNNER_BASE_URL ?? "http://localhost:3000"` and then, if
`--base-url` is present on the command line, unconditionally overwrites it
with that flag's value — so an explicit `--base-url` reliably wins over
`OPERATOR_RUNNER_BASE_URL` when both are set. That confirmed precedence is
exactly why an *implicit* default must not be trusted: whether the effective
target is the intended `http://localhost:3000` depends on whatever
`OPERATOR_RUNNER_BASE_URL` happens to be set to in that shell, which is
invisible in a copied command that omits `--base-url`. Every batch dry-run
and `--execute` invocation must therefore pass `--base-url
http://localhost:3000` explicitly (or whatever the approved local target
is) — never a bare command that depends on `OPERATOR_RUNNER_BASE_URL` being
unset.

**What the approval must record** (non-secret only — never `DATABASE_URL`,
`REDIS_URL`, credentials, or RPC URLs, per this runbook's existing secret
rules): the intended operator environment (e.g. "local operator workstation
per `docs/operator-environments.md` §2.1"), the exact explicit `--base-url`
value used on both the dry-run and the `--execute` command, and a plain
confirmation that the runner's `DATABASE_URL`/`REDIS_URL` are that same
operator's local `.env`-configured values for that machine — never their
literal contents. The health gate that already runs before every window is
the fresh live preflight check against the approved `--base-url`; a change
in `--base-url` or an unexpected `app.env` between dry-run and execute is
itself a reason to stop and re-verify, not something to wave past.

**Same-environment requirement.** A successful dry-run against one
environment does not authorize `--execute` against a different one, even
when wallet, chain, cursor, range, and policy labels all happen to match —
matching invocation parameters prove nothing about which database or API
server they were evaluated against.

This exception is scoped tightly to `wallet-forward-sync-runner.ts` because of
its specific safety properties (fixed hard cap, mandatory dry-run-first,
per-window pre- and post-submit gates, fail-closed non-zero exit, no
auto-retry). It does **not** mean: every backfill may now batch 5 windows;
every operator command may batch windows; one approval covers an unlimited
campaign; runner failures can be skipped; later windows remain authorized
after a hard stop; dry-run is optional; `--max-windows 5` should be the
default (it is still `1`); manual API calls inherit this batch exception; or
that `scripts/transfer-backfill-runner.ts` inherits this policy. This
runner's batch exception does not transfer any authorization to
`transfer-backfill-runner.ts` or to the separately governed backward
transfer-backfill campaign it drives
(`docs/transfer-history-backfill-operator-plan.md`) — that campaign's own
paused/resume posture and next-window approval are governed entirely by its
own runbook and current operator evidence, not by this document. This
document intentionally does not restate that campaign's current window
number here, since it is fast-moving state this runbook does not own and has
previously gone stale in this exact section (see `docs/project-decisions.md`
D-036 for the most recent verified campaign evidence and its correction
posture — note D-036 is itself `Proposed`, and explicitly does not authorize
executing any further backward-campaign window).

### Resuming after a hard stop

A hard stop can occur only after a window's `POST /api/sync/manual` has
already been submitted — earlier windows in the batch, and possibly part of
the failing window itself, may have already mutated `SyncCursor`, raw
tables, and canonical ledger rows before the post-run gates caught the
problem. Re-running the original invocation's exact command is therefore not
just unauthorized under Case C — it will usually be technically wrong,
because the live state it validates against has moved.

A "hard stop" here is a **runner/batch-level** event — the runner's own
post-run gate check failed and it will not submit the next window. It is
distinct from a `SyncRun`-level `FAILED` status: the exact submitted
`SyncRun` can be `COMPLETED` (the sync pipeline finished and the cursor
advanced) while the runner still hard-stops because of a nonzero
`warningCount` or a post-run contamination/duplicate finding. Do not assume
either terminal state going in — read the actual persisted `SyncRun.status`
per the identity procedure below before drawing any conclusion.

**What stays fixed**, unless the product owner deliberately authorizes a
different operation entirely:

- `--wallet-address` / the resolved `walletId`
- `--chain-id`
- the source family (`TRANSFERS`, fixed by this runner)
- the `--window-size` policy
- the operator's overall intent (continuing this wallet's forward TRANSFERS
  coverage)

**What MUST be re-derived from canonical persisted state before any resume
attempt** — never reused from the failed invocation's parameters or evidence
file:

1. **Identify the exact submitted attempt first — never assume it.** Read
   the submitted window's `runId` and `policyLabel` from the runner's own
   evidence: `POST /api/sync/manual` returns `202 { data: { runId } }`, and
   the runner immediately polls that exact `runId` to a terminal state
   (`pollSyncRunToTerminal`) and then writes it into the `kind: "window"`
   evidence record (`--evidence-file`, default
   `operator-evidence/wallet-forward-sync-batch-runner/evidence.jsonl`)
   alongside the window's exact `policyLabel` (e.g. `prefix-3`) — read both
   from that record (or, if inspecting live before the evidence write
   completes, from the submission response itself). A different historical
   `SyncRun` can share the same wallet, chain, source family, and block
   range and must never substitute for the actual submitted attempt —
   matching range alone is never identity.
2. Inspect that **exact** `SyncRun` row in canonical PostgreSQL by primary
   key (`SELECT * FROM "SyncRun" WHERE id = <runId>`), and cross-check
   `SyncRun.policyLabel` equals the approved/generated `policyLabel` from
   step 1 — both `id` and `policyLabel` must match; do not rely on an
   assumed uniqueness constraint instead of checking both fields directly.
   Do not assume the status is `FAILED` or `COMPLETED` before reading it —
   a runner/batch hard stop can occur with the exact submitted `SyncRun`
   itself `COMPLETED` (see above). Read: exact `status`, `walletId`,
   `chainId`, `sourceFamilies`, `startBlock`/`endBlock`, `latestSafeBlock`,
   `warningCount`/`warningDetails`, `errorMessage`, `failedSourceFamily` /
   `failedFromBlock` / `failedToBlock`.
3. Inspect the live `SyncCursor` for this wallet/chain/`TRANSFERS` directly
   (read-only `SELECT`) — do not assume it matches any value from the
   original approval, dry-run, or evidence file.
4. Re-run the fabricated-contamination, duplicate-`RawTransaction`,
   duplicate-`RawTokenTransfer`, and duplicate-`LedgerEntry` checks over the
   identified window's exact range (the same checks the runner itself runs
   post-run).
5. Confirm no `PENDING`/`RUNNING` `SyncRun` remains active.
6. From all of the above, classify the window per the "Coverage proof" and
   "Integrity proof" definitions below — do not derive a next range from
   raw/canonical row inspection alone (see "Empty-block semantics" below).

**Coverage proof — what current persisted evidence CAN prove.** Per
`runWalletSync` (`src/services/sync/sync-orchestrator.ts`), `SyncCursor` for
a source family is only upserted (`cursorStore.upsertCursor`) after that
source family's ingest → normalize → persist-ledger steps have all completed
without throwing, and `SyncRun.status` is only set to `COMPLETED` after every
requested source family's loop iteration — including that cursor upsert —
finished without throwing. That is meaningful proof only once it is bound to
the exact submitted attempt: a different `SyncRun` with a matching wallet,
chain, source family, and block range is **not** substitute evidence, even
if it happens to be `COMPLETED` too. Coverage proof therefore has two
required parts, checked in order, on top of the identity procedure above:

**A. Submitted-run identity proof** (from steps 1–2 above; required before
part B means anything):

- the inspected row's `SyncRun.id` equals the exact `runId` returned by
  `POST /api/sync/manual` for that submitted window,
- the inspected row's `SyncRun.policyLabel` equals the exact
  approved/generated `policyLabel` for that submitted window.

**B. Processing/coverage proof** (once A holds), checked together — not an
inference from the presence or count of raw rows:

- the identified `SyncRun`'s `walletId`, `chainId`,
  `sourceFamilies === ["TRANSFERS"]`, `startBlock`, and `endBlock` match the
  proposed window exactly,
- `SyncRun.status === "COMPLETED"` (not merely non-`"FAILED"` — a run stuck
  outside a terminal state is not proof of anything),
- `SyncRun.latestSafeBlock === endBlock`,
- `SyncRun.failedSourceFamily`/`failedFromBlock`/`failedToBlock` are all
  `null`,
- the live `SyncCursor.fromBlock` is unchanged from the batch's anchor, and
  `SyncCursor.toBlock === endBlock` exactly (not merely "the highest
  observed block," and not inferred from any raw table).

If A and B all hold, coverage through the exact submitted `endBlock` is
proven — `--first-window-start = live SyncCursor.toBlock + 1` is safe with
respect to coverage. If any one of them does not hold — including a
mismatched `runId` or `policyLabel`, a `status` that is not `COMPLETED`, a
cursor that has not moved to exactly `endBlock`, or a mismatched identity
field — coverage is **not** proven, regardless of what raw or ledger rows
exist for the range; treat the window as case 2 of the "Failed-range rule"
below.

**C. Integrity proof — separate from coverage (A + B), and required in
addition to it.** A range can be fully coverage-proven per the checks above
and still be unsafe to build on top of. Integrity proof requires,
independently:

- `SyncRun.warningCount === 0` and `warningDetails` empty (a nonzero warning
  count does not mean the range is unprocessed — the sync pipeline records
  warnings and still reaches `COMPLETED` and advances the cursor — but it
  does mean the window has not cleared the runner's own per-window safety
  bar and must be triaged),
- zero rows from the post-run fabricated-contamination check over the
  window's range,
- zero duplicate-identity groups from the `RawTransaction`,
  `RawTokenTransfer`, and `LedgerEntry` duplicate checks over the window's
  range,
- zero remaining active (`PENDING`/`RUNNING`) `SyncRun`s.

Only when **both** coverage proof and integrity proof hold may a fresh
forward dry-run be proposed. If coverage is proven but integrity is not
(most commonly: `SyncRun.status === "COMPLETED"` with `warningCount !== 0`),
the range is processed but not yet safe to continue from — the warnings must
be triaged and resolved or explicitly classified as safe under this
repository's existing warning-triage policy
(`docs/transfer-history-backfill-operator-plan.md` §7's per-window
verification checklist, which this runbook already reuses in the
"Recommended sequence" section above) before any new forward dry-run is
proposed. This runbook does not define a new triage mechanism beyond that
existing checklist, and does not assert that a warning is automatically safe
to move past — "warning-only" is not a synonym for "safe to continue."

Only after both proofs hold, derive the next invocation's parameters from
that live truth:

- new `--expected-cursor-from` = the live cursor's current `fromBlock` (should
  equal the original anchor, but verify from step 2 — do not assume)
- new `--expected-cursor-to` = the live cursor's current `toBlock`, as just
  read — **not** the value from the original approval or dry-run
- new `--first-window-start` = `live cursor.toBlock + 1`
- a new, collision-free `--policy-label-prefix` — verify against existing
  `SyncRun.policyLabel` values for this chain; do not assume the original
  prefix, or its per-window labels (e.g. `prefix-1`), are still free, since
  some of them are now `COMPLETED` `SyncRun`s
- a new `--max-windows` matching whatever bounded resume scope the product
  owner explicitly approves for this fresh invocation — it does not need to
  equal, and is not implicitly capped by, how many windows remained
  unauthorized in the original batch
- the same verified target environment as the failed batch (see
  "Target-environment binding" above) — a resume attempt is itself a fresh
  Case B (or Case A) approval and must record it again

**Failed-range rule.** A submitted window that later fails a post-run gate
must **not** be automatically retried, and must **not** be automatically
skipped. From the state gathered above, determine which of two cases
applies:

1. **PROVEN CONTIGUOUSLY COVERED** — coverage proof holds through the exact
   submitted `endBlock` (as defined above) **and** integrity proof is clean
   (or a blocking warning has been triaged and resolved/explicitly cleared
   under the existing warning-triage policy referenced above). Only then may
   the next candidate range start at `live SyncCursor.toBlock + 1`, derived
   fresh as described above; retrying the same submitted range would be
   wrong or duplicative once coverage is proven.
2. **PARTIAL / AMBIGUOUS / INTEGRITY-FAILED** — coverage cannot be
   positively proven through the exact submitted `endBlock` (for example
   `status !== "COMPLETED"`, or the cursor did not advance to exactly
   `endBlock`), or coverage is proven but a blocking integrity concern (a
   warning, contamination, a duplicate group, or a stuck active operation)
   has not been resolved. In either case, do not retry, do not skip, do not
   advance the forward range, and do not derive a new normal forward batch —
   normal forward execution must **not** continue until the state has been
   reconciled through a separately approved recovery/repair path. This
   runner has no reconciliation or repair code path; do not invent one
   operationally.

Never infer "the batch failed" to mean "no mutation happened." Never infer
"a high persisted block exists" or "the cursor advanced" to mean "the range
is safely covered" or "every invariant is safe" — only the exact coverage
and integrity checks above establish that; a window can advance the cursor
and still fail a post-run gate (for example, a nonzero warning count) that
requires investigation before anything else proceeds. Backend/PostgreSQL
persisted execution state (`SyncRun`/`SyncCursor` per the coverage-proof
checks above) governs the resume decision, not the failed invocation's
command-line arguments, its evidence file, or the presence/absence of raw
rows for individual blocks.

**Empty-block semantics.** A fully processed, fully covered TRANSFERS window
can legitimately contain zero wallet-relevant `RawTransaction` /
`RawTokenTransfer` / `LedgerEntry` rows for some or all of its blocks — the
sync pipeline scans every block in range but only persists rows for
blocks/transfers that actually involve the wallet. Do not use "one raw row
per block," "a transaction in every block," or any other row-continuity
count as a coverage test — it will misclassify a legitimately quiet range as
incomplete. Raw and canonical rows remain useful for the integrity checks
above (contamination inspection, duplicate detection, spotting unexpected
partial state), never as a naive per-block completeness test.

**Window-number semantics.** The runner's internal `windowNumber` (and
therefore the generated `prefix-<n>` label) is **invocation-local** — it
always starts at 1 for a fresh invocation, regardless of how many logical
windows an earlier batch already completed for this wallet. A resumed
invocation's internal window 1 is not the campaign's logical "next window" —
it is whatever forward range the freshly derived `--first-window-start`
produces. When discussing resume scope with the product owner, state the
logical block range being resumed (for example, "continuing forward from
block X"), not just the runner's internal window-number, to avoid conflating
the two.

**Example — allowed batch (Case B):** the operator explicitly passes
`--base-url http://localhost:3000` on the command line (never relying on the
`OPERATOR_RUNNER_BASE_URL` default being unset — see "Target-environment
binding" above for why an explicit flag is required) — that server's `.env`
also supplies the runner's own `DATABASE_URL`/`REDIS_URL`. A fresh dry-run
against that same explicit target,
`--max-windows 5 --first-window-start 25078549 --window-size 1000
--base-url http://localhost:3000`, exits 0 and previews exactly windows 1–5
covering `[25078549, 25083548]` with no collisions or gaps. The product owner
approves that exact wallet, chain, cursor, range, `--max-windows 5`, and
`--base-url http://localhost:3000` in one message. The operator runs the
same command with `--execute` and the identical
`--base-url http://localhost:3000`. All 5 windows complete and pass every
per-window gate; the runner stops cleanly after window 5
(`stoppedReason: "max_windows_reached"`). No further approval is needed for
windows 1–5 individually — one approval covered the batch.

**Example — hard stop (Case C):** the same approved 5-window batch is
running (submitted with `--base-url http://localhost:3000` explicitly, on
both the dry-run and the `--execute` invocation); window 3's `POST` returns
`202 { data: { runId: <runId-X> } }`, and its `SyncRun`/`SyncCursor` writes
advance as normal, but the window then fails a post-run gate (say,
`warningCount !== 0`). The runner writes a `kind: "stop"` evidence record
with `reason: "invariant_failed_after_run"` (including `runId: <runId-X>`
and `policyLabel: "prefix-3"`) and exits nonzero. It does **not** submit
window 4 or window 5 — the remaining 2 windows of that approval are no
longer authorized, and reusing the original `--expected-cursor-to` /
`--first-window-start` / `--policy-label-prefix` verbatim in a fresh
invocation would fail immediately: the live cursor has already moved past the
original `--expected-cursor-to`, and `prefix-1`/`prefix-2`/`prefix-3` already
exist as `COMPLETED` `SyncRun`s.

Before any resume attempt, the operator reads canonical state per "Resuming
after a hard stop" above — the decision is never based on "a high block
exists" or "the cursor moved," only on the exact identity, coverage-proof,
and integrity-proof checks defined there:

- Identity proof: the evidence file's `kind: "window"` record for window 3
  gives `runId: <runId-X>` and `policyLabel: "prefix-3"`. The operator reads
  `SELECT * FROM "SyncRun" WHERE id = <runId-X>` and confirms
  `policyLabel === "prefix-3"` on that exact row — not any other
  `COMPLETED` run that happens to share this wallet/chain/range. Only that
  exact row is used for the checks below.
- Coverage proof (on that exact identified row): `status === "COMPLETED"`,
  matching `walletId`/`chainId`/`sourceFamilies`/`startBlock`/`endBlock`,
  `latestSafeBlock === endBlock`, `failedSourceFamily`/`failedFromBlock`/
  `failedToBlock` all `null`, and the live `SyncCursor.toBlock` equals
  window 3's exact `endBlock` with `fromBlock` unchanged — so coverage
  through window 3's `endBlock` is proven.
- Integrity proof: the nonzero `warningCount` that triggered the hard stop
  is triaged per `docs/transfer-history-backfill-operator-plan.md` §7's
  existing checklist and resolved/explicitly classified as safe, and the
  contamination/duplicate/active-operation checks are all clean.
- Only once identity, coverage, **and** integrity all hold does the next
  candidate range start at `live SyncCursor.toBlock + 1` (immediately after
  window 3's `endBlock`), under a fresh dry-run — against the same verified
  target environment, with the same explicit
  `--base-url http://localhost:3000` on both the dry-run and the subsequent
  `--execute` — with a new `--expected-cursor-from`/`--expected-cursor-to`
  read from that live cursor, a new `--first-window-start` equal to that
  same value, and a new collision-free `--policy-label-prefix` (for example
  a `-resume-1` suffix) — then a fresh product-owner approval of those exact
  new parameters, that same `--base-url`, and that same environment, matched
  exactly by the fresh dry-run and the subsequent `--execute` invocation.
- If identity cannot be established (the inspected row's `id` or
  `policyLabel` does not match the evidence file exactly), or coverage
  cannot be proven on the correctly identified row (for example
  `status !== "COMPLETED"` or the cursor did not reach exactly window 3's
  `endBlock`), or the warning/integrity concern is not resolved, forward
  execution stops entirely until the state is reconciled through a
  separately approved recovery/repair path — no new forward-batch dry-run or
  approval is proposed until then.

### Executing

```bash
npm run backfill:wallet-forward -- \
  --wallet-address 0x08ac26d74013af7430c350c97eacd8be0bdc5613 \
  --chain-id 369 \
  --expected-cursor-from 25077549 --expected-cursor-to 25078548 \
  --first-window-start 25078549 --window-size 1000 \
  --max-windows 5 --policy-label-prefix wallet-forward-sync-window \
  --base-url http://localhost:3000 \
  --execute
```

`--base-url` must be the exact same value used on the dry-run above —
matching invocation parameters do not by themselves prove the same target
was used if `--base-url` was left implicit on either command (see
"Target-environment binding" above).

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
