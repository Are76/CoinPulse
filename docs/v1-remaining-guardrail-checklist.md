# CoinPulse V1 Remaining Guardrail Checklist

## Purpose

This checklist reconciles the V1 guardrail docs with the current repository state after the dashboard data-quality, PnL coverage, token metadata provenance, pricing status, and TanStack Query slices. It is intentionally documentation-only and does not authorize source, test, schema, route, pricing, PnL, frontend, template extraction, or multi-chain execution work.

## Source docs reviewed

- `docs/dashboard-data-quality-audit.md`
- `docs/pnl-accounting-guardrails.md`
- `docs/pnl-status-coverage-audit.md`
- `docs/token-identity-origin-plan.md`
- `docs/token-metadata-provenance-plan.md`
- `docs/token-metadata-trust-source-policy.md`
- `docs/reusable-data-fetching-template-plan.md`
- `docs/frontend-query-standardization-audit.md`
- `docs/data-fetching-architecture.md`
- `docs/reusable-backend-template-plan.md`

## Current reconciliation notes

- The dashboard visibility milestone is complete: materialization freshness, ledger coverage, pricing source status, the pricing status debug page, dashboard link-out, and operator navigation exist as observability improvements only.
- PnL coverage is no longer only a planning topic: the dashboard DTO includes backend-computed `pnlCoverage`, route/service/component coverage exists for supported PnL status and warning cases, and unsupported LP/stake PnL remains explicit.
- Token metadata provenance is partially implemented: token dashboard rows expose backend-owned `metadataProvenance`, and the UI renders that DTO without inferring trust. This does not yet equal a full token identity/origin implementation.
- The token metadata trust/source policy now exists in `docs/token-metadata-trust-source-policy.md`; token identity/origin, bridge/source attribution, native/wrapped labels, and verified metadata work should reconcile to that policy before implementation.
- Frontend query standardization has moved beyond the original audit: shared query keys, `QueryProvider`, dashboard/debug/pricing read hooks, tracked-wallet reads, and operator mutation hooks exist. Treat the original frontend query audit findings that say TanStack Query is not wired in as stale historical notes.
- `GET /api/prices/status` exists and has a client/query/debug surface. Treat older reusable-template and PnL guardrail sequence items that describe this endpoint as future work as stale.
- Reusable template extraction has not started and remains gated. The existing template docs are plans, not approval to extract shared infrastructure.

## 1. Completed / no action needed

- [x] Keep frontend dashboard reads DTO-only and backend-truth-first; no frontend RPC, DexScreener truth, symbol identity, or frontend PnL/valuation computation is needed.
- [x] Preserve materialization freshness and provenance in the dashboard DTO and UI.
- [x] Preserve `ledgerCoverage` as backend-computed dashboard metadata.
- [x] Preserve pricing source status as a backend DTO exposed by `GET /api/prices/status` with a frontend client, query hook, and operator debug page.
- [x] Preserve PnL coverage as backend-computed observability metadata. `pnlCoverage` is not native PnL, does not change formulas, and does not make unsupported LP/stake PnL supported.
- [x] Preserve explicit unsupported LP/stake valuation and PnL sentinels.
- [x] Preserve token metadata provenance display as a pass-through of backend DTO state, not frontend trust inference.
- [x] Preserve same-symbol/different-contract separation by chain/address/asset ID.
- [x] Preserve the TanStack Query foundation that is already present: shared query keys, query provider, query hooks, mutation hooks, and invalidation behavior.

## 2. V1-next safe tasks

These are the safest implementation candidates because they are additive, contract-first, and do not require pricing/PnL formula changes.

- [x] Add or tighten PnL status contract tests for any warning/status combinations not explicitly asserted yet. Required gap areas include `INSUFFICIENT_COST_BASIS`, stale price PnL status, low-confidence price PnL status, disabled source PnL status, unsupported action-group propagation, and summary warning aggregation stability. (Covered: INSUFFICIENT_COST_BASIS, stale price, source-disabled, unsupported LP, and unsupported-action-group in `tests/api/portfolio-dashboard-route-contract.test.ts`; low-confidence price and summary warning deduplication in `tests/api/portfolio-dashboard-edge-status.test.ts`.)
- [x] Add token metadata provenance contract tests for stale/conflicting/unknown metadata behavior if not already covered by current route, service, and component tests. (Covered: stale and conflicting provenance contract assertions in `tests/api/portfolio-dashboard-route-contract.test.ts` by PR #265; unknown status was already covered in existing contract tests.)
- [x] Define a token metadata trust/source policy that distinguishes `unknown`, `observed`, `seeded`, `manual`, `verified`, `stale`, `conflict`, and `rejected` semantics before any stronger UI label or analytics dependency is added.
- [x] Add contract tests and policy mapping for token metadata status/source behavior for `unknown`, `stale`, and `conflict` before implementing origin classification or bridge/source attribution. (Covered: `unknown`, `stale`, and `conflict` status/source behavior by PR #265 route contracts and service-level tests.)
- [ ] Add `rejected` metadata route-level contract test before implementing origin classification or bridge/source attribution. (`rejected` is not currently reachable — it requires origin classification logic explicitly gated in §3. This item must remain open until that gate is lifted.)
- [x] Add backend-only metadata status computation for stale/conflicting metadata if persisted evidence is already available or can be added in a minimal additive slice. (Already implemented: `computeTokenMetadataStatus`, `isMetadataStale`, and `detectDecimalsConflict` exist in `src/services/dashboard/token-metadata-status.ts` with service-level unit tests and route-level contract coverage.)
- [x] Audit current dashboard, pricing, PnL, and materialization tests for symbol-as-identity regressions and add focused contract assertions where gaps remain. (Covered: `tests/services/pnl/average-cost.test.ts` asserts cost basis is keyed by `assetId`, not symbol — two tokens with identical symbol but different `assetId` keep separate cost basis entries; `tests/services/pricing/price-resolver.test.ts` asserts resolution by `chainId`+`assetId`, not symbol — same-symbol/different-contract observations are not cross-selected; `tests/services/portfolio/materialize-positions.test.ts` asserts that two distinct `assetId`s produce separate balance rows — materialization does not group by address prefix or any metadata field other than `assetId`. Note: the `TokenRecord` type used by materialization has no symbol field; symbol-vs-identity assertions where symbol metadata exists are covered by the `average-cost` and `price-resolver` tests above.)
- [x] Refresh stale planning docs or add status notes to them so reviewers do not mistake completed TanStack Query/pricing-status work for remaining work. (Done: status notes added to `docs/pnl-accounting-guardrails.md` §9 item 3, `docs/frontend-query-standardization-audit.md` banner, and `docs/reusable-backend-template-plan.md` C4/sequence/R4 — all three stale-doc locations now accurately reflect current implementation status.)

## 3. V1-adjacent but not immediate

These tasks may still belong near V1, but only after the V1-next contract and policy gaps above are closed.

- [ ] Add additive token identity DTO fields only if the current `assetId`, `assetAddress`, `chainId`, and `metadataProvenance` surfaces are insufficient for operators to inspect identity safely.
- [ ] Add origin classification as unknown-first backend metadata only after the trust/source policy mapping is covered. The first safe implementation should return `unknown` when evidence is missing, stale, conflicting, rejected, or unsupported.
- [ ] Add bridge/source attribution planning after token metadata trust policy and origin DTO shape are explicit. Attribution must be evidence-based, backend-owned, additive, and never inferred from symbol, name, stablecoin branding, route labels, or icons.
- [ ] Add per-asset pricing/metadata coverage diagnostics to pricing status only after source-health semantics remain stable and no UI has to infer coverage.
- [ ] Add canonical transactions DTO planning and contract tests if needed as the next reusable DTO surface.
- [ ] Define route-normalization compatibility strategy before renaming or duplicating routes such as `/api/portfolio/dashboard`.
- [ ] Portfolio Intelligence Layer is documented as a V1-adjacent future module in `docs/portfolio-intelligence-layer-plan.md` and must remain documentation-only until deterministic DTO/status/provenance prerequisites are complete.

## 4. V2 / research only

These are not V1 implementation tasks unless a later plan explicitly narrows prerequisites, DTO contracts, tests, and failure modes.

- [ ] Native-denominated PnL, including PLS-denominated PnL, because it requires historical native-asset price observations aligned to each PnL-impacting ledger event.
- [ ] Richer analytics UI beyond backend-provided statuses, warnings, provenance, and coverage.
- [ ] PnL percent, ROI, risk metrics, volatility-adjusted analytics, benchmarking, AI-generated PnL commentary, or projections.
- [ ] Full bridge classifier implementation across bridge families and chains.
- [ ] Reusable frontend/backend template extraction into a separate repository.
- [ ] Ethereum/Base or other multi-chain execution support.

## 5. Explicitly forbidden until prerequisites are met

- [ ] Do not add frontend accounting, pricing, PnL, LP valuation, stake valuation, native PnL, bridge classification, or metadata trust inference.
- [ ] Do not treat missing, unsupported, partial, stale, or unavailable values as zero.
- [ ] Do not use symbols, names, tickers, or stablecoin branding as accounting, pricing, bridge, cache, or analytics identity.
- [ ] Do not treat DexScreener, subgraphs, or frontend RPC reads as canonical truth.
- [ ] Do not add native PnL until historical native price coverage, event-level provenance, status contracts, and backend conversion semantics exist.
- [ ] Do not add bridge/source attribution until token identity, metadata trust/source policy, origin metadata shape, and evidence rules are explicit.
- [ ] Do not start reusable template extraction until the documented extraction gates are satisfied: stable DTOs through production-like cycles, failure-path contract tests for operator read routes, stable materialization provenance, exercised TanStack Query consumption, at least a second reusable DTO surface, and route compatibility strategy.
- [ ] Do not add Ethereum/Base execution until PulseChain V1 backend truth, identity, origin, pricing, and PnL guardrails are stable enough to generalize.

## Recommended next implementation PR

The next bounded implementation PR should be a test-only or contract-first slice: add token metadata trust/source policy mapping tests for unknown/stale/conflict/rejected metadata behavior and symbol-not-identity assertions before any origin implementation. PnL status contract tests for stale/low-confidence/disabled-source and insufficient-basis cases remain safe follow-up work. This is safer than origin, bridge, native PnL, or template extraction because it hardens current DTO contracts without changing accounting or UI behavior.
