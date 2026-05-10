# CoinPulse Agent Workflow

This repository is developed using bounded architecture-first slices.

## Source of truth

- GitHub `main` is the source of truth for repository state.
- PostgreSQL persisted state is the source of truth for application data.
- RPC is upstream ingestion only, never frontend truth.
- The backend truth pipeline is:
  - raw audit data
  - deterministic normalization
  - canonical ledger
  - materialized derived portfolio state
  - versioned backend DTOs
  - frontend UI
- Canonical ledger entries are accounting truth.
- Derived portfolio state must be materialized from canonical ledger truth.
- Frontend code must consume backend DTO/API contracts only.

## Branch workflow

- Do not work directly on `main`.
- Always start from latest `main`.
- Confirm the working tree is clean before edits.
- Create one branch per bounded task.
- Keep PR scope narrow.
- Do not mix infrastructure, schema, frontend, and unrelated cleanup in one PR.
- Keep governance/docs changes separate from implementation changes.
- Do not reuse old WIP patches unless explicitly requested.
- Do not delete branches until the PR is merged and no follow-up work is needed on that branch.

Preferred branch naming:

```text
feat/<bounded-slice>
fix/<bounded-fix>
refactor/<bounded-refactor>
docs/<bounded-doc-change>
test/<bounded-test-slice>

Examples:

feat/backend-operation-state
feat/persisted-operation-history
feat/operation-locking
fix/dashboard-query-regressions
docs/update-agent-instructions
test/dashboard-route-contract

If GitHub Copilot auto-prefixes branch names, document the caveat in the PR body.

Expected implementation flow
Inspect existing architecture first.
Read relevant docs when the task touches architecture, frontend data, or reusable template planning:
docs/data-fetching-architecture.md
docs/frontend-query-standardization-audit.md
docs/reusable-backend-template-plan.md
Explain the smallest safe implementation.
Add or update tests first when possible.
Implement bounded changes.
Run sequential verification:
npm run test
npm run lint
npm run typecheck
npm run build
Summarize:
files changed
architecture impact
schema impact
API/DTO impact
frontend behavior impact
tests
verification results
residual risks
next bounded task
Architecture guardrails
Backend is source of truth.
Frontend is DTO/API-only.
Never add frontend accounting logic.
Never add frontend pricing logic.
Never add frontend PnL logic.
Never add frontend LP or stake valuation logic.
Never add direct frontend RPC calls.
Never use DexScreener as source of truth.
Never use symbols or tickers as accounting identity.
Never hide stale or unavailable values behind zeroes.
Preserve provenance, timestamps, warnings, confidence, materialization metadata, and operator-safe errors.
Preserve deterministic rebuildability and idempotency.
Do not add Ethereum/Base execution unless explicitly requested.
Frontend query rules
Use the TanStack Query foundation already present in the repository.
Use shared query keys from src/lib/query/query-keys.ts.
Use existing API clients where available.
Preserve backend DTO contracts.
Do not infer backend truth in the frontend.
Do not compute balances, prices, PnL, LP values, or stake values in the UI.
Preserve backend-provided error messages.
Avoid retrying deterministic ApiClientError 4xx responses.
Do not change layout, visual styling, spacing, or component hierarchy unless the task explicitly asks for design work.
Keep dashboard and debug/sync query migrations separate unless explicitly requested.
Operational safety
Use persisted operation state.
Preserve deterministic rebuildability.
Prevent unsafe concurrent sync/rebuild operations.
Do not add workers, queues, Redis, or background infrastructure unless explicitly requested.
Preserve operator-safe failure responses.
Add route/service contract tests when DTOs, API routes, or error responses change.
Keep schema migrations minimal and additive unless explicitly requested.
Testing guidance

Prefer:

deterministic unit tests
operation lifecycle tests
route-level API contract tests
DTO mapping tests
rebuild consistency tests
no-live-RPC integration tests

Avoid:

flaky timing-based tests
hidden network dependencies
real RPC calls in tests
tests that depend on DexScreener or external services
Required verification

Run verification sequentially:

npm run test
npm run lint
npm run typecheck
npm run build

Also run:

npx prisma generate

when schema, Prisma models, Prisma Client types, or generated client usage are involved.

Do not run npm run typecheck and npm run build concurrently. Both can touch generated Next.js state.

If transient .next or typegen issues occur, rerun sequentially after a clean build and report the behavior honestly.

Required operational summary before merge

Before marking a PR merge-ready, report:

Branch name
PR URL
Target branch
GitHub merge state
CodeRabbit status
Draft/ready status
Exact changed files
Whether production code changed
Whether schema/migrations changed
Whether DTO/API contracts changed
Whether frontend behavior changed
Whether backend accounting/pricing/PnL semantics changed
Whether RPC usage behavior changed
Tests added/updated
Verification results
Residual risks
Known caveats
Temporary workarounds, if any
Whether branch deletion is safe after merge
Recommended next bounded task
Final merge readiness assessment

If branch deletion is not safe after merge, explicitly explain why.

If follow-up work is still expected on the same branch/PR, explicitly state that the branch must be retained temporarily.

If there are unresolved review comments, stale review threads, or pending checks, explicitly list them.

GitHub and Copilot tooling
If tool permissions fail for marking a PR ready, merging, or branch operations, do not waste cycles.
Report the exact manual GitHub action needed.
If GitHub Copilot auto-prefixes branch names, document the caveat in the PR body.
Do not treat a tool failure as a code failure unless verification or review shows a real issue.
Important

Keep tasks small, deterministic, and reviewable. When in doubt, stop at the smallest safe slice and recommend the next bounded task.
