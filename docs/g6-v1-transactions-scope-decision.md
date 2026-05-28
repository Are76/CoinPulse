# G6 Transactions V1 Scope Decision

## Purpose

This document records the CoinPulse V1 scope decision for G6 canonical transaction DTO work.

It is documentation only. It does not add `GET /api/transactions`, change runtime behavior, modify Prisma schema, change DTO contracts, change pricing/PnL/accounting logic, change sync/rebuild behavior, add workers, or change frontend rendering.

## Decision

`GET /api/transactions` is deferred from V1 backend platform completion.

CoinPulse V1 backend platform completion does not require a transaction-history API route as long as V1 remains focused on dashboard/backend-readiness surfaces and does not ship transaction history, allocation drilldowns, LP detail pages, stake detail pages, or analytics pages that need canonical transaction lists.

## Rationale

A canonical transaction endpoint is real product/API surface area, not readiness cleanup.

Implementing it correctly requires a dedicated bounded implementation PR because the route must be:

- persisted-ledger-first.
- action-group aware.
- chain-aware.
- wallet-scoped.
- DTO-versioned.
- paginated or otherwise bounded.
- covered by route-contract tests.
- safe for unsupported, incomplete, unpriced, stale, warning, and provenance states.

Forcing this endpoint into the backend readiness cleanup phase would create unnecessary regression risk and could tempt frontend reconstruction from raw logs, which is explicitly forbidden.

## V1 implications

For V1:

- Dashboard/backend readiness can proceed without `GET /api/transactions`.
- `GET /api/portfolio/dashboard` remains the dashboard DTO route.
- Debug/health/status, wallet import, manual sync, rebuild, and prices status remain the relevant backend readiness surfaces.
- G4/G5 evidence collection remains the immediate backend readiness priority.
- Transaction history UI is out of scope until a canonical backend transaction DTO exists.

## Required future trigger

A dedicated G6 implementation PR becomes required before any of the following work starts:

- transaction history UI.
- transaction detail pages.
- allocation pages sourced from transaction history.
- analytics pages sourced from transaction history.
- LP detail pages requiring transaction timelines.
- stake detail pages requiring transaction timelines.
- export/reporting features based on transaction rows.
- frontend pages that would otherwise reconstruct actions from raw logs.

## Future G6 implementation guardrails

When implemented, `GET /api/transactions` must:

- use persisted canonical ledger/action-group truth only.
- expose versioned backend DTOs.
- preserve backend-provided uncertainty/warning/provenance states.
- avoid symbol/name/ticker as asset identity.
- avoid frontend pricing, valuation, PnL, LP, or stake calculations.
- avoid raw-log-as-UI-truth semantics.
- include route-contract coverage for success, empty result, bounded result/pagination behavior, filtering if supported, stable ordering, safe internal error envelope, and DTO shape guarantees.

## Readiness tracker update rule

After this decision is merged, update `docs/backend-platform-readiness.md` so G6 is no longer listed as an unresolved V1 backend platform blocker.

The tracker should instead state that G6 is deferred from V1 and becomes mandatory before transaction-history or transaction-derived product surfaces begin.

## Final rule

This deferral is not permission to build transaction-facing UI without backend truth. It only means transaction-history API implementation is not required to declare the current V1 backend platform readiness phase complete.
