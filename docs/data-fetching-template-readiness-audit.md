# Data-Fetching Template Readiness Audit

## Purpose

This audit evaluates CoinPulse against the reusable data-fetching template readiness gates G1–G8 in `docs/reusable-data-fetching-template-plan.md`. It is documentation-only and does not authorize creating an internal template folder, creating a separate repository, extracting reusable code, changing source code, changing tests, changing schema, changing API routes, changing pricing/PnL/accounting semantics, adding Ethereum/Base support, or starting template extraction.

## Baseline

- PR source branch: `codex/create-audit-branch-for-data-fetching-template`.
- Starting point: repository history includes `docs: add V1 guardrail milestone checkpoint (#95)` at `3d8efdf`.
- Scope: one audit document under `docs/`.
- Primary gate source: `docs/reusable-data-fetching-template-plan.md`.
- Relevant architecture docs reviewed: `docs/data-fetching-architecture.md`, `docs/frontend-query-standardization-audit.md`, `docs/reusable-backend-template-plan.md`, and `docs/v1-guardrail-milestone-checkpoint.md`.
- Validation requested for this documentation-only slice: `npm run lint` and `DATABASE_URL='postgresql://user:pass@localhost:5432/coinpulse' npm run typecheck`.

## Executive readiness summary

CoinPulse is ready for an internal documentation-only pattern reference/audit follow-up, but it is not ready for an internal template folder, not ready for a separate external repository, and not ready for reusable code extraction.

The strongest readiness evidence is the implemented TanStack Query foundation (`src/lib/query/query-client.ts`, `src/components/providers/query-provider.tsx`), shared query keys (`src/lib/query/query-keys.ts`), DTO-first read hooks (`src/lib/query/use-dashboard-query.ts`, `src/lib/query/use-debug-health-query.ts`, `src/lib/query/use-debug-status-query.ts`, `src/lib/query/use-tracked-wallets-query.ts`, `src/lib/query/use-pricing-status-query.ts`), operator mutation hooks (`src/lib/query/use-manual-sync-mutation.ts`, `src/lib/query/use-rebuild-mutation.ts`, `src/lib/query/use-wallet-import-mutation.ts`), and scoped invalidation helper (`src/lib/query/invalidation.ts`). The strongest blockers are stability-window proof, production-like full-cycle evidence for operator flows, and the absence of a generalized pattern reference that strips CoinPulse-specific domain details before any template is created.

## G1-G8 readiness table

| Gate | Status | Concrete repo evidence | Blockers before template use |
| --- | --- | --- | --- |
| G1. Dashboard wallet selection flow is stable. | partial | `src/components/dashboard/dashboard-screen.tsx` wires `useTrackedWalletsQuery`, `useDashboardQuery`, `useDebugHealthQuery`, and `useDebugStatusQuery`; it removes the exact dashboard query key on explicit submit and keeps the dashboard read disabled until submitted params exist. `tests/components/dashboard-tracked-wallet-selector-behavior.test.ts`, `tests/components/dashboard-screen-wiring.test.ts`, and `tests/components/dashboard-screen-submitted-source-behavior.test.ts` cover selector behavior, submitted-wallet source behavior, and shared hook wiring. `docs/dashboard-wallet-selection-plan.md` documents the planned flow. | The gate requires the flow to have shipped and avoided structural changes for at least one full release cycle. The repo has strong implementation/test evidence, but this audit does not find a release-cycle stability record. Keep this as partial until a post-release checkpoint records that no selector/query shape changes were needed. |
| G2. Tracked wallets flow is stable. | mostly met | `GET /api/wallets/tracked` is implemented in `app/api/wallets/tracked/route.ts`; `useTrackedWalletsQuery` is implemented in `src/lib/query/use-tracked-wallets-query.ts`; the import mutation invalidates debug status, debug health, and the chain-specific tracked-wallets key in `src/lib/query/use-wallet-import-mutation.ts`. Evidence is covered by `tests/api/wallets-tracked-route-contract.test.ts`, `tests/lib/use-tracked-wallets-query.test.ts`, `tests/lib/use-wallet-import-mutation.test.ts`, `tests/components/tracked-wallets-screen-wiring.test.ts`, and `tests/components/wallet-import-screen-wiring.test.ts`. | The route, hook, and invalidation policy are implemented and tested, but the gate asks for stability across multiple PRs without DTO or query-key changes. Record that stability explicitly after several more bounded PRs, especially if wallet import UX, chain filtering, or route normalization changes. |
| G3. Dashboard DTO has remained stable through several PRs. | mostly met | `GET /api/portfolio/dashboard` is implemented in `app/api/portfolio/dashboard/route.ts` and delegates to backend assembly in `src/services/dashboard/portfolio-dashboard.ts`. `useDashboardQuery` keys by `schemaVersion: "v1"`, chain id, normalized wallet address, quote asset, and optional `asOf`. `tests/api/portfolio-dashboard-route-contract.test.ts`, `tests/api/portfolio-dashboard-route.test.ts`, `tests/lib/use-dashboard-query.test.ts`, `tests/services/dashboard/portfolio-dashboard.test.ts`, `tests/components/dashboard-screen-wiring.test.ts`, and `tests/components/dashboard-token-metadata-provenance.test.tsx` protect the DTO, query behavior, and pass-through rendering. Guardrail docs in `docs/dashboard-data-quality-audit.md`, `docs/pnl-accounting-guardrails.md`, and `docs/v1-guardrail-milestone-checkpoint.md` reinforce backend-owned materialization, PnL, metadata provenance, and symbol-is-not-identity constraints. | The DTO shape is well protected, but the specific G3 criterion requires at least three consecutive PRs touching the dashboard route without shape changes. This audit finds guardrail PR history after the query standardization work, but not a dedicated dashboard-route stability ledger. Add an explicit dashboard DTO stability note after the next dashboard-touching PRs before using this gate as extraction evidence. |
| G4. Operator sync, rebuild, and import flows are stable. | partial | Manual sync and rebuild use `useManualSyncMutation` and `useRebuildMutation`; both call debug API clients and invalidate operation-state queries through `invalidateDebugOperationQueries`. Wallet import uses `useWalletImportMutation` and invalidates debug status, debug health, and tracked wallets while intentionally avoiding dashboard invalidation. `tests/lib/use-manual-sync-mutation.test.ts`, `tests/lib/use-rebuild-mutation.test.ts`, `tests/lib/use-wallet-import-mutation.test.ts`, `tests/lib/invalidation.test.ts`, `tests/components/debug-sync-screen-wiring.test.ts`, `tests/components/wallet-import-screen-wiring.test.ts`, `tests/api/backend-operation-routes.test.ts`, and `tests/api/wallet-import-route-contract.test.ts` cover hook calls, conflict/error behavior, and invalidation. Operation state services/tests live in `src/services/debug/operation-state.ts` and `tests/services/debug/operation-state.test.ts`. | The code and tests cover mutation behavior, but G4 specifically requires exercising a complete sync -> materialize -> rebuild cycle in production-like conditions without structural rework. This audit finds no production-like cycle record. Keep this partial until an operator-run checkpoint records the full cycle, confirms conflict/error semantics, and confirms no invalidation/query-key changes were required. |
| G5. At least one additional read DTO beyond dashboard, debug, and wallets is implemented. | met | `GET /api/prices/status` is implemented in `app/api/prices/status/route.ts`, backed by `src/services/api/prices.ts`, exposed through `src/lib/api/prices-client.ts`, keyed by `queryKeys.prices.status()`, consumed through `src/lib/query/use-pricing-status-query.ts`, and rendered by `src/components/prices/pricing-status-screen.tsx`. `tests/api/prices-status-route-contract.test.ts`, `tests/lib/prices-client.test.ts`, `tests/lib/use-pricing-status-query.test.ts`, and `tests/services/pricing/prices-status.test.ts` cover the route, client, hook, and service behavior. `docs/v1-guardrail-milestone-checkpoint.md` identifies pricing status observability as completed while warning that it is not token metadata, origin, bridge, or PnL support. | No gate blocker. Keep future non-dashboard DTOs contract-first and backend-truth-first before adding them to any template evidence set. |
| G6. Route contract tests exist for success and failure paths. | mostly met | Success and failure/error-envelope evidence exists for focus DTO routes: `tests/api/portfolio-dashboard-route-contract.test.ts` and `tests/api/portfolio-dashboard-route.test.ts` for `GET /api/portfolio/dashboard`; `tests/api/wallets-tracked-route-contract.test.ts` for `GET /api/wallets/tracked`; `tests/api/debug-status-route-contract.test.ts` for `GET /api/debug/status`; `tests/api/debug-health-route.test.ts` for `GET /api/debug/health`; and `tests/api/prices-status-route-contract.test.ts` for `GET /api/prices/status`. Import and backend operation route contracts are covered by `tests/api/wallet-import-route-contract.test.ts` and `tests/api/backend-operation-routes.test.ts`. Error helpers are centralized in `src/services/api/validation.ts`. | The focus routes are covered, but the gate is ongoing: every future DTO route must keep success, invalid input where applicable, not-found where applicable, and safe failure envelopes. Before template extraction, create a route-contract coverage index so reviewers can verify every DTO route without re-auditing the test tree manually. |
| G7. Query hooks and mutation hooks have consistent test coverage. | mostly met | Query client defaults are tested in `tests/lib/query-client.test.ts`; query key normalization is tested in `tests/lib/query-keys.test.ts`. Read hooks have tests for query key usage, stale/gc timing, fetch invocation, disabled behavior, and backend error preservation in `tests/lib/use-dashboard-query.test.ts`, `tests/lib/use-debug-health-query.test.ts`, `tests/lib/use-debug-status-query.test.ts`, `tests/lib/use-tracked-wallets-query.test.ts`, and `tests/lib/use-pricing-status-query.test.ts`. Mutation hooks have tests for client invocation, no retry by behavior, error preservation, scoped invalidation, and non-blocking invalidation in `tests/lib/use-manual-sync-mutation.test.ts`, `tests/lib/use-rebuild-mutation.test.ts`, `tests/lib/use-wallet-import-mutation.test.ts`, and `tests/lib/invalidation.test.ts`. | Coverage is strong for current hooks, but extraction needs a small written hook-test checklist that distinguishes read-hook requirements (`queryKey`, `queryFn`, `staleTime`, `gcTime`, disabled behavior, errors) from mutation-hook requirements (`mutationFn`, `retry`, `onSettled`, exact invalidations, non-blocking behavior). Add that checklist before promoting the pattern into a template folder. |
| G8. AGENTS.md workflow rules have proven useful across multiple Codex tasks. | met | `AGENTS.md` encodes bounded branch workflow, source-of-truth hierarchy, frontend DTO/API-only rules, operational safety rules, preferred tests, required sequential verification, validation failure reporting, and the required operational summary. Recent bounded PR history includes query standardization and guardrail tasks such as #86, #87, #88, #89, #90, #91, #92, #93, #94, and #95. `docs/v1-guardrail-milestone-checkpoint.md` confirms TanStack Query/read/mutation/invalidation standardization and several guardrail protections as completed while explicitly deferring reusable template extraction. | No gate blocker for using the workflow as documentation evidence. Do not copy it to an external template verbatim until CoinPulse-specific rules are separated from reusable architecture rules. |

## Readiness by extraction stage

### Internal docs/template readiness

Status: partial.

Safe now:

- Create or update audit and planning docs that describe the implemented CoinPulse patterns.
- Create a concise pattern-reference document after the current blockers are resolved, as recommended by `docs/reusable-data-fetching-template-plan.md`.
- Continue tightening route-contract, hook, mutation, and guardrail evidence in-place.

Not safe yet:

- Creating `docs/template/`, `examples/starter/`, or any internal template folder.
- Adding scaffold stubs that reviewers could mistake for authorized template extraction.
- Copying production code into template-like files.

Blockers before an internal template folder can be created:

1. Record a release-cycle stability checkpoint for the dashboard wallet-selection flow.
2. Record tracked-wallet DTO/query-key stability across additional bounded PRs.
3. Record dashboard DTO `schemaVersion: "v1"` shape stability across the required dashboard-touching PR window.
4. Record a production-like operator sync -> materialize -> rebuild cycle without structural query, mutation, invalidation, or DTO rework.
5. Add a route-contract coverage index for all DTO-returning routes.
6. Add a small hook/mutation test checklist that distinguishes read-hook and mutation-hook expectations.
7. Draft a CoinPulse-specific-vs-reusable rule separation note for `AGENTS.md` before copying workflow rules anywhere.

### Separate repository readiness

Status: not ready.

Safe now:

- Nothing beyond in-repo docs and readiness audits.

Not safe yet:

- Creating a separate external repository.
- Publishing or copying CoinPulse docs, source, tests, or workflow files as a starter template.
- Treating CoinPulse's current implementation as a frozen public API.

Blockers before a separate external data-fetching repo can be created:

1. All G1-G8 gates must be met, not partial or mostly met.
2. An internal documentation-only template folder must exist first and remain stable across several PRs.
3. CoinPulse-specific domain content must be removed from generalized docs.
4. Backend truth, DTO versioning, query key, invalidation, route contract, and agent workflow conventions must be summarized in extraction-neutral language.
5. The external repo scope must be explicitly approved in a future bounded task.

### Reusable code extraction readiness

Status: not ready.

Safe now:

- No reusable code extraction.
- Continue using CoinPulse as the reference implementation.

Not safe yet:

- Extracting `queryKeys`, API clients, hooks, mutation hooks, invalidation helpers, route helpers, tests, or components.
- Publishing a package or shared library.
- Introducing abstraction layers into CoinPulse for hypothetical external consumers.

Blockers before reusable code extraction can be considered:

1. Separate repository readiness must be achieved first.
2. The initial external repository must contain docs first, not code.
3. Test scaffolding must be extracted before runtime utilities.
4. Any starter query/client utilities must be dependency-light and stripped of CoinPulse-specific DTOs, route names, chain assumptions, pricing semantics, and wallet/accounting domain assumptions.
5. CoinPulse must remain the source implementation; any reusable code must originate from stable, repeatedly used CoinPulse patterns rather than from speculative abstraction.

## Exact blockers

- G1 blocker: no release-cycle stability checkpoint for dashboard wallet selection and submitted dashboard query behavior.
- G2 blocker: no explicit tracked-wallet DTO/query-key stability record across multiple post-standardization PRs.
- G3 blocker: no explicit dashboard route/DTO stability ledger proving three consecutive dashboard-touching PRs without shape changes.
- G4 blocker: no production-like sync -> materialize -> rebuild evidence with no structural rework.
- G6 blocker: no single route-contract coverage index proving every DTO route has success and failure-path coverage.
- G7 blocker: no generalized hook/mutation test checklist suitable for template readers.
- G8 blocker for external use only: `AGENTS.md` still mixes reusable architecture rules with CoinPulse-specific operational and domain rules.

## What is safe next

1. Add a documentation-only route-contract coverage index.
2. Add a documentation-only hook/mutation test checklist.
3. Add a documentation-only dashboard DTO stability checkpoint after the next qualifying dashboard-route PRs.
4. Add a documentation-only tracked-wallet stability checkpoint after more bounded PRs exercise the route, hook, and import invalidation policy without shape changes.
5. Run and record a production-like operator sync -> materialize -> rebuild checkpoint, without changing code in the checkpoint PR.
6. After all gates are met, write a concise reusable pattern reference that does not include CoinPulse-specific domain details.

## What is explicitly not safe yet

- Creating an internal template folder.
- Creating a separate external data-fetching repository.
- Extracting reusable code.
- Copying CoinPulse production source into scaffold files.
- Changing source code, tests, schema, API routes, pricing/PnL/accounting behavior, RPC behavior, or frontend behavior as part of template readiness.
- Adding Ethereum/Base support.
- Treating pricing status as token metadata, origin, bridge, or PnL support.
- Treating this audit as merge approval for reusable template extraction.

## Architecture impact

None. This is a documentation-only audit. It does not change backend truth, canonical ledger behavior, materialized portfolio state, DTO/API contracts, frontend data fetching behavior, query keys, invalidation behavior, schema, pricing, PnL, accounting, RPC usage, or supported chains.
