# HexMining Native Active-Stake Live Verification — Evidence Template

Fill this in from an **actual** operator run of
`scripts/hexmining-native-stake-live-verification.ts` against real PulseChain
data. Do not fabricate any value. Every field must come from the run's JSON
report. Leave a field as `PENDING OPERATOR EXECUTION` until it is filled from a
real run.

Record only: run date/time, chain id, `observedAtBlock`, wallet, `stakeCount`,
the verification booleans, and the overall status. Do **not** record secrets,
`DATABASE_URL`, `PULSECHAIN_RPC_URL`, raw payload dumps, or full stake structs.

## Blank template

### Run metadata

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Wallet | `PENDING OPERATOR EXECUTION` |
| `observedAtBlock` | `PENDING OPERATOR EXECUTION` |
| `stakeCount` | `PENDING OPERATOR EXECUTION` |
| `enumeratedCount` | `PENDING OPERATOR EXECUTION` |

### Checks

| Check | Result |
|---|---|
| stakeCount matches enumerated count | `PENDING OPERATOR EXECUTION` |
| every stake has stakeId | `PENDING OPERATOR EXECUTION` |
| every stake has stakeShares | `PENDING OPERATOR EXECUTION` |
| every stake has stakeHearts | `PENDING OPERATOR EXECUTION` |
| every stake has lockedDay | `PENDING OPERATOR EXECUTION` |
| every stake has stakedDays | `PENDING OPERATOR EXECUTION` |
| no duplicate stakeIds | `PENDING OPERATOR EXECUTION` |
| all reads from one captured block | `PENDING OPERATOR EXECUTION` |
| **allChecksPassed** | `PENDING OPERATOR EXECUTION` |

### Discovered issues

`PENDING OPERATOR EXECUTION` — if a defect appears, record observed vs. expected
and the report JSON here, then STOP (do not fix in the verification PR).

### Final decision

`PENDING OPERATOR EXECUTION` — PASS only when `allChecksPassed` is `true` from a
real run and no defect was observed.

---

## Recorded runs

### Run 1

Executed via `scripts/hexmining-native-stake-live-verification.ts` against a real
PulseChain RPC endpoint (endpoint value not recorded). Exit code `0`.

| Field | Value |
|---|---|
| Date (UTC) | `2026-07-04T01:49Z` |
| Chain id | `369` |
| Wallet | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| `observedAtBlock` | `26944376` |
| `stakeCount` | `32` |
| `enumeratedCount` | `32` |

| Check | Result |
|---|---|
| stakeCount matches enumerated count | `true` |
| every stake has stakeId | `true` |
| every stake has stakeShares | `true` |
| every stake has stakeHearts | `true` |
| every stake has lockedDay | `true` |
| every stake has stakedDays | `true` |
| no duplicate stakeIds | `true` |
| all reads from one captured block | `true` |
| **allChecksPassed** | `true` |

**Warnings:** none.

**Final decision:** PASS — all presence/consistency checks passed for 32 native
HEX stakes read from a single block (`26944376`). No defect observed. No
financial value was compared; stake values were recorded for presence only.
