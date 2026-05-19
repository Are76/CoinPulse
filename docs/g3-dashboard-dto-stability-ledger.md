# G3 Dashboard DTO Stability Ledger

## 1) Scope

This is a **documentation-only** checkpoint for G3 dashboard DTO stability.

This checkpoint does **not**:
- create an internal template folder,
- create an external data-fetching repository,
- extract reusable code,
- implement Portfolio Intelligence,
- implement Break-Even Scenarios,
- add AI/provider integrations,
- or change runtime behavior.

It also does not change source code, tests, schema, API routes, UI, query hooks, template folders, or pricing/PnL/accounting semantics.

## 2) G3 requirement

G3 gate (restated): the dashboard DTO must remain stable through several PRs, and the versioned dashboard route, DTO shape, query key, and frontend rendering contract must avoid structural changes across the required dashboard-touching PR window.

Primary gate references:
- `docs/reusable-data-fetching-template-plan.md` (G3 definition)
- `docs/data-fetching-template-readiness-audit.md` (current G3 status + blocker language)

## 3) Current implementation evidence

### Backend route + DTO assembly evidence
- `app/api/portfolio/dashboard/route.ts` shows a versioned route flow: parse/validate input, resolve tracked wallet, call `assemblePortfolioDashboard`, and return `{ data: dashboard }` with stable error envelope handling.
- `src/services/dashboard/portfolio-dashboard.ts` assembles `PortfolioDashboardDto` from backend persisted state (token balances, LP/stake positions, materialization state, ledger entries, and pricing/PnL services).

### Frontend API/query/render contract evidence
- `src/lib/api/dashboard-client.ts` fetches `/api/portfolio/dashboard` and returns DTO `data` with typed API error preservation.
- `src/lib/query/use-dashboard-query.ts` uses a stable dashboard key structure and hard-codes `DASHBOARD_SCHEMA_VERSION = "v1"`.
- `src/lib/query/query-keys.ts` keeps `queryKeys.dashboard(...)` shape as tuple `["dashboard", schemaVersion, chainId, normalizedWalletAddress, quoteAsset, asOfOrLatest]`.
- `src/components/dashboard/dashboard-screen.tsx` calls `useDashboardQuery(...)` and renders DTO fields directly into presenter sections without frontend accounting/pricing/PnL recomputation.
- `src/components/dashboard/dashboard-presenters.tsx` presents backend-provided statuses/warnings/provenance semantics.

### Test evidence protecting route/DTO/query/render stability
- `tests/api/portfolio-dashboard-route-contract.test.ts`
- `tests/api/portfolio-dashboard-route.test.ts`
- `tests/services/dashboard/portfolio-dashboard.test.ts`
- `tests/lib/use-dashboard-query.test.ts`
- `tests/components/dashboard-screen-wiring.test.ts`
- `tests/components/dashboard-token-metadata-provenance.test.tsx`

These tests collectively assert route contracts, query-key usage, DTO pass-through behavior, and non-inferential frontend rendering semantics.

### Documentation guardrail evidence
- `docs/dashboard-data-quality-audit.md`
- `docs/pnl-accounting-guardrails.md`
- `docs/v1-guardrail-milestone-checkpoint.md`
- `docs/g1-dashboard-wallet-selection-stability-checkpoint.md`
- `docs/g2-tracked-wallet-stability-checkpoint.md`
- `docs/data-fetching-template-readiness-audit.md`

These docs consistently reinforce backend-owned truth, DTO-first frontend constraints, and explicit readiness gates before any template extraction.

## 4) Stability ledger

Conservative ledger from currently documented repo evidence:

| Evidence item (doc/test/checkpoint) | DTO shape change indicated? | Test-only hardening? | Docs-only checkpointing? | Frontend rendering structural change indicated? | Query-key/hook structural change indicated? | G3 impact |
|---|---|---|---|---|---|---|
| `docs/data-fetching-template-readiness-audit.md` G3 row + blockers | No new change recorded in this checkpoint; status says shape is protected but explicit multi-PR ledger missing | No | Yes | No | No | **Supports** G3 implementation strength, but **does not close** G3 proof window |
| `tests/api/portfolio-dashboard-route-contract.test.ts` + `tests/api/portfolio-dashboard-route.test.ts` | No (contract asserts stable route envelope and dashboard DTO expectations) | Yes | No | No | No | **Supports** G3 |
| `tests/lib/use-dashboard-query.test.ts` | No (asserts stable dashboard query key usage and DTO pass-through) | Yes | No | No | No | **Supports** G3 |
| `tests/components/dashboard-screen-wiring.test.ts` | No (asserts wiring and no direct frontend fetch/inference regressions) | Yes | No | No structural redesign evidence in this test layer | No | **Supports** G3 |
| `tests/components/dashboard-token-metadata-provenance.test.tsx` | No (asserts metadata provenance rendering is backend-provided, no frontend synthesis) | Yes | No | No structural DTO contract change indicated | No | **Supports** G3 |
| `docs/g1-dashboard-wallet-selection-stability-checkpoint.md` | N/A to dashboard DTO shape directly | No | Yes | No | No | Indirectly supports readiness discipline, not direct G3 closure |
| `docs/g2-tracked-wallet-stability-checkpoint.md` | No dashboard DTO shape claim beyond recommending G3 checkpoint | No | Yes | No | No | **Supports** starting G3 ledger, but not full closure |

Notes:
- Exact PR-number sequencing for three consecutive dashboard-touching PRs without DTO shape change is **not fully reconstructible** from current in-repo evidence alone.
- Therefore this ledger intentionally references concrete docs/tests/checkpoints by file rather than inventing unverified PR facts.

## 5) Stability assessment

**G3 status: mostly met.**

Rationale:
- Implementation and tests for route/DTO/query/render contract are strong and explicit.
- But the audit-defined closure criterion requires an explicit multi-PR stability ledger (three consecutive dashboard-touching PRs without dashboard DTO shape change), and that full ledger is still incomplete.

## 6) Required evidence before full G3 closure

To mark G3 fully met, record and verify all of the following:

1. Three consecutive dashboard-touching PRs without dashboard DTO shape changes.
2. No `schemaVersion` changes for dashboard DTO (`"v1"` remains stable across the window).
3. No query-key shape changes for `queryKeys.dashboard(...)` across the same window.
4. No frontend inference added to dashboard rendering.
5. No pricing/PnL/accounting computation moved into frontend code.
6. Route contract tests remain stable for success/failure envelope behavior.
7. Dashboard warning/status/provenance semantics remain backend-owned.
8. Metadata provenance changes remain additive and do not replace pricing/PnL/status UI semantics.
9. Break-Even Scenarios and Portfolio Intelligence remain docs-only and do not alter dashboard DTO semantics.

## 7) Template readiness implication

G3 remains a blocker before:
- any internal template folder,
- any external data-fetching repository,
- any reusable code extraction.

This checkpoint does **not** claim template readiness. Current plan is preserved: no template folder, no external repo, and no extraction until G1-G8 gates are fully met.

## 8) Recommended next blocker

**Recommended next smallest safe blocker: G4 production-like sync -> materialize -> rebuild evidence.**

Reason (conservative): current audit explicitly marks G4 as partial with a specific missing production-like full-cycle evidence record, while G8 is already marked met for in-repo workflow usefulness and is primarily an externalization blocker for reusable copying/separation work.
