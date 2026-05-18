# G1 Dashboard Wallet Selection Stability Checkpoint

## 1. Scope

This checkpoint is documentation-only. It records whether the dashboard wallet selection flow currently satisfies G1 from `docs/data-fetching-template-readiness-audit.md` and `docs/reusable-data-fetching-template-plan.md`.

This checkpoint does **not** change source code, tests, schema, API routes, UI, query hooks, template folders, extraction status, pricing/PnL/accounting semantics, or runtime behavior. It does **not** create an internal template folder, create an external data-fetching repository, extract reusable code, add Ethereum/Base support, implement Portfolio Intelligence, or add AI/provider integrations.

## 2. G1 requirement

G1 is the dashboard wallet selection stability gate:

> Dashboard wallet selection flow is stable. The tracked-wallet selector, selected-wallet query wiring, and dashboard load behavior have shipped and have not required structural changes for at least one full release cycle.

The reusable template plan states that no separate repository should be created until G1-G8 are met, and defines G1 with the shipped selector, selected-wallet query wiring, dashboard load behavior, and one-full-release-cycle structural-stability requirement (`docs/reusable-data-fetching-template-plan.md:166-179`). The readiness audit currently classifies G1 as `partial` because implementation and tests are strong but no explicit release-cycle stability record was found (`docs/data-fetching-template-readiness-audit.md:22-26`).

## 3. Current implementation evidence

### Dashboard screen wiring

- `DashboardScreen` uses shared query hooks rather than ad hoc fetches: `useTrackedWalletsQuery`, `useDashboardQuery`, `useDebugHealthQuery`, and `useDebugStatusQuery` are imported from the query layer (`src/components/dashboard/dashboard-screen.tsx:32-36`).
- The tracked wallets query is read independently of dashboard submission state (`src/components/dashboard/dashboard-screen.tsx:50`).
- The dashboard query is parameterized from `submittedParams`, not the mutable form fields, and is disabled until `submittedParams !== null` (`src/components/dashboard/dashboard-screen.tsx:55-60`).
- Selecting a tracked wallet only populates local form state by setting wallet address and chain ID (`src/components/dashboard/dashboard-screen.tsx:72-75`).
- Explicit submit validates the current form state, removes the exact dashboard query key for the submitted params to preserve explicit loading behavior, then stores submitted params and submitted source (`src/components/dashboard/dashboard-screen.tsx:77-110`).
- The tracked-wallet selector receives the current form selection and `handleSelectTrackedWallet`; the wallet query form receives the same state and `handleSubmit` (`src/components/dashboard/dashboard-screen.tsx:140-157`).
- The dashboard output sections render only when `dashboardQuery.data` exists and consume backend DTO sections directly (`src/components/dashboard/dashboard-screen.tsx:164-179`).

### Dashboard helper behavior

- `normalizeWalletSelectionInput` trims addresses, validates chain IDs, and normalizes addresses to lowercase for matching only (`src/components/dashboard/dashboard-screen-helpers.ts:14-29`).
- `resolveSubmittedWalletSource` computes the submit-time display label from submitted params and the tracked-wallet DTO list, returning tracked-wallet or manual-entry labels without changing submitted params (`src/components/dashboard/dashboard-screen-helpers.ts:37-51`).
- `findTrackedWalletMatch` and `findTrackedWalletLabel` match tracked-wallet DTOs by normalized address and chain ID, with an `Unlabeled` fallback only for display (`src/components/dashboard/dashboard-screen-helpers.ts:59-100`).
- `resolveDashboardSubmission` requires a non-empty wallet address and positive integer chain ID before producing submitted params (`src/components/dashboard/dashboard-screen-helpers.ts:102-131`).

### Query hook and key evidence

- `useDashboardQuery` calls the dashboard client, uses `queryKeys.dashboard(...)`, includes `schemaVersion`, `chainId`, `walletAddress`, `quoteAsset`, and optional `asOf`, and documents that it only surfaces the versioned backend DTO as-is (`src/lib/query/use-dashboard-query.ts:18-28`).
- `useDashboardQuery` disables fetching when `enabled` is false or the trimmed wallet address is empty (`src/lib/query/use-dashboard-query.ts:29-55`).
- `useTrackedWalletsQuery` calls the tracked-wallet client, uses `queryKeys.wallets.tracked(chainId)`, preserves backend DTO/error behavior, and does not compute portfolio truth in the UI (`src/lib/query/use-tracked-wallets-query.ts:14-35`).
- `queryKeys.dashboard(...)` normalizes the wallet address to lowercase and keys dashboard reads by `dashboard`, schema version, chain ID, wallet address, quote asset, and `asOf ?? latest` (`src/lib/query/query-keys.ts:16-30`).
- `queryKeys.wallets.tracked(chainId)` keeps the tracked-wallet key chain-scoped (`src/lib/query/query-keys.ts:36-38`).

### Test evidence

- Tracked-wallet selector behavior tests verify that selecting a tracked wallet populates wallet address and chain ID fields without triggering dashboard submission (`tests/components/dashboard-tracked-wallet-selector-behavior.test.ts:212-267`).
- The same behavior suite verifies that dashboard submission occurs only after the explicit `Load dashboard` action (`tests/components/dashboard-tracked-wallet-selector-behavior.test.ts:269-295`).
- Empty tracked-wallet state tests verify that manual wallet entry and the explicit submit button remain available and that rendering the empty state does not submit the dashboard (`tests/components/dashboard-tracked-wallet-selector-behavior.test.ts:302-368`).
- Error-state tests verify that a tracked-wallet query failure is non-blocking for manual wallet entry and dashboard submission controls (`tests/components/dashboard-tracked-wallet-selector-behavior.test.ts:375-411`).
- Wiring tests verify that the dashboard screen imports the shared `useTrackedWalletsQuery` hook, avoids direct `fetchTrackedWallets` calls, keeps `WalletQueryForm`, and maintains address/chain ID form state (`tests/components/dashboard-screen-wiring.test.ts:24-53`).
- Wiring tests verify that `handleSelectTrackedWallet` sets address and chain ID without setting submitted params or resolving a dashboard submission (`tests/components/dashboard-screen-wiring.test.ts:55-68`).
- Wiring tests explicitly record that dashboard fetch is triggered by `handleSubmit`, not by wallet selection (`tests/components/dashboard-screen-wiring.test.ts:75-80`).
- Submitted-source behavior tests verify that dashboard metadata polling is disabled through shared debug query hooks (`tests/components/dashboard-screen-submitted-source-behavior.test.ts:156-163`).
- Submitted-source behavior tests verify submit-time tracked/manual labels, that later tracked-wallet data does not flip a manual submitted source, and that an error with stale tracked data does not flip a tracked submitted source (`tests/components/dashboard-screen-submitted-source-behavior.test.ts:165-229`).
- Submitted-source behavior tests verify that stale tracked-wallet data is not used for selected-wallet helper display when the tracked-wallet query is in an error state (`tests/components/dashboard-screen-submitted-source-behavior.test.ts:231-242`).
- Submitted-source behavior tests verify that the dashboard query remains gated to explicit submit: it is called disabled before submit and after selection, then enabled only after `Load dashboard` (`tests/components/dashboard-screen-submitted-source-behavior.test.ts:261-290`).
- Dashboard query hook tests verify the exact shared dashboard query key, cache lifetimes, trimmed fetch parameters, and pass-through backend DTO behavior (`tests/lib/use-dashboard-query.test.ts:114-153`, `tests/lib/use-dashboard-query.test.ts:155-237`).
- Dashboard query hook tests verify that empty, whitespace-only, or explicitly disabled query params do not fetch (`tests/lib/use-dashboard-query.test.ts:339-392`).
- Tracked-wallet query hook tests verify the default chain-scoped tracked-wallet key, stale/gc lifetimes, disabled behavior, backend error preservation, and no retry (`tests/lib/use-tracked-wallets-query.test.ts:47-122`).

### Planning and readiness docs

- The dashboard wallet selection plan requires a selector sourced from backend-tracked wallets, explicit user action before dashboard fetch, no silent multi-wallet fetch, continued dashboard key fields, no dashboard invalidation on wallet import, and no frontend balance/pricing/PnL computation (`docs/dashboard-wallet-selection-plan.md:42-78`).
- The dashboard wallet selection plan records the milestone as complete as of PR #53, including tracked-wallet selector shell, populate-only selection, explicit dashboard submit, request contract tests, submitted source indicator, and empty tracked-wallet state link (`docs/dashboard-wallet-selection-plan.md:80-111`).
- The same plan records deferred non-goals: no auto-load on wallet selection, no default wallet selection, no dashboard query invalidation from wallet import, no multi-chain execution beyond existing chain ID handling, and no frontend computation of balances/prices/PnL (`docs/dashboard-wallet-selection-plan.md:113-123`).
- The readiness audit currently identifies G1 as `partial`, citing strong dashboard screen and test evidence while noting the missing release-cycle stability record (`docs/data-fetching-template-readiness-audit.md:22-26`).
- The readiness audit lists a release-cycle stability checkpoint for dashboard wallet selection as the first blocker before any internal template folder can be created (`docs/data-fetching-template-readiness-audit.md:53-59`).

## 4. Stability assessment

**G1 status: mostly met.**

This is a conservative upgrade from the audit table's older `partial` row for this specific checkpoint, based on the current repo evidence above. The implemented flow and tests strongly support the functional parts of G1:

- tracked-wallet selector has shipped;
- selecting a tracked wallet remains population-only;
- dashboard loading remains explicit-submit-only;
- dashboard query wiring uses submitted params, not draft form state;
- dashboard query remains disabled until submitted params exist;
- query keys remain explicit and shared;
- backend DTOs remain the source of dashboard truth;
- no frontend balance, pricing, PnL, LP valuation, or stake valuation computation is introduced by this checkpoint.

G1 is **not** marked `met` because this checkpoint did not find an explicit record proving that the flow avoided structural selector/query/dashboard-load changes for at least one full release cycle. The release-cycle proof is part of G1 itself, not just a nice-to-have.

## 5. Required evidence before full G1 closure

To mark G1 fully met, record all of the following in a future post-release checkpoint:

1. No structural changes to selected-wallet query wiring over a full release cycle.
2. No DTO/query-key changes required for the dashboard submission flow.
3. No dashboard auto-submit regression.
4. Tracked-wallet selector remains population-only until explicit submit.
5. Dashboard query remains disabled until submitted params exist.
6. No frontend balance/pricing/PnL computation introduced.

## 6. Template readiness implication

G1 remains a blocker before any internal template folder, external data-fetching repository, or reusable code extraction.

This checkpoint supports continued documentation-only readiness work because the implemented dashboard wallet selection flow is strong and tested. It does **not** claim template readiness. The reusable template plan still requires all G1-G8 gates before extraction, and the plan says extraction is premature until those gates are satisfied (`docs/reusable-data-fetching-template-plan.md:166-179`). The plan's future sequence requires confirming full tracked-wallet to dashboard query wiring stability before documenting final patterns, creating an internal template folder, creating a separate repository, or extracting starter utilities (`docs/reusable-data-fetching-template-plan.md:183-201`). The current readiness audit also says internal `docs/template/` or `examples/starter/` folders are not safe yet and lists this G1 release-cycle checkpoint as a blocker (`docs/data-fetching-template-readiness-audit.md:35-59`).

## 7. Recommended next blocker

**Recommended next blocker: G2 tracked-wallet DTO/query-key stability checkpoint.**

This checkpoint shows that G1 is mostly met but still needs full release-cycle proof. The next smallest safe blocker supported by the audit is G2 because it is adjacent to the same dashboard wallet-selection flow and already has strong implementation/test evidence, while still needing an explicit stability record for the tracked-wallet route DTO, `useTrackedWalletsQuery`, chain-scoped query key, and wallet-import invalidation policy (`docs/data-fetching-template-readiness-audit.md:26-27`).

G3 dashboard DTO stability and G4 production-like operator sync -> materialize -> rebuild evidence remain important, but G2 is the smallest next checkpoint because it can stay documentation-only and focused on the tracked-wallet DTO/query-key surface without touching source code, tests, schema, routes, UI, runtime behavior, or extraction status.
