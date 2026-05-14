# CoinPulse V1 PnL Coverage DTO Plan

## 1. Purpose

This document plans a future additive PnL coverage/status DTO for the portfolio dashboard. The planned DTO is intended to make backend-computed PnL quality explicit at the dashboard-envelope level before any frontend indicator or richer analytics UI is added.

This PR is documentation only. It does not change source code, tests, package files, Prisma schema, migrations, runtime behavior, API responses, PnL formulas, pricing selection, or dashboard UI.

## 2. Why this is needed

The current dashboard PnL fields are contract-tested and expose per-position PnL values, statuses, warnings, and nulls. However, the current dashboard DTO does not yet expose one explicit coverage/status object that summarizes PnL quality across the sections that can display or withhold PnL.

CoinPulse needs that object so the backend can distinguish these states without frontend inference:

- valued PnL;
- unpriced positions;
- unsupported position types;
- insufficient cost basis;
- partial ledger history;
- stale pricing;
- disabled pricing sources.

The DTO should keep the existing architecture rule intact: frontend code consumes backend DTO/API contracts only and must not infer accounting, pricing, or PnL truth.

## 3. Current baseline

Current protected behavior, as of this documentation slice:

- The average-cost engine behavior is covered by deterministic PnL tests. The engine returns quote-asset `realizedPnl`, `unrealizedPnl`, `markPrice`, cost-basis quantities, and warning codes such as `MARK_PRICE_UNAVAILABLE`, `COUNTER_ASSET_PRICE_UNAVAILABLE`, `UNSUPPORTED_ACTION_GROUP`, and `INSUFFICIENT_COST_BASIS`.
- Dashboard service and route contract tests protect current PnL null/unavailable behavior, including the case where unpriced PnL stays unavailable instead of returning misleading zero values.
- Unpriced token positions do not become zero-valued PnL. Missing mark prices leave `unrealizedPnl` and `markPrice` as `null`, while pricing/valuation status communicates the availability problem.
- Unsupported LP and stake valuation remains explicit. LP and stake dashboard DTOs return `valuation.status: "unsupported"`, `valuation.valueQuote: null`, `pnl.status: "unsupported"`, null PnL amount fields, and unsupported warning sentinels.
- Materialization freshness and `ledgerCoverage` already exist separately on the dashboard envelope. They describe persisted materialization and block/source coverage, but they are not yet folded into a dedicated PnL coverage object.
- A pricing status surface exists separately from PnL coverage. Token positions include selected mark-price provenance and rejected price reasons; pricing status does not currently become a complete portfolio-level PnL quality contract.

## 4. Proposed additive DTO shape

Add a future backend-computed `pnlCoverage` field to `PortfolioDashboardDto`. The naming follows the existing dashboard DTO style that already uses `ledgerCoverage` and `valuationCoverage`.

Proposed shape:

```ts
pnlCoverage: {
  status: "valued" | "partial" | "unavailable" | "unsupported" | "unknown";
  reasons: Array<
    | "unpriced"
    | "insufficient_cost_basis"
    | "partial_history"
    | "stale_price"
    | "source_disabled"
    | "unsupported_position_type"
    | "missing_disposal_events"
    | "missing_native_price_history"
  >;
  affectedSections: Array<"summary" | "tokens" | "lpPositions" | "stakePositions">;
  pricedPositionsCount: number;
  unpricedPositionsCount: number;
  unsupportedPositionsCount: number;
  incompleteBasisPositionsCount: number;
  stalePricePositionsCount: number;
  sourceDisabledPositionsCount: number;
  asOf: string;
}
```

Implementation notes for a future PR:

- `asOf` should match the dashboard envelope `asOf` timestamp.
- Counts should be backend-computed from current DTO inputs, PnL warnings, pricing statuses, pricing rejection reasons, and ledger/materialization coverage; they should not require frontend recomputation.
- `affectedSections` should name dashboard sections whose PnL interpretation is affected, not every section that happens to exist.
- `missing_native_price_history` should remain unused until native-denominated PnL is planned and introduced; it is listed now so future native work has an explicit status vocabulary and does not infer native PnL from spot prices.
- `missing_disposal_events` should only be emitted when the backend can distinguish absent disposal coverage from an ordinary wallet with no disposals. Until then, use `unknown` or `partial_history` conservatively.

## 5. Status rules

Future implementation should use conservative status rules:

- `valued` only when all displayed PnL-capable positions are priced and have sufficient cost basis, no pricing source needed for PnL is disabled, and ledger coverage is sufficient for the supported PnL being displayed.
- `partial` when some displayed values are reliable and some are unavailable, stale, source-disabled, unsupported, or incomplete. For example, one priced token with complete basis plus one unpriced token should not collapse to `valued`.
- `unavailable` when PnL cannot be computed for supported position types, such as all token PnL being blocked by unpriced marks, insufficient basis, or missing required counter-asset/fee prices.
- `unsupported` when the portfolio contains only unsupported position types for PnL purposes, such as LP/stake-only portfolios under the current V1 unsupported sentinels.
- `unknown` when the backend lacks enough information to classify safely, including ambiguous materialization or ledger coverage states that cannot be mapped to a more specific PnL reason.
- `source_disabled` must never be treated as `valued`; a disabled source means the backend refused a candidate observation and must communicate degraded or unavailable PnL coverage if that observation was required.
- Missing data must not become zero. Nulls, explicit reasons, and non-`valued` statuses are safer than presenting zeros that look like real PnL.

## 6. Relationship to existing fields

The future `pnlCoverage` field should relate to existing dashboard fields as follows:

- **Current token position `pnl` fields:** `pnlCoverage` should summarize coverage across token `pnl.status`, nullable PnL amount fields, and `pnl.warnings`; it should not replace per-token PnL details.
- **Summary PnL fields:** The current summary is valuation-focused and warning-focused. If future aggregate PnL summary fields are added, they should depend on backend `pnlCoverage` rather than frontend interpretation.
- **LP/stake unsupported sentinels:** LP and stake `valuation.status: "unsupported"` and `pnl.status: "unsupported"` should map to `unsupported_position_type`, count toward `unsupportedPositionsCount`, and affect `lpPositions` or `stakePositions`.
- **`materialization.freshness`:** Freshness should remain the materialization state contract. `pnlCoverage` may use stale or unknown materialization as an input to `unknown` or `partial_history`, but it should not duplicate the full freshness DTO.
- **`ledgerCoverage`:** `ledgerCoverage.status: "partial"` or `"unknown"` should be considered when classifying PnL. A future implementation should not report `pnlCoverage.status: "valued"` for ledger-dependent PnL when ledger coverage is partial or unknown unless a narrower backend proof shows the displayed PnL window is complete.
- **Pricing status endpoint / pricing DTOs:** Pricing surfaces remain the source for price availability, selected observation provenance, staleness, confidence, and rejected reasons. `pnlCoverage` should summarize only the PnL impact of those pricing states.
- **Existing warnings:** `INSUFFICIENT_COST_BASIS` and dashboard `incomplete_basis` should map to `insufficient_cost_basis`; `MARK_PRICE_UNAVAILABLE` should map to `unpriced` unless pricing status/rejections prove `stale_price` or `source_disabled`; unsupported action warnings should map conservatively to `unsupported_position_type` or `unknown` based on context.

## 7. Contract test plan

Add tests before implementing the DTO. Future service and route contract tests should cover at least:

- all valued token positions produce `pnlCoverage.status: "valued"` with empty reasons and zero unpriced/unsupported/incomplete/stale/source-disabled counts;
- one unpriced token produces `pnlCoverage.status: "partial"` when another displayed PnL-capable position is valued, or `"unavailable"` when no supported PnL can be computed, with reason `unpriced`;
- insufficient cost basis produces reason `insufficient_cost_basis` and increments `incompleteBasisPositionsCount`;
- unsupported LP/stake-only portfolios produce `pnlCoverage.status: "unsupported"`, reason `unsupported_position_type`, and the correct affected section;
- stale price warnings or stale pricing statuses produce reason `stale_price` and increment `stalePricePositionsCount`;
- source-disabled price rejection that affects PnL produces reason `source_disabled`, increments `sourceDisabledPositionsCount`, and does not report `valued`;
- missing native price history produces reason `missing_native_price_history` only when native PnL is later introduced;
- no missing, stale, unsupported, source-disabled, or incomplete values are represented as misleading zero PnL.

## 8. Non-goals

This documentation slice does not include:

- code changes;
- DTO implementation;
- PnL formula changes;
- pricing selection changes;
- schema, Prisma, or migration changes;
- dashboard UI changes;
- native PnL implementation;
- tax logic;
- AI or risk benchmarking.

## 9. Recommended implementation sequence

Recommended future PR sequence:

1. Add a `pnlCoverage` type to the dashboard DTO as an additive contract field.
2. Compute `pnlCoverage` from existing dashboard DTO data, PnL warnings, pricing status/rejected reasons, materialization freshness, and `ledgerCoverage` without changing PnL formulas.
3. Add service-level and route-level contract tests for all status and reason mappings before relying on the field in UI.
4. Update frontend client/schema fixtures if the dashboard API client or test fixtures require an explicit schema update.
5. Render a small dashboard PnL coverage indicator that consumes the backend DTO without calculating accounting, pricing, or PnL in the frontend.
6. Only later, plan native-denominated PnL with historical native price observations, event-level provenance, and separate native coverage rules.

## 10. Decision

- Additive backend DTO first.
- UI second.
- Native PnL later.
- Unknown/unsupported is safer than misleading valuation.
