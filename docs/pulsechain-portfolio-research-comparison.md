# PulseChain Portfolio Research Comparison

## 1. Purpose

This document compares two external PulseChain portfolio research sources with CoinPulse V1's current data-quality architecture:

1. **PulsePort portfolio tracker research** — an earlier PulsePort-style tracker design described in an uploaded PDF (referred to as _PulseChain Portfolio Tracker.pdf_). The PDF covered hooks/utilities for liquidity positions, token search, cost-basis rows, P&L cards, investment tables, holdings tables, and profit planning, and identified several architectural gaps.
2. **PulseChain data-source research** — a companion research report (referred to as _grundig-research-rapport.md / PulseChain Support Plan for PulsePort Portfolio Tracker_) covering RPC, Blockscout, PulseX token lists, CoinGecko/GeckoTerminal, DexScreener, Piteas, Moralis, Dwellir, token identity, history limits, and DeFi data gaps.

**This PR is documentation only.** It does not implement any code, schema, route, package, or infrastructure change.

Claims in this document are anchored to:

- `docs/data-fetching-architecture.md`
- `docs/frontend-query-standardization-audit.md`
- `docs/dashboard-data-quality-audit.md`
- `docs/reusable-backend-template-plan.md`
- `docs/reusable-data-fetching-template-plan.md`
- `docs/dashboard-wallet-selection-plan.md`
- `AGENTS.md`
- `src/services/dashboard/types.ts`
- `src/services/dashboard/portfolio-dashboard.ts`
- `app/api/portfolio/dashboard/route.ts`
- `src/lib/query/`

The uploaded PDF and research markdown were provided as context only. Where direct content from those files is summarized below, it is based on the problem-statement description of their contents, not a raw file read.

---

## 2. What the PulsePort Research Says

### 2.1 What PulsePort had

The PulsePort-style tracker described in the uploaded PDF included:

- Portfolio overview with total holdings value.
- Liquidity-position tracking with entry and current value.
- Token search and discovery.
- Cost-basis rows and P&L cards per position.
- Investment tables (`MyInvestmentsTable`) and holdings tables (`HoldingsTable`).
- Profit planning features.

The frontend used React hooks and utility functions directly as the canonical data-fetching and computation layer:

- `useLiquidityPositions` — hook for LP state.
- `useTokenSearch` — hook for token discovery.
- `buildInvestmentRows` — utility for constructing P&L row data client-side.
- `TokenPnLCard` — component that computed or presented P&L per token.
- `MyInvestmentsTable` and `HoldingsTable` — components that rendered assembled investment and holdings data.

These hooks and utilities operated directly against chain state (RPC, subgraph, or on-chain reads) or derived data inside the frontend, without a durable backend ledger or versioned DTO contract sitting between the chain reads and the UI.

### 2.2 Gaps the PulsePort research identified

The PulsePort research documented the following architectural gaps:

- **PulseChain transaction ingestion gap** — Limited or inconsistent ingestion of PulseChain transaction history, making cost-basis reconstruction unreliable.
- **Scattered data fetching** — Multiple independent React hooks and ad hoc fetch paths, each with their own caching and staleness behavior, without a unified data-access layer.
- **No unified price service** — Prices were pulled from multiple sources with no canonical hierarchy, confidence score, provenance tracking, or staleness guard.
- **Bridge detection gaps** — Cross-chain transfers (PulseChain ↔ Ethereum) were not reliably detected, causing ledger entries to appear as unexplained inflows or outflows.
- **RPC performance risks** — Heavy reliance on direct PulseChain RPC reads from the frontend introduced latency, rate-limit, and failure risks during high traffic.
- **Analytics gaps** — No reliable on-chain analytics beyond basic balances; no transaction classification engine.
- **Modularity gap** — Presentation, data fetching, and computation were tightly coupled inside React components and hooks, making the system hard to test, audit, or extend.

### 2.3 PulsePort's recommended roadmap

The PulsePort research recommended the following implementation sequence:

1. **Data layer refactor first** — establish a unified data-access layer before expanding UI features.
2. **PulseChain transaction ingestion second** — implement reliable on-chain ingestion and canonical ledger construction before adding cost-basis or PnL features.
3. **Analytics engine third** — build an analytics/classification engine on top of a stable ledger.
4. **Wallet analyzer UI fourth** — only build a richer wallet analyzer after the backend data quality is stable enough to support it.

---

## 3. What the PulseChain Data-Source Research Says

The companion data-source research report covered the following findings about available PulseChain data sources:

### 3.1 RPC

- Useful for chain-state reads: current balances, block numbers, on-chain contract calls.
- Not suitable as the sole source of history or indexed analytics; history access via RPC requires log filtering over large block ranges, which is slow and fragile.
- Rate limits and node availability are significant production risks if frontend code calls RPC directly.

### 3.2 Blockscout

- Useful for indexed transaction history and token metadata queries.
- Has documented limits: rate limits, coverage gaps on deep history, and inconsistency in indexing exotic token types.
- Suitable as a supplementary ingestion source for indexed history, not as the sole trusted truth.

### 3.3 PulseX token lists and on-chain metadata

- PulseX token lists are useful for token discovery and display metadata (name, symbol, logo).
- On-chain contract metadata (`name()`, `symbol()`, `decimals()`) is useful for canonical attribute resolution.
- **Token symbols must never be used as accounting identity.** The correct identity is `chainId + contractAddress`.

### 3.4 Price data

- Price data from any single source (DexScreener, GeckoTerminal, CoinGecko, on-chain reserves) carries uncertainty.
- Each source has freshness limits, liquidity thresholds, route quality differences, and manipulation risks.
- A robust price service requires source hierarchy, confidence scoring, provenance tracking, and explicit staleness guards.
- On-chain PulseChain reserve-derived pricing (e.g., PulseX LP reserves) with route and liquidity metadata is preferred over third-party aggregators as the primary truth for PulseChain assets.
- DexScreener provides useful discovery signals but must not be treated as canonical pricing truth.
- pDAI is documented as volatile and must not be hardcoded to $1.

### 3.5 DeFi, LP, and stake analytics

- LP position analytics require understanding pool reserves, share amounts, underlying token ratios, and fee accrual. These are not safely computable from basic balance reads alone.
- Stake position analytics require protocol-specific adapter logic for each staking contract.
- Heavy-wallet analytics (large transaction volumes, complex DeFi activity) require custom ingestion adapters beyond basic log filtering.
- These areas require purpose-built backend adapters before any UI can surface them safely.

### 3.6 Asset identity

- Symbols and tickers are unreliable as accounting identity due to name collisions, upgrades, and cross-chain ambiguity.
- Correct asset identity is `chainId + contractAddress` (or a deterministic native-asset identifier such as `chain:369:native:PLS`).

---

## 4. CoinPulse V1 Current Position

CoinPulse V1 is intentionally stricter than the PulsePort architecture described above. The following is the current V1 position, anchored to existing documentation and code.

### 4.1 Backend owns truth

The PostgreSQL-backed ledger and derived portfolio state are the source of truth. RPC is upstream ingestion input only. The frontend never holds or computes portfolio truth.

Reference: `docs/data-fetching-architecture.md` — Truth Model section.

### 4.2 Frontend consumes versioned DTOs only

The dashboard read path is:

```
persisted state (PostgreSQL)
  → assemblePortfolioDashboard()
    → PortfolioDashboardDto (schemaVersion: "v1")
      → GET /api/portfolio/dashboard
        → fetchPortfolioDashboard() / useDashboardQuery
          → DashboardScreen presenters
```

Reference: `docs/dashboard-data-quality-audit.md` — Section 2.

### 4.3 TanStack Query manages all frontend reads

All frontend reads go through TanStack Query with explicit query keys, `staleTime`, `gcTime`, and polling policies. No `useEffect`/`fetch` manual calls remain in production data paths.

Reference: `src/lib/query/`, `docs/frontend-query-standardization-audit.md`.

### 4.4 Operator actions use mutation hooks

Sync and rebuild are submitted via `useSyncManualMutation` and `useRebuildMutation`. These hooks encode the correct post-mutation invalidation policy: always invalidate `["debug","status"]`; conditionally invalidate dashboard queries only when materialization is confirmed complete.

Reference: `docs/frontend-query-standardization-audit.md` — P4.

### 4.5 Route contracts and behavior tests protect request semantics

API route contracts and operator-behavior integration tests ensure that DTO shape, error responses, and mutation semantics remain stable across PRs.

Reference: `docs/reusable-backend-template-plan.md`.

### 4.6 LP and stake valuation is explicitly unsupported

LP positions and stake positions are represented in the dashboard DTO with explicit `status: "unsupported"` sentinels. The frontend does not coerce these to zero or attempt reconstruction.

Reference: `src/services/dashboard/types.ts`, `docs/dashboard-data-quality-audit.md` — Sections 4.5, 4.6.

### 4.7 Unknown and unpriced is better than unsafe valuation

Pricing status, valuation status, and PnL status are carried as explicit fields (`"available"`, `"partial"`, `"unavailable"`, `"unsupported"`). The frontend never guesses or defaults missing values to zero.

Reference: `docs/data-fetching-architecture.md` — Sections 4, 5.

### 4.8 Frontend must not compute any financial truth

The following are permanent frontend guardrails in CoinPulse V1:

- No frontend balance computation.
- No frontend price computation.
- No frontend PnL computation.
- No frontend LP valuation.
- No frontend stake valuation.
- No frontend transaction reconstruction.
- No direct frontend RPC calls.

Reference: `docs/data-fetching-architecture.md` — Guardrails section; `AGENTS.md`.

### 4.9 Materialization staleness is now tracked

As of PR #56, the dashboard DTO includes a `materialization.stalenessIndicator` field. This allows the frontend to surface explicit staleness warnings without computing staleness itself.

Reference: `docs/dashboard-data-quality-audit.md` — Section 4.2.

---

## 5. Alignment Table

The following table maps each finding from the PulsePort and PulseChain data-source research to CoinPulse V1's current position.

| Research finding | CoinPulse V1 status | Decision |
|---|---|---|
| **Unified data-access layer** | Implemented: backend assembler + versioned DTO + TanStack Query layer. | Architecture aligned. Continue hardening DTO contracts before expanding surface. |
| **PulseChain transaction ingestion** | Partial: sync/rebuild runs ingestion; canonical ledger is being built. Full transaction history endpoint does not yet exist. | Continue building canonical ledger; defer `GET /api/transactions` DTO until ledger coverage is confirmed. |
| **Cost-basis and PnL** | Partial: PnL is assembled on demand in DTO from ledger truth + pricing observations. No persisted PnL layer yet. LP/stake PnL is explicitly unsupported. | Do not add frontend PnL reconstruction. Persist PnL as a separate backend layer when ledger and pricing are stable. |
| **Bridge detection** | Not yet implemented: no cross-chain bridge detection logic exists in V1. | Explicitly unsupported in V1. Flag as a future ingestion adapter, not a frontend concern. |
| **Token identity** | Implemented: asset identity is `chainId + contractAddress` throughout. Symbols are never used as accounting identity. | Architecture aligned. Enforce in all future DTOs and ingestion paths. |
| **Token metadata** | Partial: PulseX token list and on-chain metadata support token discovery. Display metadata (name, symbol, logo) is separate from accounting identity. | Continue treating display metadata as non-canonical. Build a formal token-metadata service before exposing discovery features. |
| **Pricing provenance** | Partial: pricing source type and source ID are carried in DTO. No full confidence-score and route-quality metadata yet. DexScreener is excluded from canonical truth. | Implement full pricing provenance (confidence, route, liquidity, freshness) before surfacing price quality in the UI. |
| **RPC performance** | Addressed architecturally: no direct frontend RPC calls. Backend controls RPC usage in ingestion only. | Maintain the guardrail. Never add direct frontend RPC. |
| **LP and stake valuation** | Explicitly unsupported in V1 DTO. No frontend reconstruction. | Keep explicit. Build protocol-specific adapters in backend before surfacing LP/stake values. |
| **Wallet analyzer UI** | Not implemented. No wallet analyzer page exists. | Defer until backend DTOs for transaction history, LP, and stake are stable and tested. |
| **Export and reporting** | Not implemented. | Defer. Not a V1 scope item. Requires canonical transaction DTO first. |

---

## 6. What Not to Copy from PulsePort

The following PulsePort patterns must not be introduced into CoinPulse V1:

### 6.1 React hooks as canonical data-fetching truth

PulsePort used `useLiquidityPositions`, `useTokenSearch`, and similar hooks as the primary data layer, with the hooks calling RPC or subgraph directly. CoinPulse V1 must use backend DTOs as truth. React hooks (`useQuery`, `useMutation`) are transport wrappers only — they do not own or compute data.

### 6.2 Frontend RPC or subgraph truth

No CoinPulse frontend component, hook, or utility may call any RPC endpoint or subgraph directly. RPC is ingestion input for the backend only.

### 6.3 Frontend cost-basis reconstruction

`buildInvestmentRows` or equivalent utilities that reconstruct cost-basis or PnL inside the frontend must not be added. Cost-basis and PnL belong in the backend DTO assembly layer, where they are computed from persisted ledger and pricing truth.

### 6.4 UI-computed LP valuation

LP position values must not be computed inside any UI component or hook. The backend must supply LP valuation with explicit provenance; the UI renders the backend's answer. Until the backend can supply a reliable LP valuation, the UI must show the explicit `"unsupported"` state, not a guess.

### 6.5 Symbol-based asset identity

Token symbols (e.g., `"PLS"`, `"HEX"`, `"PLSX"`) must never serve as accounting identity in any data path — query keys, ledger entries, pricing lookups, or DTO references. The identity is always `chainId + contractAddress` or the deterministic native-asset identifier.

### 6.6 DexScreener or subgraph as canonical price truth

DexScreener provides useful price discovery but must not be the primary or canonical pricing source. On-chain PulseChain reserve-derived pricing with documented provenance is preferred. pDAI must never be hardcoded to $1.

### 6.7 Broad wallet analyzer UI before backend DTO quality is stable

PulsePort identified the wallet analyzer UI as desirable. CoinPulse V1 must not build this UI before the backend can support it. The correct sequence is: stable canonical ledger → reliable pricing provenance → canonical transaction DTO → then wallet analyzer UI.

---

## 7. V1 Roadmap Impact

The PulsePort and data-source research both validate the current CoinPulse V1 development sequence. The research confirms that the following next steps are correct:

1. **Materialization staleness indicator** — already delivered in PR #56; continues the DTO quality track.
2. **Ledger and source coverage warnings** — add explicit coverage indicators to the DTO so the frontend can surface partial-sync states without computing them.
3. **Pricing status endpoint** — `GET /api/prices/status` does not yet exist; implement it to expose pricing provenance, confidence, source hierarchy, and freshness metadata in a dedicated DTO.
4. **Provenance and freshness contract tests** — add route-level tests that assert pricing source, confidence, and freshness fields are present and non-null in DTO responses.
5. **Token identity and origin metadata plan** — write a bounded planning document for how token metadata (name, symbol, logo, list source) is separated from accounting identity before any token-discovery UI is built.
6. **Only then: richer analytics UI** — transaction history page, wallet analyzer, LP detail, stake detail, and performance analytics pages may only be added after the above backend truth and DTO quality work is confirmed stable.

This sequence directly mirrors the roadmap the PulsePort research recommended: data layer first, ingestion second, analytics engine third, UI last.

---

## 8. Non-Goals

This document and the PR that delivers it will not:

- Change any source code.
- Change any test files.
- Change any package files (`package.json`, `package-lock.json`, etc.).
- Change or add any Prisma schema or migration.
- Change any API routes or route handlers.
- Change any dashboard UI components.
- Change any pricing logic or pricing service code.
- Add any provider integrations (DexScreener, Blockscout, Moralis, Dwellir, Piteas, GeckoTerminal, etc.).
- Add any new dependencies.
- Add any Ethereum/Base execution.
- Implement any wallet analyzer UI.
- Implement any transaction history endpoint.

---

## 9. Decision

1. **Use the research as validation and roadmap input.** Both the PulsePort tracker research and the PulseChain data-source research confirm that CoinPulse V1's backend-first, DTO-owned, ledger-anchored architecture is the correct direction.

2. **Keep CoinPulse V1 stricter than PulsePort.** PulsePort's frontend-hook-driven data layer is a documented anti-pattern for the CoinPulse goal of auditability, rebuildability, and deterministic accounting. CoinPulse V1 must not replicate it.

3. **Build data quality and backend contracts first.** Pricing provenance, ledger coverage warnings, canonical transaction DTOs, and materialization confidence must be solid before any richer UI is built on top.

4. **Defer wallet analyzer UI.** A wallet analyzer page (holdings breakdown, PnL history, DeFi positions, analytics) must wait until the backend DTOs that would support it — specifically canonical transaction DTO, pricing provenance, and LP/stake adapter outputs — are implemented, tested, and confirmed stable.

5. **Treat explicit uncertainty as correct behavior.** An `"unsupported"` or `"unavailable"` state in a DTO is not a failure — it is correct, honest reporting. The research confirms that forcing unknown values to zero is a data quality error. CoinPulse V1 must preserve and surface explicit states at all layers.
