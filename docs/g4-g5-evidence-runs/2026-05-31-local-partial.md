# G4/G5 Evidence Run: 2026-05-31 Local Partial

## Purpose

This document records a real local G4/G5 backend evidence run.

It is documentation only. It does not change runtime behavior, schema, DTO contracts, route behavior, pricing/PnL/accounting logic, sync/rebuild behavior, workers, or frontend rendering.

## Run metadata

| Field | Value |
| --- | --- |
| Evidence run ID | `2026-05-31-local-partial` |
| Environment name | Local development |
| Commit SHA under test | Local `main` after #142/#143 were merged locally |
| Branch/ref under test | `main` |
| Operator | Are |
| UTC start time | 2026-05-31 18:27 UTC |
| UTC end time | 2026-05-31 20:23 UTC |
| Database target | Local Docker Postgres, redacted local dev only |
| Redis target | Local Docker Redis, redacted local dev only |
| RPC target | `http://localhost:8545` placeholder, not reachable |
| Test wallet address | `0x75f808367720951e789d47e9e9db51148d9aa765` |
| Chain ID | 369 |
| Notes / deviations | Partial local evidence run. Sync/rebuild not executed because local PulseChain RPC placeholder was unreachable. |

Security note: no secrets, private keys, seed phrases, database credentials beyond local compose defaults, Redis credentials, or RPC tokens were recorded.

## Setup evidence

Local setup required:

```bash
docker compose up -d
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/coinpulse"
export REDIS_URL="redis://localhost:6379"
export PULSECHAIN_RPC_URL="http://localhost:8545"
npm run validate:env
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Observed setup results:

- `docker compose ps` showed `coinpulse-postgres` healthy.
- `docker compose ps` showed `coinpulse-redis` healthy.
- `docker exec coinpulse-redis redis-cli ping` returned `PONG`.
- `npm run validate:env` returned `CoinPulse validation environment OK.`
- `npx prisma generate` generated Prisma Client successfully.
- `npm run db:seed` was required before wallet import because the local database otherwise lacked the PulseChain `Chain(369)` reference row.

## G4 evidence: wallet import -> sync -> materialize -> rebuild

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preflight env check | `npm run validate:env` | Required env vars present | `CoinPulse validation environment OK.` | 2026-05-31 | Console output | Pass | Required exports were set in the terminal running validation. |
| Prisma generate | `npx prisma generate` | Prisma Client generated | Prisma Client v7.8.0 generated successfully | 2026-05-31 | Console output | Pass | Required before route checks. |
| Local service health | `docker compose ps` | Postgres and Redis healthy | `coinpulse-postgres` and `coinpulse-redis` healthy | 2026-05-31 | Console output | Pass | Added by local compose setup. |
| Redis direct ping | `docker exec coinpulse-redis redis-cli ping` | `PONG` | `PONG` | 2026-05-31 | Console output | Pass | Confirmed Redis was reachable outside the app. |
| Debug health baseline | `GET /api/debug/health` | Safe health envelope; no secrets | `200 OK`; `database.status=ready`; `redis.status=ready` | 2026-05-31 20:05 UTC | Response excerpt | Pass | Required #142 Redis lazy-connect health fix. |
| Debug status baseline | `GET /api/debug/status` | Safe status envelope with operation state | `200 OK`; `status=ok`; no active blockers; no materialized wallets initially | 2026-05-31 20:08 UTC | Response excerpt | Pass | Warning about rebuild persistence remained expected. |
| Pricing status baseline | `GET /api/prices/status` | Versioned safe envelope | `200 OK`; `schemaVersion=v1`; top-level `status=unknown` | 2026-05-31 20:08 UTC | Response excerpt | Pass | G5 route functioning but no persisted observations. |
| Tracked wallets before import | `GET /api/wallets/tracked` | Versioned safe envelope, likely empty | `200 OK`; `schemaVersion=v1`; `wallets=[]` | 2026-05-31 20:09 UTC | Response excerpt | Pass | New local database state. |
| Wallet import submitted | `POST /api/wallets/import` | Success or documented idempotent existing-wallet envelope | Initially failed before seed with `Wallet_chainId_fkey`; after `npm run db:seed`, import succeeded | 2026-05-31 20:23 UTC | Response/check via tracked wallets | Pass after setup fix | Led to #143 docs update requiring `npm run db:seed`. |
| Tracked wallet confirmed | `GET /api/wallets/tracked` | Target wallet appears for chain 369 | `200 OK`; wallet `0x75f808367720951e789d47e9e9db51148d9aa765` appears with `chainId=369` and label `local-g4-evidence-test` | 2026-05-31 20:23 UTC | Response excerpt | Pass | Confirms import persisted local wallet. |
| RPC baseline | JSON-RPC `eth_chainId` to `http://localhost:8545` | Chain id response if RPC reachable | `curl: (7) Failed to connect to localhost port 8545` | 2026-05-31 | Console output | Fail / blocker | Local placeholder RPC was not running. |
| Manual sync submitted | `POST /api/sync/manual` | Accepted safe sync envelope | Not run | Not run | Not captured | Not run | Blocked by missing local PulseChain RPC. |
| Sync state observed | `GET /api/debug/status` | Sync/ingestion state updates visible | Not run | Not run | Not captured | Not run | Blocked by missing local PulseChain RPC. |
| Rebuild submitted | `POST /api/rebuild` | Accepted safe rebuild envelope | Not run | Not run | Not captured | Not run | Blocked by missing local PulseChain RPC / no sync data. |
| Materialization observed | Rebuild response and/or `GET /api/debug/status` | Materialization/rebuild state attributable to same run | Not run | Not run | Not captured | Not run | Blocked by missing local PulseChain RPC / no sync data. |
| Conflict attempted | Controlled overlap via sync/rebuild route | Safe conflict response or documented not safely executable | Not run | Not run | Not captured | Not run | Not attempted because sync/rebuild were blocked earlier. |
| Conflict envelope observed | Conflicting route response | Structured 409/operator-safe envelope where conflict applies | Not run | Not run | Not captured | Not run | Not attempted. |
| Internal detail leakage check | Failure/conflict envelopes | No stack traces, secrets, or internal exception internals in responses | Safe HTTP responses observed for health/status/pricing/wallet endpoints | 2026-05-31 | Response excerpts | Partial pass | Server logs contained Prisma details locally; HTTP envelopes remained safe. |

### G4 result

| Field | Value |
| --- | --- |
| G4 status | Partial |
| Completion claim allowed? | No |
| Required follow-up PRs | Provide reachable PulseChain RPC for local/staging evidence; then run manual sync, rebuild, materialization, and conflict checks. |
| Blocking issue links | None recorded. |
| Summary | Local DB/Redis/bootstrap/wallet import evidence passed after #141/#142/#143. G4 remains incomplete because manual sync/rebuild were not executed due to missing reachable local PulseChain RPC. |

## G5 evidence: persisted-pricing observability

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pricing status baseline | `GET /api/prices/status` | Versioned safe envelope | `200 OK`; `schemaVersion=v1`; `status=unknown` | 2026-05-31 20:08 UTC | Response excerpt | Pass | Route is reachable and safe. |
| Top-level status evidence | `GET /api/prices/status` | Top-level `status` is `ok`, `degraded`, or `unknown` | `status=unknown` | 2026-05-31 20:08 UTC | Response excerpt | Pass | Correctly reflects no observations. |
| Per-source status evidence | `GET /api/prices/status` | Per-source `status` is `ok`, `degraded`, `disabled`, or `unknown` where sources are present | `ONCHAIN_POOL`, `ONCHAIN_ROUTE`, `ORACLE`, `MANUAL` were `unknown`; `DEXSCREENER` was `disabled` | 2026-05-31 20:08 UTC | Response excerpt | Pass | Per-source DTO fields are visible. |
| Persisted observation evidence | Backend route response / redacted DB-derived status | Status reflects persisted pricing observations | No persisted observations present | 2026-05-31 20:08 UTC | `reason=no_observations` | Partial | Environment lacks representative persisted pricing observations. |
| Rejected observation evidence | `GET /api/prices/status` | `rejectedCount` recorded where present | `rejectedCount=0` for all sources | 2026-05-31 20:08 UTC | Response excerpt | Pass | No rejected observations in local empty DB. |
| Backend reason evidence | `GET /api/prices/status` | Backend-provided `reason` recorded where present | Enabled sources returned `reason=no_observations`; disabled source returned `reason=source_disabled` | 2026-05-31 20:08 UTC | Response excerpt | Pass | Matches current v1 DTO semantics. |
| Safe error envelope evidence | Route error path if safely testable | No internal details leaked | Not separately tested after DB/Redis ready | Not run | Not captured | Not run | Earlier unavailable DB/Redis run returned safe HTTP envelopes, but this run did not retest an intentional error path. |
| Frontend truth guard | Query/client review or UI artifact if present | Frontend does not infer pricing truth from symbols/external APIs | Not reviewed in this evidence run | Not run | Not captured | Not run | Requires separate review or artifact. |

### G5 result

| Field | Value |
| --- | --- |
| G5 status | Partial |
| Completion claim allowed? | No |
| Required follow-up PRs | Seed or ingest representative persisted pricing observations, then rerun G5 evidence. |
| Blocking issue links | None recorded. |
| Summary | `GET /api/prices/status` is reachable and returns the expected v1 safe DTO. G5 remains incomplete because the local environment has no representative persisted pricing observations. |

## Follow-up required

1. Provide a reachable PulseChain RPC URL for local/staging evidence.
2. Rerun `POST /api/sync/manual` with a bounded block range and record the response.
3. Observe sync state via `GET /api/debug/status`.
4. Run `POST /api/rebuild` only after sync evidence is available.
5. Capture materialization evidence.
6. Capture safe conflict behavior under a controlled overlap condition.
7. Add representative persisted pricing observations or use an environment that already has them, then rerun G5 evidence.

## Final status

This run improves backend readiness evidence but does not complete G4 or G5.

- G4: Partial.
- G5: Partial.
- Backend platform completion claim: not allowed from this run.
