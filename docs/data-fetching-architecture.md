# CoinPulse V1 Data Fetching Architecture

## Purpose

This document defines how CoinPulse frontend pages fetch and refresh data from backend DTOs without violating the canonical-ledger source-of-truth model.

CoinPulse V1 is PulseChain-first. PostgreSQL-backed raw audit data, canonical ledger entries, derived positions, and persisted pricing observations remain the only truth consumed by the UI. PnL is currently assembled on demand in backend DTO construction from canonical ledger truth plus stored pricing inputs, rather than being persisted as an independent source of truth. RPC is ingestion input only. The frontend must never reconstruct balances, valuations, LP values, stake values, or PnL from RPC or raw logs.

## Truth Model

CoinPulse page data must flow through this stack:

`raw audit -> canonical ledger -> derived positions/state -> pricing observations -> backend-computed PnL/valuation output -> versioned DTOs -> API routes -> frontend`

Rules:

- PostgreSQL canonical and derived state is the source of truth.
- RPC is upstream ingestion only.
- Frontend pages consume versioned backend DTOs only.
- Frontend never computes balances, prices, PnL, LP value, or stake value.
- Frontend never treats token symbols as asset identity.
- Frontend never uses DexScreener as primary truth.
- Production DTOs must never contain mock fallback data.
- PnL may be computed on demand by backend DTO assembly unless and until it is deliberately persisted as its own backend truth layer.

## Current Page Map

### Current frontend pages in the repo

- `/`
  - Current page: portfolio dashboard
  - Frontend shell: `src/app/page.tsx`
  - Stateful screen: `src/components/dashboard/dashboard-screen.tsx`
  - Currently observed frontend fetch targets:
    - `GET /api/portfolio/dashboard`
    - `GET /api/debug/health`
    - `GET /api/debug/status`
- `/debug/sync`
  - Current page: operator sync/rebuild page
  - Frontend shell: `src/app/debug/sync/page.tsx`
  - Stateful screen: `src/components/debug/debug-sync-screen.tsx`
  - Currently observed frontend fetch/mutation targets:
    - `GET /api/debug/health`
    - `GET /api/debug/status`
    - `POST /api/sync/manual`
    - `POST /api/rebuild`

### API route handlers verified in the current repo

The following handlers exist in `app/api`, verified from the repository:

- `GET /api/portfolio/dashboard`
- `GET /api/debug/health`
- `GET /api/debug/status`
- `POST /api/wallets/import`
- `POST /api/sync/manual`
- `POST /api/rebuild`

### Backend surface present, but no first-class page yet

- Wallet import
  - Implemented backend route: `POST /api/wallets/import`
  - No dedicated frontend page is currently implemented.
- Debug/status
  - Implemented backend DTO route: `GET /api/debug/status`
  - No dedicated `/debug/status` page exists yet.
- Prices/status
  - No `GET /api/prices/status` route exists yet.
  - No prices/status page exists yet.

## Future Page Map

The following are explicitly out of V1 implementation scope for now. They are listed here only to keep the fetching architecture consistent across upcoming pages.

- Transaction history
- Wallet analyzer
- Performance analytics
- Allocation
- DeFi positions
- LP detail
- Stake detail
- Cross-chain Ethereum/Base support

These pages must wait until the required derived-state and DTO contracts are sufficiently correct to support them without frontend reconstruction.

## Backend DTO Contract Strategy

Every frontend-facing read DTO should follow a consistent contract style.

### 1. Versioning

Every major read DTO should expose:

- `schemaVersion`

Current example:

- `PortfolioDashboardDto.schemaVersion = "v1"`

Rule:

- New fields may be additive within a version.
- Breaking shape changes require a new DTO version rather than silent mutation.

### 2. Provenance fields

Every DTO that exposes valuation, price, sync, or operation-state data should include provenance when available.

Examples:

- pricing source type and source id
- operation trigger and policy label
- chain id
- wallet id and wallet address
- source family

Purpose:

- let the UI render backend truth origin directly
- avoid frontend guesswork

### 3. Freshness fields

Every DTO with time-sensitive data should expose freshness explicitly.

Examples:

- `asOf`
- `timestamp`
- `observedAt`
- `staleAfterSeconds`
- `updatedAt`
- `updatedFromBlock`
- `updatedToBlock`

Rule:

- freshness semantics are defined by backend DTO fields
- frontend only displays them

### 4. Priced vs unpriced separation

Dashboard and future analytics DTOs should preserve a clear split between:

- quantity/balance truth
- pricing truth
- valuation truth
- PnL truth

Current pattern already supports this:

- `pricing.status`
- `valuation.status`
- `pnl.status`

Rule:

- unpriced or unsupported assets remain explicit
- frontend must not coerce missing priced values to zero

### 5. Confidence metadata

Valuation or price-bearing DTOs should carry backend confidence/provenance metadata, for example:

- confidence
- rejected reasons
- stale price status
- low confidence status

Purpose:

- let UI surface uncertainty without recomputation

### 6. Sync status metadata

Operational pages should expose backend sync and rebuild state explicitly.

Current pattern:

- `operationState.operations`
- `operationState.blockerSummary`
- `operationState.ingestionDiagnostics`
- `lastSuccessfulSyncAt`
- `lastRebuildAt`
- `warnings`

### 7. Partial valuation warnings

DTOs that can be partially valued should include warnings and coverage fields rather than forcing completeness.

Current pattern:

- `summary.valuationCoverage`
- `summary.warnings`
- position-level warnings on LP/stake/PnL DTOs

## Frontend Fetching Strategy

CoinPulse already includes `@tanstack/react-query`, but current pages still use manual `useEffect` and form-driven fetch calls. The production-grade target architecture is TanStack Query for all frontend reads and controlled mutations for operator actions.

### Read query ownership

Each page should fetch only page-level DTOs and page-level supporting metadata.

Recommended query ownership:

- dashboard page
  - portfolio dashboard DTO
  - debug health summary
  - debug status summary
- import/wallet page
  - mutation only for wallet import
  - optional supported chains/status metadata query
- debug/status page
  - debug health DTO
  - debug status DTO
- debug/sync page
  - debug health DTO
  - debug status DTO
  - sync/rebuild mutations
- prices/status page
  - future prices/status DTO only
- future transaction history page
  - canonical transaction DTO list only

### Recommended query keys

Use stable, explicit query keys.

```ts
["debug", "health"]
["debug", "status"]
["dashboard", schemaVersion, chainId, walletAddress, quoteAsset, asOf ?? "latest"]
["prices", "status", { chainId }]
["transactions", schemaVersion, filters]
["wallets", "tracked", chainId]
```

Rules:

- include DTO version in keys for versioned payloads
- include normalized wallet address and chain id
- include `chainId` for any chain-scoped pricing/status query
- include all server-side filters that affect returned data

### Polling rules

Recommended defaults:

- dashboard DTO
  - no background polling by default
  - manual refetch after import/sync/rebuild
  - optional 30-60 second polling only when operator explicitly enables live refresh
- debug health
  - poll every 30 seconds on debug/operator screens
- debug status
  - poll every 10-15 seconds on debug/operator screens
  - poll every 30-60 seconds on the dashboard if shown only as supporting metadata
- prices/status view
  - future route: poll every 30-60 seconds
- transaction history
  - no aggressive polling; refetch on filter change or after mutations that affect ledger scope

### `staleTime` / `gcTime` policy

Recommended defaults:

- debug health
  - `staleTime: 15_000`
  - `gcTime: 5 * 60_000`
- debug status
  - `staleTime: 10_000`
  - `gcTime: 5 * 60_000`
- dashboard
  - `staleTime: 30_000`
  - `gcTime: 10 * 60_000`
- transactions
  - `staleTime: 30_000`
  - `gcTime: 10 * 60_000`
- prices/status
  - `staleTime: 15_000`
  - `gcTime: 5 * 60_000`

Notes:

- Current React Query uses `gcTime`, not the old `cacheTime` option.
- For manual operator flows, invalidation is more important than aggressive polling.

### Error, loading, and empty states

All page modules should use shared presentation primitives rather than ad hoc rendering.

Current primitives already available:

- `src/components/ui/data-state/empty-state.tsx`
- `src/components/ui/data-state/error-state.tsx`
- `src/components/ui/data-state/loading-state.tsx`
- `src/components/ui/data-state/warning-banner.tsx`
- `src/components/ui/status/status-badge.tsx`
- `src/components/ui/value/timestamp-label.tsx`
- `src/components/ui/value/value-display.tsx`

Rules:

- loading means request in progress, not zero values
- empty means no data exists, not value zero
- errors display backend message/details when available
- warnings display backend warnings verbatim
- stale/unavailable/unsupported values remain explicit labels

### Refetch after manual sync/rebuild

After `POST /api/sync/manual` or `POST /api/rebuild`, invalidate relevant queries after:

- success
- failure
- conflict (`409`)

because persisted `SyncRun` and operation-state truth can change in all three cases.

Always invalidate:

- `["debug", "status"]`
- `["debug", "health"]` if health can change operationally
- future operation-run history queries keyed by wallet/chain

Conditionally invalidate:

- affected dashboard queries for the same wallet/chain only after derived-state materialization has run, or when the backend sync flow also triggers materialization
- future transactions queries for the same wallet/chain once ledger/derived-state changes are committed and the endpoint exists
- future prices/status query only if price coverage/status is explicitly tied to the operation and is chain-scoped

Rule:

- frontend invalidates caches
- backend remains responsible for determining when refreshed persisted truth is ready
- manual sync completion alone should primarily refresh debug/status and operation-state views unless materialization is known to have completed

## Unified Transaction Module Design

CoinPulse should converge on one canonical backend transaction DTO for all transaction-oriented views.

### Backend canonical transaction DTO

Future DTO shape should be ledger-first and action-group aware.

Recommended fields:

- `schemaVersion`
- `transactionId`
- `txHash`
- `chainId`
- `walletId`
- `walletAddress`
- `occurredAt`
- `blockNumber`
- `actionGroupId`
- `actionType`
- `sourceFamily`
- `protocol`
- `entries[]`
  - `entryId`
  - `assetId`
  - `assetAddress`
  - `entryType`
  - `direction`
  - `quantity`
  - `pricing`
  - `valuation`
  - `pnlImpact`
  - `warnings`
- `provenance`
- `syncMetadata`

Rule:

- backend constructs canonical transaction views from persisted ledger/action-group truth
- frontend must not reconstruct transactions from raw logs

### Shared frontend transaction module

Future frontend should use one shared transaction module with:

- shared table view
- shared mobile card view
- shared filter state model
- shared pagination/infinite-scroll adapter

Supported filters:

- wallet
- asset
- entry type
- source family
- protocol
- date range

Rule:

- filters are translated to backend query params
- frontend does not do semantic post-processing to invent missing transaction meaning

## API Route Map

### API route handlers implemented today

- `GET /api/portfolio/dashboard`
- `GET /api/debug/health`
- `GET /api/debug/status`
- `POST /api/wallets/import`
- `POST /api/sync/manual`
- `POST /api/rebuild`

### Preferred future normalized route map

The long-term frontend contract should standardize on these DTO-oriented reads:

- `GET /api/dashboard`
  - preferred future alias/replacement for current `GET /api/portfolio/dashboard`
- `GET /api/debug/status`
- `GET /api/debug/health`
- `GET /api/prices/status`
  - future
- `GET /api/transactions`
  - future canonical transaction history endpoint
- `POST /api/wallets/import`
- `POST /api/sync/manual`
- `POST /api/rebuild`

Important:

- V1 should not rename stable routes casually
- if a route normalization happens, support a compatibility period rather than a silent frontend break

## Chain Extensibility

### PulseChain V1

PulseChain remains the only execution target in V1.

What stays PulseChain-specific today:

- supported chain list defaults
- native asset identity `chain:369:native:PLS`
- source-family behavior tuned to PulseChain ingestion
- operator defaults such as chain id `369`

### Future Ethereum/Base support

Ethereum/Base support is future scope only. No execution should be implemented in this slice.

What must become chain-agnostic in DTO/fetch design:

- query keys include `chainId`
- route contracts always take chain context explicitly
- wallet identity is `(walletAddress, chainId)`, not address alone
- transaction DTOs use `assetId`, not symbol
- pricing, valuation, and sync status surfaces are chain-aware

What should remain chain-specific behind the backend boundary:

- RPC adapters
- source-family ingestion logic
- protocol classification
- chain-native asset identifiers
- chain-specific sync planning and scan windows

## Guardrails

- No direct frontend RPC calls.
- No DexScreener truth as primary data source.
- No symbol-based asset identity.
- No mock production data in DTOs.
- No frontend balance, price, PnL, LP, or stake computation.
- No broad page expansion before derived-state correctness is proven.
- No backend truth bypass through client-side joins over raw rows.

## Recommended Implementation Sequence

1. Standardize current frontend fetches on TanStack Query without changing DTO semantics.
2. Introduce a shared frontend query-key module for dashboard/debug data.
3. Add a dedicated wallet import page that consumes only backend validation and wallet-import DTOs.
4. Add a dedicated debug/status page that renders existing backend debug/status DTOs.
5. Add a backend `GET /api/prices/status` DTO for persisted pricing observability.
6. Design and implement a canonical `GET /api/transactions` backend DTO from persisted ledger/action-group truth.
7. Build one shared frontend transaction module on top of that DTO.
8. Only after transaction and pricing truth is solid, expand into analytics/allocation/DeFi detail pages.

## Risks

- Current dashboard and debug pages still use manual fetch state instead of React Query, so invalidation and polling behavior are not yet standardized.
- Current dashboard route name is `GET /api/portfolio/dashboard`, while the preferred architecture wants `GET /api/dashboard`; this should be handled as a deliberate compatibility transition, not an implicit rename.
- `GET /api/prices/status` and `GET /api/transactions` do not exist yet, so future page design must wait for DTO-first backend work.
- Multi-family sync diagnostics already show that operational metadata can be nuanced; future DTOs must preserve uncertainty explicitly instead of simplifying it away.

## V1 Decision Summary

For CoinPulse V1, the frontend architecture should be DTO-first, query-keyed, and operation-aware:

- dashboard and debug views consume persisted backend DTOs only
- operator mutations invalidate reads but never compute truth locally
- future transaction and analytics pages are built on canonical backend DTOs, not raw-log reconstruction
- PulseChain remains the only execution target until backend truth is stable enough to generalize
