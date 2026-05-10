# CoinPulse Agent Workflow

This repository is developed using bounded architecture-first slices.

## Branch workflow

- Create one branch per bounded task.
- Keep PR scope narrow.
- Do not mix infrastructure, schema, frontend, and unrelated cleanup in one PR.
- Keep governance/docs changes separate from implementation changes.

Preferred branch naming:

```text
feat/<bounded-slice>
fix/<bounded-fix>
refactor/<bounded-refactor>
```

Examples:

```text
feat/backend-operation-state
feat/persisted-operation-history
feat/operation-locking
fix/dashboard-query-regressions
```

## Expected implementation flow

1. Inspect existing architecture first.
2. Explain the smallest safe implementation.
3. Add or update tests first when possible.
4. Implement bounded changes.
5. Run sequential verification:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

6. Summarize:
   - files changed
   - architecture impact
   - schema impact
   - API impact
   - tests
   - verification results

## Architecture reminders

- Backend is source of truth.
- Frontend is DTO/API-only.
- Never add frontend accounting logic.
- Never add frontend pricing logic.
- Never add frontend PnL logic.
- Never add direct frontend RPC calls.
- Never hide stale or unavailable values behind zeroes.
- Preserve provenance, timestamps, warnings, and confidence.

## Operational safety

- Use persisted operation state.
- Preserve deterministic rebuildability.
- Prevent unsafe concurrent sync/rebuild operations.
- Do not add workers/queues/Redis unless explicitly requested.

## Testing guidance

Prefer:

- deterministic unit tests
- operation lifecycle tests
- route-level API tests
- DTO mapping tests

Avoid:

- flaky timing-based tests
- hidden network dependencies
- real RPC calls in tests

## Important

Do not run `npm run typecheck` and `npm run build` concurrently. Run verification sequentially because both touch generated Next.js state.
