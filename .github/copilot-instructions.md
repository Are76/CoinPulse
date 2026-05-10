# CoinPulse Copilot Repository Instructions

CoinPulse V1 is a deterministic, PulseChain-first portfolio accounting engine. It is not a generic crypto dashboard. Prioritize correctness, auditability, rebuildability, and conservative financial data handling over rapid feature expansion.

## Core architecture

Preserve this truth stack:

```text
raw audit -> canonical ledger -> derived positions -> pricing observations -> PnL engine -> dashboard DTO -> API routes -> UI
```

The PostgreSQL-backed ledger and derived state are the source of truth. RPC is only upstream input. The UI must never compute portfolio truth directly.

Required service boundaries:

- `src/services/chains`
- `src/services/ingestion`
- `src/services/normalization`
- `src/services/pricing`
- `src/services/pnl`
- `src/services/portfolio`
- `src/services/rebuild`
- `src/services/sync`
- `src/services/debug`
- `src/services/operations`

Keep modules isolated and worker-compatible. Milestone 1 may execute operations inline, but sync, rebuild, pricing, materialization, and operation lifecycle code must remain portable to a later queue/worker runtime.

## Non-negotiable rules

- Backend remains the source of truth.
- Frontend consumes DTO/API only.
- No frontend balance calculations.
- No frontend price calculations.
- No frontend PnL calculations.
- No direct RPC calls from frontend.
- No mock production fallback portfolio data.
- Do not coerce unavailable, stale, unsupported, incomplete, or unpriced values to zero.
- Preserve warnings, stale states, unsupported states, confidence, source, timestamps, and provenance.
- Asset identity is `chainId + tokenAddress`, or deterministic native asset identity. Never use symbol/name/logo/ticker as accounting identity.
- Raw chain data is immutable audit evidence. Canonical ledger and derived state must remain deterministic and rebuildable.
- Spam/scam/dust assets must not be deleted from raw or ledger truth; flag or hide them from default UI instead.
- Never use DexScreener as primary pricing truth. Prefer on-chain PulseChain reserve-derived pricing with confidence, liquidity, route, and freshness metadata.
- Treat pDAI as volatile. Never force pDAI to $1.
- Do not commit secrets. Never write real `DATABASE_URL` values into source files.

## Implementation discipline

Use bounded PRs. Each branch should implement one small, testable slice. Do not silently expand scope.

Preferred order of work:

1. Raw ingestion
2. Canonical ledger
3. Deterministic normalization
4. Pricing engine
5. Average-cost PnL
6. Derived-state materialization
7. Dashboard DTO assembly
8. Operator/debug observability
9. UI consumption and polish

Avoid broad UI expansion before backend truth and operation safety are correct.

## Operation and concurrency rules

Sync and rebuild operations are persisted through backend operation state. Use persisted `SyncRun`/operation records for lifecycle, conflict detection, warnings, errors, and provenance.

- Active statuses are conservative: `PENDING` and `RUNNING`.
- Rebuild must not overlap unsafe rebuild/sync work.
- Manual sync must not run during active rebuild.
- Conflict responses should be explicit HTTP 409 with operator-safe details.
- Do not add stale lock override behavior unless explicit, tested, and operator-visible.
- Do not add Redis, queues, cron, or workers unless a task explicitly asks for that architecture.

## Validation commands

Run verification sequentially, never concurrently:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

Do not run `npm run typecheck` and `npm run build` at the same time because both can touch Next.js generated state.

If schema or Prisma client behavior changes, also run:

```bash
npx prisma generate
```

## Package scripts

Current relevant scripts:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
npm run db:generate
npm run db:migrate
npm run db:seed
```

`build` and `typecheck` intentionally run Prisma generation. Vercel/production builds require a real hosted `DATABASE_URL` in environment variables. Do not use localhost database URLs in hosted environments.

## Review checklist before every commit

Confirm and report:

- Changed files
- Scope of change
- Schema/migration impact
- API response impact
- Architecture impact
- Tests added/updated
- Verification results
- No frontend financial logic added
- No direct frontend RPC added
- No mock production fallback data added
- Unavailable/stale/unsupported values remain explicit

If implementation conflicts with the architecture, stop and explain the conflict, tradeoff, risk, and safer alternative before changing direction.
