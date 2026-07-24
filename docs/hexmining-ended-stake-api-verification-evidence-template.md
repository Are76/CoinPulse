# HexMining Ended-Stake API Verification — Evidence Template

Fill this in from an **actual** operator run of
`scripts/hexmining-ended-stake-api-verification.ts` against a real local server +
database. Do not fabricate any value. Every field must come from the run's JSON
report. Leave a field as `PENDING OPERATOR EXECUTION` until it is filled from a
real run.

Record only: run date/time, chain id, wallet, observation counts, the
verification booleans, and the overall classification. Do **not** record secrets,
`DATABASE_URL`, `OPERATOR_RUNNER_BASE_URL`, the base URL value, raw stakeShares
dumps, or full observation structs.

## Blank template

### Run metadata

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| HTTP status | `PENDING OPERATOR EXECUTION` |
| Total observations | `PENDING OPERATOR EXECUTION` |
| Complete observations | `PENDING OPERATOR EXECUTION` |
| Incomplete observations | `PENDING OPERATOR EXECUTION` |

### Checks

| Check | Result |
|---|---|
| API reachable (HTTP 200) | `PENDING OPERATOR EXECUTION` |
| envelope shape valid | `PENDING OPERATOR EXECUTION` |
| all scoped to requested chain | `PENDING OPERATOR EXECUTION` |
| all scoped to requested wallet | `PENDING OPERATOR EXECUTION` |
| every complete has lockedDay | `PENDING OPERATOR EXECUTION` |
| every complete has digit-only stakeShares | `PENDING OPERATOR EXECUTION` |
| every incomplete has warning | `PENDING OPERATOR EXECUTION` |
| stakeShares always string or null | `PENDING OPERATOR EXECUTION` |
| no duplicate observation identities | `PENDING OPERATOR EXECUTION` |
| **classification** | `PENDING OPERATOR EXECUTION` |

### Discovered issues

`PENDING OPERATOR EXECUTION` — if a defect appears, record observed vs. expected
and the report JSON here, then STOP (do not fix in the verification PR).

### Final decision

`PENDING OPERATOR EXECUTION` — PASS only when `classification` is `PASS` from a
real run and no defect was observed. WARN means reachable but partial/no
evidence; FAIL means a hard integrity check failed.

---

## Recorded runs

All runs below were executed via
`scripts/hexmining-ended-stake-api-verification.ts` against a real local server +
database (base URL value not recorded). Values are taken verbatim from the
operator evidence JSONL
(`operator-evidence/hexmining-ended-stake-api-verification/ended-stake-api-verification-evidence.jsonl`).
The report JSON contains no timestamp field; dates below come from the evidence
file's modification timestamps, not from the reports themselves.

### Runs 1–2 — pre-discovery (WARN, superseded)

Two early runs returned HTTP 200 with **0 observations** for the wallet
(`classification: WARN` — honestly reported as "not proof of successful
ended-stake ingestion"). All integrity checks held. Superseded by the runs below.

### Run 3 — post-discovery, pre-recovery (WARN, superseded)

HTTP 200, 9 observations, 0 complete / 9 incomplete (`classification: WARN` —
"9 observation(s) are legitimately incomplete (partial START evidence)"). All
integrity checks held; every incomplete observation carried its warning.
Superseded by Run 4 after historical-state recovery.

### Run 4 — post-recovery (final, PASS)

| Field | Value |
|---|---|
| Date (UTC) | 2026-07-24 (from evidence file timestamp; report JSON has no date field) |
| Chain id | `369` |
| Wallet | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| HTTP status | `200` |
| Total observations | `9` |
| Complete observations | `9` |
| Incomplete observations | `0` |
| API reachable (HTTP 200) | `true` |
| envelope shape valid | `true` |
| all scoped to requested chain | `true` |
| all scoped to requested wallet | `true` |
| every complete has lockedDay | `true` |
| every complete has digit-only stakeShares | `true` |
| every incomplete has warning | `true` (vacuously — 0 incomplete) |
| stakeShares always string or null | `true` |
| no duplicate observation identities | `true` |
| **classification** | `PASS` |

**Warnings/notes:** none — `warnings: []`, `notes: []`.

**Discovered issues:** none.

**Final decision:** **PASS.** `classification` is `PASS` from a real run with no
defect observed. The persisted PostgreSQL observations reconcile with the shipped
`GET /api/hexmining/ended-stakes` contract (PostgreSQL ↔ API consistent), and the
bigint/string-safe contract held. This run followed the completed execute-mode
historical-state recovery — see
`docs/hexmining-ended-stake-historical-state-recovery-evidence-template.md`.
