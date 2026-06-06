# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

CoinPulse is a deterministic, PulseChain-first portfolio accounting engine. It is not a generic crypto dashboard. The goal is correctness, auditability, and rebuildability — not rapid feature expansion. PulseChain (chain ID 369) is the only execution target in V1.

## Commands

```bash
# Development
npm run dev              # Next.js dev server with Turbopack
docker compose up -d     # Start PostgreSQL 17 and Redis 7 (required for local dev)

# Verification — always run sequentially, never concurrently
npm run test
npm run lint
npm run typecheck
npm run build

# Run a single test file
npx vitest run tests/services/pnl/pnl.test.ts

# Database
npm run db:migrate       # Run migrations in dev (creates migration files)
npm run db:migrate:deploy  # Apply migrations in production
npm run db:generate      # Regenerate Prisma client
npm run db:seed          # Seed the database

# If schema or Prisma client types change, run before typecheck/build:
npx prisma generate
```

> **Critical:** Do not run `npm run typecheck` and `npm run build` concurrently — both touch Next.js generated state.

## Architecture: the truth stack

Every piece of data flows through this pipeline in order. Nothing skips a layer.

```
raw audit → canonical ledger → derived positions → pricing observations
  → PnL engine → backend DTOs → API routes → frontend UI
```

- **PostgreSQL** is the source of truth for all application data.
- **RPC** is upstream ingestion input only — never frontend truth.
- **Frontend** consumes versioned backend DTOs only. It never computes balances, prices, PnL, LP values, or stake values.

## Service boundaries (`src/services/`)

Each service owns one layer of the truth stack and must remain portable to a future queue/worker runtime:

| Service | Responsibility |
|---|---|
| `chains` | Chain config and metadata |
| `ingestion` | Raw RPC data ingestion (immutable audit evidence) |
| `normalization` | Convert raw audit data → canonical ledger entries |
| `pricing` | Persist and resolve price observations |
| `pnl` | Average-cost PnL assembly from canonical ledger + pricing |
| `portfolio` | Materialize derived position state from the ledger |
| `rebuild` | Full deterministic rebuild operations |
| `sync` | Incremental sync (transfer, DEX, LP, staking) |
| `operations` | SyncRun lifecycle, conflict detection, persisted state |
| `debug` | Operator diagnostics and observability |
| `rpc` | RPC abstraction layer |

## Non-negotiable architecture rules

- Never add frontend balance, price, PnL, LP value, or stake value calculations.
- Never make direct RPC calls from the frontend.
- Never use DexScreener as primary pricing truth. Use on-chain PulseChain reserve-derived pricing.
- Never use token symbol/name/ticker as asset accounting identity — use `chainId + tokenAddress` (`assetId` format: `chain:369:erc20:0x...`).
- Never coerce stale, unavailable, or unpriced values to zero. Keep them explicit with provenance and warnings.
- Never add mock production fallback portfolio data in DTOs.
- Never delete raw or ledger records (mark as REORGED, not deleted).
- Treat pDAI as volatile — never force pDAI to $1.
- Raw audit data is immutable evidence. Canonical ledger and derived state must remain deterministic and rebuildable.
- Spam/scam/dust assets are flagged or hidden from the UI, not deleted from raw/ledger truth.

## Database schema overview

The Prisma schema has distinct layers that mirror the truth stack:

- **Raw audit:** `RawBlock`, `RawTransaction`, `RawLog`, `RawTokenTransfer`, `RawDexSwap`, `RawLpAction`, `RawStakeAction`
- **Canonical ledger:** `LedgerActionGroup`, `LedgerEntry` — this is accounting truth
- **Derived/materialized state:** `PortfolioTokenBalance`, `PortfolioLpPosition`, `PortfolioStakePosition`, `PortfolioMaterializationState`
- **Pricing inputs:** `PriceObservation` — persisted, never recomputed on the fly
- **Operations:** `SyncRun`, `SyncCursor`, `RpcRequestLog`, `ReorgEvent`

After any schema change: run `npx prisma generate` before `npm run typecheck` or `npm run build`.

## Backend DTO contract style

All read DTOs must include:

- `schemaVersion` (e.g., `"v1"`) — additive changes within a version; breaking changes require a new version
- **Provenance fields:** pricing source, operation trigger, chain ID, wallet identity, source family
- **Freshness fields:** `asOf`, `observedAt`, `staleAfterSeconds`, `updatedAt`, block range fields
- **Explicit status separation:** `pricing.status`, `valuation.status`, `pnl.status` — never force missing values to zero
- **Partial valuation warnings:** `summary.warnings`, `summary.valuationCoverage`

## Frontend data fetching

- Use TanStack Query (`@tanstack/react-query`) for all reads via hooks in `src/lib/query/use-*.ts`.
- Use shared query keys from `src/lib/query/query-keys.ts`.
- Use existing API clients in `src/lib/api/`.
- Do not retry deterministic `ApiClientError` 4xx responses.
- Preserve and display backend-provided error messages verbatim.
- After `POST /api/sync/manual` or `POST /api/rebuild`, invalidate `["debug", "status"]` and `["debug", "health"]` — on success, failure, and 409 conflict alike.

## Operations and concurrency

- Sync and rebuild are persisted through `SyncRun` records — lifecycle, conflicts, warnings, and provenance all flow through these.
- `PENDING` and `RUNNING` are conservative active statuses.
- Rebuild must not overlap with unsafe sync/rebuild work. Manual sync must not run during active rebuild.
- Conflicts return explicit HTTP 409 with operator-safe details.
- Do not add Redis queues, cron jobs, or background workers unless a task explicitly asks for that architecture.

## Pages and API routes

**User-facing:**
- `/` — dashboard (`src/components/dashboard/dashboard-screen.tsx`) → `GET /api/portfolio/dashboard`
- `/transactions` — transaction history → `GET /api/transactions`

**Operator debug:**
- `/debug/sync` → `POST /api/sync/manual`, `POST /api/rebuild`
- `/debug/wallets/import` → `POST /api/wallets/import`
- `/debug/wallets/tracked` → `GET /api/wallets/tracked`
- `/debug/prices/status` → `GET /api/prices/status`

**Supporting read routes:** `GET /api/debug/health`, `GET /api/debug/status`

## Testing

- Framework: Vitest, environment: jsdom, setup: `tests/setup.ts`
- Tests live under `tests/` organized by module, mirroring `src/services/`
- Prefer: deterministic unit tests, operation lifecycle tests, route contract tests, DTO mapping tests
- Avoid: live RPC calls, external service dependencies (DexScreener, etc.), flaky timing-based tests

## Architecture reference docs

When a task touches data fetching, DTO design, or frontend query patterns, read:
- `docs/data-fetching-architecture.md` — definitive frontend data flow, query key conventions, staleTime/gcTime policy
- `docs/frontend-query-standardization-audit.md` — current migration state and query ownership per page
- `docs/reusable-backend-template-plan.md` — DTO contract style guide and backend discipline reference

## Branch and PR conventions

Branch naming: `feat/<bounded-slice>`, `fix/<bounded-fix>`, `refactor/<bounded-refactor>`, `docs/<bounded-doc-change>`, `test/<bounded-test-slice>`

Keep PRs narrow: do not mix schema changes, frontend changes, and infrastructure changes. Report all validation results (exact failures) before marking a PR merge-ready.
