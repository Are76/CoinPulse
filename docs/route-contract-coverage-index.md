# Route Contract Coverage Index

## Purpose and scope

This documentation-only index records the G6 route-contract coverage evidence for `docs/data-fetching-template-readiness-audit.md`: reviewers need one place to verify current CoinPulse DTO/API route contract-test coverage without re-auditing the test tree manually.

This file does **not** change source code, tests, schema, API routes, template folders, repositories, extraction status, pricing/PnL/accounting logic, frontend UI, RPC behavior, or supported chains.

Coverage status meanings:

- **complete**: current applicable route contract branches have success and relevant error-path coverage for the implemented route behavior.
- **mostly complete**: the route has strong success and main error-path coverage, with one or more exact applicable gaps listed below.
- **partial**: the route has some route-level coverage but misses multiple applicable contract branches.
- **missing**: no route-level contract coverage was found.

Applicability notes:

- Validation-error tests apply to routes with request input.
- Not-found tests apply to routes that resolve a requested backend entity before running the route action.
- Conflict tests apply to operator mutations guarded by the operation-lock conflict path.
- Failure-path/internal-error tests apply to every route with an internal error envelope path.

## Current V1 required route coverage

| Route | Kind | Route handler | Service layer | Client | Query/mutation hook | Success-path tests | Validation-error tests | Not-found tests | Conflict tests | Failure/internal-error tests | Coverage status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/portfolio/dashboard` | DTO-read | `app/api/portfolio/dashboard/route.ts` | `src/services/dashboard/portfolio-dashboard.ts`; wallet lookup in `src/services/api/wallets.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/dashboard-client.ts` | `src/lib/query/use-dashboard-query.ts` | `tests/api/portfolio-dashboard-route.test.ts` (`returns the assembled dashboard dto for a valid wallet and chain`); `tests/api/portfolio-dashboard-route-contract.test.ts` DTO-shape/materialization/freshness/coverage cases | `tests/api/portfolio-dashboard-route.test.ts` (`returns a structured validation error for invalid inputs`) | `tests/api/portfolio-dashboard-route.test.ts` (`returns not found when the wallet is missing`) | Not applicable | `tests/api/portfolio-dashboard-route.test.ts` (`returns a stable internal error response when dashboard assembly throws`) | complete |
| `GET /api/debug/status` | support/status route | `app/api/debug/status/route.ts` | `src/services/debug/health.ts`; operation state in `src/services/debug/operation-state.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-debug-status-query.ts` | `tests/api/debug-status-route-contract.test.ts` (`returns persisted ingestion and materialization diagnostics end-to-end`; `handles missing persisted diagnostics safely`); `tests/api/debug-health-route.test.ts` (`returns safe backend status metadata`) | Not applicable | Not applicable | Not applicable | `tests/api/debug-health-route.test.ts` (`returns a stable internal error response when status assembly throws`) | complete |
| `GET /api/debug/health` | support/status route | `app/api/debug/health/route.ts` | `src/services/debug/health.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-debug-health-query.ts` | `tests/api/debug-health-route.test.ts` (`returns backend readiness without secrets`; `returns 503 when a dependency is unavailable`) | Not applicable | Not applicable | Not applicable | `tests/api/debug-health-route.test.ts` (`returns a stable internal error response when health assembly throws`) | complete |
| `GET /api/prices/status` | DTO-read support/status route | `app/api/prices/status/route.ts` | `src/services/api/prices.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/prices-client.ts` | `src/lib/query/use-pricing-status-query.ts` | `tests/api/prices-status-route-contract.test.ts` (`returns envelope with schemaVersion v1`; status `unknown`, `ok`, `degraded`, disabled-source, low-confidence, timestamp, and bounded-query semantics cases) | Not applicable | Not applicable | Not applicable | `tests/api/prices-status-route-contract.test.ts` (`returns HTTP 500 with safe error envelope on unexpected service error`) | complete |
| `GET /api/wallets/tracked` | DTO-read | `app/api/wallets/tracked/route.ts` | `src/services/api/wallets.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-tracked-wallets-query.ts` | `tests/api/wallets-tracked-route-contract.test.ts` (`returns 200 with schemaVersion v1 and wallet list when multiple wallets exist`; `returns 200 with schemaVersion v1 and empty wallets array when no wallets exist`; `returns only backend-owned stable fields for each wallet`) | Not applicable | Not applicable | Not applicable | `tests/api/wallets-tracked-route-contract.test.ts` (`returns 500 with stable error envelope and no internal details when service throws`) | complete |
| `POST /api/wallets/import` | operator mutation | `app/api/wallets/import/route.ts` | `src/services/api/wallets.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-wallet-import-mutation.ts` | `tests/api/wallet-import-route-contract.test.ts` (`returns 200 with stable wallet data shape on success`; `returns 200 with stable wallet data shape on success without optional label`); `tests/api/wallet-import-route.test.ts` (`imports a wallet idempotently through the wallet service`) | `tests/api/wallet-import-route-contract.test.ts` missing/empty/non-numeric/negative input cases; `tests/api/wallet-import-route.test.ts` (`returns a structured validation error for invalid import input`) | Not applicable | Not applicable; duplicate import is idempotent in current behavior, not a 409 conflict route | `tests/api/wallet-import-route-contract.test.ts` (`returns 400 with UNSUPPORTED_CHAIN when service raises WalletImportError`; `returns 500 with operator-safe error envelope and no internal details when service throws unexpectedly`) | complete |
| `POST /api/sync/manual` | operator mutation | `app/api/sync/manual/route.ts` | `src/services/sync/index.ts`; wallet lookup in `src/services/api/wallets.ts`; operation conflicts in `src/services/operations/operation-lock.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-manual-sync-mutation.ts` | `tests/api/backend-operation-routes.test.ts` (`validates input, resolves the wallet, and delegates to the sync service`) | `tests/api/backend-operation-routes.test.ts` (`returns a structured validation error for invalid sync input`) | `tests/api/backend-operation-routes.test.ts` (`returns not found when the requested tracked wallet is absent`) | `tests/api/backend-operation-routes.test.ts` (`returns a structured 409 conflict when manual sync is blocked by an active rebuild`) | `tests/api/backend-operation-routes.test.ts` (`returns a safe internal error response for unexpected sync failures`) | complete |
| `POST /api/rebuild` | operator mutation | `app/api/rebuild/route.ts` | `src/services/rebuild/index.ts`; wallet lookup in `src/services/api/wallets.ts`; operation conflicts in `src/services/operations/operation-lock.ts`; request/error helpers in `src/services/api/validation.ts` | `src/lib/api/debug-client.ts` | `src/lib/query/use-rebuild-mutation.ts` | `tests/api/backend-operation-routes.test.ts` (`delegates rebuild and materialization to the backend services`) | `tests/api/backend-operation-routes.test.ts` (`returns a structured validation error for invalid rebuild input`) | `tests/api/backend-operation-routes.test.ts` (`returns not found when the requested rebuild wallet is absent`) | `tests/api/backend-operation-routes.test.ts` (`returns a structured 409 conflict when rebuild is blocked by an active sync`) | `tests/api/backend-operation-routes.test.ts` (`returns a safe internal error response for unexpected rebuild failures`) | complete |

## Current V1 coverage gaps

No open route-level contract-test gaps are identified for the current implemented V1 route set. PR #108 closed the previously listed debug health, manual sync, and rebuild validation/not-found/internal-error route-level gaps.

No missing validation-error, not-found, or conflict tests are listed for routes where that branch is not implemented or not applicable.

## Future DTO route coverage

Future DTO/API routes should be added to this index in the same PR that introduces the route or its contract tests. For each future route, record:

- Route handler file.
- Service layer file, if applicable.
- Client file, if applicable.
- Query or mutation hook, if applicable.
- Route kind: DTO-read, operator mutation, or support/status route.
- Success-path route tests.
- Validation-error tests, if the route has request input.
- Not-found tests, if the route resolves a requested backend entity.
- Conflict tests, if the route is operation-lock guarded.
- Failure-path/internal-error tests.
- Coverage status and exact missing tests only.

This index does not approve adding future routes. It only defines how coverage should be recorded if a separately approved bounded route slice adds one.

## Extraction/template readiness implications

G6 is **complete for current V1 routes** because this index now gives reviewers a single V1 route-by-route view of current route contract coverage and PR #108 closed the previously listed route-level validation, not-found, and internal-error gaps for the implemented route branches.

This status is limited to the current implemented V1 route set. It does not authorize source, schema, DTO, API, pricing, PnL, accounting, frontend UI, RPC, chain-support, template-folder, separate-repo, or extraction work.

Recommended next blocker to address: record the G1 release-cycle stability checkpoint for dashboard wallet selection and submitted dashboard query behavior. That is the next smallest readiness blocker now that current G6 and G7 coverage gaps are closed.
