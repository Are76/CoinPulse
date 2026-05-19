# G4 Operator Flow Evidence Checkpoint

## 1. Scope

This checkpoint is documentation-only. It records whether G4 from `docs/data-fetching-template-readiness-audit.md` and `docs/reusable-data-fetching-template-plan.md` is satisfied by current implementation, tests, and available in-repo operator-flow evidence.

This checkpoint does **not** run a live sync, does **not** change sync/rebuild code, does **not** create template folders, does **not** create an external repository, and does **not** extract reusable code. It also does not change source code, tests, schema, API routes, UI, query hooks, pricing/PnL/accounting semantics, or runtime behavior.

## 2. G4 requirement

G4 gate (restated): operator sync, rebuild, and import flows are stable. A complete sync -> materialize -> rebuild cycle has been exercised in production-like conditions without structural query, mutation, invalidation, or DTO rework.

The readiness audit currently flags G4 as `partial` because the implementation and tests are present, but an explicit production-like full-cycle record is still missing (`docs/data-fetching-template-readiness-audit.md`).

## 3. Current implementation evidence

- Manual sync route validates input, resolves tracked wallet, invokes `runWalletSync`, returns serialized data, and preserves conflict/validation/internal error handling (`app/api/sync/manual/route.ts`).
- Rebuild route validates input, resolves tracked wallet, runs `runRebuildOperation`, returns rebuild + materialized outputs, and preserves conflict/validation/internal error handling (`app/api/rebuild/route.ts`).
- Wallet import route validates input, imports tracked wallet, returns data, and preserves input/domain/internal error envelopes (`app/api/wallets/import/route.ts`).
- Sync and rebuild service entrypoints expose orchestrator operations through stable service modules (`src/services/sync/index.ts`, `src/services/rebuild/index.ts`).
- Operation locking includes conflict detection for active rebuild vs manual/import sync scope plus serializable reservation semantics (`src/services/operations/operation-lock.ts`).
- Debug operation-state reporting includes operation lists, blocker summary, staleness inspection, ingestion diagnostics, and last successful sync/rebuild visibility (`src/services/debug/operation-state.ts`).
- Debug client includes typed APIs for import/manual sync/rebuild/operation-state/status and shared error handling (`src/lib/api/debug-client.ts`).
- Mutation hooks remain scoped and DTO-driven for manual sync, rebuild, and wallet import, with shared invalidation helpers (`src/lib/query/use-manual-sync-mutation.ts`, `src/lib/query/use-rebuild-mutation.ts`, `src/lib/query/use-wallet-import-mutation.ts`, `src/lib/query/invalidation.ts`).
- Shared query keys remain centralized for debug status/health/operation state, wallets tracked, and dashboard contracts (`src/lib/query/query-keys.ts`).
- Route-contract, mutation-hook, invalidation, operation-state, and screen wiring tests cover operator-flow API and frontend mutation wiring expectations (`tests/api/backend-operation-routes.test.ts`, `tests/api/wallet-import-route-contract.test.ts`, `tests/lib/use-manual-sync-mutation.test.ts`, `tests/lib/use-rebuild-mutation.test.ts`, `tests/lib/use-wallet-import-mutation.test.ts`, `tests/lib/invalidation.test.ts`, `tests/services/debug/operation-state.test.ts`, `tests/components/debug-sync-screen-wiring.test.ts`, `tests/components/wallet-import-screen-wiring.test.ts`).
- Readiness and checkpoint docs provide staged gate context and prior G1/G2/G3 evidence progression (`docs/data-fetching-template-readiness-audit.md`, `docs/route-contract-coverage-index.md`, `docs/hook-mutation-test-checklist.md`, `docs/g1-dashboard-wallet-selection-stability-checkpoint.md`, `docs/g2-tracked-wallet-stability-checkpoint.md`, `docs/g3-dashboard-dto-stability-ledger.md`).

## 4. Operator-flow evidence table

| Flow area | Implementation evidence | Test evidence | Production-like evidence exists? | Structural rework required? | G4 impact |
|---|---|---|---|---|---|
| Wallet import | `POST /api/wallets/import` route + import mutation/client wiring + scoped invalidation helpers | Wallet import route-contract, mutation, and wiring tests | No explicit production-like run record found in repo docs | No structural rework indicated by current checkpoint docs | Strong implementation/test coverage; production-like proof still missing |
| Manual sync | `POST /api/sync/manual` route + sync services + manual sync mutation/client | Backend operation route tests + manual sync mutation + debug sync wiring tests | No explicit production-like run record found in repo docs | No structural rework indicated by current checkpoint docs | Flow appears stable in code/tests but not fully evidenced in production-like conditions |
| Materialization/debug status visibility | Operation-state service + debug client operation-state/status APIs | Operation-state service tests + debug sync wiring tests | No explicit production-like run artifact proving end-to-end update visibility | No structural rework indicated by current checkpoint docs | Observability path exists and is tested; real operator-cycle evidence not yet documented |
| Rebuild | `POST /api/rebuild` route + rebuild service + rebuild mutation/client | Backend operation route tests + rebuild mutation + debug sync wiring tests | No explicit production-like run record found in repo docs | No structural rework indicated by current checkpoint docs | Rebuild path is implemented/tested; live-like execution proof still absent |
| Operation lock/conflict behavior | Conflict checks and serializable reservation in operation-lock service | Backend operation route tests + operation-state tests covering blocker/stale summary semantics | No explicit production-like conflict observation record | No structural rework indicated by current checkpoint docs | Safety semantics are implemented/tested; production-like conflict evidence still needed |
| Mutation invalidation behavior | Invalidation helpers + manual/rebuild/import mutation hooks scoped to debug and tracked-wallet domains | Invalidation tests + mutation hook tests | No explicit operator-run evidence in docs validating runtime invalidation behavior during full cycle | No structural rework indicated by current checkpoint docs | Scoped invalidation policy appears stable; production-like confirmation still needed |
| Dashboard non-invalidation behavior | Query-key and invalidation boundaries maintain no broad dashboard invalidation from import/mutations by default | Invalidation tests + prior G1/G2/G3 docs and wiring evidence | No explicit production-like run proving no broad invalidation during full operator cycle | No structural rework indicated by current checkpoint docs | Guardrail appears preserved; still requires real-cycle evidence log |

## 5. Stability assessment

**G4 status: partial.**

Conservative rationale:

- Current implementation and tests are strong for wallet import, manual sync, operation-state visibility, rebuild, conflict behavior, and scoped invalidation.
- However, this checkpoint found no in-repo documented production-like sync -> materialize -> rebuild operator run record that closes the G4 gate.
- Because that production-like full-cycle evidence is required by G4 itself, G4 cannot be marked `met` and is not yet `mostly met` here.

## 6. Required evidence before full G4 closure

To mark G4 fully met, document all of the following:

1. A recorded operator run using a tracked wallet in production-like conditions.
2. Manual sync completes or fails with the expected safe error envelope.
3. Materialization/debug status reflects operation progress/results for that run.
4. Rebuild completes successfully, or conflicts safely when another operation is active.
5. Operation-lock conflict behavior is observed and recorded during realistic overlap conditions.
6. Mutation invalidations remain scoped to debug/status, debug/health, and tracked-wallet keys (where applicable).
7. Dashboard queries remain not broadly invalidated unless backend materialized truth is known refreshed.
8. No query-key, mutation-hook, route-contract, or DTO shape changes were required after the documented run.

## 7. Template readiness implication

G4 remains a blocker before:

- creating an internal template folder,
- creating an external data-fetching repository,
- extracting reusable code.

This checkpoint does not claim template readiness. It records strong implementation/test readiness but still missing production-like full-cycle proof required by G4.

## 8. Recommended next blocker

**Recommended next smallest safe blocker: a manual operator-run checklist document.**

Reason: current evidence indicates code/test readiness but lacks the required production-like run artifact. A bounded manual operator-run checklist is the smallest next step to generate reproducible evidence needed to close G4, before moving to G8 AGENTS separation notes or final pattern reference planning.
