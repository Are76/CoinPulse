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
its own fresh lock reservation and its own fresh contamination check (§ step 4 below) regardless
of how recent the dry-run's `generatedAt` is.

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

## Non-goals

- No automatic background sync or worker/queue infrastructure.
- No change to materialization arithmetic, pricing, PnL, or yield.
- No repair of the still-ACTIVE fabricated transfer rows (~11,528) — out of scope; see the
  existing contamination pre-gate and repair script referenced in
  `docs/transfer-history-backfill-operator-plan.md` §3 Q5.
- No continuation of the paused chain-wide TRANSFERS backfill campaign — that remains paused
  after Window 60 pending explicit operator approval for Window 61.
