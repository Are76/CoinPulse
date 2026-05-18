# V1 Guardrail Milestone Checkpoint

## Purpose

This checkpoint records the completed V1 guardrail hardening milestone and names the next implementation-ready slices. It is documentation-only and does not authorize source, test, schema, API route, pricing, PnL, origin, bridge, native PnL, frontend inference, analytics UI, Ethereum/Base, or reusable-template work.

## Baseline

- Branch: `docs/guardrail-milestone-checkpoint`
- Starting point: current repository state after PR #94 (`test: protect symbol identity contracts (#94)`) is present in history.
- Target branch: `main`
- Scope: one documentation file under `docs/`.

## Completed V1 guardrail hardening

The milestone is complete enough to treat the following as protected V1 guardrails rather than open planning items:

1. **Dashboard data-quality observability**
   - Dashboard surfaces now preserve backend-provided observability around materialization freshness, ledger coverage, warnings, stale/unavailable data, and operator-safe status rather than hiding uncertainty behind zeroes or frontend assumptions.
2. **PnL coverage and PnL status contract tests**
   - PnL coverage is backend-computed observability, not a frontend formula. Contract coverage protects supported/unsupported PnL status behavior and warning propagation while keeping unsupported LP/stake/native cases explicit.
3. **Token metadata provenance display**
   - Dashboard token rows can display backend-owned metadata provenance as DTO pass-through. The frontend may render provenance but must not infer trust, origin, bridge status, or pricing/PnL meaning from metadata labels.
4. **Token metadata trust/source policy**
   - The trust/source policy defines the vocabulary future slices should use for source kind, status, freshness, confidence, conflict, rejection, and unknown handling. It remains the policy reference before stronger metadata, origin, or UI claims are added.
5. **Token identity/origin policy reconciliation**
   - Token identity/origin planning now reconciles with metadata trust/source policy and keeps origin, native/wrapped, and bridge/source attribution unknown-first until backend evidence supports a claim.
6. **Token metadata policy mapping tests**
   - Policy mapping test coverage has started protecting the allowed metadata status/source vocabulary and preventing UI or route behavior from inventing stronger trust claims than the backend provides.
7. **Symbol-is-not-identity regression tests**
   - Regression coverage protects same-symbol/different-contract behavior so symbols, tickers, names, or branding cannot become accounting identity.
8. **TanStack Query/read/mutation/invalidation standardization**
   - Frontend fetching has moved to the shared TanStack Query foundation with shared query keys, DTO-first read hooks, operator mutation hooks, and invalidation behavior, while preserving backend DTO contracts.
9. **Pricing status observability**
   - Pricing status has backend DTO, client/query, and operator-facing observability coverage. It reports source/status health and must not be interpreted as token metadata, origin, bridge, or PnL support.

## Next implementation-ready candidates

The next PRs should stay bounded, contract-first, and backend-truth-first. Recommended candidates, in priority order:

1. **Metadata status/source policy mapping tests for remaining gaps**
   - Add or tighten tests for unsupported, stale, conflict, and rejected metadata gaps if they are not already fully covered by current route, service, component, and policy mapping tests.
   - This is the safest next implementation PR because it hardens policy behavior without changing schema or UI semantics.
2. **Backend-only metadata status computation, only with persisted evidence**
   - Add backend metadata status computation for stale/conflicting/rejected metadata only if the current database evidence can support deterministic results or if a minimal additive persistence slice is explicitly approved first.
   - Do not compute metadata status in the frontend.
3. **Additive token/asset identity DTO fields, only if needed**
   - Add DTO fields only if current `assetId`, `assetAddress`, `chainId`, and metadata provenance surfaces are insufficient for operator-safe inspection.
   - Keep any DTO changes additive, versioned or compatibility-safe, and covered by route/service contract tests.
4. **Canonical transactions DTO planning and contract tests**
   - Plan and test a backend DTO surface for canonical transactions before UI work. The DTO should expose ledger-backed transaction truth without adding frontend accounting, pricing, PnL, origin, or bridge inference.
5. **Route normalization compatibility strategy**
   - Plan compatibility for any future route normalization so existing clients, query keys, operator surfaces, and DTO contracts remain stable during migration.

## Explicitly deferred

The following remain deferred and should not be bundled into the next guardrail-hardening PRs:

- Origin implementation.
- Bridge/source attribution.
- Native PnL.
- Richer analytics UI.
- Ethereum/Base.
- Reusable template extraction.

## Stale or partially stale docs to update later

These docs are still useful as historical planning references, but future documentation-only cleanup should mark completed slices and prevent reviewers from mistaking old plan language for current gaps:

- `docs/frontend-query-standardization-audit.md` — originally described TanStack Query as not wired in; that is now stale after query/read/mutation/invalidation standardization.
- `docs/reusable-data-fetching-template-plan.md` — should distinguish completed in-repo query standardization from still-deferred reusable template extraction.
- `docs/reusable-backend-template-plan.md` — should continue to make clear that template extraction is deferred and not authorized by V1 guardrail completion.
- `docs/pnl-status-coverage-audit.md` and `docs/pnl-coverage-dto-plan.md` — should be refreshed where older planning language describes PnL coverage/status contract work that has since landed.
- `docs/dashboard-data-quality-audit.md` — should receive a status note that dashboard data-quality observability and pricing status observability are completed guardrails, while richer analytics remain deferred.
- `docs/token-identity-origin-plan.md` — should reference this checkpoint when separating completed identity-policy reconciliation from deferred origin/bridge/native implementation.

## Recommended next PR

Recommended next implementation PR: `test/metadata-policy-gap-coverage`.

Scope that PR to metadata status/source policy mapping tests for unsupported, stale, conflict, and rejected cases that are not already fully covered. Do not change schema, API routes, frontend inference, analytics UI, origin, bridge/source attribution, native PnL, Ethereum/Base execution, or reusable templates in that PR.
