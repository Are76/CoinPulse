# G8 Note: Reusable AGENTS/Workflow Rule Separation

## 1) Scope

This change is documentation-only. It records a separation model for future reuse of workflow/architecture governance and does **not**:

- modify application runtime behavior
- modify backend/frontend logic
- create reusable template artifacts
- create an external repository
- extract reusable code

No source code, schema, API route, UI behavior, query behavior, pricing/PnL/accounting semantics, or operational execution flow is changed by this note.

## 2) G8 requirement

G8 requires recording the boundary between:

1. **Reusable rules** that have proven useful across multiple bounded Codex tasks, and
2. **CoinPulse-specific rules** that encode domain, chain, product, and operational assumptions.

The gate intent is: AGENTS/workflow guidance can be useful beyond this repository, but external reuse is only safe after reusable architecture/workflow patterns are separated from project-specific constraints.

## 3) Reusable workflow rules

The following rules are candidates for a future data-fetching template because they are process/contract oriented rather than CoinPulse-domain bound:

- one task = one branch = one PR
- start from latest `main`
- keep PR scope small and bounded
- docs/planning before implementation when architecture is affected
- contract tests before relying on UI rendering outcomes
- DTO-first frontend consumption
- backend-owned route contracts
- explicit error envelopes and predictable error propagation
- hook/query-key/mutation-invalidation test coverage
- explicit validation/verification reporting in PR summaries
- no hidden runtime behavior changes in docs-only PRs
- no mock production data in behavior-significant paths
- no frontend inference for backend-owned truth

## 4) CoinPulse-specific rules

The following categories should **not** be copied verbatim into a generic external template:

- PulseChain assumptions and chain-specific defaults
- chain ID `369` assumptions
- canonical ledger phrasing and truth-pipeline details tied to CoinPulse internals
- ecosystem-specific token/project language (`PLS`, `PLSX`, `HEX`, `pDAI`)
- CoinPulse-specific pricing/PnL/accounting semantics
- LP/stake handling assumptions specific to CoinPulse scope
- operator/debug route naming that may differ in other projects
- Portfolio Intelligence and Break-Even Scenarios roadmap wording
- CoinPulse deployment and environment assumptions

These belong in project overlays, not baseline template governance.

## 5) Reusable-vs-specific mapping table

| rule/topic | reusable category | CoinPulse-specific category | recommended external-template wording | notes/risks |
|---|---|---|---|---|
| Branching discipline | One bounded task per branch/PR | None required | "Use one bounded task per branch and PR." | Prevents mixed-scope reviews. |
| Base synchronization | Start from latest main/default branch | CoinPulse references to `main` can remain but should allow configurable default branch names | "Start from the latest default branch before edits." | Tooling may use non-`main` default names. |
| DTO-first frontend | Frontend reads backend DTO/API contracts | CoinPulse DTO names and domain fields | "Frontend consumes versioned backend contracts only." | Avoids UI truth drift. |
| Backend truth ownership | Backend owns route contracts and truth semantics | CoinPulse canonical ledger internals | "Treat backend contracts as source of read truth." | Must not imply specific ledger implementation. |
| Error handling | Explicit error envelopes and operator-safe responses | CoinPulse-specific operator route names/messages | "Use explicit, typed error envelopes and preserve backend errors." | Avoid leaking infra/vendor specifics. |
| Test strategy | Contract/unit/hook invalidation testing | CoinPulse route names, domain fixtures | "Prefer deterministic contract and query-state tests before UI assertions." | Keep fixtures domain-neutral. |
| Docs-only PR integrity | No behavior changes in docs-only PRs | None | "Documentation PRs must not alter runtime behavior." | Easy to verify in review. |
| Data authenticity | No mock production data for behavior-significant paths | CoinPulse data-source brand names | "Do not ship mock data as production truth." | Allow explicit test-only fixtures. |
| Frontend inference boundary | No frontend inference for backend-owned truth | CoinPulse accounting/pricing/PnL phrasing | "Do not compute backend-owned truth in UI." | Phrase generically to avoid finance assumptions. |
| Validation reporting | Include exact command outcomes and failures | CoinPulse-specific command stack | "Report exact validation commands and outcomes in PR summary." | Template should define stack-specific command list separately. |

## 6) External template guardrails

A future external template should:

- stay framework-agnostic where feasible
- avoid CoinPulse domain claims
- avoid PulseChain-specific defaults
- avoid copying production secrets or environment examples
- keep DTO/read/mutation/error/invalidation patterns generic
- present Prisma/Postgres/Redis as optional examples unless explicitly selected by the template
- exclude CoinPulse-specific pricing/PnL/accounting logic

## 7) Template readiness implication

- **G8 is met** for in-repo workflow usefulness: the project has demonstrated useful bounded-task AGENTS/workflow practices.
- **G8 separation documentation is now recorded** in this note, which removes ambiguity about what is reusable vs project-specific.
- This note does **not** claim:
  - internal template folder readiness
  - external repository readiness
  - reusable code extraction readiness

Those require separate, explicit gating decisions.

## 8) Recommended next blocker

Next smallest safe step:

- If operator access is available: run and record the **G4 manual operator checklist**.
- If operator access is not available: publish a final readiness recap enumerating remaining blockers before any internal template folder is started.

This keeps progression bounded while avoiding premature extraction claims.
