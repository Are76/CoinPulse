# Reusable Data-Fetching Template Plan

## 1. Purpose

This document is a planning-only record for a future reusable repository or project template that would be extracted from CoinPulse. The template would give future wallet, portfolio, analytics, and operator-dashboard projects a proven, architecture-safe starting point — one that enforces backend-owned truth, versioned DTOs, and a disciplined TanStack Query frontend layer from day one.

The template should help teams avoid the data-fetching architecture mistakes that most wallet and portfolio applications make, by encoding CoinPulse's established rules as structural constraints rather than guidelines.

**No code is extracted in this PR. No new repository is created. No CoinPulse behavior changes.**

This document is the companion to `docs/reusable-backend-template-plan.md` (which covers the backend truth model, canonical ledger, materialization, and contract-test disciplines). This document focuses on the frontend data-fetching layer and the cross-cutting conventions that span both sides of the API boundary.

---

## 2. Why This Matters

Most wallet and portfolio applications fail at data fetching in predictable, repeatable ways:

- **Direct RPC reads from the UI.** Components call `eth_getBalance` or `eth_getLogs` directly, bypassing the backend truth pipeline. The UI becomes a chain indexer, not a rendering surface.
- **Symbol-as-identity.** Fetch calls and cache keys use token ticker symbols instead of deterministic asset identifiers. Two assets with the same symbol collide. Symbol changes (token migrations, wrapped variants) silently corrupt state.
- **Third-party APIs as truth.** DexScreener, CoinGecko, and similar services are used as primary pricing truth. These sources have no provenance, staleness guarantees, or deterministic output. Prices drift from on-chain reality without operator awareness.
- **Frontend balance, price, and PnL computation.** Components multiply quantities by prices fetched independently, sum across positions, and render results as portfolio truth. There is no audit trail, no canonical ledger, and no deterministic rebuildability.
- **Mock data mixed with production DTOs.** Placeholder or fallback objects get committed to components as a "loading" default. They end up in production, silently displaying fabricated values.
- **Overly broad cache invalidation.** After any mutation, the entire page cache is invalidated. Every user action triggers a full refetch of every DTO on the page, regardless of what actually changed in the backend.
- **Missing route contract tests.** Read DTO shapes and error envelope shapes are tested only through integration or E2E, if at all. Frontend and backend drift silently between merges.
- **No stable query key policy.** Every component constructs its own fetch call. Cache fragmentation, duplicate in-flight requests, and inconsistent stale-time policies result.

CoinPulse has avoided all of these failures through deliberate architectural decisions. The reusable template should encode those decisions as the default, so future projects start from the correct posture rather than discovering the problem after shipping.

---

## 3. Reusable Architecture Principles

These principles come directly from CoinPulse's implemented and documented discipline. They are not abstract best practices; they reflect decisions that have been made, tested, and iterated on across multiple PRs.

### Backend owns truth

The PostgreSQL-backed canonical ledger and derived portfolio state are the source of truth. The backend assembles versioned DTOs from that truth. The frontend renders those DTOs. Nothing in the UI pipeline may compute, infer, or reconstruct portfolio values from raw inputs.

Reference: `docs/data-fetching-architecture.md` — truth model stack.

### Frontend consumes versioned DTOs only

Every API endpoint the frontend calls must return a DTO with an explicit `schemaVersion`. The frontend never calls RPC endpoints, chain indexers, or third-party price APIs directly. No component may reach outside the versioned backend DTO to infer state.

Reference: `app/api/portfolio/dashboard/route.ts`, `app/api/debug/status/route.ts`, `app/api/wallets/tracked/route.ts`.

### DTOs expose provenance, freshness, warnings, and uncertainty

A DTO that carries valuation, pricing, sync status, or operation state must include:

- provenance fields (pricing source, operation trigger, chain id, wallet identity, source family)
- freshness fields (`asOf`, `timestamp`, `observedAt`, `staleAfterSeconds`)
- explicit priced/unpriced/PnL status separation
- confidence metadata (confidence score, rejected reasons, stale price status, low-confidence flags)
- partial valuation warnings and coverage rather than forced completeness

Unavailable, stale, unsupported, incomplete, or unpriced values must never be coerced to zero.

Reference: `docs/data-fetching-architecture.md` — backend DTO contract strategy.

### TanStack Query owns frontend read state

All frontend reads go through TanStack Query `useQuery` hooks. There are no manual `useEffect` + `fetch` flows for DTO reads. The `QueryClient` is wired once at the app root. All screens consume hooks backed by the shared query layer.

Reference: `src/lib/query/use-dashboard-query.ts`, `src/lib/query/use-tracked-wallets-query.ts`, `src/lib/query/use-debug-health-query.ts`, `src/lib/query/use-debug-status-query.ts`.

### `useMutation` owns operator actions

All operator mutations (`POST /api/sync/manual`, `POST /api/rebuild`, `POST /api/wallets/import`) go through `useMutation` hooks. Each hook owns its invalidation policy in `onSettled`, ensuring that cache consistency is enforced even on error and conflict paths.

Reference: `src/lib/query/use-manual-sync-mutation.ts`, `src/lib/query/use-rebuild-mutation.ts`, `src/lib/query/use-wallet-import-mutation.ts`.

### Query keys are stable and explicit

All query keys are defined in a single shared factory (`src/lib/query/query-keys.ts`). Keys for versioned DTOs include `schemaVersion`. Keys for chain-scoped data include `chainId`. Keys for wallet-scoped data include normalized wallet address. No component constructs its own ad hoc key.

Reference: `src/lib/query/query-keys.ts`.

### Invalidation is intentional and scoped

After any mutation, only the queries that are affected by that mutation's backend side effects are invalidated. Dashboard queries are not invalidated unless backend materialization is known to have completed. Operation-state queries (`debug/status`, `debug/health`) are always invalidated after sync/rebuild/import, because persisted `SyncRun` truth can change in success, failure, and conflict cases.

Reference: `docs/data-fetching-architecture.md` — refetch after manual sync/rebuild.

### Route contracts are tested

Every DTO-returning route has a contract test covering the success-path response shape and the failure-path error envelope shape. Contract tests use no live RPC, no external services, and no mock data baked into production DTOs.

Reference: `tests/api/portfolio-dashboard-route-contract.test.ts`, `tests/api/debug-status-route-contract.test.ts`, `tests/api/wallets-tracked-route-contract.test.ts`.

### Errors use stable envelopes

All backend error responses use a consistent, tested envelope. The HTTP 500 path returns `{ error: { code: "INTERNAL_ERROR", message: "Internal server error." } }` without leaking internal exception details. The HTTP 400 and HTTP 404 paths use structured codes and messages. Frontend components render backend error fields verbatim; they never construct their own error narratives.

Reference: `src/services/api/validation.ts`, `tests/api/debug-status-route-contract.test.ts`.

### No mock fallback data in production

No component, hook, or client function may return a hardcoded or fabricated object as a production fallback. Loading states remain loading states. Unavailable states surface the backend's own unavailability signal. Stale states display the backend's staleness metadata.

Reference: `docs/data-fetching-architecture.md` — guardrails.

---

## 4. Template Modules to Extract Later

These are conceptual descriptions of the reusable modules a future template would include. None of this is being implemented or extracted in this PR.

### API route contract pattern

A documented, minimal route handler shape: parse-validate input, call a service, return `Response.json({ data: ... })` on success, return a stable error envelope on failure. The pattern is replicated consistently in every route; the template would encode it as a starter scaffold.

### DTO versioning pattern

A documented convention for `schemaVersion`, additive-within-version field addition, and the rule that breaking shape changes require a new version string rather than a silent field rename. Includes the provenance, freshness, and confidence field conventions.

### Error envelope pattern

A reusable error response factory that produces consistent `{ error: { code, message, details? } }` shapes across all failure paths. Separates operator-safe messages from internal exception details. The `buildInternalErrorResponse`, `buildInvalidInputResponse`, and `buildNotFoundResponse` helpers in CoinPulse are the reference implementation.

### Query key factory pattern

A single `queryKeys` object with typed factory functions for every DTO surface. Includes normalization rules (lowercase wallet address, explicit `schemaVersion`, `chainId`, and filter objects) so that cache fragmentation is structurally impossible. The current `src/lib/query/query-keys.ts` is the reference implementation.

### Query hook pattern

A `useQuery`-backed hook per DTO: accepts typed params, builds the query key via the factory, calls the existing API client function as `queryFn`, and exposes explicitly typed `staleTime` and `gcTime` constants. The hook never computes values; it surfaces backend DTO fields as-is. The current `use-dashboard-query.ts` and `use-tracked-wallets-query.ts` are the reference implementations.

### Mutation hook pattern

A `useMutation`-backed hook per operator action: accepts typed input, calls the API client, and encodes the invalidation policy in `onSettled`. Invalidation is scoped by the specific mutation's backend side effects; broad full-page invalidation is prohibited. The current `use-manual-sync-mutation.ts`, `use-rebuild-mutation.ts`, and `use-wallet-import-mutation.ts` are the reference implementations.

### Invalidation policy pattern

A documented, testable map from mutation type to affected query keys. Expressed in `onSettled` callbacks inside each mutation hook rather than as component-level side effects. The rule that operation-state queries are always invalidated (even on `409` and on failure) is explicit and tested.

### Operator diagnostics/readiness pattern

A backend DTO surface that exposes operation state, ingestion diagnostics, last successful sync timestamp, last rebuild timestamp, blockers, and warnings. The frontend consumes this DTO verbatim; it never infers readiness from the absence of errors. The `DebugStatusReportDto` and `HealthReportDto` in CoinPulse are the reference implementations.

### Contract test scaffolding

A minimal test scaffold for: a success-path shape test (verifies HTTP 200 and DTO fields), a failure-path shape test (verifies HTTP 500 and error envelope, no internal detail leakage), and an invalid-input test (verifies HTTP 400 and structured validation error). Uses mocked service modules with no live RPC or external service dependencies.

### AGENTS/Codex workflow rules

A set of agent workflow rules (AGENTS.md or equivalent) that encodes the architectural guardrails, branch naming convention, bounded-slice discipline, sequential verification commands, and validation failure reporting requirements. The rules prevent agents and contributors from accidentally introducing frontend accounting logic, direct RPC calls, or mock production data across PRs.

---

## 5. What Should Stay CoinPulse-Specific

The following are deliberately not extracted into a reusable template. They are specific to CoinPulse's domain, data model, or current V1 evolution state.

- **PulseChain settings and chain ID 369 defaults.** Native asset identity (`chain:369:native:PLS`), supported chain list, and source-family ingestion behavior are PulseChain-specific.
- **Canonical ledger schema.** The Prisma schema, migrations, and action-group/entry-type/direction/source-family vocabulary are CoinPulse domain model decisions.
- **Pricing and PnL materialization implementation.** The on-chain reserve-derived pricing engine, confidence/liquidity/route/freshness metadata, and average-cost PnL calculation are CoinPulse-specific and are still evolving.
- **Wallet and dashboard routes that are still evolving.** `GET /api/portfolio/dashboard`, `GET /api/wallets/tracked`, and the dashboard wallet selection flow are not yet stable enough to be extracted as reusable contracts.
- **Token, LP, and stake-specific domain logic.** Position classification, LP pair routing, stake protocol classification, and position-level warning vocabulary are domain-specific.
- **Prisma schema until stable.** The Prisma schema is still receiving additive migrations. A reusable template that depends on it directly would need constant reconciliation.
- **Production environment assumptions.** `DATABASE_URL`, `REDIS_URL`, `PULSECHAIN_RPC_URL`, and other environment variables are CoinPulse-specific deployment concerns.

---

## 6. Readiness Gate Before Extraction

The template should not become a separate repository until all of the following conditions are met. None of these are being changed by this PR.

- **G1. Dashboard wallet selection flow is stable.** The tracked-wallet selector, selected-wallet query wiring, and dashboard load behavior have shipped and have not required structural changes for at least one full release cycle.
- **G2. Tracked wallets flow is stable.** `GET /api/wallets/tracked`, `useTrackedWalletsQuery`, and the import invalidation policy are stable and have not required DTO or query-key changes across multiple PRs.
- **G3. Dashboard DTO has remained stable through several PRs.** `PortfolioDashboardDto` `schemaVersion: "v1"` shape has not changed shape for at least three consecutive PRs that touched the dashboard route.
- **G4. Operator sync, rebuild, and import flows are stable.** The mutation hooks, invalidation policy, and operation-state DTO surface have been exercised through a complete sync→materialize→rebuild cycle in production-like conditions without structural rework.
- **G5. At least one additional read DTO beyond dashboard, debug, and wallets is implemented.** A second data-surface DTO (e.g. `GET /api/prices/status` or `GET /api/transactions`) has been built using the same DTO contract style, proving the patterns generalize beyond the first three surfaces.
- **G6. Route contract tests exist for success and failure paths.** Every DTO-returning route has both a success-path and a failure-path contract test. This is already true for dashboard, debug/status, and wallets/tracked; the gate requires it for every future DTO as well.
- **G7. Query hooks and mutation hooks have consistent test coverage.** All hooks in `src/lib/query/` have unit tests covering key construction, `staleTime`/`gcTime` defaults, `queryFn` invocation, and invalidation behavior. This is the pattern established in `tests/lib/`.
- **G8. AGENTS.md workflow rules have proven useful across multiple Codex tasks.** The agent workflow rules have been applied to at least five separate bounded PRs without requiring structural revision, demonstrating that the rules are stable enough to serve as a reusable template foundation.

Until G1–G8 are satisfied, extraction is premature and risks freezing accidental conventions into a public reusable surface.

---

## 7. Recommended Future Extraction Sequence

Each step below is its own bounded future PR or task. None of these are being started in this PR.

1. **Finish CoinPulse V1 wallet/dashboard flow.** Land dashboard wallet selection (per `docs/dashboard-wallet-selection-plan.md`), confirm the full tracked-wallet → dashboard query wiring is stable.

2. **Document final DTO, query, and mutation patterns.** After G1–G8 are met, write a concise "pattern reference" document that describes the stable, generalized shapes without CoinPulse-specific domain details. This is the first extraction artifact.

3. **Create a minimal internal template folder inside `docs/` or `examples/`.** A `docs/template/` or `examples/starter/` folder that contains only documentation, rule files (AGENTS.md), and empty scaffold stubs — no extracted production code. Keep it inside CoinPulse so it can be updated in the same PR as the reference implementation.

4. **Only then create a separate repository.** Once the internal template folder has been stable for several PRs, create the external repository with exactly that content. CoinPulse remains the reference implementation; the new repo is a distillation, not a fork.

5. **Extract docs first, not code.** The first content in the separate repo is documentation: truth-model contract, DTO style guide, query key conventions, invalidation policy, and AGENTS rules.

6. **Then extract test scaffolding.** Add the minimal contract test scaffold (success-path shape test, failure-path shape test, invalid-input test) without any CoinPulse-specific mocks or domain fixtures.

7. **Then extract starter query and client utilities.** A minimal, dependency-light `queryKeys` factory, API client skeleton, and mutation hook skeleton that can be adapted for any DTO surface.

8. **Keep CoinPulse as the reference implementation.** Never let the external template diverge from what CoinPulse actually does. Any change to the template's conventions should originate as a PR inside CoinPulse first.

---

## 8. Non-Goals

The following are explicitly outside the scope of this document and all work it describes.

- No new repository.
- No code extraction from CoinPulse.
- No package publishing or npm registry registration.
- No Prisma schema generalization or cross-project schema sharing.
- No dashboard redesign or UI restructuring.
- No backend route changes or route renames.
- No frontend behavior changes.
- No Ethereum/Base execution.
- No introduction of workers, queues, Redis, or background infrastructure.
- No changes to CoinPulse accounting, pricing, PnL, or materialization semantics.

---

## 9. Decision

**Use CoinPulse as the reference implementation for now.**

The data-fetching layer — `queryKeys`, query hooks, mutation hooks, invalidation policy, route contract tests, and AGENTS workflow rules — has reached a level of consistency and test coverage that makes it worth capturing as a planning artifact. The patterns are not yet stable enough to extract as a separate public surface, but they are stable enough to describe precisely.

**Build the reusable template later, after V1 behavior is stable** (after G1–G8 above are satisfied).

**Treat the future template as architecture and contracts first, reusable code second.** The most valuable thing the template conveys is the discipline: backend owns truth, frontend consumes DTOs, query keys are stable and explicit, mutations own their invalidation policy, route contracts are tested. The code to implement that discipline in any given project is secondary.

---

## Companion Documents

- `docs/reusable-backend-template-plan.md` — backend truth model, canonical ledger, materialization, contract-test disciplines, and backend-side readiness criteria (C1–C6).
- `docs/data-fetching-architecture.md` — canonical architecture rules: truth model, DTO contract strategy, query key strategy, polling and staletime policy, invalidation policy, and API route map.
- `docs/frontend-query-standardization-audit.md` — audit of current frontend fetch state against architecture rules, and the bounded standardization plan.
- `docs/dashboard-wallet-selection-plan.md` — plan for integrating backend-tracked wallets into the dashboard query wiring.
- `AGENTS.md` — agent workflow rules for bounded PRs, validation commands, and architectural guardrails.
