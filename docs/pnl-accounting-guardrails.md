# CoinPulse V1 PnL Accounting Guardrails

## 1. Purpose

This document defines the PnL accounting rules that CoinPulse V1 must follow when implementing, extending, or presenting profit-and-loss data. It establishes definitions, required backend truth preconditions, mandatory status vocabulary, and explicit non-goals.

**This document is documentation only.** It does not implement any calculations, change any source code, modify any schema, alter any API route, or add any dependencies. All claims are anchored to existing CoinPulse V1 architecture as documented in `docs/data-fetching-architecture.md`, `docs/dashboard-data-quality-audit.md`, `docs/pulsechain-portfolio-research-comparison.md`, `src/services/pnl/types.ts`, `src/services/pnl/average-cost.ts`, and `src/services/dashboard/types.ts`.

---

## 2. PnL Terms CoinPulse May Use

The following terms are defined within CoinPulse's backend-owned, ledger-anchored PnL model. No term may be presented in the UI without a corresponding backend-computed value, provenance, and status field.

| Term | Definition |
|---|---|
| **Realized PnL** | The gain or loss confirmed by an actual disposal event (sale, swap, transfer out). Computed as proceeds minus disposed cost basis minus attributable fees. |
| **Unrealized PnL** | The gain or loss on an open position that has not yet been disposed. Computed as the current mark-price value of remaining holdings minus the remaining carrying cost basis. |
| **Gross PnL** | Realized plus unrealized PnL before subtracting any fees not already attributed to individual disposal events. |
| **Net PnL** | Realized plus unrealized PnL minus all attributable fees not already included in realized or unrealized figures. |
| **PnL %** | PnL expressed as a percentage of the original cost basis. Only surfaced when cost basis is known, non-zero, and reliably computed from ledger truth. |
| **PnL ratio** | A dimensionless ratio form of PnL %. Only appropriate as a secondary metric derived from net PnL and total cost basis. |
| **Native-asset PnL** | PnL expressed in native-chain asset terms (for PulseChain: PLS). Only surfaced when the backend has historical native-asset pricing observations aligned to the relevant ledger events. |
| **Quote-asset PnL** | PnL expressed in the configured quote asset, usually USD (`fiat:usd`) or another operator-selected quote. The default and primary PnL expression in V1. |

---

## 3. V1 Definitions

These definitions are authoritative for CoinPulse V1 implementation. They are grounded in the average-cost engine at `src/services/pnl/average-cost.ts` and the PnL type contract at `src/services/pnl/types.ts`.

### 3.1 Unrealized PnL

```
unrealizedPnl = (markPrice − averageCost) × holdingsQuantity
```

- `markPrice` is a backend-resolved pricing observation for the asset at the `asOf` timestamp.
- `averageCost` is the remaining carrying cost per unit, derived from cumulative acquisition costs divided by cumulative held quantity.
- `holdingsQuantity` is the net open quantity after all disposals tracked in the canonical ledger.
- Returns `null` (not zero) when `markPrice` is unavailable, stale, or low-confidence. See `AverageCostPnlResult.unrealizedPnl` in `src/services/pnl/types.ts`.

### 3.2 Realized PnL

```
realizedPnl += proceeds − attributedFees − costOfDisposed
```

- `proceeds` are backend-resolved values of inflows received in a disposal action group.
- `costOfDisposed = averageCost × disposedQuantity` at the time of the disposal.
- `attributedFees` are backend-resolved values of fee entries in the same action group.
- A realized PnL entry requires a disposal event (`SEND` or `SWAP_OUT` entry type) in the canonical ledger. No realized PnL may be reported without a confirmed disposal event.

### 3.3 Net PnL

```
netPnl = realizedPnl + unrealizedPnl − unattributedFees
```

- Returns `null` when `unrealizedPnl` is `null` (i.e., mark price is unavailable).
- Fees already included in `realizedPnl` must not be double-counted.

### 3.4 PnL %

```
pnlPercent = pnl / costBasis × 100
```

- Only surfaced when `costBasis` (carrying cost or total acquisition cost) is known, non-zero, and was computed from complete ledger coverage for the relevant wallet/chain/window.
- Must not be computed or displayed when `costBasis` is zero, null, or flagged as insufficient. See `PnLWarningCode.INSUFFICIENT_COST_BASIS` in `src/services/pnl/types.ts`.

### 3.5 Native PnL

PnL expressed in PLS or another native chain asset. Requires:

- Backend historical price observations for the native asset aligned to each relevant ledger event timestamp.
- Explicit provenance and status on each native-price observation used.
- Must be `null` and hidden until the backend price service can supply reliable historical native-asset pricing.

### 3.6 Quote PnL

PnL expressed in the configured quote asset (default `fiat:usd`). The primary PnL expression in V1 when pricing is available. Carries the same `status`, `observedAt`, and `confidence` metadata as the underlying pricing observations.

---

## 4. Required Backend Truth Before Showing PnL

PnL values may only be presented to the operator as `valued` / reliable when all of the following conditions are met in the backend:

1. **Canonical ledger coverage** — The canonical ledger contains entries for the full relevant window (wallet, chain, date range). Partial ingestion must produce an explicit `partial_history` status, not a best-guess PnL figure.

2. **Normalized action groups** — Buys, sells, transfers, swaps, bridge events, fees, LP add/remove, and stake start/end events are all represented as classified ledger entries with correct `entryType`, `direction`, `actionType`, and `actionGroupId`. Unclassified or unresolvable entries must produce an `UNSUPPORTED_ACTION_GROUP` warning.

3. **Token identity by chainId + contractAddress** — Every ledger entry's `assetId` is `chainId:contractAddress` or the deterministic native-asset identifier (e.g., `chain:369:native:PLS`). No symbol-based identity is acceptable in any PnL path.

4. **Pricing observations with provenance** — Each price used in PnL must carry:
   - `sourceType` and `sourceId`
   - `confidence`
   - `observedAt`
   - `staleAfterSeconds`
   - `rejectedReasons` when a price candidate was rejected

5. **Explicit cost-basis method declaration** — The current method is average cost (`AVCO`). The method must be declared in the DTO or accompanying metadata. Any future method (FIFO, LIFO, specific identification) requires its own explicit declaration.

6. **Explicit unknown/unsupported handling** — Ledger entries that cannot be classified, priced, or attributed must produce explicit `PnLWarning` records. They must never be silently skipped or treated as zero-impact events.

---

## 5. Required PnL Statuses

The following status vocabulary must be used in all backend PnL outputs and frontend DTO presentations. These statuses map to `DashboardStatus` in `src/services/dashboard/types.ts` and `PnLWarningCode` in `src/services/pnl/types.ts`.

| Status | Meaning |
|---|---|
| `valued` | PnL was computed with full cost basis, disposition events, and a current mark price. All inputs had sufficient confidence. Maps to `available` in `DashboardStatus`. |
| `unpriced` | Mark price or counter-asset price could not be resolved. `unrealizedPnl` is `null`. Maps to `MARK_PRICE_UNAVAILABLE` or `COUNTER_ASSET_PRICE_UNAVAILABLE` warnings, and `unavailable` or `stale_price` in `DashboardStatus`. |
| `insufficient_cost_basis` | A disposal event exceeded tracked holdings or the ledger is missing acquisition entries. PnL for that disposal was skipped with an `INSUFFICIENT_COST_BASIS` warning. Maps to `incomplete_basis` in `DashboardStatus`. |
| `unsupported` | The action group type (LP add/remove, stake start/end) is not yet supported in the V1 average-cost engine. Maps to `UNSUPPORTED_LP_ACTION`, `UNSUPPORTED_STAKE_ACTION`, or `UNSUPPORTED_ACTION_GROUP` warnings, and `unsupported` in `DashboardStatus`. |
| `unknown` | Action group classification failed entirely. An `UNSUPPORTED_ACTION_GROUP` warning is emitted. The action group is skipped. |
| `stale` | A price observation was found but has exceeded its `staleAfterSeconds` threshold. Maps to `stale_price` in `DashboardStatus`. |
| `partial_history` | The canonical ledger does not cover the full requested window. Some entries may be missing, making cost basis reconstruction incomplete for that window. |
| `source_disabled` | A pricing source or ingestion family was explicitly disabled by operator configuration. PnL depending on that source is not available. |

The frontend must render each of these statuses as an explicit indicator, never silently coercing them to zero or hiding them behind an empty state.

---

## 6. What CoinPulse Must Not Do

The following behaviors are permanently prohibited in CoinPulse V1 and must not be introduced in any future PR unless this guardrail document is explicitly revised.

### 6.1 No frontend PnL computation

No React component, hook, utility function, or client-side module may compute realized PnL, unrealized PnL, average cost, net PnL, PnL %, or PnL ratio. All PnL computation belongs exclusively in the backend service layer (`src/services/pnl/`).

Reference: `docs/data-fetching-architecture.md` — Guardrails section; `AGENTS.md`.

### 6.2 No UI-only cost-basis reconstruction

No frontend code may reconstruct cost basis from raw transaction history, RPC logs, or balance reads. Cost-basis reconstruction belongs in the backend average-cost engine (`src/services/pnl/average-cost.ts`) operating on canonical ledger entries.

Reference: `docs/pulsechain-portfolio-research-comparison.md` — Section 6.3.

### 6.3 No symbol-based asset identity

Token symbols (`"PLS"`, `"HEX"`, `"PLSX"`) must never serve as PnL accounting identity. Asset identity is always `chainId:contractAddress` or the deterministic native-asset identifier. Symbols are display metadata only.

Reference: `docs/pulsechain-portfolio-research-comparison.md` — Section 6.5; `docs/data-fetching-architecture.md` — Truth Model.

### 6.4 No treating missing PnL as zero

When a PnL field is `null`, unavailable, unsupported, or carries a warning, the frontend must not render it as `$0.00` or `0%`. The explicit status must be shown. `null` is not zero.

Reference: `docs/data-fetching-architecture.md` — Section 4; `src/services/dashboard/types.ts`.

### 6.5 No DexScreener or subgraph as canonical price truth

DexScreener and subgraph sources must not provide the canonical mark price used in PnL calculations. On-chain PulseChain reserve-derived pricing with documented confidence and route metadata is preferred. pDAI must never be hardcoded to $1 in any PnL path.

Reference: `docs/pulsechain-portfolio-research-comparison.md` — Sections 3.4, 6.6; `AGENTS.md`.

### 6.6 No native PnL from current spot price alone

Native-asset PnL (e.g., PnL expressed in PLS) requires historical native-asset pricing observations aligned to each ledger event, not just the current spot price. Deriving native PnL from a single current spot price would produce incorrect historical PnL figures. Native PnL must remain `null` until the backend price service supports historical native-asset observations.

### 6.7 No realized PnL without disposal events

Realized PnL may only be accumulated when the canonical ledger contains a confirmed disposal entry (`SEND` or `SWAP_OUT`) for the asset. Constructing realized PnL from balance deltas, estimated transfers, or inferred events is not acceptable.

Reference: `src/services/pnl/average-cost.ts` — disposal handling logic.

### 6.8 No tax claims

CoinPulse V1 does not provide tax advice, tax reporting, or tax-lot accounting. PnL figures are portfolio analytics only. No language suggesting capital gains, tax-lot accounting, wash sales, short-term/long-term classification, or tax liability should appear in the UI or documentation.

### 6.9 No AI or risk-benchmarking claims

Volatility-adjusted PnL, Sharpe ratio, Sortino ratio, maximum drawdown, value at risk, or other risk-adjusted analytics must not be presented until a dedicated backend analytics service implements them. No AI-generated PnL assessments, projections, or benchmarks may appear in any DTO or UI surface in V1.

---

## 7. Difference from Exchange and Futures PnL Articles

CoinPulse V1 is a **portfolio accounting and analytics engine for spot/ledger positions**. It is not an exchange, margin trading platform, or derivatives product. The following futures-specific concepts do not apply to CoinPulse V1 unless derivatives support is explicitly added:

| Futures concept | Status in CoinPulse V1 |
|---|---|
| Mark price (futures/perpetual) | Not applicable. CoinPulse uses mark price only in the limited sense of a current valuation price for unrealized PnL on spot positions. It is not a futures funding-rate-adjusted mark. |
| Funding rates | Not applicable. CoinPulse V1 has no leveraged or perpetual positions. |
| Liquidation price | Not applicable. No margin or leverage mechanics exist. |
| Open interest | Not applicable. |
| Long/short balance (exchange-wide) | Not applicable. CoinPulse tracks individual wallet positions on-chain. |
| FIFO-for-futures | Not applicable in V1. Average cost is the V1 cost-basis method. |
| Unrealized PnL at funding intervals | Not applicable. PulseChain has no funding mechanism. |

If CoinPulse later implements support for derivatives, perpetuals, or leveraged products, a separate guardrail document must be written for that surface before any implementation begins.

---

## 8. Native PnL Policy

Native PnL (PnL denominated in PLS or another native chain asset) has distinct requirements beyond quote-asset PnL:

1. **Backend-computed only.** The backend must convert PnL figures from quote-asset denomination to native-asset denomination using historical native-asset price observations. The frontend must not divide or multiply quote PnL by any price to derive native PnL.

2. **Historical native pricing alignment.** Each PnL-impacting event (acquisition, disposal) occurred at a specific block and timestamp. The native-asset price used must correspond to that same timestamp. Using today's PLS spot price to express historical PnL in PLS would produce incorrect figures.

3. **Provenance and status.** Native PnL must carry the same `sourceType`, `sourceId`, `confidence`, `observedAt`, and `staleAfterSeconds` metadata as the underlying price observations. A native PnL figure without provenance is not surfaceable.

4. **Hidden when insufficient.** If the backend does not have historical native-asset price observations covering the required event timestamps, native PnL must remain `null` and be hidden from the UI entirely, not shown as zero or an approximation.

5. **No PLS-to-USD circular derivation.** Native PnL in PLS must be derived from historical on-chain reserve pricing, not by back-converting a USD PnL figure using a current PLS/USD spot price.

---

## 9. Recommended Implementation Sequence

The following ordered sequence represents the correct bounded PR approach to PnL readiness. Each item is a separate future PR.

1. **Finish materialization freshness and UI** (future PR) — The `materialization.freshness` field was added to `DashboardMaterializationDto`; the UI should surface freshness status (`fresh`, `stale`, `unknown`) and reason in the dashboard before PnL analytics are prominently displayed.

2. **Add ledger/source coverage range to dashboard DTO** (future PR) — The DTO should expose the actual canonical ledger block range covered (`ledgerFromBlock`, `ledgerToBlock`) for the wallet/chain/window, so the UI can surface `partial_history` explicitly before PnL figures are shown.

3. **Add pricing status endpoint** (future PR) — `GET /api/prices/status` does not yet exist. Implement it with source hierarchy, confidence distribution, freshness metadata, and coverage by asset/chain before surfacing pricing quality in the UI.

   > **Status (2026-06): Partially completed.** `GET /api/prices/status` exists with route contract coverage, client/query wiring, and debug/status UI coverage. The source-level route is no longer future work. However, per-asset pricing/metadata coverage diagnostics and confidence distribution remain open (see `docs/v1-remaining-guardrail-checklist.md` §3). Do not treat this sequence item as fully closed until those diagnostics prerequisites are satisfied.

4. **Add PnL status contract tests** (future PR) — Add route-level and service-level tests asserting that the `pnl.status` field, `pnl.warnings`, and the `DashboardPnlDto` shape are stable across PnL engine changes. Verify that `INSUFFICIENT_COST_BASIS`, `MARK_PRICE_UNAVAILABLE`, `UNSUPPORTED_LP_ACTION`, and `UNSUPPORTED_STAKE_ACTION` warning codes are propagated correctly into the DTO.

5. **Add explicit realized/unrealized DTO fields only if backend already supports them** (future PR) — The `DashboardPnlDto` in `src/services/dashboard/types.ts` already includes `realizedPnl` and `unrealizedPnl` fields. Do not add new frontend PnL surface area beyond what the current DTO already exposes. If new PnL fields are needed, extend the backend engine and DTO contract first.

6. **Add native PnL only after historical native pricing support exists** (future PR) — Do not add any native PnL (PLS-denominated) field to the DTO until `src/services/pricing/` can supply historical native-asset price observations aligned to ledger event timestamps.

7. **Only later: PnL ratio, risk metrics, and benchmarking** (future PR) — PnL %, PnL ratio, volatility-adjusted PnL, and comparative benchmarking are deferred until the core realized/unrealized/net PnL pipeline is tested, stable, and backed by full ledger and pricing coverage.

---

## 10. Non-Goals

This document and the PR that delivers it will **not**:

- Change any source code.
- Change any test files.
- Change any package files (`package.json`, `package-lock.json`, etc.).
- Change or add any Prisma schema or migration.
- Change any API routes or route handlers.
- Change any pricing logic or pricing service code.
- Change any dashboard UI components.
- Add any tax logic or tax-reporting features.
- Add any futures, perpetuals, or derivatives support.
- Add any AI analytics, projections, or risk-adjusted metrics.
- Add any new dependencies.
- Add any Ethereum/Base execution.
- Add any DexScreener or external pricing integrations.
- Add any `GET /api/prices/status` route (that remains a future bounded PR). *(Note: as of 2026-06 this route now exists; this non-goal statement was accurate at the time of original authorship.)*
- Add any realized or unrealized PnL frontend surface beyond what `DashboardPnlDto` already defines.

---

## 11. Decision

1. **CoinPulse may use realized, unrealized, and net PnL terminology only when backed by the definitions in Section 3 and the backend truth requirements in Section 4.** Any DTO field or UI label that uses these terms without meeting those requirements must carry an explicit `unsupported`, `unpriced`, `partial_history`, or equivalent status from Section 5.

2. **Unknown or unsupported is safer than misleading PnL.** An explicit `null` with a status of `insufficient_cost_basis` or `unpriced` is correct behavior. Displaying `$0.00` PnL when the backend cannot confirm the value is a data quality error, not an acceptable default.

3. **Data quality comes before analytics UI.** PnL surface area in the dashboard must expand only in step with the backend truth it depends on: canonical ledger coverage first, reliable pricing provenance second, tested PnL status contract third, then richer PnL analytics. This sequence directly mirrors the roadmap validated by the PulsePort and PulseChain data-source research documented in `docs/pulsechain-portfolio-research-comparison.md`.
