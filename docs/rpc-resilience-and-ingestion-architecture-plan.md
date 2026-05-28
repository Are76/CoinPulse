# RPC Resilience and Ingestion Architecture Plan

## 1) Scope

This document is an architecture planning artifact only. It defines proposed future direction for RPC resilience and ingestion hardening in CoinPulse.

No runtime behavior is changed by this document. There are no code-path, schema, API route, service, or infrastructure changes in this PR.

## 2) Why this plan exists

This plan exists to capture architecture-audit-driven priorities before implementation work begins:

- PulseChain public RPC instability and rate limits are a concrete backend risk.
- Heavy ingestion workloads can fail partially or inconsistently without explicit resilience controls.
- Complex DeFi ingestion requires explicit provenance, diagnostics, and partial/unsupported-state representation to preserve operator trust.
- CoinPulse should strengthen backend ingestion and reliability foundations before prioritizing additional UI/UX expansion.

## 3) Current CoinPulse architecture guardrails

All future RPC resilience work must preserve the current truth model:

- PostgreSQL persisted state is the application source of truth.
- RPC is upstream ingestion input only, not frontend truth.
- Truth flow remains: raw audit snapshots -> canonical ledger -> materialized derived state -> backend DTOs -> frontend.
- Frontend remains DTO/API-only and must not compute balances, pricing, PnL, or portfolio truth.
- Deterministic rebuildability and idempotent outcomes must be preserved.
- Warnings, status, provenance, and freshness metadata are part of product truth, not optional metadata.

## 4) RPC resilience problem statement

PulseChain RPC interactions have reliability characteristics that can degrade ingestion quality if unmanaged:

- Public endpoint rate limits.
- Intermittent endpoint downtime.
- Inconsistent latency and tail latency spikes.
- Partial failures during block/log reads.
- Retry storms that amplify upstream instability.
- Provider disagreement on responses or availability windows.
- Ingestion gaps caused by transient read failures.
- Reorg/finality uncertainty that can affect event confidence.

## 5) Proposed future RPC resilience layer (interfaces only)

The following are contract-level planning concepts only (no implementation in this PR).

### `RpcEndpointRegistry`

- **Responsibility:** Maintain configured endpoint inventory and endpoint metadata relevant to selection.
- **Inputs:** Static endpoint config, optional operator overrides, health/suspension signals.
- **Outputs:** Endpoint candidates with selection metadata (priority, cooldown, allowed capability flags).
- **Non-goals:** Performing RPC calls, retry logic, or ingestion-state mutation.

### `ResilientRpcClient`

- **Responsibility:** Execute RPC requests through resilience policy and fallback sequencing.
- **Inputs:** RPC method + params, request policy hints (timeout, retry class, priority).
- **Outputs:** Normalized success payloads or structured failure objects with provenance.
- **Non-goals:** Ledger derivation, derived-state writes, or frontend data shaping.

### `RpcRequestScheduler`

- **Responsibility:** Apply bounded concurrency and request queuing/ordering policy.
- **Inputs:** Request envelopes, priority tags, global/per-endpoint concurrency limits.
- **Outputs:** Dispatch decisions and queue telemetry.
- **Non-goals:** Endpoint health computation or domain-specific ingestion classification.

### `RpcCircuitBreaker`

- **Responsibility:** Track endpoint failure windows and open/half-open/closed state transitions.
- **Inputs:** Classified failures/successes over time.
- **Outputs:** Allow/deny execution decisions and breaker state snapshots.
- **Non-goals:** Global ingestion orchestration or fallback routing policy definition.

### `RpcHealthSnapshot`

- **Responsibility:** Provide structured, queryable health diagnostics across configured endpoints.
- **Inputs:** Latency samples, failure classes, breaker states, rate-limit signals.
- **Outputs:** Time-stamped health scores and diagnostics objects suitable for operator use.
- **Non-goals:** Directly mutating ingestion state or replacing canonical ledger truth.

### `RpcFailureClassifier`

- **Responsibility:** Deterministically map raw transport/provider errors into stable failure taxonomy.
- **Inputs:** Raw error payloads, status codes, timeout/cancellation signals.
- **Outputs:** Classified failure type, retryability, severity, and warning/provenance details.
- **Non-goals:** Executing retries itself or embedding provider-specific business logic in frontend paths.

## 6) Required future behavior

Future implementation should satisfy these minimum behaviors:

- Multiple-endpoint fallback for read operations where safe.
- Exponential backoff with jitter to reduce synchronized retry pressure.
- Per-endpoint circuit breaker isolation.
- Deterministic rate-limit classification.
- Explicit timeout handling and cancellation semantics.
- Endpoint health scoring for operator diagnostics and selection policy.
- Bounded concurrency at global and endpoint scopes.
- Structured warnings/provenance emitted with failures and partial reads.
- No frontend RPC truth; frontend continues to consume backend DTO/API contracts only.

## 7) Ingestion pipeline hardening plan

RPC resilience should be integrated as an upstream reliability layer while preserving existing ingestion architecture:

- Raw snapshots remain preserved for auditability.
- Canonical ledger derivation remains deterministic.
- Ingestion idempotency remains a hard requirement.
- Rebuild behavior remains deterministic and reproducible.
- Failed/partial RPC reads become explicit diagnostic artifacts.
- Derived state is never directly mutated from ad hoc RPC responses.

## 8) Ledger / ingestion improvements to evaluate

Future bounded slices should expand and verify classification coverage in these areas:

- Internal transaction coverage.
- Smart action grouping quality.
- Swap classification completeness.
- LP add/remove classification coverage.
- Stake classification coverage.
- Ambiguous event handling pathways.
- Unsupported operation status semantics.
- Provenance attachment for every derived ledger action.

## 9) Folder structure recommendation

This plan does not mandate an immediate repo-wide refactor.

### Option A (recommended now): minimal additive structure

- Keep current service layout intact.
- Additive interfaces/types can be introduced under existing areas such as:
  - `src/services/rpc`
  - `src/services/ingestion`

### Option B (future, evidence-gated): broader domain/bounded-context structure

- Consider larger domain restructuring only when operational evidence and maintenance burden justify it.
- Perform only as a separate bounded architecture PR with explicit migration plan.

Recommendation for current sequence: **Option A**.

## 10) Testing strategy (future work)

Future implementation PRs should include deterministic tests such as:

- Unit tests for failure classification taxonomy.
- Circuit breaker transition tests.
- Retry/backoff behavior tests with fake timers.
- Endpoint fallback sequencing tests.
- Ingestion idempotency tests.
- Route contract tests for diagnostics payloads.
- No live RPC calls in unit tests.

## 11) Rollout phases

1. **Phase 1:** Docs-only architecture plan (this PR).
2. **Phase 2:** Interface/contract tests only.
3. **Phase 3:** Additive failure taxonomy and health snapshot types.
4. **Phase 4:** Additive `ResilientRpcClient` integration behind existing ingestion services.
5. **Phase 5:** Diagnostics/status DTO exposure for operator-safe visibility.
6. **Phase 6:** Production-like operator evidence collection and review.
7. **Phase 7:** Broader ingestion classification coverage improvements.

## 12) Explicit non-goals

This plan does **not**:

- Create domains or perform repo refactor now.
- Replace current sync/rebuild services now.
- Change ledger schema.
- Change pricing or PnL semantics.
- Add background jobs/workers/queues now.
- Add frontend RPC reads.
- Implement Portfolio Intelligence.
- Implement Break-Even Scenarios.
- Create template folders.
- Create external repositories.
- Extract reusable code in this step.

## 13) Recommended next PR

Recommended next smallest safe PR:

- Contract-first interfaces/tests for RPC failure taxonomy and classifier behavior.

Conditional prioritization note:

- If operator access and production-like observability evidence are immediately available, G4 operator evidence work can be prioritized first.
