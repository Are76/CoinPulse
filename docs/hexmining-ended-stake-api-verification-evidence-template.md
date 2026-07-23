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

### Run 1

`PENDING OPERATOR EXECUTION` — executed via
`scripts/hexmining-ended-stake-api-verification.ts` against a real local server +
database (base URL value not recorded).

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| HTTP status | `PENDING OPERATOR EXECUTION` |
| Total observations | `PENDING OPERATOR EXECUTION` |
| Complete observations | `PENDING OPERATOR EXECUTION` |
| Incomplete observations | `PENDING OPERATOR EXECUTION` |
| **classification** | `PENDING OPERATOR EXECUTION` |

**Warnings/notes:** `PENDING OPERATOR EXECUTION`

**Final decision:** `PENDING OPERATOR EXECUTION`
