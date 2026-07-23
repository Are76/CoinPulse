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

### Run 1 — dry-run

`PENDING OPERATOR EXECUTION` — executed via
`scripts/hexmining-ended-stake-historical-state-recovery.ts` (no `--execute`)
against a real local database and PulseChain RPC (RPC URL value not recorded).

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| Scanned / Planned / Recovered | `PENDING OPERATOR EXECUTION` |
| Total failures | `PENDING OPERATOR EXECUTION` |

**Notes:** `PENDING OPERATOR EXECUTION`

### Run 2 — execute

`PENDING OPERATOR EXECUTION` — executed via
`scripts/hexmining-ended-stake-historical-state-recovery.ts --execute` against a
real local database and PulseChain RPC (RPC URL value not recorded).

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| Updated | `PENDING OPERATOR EXECUTION` |
| Total failures | `PENDING OPERATOR EXECUTION` |

**Notes:** `PENDING OPERATOR EXECUTION`

**Final decision:** `PENDING OPERATOR EXECUTION`
