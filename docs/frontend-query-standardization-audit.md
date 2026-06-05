# CoinPulse Frontend Query Standardization Audit

> **STATUS UPDATE (PRs #23–#177):** All five recommended sequence steps in this document are now
> complete. `QueryClient`/`QueryClientProvider` are wired, `src/lib/query/` owns all query keys and
> defaults, all page reads use `useQuery`, all operator mutations use `useMutation` with the shared
> invalidation helper, and additive new pages (`/debug/wallets/import`, `/debug/wallets/tracked`,
> `/debug/prices/status`, `/transactions`) have been added. The findings below remain accurate as a
> historical record of the state at the time of audit (PR #22); they describe a gap that is now
> closed.

## Purpose

This document audits the current state of frontend data fetching in CoinPulse against the rules defined in `docs/data-fetching-architecture.md`, and proposes a bounded standardization plan for moving the frontend onto a single, DTO-first, TanStack Query–based data layer.

This document is **planning only**. It does not change code, schemas, DTOs, accounting semantics, pricing/PnL strategy, worker logic, Prisma scripts, or backend route contracts. It does not introduce Ethereum/Base execution, and it does not start a separate reusable repository.

## Scope

- In scope
  - Audit of how current frontend pages fetch and refresh backend data.
  - Audit against `docs/data-fetching-architecture.md` rules (PostgreSQL truth, DTO-only consumption, no RPC/DexScreener as truth, no symbol-as-identity, no frontend computation of balances/prices/PnL/LP/stake).
  - A standardization proposal for a shared frontend query layer.
  - Sequencing and risk notes.
- Out of scope (explicit non-goals for this slice)
  - Implementing the standardization.
  - Adding new pages, new DTOs, or new backend routes.
  - Renaming `GET /api/portfolio/dashboard` to `GET /api/dashboard`.
  - Any Ethereum/Base execution.
  - Schema, Prisma, worker, accounting, or pricing/PnL changes.
  - Creating a separate reusable backend repo.

## Method

Audit was performed by reading the current `main` (through PR #22) and inspecting:

- `docs/data-fetching-architecture.md` — canonical architecture rules.
- `src/app/page.tsx`, `src/app/debug/sync/page.tsx` — current page shells.
- `src/components/dashboard/dashboard-screen.tsx` — dashboard stateful screen.
- `src/components/debug/debug-sync-screen.tsx` — debug/sync stateful screen.
- `src/lib/api/dashboard-client.ts`, `src/lib/api/debug-client.ts` — current API client modules.
- `src/components/ui/data-state/*`, `src/components/ui/status/*`, `src/components/ui/value/*` — shared presentation primitives.
- `app/api/portfolio/dashboard`, `app/api/debug/health`, `app/api/debug/status`, `app/api/sync/manual`, `app/api/rebuild`, `app/api/wallets/import` — backend route handlers.
- `package.json` — confirms `@tanstack/react-query@^5` is already a dependency.

## Findings

### F1. TanStack Query is installed but not wired in

- `@tanstack/react-query` is listed in `package.json`.
- There is no `QueryClient`, no `QueryClientProvider` in the app shell, and no usage of `useQuery` / `useMutation` anywhere in `src/`.
- All current frontend reads are manual `useEffect` + `useState` flows that call thin `fetch` wrappers in `src/lib/api/dashboard-client.ts` and `src/lib/api/debug-client.ts`.

Implication: the architecture document's "TanStack Query for all frontend reads, controlled mutations for operator actions" target is not yet realized. The backend contract is correct and disciplined; the frontend data layer is the gap.

### F2. Current per-page fetch behavior

- Dashboard page (`src/components/dashboard/dashboard-screen.tsx`)
  - Reads `GET /api/portfolio/dashboard`, `GET /api/debug/health`, `GET /api/debug/status` via the dashboard client.
  - Manages loading/error/empty state by hand inside the component.
  - No background polling, no shared invalidation, no shared query keys.
- Debug/sync page (`src/components/debug/debug-sync-screen.tsx`)
  - Reads `GET /api/debug/health`, `GET /api/debug/status` via the debug client.
  - Submits `POST /api/sync/manual` and `POST /api/rebuild` as plain `fetch` calls inside form handlers.
  - After mutations, refresh of related read state is handled ad hoc inside the component, not through a shared cache.

Implication: there is no single source of truth for "what is currently cached for dashboard / debug-status / debug-health", and no consistent invalidation policy after sync/rebuild.

### F3. DTO-discipline is being honored

What is already correct and must be preserved:

- The frontend consumes versioned backend DTOs (`PortfolioDashboardDto`, `HealthReportDto`, `DebugStatusReportDto`) via the API clients.
- The frontend does not call any RPC endpoint directly.
- The frontend does not use DexScreener.
- The frontend does not use symbols/tickers as accounting identity for fetching.
- The frontend does not compute balances, prices, PnL, LP, or stake values; it renders backend fields verbatim.
- Operator mutations (`/api/sync/manual`, `/api/rebuild`) are submitted with operator-supplied scope and the response is rendered verbatim.

This audit explicitly preserves all of the above. The standardization is a transport/cache refactor only; it does not loosen any guardrail.

### F4. Shared presentation primitives already exist

The components under `src/components/ui/data-state/`, `src/components/ui/status/`, and `src/components/ui/value/` are the right rendering primitives for loading / error / empty / warning / stale / unsupported states. They are already used by the current screens.

Implication: query standardization can plug into the existing primitives unchanged. Loading/error/empty rendering does not need to be redesigned to introduce TanStack Query.

### F5. Query key strategy is not yet expressed in code

`docs/data-fetching-architecture.md` already prescribes stable query keys (e.g. `["debug","health"]`, `["debug","status"]`, `["dashboard", schemaVersion, chainId, walletAddress, quoteAsset, asOf ?? "latest"]`, etc.). None of these exist in the current `src/` tree, because there is no query layer to register them in.

Implication: a single `src/lib/query/` (or equivalent) module should own keys, default `staleTime` / `gcTime`, polling cadence, and invalidation helpers, so policy lives in one place rather than being duplicated per screen.

### F6. Mutation + invalidation policy is implicit

The architecture document specifies which queries should be invalidated after `POST /api/sync/manual` and `POST /api/rebuild` (`["debug","status"]` always; `["debug","health"]` if it can change operationally; dashboard only after materialization is known to have completed; future transactions/prices/status when they exist). Today, because there is no shared cache, this policy is enforced ad hoc inside `debug-sync-screen.tsx` and not enforced at all on the dashboard.

Implication: standardizing on `useMutation` with an explicit `onSuccess` / `onError` / `onSettled` invalidation map is the cleanest way to encode the policy that already exists on paper.

### F7. Route names are stable; do not rename in this slice

- `GET /api/portfolio/dashboard` is the current stable production route.
- `GET /api/dashboard` is named in the architecture doc as a *future preferred alias*.
- Renaming during query standardization would silently break the frontend.

Implication: the audit's recommended sequence keeps the route names exactly as they are today and does not couple a route rename to the query refactor.

### F8. No `prices/status` and no canonical `transactions` DTO yet

`GET /api/prices/status` and `GET /api/transactions` are not implemented. The query layer should be designed so that adding them later is additive (new query keys + new hooks), not a redesign.

## Compliance summary against `docs/data-fetching-architecture.md`

| Architecture rule | Current state | Gap |
| --- | --- | --- |
| Frontend consumes versioned backend DTOs only | Honored | None |
| No frontend RPC reads | Honored | None |
| No DexScreener-as-truth | Honored | None |
| No symbol-as-asset-identity in fetch flow | Honored | None |
| No frontend computation of balances/prices/PnL/LP/stake | Honored | None |
| Production DTOs free of mock fallbacks | Honored | None |
| TanStack Query for all reads | **Not honored** — manual `useEffect` + `fetch` | Wire `QueryClient` and migrate reads |
| Stable, explicit query keys | **Not honored** — no keys exist | Introduce shared query-keys module |
| Per-DTO `staleTime` / `gcTime` policy | **Not honored** | Encode defaults in the query layer |
| Polling cadence per surface | **Not honored** | Encode defaults in the query layer |
| `useMutation` with explicit invalidation map | **Not honored** — ad hoc | Add mutation hooks for sync/rebuild/import |
| Shared error/loading/empty/warning primitives | Honored | Reuse unchanged |
| Stable production route names | Honored | Do not rename in this slice |

## Standardization Proposal

The proposal is intentionally minimal and additive. It replaces the transport/cache layer only. It does not change any DTO, route, schema, or rendering primitive.

### P1. Introduce a single `QueryClient` and provider

- Add one app-level `QueryClient` with default options aligned to the architecture doc (conservative `staleTime`, `gcTime`, no aggressive global polling).
- Wrap the app in `QueryClientProvider` at the root layout boundary.
- No SSR query hydration in this slice; the app is already client-rendered through the existing screen components.

### P2. Introduce a shared `src/lib/query/` module

Owned content:

- Query-key factories that mirror the architecture doc, e.g.:
  - `["debug","health"]`
  - `["debug","status"]`
  - `["dashboard", schemaVersion, chainId, walletAddress, quoteAsset, asOf ?? "latest"]`
  - reserved future keys for `["prices","status",{chainId}]`, `["transactions", schemaVersion, filters]`, `["wallets","tracked", chainId]`
- Per-key default `staleTime` / `gcTime` constants matching the architecture doc.
- A small invalidation helper that encodes "after sync/rebuild, always invalidate debug/status; conditionally invalidate health and dashboard" so that policy lives in one place.

### P3. Migrate reads to `useQuery`

- Dashboard screen: `useQuery` for the dashboard DTO, the debug/health summary, and the debug/status summary, using the existing API client functions as `queryFn` bodies (no transport rewrite, no DTO change).
- Debug/sync screen: `useQuery` for debug/health and debug/status.
- Reads keep returning the exact backend DTO they return today; the screens keep rendering with the existing data-state and value primitives.

### P4. Migrate mutations to `useMutation`

- `POST /api/sync/manual` → `useSyncManualMutation`.
- `POST /api/rebuild` → `useRebuildMutation`.
- `POST /api/wallets/import` → `useWalletImportMutation` (used as soon as it has a host page; not added as a new page in this slice).
- Each mutation's `onSettled` calls the shared invalidation helper. The invalidation policy is the one already documented in `docs/data-fetching-architecture.md`.

### P5. Preserve all existing guardrails

- No new direct RPC use, no DexScreener, no symbol-as-identity, no frontend computation.
- No DTO shape changes.
- No backend route renames.
- No new pages, no new analytics surfaces.
- Loading/error/empty/warning rendering keeps using the existing UI primitives.

### P6. Out of scope, deferred

- `GET /api/dashboard` rename or alias.
- `GET /api/prices/status` route and page.
- `GET /api/transactions` canonical DTO and shared transaction module.
- Wallet import page, debug/status page, prices/status page.
- Any analytics, allocation, DeFi detail, LP detail, stake detail, transaction history, performance pages.
- Cross-chain Ethereum/Base support.

## Recommended Sequence (each step = its own bounded PR)

1. Wire `QueryClient` + `QueryClientProvider` and add the empty `src/lib/query/` module with keys + defaults. No screen migration yet.
2. Migrate the dashboard screen reads to `useQuery`. Same DTOs, same primitives, same routes.
3. Migrate the debug/sync screen reads to `useQuery`.
4. Migrate `POST /api/sync/manual`, `POST /api/rebuild`, and (when it has a page) `POST /api/wallets/import` to `useMutation` with the shared invalidation helper.
5. Only after the above is stable, consider additive new pages (debug/status, wallet import, prices/status) and additive new DTOs (`prices/status`, canonical `transactions`).

Each step ships as its own PR, keeps backend behavior unchanged, and is independently revertable.

## Residual Risks (planning level)

- **R1.** Invalidation timing for the dashboard after `POST /api/sync/manual` is intentionally conservative: dashboard must only be invalidated when materialization is known to have completed. The implementation must not invalidate dashboard naively on sync success, or the UI will show flicker against not-yet-materialized state.
- **R2.** Polling defaults from the architecture doc (e.g. 10–15s for debug/status, 30s for debug/health) increase request volume vs. today. Defaults should remain conservative and operator-screen-only, not global.
- **R3.** Migrating reads to `useQuery` must keep the existing screen-level error/empty/warning behavior. A regression here would silently degrade the operator UX (e.g., zero values shown instead of "loading" or "unsupported"). The shared UI primitives must remain the rendering surface.
- **R4.** Query keys for the dashboard include `schemaVersion`, `chainId`, `walletAddress`, `quoteAsset`, and `asOf`. If these are derived incorrectly on the client (e.g. lowercase vs. checksum address), the cache will fragment or collide. Normalization helpers should be centralized in `src/lib/query/`.
- **R5.** Future route normalization (`/api/portfolio/dashboard` → `/api/dashboard`) is **not** part of this audit's standardization slice. Coupling a route rename to the query refactor would break the contract test suite shipped in PRs #19–#22.
- **R6.** Mutation error policy must continue to invalidate read caches on `409` and on failure, as the architecture doc requires, because persisted `SyncRun`/operation-state truth can change in those cases too.

## Conclusion

The frontend is already DTO-disciplined: it consumes backend DTOs, never reaches into RPC, never treats symbols as identity, and never recomputes accounting values. The actual gap is purely in the transport/cache layer — `@tanstack/react-query` is installed but unused, and per-screen `useEffect` + `fetch` is doing the work that a single shared query layer should own.

The standardization above introduces that shared layer in a bounded, additive, reversible way, without changing any DTO, route, schema, worker, or accounting rule, and without expanding into new pages or Ethereum/Base.
