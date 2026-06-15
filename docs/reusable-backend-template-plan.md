# Reusable Backend Template Plan

## Purpose

This document captures the planning context for a future reusable backend template that would be extracted from CoinPulse once the V1 backend truth model is stable. The goal is to make CoinPulse's backend disciplines (canonical ledger, materialization, provenance, diagnostics, contract tests) reusable across future portfolio/analytics products without re-deriving them from scratch.

This document is **planning only**. It does not extract anything, does not start a separate repository, does not change CoinPulse code, schemas, DTOs, accounting semantics, pricing/PnL strategy, worker logic, Prisma scripts, or backend route contracts, and does not introduce Ethereum/Base execution.

## Non-Goals (explicit, for this slice)

- Do not create a new repository.
- Do not extract any code out of CoinPulse.
- Do not generalize the schema, the canonical ledger model, or the pricing/PnL strategy.
- Do not change CoinPulse worker logic, Prisma scripts, or migrations.
- Do not add Ethereum/Base execution as part of this plan.
- Do not pre-commit to a specific package layout, license, or distribution channel.
- Do not block any current CoinPulse feature work on this plan.

## Why now

CoinPulse has, through PR #13–#22, converged on a strong and explicit backend discipline:

- PostgreSQL persisted state is the source of truth.
- RPC is upstream ingestion only.
- The canonical ledger is the accounting truth.
- Derived portfolio state is materialized from the canonical ledger.
- DTOs are versioned and carry provenance, freshness, valuation status, PnL status, warnings, coverage, and operation state.
- Frontend consumes those DTOs and never reconstructs accounting truth from RPC or symbols.
- Materialization warnings, diagnostics, and persisted provenance are first-class.
- Dashboard and debug/status routes have contract-tested success and failure responses.

These disciplines are not specific to PulseChain or to this product. They are the backbone of any chain-agnostic portfolio backend. Capturing them now — while the model is still small enough to describe end to end — is cheap. Extracting them into a separate repo before they are stable is expensive and premature.

## What the future template would contain (target shape)

The following is a target inventory of what a reusable template *would* offer, once extracted. Nothing in this list is being implemented in this slice.

### T1. Truth-model contracts

- A documented, versioned data-flow contract: `raw audit -> canonical ledger -> derived state -> pricing observations -> backend-computed PnL/valuation -> versioned DTOs -> API routes -> frontend`.
- Explicit guardrails encoded as docs and lints: no RPC-as-truth, no DexScreener-as-truth, no symbol-as-identity, no frontend computation of balances/prices/PnL/LP/stake, no mock data in production DTOs.

### T2. Canonical ledger primitives

- Conceptual model for canonical ledger entries, action groups, entry types, directions, source families, protocols, and chain-aware asset identity (`assetId`, not symbol).
- Reference description of how derived positions are materialized from ledger truth.
- Reference description of how persisted pricing observations attach to materialized state.

### T3. Materialization and diagnostics

- Reference design for materialization runs, including:
  - persisted materialization provenance (chosen run, source, inputs).
  - warnings hardening (partial valuation, missing pricing, unsupported assets).
  - operator-visible diagnostics surfaced via DTO fields, not log scraping.
- Reference design for the operation-state surface (`operationState.operations`, `blockerSummary`, `ingestionDiagnostics`, `lastSuccessfulSyncAt`, `lastRebuildAt`, `warnings`).

### T4. DTO contract style

- Required fields on every read DTO:
  - `schemaVersion`
  - provenance fields where applicable (pricing source, operation trigger, chain id, wallet identity, source family).
  - freshness fields where applicable (`asOf`, `timestamp`, `observedAt`, `staleAfterSeconds`, `updatedAt`, `updatedFromBlock`, `updatedToBlock`).
  - explicit priced/unpriced/PnL status separation.
  - confidence metadata (confidence score, rejected reasons, stale price status, low-confidence status) where applicable.
  - partial valuation warnings and coverage rather than forced completeness.
- Versioning rule: additive within a version, new version for breaking shape changes.

### T5. API route conventions

- Stable, DTO-oriented read endpoints.
- Operator mutation endpoints that return verbatim, structured responses (success / failure / conflict), without leaking internal exception details.
- Documented compatibility-period strategy for any route normalization (no silent renames).

### T6. Contract test scaffolding

- Reusable patterns for:
  - route-level success-path response shape contract tests (PRs #19, #20).
  - route-level failure-path response shape contract tests (PRs #21, #22): HTTP 500, stable error envelope, `error.code` = `INTERNAL_ERROR`, `error.message` = `Internal server error.`, no internal detail leakage.
  - mocked-backend test posture: no live RPC, no external services, no mock data baked into production DTOs.

### T7. Frontend consumption contract (companion to the audit)

- Required pattern: TanStack Query for reads, `useMutation` for operator actions, shared query keys, per-DTO `staleTime` / `gcTime`, explicit invalidation map for sync/rebuild/import flows. The frontend-side details are owned by `docs/frontend-query-standardization-audit.md` and would ship alongside the template.

### T8. Chain extensibility seam

- Chain-agnostic boundary for DTOs and query keys (`chainId`, `(walletAddress, chainId)` identity, `assetId` not symbol).
- Chain-specific behavior kept behind the backend boundary (RPC adapters, source-family ingestion, protocol classification, chain-native asset identifiers, sync planning/scan windows).
- Default execution target stays single-chain (PulseChain in CoinPulse's case) until backend truth is stable enough to generalize.

### T9. Operational guardrails

- No frontend RPC reads.
- No DexScreener as primary truth.
- No symbol-as-identity.
- No mock production data.
- No frontend balance/price/PnL/LP/stake computation.
- No broad page expansion before derived-state correctness is proven.
- No client-side joins over raw rows that bypass backend truth.

## What stays inside CoinPulse for now

For this slice, all of the above remains *described*, not extracted. Concretely:

- The canonical ledger code, materialization code, pricing code, PnL code, sync/rebuild code, Prisma schema, migrations, and worker logic stay exactly where they are in CoinPulse.
- The reference DTOs (`PortfolioDashboardDto`, `HealthReportDto`, `DebugStatusReportDto`) stay in CoinPulse.
- The reference contract tests (PRs #19–#22) stay in CoinPulse.
- This document is the only deliverable for this slice on the backend-template side; the frontend-side companion is `docs/frontend-query-standardization-audit.md`.

## Readiness criteria for extraction (gate before any extraction PR)

The template should not be extracted into a separate repo until **all** of the following are true. None of these are being changed in this slice; they are the gate.

- C1. CoinPulse V1 dashboard, debug/health, and debug/status DTOs are stable across at least one full sync→materialize→rebuild cycle in production-like conditions.
- C2. Failure-path contract tests exist for every operator-facing read DTO route (dashboard ✓ PR #22, debug/status ✓ PR #21; future `prices/status` and `transactions` would extend this).
- C3. Persisted materialization provenance (PR #17) and dashboard materialization metadata (PR #18) are stable consumers of the canonical ledger and have not had to change DTO shape for at least one full release.
- C4. ~~Frontend has migrated to TanStack Query per `docs/frontend-query-standardization-audit.md`, so the consumption contract is exercised by real screens.~~ **Status (2026-06): Satisfied.** The frontend has migrated to TanStack Query — `QueryProvider`, shared query keys, query defaults, API clients, and `useQuery`/`useMutation` hooks are wired across dashboard, debug, pricing, wallets, transactions, and HexMining reads. The consumption contract is now exercised in CoinPulse. C4 is no longer a blocking gate; C1–C3, C5, and C6 remain.
- C5. A second backend surface inside CoinPulse (e.g. `prices/status` or canonical `transactions`) has been added using the same DTO contract style, proving the contract style is reusable across more than one DTO.
- C6. A documented compatibility-period strategy exists for route normalization (`/api/portfolio/dashboard` → `/api/dashboard` and similar), so an extracted template does not lock the original repo into silent breakage.

Until C1–C6 are satisfied, extraction is premature and would freeze accidental shape decisions into a public reusable surface.

## Recommended Sequence (each step = its own bounded PR; nothing here is part of this slice)

1. Land `docs/frontend-query-standardization-audit.md` (this PR). *(Done.)*
2. Land `docs/reusable-backend-template-plan.md` (this PR). *(Done.)*
3. ~~(Future, separate PR) Wire `QueryClient` + shared `src/lib/query/` per the audit; do not extract anything.~~ *(Done — PRs #23–#177.)*
4. ~~(Future, separate PR) Migrate dashboard reads to `useQuery`.~~ *(Done.)*
5. ~~(Future, separate PR) Migrate debug/sync reads to `useQuery` and operator mutations to `useMutation`.~~ *(Done.)*
6. ~~(Future, separate PR) Add `GET /api/prices/status` DTO and contract tests using the existing DTO contract style.~~ *(Done — source-level route exists; per-asset coverage diagnostics remain open.)*
7. (Future, separate PR) Add canonical `GET /api/transactions` DTO and contract tests using the existing DTO contract style.
8. (Future, only after C1–C6) Open a *separate* extraction PR in a *separate* repo to lift the template out of CoinPulse. That PR is explicitly out of scope here.

## Residual Risks (planning level)

- **R1. Premature extraction.** If the template is extracted before C1–C6, accidental decisions (DTO field names, error envelope shape, materialization warning vocabulary) become a public contract that is expensive to revise. Mitigation: enforce the readiness gate.
- **R2. Drift between repos.** A separate template repo, once it exists, will tend to drift from CoinPulse. Mitigation: keep CoinPulse as the canonical reference implementation, and treat the template as a documented distillation of it, not a parallel codebase.
- **R3. Over-generalization.** The template should not try to abstract over chains, ledgers, or pricing strategies that CoinPulse does not yet exercise. Mitigation: only generalize what has shipped twice inside CoinPulse.
- **R4. Frontend coupling.** The reusable template's frontend consumption contract (T7) is only meaningful if CoinPulse itself uses it. Mitigation: gate extraction on C4. *(C4 is now satisfied — see updated criterion above. The remaining extraction gate is C1–C3, C5, and C6.)*
- **R5. Chain extensibility appearance.** Listing chain-agnostic seams here must not be read as approval to start Ethereum/Base execution. PulseChain remains the only execution target until V1 is stable.
- **R6. Scope creep within CoinPulse.** This document must not be used to justify schema, accounting, pricing/PnL, or worker changes. It is descriptive of current discipline, not a license to evolve it.

## Conclusion

CoinPulse already has the disciplines that a reusable portfolio backend template would need: canonical ledger truth, materialized derived state, persisted provenance, hardened warnings and diagnostics, versioned DTOs with freshness/provenance/coverage, and contract-tested success and failure responses. Capturing them as a template plan now — without extracting anything and without changing any code — is cheap, low-risk, and unblocks the eventual extraction once the readiness gate (C1–C6) is satisfied.
