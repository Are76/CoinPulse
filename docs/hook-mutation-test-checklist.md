# Hook and Mutation Test Checklist

## Purpose

This checklist defines the required test coverage standard for CoinPulse query hooks and mutation hooks before any internal template folder or external data-fetching repository is considered.

It addresses the G7 blocker recorded in `docs/data-fetching-template-readiness-audit.md`: CoinPulse needed a generalized hook/mutation test checklist suitable for template readers.

## 1. Scope

This checklist applies to current and future hooks and query utilities under `src/lib/query/`.

This is a documentation-only checklist. It does not change source code, tests, routes, schema, pricing behavior, PnL behavior, accounting semantics, UI, template folders, repository extraction status, or template readiness by itself.

In particular, this document does not authorize:

- creating an internal template folder;
- creating a separate external data-fetching repository;
- extracting `queryKeys`, API clients, hooks, mutation hooks, invalidation helpers, tests, or components;
- adding pricing, PnL, accounting, LP, stake, or portfolio-intelligence logic to the frontend;
- adding new frontend UI;
- adding Ethereum/Base support;
- adding AI/provider integrations.

The standard below is intentionally architecture-first: backend DTOs remain the frontend truth, and hooks are responsible for cache wiring, client invocation, error preservation, and scoped invalidation only.

## 2. Current hook inventory

Current `src/lib/query/` hooks and utilities, with corresponding tests currently present in the repository:

| hook/utility | source file | current corresponding test files |
| --- | --- | --- |
| `query-client` | `src/lib/query/query-client.ts` | `tests/lib/query-client.test.ts` |
| `query-keys` | `src/lib/query/query-keys.ts` | `tests/lib/query-keys.test.ts` |
| `use-dashboard-query` | `src/lib/query/use-dashboard-query.ts` | `tests/lib/use-dashboard-query.test.ts`; related wiring tests in `tests/components/dashboard-screen-wiring.test.ts` and `tests/components/dashboard-screen-submitted-source-behavior.test.ts` |
| `use-debug-health-query` | `src/lib/query/use-debug-health-query.ts` | `tests/lib/use-debug-health-query.test.ts`; related wiring coverage in `tests/components/dashboard-screen-wiring.test.ts` |
| `use-debug-status-query` | `src/lib/query/use-debug-status-query.ts` | `tests/lib/use-debug-status-query.test.ts`; related wiring coverage in `tests/components/dashboard-screen-wiring.test.ts` |
| `use-pricing-status-query` | `src/lib/query/use-pricing-status-query.ts` | `tests/lib/use-pricing-status-query.test.ts`; related wiring coverage in `tests/components/pricing-status-screen-wiring.test.ts` |
| `use-tracked-wallets-query` | `src/lib/query/use-tracked-wallets-query.ts` | `tests/lib/use-tracked-wallets-query.test.ts`; related wiring coverage in `tests/components/tracked-wallets-screen-wiring.test.ts` and `tests/components/dashboard-tracked-wallet-selector-behavior.test.ts` |
| `use-manual-sync-mutation` | `src/lib/query/use-manual-sync-mutation.ts` | `tests/lib/use-manual-sync-mutation.test.ts`; related wiring coverage in `tests/components/dashboard-screen-wiring.test.ts` |
| `use-rebuild-mutation` | `src/lib/query/use-rebuild-mutation.ts` | `tests/lib/use-rebuild-mutation.test.ts`; related wiring coverage in `tests/components/dashboard-screen-wiring.test.ts` |
| `use-wallet-import-mutation` | `src/lib/query/use-wallet-import-mutation.ts` | `tests/lib/use-wallet-import-mutation.test.ts`; related wiring coverage in `tests/components/wallet-import-screen-wiring.test.ts` |
| `invalidateDebugOperationQueries` | `src/lib/query/invalidation.ts` | Indirectly covered by `tests/lib/use-manual-sync-mutation.test.ts` and `tests/lib/use-rebuild-mutation.test.ts`; no standalone `tests/lib/invalidation.test.ts` is present |

## 3. Read-hook test checklist

Every read hook under `src/lib/query/` must have deterministic unit coverage for the following checks:

- **Query key construction**: the hook must use the shared `queryKeys` factory and the expected key shape for all required params.
- **`queryFn` / client invocation**: the hook must call the existing API client function with exact backend-route params and must not perform direct `fetch` or RPC calls.
- **Enabled/disabled behavior, if applicable**: disabled hooks must not call the client and must remain non-fetching.
- **`staleTime` / `gcTime` defaults**: hook-specific cache lifetimes must be asserted, or the hook must intentionally inherit documented app-level defaults.
- **Error preservation**: backend/client errors must surface through TanStack Query without being replaced by fabricated frontend messages.
- **Returned DTO pass-through**: successful results must equal the DTO returned by the API client, including provenance, timestamps, warnings, confidence, materialization metadata, and operator-safe status fields when present.
- **No frontend computation or inference**: tests must prove the hook does not compute balances, prices, PnL, LP values, stake values, freshness, materialization status, or wallet/accounting truth locally.

For future read hooks, add or update `tests/lib/use-<surface>-query.test.ts` in the same PR as the hook. Component wiring tests may supplement this checklist, but they do not replace hook-level tests.

## 4. Mutation-hook test checklist

Every mutation hook under `src/lib/query/` must have deterministic unit coverage for the following checks:

- **`mutationFn` / client invocation**: the hook must call the existing API client function with exact operator-supplied args.
- **Retry policy**: deterministic backend/client errors, including 4xx and conflict responses, must not be retried unless a future backend contract explicitly marks a mutation as safe to retry.
- **`onSettled` behavior**: invalidation must run after success, failure, and conflict responses when backend side effects can affect persisted operation metadata.
- **Exact invalidated query keys**: tests must assert the full intended invalidation set and verify unrelated keys are not invalidated.
- **Non-blocking invalidation when intentionally used**: if invalidation promises are intentionally not awaited, tests must prove the mutation result is not blocked by never-settling invalidation promises.
- **Error/conflict response preservation**: backend/client `ApiClientError` instances and messages must surface unchanged through the mutation state and `mutateAsync` rejection.
- **No broad dashboard invalidation unless backend materialization truth is known refreshed**: mutation hooks must not invalidate dashboard queries unless the mutation response contract proves materialized dashboard truth has been refreshed.
- **No frontend accounting, pricing, PnL, LP, or stake computation**: mutation hooks may submit operator args and invalidate affected reads; they must not compute or infer portfolio truth.

For future mutation hooks, add or update `tests/lib/use-<operation>-mutation.test.ts` in the same PR as the hook. Component wiring tests may assert that screens import the hook, but invalidation policy belongs in hook-level tests.

## 5. Query key checklist

Every query-key factory addition or change must be covered by tests for:

- **Normalized wallet address** where wallet address is part of identity.
- **`chainId` presence** for every chain-scoped key.
- **`schemaVersion` presence** where the key protects a versioned DTO or versioned filter surface.
- **No token symbol/name identity**: token symbols, token names, quote display labels, or other presentation fields must never identify accounting or portfolio cache entries.
- **Stable object/filter semantics where applicable**: filter objects must have documented, test-protected semantics so equivalent filters do not accidentally fork cache identity or collapse distinct backend DTO requests.

A query-key test should be updated before or with any hook test that depends on a new key shape.

## 6. Coverage status table

The table below records only coverage that can be verified from the repository at the time this document was added.

| hook/utility | test file | current coverage status | exact missing checks, if any |
| --- | --- | --- | --- |
| `query-client` | `tests/lib/query-client.test.ts` | complete | None for current app-level defaults: the test verifies `retry: false`, `refetchOnWindowFocus: false`, `staleTime`, `gcTime`, and mutation `retry: false`. |
| `query-keys` | `tests/lib/query-keys.test.ts` | mostly complete | Add a dedicated stable object/filter semantics test for filtered keys such as `transactions(...)` if/when that key becomes production-used beyond the current future-facing factory coverage. |
| `use-dashboard-query` | `tests/lib/use-dashboard-query.test.ts` | partial | Add hook-level assertions for the exact shared `queryKeys.dashboard(...)` key, `DASHBOARD_STALE_TIME`, and `DASHBOARD_GC_TIME`. Current tests verify client invocation, enabled/disabled behavior, error propagation, no retry, DTO/provenance pass-through, wallet trimming, default quote asset, `asOf` forwarding, and no tracked-wallet-state inference. |
| `use-debug-health-query` | `tests/lib/use-debug-health-query.test.ts` | mostly complete | No verified gap in the required read-hook checklist. Current tests cover key construction, client invocation, enabled/disabled behavior, `staleTime`, `gcTime`, polling override, error preservation, no retry, and DTO pass-through. |
| `use-debug-status-query` | `tests/lib/use-debug-status-query.test.ts` | mostly complete | No verified gap in the required read-hook checklist. Current tests cover key construction, client invocation, enabled/disabled behavior, `staleTime`, `gcTime`, polling override, error preservation, no retry, and DTO pass-through. |
| `use-pricing-status-query` | `tests/lib/use-pricing-status-query.test.ts` | mostly complete | No verified gap in the required read-hook checklist. Current tests cover key construction, client invocation, enabled/disabled behavior, `staleTime`, `gcTime`, error preservation, no retry, DTO pass-through, and no dashboard/wallet invalidation side effects. |
| `use-tracked-wallets-query` | `tests/lib/use-tracked-wallets-query.test.ts` | mostly complete | No verified gap in the required read-hook checklist. Current tests cover default and custom chain-scoped keys, client invocation, enabled/disabled behavior, `staleTime`, `gcTime`, error preservation, no retry, and DTO pass-through. |
| `use-manual-sync-mutation` | `tests/lib/use-manual-sync-mutation.test.ts` | mostly complete | Strengthen exact invalidation coverage by asserting the invalidation call count and the absence of unrelated keys beyond dashboard, such as tracked-wallet and pricing keys. Current tests verify client invocation, success/failure/conflict settlement invalidation, no retry, backend error preservation, no dashboard invalidation, and non-blocking invalidation. |
| `use-rebuild-mutation` | `tests/lib/use-rebuild-mutation.test.ts` | mostly complete | Strengthen exact invalidation coverage by asserting the invalidation call count and the absence of unrelated keys beyond dashboard, such as tracked-wallet and pricing keys. Current tests verify client invocation, success/failure/conflict settlement invalidation, no retry, backend error preservation, no dashboard invalidation, and non-blocking invalidation. |
| `use-wallet-import-mutation` | `tests/lib/use-wallet-import-mutation.test.ts` | mostly complete | Strengthen exact invalidation coverage by asserting the invalidation call count and the absence of unrelated keys beyond dashboard, such as pricing keys. Current tests verify client invocation, success/failure/conflict settlement invalidation for debug metadata plus chain-scoped tracked wallets, no retry, backend error preservation, no dashboard invalidation, and non-blocking invalidation. |
| `invalidateDebugOperationQueries` | `tests/lib/use-manual-sync-mutation.test.ts`; `tests/lib/use-rebuild-mutation.test.ts` | partial | Add standalone helper coverage if the helper becomes part of any reusable pattern reference. Current coverage is indirect through manual-sync and rebuild mutation tests; no dedicated `tests/lib/invalidation.test.ts` verifies the helper's exact key set in isolation. |

## 7. Template readiness implication

G7 is **met for visibility** because this checklist now defines the expected read-hook, mutation-hook, and query-key coverage standard and maps the current repository coverage against it.

G7 remains **mostly met for complete hook coverage**, not fully complete, because the verified gaps above still exist:

- `use-dashboard-query` lacks hook-level assertions for the exact shared dashboard query key and hook-specific `staleTime` / `gcTime` options.
- Mutation-hook invalidation tests verify the intended keys and no dashboard invalidation, but they do not yet assert the full exact invalidation set by call count and absence of every unrelated query family.
- `invalidateDebugOperationQueries` is only indirectly covered by mutation tests.
- `query-keys` does not yet have a dedicated stable object/filter semantics test for future filtered keys such as `transactions(...)` if/when they become production-used.

Therefore, this documentation-only slice moves G7 from “no generalized hook/mutation test checklist” to **met for visibility**, while the complete coverage gate remains **mostly met** until the missing hook-level assertions are added in a separate test-only PR.

Before creating an internal template folder or external data-fetching repository, CoinPulse still needs:

1. the exact missing G7 coverage above closed or explicitly scoped as not applicable;
2. the remaining non-G7 blockers from `docs/data-fetching-template-readiness-audit.md` resolved, including stability checkpoints and production-like operator-flow evidence;
3. a generalized pattern reference that separates CoinPulse-specific details from reusable architecture rules.

## 8. Recommended next blocker

The next smallest safe blocker to address is a **test-only G7 closure slice**:

- add dashboard hook assertions for the exact shared `queryKeys.dashboard(...)` key, `DASHBOARD_STALE_TIME`, and `DASHBOARD_GC_TIME`;
- strengthen mutation tests to assert exact invalidation call counts and absence of unrelated query families;
- add standalone coverage for `invalidateDebugOperationQueries` if it is intended to appear in a future pattern reference;
- defer any production code changes, template folders, extraction, schema work, route changes, and UI changes.

This is smaller and safer than addressing release-cycle stability or production-like operator-flow evidence because it can remain deterministic, local, and documentation/test-only.
