# HexMining Ended-Stake Historical-State Recovery — Evidence Template

Fill this in from an **actual** operator run of
`scripts/hexmining-ended-stake-historical-state-recovery.ts` against a real local
database and PulseChain RPC endpoint. Do not fabricate any value. Every field
must come from the run's JSON report. Leave a field as
`PENDING OPERATOR EXECUTION` until it is filled from a real run.

Record only: run date/time, chain id, wallet, mode (dry-run/execute), per-category
counts, and the per-stake outcome status list (id + stakeId + status only). Do
**not** record secrets, `DATABASE_URL`, `PULSECHAIN_RPC_URL`, raw `stakeShares`
values as anything other than the exact digit string, or content from
`HEX Stake Analyzer.mhtml`.

## Blank template

### Run metadata

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| Mode | `PENDING OPERATOR EXECUTION` (dry-run / execute) |
| Scanned | `PENDING OPERATOR EXECUTION` |
| Planned | `PENDING OPERATOR EXECUTION` |
| Already complete | `PENDING OPERATOR EXECUTION` |
| Recovered (evidence found) | `PENDING OPERATOR EXECUTION` |
| Updated (execute only) | `PENDING OPERATOR EXECUTION` |
| No match | `PENDING OPERATOR EXECUTION` |
| Multiple match | `PENDING OPERATOR EXECUTION` |
| Concurrent matching completion | `PENDING OPERATOR EXECUTION` |
| Concurrent conflict | `PENDING OPERATOR EXECUTION` |
| State changed | `PENDING OPERATOR EXECUTION` |
| Observation missing | `PENDING OPERATOR EXECUTION` |
| RPC failures | `PENDING OPERATOR EXECUTION` |
| Validation failures | `PENDING OPERATOR EXECUTION` |
| Total failures | `PENDING OPERATOR EXECUTION` |
| Exit code | `PENDING OPERATOR EXECUTION` |

### Per-stake outcomes

| stakeId | id | status |
|---|---|---|
| `PENDING OPERATOR EXECUTION` | | |

### Discovered issues

`PENDING OPERATOR EXECUTION` — if any outcome is not `already_complete`,
`would_update`, or `updated`, record the exact stakeId, status, and code here,
then STOP (do not fix reader/store/discovery logic in the recovery PR).

### Final decision

`PENDING OPERATOR EXECUTION` — clean only when `totalFailures` is `0` from a real
dry-run AND the subsequent execute run, and the ended-stake API verification
runner (`scripts/hexmining-ended-stake-api-verification.ts`) reaches `PASS`
afterward.

---

## Recorded runs

Values below are taken verbatim from the operator evidence JSONL
(`operator-evidence/hexmining-ended-stake-historical-state-recovery/ended-stake-historical-state-recovery-evidence.jsonl`).
The report JSON contains no timestamp field; the date below comes from the
evidence file's modification timestamp, not from the reports themselves.

### Run 1 — dry-run

Executed via `scripts/hexmining-ended-stake-historical-state-recovery.ts`
(no `--execute`) against a real local database and PulseChain RPC (RPC URL value
not recorded).

| Field | Value |
|---|---|
| Date (UTC) | 2026-07-23 (from evidence file timestamp; report JSON has no date field) |
| Chain id | `369` |
| Wallet | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| Scanned / Planned / Recovered | `9` / `9` / `9` |
| Already complete / Updated | `0` / `0` (dry-run — all 9 `would_update`) |
| No match / Multiple match | `0` / `0` |
| Concurrent matching completion / conflict | `0` / `0` |
| State changed / Observation missing | `0` / `0` |
| RPC failures / Validation failures | `0` / `0` |
| Total failures | `0` |

**Notes:** all 9 outcomes `would_update`; stakeIds 507128, 823259, 823260,
829821, 655741, 915997, 932004, 809011, 800372.

### Run 2 — execute

Executed via `scripts/hexmining-ended-stake-historical-state-recovery.ts
--execute` against a real local database and PulseChain RPC (RPC URL value not
recorded).

| Field | Value |
|---|---|
| Date (UTC) | 2026-07-23 (from evidence file timestamp; report JSON has no date field) |
| Chain id | `369` |
| Wallet | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| Scanned / Planned / Recovered | `9` / `9` / `9` |
| Updated | `9` |
| Total failures | `0` |

**Notes:** all 9 outcomes `updated` (same 9 stakeIds as the dry-run). All 9
observations carry recovery provenance (`evidenceRecoveryMethod` present). No
incomplete observations remain; no additional recovery execution is required.

**Discovered issues:** none — every outcome was `would_update` (dry-run) or
`updated` (execute).

**Final decision:** **Clean.** `totalFailures` is `0` for both the real dry-run
and the subsequent execute run, and the ended-stake API verification runner
subsequently reached `PASS` (see
`docs/hexmining-ended-stake-api-verification-evidence-template.md`, Run 4).
Execute-mode recovery is **complete**; 9/9 observations recovered.
