# Displayed Numbers Inventory

## 1. Purpose

This inventory tracks every numeric value currently rendered in the CoinPulse frontend and classifies which future numbers are safe or unsafe to add. It exists to prevent:

- **Accidental frontend calculations** — computing balances, pricing, PnL, or yield in the browser instead of reading them from backend DTOs.
- **Unit mistakes** — displaying hearts as HEX, or wei as tokens, without the explicit backend-defined conversion.
- **DTO drift** — adding UI values before the backend DTO field and its provenance/freshness/status envelope exist.
- **Fabricated values** — coercing `null`, `unavailable`, or `unsupported` backend states to zero or any other synthetic number.

The invariant: **the frontend renders and formats backend-provided values. It does not compute them.**

---

## 2. Current Displayed Numbers

Each row below describes one numeric or quasi-numeric value currently rendered in the UI.

> **Frontend action key**
> - `render only` — value is rendered as a string exactly as the backend provided it; no transformation.
> - `display formatting only` — a purely mechanical, contract-defined transformation is applied (e.g. bigint hearts → HEX string, address truncation). No arithmetic that could produce a different accounting result.
> - `unsafe / needs follow-up` — computation or assumption that should be reviewed before the product ships.

### Dashboard (`/` → `GET /api/portfolio/dashboard`)

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Wallet (truncated address) | `PortfolioDashboardDto` / `/api/portfolio/dashboard` | `wallet.address` | EVM address string | First 6 + last 4 chars | `display formatting only` | `truncateAddress()` — display shortening only, identity unchanged |
| Chain | `PortfolioDashboardDto` | `wallet.chainId` | integer | integer string | `render only` | Rendered via `String()` |
| Summary valuation | `PortfolioDashboardDto` | `summary.totalValueQuote` | quote asset (fiat:usd) | quote asset | `render only` | Null displayed as `"n/a"`. Never forced to zero. |
| Coverage | `PortfolioDashboardDto` | `summary.valuationCoverage.valuedPositions`, `.totalPositions` | counts | `N/M valued` | `display formatting only` | Template string from two backend-provided integers. No arithmetic beyond interpolation. |
| Valuation status | `PortfolioDashboardDto` | `summary.valuationStatus` | status enum | status label | `render only` | |
| Quote asset | `PortfolioDashboardDto` | `quoteAsset` | string | string | `render only` | |
| As of timestamp | `PortfolioDashboardDto` | `asOf` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` component |
| Schema version | `PortfolioDashboardDto` | `schemaVersion` | string | string | `render only` | |
| Last materialized timestamp | `PortfolioDashboardDto` | `materialization.freshness.lastMaterializedAt` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |
| Stale after seconds | `PortfolioDashboardDto` | `materialization.freshness.staleAfterSeconds` | seconds (integer) | seconds | `render only` | |
| Ledger from block | `PortfolioDashboardDto` | `ledgerCoverage.fromBlock` | block number | block number | `render only` | |
| Ledger to block | `PortfolioDashboardDto` | `ledgerCoverage.toBlock` | block number | block number | `render only` | |
| PnL coverage: Priced count | `PortfolioDashboardDto` | `pnlCoverage.pricedPositionsCount` | integer | integer | `render only` | |
| PnL coverage: Unpriced count | `PortfolioDashboardDto` | `pnlCoverage.unpricedPositionsCount` | integer | integer | `render only` | |
| PnL coverage: Unsupported count | `PortfolioDashboardDto` | `pnlCoverage.unsupportedPositionsCount` | integer | integer | `render only` | |
| PnL coverage: Incomplete basis count | `PortfolioDashboardDto` | `pnlCoverage.incompleteBasisPositionsCount` | integer | integer | `render only` | |
| PnL coverage: Stale price count | `PortfolioDashboardDto` | `pnlCoverage.stalePricePositionsCount` | integer | integer | `render only` | |
| PnL coverage: Source disabled count | `PortfolioDashboardDto` | `pnlCoverage.sourceDisabledPositionsCount` | integer | integer | `render only` | |
| PnL coverage as of timestamp | `PortfolioDashboardDto` | `pnlCoverage.asOf` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |
| Token position: balance quantity | `DashboardTokenPositionDto` | `balanceQuantity` | token base unit string | display string | `render only` | Backend provides as string |
| Token position: valuation | `DashboardTokenPositionDto` | `valuation.valueQuote` | quote asset | quote asset | `render only` | `ValueDisplay` component; null = no value shown |
| Token position: pricing confidence | `DashboardTokenPositionDto` | `pricing.confidence` | string | string with prefix | `render only` | |
| Token position: unrealized PnL | `DashboardTokenPositionDto` | `pnl.unrealizedPnl` | quote asset | quote asset | `render only` | `ValueDisplay` |
| Token position: average cost | `DashboardTokenPositionDto` | `pnl.averageCost` | quote asset | quote asset | `render only` | `ValueDisplay` |
| LP position: LP token quantity | `DashboardLpPositionDto` | `lpTokenQuantity` | token base unit string | display string | `render only` | |
| LP position: token0 net quantity | `DashboardLpPositionDto` | `token0NetQuantity` | token base unit string | display string | `render only` | Null displayed as `"n/a"` |
| LP position: token1 net quantity | `DashboardLpPositionDto` | `token1NetQuantity` | token base unit string | display string | `render only` | Null displayed as `"n/a"` |
| LP position: valuation | `DashboardLpPositionDto` | `valuation.valueQuote` | quote asset | quote asset | `render only` | `ValueDisplay` |
| Stake position: principal quantity | `DashboardStakePositionDto` | `principalQuantity` | token base unit string | display string | `render only` | |
| Stake position: valuation | `DashboardStakePositionDto` | `valuation.valueQuote` | quote asset | quote asset | `render only` | `ValueDisplay` |

### Debug/Sync (`/debug/sync` → `GET /api/debug/health`, `GET /api/debug/status`)

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Health timestamp | `HealthReportDto` / `/api/debug/health` | `timestamp` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |
| Status timestamp | `DebugStatusReportDto` / `/api/debug/status` | `timestamp` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |
| Supported chains (chain IDs) | `DebugStatusReportDto` | `status.supportedChains[].chainId` | integer | integer in label string | `display formatting only` | Rendered as `"Name (chainId)"` per chain |
| Pricing staleAfterSeconds | `PricingStatusSourceDto` | `staleAfterSeconds` | seconds (integer or null) | seconds | `render only` | Null displayed as `"Not provided"` |
| Pricing observations count | `PricingStatusSourceDto` | `observationsCount` | integer | integer | `display formatting only` | `String()` conversion only |
| Pricing rejected count | `PricingStatusSourceDto` | `rejectedCount` | integer | integer | `display formatting only` | `String()` conversion only |

### Pricing Status (`/debug/prices/status` → `GET /api/prices/status`)

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Source count | `PricingStatusDto` / `/api/prices/status` | `sources.length` | integer (array length) | integer string | `display formatting only` | `sources.length` — JS array length property, not arithmetic on values |
| staleAfterSeconds | `PricingStatusSourceDto` | `staleAfterSeconds` | seconds or null | seconds | `render only` | |
| observationsCount | `PricingStatusSourceDto` | `observationsCount` | integer | integer | `display formatting only` | `String()` |
| rejectedCount | `PricingStatusSourceDto` | `rejectedCount` | integer | integer | `display formatting only` | `String()` |
| latestObservedAt | `PricingStatusSourceDto` | `latestObservedAt` | ISO 8601 string or null | formatted timestamp | `display formatting only` | `TimestampLabel` |
| As of timestamp | `PricingStatusDto` | `asOf` | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |

### Tracked Wallets (`/debug/wallets/tracked` → `GET /api/wallets/tracked`)

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Wallet count badge | `TrackedWalletsDto` / `/api/wallets/tracked` | `wallets.length` | integer | integer string | `display formatting only` | `data.wallets.length` — array length |
| Chain ID per wallet | `TrackedWalletDto` | `chainId` | integer | integer string | `display formatting only` | `String(wallet.chainId)` |

### Transactions (`/transactions` → `GET /api/transactions`)

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Transaction timestamps | `TransactionDto` / `/api/transactions` | timestamp fields | ISO 8601 string | formatted timestamp | `display formatting only` | `TimestampLabel` |
| Ledger entry amounts | `TransactionEntryDto` | amount fields | backend-provided string | display string | `render only` | Rendered as provided; units depend on DTO definition |

### HexMining (`/hexmining` → `GET /api/hexmining/stakes`)

See section 3 for full HexMining detail.

| UI label | Source DTO / API route | Backend field path | Unit / base unit | Display unit | Frontend action | Notes |
|---|---|---|---|---|---|---|
| Stake count (table title) | `HexStakeListDto` / `/api/hexmining/stakes` | `stakes.length` | integer | integer string | `display formatting only` | Array length, not sum |
| Stake index | `HexStakeDto` | `stakeIndex` | integer | integer | `render only` | |
| Stake ID | `HexStakeDto` | `stakeId` | string | string | `render only` | |
| Principal HEX | `HexStakeDto` | `principalHex` | HEX units (string from backend) | HEX | `render only` | Null shown as `"—"`. Backend provides already in HEX units. |
| T-Shares | `HexStakeDto` | `tShares` | string | string | `render only` | Null shown as `"—"` |
| Locked day | `HexStakeDto` | `lockedDay` | HEX protocol day (integer) | day number | `render only` | |
| Staked days | `HexStakeDto` | `stakedDays` | integer | integer | `render only` | |
| Unlocked day | `HexStakeDto` | `unlockedDay` | HEX protocol day (integer) | day number | `render only` | |
| Estimated yield (HEX) | `HexStakeDto` | `yield.estimatedYieldHex` | hearts (bigint string) | HEX | `display formatting only` | `formatHeartsAsHexDisplay()` — see section 3 |
| Raw hearts | `HexStakeDto` | `yield.estimatedYieldHex` | hearts (bigint string) | hearts | `render only` | Shown alongside HEX display for transparency |
| Yield observation ID | `HexStakeDto` | `yield.provenance.observationId` | string | string | `render only` | |
| Yield range start day | `HexStakeDto` | `yield.provenance.rangeStartDay` | HEX protocol day | day number | `render only` | |
| Yield range end day | `HexStakeDto` | `yield.provenance.rangeEndDay` | HEX protocol day | day number | `render only` | |
| Provenance block | `HexStakeDto` | `provenance.observedAtBlock` | block number | block number | `render only` | |
| Observed at timestamp | `HexStakeListDto` | `observedAt` | ISO 8601 string | formatted timestamp string | `render only` | Shown in table footer |

---

## 3. HexMining-Specific Display Rules

### Hearts and HEX

The HEX protocol uses **hearts** as its base unit internally and on-chain:

```
1 HEX = 100,000,000 hearts  (1e8)
```

This conversion is a protocol constant defined by the HEX smart contract. It is not a price or valuation — it is a unit denomination, identical to the relationship between wei and ETH.

### Estimated yield

Estimated yield **may only be shown when the backend DTO provides it with `yield.status === "estimated"`**. The frontend must never estimate, extrapolate, or fabricate yield from stake parameters. If the backend does not return an estimated yield, the field must be hidden or shown as unavailable.

### PR #258 display rule

PR #258 established the approved pattern for displaying backend-provided hearts as HEX:

```typescript
const HEARTS_PER_HEX = 100_000_000n; // bigint constant

function formatHeartsAsHexDisplay(hearts: string): string | null {
  if (!/^\d+$/.test(hearts)) return null;
  const rawHearts = BigInt(hearts);
  const wholeHex = rawHearts / HEARTS_PER_HEX;
  const fractionalHearts = rawHearts % HEARTS_PER_HEX;
  if (fractionalHearts === 0n) return wholeHex.toString();
  const fraction = fractionalHearts.toString().padStart(8, "0").replace(/0+$/, "");
  return `${wholeHex.toString()}.${fraction}`;
}
```

Key properties of this pattern:
- Input is validated as a digit-only string before `BigInt()` conversion — no `Number()` or `parseFloat()`.
- Division uses bigint integer arithmetic — no floating point.
- The result is a display string only; it is never stored, aggregated, or fed back to computation.
- The raw hearts string is also shown alongside the HEX display for audit transparency.

### HexMining scope boundaries

| Category | Status |
|---|---|
| Principal (in HEX units, backend-provided) | Displayed |
| Estimated yield (hearts → HEX display formatting) | Displayed when `yield.status === "estimated"` |
| Pricing | **Unsupported — do not display** |
| Valuation (hearts/HEX in USD or any quote asset) | **Unsupported — do not display** |
| PnL | **Unsupported — do not display** |
| eHEX (Ethereum) stakes | **Deferred — not in Phase 2** |
| HSI / HTT stakes | **Deferred — not in Phase 2** |

---

## 4. Future Desired Numbers

Numbers the product will want to display as CoinPulse matures. Each is classified by what must exist before it can be added to the UI.

| Number | Classification | Prerequisite |
|---|---|---|
| Portfolio total value (USD) | **BACKEND ENGINE REQUIRED** | `summary.totalValueQuote` in DTO + pricing engine coverage; field exists in current DTO but valuation engine must be complete |
| Per-asset token balance | **BACKEND DTO REQUIRED** | `balanceQuantity` exists in current token positions DTO; decimal precision and display unit must be documented |
| Per-asset price | **BACKEND ENGINE REQUIRED** | `pricing.confidence` exists but price quote (e.g. `pricing.priceQuote`) must be added to DTO |
| Valuation coverage percentage | **BACKEND DTO REQUIRED** | `valuationCoverage.valuedPositions / totalPositions` exists as two integers; display as fraction only, no frontend division |
| Realized PnL | **BACKEND ENGINE REQUIRED** | No backend DTO field exists yet; requires PnL engine with realized trade matching |
| Unrealized PnL | **BACKEND DTO REQUIRED** | `pnl.unrealizedPnl` exists in token positions DTO; pricing engine must be complete for this to have non-null values |
| Cost basis | **BACKEND ENGINE REQUIRED** | `pnl.averageCost` exists in DTO; average-cost engine must be complete and return non-null values |
| Transaction totals (amounts) | **BACKEND DTO REQUIRED** | Transactions DTO exists; per-entry amounts are rendered but total aggregation must come from backend, not frontend |
| Staking principal (non-HEX) | **BACKEND DTO REQUIRED** | `principalQuantity` exists in stake positions DTO; units and token identity must be documented per stake type |
| Staking yield (non-HEX) | **BACKEND ENGINE REQUIRED** | No yield estimation backend for non-HEX stakes; requires backend yield calculation per protocol |
| HEX staking yield (USD) | **UNSUPPORTED / DO NOT DISPLAY YET** | Requires pricing and valuation support for HEX, which is not in Phase 2 |
| Allocation percentages | **BACKEND DTO REQUIRED** | Backend must compute and return allocation fractions; frontend must not divide balances or values to derive percentages |
| Performance charts (time series) | **BACKEND ENGINE REQUIRED** | No time-series PnL or valuation DTO exists; requires backend materialization of historical snapshots |

**Classification definitions:**

| Label | Meaning |
|---|---|
| `SAFE NOW` | Backend field exists, unit is documented, status envelope exists, no new backend work needed |
| `BACKEND DTO REQUIRED` | The underlying engine may exist but the DTO field, unit, and status envelope must be added or verified before the UI can display it |
| `BACKEND ENGINE REQUIRED` | The backend computation or materialization pipeline does not yet produce this value |
| `UNSUPPORTED / DO NOT DISPLAY YET` | Explicitly out of scope for current phase; must not be added to UI |

---

## 5. Explicitly Unsafe Frontend Calculations

The following computations **must never be performed in the frontend**, regardless of what data is available in the DTO or from an API call:

| Forbidden calculation | Why |
|---|---|
| Token balance from raw logs / RPC | Raw event logs are not normalized; double-counts, missed events, or reorgs produce wrong balances |
| Pricing (any method) | Price derivation belongs in the backend pricing service with provenance and staleness tracking |
| Valuation (quantity × price) | Requires both balance and price correctness; must be assembled and validated by the backend |
| PnL (realized or unrealized) | Requires average-cost basis tracking across the full ledger history; not computable from a single DTO snapshot |
| Yield estimation | Yield from staking protocols depends on on-chain state at specific blocks; must come from backend evidence |
| LP position valuation | Requires current reserve ratios and pricing for both underlying tokens; must be assembled by the backend |
| Cost basis | Requires full ledger history of acquisitions; not derivable from a current-state DTO |
| Symbol-based aggregation | Token symbol/ticker is not a stable identity; `chainId + tokenAddress` is the only safe asset identity |
| Cross-chain merging by ticker | A token with the same symbol on two chains is a different asset; merging by symbol fabricates a combined balance |
| Coercing unavailable / unsupported values to zero | `null`, `"unavailable"`, `"unsupported"`, or missing fields must remain explicit; zero is a valid accounting value and must not be fabricated |
| `Number()` or `parseFloat()` on token or monetary amounts | Floating point cannot represent large token amounts or high-precision prices without silent precision loss; use bigint or string-based arithmetic |

---

## 6. Approved Display-Only Formatting

The following frontend transformations are approved because they are mechanical, contract-defined, and do not produce a different accounting value:

| Formatting | Description | Example |
|---|---|---|
| Timestamp formatting | Render ISO 8601 backend field as human-readable date/time | `TimestampLabel` component |
| Status label rendering | Render backend status enum/string as a badge or label | `StatusBadge`, `LabelBadge` |
| Address shortening | Shorten an EVM address for display; underlying identity is unchanged | `truncateAddress()` — `0xabcd…1234` |
| Hearts → HEX display | Divide backend-provided hearts string using bigint arithmetic with the protocol-constant `1e8` divisor | `formatHeartsAsHexDisplay()` — see section 3 |
| Integer → string | `String(n)` for counts, block numbers, chain IDs, day numbers | `String(source.observationsCount)` |
| Array length display | Display `array.length` as a count badge | `data.sources.length` sources |
| Percentage display | **Only if** the backend explicitly provides the percentage or fraction as a numeric field; the frontend must not compute `a/b` | e.g. `coverage.fractionValued` if added to DTO |
| Null / missing fallback labels | Show `"n/a"`, `"—"`, or `"Not provided"` when a nullable backend field is null | Never show `0` or `$0.00` for null values |

---

## 7. Readiness Checklist for Adding a New Displayed Number

Before any new numeric value is added to any frontend screen, all of the following must be satisfied:

- [ ] **Backend DTO field exists** — the field is present in a versioned, deployed DTO type
- [ ] **Unit is documented** — the base unit, display unit, and any conversion constant are stated in the DTO contract or this doc
- [ ] **Provenance / freshness / status envelope exists** — where relevant, the value has a companion `status`, `observedAt`, or `staleAfterSeconds` field
- [ ] **Unavailable / unsupported state exists** — the DTO has a defined representation for when the value is not available (null field, status enum, etc.), and the UI shows this state rather than fabricating a value
- [ ] **Tests cover the display case and the non-fabrication case** — at least one test verifies the value renders, and at least one verifies that the absent/null/unsupported state does not render a fabricated number
- [ ] **No unsafe `Number()` or floating-point usage** — amounts use bigint or string-based arithmetic; only safe integer operations (counts, block numbers) use `Number()`
- [ ] **No frontend computation beyond approved display formatting** — the UI renders or applies the mechanical transformations in section 6; it does not compute a new value

If any checkbox is unchecked, the number must not be added to the UI yet. Open a backend PR to address the gap first.

---

## 8. Recommended Next Implementation Sequence

The following bounded PR sequence is recommended to safely expand displayed numbers while preserving the backend-truth invariant:

1. **Verify and harden the prices/status backend DTO** (`GET /api/prices/status`)
   Confirm `schemaVersion`, `asOf`, `staleAfterSeconds`, and per-source `observationsCount` / `rejectedCount` fields are complete and tested. This DTO is already displayed; harden it before expanding.

2. **Add per-asset price to the dashboard token positions DTO**
   The current DTO has `pricing.confidence` and `pricing.status` but does not expose `priceQuote`. Add a `priceQuote` field (with null when unpriced) to `DashboardTokenPositionDto` and expose it in the token positions table.

3. **Verify the transactions DTO and add aggregate provenance fields**
   `GET /api/transactions` exists. Confirm `ledgerCoverage`, `asOf`, `totalCount`, and `schemaVersion` fields are present and documented before expanding transaction-page displays.

4. **Add UI number cards for token balances and prices from the existing dashboard DTO**
   Once the DTO fields above are confirmed complete, add formatted display cards for per-asset balance and price. No new backend work required if the DTO is complete.

5. **Add valuation to the portfolio summary card**
   `summary.totalValueQuote` already exists in the dashboard DTO. Display it with its `valuationStatus` badge and `valuationCoverage` count once the pricing engine produces non-null values for tracked assets.

6. **Add unrealized PnL display to token positions**
   `pnl.unrealizedPnl` exists in the token positions DTO. Add its display once the average-cost engine is confirmed to produce values; do not display while values remain null across all positions.

7. **Keep realized PnL, cost basis, and performance charts as backend-engine-gated**
   Do not add UI for these until the backend PnL engine ships and the DTO fields exist with full status envelopes.

The rule across all steps: **a backend PR ships first, then a frontend PR renders what the backend provides.** Never add a UI number in anticipation of a future backend field.
