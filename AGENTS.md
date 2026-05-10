Start from latest main and create a new branch:

docs/update-agent-instructions

Before editing:
1. Confirm current branch is main.
2. Pull latest main.
3. Confirm working tree is clean.
4. Confirm PR #26 is merged into main.
5. Read:
   - AGENTS.md
   - docs/data-fetching-architecture.md
   - docs/frontend-query-standardization-audit.md
   - docs/reusable-backend-template-plan.md

Task:
Update the existing AGENTS.md file with durable repository workflow and architecture instructions from the recent backend and frontend-query work.

Scope:
Documentation only.

Do not change production code.
Do not change schema, Prisma, backend accounting, sync, normalization, pricing/PnL, worker logic, frontend UI, or Ethereum/Base execution.

Important:
Do not duplicate the existing AGENTS.md content.
Preserve the good existing structure, but expand it with the missing guidance below.

Add or improve guidance for:

1. Source of truth:
- GitHub main is source of truth.
- PostgreSQL persisted state is source of truth for app data.
- Raw audit -> canonical ledger -> materialized derived state -> DTO -> UI.
- RPC is upstream ingestion only, never frontend truth.

2. Architecture guardrails:
- Do not use DexScreener as truth.
- Do not use symbols/tickers as accounting identity.
- Do not add Ethereum/Base execution unless explicitly requested.
- Preserve deterministic rebuildability and idempotency.
- Preserve provenance, timestamps, warnings, confidence, materialization metadata, and operator-safe errors.

3. Frontend query rules:
- Use the TanStack Query foundation already present.
- Use shared query keys from src/lib/query/query-keys.ts.
- Use existing API clients.
- Preserve backend DTO contracts.
- Do not infer backend truth in the frontend.
- Preserve backend-provided error messages.
- Avoid retrying deterministic ApiClientError 4xx responses.
- Do not change layout/styling unless explicitly requested.

4. Workflow:
- One task = one branch = one PR.
- Always start from latest main.
- Confirm clean working tree before edits.
- Do not reuse old WIP patches unless explicitly requested.
- Keep PRs bounded.
- Keep docs/governance changes separate from implementation changes.
- Do not delete branches until PR is merged and no follow-up work is needed.

5. Required verification:
- npm run test
- npm run lint
- npm run typecheck
- npm run build
- npx prisma generate when schema/Prisma/client types are involved
- Run verification sequentially; do not run typecheck and build concurrently.

6. Required operational summary before merge:
Include:
- branch name
- PR URL
- target branch
- merge state
- CodeRabbit status
- draft/ready status
- exact changed files
- whether production code changed
- whether schema/migrations changed
- whether DTO/API contracts changed
- whether frontend behavior changed
- whether backend accounting/pricing/PnL semantics changed
- whether RPC usage changed
- tests added/updated
- verification results
- residual risks
- known caveats
- temporary workarounds
- whether branch deletion is safe after merge
- recommended next bounded task
- final merge readiness assessment

7. GitHub/Copilot tooling:
- If tool permissions fail for marking PR ready, merging, or branch operations, do not waste cycles.
- Report the exact manual GitHub action needed.
- If Copilot auto-prefixes branch names, document it in the PR body.

Run:
npm run test
npm run lint

Open a PR titled:
docs: update agent instructions

Return the required structured operational summary.
