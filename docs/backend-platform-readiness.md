# CoinPulse Backend Platform Readiness Checklist

## Purpose

This document defines what it means for the CoinPulse V1 backend platform to be considered ready for the next phase of product work.

It is an audit/checklist only. It does not change runtime behavior, database schema, Prisma models, backend DTO contracts, pricing/PnL/accounting logic, sync/rebuild behavior, workers, routes, or frontend rendering.

## Source-of-truth model

Backend platform readiness is evaluated against the existing CoinPulse truth stack:

```text
raw audit -> deterministic normalization -> canonical ledger -> derived positions/state -> pricing observations -> backend-computed PnL/valuation output -> versioned DTOs -> API routes -> frontend
```

Readiness does not mean the frontend can compute truth. It means the backend surfaces are stable enough that the frontend and operator flows can consume backend DTOs without reconstructing accounting, pricing, valuation, LP, stake, or PnL truth.

## Backend platform readiness definition

CoinPulse V1 backend platform readiness means:

- PostgreSQL persisted state remains the source of truth.
- RPC remains ingestion input only.
- Deterministic normalization remains the only path from raw audit data into canonical ledger entries.
- Canonical ledger entries remain accounting truth.
- Derived portfolio state remains materialized from ledger truth.
- Versioned backend DTOs remain the only UI consumption contract.
- Operator routes return structured, safe envelopes for success, failure, and conflict cases.
- Environment validation is explicit enough that validation failures are not mistaken for product regressions.
- The remaining backend gaps are documented as bounded future PRs rather than hidden architectural uncertainty.

## Current completed foundation

The following foundation is already in place and should be preserved:

- `GET /api/portfolio/dashboard` exists as the current dashboard DTO route.
- `GET /api/debug/health` exists as an operator/debug health surface.
- `GET /api/debug/status` exists as an operator/debug status surface.
- `GET /api/prices/status` exists as the current persisted-pricing observability route with route-contract coverage.
- `POST /api/wallets/import` exists as a backend wallet import route.
- `POST /api/sync/manual` exists as the manual sync route.
- `POST /api/rebuild` exists as the rebuild route.
- Dashboard/debug frontend data access is moving through the TanStack Query foundation without changing backend DTO truth.
- Validation environment requirements are documented in `docs/validation-env-requirements.md`.
- `npm run validate:env` exists as an explicit environment preflight helper.
- GitHub Actions has a minimal validation environment preflight workflow.

## Required readiness gates

### G1. Runtime environment contract is explicit

Status: complete for current validation needs.

Required evidence:

- `DATABASE_URL`, `REDIS_URL`, and `PULSECHAIN_RPC_URL` are documented for validation.
- Missing env vars can be diagnosed before product code is blamed.
- CI includes a minimal validation preflight.

Notes:

- This does not prove live PostgreSQL, Redis, or RPC connectivity.
- Connectivity evidence belongs to a production-like operator run, not the preflight workflow.

### G2. Dashboard DTO contract remains backend-truth-only

Status: complete for current dashboard route, pending production-like evidence.

Required evidence:

- Dashboard reads `GET /api/portfolio/dashboard`.
- Dashboard does not compute balances, prices, valuation, LP values, stake values, or PnL locally.
- Dashboard preserves stale/unavailable/unsupported/incomplete states instead of coercing them to zero.

Remaining evidence needed:

- Full sync -> materialize -> dashboard observation in a production-like environment.

### G3. Operator status/health surfaces remain stable

Status: structurally present, pending production-like evidence.

Required evidence:

- `GET /api/debug/health` remains available.
- `GET /api/debug/status` remains available.
- Operation state surfaces expose sync/rebuild status, blockers, warnings, and diagnostics as backend DTO fields.

Remaining evidence needed:

- Manual operator run showing status transitions during sync/rebuild.
- Confirmation that failures remain operator-safe and do not leak internal exception details.

### G4. Wallet import -> sync -> materialize -> rebuild cycle is evidenced

Status: not complete until production-like evidence is captured.

Required evidence:

- Wallet import succeeds or returns a documented idempotent existing-wallet envelope.
- Manual sync can be submitted safely.
- Materialization/rebuild evidence is captured for the same wallet/chain/environment.
- Debug/status reflects the operation state transitions.
- Conflict behavior can be tested safely.
- Conflict/failure responses remain structured and operator-safe.

Reference checklists:

- `docs/g4-manual-operator-run-checklist.md`
- `docs/g4-g5-backend-evidence-template.md`

This is the largest remaining backend readiness gate.

### G5. Pricing observability is surfaced as a first-class backend DTO

Status: implemented for the current persisted-pricing observability route, pending production-like evidence.

Current foundation:

- `GET /api/prices/status` exists.
- Route-contract coverage exists in `tests/api/prices-status-route-contract.test.ts`.
- Current route coverage is tracked in `docs/route-contract-coverage-index.md`.

Evidence template:

- `docs/g4-g5-backend-evidence-template.md`

Why it matters:

- Pricing observations are part of the backend truth pipeline.
- Operators need a backend DTO surface for price freshness, coverage, confidence, rejected reasons, and stale/low-confidence status.
- The frontend must not infer pricing status from symbols, token lists, or external APIs.

Remaining evidence needed:

- Production-like validation that the route reflects persisted pricing status correctly for the target environment.
- Confirmation that the frontend consumes pricing status only through backend DTO/query contracts when a pricing-status UI surface is used.

### G6. Canonical transaction DTO is surfaced

Status: not complete.

Current gap:

- `GET /api/transactions` does not exist yet.

Why it matters:

- Future transaction history, analytics, allocation, DeFi detail, LP detail, and stake detail pages must be built from canonical backend DTOs.
- The frontend must not reconstruct transaction meaning from raw logs.

Recommended bounded PR:

- Add canonical `GET /api/transactions` backend DTO from persisted ledger/action-group truth with contract tests.

### G7. Compatibility strategy for route normalization exists

Status: deferred for V1 per `docs/g6-g7-backend-readiness-decision.md`.

Current state:

- Current dashboard route is `GET /api/portfolio/dashboard`.
- Long-term preferred route is `GET /api/dashboard`.
- The compatibility requirements are documented: compatibility period, additive alias or versioned transition, no silent rename, and dual-route contract tests during the transition.
- Route normalization is not required for V1 backend readiness.

Deferred implementation work:

- If a future PR implements `GET /api/dashboard`, it must add an alias/transition route without breaking `GET /api/portfolio/dashboard`.
- Add contract tests proving both old and new routes during the compatibility window.
- Document deprecation timing before any old route removal.

## Backend platform completion assessment

Current assessment: partially ready, not fully complete.

What is ready:

- Core truth model is documented, including deterministic normalization.
- Current dashboard/debug/wallet/sync/rebuild route surfaces exist.
- Current pricing-status route and contract coverage exist.
- DTO-first guardrails are explicit.
- Environment validation is now clearer and less likely to be misdiagnosed.
- Dashboard route-normalization compatibility requirements are documented and the route transition is deferred for V1.

What still blocks declaring the backend platform complete:

1. G4 production-like wallet import -> sync -> materialize -> rebuild evidence is not yet captured.
2. G5 pricing-status production-like evidence is not yet captured.
3. G6 canonical `GET /api/transactions` backend DTO is not implemented or explicitly deferred as post-V1.

## Recommended next bounded sequence

1. Complete G4/G5 evidence collection using `docs/g4-g5-backend-evidence-template.md`.
2. Add canonical `GET /api/transactions` DTO and contract tests if transaction history is required for V1, or explicitly defer it as post-V1.
3. Re-run this readiness checklist and update status.

## Non-goals before backend platform completion

Do not start these until the gates above are closed or explicitly deferred:

- broad analytics pages.
- allocation pages.
- LP/stake detail pages.
- cross-chain Ethereum/Base execution.
- frontend reconstruction of transactions from raw logs.
- frontend pricing/PnL/accounting computation.
- route renames without compatibility period.

## Final rule

Backend platform readiness must be proven by backend DTOs, route contracts, validation evidence, and operator-safe behavior. It must not be inferred from frontend screens looking correct.
