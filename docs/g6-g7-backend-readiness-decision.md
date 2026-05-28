# G6/G7 Backend Readiness Decision

## Purpose

This document records the CoinPulse V1 backend readiness decision for the remaining G6 and G7 gates.

It is documentation only. It does not add routes, change runtime behavior, modify Prisma schema, change DTO contracts, change pricing/PnL/accounting logic, change sync/rebuild behavior, add workers, or change frontend rendering.

## Decision summary

- G6 canonical transaction DTO remains not complete and should not be squeezed into a broad readiness PR.
- G7 dashboard route normalization should be explicitly deferred for V1 unless a later bounded PR implements a compatibility alias with contract tests.
- Backend platform readiness must remain honest: the platform can be considered readiness-tracked, but not fully complete until G4/G5 evidence is captured and G6/G7 are implemented or explicitly deferred.

## G6: canonical `GET /api/transactions`

### Current status

Status: not complete.

Current gap:

- `GET /api/transactions` does not exist.

### Decision

Do not implement `GET /api/transactions` inside this readiness decision PR.

Rationale:

- A canonical transaction DTO is a real backend contract, not a documentation clean-up.
- It must be ledger-first and action-group aware.
- It must avoid frontend reconstruction from raw logs.
- It likely needs service-layer design, route handler implementation, client/query integration, and contract tests.
- Forcing it into this PR would violate the bounded PR rule and increase regression risk.

### Required future implementation properties

A later G6 implementation PR should define a canonical transaction DTO from persisted backend truth only.

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

Status: documented compatibility requirement; V1 route transition deferred unless explicitly implemented later.

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

After this decision:

- G6 remains a known future backend implementation gate.
- G7 is explicitly deferred for V1 readiness unless a later bounded compatibility-alias PR chooses to implement it.
- Backend platform work should not be blocked on route normalization alone.
- Backend platform completion still requires G4/G5 evidence capture and either G6 implementation or an explicit product decision that transaction history is post-V1.

## Recommended next actions

1. Run and record G4/G5 evidence using `docs/g4-g5-backend-evidence-template.md`.
2. Decide whether canonical transaction history is required for V1 backend completion or should be deferred post-V1.
3. If required for V1, create a dedicated G6 implementation PR for `GET /api/transactions` with contract tests.
4. Keep dashboard route normalization deferred unless a compatibility alias becomes necessary.
5. Update `docs/backend-platform-readiness.md` after the G4/G5 evidence and G6 product decision are settled.

## Final rule

This decision must not be used as permission to build transaction, analytics, allocation, LP, or stake UI from raw logs or frontend reconstruction. Any future transaction-facing UI must wait for a canonical backend DTO contract.
