# Transfer History Backfill — Operator Execution Plan

**Status:** PLAN ONLY — no sync has been executed. Waiting for explicit product-owner approval before Window 1.

**Recommendation:** `INVESTIGATION REQUIRED` (see §10 — four numeric inputs must be read from the
operator database before Window 1 can be defined; everything else in this plan is ready).

**Scope:** Backfill ONLY the `TRANSFERS` source family for the tracked wallet
(`0x75f808367720951e789d47e9e9db51148d9aa765`, chainId 369) until canonical token balances are
complete and the `negative-token-balance` materialization warnings disappear or are fully explained.

**Out of scope (hard exclusions):** staking backfill, fabricated-transfer cleanup (including the
remaining ~11,528 still-ACTIVE fabricated rows), chain-wide repair, schema changes, migrations,
pricing, PnL, yield, frontend, DTO contracts, unrelated cleanup.

---

## 1. Evidence model

Every mechanism claim in this plan is verified from code on `main` @ `59bafd1`
(after PR #327 and PR #328 merged). File/line references are given inline. Numeric claims that
require the operator database or PulseChain network access are explicitly marked
**[OPERATOR INPUT]** — they were NOT determinable from the planning environment (see §10).

---

## 2. Verified mechanics the plan is built on

These are the code facts that dictate the strategy. Do not re-derive them; they were checked.

1. **Manual sync request contract** — `POST /api/sync/manual` takes `walletAddress`, `chainId`,
   `sourceFamilies`, optional `startBlock`, required `endBlock`, `policyLabel`
   (`src/services/api/validation.ts:51-72`). When `startBlock` is supplied the span is capped at
   **1,000 blocks** (`MANUAL_SYNC_MAX_BLOCK_SPAN`, `src/services/api/validation.ts:13`).
2. **`startBlock` omission is a foot-gun.** Without `startBlock`, the orchestrator resumes from
   `cursor.toBlock + 1`, and **from block 0 if no cursor exists** — with NO span validation,
   because the 1,000-block check only fires when `startBlock` is present
   (`src/services/sync/sync-orchestrator.ts:111`, `src/services/api/validation.ts:64-72`).
   **Every backfill window MUST pass explicit `startBlock` AND `endBlock`.**
3. **The route is async.** `/api/sync/manual` returns `202 { runId }` immediately and runs the
   pipeline via `after()` (`app/api/sync/manual/route.ts:53-76`). The operator must poll the run
   to completion before evaluating the window.
4. **One operation at a time is enforced by the backend.** `reserveOperationRun` rejects a new
   sync while any `PENDING`/`RUNNING` sync exists for the same wallet+chain, and rejects both
   sync and rebuild while any rebuild is active, with HTTP 409 and operator-safe details
   (`src/services/operations/operation-lock.ts:71-224`). Stale runs (`PENDING` > 15 min,
   `RUNNING` > 60 min) are *flagged* stale in the conflict details but **still block** — a
   crashed run must be manually marked `FAILED` before the next window.
5. **The sync cursor tracks ONE contiguous covered range.** `mergeCursorWindow` merges a new
   window into the existing `[fromBlock, toBlock]` range only if it is adjacent or overlapping;
   a **disconnected window is silently dropped from the cursor** (`changed: false`)
   (`src/services/sync/sync-state-store.ts:223-270`). Consequence: windows must extend the
   covered range **adjacently** — never jump. The cursor is upserted only after the window's
   ledger persistence succeeded (`src/services/sync/sync-orchestrator.ts:244-251`), so
   `SyncCursor.fromBlock` is a trustworthy backfill progress marker.
6. **Ingestion cost is proportional to block count, not transfer activity.** For every window the
   TRANSFERS path (a) runs two topic-filtered `eth_getLogs` scans (incoming + outgoing) in
   adaptive sub-windows of `SYNC_MAX_WINDOW_SIZE` blocks (env-tunable; default **2** = public-RPC
   profile, `src/services/sync/transfer-sync.ts:81-86`), and (b) fetches **every block in the
   window** with `getBlock(includeTransactions: true)` plus a receipt per wallet-touching
   transaction, for native PLS transaction + gas-fee evidence
   (`src/services/sync/sync-common.ts:305-371`). A 1,000-block window therefore costs ≥1,000
   `getBlock` calls no matter how quiet the wallet was. **Windows must not skip blocks** — the
   native scan is the only source of native PLS evidence, and skipped blocks would silently lose
   native transfers.
7. **Everything is idempotent; overlap cannot create duplicates.** Raw persistence uses
   `createMany({ skipDuplicates: true })` on full unique identities
   (`src/services/ingestion/raw-store.ts:352-439`); ledger persistence uses deterministic
   SHA-256 IDs + `dedupeKey` + `skipDuplicates`
   (`src/services/sync/ledger-store.ts:104-222`). Re-running a window is safe.
8. **Normalization re-reads the whole window range from the DB**, not just newly fetched rows
   (`readWalletTransferRawTokenTransfers`, ACTIVE-only, `src/services/ingestion/raw-store.ts:583-604`).
   Two consequences:
   - Repaired fabricated rows (status `REORGED` after PR #328,
     `src/services/ingestion/fabricated-transfer-repair.ts:372-378`) are **excluded** — they
     cannot re-enter the ledger.
   - Any of the remaining ~11,528 **still-ACTIVE** fabricated rows that (a) fall inside a
     backfill window and (b) carry the tracked wallet in `fromAddress`/`toAddress` **will be
     swept into normalization**. This is the one genuine interference risk after PR #328 — see
     §8 risk R4 and the per-window contamination check in §7.
   - New fabricated rows can no longer be created: ingestion now drops non-Transfer-topic0 and
     unrelated-wallet logs at fetch time with warnings
     (`src/services/sync/sync-common.ts:274-303`).
9. **Sync persists the canonical ledger but does NOT materialize positions.** `runWalletSync`
   ends after cursor update (`src/services/sync/sync-orchestrator.ts:151-266`). Only the rebuild
   operation calls `materializeCurrentPortfolioPositions`
   (`src/services/rebuild/run-rebuild-operation.ts:102-108`).
10. **Materialization is always full-wallet.** It reads the ENTIRE ledger for the wallet
    regardless of the rebuild's block range (`src/services/portfolio/materialize-positions.ts:113-114`)
    and emits `negative-token-balance:<assetId>:<qty>` warnings
    (`src/services/portfolio/materialize-positions.ts:172-176`). Therefore a **small-range
    rebuild is a sufficient trigger to refresh all balances and warnings** — rebuild span is
    also capped at 1,000 blocks per request (`REBUILD_MAX_BLOCK_SPAN`,
    `src/services/api/validation.ts:14`).
11. **Rebuild for TRANSFERS deletes scoped `TRANSFER` ledger entries for its range and
    re-normalizes from ACTIVE raw only** (`src/services/rebuild/rebuild-ledger.ts:45,210-238`),
    then materializes. It never touches raw evidence.
12. **Warning storage truncates at 200 details** but `warningCount` stays exact
    (`src/services/sync/sync-state-store.ts:8-19`). Use `warningCount` for gating, details for
    triage.

---

## 3. Investigation-first: the six required questions

### Q1 — How much historical transfer coverage already exists? **[OPERATOR INPUT]**

Cannot be answered without the operator database. Run against production Postgres:

```sql
-- I1a: the wallet id
SELECT id, address, "chainId" FROM "Wallet"
WHERE lower(address) = '0x75f808367720951e789d47e9e9db51148d9aa765' AND "chainId" = 369;

-- I1b: contiguous covered range per source family (TRANSFERS row is the one that matters)
SELECT "sourceFamily", "fromBlock", "toBlock", "blockHash", "updatedAt"
FROM "SyncCursor" WHERE "walletId" = :walletId AND "chainId" = 369;

-- I1c: actual raw evidence distribution (sanity check against the cursor)
SELECT min("blockNumber") AS min_block, max("blockNumber") AS max_block, count(*)
FROM "RawTokenTransfer"
WHERE "chainId" = 369 AND status = 'ACTIVE'
  AND (lower("fromAddress") = :wallet OR lower("toAddress") = :wallet);

SELECT min("blockNumber") AS min_block, max("blockNumber") AS max_block, count(*)
FROM "RawTransaction"
WHERE "chainId" = 369
  AND (lower("fromAddress") = :wallet OR lower("toAddress") = :wallet);
```

Record: `CURSOR_FROM` = TRANSFERS `fromBlock`, `CURSOR_TO` = TRANSFERS `toBlock`.
If raw evidence exists *below* `CURSOR_FROM` (e.g. from staking-era ingestion), it does not count
as transfer coverage — the cursor range is the only trustworthy "no gaps" claim (fact 5).

### Q2 — Earliest missing transfer block? **[OPERATOR INPUT]**

`EARLIEST_MISSING = FIRST_ACTIVITY_BLOCK`, the block of the wallet's first PulseChain
transaction/transfer, provided `FIRST_ACTIVITY_BLOCK < CURSOR_FROM` (expected, given the negative
balances). Determine `FIRST_ACTIVITY_BLOCK` from the PulseChain explorer
(`scan.pulsechain.com` address page, "first seen") or by RPC bisection if the explorer is
unavailable. Cross-check: the earliest ledger entry that *spends* (direction `OUT`) an asset
flagged `negative-token-balance` must sit at a block above `FIRST_ACTIVITY_BLOCK`. Block height
lives on `LedgerActionGroup.blockNumber` (`LedgerEntry` carries only `occurredAt`), so join:

```sql
-- I2: earliest OUT (spend) block per negative-balance asset
SELECT e."assetId", min(g."blockNumber") AS earliest_out_block, count(*)
FROM "LedgerEntry" e
JOIN "LedgerActionGroup" g ON g.id = e."actionGroupId"
WHERE e."walletId" = :walletId AND e."chainId" = 369
  AND e.direction = 'OUT'
  AND e."assetId" IN (:negativeAssetIds)  -- from PortfolioMaterializationState warnings
GROUP BY e."assetId" ORDER BY min(g."blockNumber");
```

Each `earliest_out_block` must be `> FIRST_ACTIVITY_BLOCK`; inbound rows must not be used to
bound earliest activity.

### Q3 — Does previous transfer ingestion exist? **[OPERATOR INPUT — expected: yes, partial]**

```sql
-- I3: prior TRANSFERS runs
SELECT id, status, "startBlock", "endBlock", "latestSafeBlock", "warningCount",
       "errorMessage", "failedSourceFamily", "createdAt"
FROM "SyncRun"
WHERE "walletId" = :walletId AND "chainId" = 369
  AND 'TRANSFERS' = ANY("sourceFamilies"::text[])
ORDER BY "createdAt" DESC LIMIT 50;
```

The negative balances themselves imply partial ingestion: the ledger contains outflows of tokens
whose inflows were never ingested. Expect a TRANSFERS cursor near head with `fromBlock` well above
first activity. If NO TRANSFERS cursor exists at all, the sequence switches to Case B (§5).

### Q4 — How many transfer windows are expected? **[OPERATOR INPUT — formula fixed]**

```text
GAP = CURSOR_FROM − FIRST_ACTIVITY_BLOCK          (Case A)
W   = ceil(GAP / 1000)
```

Illustrative bound only (NOT a plan input): PulseChain forked at ~block 17,233,000 (May 2023) and
produces ~8,640 blocks/day, so a wallet active since launch with a head-only cursor could need on
the order of **thousands of windows**. The real `W` must come from Q1/Q2 numbers. This is why the
RPC-cost profile (fact 6, risk R1) and `SYNC_MAX_WINDOW_SIZE` tuning matter more than any other
operational choice.

### Q5 — Can previous fabricated-transfer rows interfere after PR #328? **Answered from code: partially.**

- Rows already repaired to `REORGED` by the targeted PR #328 repair: **cannot interfere** — every
  read-back path filters `status = 'ACTIVE'` (fact 8).
- The remaining ~11,528 still-ACTIVE fabricated rows: **can interfere if and only if** a row falls
  inside a backfill window's block range AND matches the wallet address. Fabricated rows decoded
  from HEX `StakeStart` events alias the staker into `fromAddress`, so wallet-relevant hits are
  plausible in ranges around historical stake operations.

  **Timing is critical: this check is a PRE-SUBMIT hard gate, not a post-completion check.**
  The window run re-reads ALL ACTIVE rows in the range and persists ledger entries from them
  *before* the run reaches `COMPLETED` (fact 8) — a contamination check run only after completion
  would fire after the contaminated entries are already in the canonical ledger. Run the query
  below over `[startBlock_k, endBlock_k]` **before** every `POST /api/sync/manual`.

  Detection query (`RawLog` stores scalar `topic0..topic3` columns; `topic0` is nullable, and a
  NULL `topic0` cannot be a genuine ERC-20 Transfer, so treat NULL as a hit):

```sql
-- I5/V8: ACTIVE RawTokenTransfer rows in range whose backing RawLog is not a real ERC-20 Transfer
SELECT t.id, t."txHash", t."logIndex", t."blockHash", t."blockNumber", t."tokenAddress"
FROM "RawTokenTransfer" t
JOIN "RawLog" l
  ON l."chainId" = t."chainId" AND l."txHash" = t."txHash"
 AND l."logIndex" = t."logIndex" AND l."blockHash" = t."blockHash"
WHERE t."chainId" = 369 AND t.status = 'ACTIVE'
  AND t."blockNumber" BETWEEN :startBlock AND :endBlock
  AND (lower(t."fromAddress") = :wallet OR lower(t."toAddress") = :wallet)
  AND (l."topic0" IS NULL
       OR lower(l."topic0") <> '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
```

If this returns rows for a window: **STOP — do not submit the window, do not run a chain-wide
repair.** Report the exact identities to the product owner; the existing identity-targeted repair
(`scripts/repair-fabricated-token-transfers.ts`, exact `chainId + txHash + logIndex + blockHash`
targeting) is the approved bounded remedy, but invoking it for new rows is a product-owner
decision, not part of this plan.

**Remediation if contamination is discovered only after a window ran** (pre-gate skipped or
missed): STOP the campaign; obtain product-owner approval for the identity-targeted repair of the
specific rows (marks them `REORGED`); then run one `POST /api/rebuild` over the affected window's
range with `sourceFamilies: ["TRANSFERS"]` — rebuild deletes the scoped `TRANSFER` ledger entries
for that range and re-normalizes from ACTIVE-only raw (facts 8, 11), which purges the contaminated
entries deterministically and re-materializes. Resume the window sequence afterwards.

### Q6 — Rebuild after every window, after groups, or once at the end? **Answered from code: grouped checkpoints + once at the end.**

Justification:

- Each sync window **already persists its canonical ledger slice idempotently** (facts 7, 9). A
  rebuild adds no ledger information the window didn't write; for TRANSFERS it would delete and
  deterministically recreate identical entries (fact 11).
- The only thing sync does NOT do is materialization, and materialization is **full-wallet
  regardless of rebuild range** (fact 10). So one small rebuild refreshes every balance/warning.
- Rebuilding after every window is strictly worse: it recomputes the full ledger `W` times,
  serializes against the sync lock (fact 4) so it stretches wall-clock time, and — decisive —
  the `negative-token-balance` warnings **cannot clear until the history is contiguous anyway**,
  so per-window materialization only re-reports a known-incomplete state.
- Rebuilding only once at the end loses the progress signal: the negative-balance magnitudes
  shrinking checkpoint-over-checkpoint is the cheapest proof the backfill is working (and the
  earliest tripwire if it isn't).

**Recommendation:** run a checkpoint rebuild after every **25 windows** (~25,000 blocks) and one
final rebuild after the last window. Each checkpoint rebuild is a single
`POST /api/rebuild` over the **most recent completed window's range** (≤1,000 blocks — satisfies
the span cap, deterministic no-op for the ledger, full materialization refresh):

```json
{ "walletAddress": "0x75f808367720951e789d47e9e9db51148d9aa765", "chainId": 369,
  "fromBlock": <last window startBlock>, "toBlock": <last window endBlock>,
  "sourceFamilies": ["TRANSFERS"] }
```

Record the full warning list from each checkpoint. Treat the negative-balance trend as a
**heuristic**, not a gate: it is expected to shrink over the campaign, but a single checkpoint can
legitimately show a magnitude *growing* — a descending window can ingest a historical outflow
before the even-earlier inflow that funds it has been reached. Do not stop on trend alone.
Progression gates are: cursor continuity (V10), no unexpected warning classes (V2), no fabricated
contamination (V8), and the final reconciliation in §9.

---

## 4. Preflight (before Window 1 and after any interruption)

Hard-stop if any check fails:

1. `git fetch origin main` succeeds; operator deployment is running code that includes PR #326,
   #327, #328 (fabricated-row ingest filter + repair).
2. Working tree clean, deployment healthy: `GET /api/debug/health` returns healthy DB status.
3. Redis up (`docker compose ps` / `redis-cli ping`) and Postgres up (`pg_isready`).
4. No active or stuck operation:
   ```sql
   SELECT id, trigger, status, stage, "createdAt", "updatedAt" FROM "SyncRun"
   WHERE status IN ('PENDING','RUNNING');
   ```
   Must return 0 rows. A stale row (PENDING > 15 min / RUNNING > 60 min, fact 4) must be
   investigated and manually marked `FAILED` before proceeding — it will otherwise 409 every
   window.
5. `SYNC_MAX_WINDOW_SIZE` is set **explicitly** for the RPC tier per
   `docs/operator-environments.md` and the comment at `src/services/sync/transfer-sync.ts:81-86`
   (public RPC → 2, private → 500+, local → 2000). If unset, the code falls back to a hardcoded
   default of `2` — the slowest, public-RPC profile — so an unset variable silently maximizes
   campaign wall-clock time (risk R1). Separately, confirm which RPC **endpoint URL** is
   authoritative: the endpoint has NO hardcoded default since PR #249 and must be
   operator-supplied.
6. Investigation queries I1–I3 executed and `CURSOR_FROM`, `CURSOR_TO`, `FIRST_ACTIVITY_BLOCK`,
   `W` recorded in this document (§10 table).

---

## 5. Window sequence

### Direction decision

- **Case A (expected): a TRANSFERS cursor exists covering `[CURSOR_FROM, CURSOR_TO]`.**
  Backfill **descending**, each window adjacent to the covered range's lower edge, so every
  completed window extends the cursor downward (facts 5) and `SyncCursor.fromBlock` is the
  resumable progress marker at all times.
- **Case B: no TRANSFERS cursor exists.** Backfill **ascending** from `FIRST_ACTIVITY_BLOCK`;
  Window 1 creates the cursor, subsequent windows extend `toBlock` upward adjacently until head.
  (Ascending also satisfies the high-water block-hash rule,
  `src/services/sync/sync-state-store.ts:234-236`.)

Never submit a window disconnected from the current cursor range — its coverage is silently not
recorded (fact 5) and gap accounting breaks.

### Case A window formula

```text
Window k (k = 1..W):
  startBlock_k = max(CURSOR_FROM − 1000·k,        FIRST_ACTIVITY_BLOCK)
  endBlock_k   =     CURSOR_FROM − 1000·(k−1) − 1
```

### Window plan table (template — fill from §10 inputs before approval)

| Window | startBlock | endBlock | Purpose | Expected transfer activity | Expected verification |
|---|---|---|---|---|---|
| 1 | `CURSOR_FROM − 1000` | `CURSOR_FROM − 1` | First backfill slice adjacent to existing coverage | Unknown until run; record `rawLogCount`, RawTokenTransfer/RawTransaction deltas as the baseline | Full §7 checklist; cursor `fromBlock` == `startBlock_1` |
| 2 | `CURSOR_FROM − 2000` | `CURSOR_FROM − 1001` | Continue descending | Compare against Window 1 baseline | Full §7 checklist; cursor `fromBlock` == `startBlock_2` |
| … | … | … | … | … | … |
| every 25th | — | — | Checkpoint rebuild (§3 Q6) | n/a | Negative-balance trend recorded (heuristic — see §3 Q6; not a stop gate by itself) |
| W (last) | `FIRST_ACTIVITY_BLOCK` | `CURSOR_FROM − 1000·(W−1) − 1` | Reach first wallet activity | Should contain the wallet's earliest inflows — the missing evidence behind the negative balances | Full §7 checklist + final rebuild + §9 success criteria |

Per-window "expected transfer activity" cannot be honestly pre-filled from this planning
environment (no DB, no explorer access — §10). The plan therefore uses a **baseline-and-trend
expectation**: record actual counts per window; flag any window whose counts are wildly
inconsistent with its neighbors *and* whose warnings show `skipped unrelated-wallet transfer log`
spikes (possible provider topic-filter misbehavior, fact 8) for manual review before continuing.

### Window execution procedure (every window)

1. Preflight steps 2–4 (§4) still hold.
2. **Pre-submit hard gate:** run the §3 Q5 contamination query over
   `[startBlock_k, endBlock_k]` — must return 0 rows (see §7 V8). Also record the V7 baseline
   count and submission time `T_k`. On contamination hits: STOP, do not submit.
3. Submit:
   ```json
   POST /api/sync/manual
   { "walletAddress": "0x75f808367720951e789d47e9e9db51148d9aa765", "chainId": 369,
     "sourceFamilies": ["TRANSFERS"],
     "startBlock": <startBlock_k>, "endBlock": <endBlock_k>,
     "policyLabel": "transfer-history-backfill-window-<k>" }
   ```
   The `policyLabel` numbering makes the SyncRun history a self-documenting audit trail.
4. Poll `GET /api/debug/status` (or the SyncRun row) until status leaves
   `PENDING`/`RUNNING`. Never submit the next window while any run is active — the 409 lock
   enforces this, but do not rely on 409s as a pacing mechanism.
5. Run the §7 verification checklist. A window is DONE only when every item passes.
6. On `FAILED`: read `errorMessage`, `failedSourceFamily`, `failedFromBlock`/`failedToBlock`;
   fix the cause (usually RPC); re-submit the SAME window (idempotent, fact 7). Never skip ahead.
7. Every 25 windows: checkpoint rebuild + trend check (§3 Q6).

---

## 6. Rebuild strategy (summary of §3 Q6)

- **No rebuild per window.**
- **Checkpoint rebuild every 25 windows**, span = the most recent window's range, TRANSFERS only.
- **One final rebuild** after Window W, then §9 success validation.
- Rebuild requests go through `POST /api/rebuild` and are subject to the same one-at-a-time lock;
  wait for `COMPLETED` before the next window.

---

## 7. Per-window verification checklist (all mandatory)

A window is NOT successful merely because the SyncRun completed (V1). All of:

| # | Check | How | Pass condition |
|---|---|---|---|
| V1 | SyncRun COMPLETED | `GET /api/debug/status` / SyncRun row | `status='COMPLETED'`, `stage='COMPLETED'`, `latestSafeBlock = endBlock_k` |
| V2 | warningCount | same | Recorded. Benign expected: `some raw blocks were already persisted…`, `skipped unrelated-wallet transfer log…`, `skipped non-transfer log…` (the ingest filter working, fact 8). Any OTHER warning class → triage before next window. Remember details truncate at 200; count is exact (fact 12). |
| V3 | errorMessage | same | `NULL` |
| V4 | failedSourceFamily | same | `NULL` (also `failedFromBlock`/`failedToBlock` NULL) |
| V5 | RawTransaction count | `SELECT count(*) FROM "RawTransaction" WHERE "chainId"=369 AND "blockNumber" BETWEEN :start AND :end AND (lower("fromAddress")=:wallet OR lower("toAddress")=:wallet);` | Recorded; consistent with window trend |
| V6 | RawTokenTransfer count | same shape against `"RawTokenTransfer"` with `status='ACTIVE'` | Recorded; consistent with window trend |
| V7 | Wallet relevance (baseline-and-delta) | **Before** submitting the window, record `BASELINE_k` = `SELECT count(*) FROM "RawTokenTransfer" WHERE "chainId"=369 AND status='ACTIVE' AND "blockNumber" BETWEEN :start AND :end AND NOT (lower("fromAddress")=:wallet OR lower("toAddress")=:wallet);` and the window submission time `T_k`. **After** completion, re-run the same query and also list new rows via `… AND "createdAt" >= :T_k` (RawTokenTransfer has `createdAt`). | Post-count − `BASELINE_k` = `0` and the `createdAt`-filtered list is empty. Pre-existing non-wallet rows (already counted in `BASELINE_k`) do not fail the window but must be noted; any NEW non-wallet row → STOP and report (provider topic-filter misbehavior, R6). |
| V8 | Fabricated contamination | **Pre-submit hard gate** (§5 step 2): §3 Q5 query over the window range BEFORE `POST /api/sync/manual` — normalization sweeps ACTIVE rows in-range during the run, so a post-completion check alone is too late. Re-run the same query after completion as confirmation. | Pre-gate `0` rows (else STOP, do not submit, report identities — do NOT repair unilaterally); post-run re-check `0` rows (else apply the §3 Q5 post-hoc remediation path) |
| V9 | Duplicate detection | `SELECT "txHash","logIndex","blockHash",count(*) FROM "RawTokenTransfer" WHERE "chainId"=369 AND "blockNumber" BETWEEN :start AND :end GROUP BY 1,2,3 HAVING count(*)>1;` and the analogous `dedupeKey` group-by on `"LedgerEntry"` | 0 rows both (schema unique indexes + deterministic IDs should make this impossible, fact 7 — the check is evidence, not hope) |
| V10 | Cursor extended | `SELECT "fromBlock","toBlock" FROM "SyncCursor" WHERE "walletId"=:walletId AND "chainId"=369 AND "sourceFamily"='TRANSFERS';` | Case A: `fromBlock = startBlock_k` and `toBlock` unchanged; Case B: `toBlock = endBlock_k` |
| V11 | Prisma health | `GET /api/debug/health` | healthy |
| V12 | SyncRun cleanup | `SELECT count(*) FROM "SyncRun" WHERE status IN ('PENDING','RUNNING');` | `0` |

---

## 8. Expected risks

| # | Risk | Mechanism | Mitigation |
|---|---|---|---|
| R1 | **RPC volume / wall-clock.** ≥1,000 `getBlock(includeTransactions)` calls per window regardless of tuning, plus receipts and getLogs sub-windows (fact 6). At `SYNC_MAX_WINDOW_SIZE=2` a window adds ~1,000 getLogs calls on top. Thousands of windows ⇒ millions of RPC calls, potentially days of runtime. | Code design | Tune `SYNC_MAX_WINDOW_SIZE` to the RPC tier before Window 1; use a private/local RPC endpoint; treat the backfill as a long-running operator campaign, not a single session. No code changes in this task's scope. |
| R2 | **Omitted `startBlock`.** One malformed request without `startBlock` on a cursor-less family scans from block 0 unbounded (fact 2). | Orchestrator default `0n` | Window template always includes both bounds; verify request JSON before submitting. |
| R3 | **Disconnected window silently uncounted.** A typo'd start block that doesn't touch the cursor range ingests fine but never registers in the cursor (fact 5), corrupting progress accounting. The mistaken window's raw + ledger writes happen anyway, and checkpoint materialization is full-wallet (fact 10), so out-of-order entries can shift balances/warnings before the cursor actually covers that range. | Cursor merge contiguity | V10 catches it immediately: cursor `fromBlock` must equal the window's `startBlock`. If V10 fails, re-run the *correct* adjacent window (idempotent) — do not continue past it. The mistaken window's data needs no quarantine: if its pre-submit V8 gate was run, the entries are genuine chain evidence that later adjacent windows will legitimately cover (idempotent, fact 7). Until the cursor has caught up through the mistaken range, **suppress checkpoint trend conclusions** (§3 Q6 heuristic is void over that span). If the mistaken window was submitted WITHOUT its V8 pre-gate, run the V8 query over its range now and, on hits, apply the §3 Q5 post-hoc remediation path. |
| R4 | **Still-ACTIVE fabricated rows swept into normalization** in windows overlapping historical stake activity (§3 Q5). | ACTIVE-only read-back (fact 8) | V8 every window; STOP on hits; product-owner decision on identity-targeted repair. Explicitly NOT fixed unilaterally under this plan. |
| R5 | **Crashed run wedges the lock.** The pipeline runs in `after()`; a server restart mid-window leaves the SyncRun `RUNNING` forever, 409-ing all future windows (facts 3, 4). | Async execution | V12 + §4 step 4: manually mark the wedged run `FAILED`, verify cursor state (it only advances after persistence, so no gap), re-run the window. |
| R6 | **Provider topic-filter misbehavior** floods warnings (skipped unrelated logs) and, pre-#326, fabricated evidence. | Fact 8 | Filter now drops these at fetch time with warnings; V2 triages warning classes; count-only gating avoids the 200-detail truncation trap. |
| R7 | **Token metadata RPC amplification.** Deep-history windows discover tokens the DB has never seen; each costs metadata calls (`resolveTokenMetadata`, `src/services/sync/sync-common.ts:523+`). | Ingestion design | Expected and benign; budget for it in R1's rate planning. |
| R8 | **Head-adjacent reorgs.** Not a real risk for deep-historical windows; only relevant if Case B ascends to the chain head. | — | In Case B stop the final window ≥10 blocks below head. |
| R9 | **Residual negative balances after full backfill.** Possible legitimate causes: assets received via DEX/LP/STAKING flows outside TRANSFERS scope, or genuinely external evidence (e.g. bridged mints with nonstandard events). | Accounting truth | §9 requires each residual warning to be *explained* per asset, not zero-coerced or hidden. Follow-up scope decisions belong to the product owner. |

---

## 9. Overall success criteria (campaign completion)

All of the following, after the final window + final rebuild:

1. **Canonical balances reconcile:** for each previously-negative `assetId`, the ledger-derived
   balance is ≥ 0 and spot-checks against the PulseChain explorer balance for the wallet.
2. **Portfolio warnings:** `PortfolioMaterializationState` for the wallet shows zero
   `negative-token-balance` warnings, or every remaining warning has a written per-asset
   explanation (R9) accepted by the product owner.
3. **No missing transfer evidence:** TRANSFERS `SyncCursor` covers
   `[FIRST_ACTIVITY_BLOCK, CURSOR_TO]` contiguously; no SyncRun in the campaign is unaccounted.
4. **No duplicate evidence:** campaign-wide V9 queries over the full backfilled range return 0.
5. **Backend DTOs remain correct:** `GET /api/portfolio/dashboard`, `GET /api/transactions`,
   `GET /api/debug/status` respond with intact `schemaVersion`/provenance/freshness/status
   fields and no new error envelopes (contract untouched — this task changes no code).
6. **Materialization healthy:** final rebuild run `COMPLETED` with triaged warnings;
   `GET /api/debug/health` healthy; V12 clean.

---

## 10. Blocking inputs and final recommendation

The planning environment for this document verified it **cannot** reach the operator database
(Postgres down, Redis down, no Docker daemon) and **cannot** reach PulseChain
(explorer/RPC blocked by network policy). Therefore the four numeric inputs below are unfilled,
and per the task's own rule — *do not guess* — the recommendation is:

## → INVESTIGATION REQUIRED

| Input | Symbol | Source | Value |
|---|---|---|---|
| TRANSFERS cursor lower edge | `CURSOR_FROM` | Query I1b | **TBD** |
| TRANSFERS cursor upper edge | `CURSOR_TO` | Query I1b | **TBD** |
| Wallet first-activity block | `FIRST_ACTIVITY_BLOCK` | Explorer / RPC bisection + I2 cross-check | **TBD** |
| Expected window count | `W = ceil((CURSOR_FROM − FIRST_ACTIVITY_BLOCK)/1000)` | Derived | **TBD** |

Everything else — window formula, execution procedure, verification checklist, rebuild strategy,
risk register — is complete and requires no further code investigation. Once the four values are
filled in (one short operator session against the production environment), this plan converts to
**READY TO START TRANSFER BACKFILL** without structural changes, pending explicit product-owner
approval of Window 1.

No sync, rebuild, or repair was executed in the preparation of this plan.
