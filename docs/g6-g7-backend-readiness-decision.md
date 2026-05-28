# G6/G7 Backend Readiness Decision

## Purpose

This document records the CoinPulse V1 backend readiness decision for the G6 and G7 gates.

It is documentation only. It does not add routes, change runtime behavior, modify Prisma schema, change DTO contracts, change pricing/PnL/accounting logic, change sync/rebuild behavior, add workers, or change frontend rendering.

## Decision summary

- G6 canonical transaction DTO is deferred from V1 backend platform completion per `docs/g6-v1-transactions-scope-decision.md`.
- G7 dashboard route normalization is deferred for V1 unless a later bounded PR implements a compatibility alias with contract tests.
- Backend platform readiness can proceed after G4/G5 production-like evidence is captured, while transaction-history product work remains blocked until canonical transaction DTO implementation exists.

## G6: canonical `GET /api/transactions`

### Current status

Status: deferred from V1 backend platform completion per `docs/g6-v1-transactions-scope-decision.md`.

Current state:

- `GET /api/transactions` does not exist.
- Transaction history is not required for the current V1 backend platform readiness phase.
- Transaction-facing product surfaces remain blocked until a canonical backend transaction DTO exists.

### Decision

Do not implement `GET /api/transactions` as part of V1 backend platform completion.

Rationale:

- A canonical transaction DTO is a real backend contract, not a documentation clean-up.
- It must be ledger-first and action-group aware.
- It must avoid frontend reconstruction from raw logs.
- It likely needs service-layer design, route handler implementation, client/query integration, and contract tests.
- Forcing it into the readiness phase would violate the bounded PR rule and increase regression risk.

### Required future implementation properties

A later G6 implementation PR should define a canonical transaction DTO from persisted backend truth only, before any transaction-history or transaction-derived product surface starts.

Expected DTO properties should include, at minimum:

- `schemaVersion`
- transaction identity such as `transactionId` or deterministic backend id
- `txHash`
- `chainId`
- `walletId`
- `walletAddress`
- `occurredAt`
- `blockNumber`
- action grouping metadata such as `actionGroupId`
- backend-classified `actionType`
- `sourceFamily`
- optional `protocol`
- ledger-derived entries
- pricing/valuation/PnL metadata only when backend truth supports it
- warnings/provenance/sync metadata

### G6 non-negotiables

The future route must not:

- reconstruct transactions in the frontend.
- expose raw logs as the UI transaction source of truth.
- identify assets by symbol/name/ticker.
- compute pricing, valuation, PnL, LP, or stake truth in the frontend.
- silently coerce unavailable, stale, unsupported, incomplete, or unpriced values to zero.
- invent transaction semantics from incomplete evidence.

### Required future tests

A future G6 implementation PR should include route-contract coverage for:

- versioned success envelope.
- empty result set.
- wallet/chain filtering if implemented.
- pagination or bounded result behavior if implemented.
- stable ordering.
- safe internal-error envelope.
- no internal exception leakage.
- DTO shape preserving unsupported/stale/unpriced/warning semantics where applicable.

## G7: dashboard route normalization

### Current status

Status: deferred for V1 per `docs/g6-g7-backend-readiness-decision.md`.

Current route:

- `GET /api/portfolio/dashboard`

Preferred long-term route:

- `GET /api/dashboard`

### Decision

Defer dashboard route normalization for V1 readiness.

Rationale:

- `GET /api/portfolio/dashboard` is already the current stable dashboard DTO route.
- Renaming or replacing it now would create unnecessary churn.
- Readiness does not require a route rename.
- A silent route rename would violate compatibility guardrails.
- Any future transition must be additive first.

### Required future compatibility strategy

If a later PR implements `GET /api/dashboard`, it must:

- keep `GET /api/portfolio/dashboard` working during a compatibility period.
- implement the new route as an additive alias or versioned transition.
- avoid silently changing the dashboard DTO shape.
- add contract tests proving both old and new routes work during the compatibility window.
- document deprecation timing before any old route removal.
- avoid frontend-only route truth or client-side DTO reshaping.

## Readiness impact

After these decisions:

- G4/G5 production-like evidence capture remains the only current blocker to declaring the V1 backend platform readiness phase complete.
- G6 remains a known future backend implementation gate, but not a V1 backend platform completion blocker.
- G7 is explicitly deferred for V1 readiness unless a later bounded compatibility-alias PR chooses to implement it.
- Backend platform work should not be blocked on route normalization alone.
- Transaction-history or transaction-derived product work remains blocked until a canonical `GET /api/transactions` backend DTO exists.

## Recommended next actions

1. Run and record G4/G5 evidence using `docs/g4-g5-backend-evidence-template.md`.
2. Re-run `docs/backend-platform-readiness.md` after G4/G5 evidence is captured.
3. If transaction-history or transaction-derived product surfaces become scope, create a dedicated G6 implementation PR for `GET /api/transactions` with contract tests before frontend work starts.
4. Keep dashboard route normalization deferred unless a compatibility alias becomes necessary.

## Final rule

These decisions must not be used as permission to build transaction, analytics, allocation, LP, or stake UI from raw logs or frontend reconstruction. Any future transaction-facing UI must wait for a canonical backend DTO contract.
