# CoinPulse V1 PnL Status and DTO Coverage Audit

## 1. Purpose

This document is a documentation-only audit of the current CoinPulse V1 PnL status model and dashboard DTO coverage. It records what the repository currently implements, what the dashboard DTO currently exposes, and where current coverage falls short of the PnL accounting guardrails before any additional PnL code or UI work begins.

This audit does not change PnL behavior. It does not modify source code, tests, package files, schema, routes, pricing logic, dashboard UI, or PnL calculations.


## 2. Milestone status

The completed PnL coverage slice records a documentation, contract, DTO, and UI-observability milestone without changing native PnL support, valuation behavior, pricing selection, or PnL formulas:

- PnL accounting guardrails are documented in `docs/pnl-accounting-guardrails.md`.
- Current PnL status and dashboard DTO coverage are audited in this document.
- Dashboard PnL behavior is protected by route-level contract tests for the supported status and warning cases.
- Route fixtures now use Prisma-shaped `actionGroup.actionType` data so fixture shape matches the backend route expectations.
- A `pnlCoverage` DTO plan exists in `docs/pnl-coverage-dto-plan.md`.
- `PortfolioDashboardDto` now includes additive, backend-computed `pnlCoverage` metadata.
- `pnlCoverage` summarizes existing dashboard PnL statuses, PnL warning codes, and unsupported LP/stake sentinel coverage already present in the dashboard response.
- Existing PnL values, pricing selection, warning generation, materialization freshness, and `ledgerCoverage` remain unchanged.
- The dashboard UI renders backend-computed `pnlCoverage` without adding frontend accounting, pricing, PnL, LP, or stake valuation inference.

`pnlCoverage` is metadata and observability only. It does not implement native PnL, change PnL formulas, alter valuation, select prices differently, mutate warning generation, replace `ledgerCoverage`, or make unsupported LP/stake PnL appear supported.

### Still intentionally deferred

The milestone intentionally leaves the following work out of scope:

- no native PnL implementation;
- no PnL formula changes;
- no pricing selection changes;
- no tax logic;
- no AI/risk benchmarking;
- no frontend PnL computation;
- no external provider integrations;
- no richer analytics UI beyond the current `pnlCoverage` indicator;
- no Ethereum/Base expansion.

### Recommended next V1 sequence

Recommended V1 follow-up work should remain data-quality-first and avoid jumping directly to richer PnL presentation:

1. Add a token identity/origin metadata plan.
2. Define a token metadata trust/source policy.
3. Plan bridge/source coverage if the current canonical ledger model can support it without weakening deterministic rebuildability or accounting identity.
4. Only later, plan native PnL once historical native price coverage, event-level provenance, and status contracts are explicit.
5. Only later, add richer analytics UI after backend DTOs can represent the required statuses, warnings, provenance, and coverage without frontend inference.

## 3. Current PnL architecture

Current PnL is backend-owned and assembled during portfolio dashboard DTO construction:

1. `GET /api/portfolio/dashboard` parses request input, resolves the tracked wallet, calls `assemblePortfolioDashboard()`, and returns `{ data: dashboard }`.
2. `assemblePortfolioDashboard()` reads materialized token balances, LP positions, stake positions, materialization state, ledger entries, and price observations through backend services and database clients.
3. Ledger rows are mapped to `PnLEntry` values with `entryType`, `actionType`, `direction`, `quantity`, `occurredAt`, `actionGroupId`, `txHash`, and `sourceLogKey`.
4. Token positions call `calculateAverageCostPnl()` once per token asset using the mapped ledger entries and the dashboard price resolver.
5. The average-cost engine calculates token-level holdings quantity, average cost, realized PnL, unrealized PnL, mark price, acquisition/disposition quantities, and `PnLWarning[]`.
6. `toPnlDto()` maps the engine result plus the token valuation status into `DashboardPnlDto`.
7. LP and stake positions do not use the average-cost engine in the dashboard path. They return explicit `unsupported` valuation and PnL sentinel DTOs.

The current average-cost/cost-basis module is `src/services/pnl/average-cost.ts`, with public PnL contracts in `src/services/pnl/types.ts`. It supports:

- acquisitions from target `RECEIVE` and `SWAP_IN` entries;
- dispositions from target `SEND` and `SWAP_OUT` entries;
- fee inclusion for non-target fee assets when those fees can be priced;
- realized PnL from proceeds minus non-target fee cost minus average cost of disposed quantity;
- unrealized PnL from mark price minus average cost times remaining holdings;
- warning records for missing mark prices, missing counter-asset prices, unsupported LP/stake action groups, unsupported action groups, and insufficient cost basis.

Current dashboard DTO fields expose PnL status and values only at the position level:

- token positions expose `pnl.status`, `holdingsQuantity`, `averageCost`, `realizedPnl`, `unrealizedPnl`, `markPrice`, `totalAcquiredQuantity`, `totalDisposedQuantity`, and `warnings`;
- LP and stake positions expose the same `pnl` shape, but all value fields are `null`, `status` is `unsupported`, and warnings use the `UNSUPPORTED_ACTION_GROUP` warning code with LP/stake-specific detail text;
- the summary exposes `warnings` containing `pnl-warning:<code>` entries when token PnL warnings are present;
- the summary does not expose aggregate realized PnL, aggregate unrealized PnL, net PnL, PnL percent, or ROI.

## 4. Current DTO coverage

### 4.1 Dashboard-level PnL-adjacent fields

| Field or section | Source module/service | Backend-computed? | Explicit status/warning/provenance? | Can be null/unknown? | Known limitations |
|---|---|---:|---|---:|---|
| `summary.totalValueQuote` | `assemblePortfolioDashboard()` using selected price observations | Yes | Status is separate in `summary.valuationStatus`; pricing provenance is position-level | Yes | Valuation total is not PnL. It includes only positions with `valueQuote`; LP/stake valuation is unsupported. |
| `summary.valuationStatus` | `assemblePortfolioDashboard()` | Yes | Yes: `available`, `partial`, `unavailable`, or a token valuation status such as `stale_price`/`low_confidence_price` | No | It is valuation status, not a dedicated PnL coverage status. |
| `summary.valuationCoverage` | `assemblePortfolioDashboard()` | Yes | Yes, via counts | No | Counts valued versus unvalued positions; does not explain PnL cost-basis coverage. |
| `summary.warnings` | `assemblePortfolioDashboard()` | Yes | Yes, string keys such as `pricing-unavailable:<assetId>:<status>` and `pnl-warning:<code>` | No | Warning keys are aggregate strings, not structured PnL coverage DTOs. |
| `ledgerCoverage` | `computeLedgerCoverage()` in dashboard assembly | Yes | Yes: `covered`, `partial`, or `unknown`, plus `reason` | Yes | Exposes materialization block-range coverage, but is not currently folded into `pnl.status`. |
| `materialization.freshness` | `computeMaterializationFreshness()` in dashboard assembly | Yes | Yes: `fresh`, `stale`, or `unknown`, plus reason and threshold | Yes | Materialization freshness is not currently mapped directly into PnL status. |

### 4.2 Token position pricing and valuation fields

| Field or section | Source module/service | Backend-computed? | Explicit status/warning/provenance? | Can be null/unknown? | Known limitations |
|---|---|---:|---|---:|---|
| `tokenPositions[].pricing.status` | `toPricingDto()` from `resolveBestPriceFromStore()` / `resolveBestPriceObservation()` | Yes | Yes: `available`, `stale_price`, `low_confidence_price`, or `unavailable` | No | `SOURCE_DISABLED` rejection currently becomes a rejected reason; status falls through to `unavailable` unless stale or low confidence is also present. |
| `tokenPositions[].pricing.sourceType` | selected persisted price observation | Yes | Yes, provenance when selected | Yes | Null when no acceptable observation is selected. |
| `tokenPositions[].pricing.sourceId` | selected persisted price observation | Yes | Yes, provenance when selected | Yes | Null when no acceptable observation is selected. |
| `tokenPositions[].pricing.confidence` | selected persisted price observation | Yes | Yes | Yes | Null when no acceptable observation is selected. |
| `tokenPositions[].pricing.observedAt` | selected persisted price observation | Yes | Yes, freshness timestamp when selected | Yes | Null when no acceptable observation is selected. |
| `tokenPositions[].pricing.staleAfterSeconds` | selected persisted price observation | Yes | Yes, freshness threshold when selected | Yes | Null when no acceptable observation is selected. |
| `tokenPositions[].pricing.rejectedReasons` | price resolver rejected observations | Yes | Yes: `STALE`, `LOW_CONFIDENCE`, `SOURCE_DISABLED` | No | Reasons are price-level, not PnL-specific warnings. |
| `tokenPositions[].valuation.status` | `toPricingDto()` status reused as valuation status | Yes | Yes | No | Valuation status is tied to mark-price availability; it is not cost-basis completeness. |
| `tokenPositions[].valuation.valueQuote` | balance quantity multiplied by selected price | Yes | Status is separate in `valuation.status`; price provenance is in `pricing` | Yes | Null if no selected available price; not a PnL field. |

### 4.3 Token position PnL fields

| Field or section | Source module/service | Backend-computed? | Explicit status/warning/provenance? | Can be null/unknown? | Known limitations |
|---|---|---:|---|---:|---|
| `tokenPositions[].pnl.status` | `toPnlDto()` from `AverageCostPnlResult` and valuation status | Yes | Yes: `available`, `unavailable`, `stale_price`, `low_confidence_price`, `incomplete_basis`, or `unsupported` | No | No separate status for `partial_history` or `source_disabled`; `available` may still depend on ledger completeness outside the PnL DTO. |
| `tokenPositions[].pnl.holdingsQuantity` | average-cost engine | Yes | Warning array may explain unsupported/incomplete inputs | No for token PnL result | Can differ from materialized balance if ledger inputs are incomplete or unsupported groups were skipped. |
| `tokenPositions[].pnl.averageCost` | average-cost engine | Yes | Warning array may include cost-basis issues | No for token PnL result | Average cost can be `0` when there are no tracked acquisitions or holdings; consumers must inspect warnings and coverage. |
| `tokenPositions[].pnl.realizedPnl` | average-cost engine | Yes | Warning array may include skipped disposals | No for token PnL result | Per-token quote-asset realized PnL only; no aggregate realized PnL DTO. |
| `tokenPositions[].pnl.unrealizedPnl` | average-cost engine | Yes | `MARK_PRICE_UNAVAILABLE` warning when mark price is missing/stale/low-confidence | Yes | Null when mark price cannot be selected; not exposed as native PnL. |
| `tokenPositions[].pnl.markPrice` | dashboard price resolver through average-cost engine | Yes | Price provenance is not embedded in the `pnl` object; price details are available in sibling `pricing` for the dashboard mark asset | Yes | Counter-asset prices used for historical events do not expose per-event provenance in the DTO. |
| `tokenPositions[].pnl.totalAcquiredQuantity` | average-cost engine | Yes | Warning array may explain skipped groups | No for token PnL result | Counts only supported acquisition groups processed by the engine. |
| `tokenPositions[].pnl.totalDisposedQuantity` | average-cost engine | Yes | Warning array may explain skipped groups | No for token PnL result | Counts only supported disposition groups processed by the engine. |
| `tokenPositions[].pnl.warnings` | average-cost engine | Yes | Yes: structured `PnLWarning[]` | No | Does not include ledger coverage, materialization freshness, or price `SOURCE_DISABLED` as first-class PnL status. |

### 4.4 LP and stake position PnL fields

| Field or section | Source module/service | Backend-computed? | Explicit status/warning/provenance? | Can be null/unknown? | Known limitations |
|---|---|---:|---|---:|---|
| `lpPositions[].valuation` | dashboard unsupported sentinel | Yes | Yes: `status: "unsupported"` | Yes, `valueQuote: null` | LP valuation is not implemented in the dashboard DTO path. |
| `lpPositions[].pnl` | `unsupportedPnl("LP position PnL is unsupported in this slice.")` | Yes | Yes: `status: "unsupported"`, `UNSUPPORTED_ACTION_GROUP` warning | Yes, all numeric fields are null | No LP PnL calculation or LP-specific status DTO exists. |
| `lpPositions[].warnings` | dashboard unsupported sentinel | Yes | Yes: `lp-valuation-unsupported-v1` | No | String warning is separate from `pnl.warnings`. |
| `stakePositions[].valuation` | dashboard unsupported sentinel | Yes | Yes: `status: "unsupported"` | Yes, `valueQuote: null` | Stake valuation is not implemented in the dashboard DTO path. |
| `stakePositions[].pnl` | `unsupportedPnl("Stake PnL is unsupported in this slice.")` | Yes | Yes: `status: "unsupported"`, `UNSUPPORTED_ACTION_GROUP` warning | Yes, all numeric fields are null | No stake PnL calculation or stake-specific status DTO exists. |
| `stakePositions[].warnings` | dashboard unsupported sentinel | Yes | Yes: `stake-valuation-unsupported-v1` | No | String warning is separate from `pnl.warnings`. |

## 4. PnL status mapping

The PnL guardrails define the status vocabulary `valued`, `unpriced`, `insufficient_cost_basis`, `unsupported`, `unknown`, `stale`, `partial_history`, and `source_disabled`. Current implementation uses `DashboardStatus` values and `PnLWarningCode` values rather than exposing that guardrail vocabulary verbatim.

| Guardrail status | Currently represented? | Where represented today | Future DTO/test gap if incomplete |
|---|---|---|---|
| `valued` | Partially | `pnl.status: "available"`; `pricing.status: "available"`; `valuation.status: "available"` | Add/verify contract tests proving that `available` PnL requires no PnL warnings, selected mark price, and sufficient cost basis. Consider an explicit PnL coverage/status DTO if guardrail terms should be surfaced directly. |
| `unpriced` | Partially | `MARK_PRICE_UNAVAILABLE` and `COUNTER_ASSET_PRICE_UNAVAILABLE` warnings; `pnl.status: "unavailable"`, `stale_price`, `low_confidence_price`, or `incomplete_basis`; `pricing.status: "unavailable"` | Distinguish mark-price unavailability from historical counter-asset price unavailability in structured DTO coverage. Add route/service tests for each warning-to-status path. |
| `insufficient_cost_basis` | Yes, under dashboard naming | `INSUFFICIENT_COST_BASIS` warning maps to `pnl.status: "incomplete_basis"` | Add contract coverage at route level so the dashboard DTO shape remains stable for insufficient basis scenarios. |
| `unsupported` | Yes | Average-cost engine emits `UNSUPPORTED_LP_ACTION`, `UNSUPPORTED_STAKE_ACTION`, or `UNSUPPORTED_ACTION_GROUP`; dashboard LP/stake DTOs return `pnl.status: "unsupported"` | Add tests that unsupported LP/stake dashboard sentinels and unsupported action-group token warnings remain explicit and are not shown as zero PnL. |
| `unknown` | Partially | Unclassifiable groups produce `UNSUPPORTED_ACTION_GROUP`; missing ledger coverage can produce `ledgerCoverage.status: "unknown"` | There is no dedicated `pnl.status: "unknown"`. If needed, add explicit PnL coverage status and tests separating unknown classification from unsupported actions. |
| `stale` | Partially | Price resolver rejects stale observations as `STALE`; `toPricingDto()` maps stale-only rejected prices to `pricing.status: "stale_price"`; `toPnlDto()` maps mark-price warning plus stale valuation status to `pnl.status: "stale_price"`; materialization freshness can be `stale` | Stale counter-asset historical prices and stale materialization/ledger state are not separately represented as PnL status. Add tests for stale price propagation to PnL warnings/status. |
| `partial_history` | Partially outside PnL | `ledgerCoverage.status: "partial"` when only one side of the persisted block range is present | `partial_history` is not folded into `pnl.status` or `pnl.warnings`. Add explicit PnL coverage/status DTO or warning if ledger coverage is partial. |
| `source_disabled` | Partially outside PnL | Price resolver rejects disallowed primary sources with `SOURCE_DISABLED`; `pricing.rejectedReasons` can include `SOURCE_DISABLED` | `toPricingDto()` does not map `SOURCE_DISABLED` to a distinct status, and `toPnlDto()` does not emit a source-disabled PnL warning. Add propagation tests before relying on this status in UI. |

## 6. Realized vs unrealized support

Based on current code:

- **Does the backend currently compute realized PnL?** Yes, for token assets processed by the average-cost engine. It computes `realizedPnl` for supported disposition groups when holdings quantity is sufficient and proceeds/fees can be priced.
- **Does the backend currently compute unrealized PnL?** Yes, for token assets when a mark price is selected. It returns `unrealizedPnl: null` when mark price resolution fails.
- **Does the backend expose net PnL?** No. `DashboardPnlDto` and `AverageCostPnlResult` expose `realizedPnl` and `unrealizedPnl`, but no `netPnl` field is currently present.
- **Does the backend expose PnL percent / ROI?** No. There is no `pnlPercent`, `roi`, or equivalent field in the current dashboard PnL DTO.
- **What preconditions are required?** Current token PnL requires ledger entries for the wallet/chain, supported action groups, sufficient tracked holdings for dispositions, resolvable historical counter-asset and fee prices for acquisitions/dispositions, and a resolvable mark price for unrealized PnL.
- **What remains unsafe to claim?** It is unsafe to claim complete portfolio PnL, LP PnL, stake PnL, native-denominated PnL, tax-ready gains, aggregate net PnL, PnL percent/ROI, or guaranteed correctness under incomplete ledger history. Current DTOs expose warnings and nulls for several gaps, but they do not yet provide a complete PnL coverage contract for all guardrail statuses.

## 7. Native PnL support

Native PnL is not implemented in the current dashboard PnL DTO or average-cost result. The current PnL fields are quote-asset fields using `quoteAsset` inputs such as `fiat:usd`.

Native PnL is intentionally deferred. Future implementation must first provide:

- historical PLS/native price observations aligned to ledger event timestamps;
- event-level cost basis coverage for acquisitions, disposals, proceeds, and fees;
- provenance, freshness, confidence, warning, and status exposure for each native-price observation and any derived native-denominated PnL output.

Until those preconditions exist, native PnL should remain absent/null rather than inferred from a current spot price or computed in the frontend.

## 8. Known gaps and risks

The following gaps are supported by current code and documentation:

- **Incomplete ledger history risk:** Average-cost results depend on the ledger entries supplied to dashboard assembly. `ledgerCoverage` can be `partial` or `unknown`, but that coverage is not currently folded into `pnl.status`.
- **Insufficient cost basis warnings:** Dispositions that exceed tracked holdings emit `INSUFFICIENT_COST_BASIS` and are skipped, causing `pnl.status: "incomplete_basis"` in the dashboard mapping.
- **Unpriced assets:** Missing selected prices produce `pricing.status: "unavailable"`; PnL mark-price failures emit `MARK_PRICE_UNAVAILABLE` and leave `unrealizedPnl` and `markPrice` null.
- **Stale pricing observations:** Stale observations are rejected by the price resolver, can appear in `pricing.rejectedReasons`, and can map to `pricing.status`/`pnl.status` of `stale_price` for mark-price failures.
- **Unsupported LP/stake valuation:** LP and stake dashboard positions return explicit unsupported valuation and PnL sentinel DTOs.
- **Missing native PnL:** No current DTO exposes native-denominated realized, unrealized, net, percent, or ROI fields.
- **Partial history/coverage not fully mapped to PnL status:** `ledgerCoverage.status` is present at dashboard level, but `pnl.status` has no `partial_history` value and no dedicated coverage object.
- **Source-disabled pricing not fully mapped to PnL status:** `SOURCE_DISABLED` can appear in price rejected reasons, but current status mapping does not expose a dedicated source-disabled PnL status.
- **Historical price provenance gap:** The sibling `pricing` DTO exposes the selected mark-price provenance for the position. It does not expose per-event historical counter-asset or fee price provenance used inside average-cost calculations.

## 9. Recommended next implementation sequence

Keep future work small and ordered around data quality before richer analytics UI:

1. Add or verify PnL status contract tests for the current DTO fields, including `available`, `unavailable`, `stale_price`, `low_confidence_price`, `incomplete_basis`, and `unsupported` cases.
2. Add an explicit PnL coverage/status DTO if current `pnl.status`, `pnl.warnings`, `ledgerCoverage`, and `pricing.rejectedReasons` are not sufficient to represent the guardrail vocabulary without ambiguity.
3. Ensure pricing `stale` and `source_disabled` states propagate to PnL warnings/status where PnL depends on those observations.
4. Add a native PnL planning document before implementation, covering historical native price observations, event-level cost-basis coverage, provenance, freshness, and status contracts.
5. Only after the above, add richer analytics UI for aggregate PnL, net PnL, PnL percent/ROI, native-denominated views, or additional charting.

## 10. Non-goals

This audit explicitly does not include:

- code changes;
- test changes;
- schema changes;
- route changes;
- pricing logic changes;
- PnL calculation changes;
- dashboard UI changes;
- native PnL implementation;
- tax logic;
- AI/risk benchmarking.

## 11. Decision

Data quality and explicit status coverage come before richer PnL UI.

Unknown, unsupported, stale, unavailable, or null values are safer than misleading zero values. Future PnL work should preserve backend ownership of accounting truth and expand explicit status/coverage contracts before adding new presentation features.
