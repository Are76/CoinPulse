# CoinPulse V1 Design

Date: 2026-05-08
Topic: On-demand indexed PulseChain portfolio core

## Product Summary

CoinPulse V1 is a PulseChain-first, no-auth, read-only portfolio analytics product focused on data correctness rather than page breadth. The first milestone ships a production-shaped portfolio engine with a narrow UI: wallet import, one primary dashboard, and one debug/sync page.

The system tracks multiple PulseChain wallet addresses in one locally selected portfolio, performs full historical sync from chain genesis or from configured safe protocol/token start blocks where valid, stores raw chain data and a canonical ledger in PostgreSQL, computes balances and average-cost PnL server-side, and serves the dashboard from persisted truth.

Core principle:

> The database-backed ledger is the source of truth. RPC is only the upstream data source. The UI only reads normalized and computed backend data.

## Milestone 1 Scope

Included:

- Multiple wallet import by PulseChain address
- Local persistence of selected wallets in the browser
- PostgreSQL-backed backend storage
- Full historical sync on demand
- Manual sync and manual rebuild flows
- Raw chain audit storage
- Canonical ledger storage
- Live price service
- Average-cost PnL
- Spot balances
- Transaction history for portfolio-relevant activity
- PulseX LP tracking for core detection, state, and valuation
- HEX/pHEX stake tracking for core detection, state, and valuation
- One clean dashboard
- One debug/sync status page

Explicitly excluded from Milestone 1:

- User accounts
- Automatic background sync
- Full automatic indexer platform
- Ethereum and Base execution
- Alerts, watchlists, protocol pages, token pages, wallet pages, admin suite
- Lot-level accounting
- Advanced LP yield/APY modeling
- Advanced HEX yield/tax modeling
- Third-party indexed APIs as primary truth sources

## High-Level Architecture

CoinPulse V1 runs as a single Next.js 15 application with clear domain boundaries:

- UI layer for import, dashboard, and debug views
- Route handlers for API access
- Domain services for ingestion, normalization, pricing, balances, PnL, snapshots, and rebuilds
- PostgreSQL for persistent truth
- Redis for cache and short-lived coordination
- PulseChain RPC for upstream blockchain data

The architecture is intentionally worker-compatible. In Milestone 1, sync may run from API-triggered server execution for local and small-wallet workflows, but the sync orchestration and contracts must be portable to a future queue/worker runtime without changing the ledger, API, or UI contracts.

## System Boundaries

### Truth Layers

The system has three distinct truth layers:

1. Raw audit layer
   Raw blocks, transactions, logs, token metadata reads, sync cursors, request traces, and reorg records as fetched from RPC.
2. Canonical ledger layer
   Deterministic normalized asset movements and grouped transaction actions derived from raw audit data.
3. Derived state layer
   Materialized balances, LP states, HEX stake states, PnL states, price points, and portfolio snapshots.

### Critical Data Integrity Rules

- Raw chain data is the immutable audit layer.
- Canonical ledger entries are deterministic and rebuildable.
- Derived balances, positions, PnL, and snapshots are materialized views.
- Sync and normalization must be idempotent.
- Re-running the same sync range must not duplicate raw events, ledger entries, balances, or snapshots.
- Ledger events must include a `normalizerVersion`.
- Canonical ledger and derived state can be deleted and rebuilt from raw chain data at any time.
- UI must never compute portfolio truth directly from raw RPC data.

## Chain Configuration

Milestone 1 executes only against PulseChain, but every core type and service must remain chain-extensible.

- PulseChain chain ID: `369`
- PulseChain RPC: `https://rpc.pulsechainstats.com`
- Native asset identity: `chain:369:native:PLS`
- pHEX contract: `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`
- pHEX decimals: `8`

Future chain support for Ethereum and Base should fit the same abstractions without rewriting ingestion, normalization, pricing, or PnL engines.

## Asset Identity Rules

Assets are identified only by:

- `chainId`
- `tokenAddress` for ERC-20 assets, or a deterministic native asset ID for native gas tokens

Symbols, names, logos, and ticker text are metadata only. They must never be used as accounting identifiers.

Native PLS must be represented using a deterministic pseudo-address or asset ID such as `chain:369:native:PLS`.

## Frontend Architecture

The frontend uses the Next.js App Router with server-rendered route shells and client-side data fetching for interactive state and polling.

Key decisions:

- One global app shell
- Dark mode default with a light-mode equivalent token set
- TanStack Query for dashboard and debug page data fetching
- Zustand or React Context only for local UI state such as selected wallet set and filters
- shadcn/ui as the sole component system
- Tailwind CSS tokens for layout, typography, color, and spacing consistency

The UI reads versioned DTOs from backend APIs and never derives balances, PnL, or valuation from RPC.

## Backend and API Architecture

The backend is split into these modules:

- `services/chains`
  Chain configuration, RPC clients, native asset definitions
- `services/ingestion`
  Logs-first fetch orchestration, block planning, raw record persistence, reorg checks
- `services/normalization`
  Deterministic conversion from raw records to canonical ledger entries and action groups
- `services/pricing`
  Token metadata reads, on-chain pool discovery, price routing, confidence scoring, and cache
- `services/pnl`
  Interchangeable accounting engines with Milestone 1 average-cost implementation
- `services/portfolio`
  Balance derivation, position state, snapshots, dashboard DTO assembly
- `services/rebuild`
  Ledger and derived-state rebuilds from raw audit data
- `services/debug`
  Sync status, coverage metrics, pricing health, normalizer visibility

### API Endpoints

- `POST /api/wallets/import`
  Upsert one or more PulseChain wallet addresses and optionally trigger initial sync.
- `GET /api/wallets`
  Return tracked wallet records with latest sync status.
- `POST /api/sync`
  Trigger manual sync for one wallet or all tracked wallets.
- `GET /api/sync/:runId`
  Return sync stage, progress, counts, warnings, and failures.
- `POST /api/rebuild`
  Rebuild canonical ledger and derived state from raw audit data.
- `GET /api/dashboard`
  Return a versioned dashboard DTO for the selected wallet set.
- `GET /api/debug/sync`
  Return operator-facing sync, cursor, raw-ingestion, normalization, and rebuild diagnostics.
- `GET /api/prices/status`
  Return price coverage, stale prices, rejected sources, confidence levels, and unpriced assets.
- `GET /api/health`
  Return database, Redis, and RPC health.

## Database Architecture

PostgreSQL is the source-of-truth store. All quantity and money columns must use fixed-precision decimals, never binary floats.

Milestone 1 requires these table groups:

### Reference Tables

- `chains`
- `wallets`
- `tokens`
- `token_metadata_sources`
- `protocols`
- `asset_flags`

### Raw Audit Tables

- `raw_blocks`
- `raw_transactions`
- `raw_logs`
- `raw_token_transfers`
- `sync_runs`
- `sync_cursors`
- `rpc_request_logs`
- `reorg_events`

### Canonical Ledger Tables

- `ledger_action_groups`
- `ledger_entries`

### Derived State Tables

- `wallet_token_balances`
- `wallet_pnl_states`
- `wallet_lp_positions`
- `wallet_hex_stakes`
- `price_points`
- `wallet_snapshots`

### Core Database Rules

- Raw uniqueness is keyed by deterministic on-chain identity, including block hash.
- Ledger uniqueness is keyed by deterministic normalization identity.
- Derived tables are rebuilt or upserted from deterministic recomputation.
- Token decimals must be stored with source attribution.
- Incorrect decimals are treated as critical data corruption risk.

## Blockchain Data Architecture

### Logs-First Ingestion

The ingestion layer is logs-first. This is the default strategy for EVM scalability and determinism.

The system should:

- Fetch logs in bounded block windows per wallet and protocol family
- Fetch transaction and receipt metadata only when normalization requires it
- Persist block hashes alongside raw data
- Track cursors per wallet, chain, and source family

Logs-first gives better resumability, lower RPC cost, and more stable normalization inputs than transaction-scanning-first approaches.

### Sync Start Policy

Milestone 1 does not promise genesis scans for every protocol blindly. Sync begins:

- From chain genesis when necessary
- Or from configured safe start blocks for specific protocols or tokens where earlier history is irrelevant or impossible to affect current supported features

This policy must remain explicit and auditable in sync-run metadata.

### Reorg Handling

Raw ingestion must support limited chain reorganization recovery.

The system should:

- Persist block hash with all raw records
- Detect block hash mismatches on later sync
- Roll back affected ranges when reorgs are detected
- Re-run normalization and derived recomputation for affected blocks

Milestone 1 may use a bounded rollback window strategy rather than a full reorg engine.

## Ledger Architecture

The canonical ledger is the accounting core of CoinPulse.

### Ledger Atomicity

Canonical ledger events may belong to grouped transaction actions.

One transaction can produce multiple atomic entries. Example:

- `SWAP_OUT`
- `SWAP_IN`
- `FEE`

All related entries share:

- `txHash`
- `actionGroupId`
- `timestamp`

### Supported Ledger Entry Types

Milestone 1 should support at minimum:

- `RECEIVE`
- `SEND`
- `SWAP_IN`
- `SWAP_OUT`
- `FEE`
- `LP_ADD_IN`
- `LP_ADD_OUT`
- `LP_REMOVE_IN`
- `LP_REMOVE_OUT`
- `STAKE_LOCK`
- `STAKE_UNLOCK`
- `STAKE_REWARD`
- `INTERNAL_TRANSFER`
- `APPROVAL_IGNORE`

Pure transfers between tracked wallets must not create artificial realized PnL. Internal transfers should remain visible for audit but must be neutral to realized performance.

## Pricing Architecture

Pricing must be conservative, source-aware, and PulseChain-first.

### Pricing Rules

- Never use DexScreener as the primary price source.
- Prefer on-chain PulseChain LP reserve-derived pricing.
- Use route-based valuation, such as token -> WPLS -> stronger USD reference asset.
- Treat pDAI as volatile, never forced to 1 USD.
- Persist every price with source attribution, route metadata, and confidence.

### Pricing Confidence Rules

Prices below minimum liquidity or route-confidence thresholds must not contribute to default portfolio valuation.

The pricing layer must support:

- liquidity thresholds
- stale-price thresholds
- confidence scores
- source attribution

### Valuation Behavior

- Portfolio totals must separate priced and unpriced value.
- PnL must degrade gracefully when price coverage is missing.
- Historical valuation uses bounded nearest-valid stored prices, not blind latest-price backfill.
- Every visible number must show freshness, source, or confidence when relevant.

This applies especially to:

- portfolio value
- token price
- PnL
- unpriced value
- LP valuation
- HEX/pHEX stake valuation

## PnL Architecture

Milestone 1 uses average-cost accounting per wallet, per chain, per token.

Lot-based accounting is out of scope, but the architecture must allow future `FIFO`, `LIFO`, or select-lot engines without rewriting portfolio services.

### PnL Engine Structure

Required module layout:

- `services/pnl/types.ts`
- `services/pnl/utils.ts`
- `services/pnl/average-cost-engine.ts`
- `services/pnl/fifo-engine.ts`
- `services/pnl/lifo-engine.ts`

Only the average-cost engine must be fully implemented in Milestone 1. Other engines may remain compile-safe stubs or unselected implementations behind the same interface.

### PnL Engine Interface

```ts
interface PnLEngine {
  calculateAverageCost(): Decimal
  calculateRealizedPnL(): Decimal
  calculateUnrealizedPnL(currentPrice: Decimal): Decimal
}
```

Usage:

```ts
calculatePnL({
  method: "AVERAGE_COST",
})
```

### Average-Cost State

Track per wallet, chain, token:

- total acquired
- total disposed
- current balance
- average acquisition price
- realized pnl
- unrealized pnl

### Formulae

Average Cost Basis:

```text
sum(purchase value) / sum(tokens acquired)
```

Unrealized PnL:

```text
(current price - average cost) * current holdings
```

Realized PnL:

```text
(sell price - average cost) * amount sold
```

### PnL Behavior Rules

- Buys and inbound swap legs increase quantity and adjust weighted average cost.
- Sells and outbound swap legs realize PnL against the current average cost.
- Pure transfers between tracked wallets do not realize PnL.
- Fees paid in native asset or token form must be recorded explicitly and valued separately.
- LP and stake actions must map to canonical asset movements so balances remain consistent even when advanced yield accounting is excluded.

## Snapshot Strategy

Portfolio snapshots are materialized point-in-time portfolio states used for fast dashboard rendering and historical performance views.

Snapshots may be:

- full rebuild snapshots
- incremental snapshots

Milestone 1 may rebuild snapshots on sync completion.

## Spam Asset Policy

Spam, scam, and dust assets must never be deleted from ledger truth.

Instead:

- mark them as ignored
- exclude them from default valuation
- exclude them from default UI views
- preserve them in audit and debug visibility

## Caching Strategy

Redis is used as a cache and coordination helper, not as a source of truth.

Recommended use:

- RPC response memoization for metadata and recent block reads
- price cache for active valuation routes
- short-lived sync locks to avoid duplicate concurrent runs
- debug/status polling acceleration

If Redis is unavailable, the application must remain correct, only slower.

## Error Handling Strategy

Error handling must name the failed layer and preserve recovery paths.

Examples:

- ingestion errors identify RPC method, block window, and wallet scope
- normalization errors identify raw record range and normalizer version
- pricing errors identify token, route, liquidity failure, or stale-source failure
- rebuild errors identify source tables and failed stage

The debug page should surface actionable failure states, not generic messages.

## Security Strategy

Milestone 1 is no-auth, but security still matters:

- validate and checksum wallet addresses
- validate all API payloads with Zod
- rate-limit sync and rebuild endpoints
- never trust token metadata blindly
- never use symbols as accounting identity
- avoid exposing raw RPC secrets to the client
- keep server-side services behind route handlers only
- treat rebuild and debug actions as operator-scoped for future auth introduction

## Deployment Strategy

Local development must run with:

- `npm install`
- `prisma migrate dev`
- `npm run dev`

The application should be Vercel-compatible for the UI and API layer, but Milestone 1 must acknowledge that very large sync jobs may exceed serverless execution limits. Service boundaries must allow future movement of sync execution into a worker or queue without rewriting the data model or frontend contracts.

For local-first correctness, milestone execution is optimized for developer-hosted runs and small-to-medium wallet sets.

## Future Scaling Strategy

Milestone 1 should evolve cleanly into a broader platform:

- Move sync orchestration from API-triggered execution to queue-driven workers
- Add Ethereum and Base using the same chain abstractions
- Expand pricing sources and confidence policies
- Introduce background sync and alerting
- Add user accounts and saved portfolios
- Add lot-based accounting engines
- Add protocol pages, token pages, and analytics depth

## UI Architecture

### Product Surface

Milestone 1 uses a narrow route set:

- `/`
  Import and wallet management
- `/dashboard`
  Main portfolio dashboard
- `/debug/sync`
  Operator-facing sync, rebuild, and pricing diagnostics

This keeps v1 honest:

Import -> Dashboard -> Debug

### App Shell

Use one shared shell across the app:

- left sidebar on desktop
- top utility bar on all screen sizes
- centered max-width layout grid
- consistent card system
- dark mode default with light-mode support

### Dashboard Contract

The dashboard reads one backend DTO with `schemaVersion`.

The DTO includes:

- selected wallets
- latest sync per wallet
- total value
- priced value
- unpriced value
- realized pnl
- unrealized pnl
- holdings rows
- LP summaries
- HEX/pHEX stake summaries
- recent canonical activity
- warnings and provenance metadata

### Debug Contract

The debug page includes:

- sync run timeline
- latest cursor state
- raw coverage
- reorg incidents
- normalization counts by version
- price coverage status
- rejected or stale price reasons
- rebuild controls and last rebuild summary
- ignored/spam asset visibility

### UI Rules

- Every visible number must show freshness, source, or confidence when relevant.
- The UI should surface provenance.
- Token rows must show explicit unpriced state instead of fake zeroes.
- Error and empty states must explain what is missing and what action can be taken.
- The UI must stay visually narrow and consistent, not simulate a full product suite.

## Success Criteria

Milestone 1 succeeds if CoinPulse can:

- Import multiple PulseChain wallets
- Run full on-demand sync safely
- Persist raw chain data and canonical ledger deterministically
- Rebuild ledger and derived state from raw data
- Detect and recover from bounded reorgs
- Price supported assets conservatively
- Calculate balances correctly
- Calculate realized and unrealized PnL correctly under average-cost rules
- Track PulseX LP and HEX/pHEX stake state for core valuation use
- Render one trustworthy dashboard and one trustworthy debug page

## Final Engineering Principle

Milestone 1 should prove the portfolio engine, not the whole app.

The boundary is intentionally narrow: strong data foundation, PostgreSQL-backed ledger, PulseChain-first ingestion, manual sync, and average-cost PnL.
