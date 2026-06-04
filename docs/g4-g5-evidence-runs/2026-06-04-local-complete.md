# G4/G5 Evidence Run: 2026-06-04 Local Complete

## Purpose

This document records the completed G4/G5 backend evidence run for CoinPulse.

It is documentation only. It does not change runtime behavior, schema, DTO contracts, route behavior, pricing/PnL/accounting logic, workers, or frontend rendering.

## Run metadata

| Field | Value |
| --- | --- |
| Evidence run ID | `2026-06-04-local-complete` |
| Environment name | Local development |
| Commit SHA under test | `5085711037f18400a10057033d0673c72fd9dd29` (post-#155 main) |
| Branch/ref under test | `main` |
| Operator | Are |
| UTC start time | 2026-06-04 03:07 UTC |
| UTC end time | 2026-06-04 04:10 UTC |
| Database target | Local Docker Postgres |
| Redis target | Local Docker Redis |
| RPC target | `https://rpc.pulsechain.com` |
| Test wallet address | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| Chain ID | 369 |
| Notes / deviations | Three bugs discovered and fixed during this run. |

Security note: no secrets, private keys, seed phrases, database credentials beyond local compose defaults, Redis credentials, or RPC tokens were recorded.

## Bugs fixed during this run

1. **Non-ERC20 tokens crashing sync** — skip non-standard tokens instead of failing the entire sync run.
2. **Transfer amounts with out-of-range values crashing sync** — validate uint256 bounds before persisting.
3. **Database columns too narrow for uint256 values** — widened all `*Raw` amount columns from `NUMERIC(65,0)` to `NUMERIC(78,0)` via migration.

## G4 evidence: wallet import → sync → materialize → rebuild

| Item | Command / route | Expected result | Actual result | Timestamp UTC | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| Manual sync submitted | `POST /api/sync/manual` | Accepted sync envelope | `runId: cmpyz605o0000t45f9v79g35a` returned | 2026-06-04 ~04:10 UTC | Pass |
| Sync completed | `SyncRun` record | Status COMPLETED | Block 26698000, TRANSFERS source family completed | 2026-06-04 ~04:10 UTC | Pass |
| No internal details leaked | Sync response envelope | No stack traces or secrets | Safe envelope returned | 2026-06-04 | Pass |

### G4 result

| Field | Value |
| --- | --- |
| G4 status | **Partial** |
| Completion claim allowed? | No — rebuild/materialization evidence not yet captured |
| Summary | Real wallet sync ran and completed — `runId: cmpyz605o0000t45f9v79g35a`, block 26698000, TRANSFERS source family. Three bugs were fixed to reach this state. Rebuild and materialization steps were not executed in this run. |

## G5 evidence: persisted-pricing observability

| Item | Command / route | Expected result | Actual result | Timestamp UTC | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| Price ingest | `POST /api/prices/ingest` | `persistedCount > 0` | `fetchedCount: 2, persistedCount: 2, failedCount: 0` | 2026-06-04 ~04:10 UTC | Pass |
| Pricing status | `GET /api/prices/status?chainId=369` | `status: ok` | `status: ok`; `ONCHAIN_POOL: ok`; `ORACLE: ok` | 2026-06-04 04:10:29 UTC | Pass |
| Per-source status | `GET /api/prices/status` | Sources show real observations | `ONCHAIN_POOL` observationsCount: 1; `ORACLE` observationsCount: 1 | 2026-06-04 04:10:29 UTC | Pass |
| No rejected observations | `GET /api/prices/status` | `rejectedCount: 0` | `rejectedCount: 0` for all sources | 2026-06-04 04:10:29 UTC | Pass |
| DEXSCREENER disabled | `GET /api/prices/status` | `status: disabled` | `status: disabled`, `reason: source_disabled` | 2026-06-04 04:10:29 UTC | Pass |
| No internal details leaked | Price endpoints | No stack traces or secrets | Safe envelopes returned | 2026-06-04 | Pass |

### G5 result

| Field | Value |
| --- | --- |
| G5 status | **Complete** |
| Completion claim allowed? | Yes |
| Summary | `GET /api/prices/status` shows `ONCHAIN_POOL: ok` and `ORACLE: ok` with real persisted observations fetched from PulseX on-chain at block 26698687. |

## Final status

**G4: Partial** (sync evidenced; rebuild/materialization pending). **G5: Complete.**

G5 backend platform readiness gate is satisfied from this run. G4 requires rebuild/materialization evidence before it can be declared complete.
