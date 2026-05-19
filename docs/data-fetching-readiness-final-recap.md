# Data-Fetching Readiness Final Recap

## 1. Scope

This is a documentation-only recap for the reusable data-fetching/template track after the recent checkpoint work.

It does **not**:

- create an internal template folder
- create an external repository
- extract reusable code
- change runtime behavior
- change source code, tests, schema, API routes, UI, query hooks, pricing, PnL, accounting, Portfolio Intelligence, Break-Even Scenarios, AI/provider integrations, or chain support

This document only summarizes the current G1-G8 state and the remaining blockers before any internal template folder, external data-fetching repository, or reusable extraction work is considered.

## 2. Current Gate Summary

| gate | current status | supporting evidence docs/tests | remaining blocker | safe next action |
| --- | --- | --- | --- | --- |
| G1 | mostly met | `docs/g1-dashboard-wallet-selection-stability-checkpoint.md`; `docs/dashboard-wallet-selection-plan.md`; `tests/components/dashboard-tracked-wallet-selector-behavior.test.ts`; `tests/components/dashboard-screen-wiring.test.ts`; `tests/components/dashboard-screen-submitted-source-behavior.test.ts`; `tests/lib/use-dashboard-query.test.ts` | Full release-cycle stability proof for selector, explicit-submit flow, and submitted-params query behavior is still missing. | Record a docs-only post-release stability checkpoint after one full release cycle with no structural selector/query changes. |
| G2 | mostly met | `docs/g2-tracked-wallet-stability-checkpoint.md`; `tests/api/wallets-tracked-route-contract.test.ts`; `tests/api/wallet-import-route-contract.test.ts`; `tests/lib/use-tracked-wallets-query.test.ts`; `tests/lib/use-wallet-import-mutation.test.ts` | Multi-PR tracked-wallet DTO, query-key, and import-invalidation stability proof is still missing. | Continue a docs-only multi-PR stability ledger for `GET /api/wallets/tracked`, `queryKeys.wallets.tracked(chainId)`, and wallet-import invalidation scope. |
| G3 | mostly met | `docs/g3-dashboard-dto-stability-ledger.md`; `tests/api/portfolio-dashboard-route-contract.test.ts`; `tests/api/portfolio-dashboard-route.test.ts`; `tests/lib/use-dashboard-query.test.ts`; `tests/services/dashboard/portfolio-dashboard.test.ts`; `tests/components/dashboard-screen-wiring.test.ts` | Explicit proof of three consecutive dashboard-touching PRs without DTO shape changes is still missing. | Keep the dashboard DTO stability ledger current until three qualifying dashboard-touching PRs are recorded without shape drift. |
| G4 | partial | `docs/g4-manual-operator-run-checklist.md`; `docs/g4-operator-flow-evidence-checkpoint.md`; `tests/api/backend-operation-routes.test.ts`; `tests/api/wallet-import-route-contract.test.ts`; `tests/lib/use-manual-sync-mutation.test.ts`; `tests/lib/use-rebuild-mutation.test.ts`; `tests/lib/use-wallet-import-mutation.test.ts`; `tests/lib/invalidation.test.ts` | Successful production-like operator-run evidence for import, sync, materialize, rebuild, and conflict behavior is still missing. | If operator access is ready, run the manual checklist and record evidence in a docs-only PR. |
| G5 | met for current pricing status DTO evidence | `docs/data-fetching-template-readiness-audit.md`; `app/api/prices/status/route.ts`; `tests/api/prices-status-route-contract.test.ts`; `tests/lib/use-pricing-status-query.test.ts`; `tests/services/pricing/prices-status.test.ts` | No current G5 blocker for the present pricing-status DTO surface. | Keep future non-dashboard DTOs contract-first and backend-truth-first. |
| G6 | complete for current V1 routes | `docs/route-contract-coverage-index.md`; `tests/api/portfolio-dashboard-route-contract.test.ts`; `tests/api/debug-status-route-contract.test.ts`; `tests/api/debug-health-route.test.ts`; `tests/api/prices-status-route-contract.test.ts`; `tests/api/wallets-tracked-route-contract.test.ts`; `tests/api/backend-operation-routes.test.ts` | No blocker for current routes, but every future route must be added to the route coverage index with applicable success and error coverage. | Require future DTO/API routes to add index entries and route-contract coverage in the same bounded PR. |
| G7 | complete for current hooks and mutations | `docs/hook-mutation-test-checklist.md`; `tests/lib/query-client.test.ts`; `tests/lib/query-keys.test.ts`; `tests/lib/use-dashboard-query.test.ts`; `tests/lib/use-debug-health-query.test.ts`; `tests/lib/use-debug-status-query.test.ts`; `tests/lib/use-tracked-wallets-query.test.ts`; `tests/lib/use-pricing-status-query.test.ts`; `tests/lib/use-manual-sync-mutation.test.ts`; `tests/lib/use-rebuild-mutation.test.ts`; `tests/lib/use-wallet-import-mutation.test.ts`; `tests/lib/invalidation.test.ts` | No blocker for current hooks, but future hooks must add their own checklist coverage. | Keep new hooks and mutation helpers gated on explicit checklist coverage in the same PR. |
| G8 | met for in-repo usefulness; external reuse still gated | `docs/g8-agents-reusable-rule-separation.md`; `docs/data-fetching-template-readiness-audit.md`; `docs/v1-guardrail-milestone-checkpoint.md`; `AGENTS.md` | Do not copy `AGENTS.md` externally until reusable workflow rules are curated separately from CoinPulse-specific rules. | Use the separation note as the boundary document and avoid verbatim external copying. |

## 3. Readiness By Extraction Stage

### Internal documentation-only pattern reference readiness

Status: possibly ready / nearly ready.

Conservative rationale:

- the in-repo query, mutation, route-contract, and workflow patterns are documented and tested well enough to summarize
- G5, G6, G7, and the in-repo side of G8 are already documented strongly
- the missing work is still primarily stability proof and production-like evidence, not basic pattern discovery

This stage is safe only if it remains documentation-only, non-executable, and clearly marked as non-extraction.

### Internal template folder readiness

Status: not ready.

Conservative rationale:

- G1 full release-cycle stability proof is still missing
- G2 multi-PR tracked-wallet stability proof is still missing
- G3 dashboard DTO stability proof across three qualifying PRs is still missing
- G4 production-like operator-run evidence is still missing
- a final reusable pattern reference that removes CoinPulse-specific domain details is still missing

No internal template folder should be started until those blockers are closed.

### External repository readiness

Status: not ready.

Conservative rationale:

- the internal template-folder stage has not been reached
- G1-G4 are not all closed
- G8 explicitly warns against externalizing `AGENTS.md` verbatim
- the project still needs an extraction-neutral pattern reference before any external repo is considered

### Reusable code extraction readiness

Status: not ready.

Conservative rationale:

- docs-first extraction sequencing has not been completed
- no internal template folder has been stabilized
- no external docs-first repo exists
- CoinPulse-specific query, pricing, accounting, and operator-flow assumptions have not been distilled into generic starter code

## 4. Remaining Blockers Before Internal Template Folder

- G1 full release-cycle stability proof
- G2 multi-PR tracked-wallet stability proof
- G3 dashboard DTO stability ledger with three qualifying dashboard-touching PRs
- G4 successful production-like operator-run evidence
- final reusable pattern reference that strips CoinPulse-specific domain details

## 5. What Is Safe Next

- If operator access is ready: run the G4 manual operator checklist and record evidence in a docs-only PR.
- If operator access is not ready: draft an internal documentation-only reusable pattern reference, not a template folder, and mark it explicitly as non-executable and non-extraction.

## 6. What Is Not Safe Yet

- Do not create an internal template folder.
- Do not create a separate external data-fetching repository.
- Do not extract reusable code.
- Do not copy `AGENTS.md` verbatim to another repository.
- Do not extract CoinPulse query hooks as generic utilities.
- Do not extract pricing, PnL, accounting, ledger, or materialization logic.
- Do not add Portfolio Intelligence or Break-Even runtime implementation as part of template readiness.

## 7. Recommended Next Blocker

Recommended next blocker: docs-only reusable pattern reference if the operator environment is not ready.

Rationale:

- this repository contains strong in-repo evidence for current DTO/query/mutation/coverage patterns
- current docs still lack one final recap-level reusable pattern reference that removes CoinPulse-specific domain details
- G4 should take precedence only when a real operator-capable environment is ready for safe evidence capture

If operator access becomes ready first, a G4 operator evidence PR should become the next blocker instead.

## Final Assessment

Current recap outcome:

- internal documentation-only pattern reference: nearly ready
- internal template folder: not ready
- external repository: not ready
- reusable code extraction: not ready

The safe conclusion is unchanged: CoinPulse can continue documentation-only readiness work, but it should not start an internal template folder, external repo, or reusable extraction until the remaining G1-G4 evidence blockers and the final generalized pattern reference are complete.
