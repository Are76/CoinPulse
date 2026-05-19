# G2 Tracked Wallet Stability Checkpoint

## 1. Scope

This checkpoint is documentation-only. It records whether the tracked-wallet flow currently satisfies G2 from `docs/data-fetching-template-readiness-audit.md` and `docs/reusable-data-fetching-template-plan.md`.

This checkpoint does **not** change source code, tests, schema, API routes, UI, query hooks, template folders, extraction status, pricing/PnL/accounting semantics, or runtime behavior. It does **not** create an internal template folder, create an external data-fetching repository, extract reusable code, add Ethereum/Base support, implement Portfolio Intelligence, or add AI/provider integrations.

## 2. G2 requirement

G2 is the tracked-wallet stability gate:

> Tracked wallets flow is stable. `GET /api/wallets/tracked`, `useTrackedWalletsQuery`, and the import invalidation policy are stable and have not required DTO or query-key changes across multiple PRs.

The readiness audit currently classifies G2 as `partial` because implementation and tests are strong but there is no explicit multi-PR stability record yet (`docs/data-fetching-template-readiness-audit.md:26-27`). The reusable template plan also requires all G1-G8 gates before any internal template folder, external repository, or code extraction is considered (`docs/reusable-data-fetching-template-plan.md:166-179`).

## 3. Current implementation evidence

### Route and service DTO contract

- `GET /api/wallets/tracked` returns `{ data: { schemaVersion: "v1", wallets } }` and routes wallet list retrieval through `listTrackedWallets` with a stable internal-error response path (`app/api/wallets/tracked/route.ts:4-16`).
- `listTrackedWallets` selects stable wallet fields (`id`, `address`, `chainId`, `label`, `createdAt`, `updatedAt`) and returns deterministic ascending creation ordering (`src/services/api/wallets.ts:35-47`).
- `POST /api/wallets/import` parses validated input, delegates to `importTrackedWallet`, and preserves a stable error envelope for schema errors, unsupported-chain domain errors, and internal errors (`app/api/wallets/import/route.ts:11-33`).

### API client and DTO parsing

- The debug client defines tracked-wallet DTO schemas with explicit `schemaVersion: "v1"` and typed wallet fields, then parses response payloads through zod before returning data (`src/lib/api/debug-client.ts:65-108`).
- `fetchTrackedWallets` and `importWallet` route through shared API client primitives with consistent JSON transport and error propagation via `ApiClientError` (`src/lib/api/debug-client.ts:105-108`, `src/lib/api/debug-client.ts:160-197`).

### Query key and hook stability

- `queryKeys.wallets.tracked(chainId)` remains a chain-scoped key: `["wallets", "tracked", chainId]` (`src/lib/query/query-keys.ts:36-38`).
- `useTrackedWalletsQuery` consistently uses that shared chain-scoped key, shared fetcher, no retry, and fixed stale/gc lifetimes (`src/lib/query/use-tracked-wallets-query.ts:23-35`).
- `useWalletImportMutation` keeps invalidation scoped to debug status, debug health, and the chain-scoped tracked-wallet key from mutation variables (`src/lib/query/use-wallet-import-mutation.ts:23-27`).
- The mutation documentation explicitly states dashboard queries are intentionally not invalidated because wallet import does not guarantee refreshed materialized dashboard truth (`src/lib/query/use-wallet-import-mutation.ts:14-16`).

### Test coverage evidence

- Route contract tests for `GET /api/wallets/tracked` validate `schemaVersion: "v1"`, success shape, empty-state shape, stable error envelope, and stable wallet field exposure (`tests/api/wallets-tracked-route-contract.test.ts:21-104`, `tests/api/wallets-tracked-route-contract.test.ts:108-145`).
- Route contract and behavior tests for wallet import validate request validation, stable error contracts, and import behavior surfaces (`tests/api/wallet-import-route-contract.test.ts:1-216`, `tests/api/wallet-import-route.test.ts:1-188`).
- `useTrackedWalletsQuery` tests validate default chain key usage, disabled behavior, no retry, and DTO/error pass-through semantics (`tests/lib/use-tracked-wallets-query.test.ts:47-173`).
- `useWalletImportMutation` tests validate scoped invalidation behavior and non-blocking settlement semantics for invalidation promises (`tests/lib/use-wallet-import-mutation.test.ts:45-173`).
- Component wiring tests verify tracked-wallet and import UI flows continue using shared query/mutation hooks rather than ad hoc behavior (`tests/components/tracked-wallets-screen-wiring.test.ts:1-112`, `tests/components/wallet-import-screen-wiring.test.ts:1-166`).
- Dashboard selector behavior tests verify tracked-wallet selection behavior remains explicit-submit-oriented and avoids inferred dashboard truth updates (`tests/components/dashboard-tracked-wallet-selector-behavior.test.ts:212-368`).

### Prior readiness and checkpoint context

- The readiness audit currently lists G2 as a blocker due to missing explicit multi-PR tracked-wallet stability record (`docs/data-fetching-template-readiness-audit.md:113-115`).
- The G1 checkpoint recommends this G2 documentation checkpoint as the next bounded blocker and confirms continued emphasis on documentation-only readiness progress (`docs/g1-dashboard-wallet-selection-stability-checkpoint.md:103-109`).

## 4. Stability assessment

**G2 status: mostly met.**

Conservative rationale:

- Implementation and test evidence for the tracked-wallet DTO surface, chain-scoped query key, and wallet-import invalidation policy are strong and explicit.
- However, this checkpoint does not establish a formal multi-PR stability ledger proving no DTO/query-key/invalidation structural changes across multiple bounded PRs after standardization.

Because that multi-PR proof is part of G2 itself, G2 is not marked `met` yet.

## 5. Required evidence before full G2 closure

To mark G2 fully met, a future checkpoint should record all of the following:

1. No DTO changes to `GET /api/wallets/tracked` across multiple bounded PRs.
2. No query-key changes to `queryKeys.wallets.tracked(chainId)` across the same multi-PR window.
3. Wallet-import mutation invalidation remains scoped to `debug.status`, `debug.health`, and chain-scoped tracked-wallet keys.
4. Dashboard queries are not invalidated by wallet import unless backend materialization truth is explicitly known to be refreshed.
5. No frontend wallet/accounting truth inference is introduced in tracked-wallet selection/import flows.

## 6. Template readiness implication

G2 remains a blocker before:

- creating an internal template folder,
- creating a separate external data-fetching repository,
- or extracting reusable data-fetching code.

This checkpoint improves documentation confidence in the existing tracked-wallet implementation but does **not** claim template readiness. The readiness audit and reusable template plan continue to require all gates to be fully met first (`docs/data-fetching-template-readiness-audit.md:79-107`, `docs/reusable-data-fetching-template-plan.md:166-201`).

## 7. Recommended next blocker

**Recommended next blocker: G3 dashboard DTO stability ledger.**

Given this G2 result is `mostly met` (not fully closed), the next smallest safe documentation-only blocker supported by the audit is to begin the explicit dashboard DTO stability ledger evidence required by G3, while continuing to accumulate multi-PR tracked-wallet stability evidence needed to fully close G2.
