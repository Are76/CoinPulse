# CoinPulse V1 Dashboard Data Quality Audit

## 1. Purpose

This document maps the current state of dashboard data quality in CoinPulse V1 before further feature work begins. Its goal is to give a clear, code-anchored view of which fields in the `PortfolioDashboardDto` are fully reliable, which are explicitly partial or unsupported, and where known gaps remain. This audit supports deciding the next bounded V1 implementation slices.

**This PR does not change any behavior.** No source code, tests, schema, routes, or package files are modified.

---

## 2. Current Dashboard Data Flow

```
persisted state (PostgreSQL) / backend services
  → assemblePortfolioDashboard()
    → PortfolioDashboardDto
      → GET /api/portfolio/dashboard
        → fetchPortfolioDashboard() / useDashboardQuery
          → DashboardScreen presenters
```

Concretely:

1. `assemblePortfolioDashboard()` (`src/services/dashboard/portfolio-dashboard.ts`) reads `portfolioTokenBalance`, `portfolioLpPosition`, `portfolioStakePosition`, `portfolioMaterializationState`, `ledgerEntry`, and `priceObservation` tables from PostgreSQL.
2. It assembles the `PortfolioDashboardDto` (`src/services/dashboard/types.ts`) and returns it.
3. `GET /api/portfolio/dashboard` (`app/api/portfolio/dashboard/route.ts`) resolves the tracked wallet, calls the assembler, and returns `{ data: dashboard }`.
4. The frontend calls this route via `fetchPortfolioDashboard` (the API client) and caches the result in TanStack Query (`useDashboardQuery`, `src/lib/query/use-dashboard-query.ts`).
5. `DashboardScreen` (`src/components/dashboard/dashboard-screen.tsx`) renders the DTO through presenter components (`src/components/dashboard/dashboard-presenters.tsx`).

**Frontend guardrails enforced at every layer:**

- The frontend does not compute balances, prices, valuations, LP values, stake values, or PnL.
- The frontend does not call any RPC endpoint.
- The frontend does not use DexScreener.
- The frontend does not treat token symbols as accounting identity.
- The frontend renders backend DTO fields verbatim using existing shared presentation primitives (`EmptyState`, `ErrorState`, `LoadingState`, `WarningBanner`, `StatusBadge`, `ValueDisplay`, `TimestampLabel`).

---

## 3. Data Quality Categories

The following categories are used throughout this audit to classify each DTO field or section:

| Category | Meaning |
|---|---|
| **reliable/persisted** | Written to PostgreSQL during ingestion or materialization; read back deterministically. Content is as accurate as the last successful sync/materialize cycle. |
| **derived/materialized** | Computed from canonical ledger entries on demand during DTO assembly. Result depends on ledger completeness and pricing availability at `asOf`. |
| **diagnostic/provenance** | Metadata about data origin, lineage, or operational state. Accurate as far as persisted operation records reflect. |
| **unknown/unavailable** | Backend explicitly returns `null`, `status: "unavailable"`, or `status: "unsupported"` for this field. The frontend must not coerce these to zero. |
| **warning/error state** | Persisted or derived warning signals that indicate data quality problems the operator should investigate. |
| **not yet implemented** | The field or section is present in the DTO type, but the corresponding valuation, PnL, or pricing logic is not yet implemented; the DTO returns an explicit unsupported sentinel. |

---

## 4. Dashboard DTO Fields — Inventory

The `PortfolioDashboardDto` (`src/services/dashboard/types.ts`) contains the following top-level sections. All fields below match actual code; no fields are invented.

### 4.1 Envelope / identity fields

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"v1"` | Fixed string; incremented on breaking shape changes. |
| `wallet.id` | `string` | Persisted wallet DB record ID. |
| `wallet.address` | `string` | Persisted wallet address as stored. |
| `wallet.chainId` | `number` | Persisted chain ID. |
| `quoteAsset` | `string` | Caller-supplied quote asset; defaults to `"fiat:usd"`. |
| `asOf` | `string` (ISO 8601) | Caller-supplied or server-defaulted timestamp used as pricing `observedAt` reference. |

### 4.2 Materialization metadata (`materialization`)

| Field | Type | Notes |
|---|---|---|
| `status` | `"RUNNING" \| "FAILED" \| "COMPLETED" \| null` | Last known materialization run status; `null` if no run record exists. |
| `completedSuccessfully` | `boolean \| null` | Whether the last attempt succeeded; `null` if no record. |
| `lastAttemptedAt` | `string \| null` | ISO timestamp of last materialization attempt. |
| `latestMaterializedAt` | `string \| null` | ISO timestamp of the last successful materialization. |
| `updatedFromBlock` | `string \| null` | Block range of the last materialization run (from). |
| `updatedToBlock` | `string \| null` | Block range of the last materialization run (to). |
| `sourceLedgerFromBlock` | `string \| null` | Canonical ledger block range consumed by the last run (from). |
| `sourceLedgerToBlock` | `string \| null` | Canonical ledger block range consumed by the last run (to). |
| `warningCount` | `number` | Count of merged materialization warnings (persisted + derived). |
| `warnings` | `DashboardMaterializationWarningDto[]` | Merged list: `code` (`negative_token_balance` or `generic_persisted_warning`) + `message`. |
| `errorMessage` | `string \| null` | Last materialization error message; `null` if none. |
| `hasNegativeBalances` | `boolean` | True when any `portfolioTokenBalance` row has a negative `balanceQuantity`. |
| `negativeBalances` | `DashboardNegativeBalanceDto[]` | Per-asset negative balance details: `assetId`, `assetAddress`, `balanceQuantity`, `decimals`. |

### 4.3 Portfolio summary (`summary`)

| Field | Type | Notes |
|---|---|---|
| `totalValueQuote` | `string \| null` | Sum of valued token position values in quote asset; `null` if no positions are valued. |
| `valuationStatus` | `DashboardStatus` | `available`, `partial`, `unavailable`, or first token position's valuation status when all positions unvalued. |
| `valuationCoverage.totalPositions` | `number` | Total across token + LP + stake positions. |
| `valuationCoverage.valuedPositions` | `number` | Positions with a non-null `valueQuote`. |
| `valuationCoverage.unvaluedPositions` | `number` | `totalPositions - valuedPositions`. |
| `warnings` | `string[]` | Sorted set of summary-level warning keys: `pricing-unavailable:<assetId>:<status>`, `pnl-warning:<code>`. |

### 4.4 Token positions (`tokenPositions`)

Each `DashboardTokenPositionDto` includes:

| Field | Notes |
|---|---|
| `assetId` | Canonical asset identity (`chainId + tokenAddress` form). |
| `assetAddress` | Raw token contract address, or `null` for native assets. |
| `balanceQuantity` | Materialized balance from `portfolioTokenBalance` (string decimal). |
| `decimals` | Persisted token decimals, or `null`. |
| `updatedFromBlock` / `updatedToBlock` | Block range of the last balance materialization for this position. |
| `pricing.status` | `available`, `stale_price`, `low_confidence_price`, or `unavailable`. |
| `pricing.sourceType` | Source type of the selected price observation: `ONCHAIN_POOL`, `ONCHAIN_ROUTE`, `ORACLE`, `MANUAL`, or `DEXSCREENER`. |
| `pricing.sourceId` | Identifier of the price source (e.g. pool pair address). |
| `pricing.confidence` | Numeric confidence string of the selected observation, or `null`. |
| `pricing.observedAt` | ISO timestamp of the selected price observation, or `null`. |
| `pricing.staleAfterSeconds` | Staleness window of the selected observation, or `null`. |
| `pricing.rejectedReasons` | List of rejection reason strings for observations that were considered but rejected (`STALE`, `LOW_CONFIDENCE`, `SOURCE_DISABLED`). |
| `valuation.status` | Same as `pricing.status`. |
| `valuation.valueQuote` | Computed `balanceQuantity × price` (string decimal), or `null` when pricing is unavailable. |
| `pnl.status` | `available`, `unavailable`, `stale_price`, `low_confidence_price`, `incomplete_basis`, or `unsupported`. |
| `pnl.holdingsQuantity` | PnL engine's computed holdings quantity. |
| `pnl.averageCost` | Average cost basis per unit in quote asset. |
| `pnl.realizedPnl` | Realized PnL in quote asset. |
| `pnl.unrealizedPnl` | Unrealized PnL in quote asset, or `null` when mark price is unavailable. |
| `pnl.markPrice` | Mark price used for unrealized PnL, or `null`. |
| `pnl.totalAcquiredQuantity` | Total quantity acquired across all ledger entries. |
| `pnl.totalDisposedQuantity` | Total quantity disposed across all ledger entries. |
| `pnl.warnings` | PnL-level warnings: `MARK_PRICE_UNAVAILABLE`, `COUNTER_ASSET_PRICE_UNAVAILABLE`, `UNSUPPORTED_LP_ACTION`, `UNSUPPORTED_STAKE_ACTION`, `UNSUPPORTED_ACTION_GROUP`, `INSUFFICIENT_COST_BASIS`. |

### 4.5 LP positions (`lpPositions`)

Each `DashboardLpPositionDto` includes:

| Field | Notes |
|---|---|
| `lpAssetId` | Canonical LP token asset identity. |
| `lpTokenAddress` | Raw LP token contract address, or `null`. |
| `lpTokenQuantity` | Materialized LP token balance (string decimal). |
| `token0AssetId` / `token1AssetId` | Canonical asset identities of the underlying pair tokens, or `null`. |
| `token0Address` / `token1Address` | Raw addresses of underlying pair tokens, or `null`. |
| `token0NetQuantity` / `token1NetQuantity` | Net quantity of each underlying token attributable to this LP position, or `null`. |
| `updatedFromBlock` / `updatedToBlock` | Block range of the last LP position materialization. |
| `valuation.status` | **Always `"unsupported"`** — LP valuation is not implemented in V1. |
| `valuation.valueQuote` | **Always `null`** — LP valuation is not implemented in V1. |
| `pnl.status` | **Always `"unsupported"`** — LP PnL is not implemented in V1. |
| `pnl.warnings` | Always contains `UNSUPPORTED_ACTION_GROUP` sentinel. |
| `warnings` | Always contains `"lp-valuation-unsupported-v1"`. |

### 4.6 Stake positions (`stakePositions`)

Each `DashboardStakePositionDto` includes:

| Field | Notes |
|---|---|
| `stakeKey` | Canonical stake position key. |
| `tokenAssetId` | Canonical asset identity of the staked token. |
| `tokenAddress` | Raw staked token contract address, or `null`. |
| `principalQuantity` | Staked principal amount (string decimal). |
| `returnedQuantity` | Returned principal amount (string decimal). |
| `yieldQuantity` | Yield received, or `null`. |
| `penaltyQuantity` | Early-end penalty, or `null`. |
| `status` | Stake lifecycle status string from persisted state. |
| `startBlock` / `endBlock` | Block numbers bounding the stake period, or `null`. |
| `valuation.status` | **Always `"unsupported"`** — Stake valuation is not implemented in V1. |
| `valuation.valueQuote` | **Always `null`** — Stake valuation is not implemented in V1. |
| `pnl.status` | **Always `"unsupported"`** — Stake PnL is not implemented in V1. |
| `pnl.warnings` | Always contains `UNSUPPORTED_ACTION_GROUP` sentinel. |
| `warnings` | Always contains `"stake-valuation-unsupported-v1"`. |

---

## 5. Current Reliability Assessment

### 5.1 Wallet identity and envelope

| Criterion | Assessment |
|---|---|
| Source of truth | PostgreSQL `Wallet` table; uniqueness enforced by `(chainId, addressLower)` |
| Persisted or on-request | Persisted |
| Freshness/provenance visible | `wallet.id`, `wallet.address`, `wallet.chainId` are stable DB fields; `asOf` reflects caller/server timestamp |
| Unknown/unavailable explicit | Route returns HTTP 404 with `WALLET_NOT_FOUND` when wallet is not tracked |
| Known limitations | Only tracked wallets can be queried; the address must be pre-imported via `POST /api/wallets/import` |

### 5.2 Materialization metadata

| Criterion | Assessment |
|---|---|
| Source of truth | PostgreSQL `portfolioMaterializationState` table |
| Persisted or on-request | Persisted; the DTO reads the last recorded state |
| Freshness/provenance visible | `lastAttemptedAt`, `latestMaterializedAt`, `updatedFromBlock`, `updatedToBlock`, `sourceLedgerFromBlock`, `sourceLedgerToBlock` are all exposed |
| Unknown/unavailable explicit | All fields are `null` when no materialization run record exists; `status: null` is explicit, not coerced |
| Known limitations | The DTO reflects the state of the last materialization attempt; if materialization is stale relative to the canonical ledger, there is no automatic warning beyond `latestMaterializedAt` being old. `warningDetails` is stored as an opaque `unknown` JSON column and normalized on read. |

### 5.3 Portfolio summary

| Criterion | Assessment |
|---|---|
| Source of truth | Derived from token positions during DTO assembly |
| Persisted or on-request | Fully on-request; recomputed on every dashboard fetch |
| Freshness/provenance visible | Depends on underlying position and pricing freshness; `asOf` is the effective reference |
| Unknown/unavailable explicit | `totalValueQuote: null` when no positions are valued; `valuationStatus: "unavailable"` when no positions exist; `"partial"` when some but not all are valued |
| Known limitations | Summary covers token positions only in the valued count; LP and stake positions are excluded from `valuedPositions` because they are always `"unsupported"`. This means `valuationCoverage.totalPositions` includes LP and stake, but `valuedPositions` can never account for them, inflating `unvaluedPositions`. |

### 5.4 Token positions

| Criterion | Assessment |
|---|---|
| Source of truth | `portfolioTokenBalance` (balance), `priceObservation` (price), `ledgerEntry` (PnL cost basis) |
| Persisted or on-request | Balances and price observations are persisted; PnL is computed on demand from ledger entries |
| Freshness/provenance visible | `updatedFromBlock`/`updatedToBlock` for balance; `pricing.observedAt`, `pricing.sourceType`, `pricing.sourceId`, `pricing.confidence`, `pricing.staleAfterSeconds` for price; `pnl.warnings` for PnL limitations |
| Unknown/unavailable explicit | `valuation.valueQuote: null` when price is unavailable; `pnl.unrealizedPnl: null` when mark price is missing; `pnl.markPrice: null` similarly; all status enums explicitly non-zero when uncertain |
| Known limitations | (1) DEXSCREENER source type is present in the type system but is classified as `SOURCE_DISABLED` during price resolution, so it is rejected and contributes a rejection reason rather than a selected price. (2) PnL depends on complete ledger history; gaps in ingested history (e.g. unsynced blocks) silently affect average-cost accuracy. (3) Price observations are fetched for the exact `asOf` timestamp; if no observation is fresh enough, `pricing.status` is `"stale_price"` rather than the freshest stale value. |

### 5.5 LP positions

| Criterion | Assessment |
|---|---|
| Source of truth | `portfolioLpPosition` (balance/underlying quantities) |
| Persisted or on-request | Balances are persisted; underlying net quantities are persisted |
| Freshness/provenance visible | `updatedFromBlock`/`updatedToBlock` present |
| Unknown/unavailable explicit | `valuation.status: "unsupported"`, `pnl.status: "unsupported"`, `warnings: ["lp-valuation-unsupported-v1"]` are always explicit |
| Known limitations | LP valuation and PnL are not implemented. The DTO always signals `"unsupported"`, but does not expose a roadmap timestamp or priority indicator for when this will change. |

### 5.6 Stake positions

| Criterion | Assessment |
|---|---|
| Source of truth | `portfolioStakePosition` |
| Persisted or on-request | All stake fields are persisted |
| Freshness/provenance visible | `startBlock`/`endBlock` present; no explicit `updatedFromBlock`/`updatedToBlock` for stake positions (unlike token and LP positions) |
| Unknown/unavailable explicit | `valuation.status: "unsupported"`, `pnl.status: "unsupported"`, `warnings: ["stake-valuation-unsupported-v1"]` are always explicit |
| Known limitations | (1) Stake positions have no `updatedFromBlock`/`updatedToBlock` in the DTO, unlike token and LP positions. (2) Stake valuation and PnL are not implemented. |

---

## 6. Known Risks and Gaps

All items below are anchored in current code or documentation.

### G1. Stale materialized data risk

The `PortfolioDashboardDto` presents materialized balances as of the last materialization run. If sync has ingested new ledger entries since the last materialization, those entries are not reflected in the balances until the next materialization completes. The DTO exposes `latestMaterializedAt` and `lastAttemptedAt` so an operator can detect this, but the UI does not currently surface a staleness warning relative to the current time or relative to the latest sync run.

Reference: `src/services/dashboard/types.ts` — `DashboardMaterializationDto`.

### G2. Ledger completeness affects PnL accuracy silently

Average-cost PnL is computed on demand from all `ledgerEntry` rows for the wallet and chain. If ingestion has not processed the complete block history (e.g. the wallet was recently imported and sync has not finished), the PnL figures reflect only the ingested portion of history. The DTO does not currently expose the ledger's block coverage range for PnL purposes; it only exposes `updatedFromBlock`/`updatedToBlock` for materialized token balances. Incomplete ledger history produces `INSUFFICIENT_COST_BASIS` PnL warnings, which are surfaced in `pnl.warnings`.

Reference: `src/services/pnl/types.ts` — `PnLWarningCode`.

### G3. No dedicated prices/status DTO

There is no `GET /api/prices/status` route. The pricing subsystem (`src/services/pricing/price-store.ts`, `src/services/pricing/price-resolver.ts`) stores and resolves observations, but there is no operator-facing summary of how many assets have fresh observations, how many are stale, or when observations were last ingested. Pricing health is only visible per-asset, one dashboard fetch at a time.

Reference: `docs/data-fetching-architecture.md` — "Backend surface present, but no first-class page yet".

### G4. LP and stake valuation and PnL are not implemented

Both LP positions and stake positions always return `status: "unsupported"` for valuation and PnL. The DTO correctly signals this, but the dashboard UI cannot provide total portfolio value including LP or stake. The `valuationCoverage.totalPositions` count includes LP and stake positions, making `unvaluedPositions` visually larger than it might otherwise appear.

Reference: `src/services/dashboard/portfolio-dashboard.ts` — `lpDtos`, `stakeDtos` assembly.

### G5. Stake positions lack block-range provenance in DTO

Token positions and LP positions both expose `updatedFromBlock`/`updatedToBlock` in the DTO, enabling an operator to see which block range the position data reflects. Stake positions do not expose these fields in the current `DashboardStakePositionDto`, so there is no per-stake block-range provenance at the dashboard level.

Reference: `src/services/dashboard/types.ts` — `DashboardStakePositionDto`.

### G6. Materialization warning provenance is partially opaque

The `portfolioMaterializationState.warningDetails` column is stored as a JSON `unknown` type in the schema. The normalization function (`normalizePersistedWarnings` in `portfolio-dashboard.ts`) parses known formats (`negative-token-balance:...`) and falls back to `generic_persisted_warning` for anything else. This means new warning formats introduced by the materialization service may appear in the DTO as opaque `generic_persisted_warning` strings rather than structured codes until the normalization function is updated.

Reference: `src/services/dashboard/portfolio-dashboard.ts` — `normalizePersistedWarnings`.

### G7. No historical materialization run log in the dashboard DTO

The DTO exposes only the latest materialization state. There is no list of historical materialization run records in the dashboard DTO, so an operator cannot distinguish between a single failed run and a run that succeeded after prior failures without querying debug/status separately.

Reference: `src/services/dashboard/types.ts` — `DashboardMaterializationDto` (single record, not a list).

### G8. Frontend can only show what the backend DTO exposes

The frontend renders DTO fields verbatim and cannot add diagnostic context beyond what the backend provides. Any new provenance, freshness, or warning fields require backend DTO changes before the frontend can display them. This is a guardrail, not a gap, but it means the order of work is always backend DTO improvement first, then frontend rendering improvement.

Reference: `docs/data-fetching-architecture.md` — guardrails.

---

## 7. Recommended Next V1 Implementation Sequence

Each item below is a bounded PR. Items are ordered by data quality impact.

1. **Add materialization staleness indicator to the dashboard DTO.** Expose a computed `isStaleRelativeToSync` boolean or `materializationAgeSeconds` field in `DashboardMaterializationDto` so the frontend can warn the operator when the materialized state is significantly behind the last known sync. This requires backend-only changes to `portfolio-dashboard.ts` and a contract test update.

2. **Add ledger block coverage range to the dashboard DTO.** Expose the canonical ledger's ingested block range (e.g. `ledgerFromBlock`, `ledgerToBlock`) alongside the materialization block range, so the operator can compare the two and identify whether materialization is behind the ledger. This is a purely additive DTO change.

3. **Add per-asset pricing freshness and coverage to `GET /api/prices/status`.** Implement the `GET /api/prices/status` route documented in `docs/data-fetching-architecture.md`. This gives operators a summary view of how many tracked assets have fresh price observations and which are stale or unpriced, without requiring a wallet-scoped dashboard fetch.

4. **Add contract tests for freshness and provenance fields.** Extend `tests/api/portfolio-dashboard-route-contract.test.ts` to cover: `materialization.latestMaterializedAt` vs `materialization.lastAttemptedAt` divergence, per-position `updatedFromBlock`/`updatedToBlock` round-trip, and pricing provenance fields (`sourceType`, `confidence`, `observedAt`, `staleAfterSeconds`) in success and degraded paths.

5. **Improve materialization warning normalization.** Add structured warning codes for all materialization warning formats currently stored in `warningDetails`, rather than falling back to `generic_persisted_warning`. This makes operator-visible warnings actionable.

6. **Add `updatedFromBlock`/`updatedToBlock` to `DashboardStakePositionDto`.** Close the provenance gap identified in G5 so stake positions have the same block-range visibility as token and LP positions.

7. **Only then consider broader feature UX** — wallet delete/edit, multi-wallet dashboard views, or cross-chain expansion — because those depend on the read path being stable and complete.

---

## 8. Non-Goals

This document and the work it describes will not:

- Change any source code.
- Change any tests.
- Change any schema or database migrations.
- Change any dashboard UI behavior.
- Change any backend routes, services, or API contracts.
- Change any pricing or PnL logic.
- Make any RPC calls.
- Add Ethereum/Base or any non-PulseChain execution.

---

## 9. Decision

Continue V1 work by improving dashboard data quality and observability before wallet delete/edit or major UI redesign.

Specifically:

- The backend DTO already surfaces most of what is needed for correct accounting display.
- The identified gaps (stale materialization detection, ledger block coverage, prices/status route, incomplete warning normalization) are bounded and additive.
- Improving these gaps first ensures that any future wallet mutation features (delete, edit, multi-wallet) land on a read path that is already stable, honest about uncertainty, and fully observable by operators.

---

## Companion Documents

- `docs/data-fetching-architecture.md` — canonical architecture rules: truth model, DTO contract strategy, query key strategy, polling and stale-time policy, and API route map.
- `docs/frontend-query-standardization-audit.md` — audit of frontend data fetching against architecture rules, and the bounded TanStack Query standardization plan.
- `docs/dashboard-wallet-selection-plan.md` — plan for integrating backend-tracked wallets into the dashboard; includes milestone status through PR #53.
- `docs/reusable-data-fetching-template-plan.md` — plan for a future reusable data-fetching template extracted from CoinPulse; includes readiness gates G1–G8.
- `docs/reusable-backend-template-plan.md` — companion backend truth model and contract-test discipline plan.
