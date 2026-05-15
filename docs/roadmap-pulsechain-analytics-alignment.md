# PulseChain Analytics Roadmap Alignment

## 1. Purpose

This document is a roadmap alignment document for expanding CoinPulse from a PulseChain-first portfolio application into a broader analytics platform while preserving the repository's existing architecture-first boundaries.

This document is documentation-only. It does not implement features, change source code, modify tests, alter schema, add routes, change API clients, change query hooks, update pricing logic, change PnL formulas, modify sync behavior, or alter dashboard UI.

This document does not authorize implementation by itself. Each roadmap item still requires a bounded implementation PR with explicit backend data availability, DTO contracts, tests, validation, and review of architecture impact.

Roadmap execution must preserve backend truth, deterministic reconstruction, and DTO-first frontend consumption. The intended flow remains raw audit data, deterministic normalization, canonical ledger, materialized derived portfolio state, versioned backend DTOs, and frontend UI consumption through shared API/query contracts.

## 2. Positioning

“CoinPulse is a high-integrity PulseChain portfolio intelligence and ecosystem analytics platform.”

CoinPulse is not:

- a generic token explorer
- a frontend-only wallet viewer
- a speculative AI prediction tool
- an RPC-driven dashboard
- a DexScreener-style price surface
- a HexPulse clone

CoinPulse should be positioned around durable backend state, accounting-safe ledger semantics, explicit uncertainty, operator observability, and contract-tested frontend consumption. The platform can grow into ecosystem analytics only when those analytics are backed by indexed data, backend DTO contracts, and deterministic tests.

## 3. Architectural guardrails

The roadmap must preserve these guardrails:

- No frontend RPC truth.
- No frontend balance, PnL, pricing, LP valuation, stake valuation, or ecosystem-metric computation.
- No symbol-as-identity; token identity must use chain-aware contract identity and explicit origin metadata where available.
- No DexScreener-as-truth; external market surfaces may be observational inputs only when persisted with source, freshness, and confidence metadata.
- No mock production DTOs.
- DTO-first frontend architecture.
- Canonical ledger entries are accounting truth.
- Persist provenance, freshness, confidence, warnings, timestamps, and materialization metadata.
- Backend route behavior must be contract-tested before frontend expansion depends on it.
- Deterministic rebuilds must remain possible.
- Raw audit snapshots must exist before canonical normalization.
- Unknown or unsupported values are safer than guessed values.

## 4. Roadmap categories

Roadmap expansion should be grouped into these bounded categories:

- Data Quality & Confidence Layer
- Canonical Transaction Intelligence
- PulseChain Ecosystem Analytics
- Portfolio Intelligence Expansion
- Operator & Infrastructure Observability
- Wallet Intelligence, Conservative Scope

## 5. V1 vs future-phase separation

Every roadmap category below is split into:

- **Safe now** — documentation, plans, tests, or UI/status work that consumes existing backend DTOs without inventing truth.
- **V1-adjacent after backend contracts** — implementation candidates only after indexed backend data, additive DTO contracts, and tests exist.
- **Future research / V2** — research or later-phase work that must not be framed as V1 implementation until current indexed backend data, DTO contracts, and tests already exist.

Important classification rule: the following items must be listed as **Future research / V2** unless current indexed backend data, DTO contracts, and tests already exist:

- ecosystem-wide analytics dashboards
- whale movement analytics
- wallet behavior classification
- bridge inflow/outflow analytics
- stablecoin integrity scoring
- impermanent loss analytics
- native PnL
- protocol activity metrics beyond currently indexed ledger data

These items may appear in the roadmap, but they must not be framed as V1 implementation tasks.

## 6. Data Quality & Confidence Layer

Roadmap bullets:

- confidence-scored valuation engine
- liquidity-aware pricing
- stale/unsupported/low-confidence valuation states
- partial valuation support
- valuation coverage metrics
- stablecoin integrity metrics
- spoof/scam liquidity detection
- pricing observability surfaces

### Safe now

- Documentation and status vocabulary for valuation confidence, stale pricing, unsupported assets, partial valuation, and coverage semantics.
- Contract tests for backend pricing confidence states, stale states, unsupported states, and low-confidence states once represented by DTOs.
- Operator-facing pricing observability using backend DTOs, including source status, lookback windows, freshness, warnings, and disabled/no-observation states.

### V1-adjacent after backend contracts

- Additive valuation confidence DTOs.
- Liquidity-aware pricing confidence metadata computed by the backend.
- Expanded valuation coverage metrics over materialized portfolio state.
- Dashboard indicators that consume backend-provided confidence and coverage DTO fields without deriving financial truth in the UI.

### Future research / V2

- Stablecoin integrity scoring.
- Spoof/scam liquidity detection.
- Ecosystem-wide pricing confidence dashboards.

### Rules

- Never claim perfect pricing.
- Never claim solvency verification.
- Uncertainty must remain explicit in DTOs.
- Pricing confidence must be backend-computed, never frontend-derived.

## 7. Canonical Transaction Intelligence

Roadmap bullets:

- canonical `GET /api/transactions` DTO
- action-group-aware transaction normalization
- ledger-derived transaction views
- transaction attribution engine
- unified transaction module
- bridge/source attribution
- human-readable transaction narratives

### Safe now

- Documentation of canonical transaction requirements, DTO boundaries, and attribution limits.
- Contract tests around action-group-aware route behavior once route contracts are introduced.
- DTO plan for a canonical transaction list that is derived from persisted canonical ledger entries.

### V1-adjacent after backend contracts

- `GET /api/transactions` as a backend-owned, contract-tested route.
- Ledger-derived transaction rows based on existing canonical ledger state.
- Transaction attribution based on existing canonical ledger state.
- Human-readable narratives generated from backend DTO fields.
- A unified transaction module that consumes backend DTOs and does not reconstruct raw logs in the frontend.

### Future research / V2

- Bridge/source attribution beyond explicit ledger evidence.
- Ecosystem-wide transaction intelligence.

### Rules

- The frontend must never reconstruct transactions from raw logs.
- Transaction truth derives from persisted ledger state only.
- Bridge/source attribution must be unknown-first until ledger evidence supports it.
- Narratives must be backend DTO driven, not frontend heuristics.

## 8. PulseChain Ecosystem Analytics

Roadmap bullets:

- ecosystem health dashboard
- PulseX liquidity analytics
- DEX volume analytics
- LP concentration metrics
- bridge inflow/outflow tracking
- stablecoin supply tracking
- burn analytics
- protocol activity metrics
- large-wallet/whale movement analytics

### Safe now

- Documentation and indexed-data requirements for each proposed ecosystem metric.
- Define DTO contracts and data provenance needs before implementation.
- Identify which metrics can be derived from current canonical ledger or materialized state, if any, without broadening truth assumptions.

### V1-adjacent after backend contracts

- Narrowly scoped PulseX liquidity metrics if backed by indexed data.
- Narrowly scoped DEX volume metrics if backed by canonical DEX normalization.
- Protocol activity metrics only for data already materialized and contract-tested.

### Future research / V2

- Ecosystem health dashboard.
- Bridge inflow/outflow tracking.
- Stablecoin supply tracking.
- Burn analytics.
- LP concentration metrics.
- Whale movement analytics.
- Wallet behavior classification.
- Cross-protocol ecosystem analytics.
- Protocol activity metrics beyond currently indexed ledger data.

### Rules

- Metrics must derive from indexed on-chain truth.
- Avoid speculative market prediction language.
- Broad ecosystem analytics must be future-phase unless indexed data, DTO contracts, and tests exist.
- Do not make alpha-detection or prediction claims.

## 9. Portfolio Intelligence Expansion

Roadmap bullets:

- realized/unrealized PnL
- LP accounting
- HEX/pHEX stake analytics
- portfolio attribution
- allocation analytics
- historical portfolio performance
- yield source tracking
- impermanent loss analytics as advanced/future

### Safe now

- Contract tests around backend DTOs, route behavior, and unsupported/partial coverage status.
- Documentation of portfolio-intelligence scope and accounting boundaries.
- Backend-computed coverage/status indicators.
- Dashboard indicators consuming backend DTOs.

### V1-adjacent after backend contracts

- Improved realized/unrealized PnL status surfaces.
- Allocation analytics from existing materialized balances.
- Historical portfolio performance only after persisted historical valuation support exists.
- LP/stake accounting coverage metadata.

### Future research / V2

- Native PnL.
- Impermanent loss analytics.
- Yield source tracking.
- Advanced portfolio attribution.
- Tax-grade accounting exports.

### Rules

- Mark advanced analytics as iterative rollout.
- Avoid overpromising tax or accounting correctness.
- Native PnL requires historical PLS/native price observations aligned to ledger timestamps.
- Do not compute PnL in the frontend.

## 10. Operator & Infrastructure Observability

Roadmap bullets:

- pricing/status observability
- sync observability
- materialization diagnostics
- ingestion diagnostics
- rebuild diagnostics
- stale-state detection
- RPC degradation visibility
- backend operation-state surfaces

### Safe now

- Operator pages consuming existing backend DTOs.
- Contract-tested status endpoints.
- Stale-state indicators.
- Materialization and ledger coverage visibility.

### V1-adjacent after backend contracts

- Ingestion diagnostics endpoints.
- Rebuild diagnostics expansion.
- RPC degradation status endpoint.
- Sync backlog/status summaries.
- Backend operation-state surfaces that expose persisted operation status through structured DTOs.

### Future research / V2

- Long-term operations analytics.
- Infrastructure health dashboards across multiple chains or providers.

### Rules

- Operator diagnostics should surface through DTOs and structured APIs.
- Avoid log-scraping-driven UX.
- Do not add frontend direct RPC health probing.

## 11. Wallet Intelligence, Conservative Scope

Realistic wallet intelligence for CoinPulse should remain conservative and backend-contract-first:

- large-wallet movement tracking
- behavior-based wallet classification research
- concentration-risk metrics
- protocol exposure metrics
- liquidity exposure metrics

### Safe now

- Documentation and definitions.
- Contract tests for wallet/tracked-wallet identity behavior.
- Exposure metrics only if directly derivable from current materialized balances.

### V1-adjacent after backend contracts

- Concentration-risk metrics from backend materialized positions.
- Protocol exposure metadata if protocol classification exists.
- Liquidity exposure metrics if pricing/liquidity confidence exists.

### Future research / V2

- Large-wallet movement tracking.
- Behavior-based wallet classification.
- Whale movement analytics.
- Smart-wallet grouping research.

### Avoid

- AI alpha detection.
- Smart money guarantees.
- Institutional-grade predictions.
- Trading recommendations.

## 12. Priority ordering

Recommended bounded order:

1. Token metadata provenance/status contracts.
2. Canonical transactions DTO plan.
3. Canonical `GET /api/transactions` contract tests.
4. Transaction attribution from canonical ledger.
5. Pricing confidence expansion.
6. LP/stake accounting coverage expansion.
7. Historical portfolio performance plan.
8. Ecosystem analytics indexed-data plan.
9. Wallet intelligence research.
10. Native PnL planning/implementation only after historical native price coverage.

## 13. Safe now vs future research summary

### Safe now

- Docs and plans.
- Tests and contracts.
- Additive backend DTOs.
- Operator observability surfaces.
- Dashboard indicators consuming backend DTOs.
- Metadata, status, and provenance planning.

### V1-adjacent after backend contracts

- Canonical transactions DTO.
- Token metadata provenance DTO.
- Transaction attribution.
- Pricing confidence expansion.
- LP/stake coverage metadata.
- Narrow portfolio allocation analytics.

### Future research / V2

- Whale classification.
- Bridge attribution beyond explicit ledger evidence.
- Impermanent loss analytics.
- Stablecoin integrity scoring.
- Ecosystem-wide analytics dashboards.
- Protocol-wide health scoring.
- Native PnL.
- Behavior-based wallet intelligence.

## 14. Architectural compatibility notes

This roadmap aligns with the current architecture as follows:

- **Canonical ledger** — portfolio and transaction intelligence must derive from canonical ledger truth rather than frontend reconstruction or ad hoc RPC reads.
- **Raw audit snapshots** — raw audit data remains the evidence layer before normalization, allowing deterministic reprocessing when normalization rules evolve.
- **Deterministic normalization** — analytics expansions must be reproducible from raw records into canonical ledger and derived state.
- **Materialization** — portfolio state, coverage, freshness, and derived analytics should be materialized by backend services where they become UI-facing truth.
- **Persisted pricing observations** — valuation, PnL, and confidence expansions must preserve source, freshness, and confidence metadata for pricing inputs.
- **pnlCoverage** — richer PnL and portfolio status surfaces should extend backend coverage semantics rather than hiding unsupported or partial cases.
- **ledgerCoverage** — transaction and portfolio analytics should surface whether ledger-backed data is complete, partial, unsupported, or stale.
- **Pricing status** — confidence expansion should build on backend pricing-status DTOs and operator observability rather than frontend price probing.
- **Token identity/origin plans** — analytics must avoid symbol-as-identity and use chain-aware token identity plus explicit provenance/origin metadata.
- **Deterministic rebuilds** — every backend truth layer introduced by this roadmap should remain rebuildable and idempotent.
- **TanStack Query frontend consumption** — frontend pages should continue to consume API DTOs through standardized query keys, shared clients, and backend-owned error semantics.
- **Operator/debug observability** — risky or partial analytics should have operator-facing status, freshness, warnings, and confidence surfaces before they are promoted as user-facing intelligence.

## 15. Explicit non-goals

This document explicitly does not include:

- implementation code
- schema changes
- test changes
- route/API changes
- pricing logic changes
- PnL formula changes
- dashboard UI changes
- Ethereum/Base execution work
- AI prediction features
- token explorer clone scope
- frontend-derived accounting
- frontend-derived ecosystem metrics
- trading recommendations
