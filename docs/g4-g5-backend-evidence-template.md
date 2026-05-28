# G4/G5 Backend Evidence Capture Template

## Purpose

This document defines the evidence that must be captured before CoinPulse can mark the G4 and G5 backend readiness gates complete.

It is a template only. It does not execute wallet import, sync, rebuild, pricing checks, RPC calls, database access, or Redis access. It does not change runtime behavior, schema, DTO contracts, route behavior, pricing/PnL/accounting logic, workers, or frontend rendering.

## Scope

This template covers two backend platform readiness gates:

- G4: wallet import -> sync -> materialize -> rebuild operator cycle evidence.
- G5: `GET /api/prices/status` persisted-pricing observability evidence.

This template must not be used to claim either gate complete until real observations from a named environment and commit are recorded.

## Required run metadata

| Field | Value |
| --- | --- |
| Evidence run ID |  |
| Environment name |  |
| Commit SHA under test |  |
| Branch/ref under test |  |
| Operator |  |
| UTC start time |  |
| UTC end time |  |
| Database target | Redacted / environment label only |
| Redis target | Redacted / environment label only |
| RPC target | Redacted / environment label only |
| Test wallet address |  |
| Chain ID | 369 |
| Notes / deviations |  |

Security rule: never paste secrets, private keys, database credentials, Redis credentials, RPC tokens, seed phrases, or private environment variable values into this document or PR body.

## G4 evidence: wallet import -> sync -> materialize -> rebuild

### G4 pass criteria

G4 may be marked complete only when all of the following are true:

- wallet import succeeds or returns a documented idempotent existing-wallet envelope.
- tracked-wallet listing shows the target wallet for the expected chain.
- manual sync can be submitted safely.
- debug/status reflects ingestion or sync progression for the same wallet/chain/environment.
- rebuild can be submitted safely.
- materialization/rebuild evidence is visible and attributable to the same run context.
- conflict behavior is tested under a safe realistic overlap condition.
- conflict/failure responses return structured operator-safe envelopes.
- no internal exception internals are leaked.
- no DTO shape changes, route contract changes, query-key changes, mutation behavior changes, or frontend accounting logic are required to complete the cycle.

If any required item cannot be safely executed, mark G4 partial rather than complete.

### G4 evidence table

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preflight env check | `npm run validate:env` or equivalent environment check | Required env vars present |  |  |  |  |  |
| Debug health baseline | `GET /api/debug/health` | Safe health envelope; no secrets |  |  |  |  |  |
| Debug status baseline | `GET /api/debug/status` | Safe status envelope with operation state |  |  |  |  |  |
| Wallet import submitted | `POST /api/wallets/import` | Success or documented idempotent existing-wallet envelope |  |  |  |  |  |
| Tracked wallet confirmed | `GET /api/wallets/tracked` | Target wallet appears for chain 369 |  |  |  |  |  |
| Manual sync submitted | `POST /api/sync/manual` or `/debug/sync` UI | Accepted safe sync envelope |  |  |  |  |  |
| Sync state observed | `GET /api/debug/status` | Sync/ingestion state updates are visible |  |  |  |  |  |
| Rebuild submitted | `POST /api/rebuild` | Accepted safe rebuild envelope |  |  |  |  |  |
| Materialization observed | Rebuild response and/or `GET /api/debug/status` | Materialization/rebuild state attributable to same run |  |  |  |  |  |
| Conflict attempted | Controlled overlap via sync/rebuild route | Conflict is safely triggered or explicitly documented as not safely executable |  |  |  |  |  |
| Conflict envelope observed | Conflicting route response | Structured 409/operator-safe envelope when conflict applies |  |  |  |  |  |
| Internal detail leakage check | Failure/conflict envelopes | No stack traces, secrets, or internal exception internals |  |  |  |  |  |
| Dashboard artifact optional | `/` dashboard | UI artifact only; not source of truth |  |  |  |  |  |

### G4 result

| Field | Value |
| --- | --- |
| G4 status | Not run / Partial / Complete / Failed |
| Completion claim allowed? | No unless all pass criteria above are satisfied |
| Required follow-up PRs |  |
| Blocking issue links |  |
| Summary |  |

## G5 evidence: persisted-pricing observability

### G5 current foundation

`GET /api/prices/status` exists and has route-contract coverage. G5 remaining work is production-like evidence, not endpoint implementation.

Current v1 response evidence is limited to fields exposed by the implemented DTO/report. The template must not require distinct fields that the current DTO does not expose.

Directly evidenceable v1 status concepts:

- top-level `status`: `ok`, `degraded`, or `unknown`.
- per-source `status`: `ok`, `degraded`, `disabled`, or `unknown`.
- `rejectedCount`, which can include stale and/or low-confidence rejected observations without distinguishing those reasons as separate status fields.
- `reason`, when supplied by the backend report.

### G5 pass criteria

G5 may be marked complete only when all of the following are true:

- `GET /api/prices/status` returns a safe versioned envelope in the target environment.
- the response reflects persisted pricing observation status rather than frontend inference.
- top-level `ok`, `degraded`, or `unknown` status is visible and attributable to backend DTO output.
- per-source `ok`, `degraded`, `disabled`, or `unknown` status is visible when sources are present.
- rejected observation counts and backend-provided reasons are recorded without claiming a distinct low-confidence or stale status unless the DTO exposes one.
- no secrets or internal exception details are leaked.
- any frontend pricing-status surface consumes backend DTO/query contracts only.
- no frontend symbol-based pricing inference is required.

If the environment lacks representative persisted pricing observations, mark G5 partial rather than complete.

### G5 evidence table

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pricing status baseline | `GET /api/prices/status` | Versioned safe envelope |  |  |  |  |  |
| Top-level status evidence | `GET /api/prices/status` | Top-level `status` is `ok`, `degraded`, or `unknown` |  |  |  |  |  |
| Per-source status evidence | `GET /api/prices/status` | Per-source `status` is `ok`, `degraded`, `disabled`, or `unknown` where sources are present |  |  |  |  |  |
| Persisted observation evidence | Backend route response / redacted DB-derived status | Status reflects persisted pricing observations |  |  |  |  |  |
| Rejected observation evidence | `GET /api/prices/status` | `rejectedCount` is recorded where present; do not infer a distinct stale/low-confidence status |  |  |  |  |  |
| Backend reason evidence | `GET /api/prices/status` | Backend-provided `reason` is recorded where present |  |  |  |  |  |
| Safe error envelope evidence | Route error path if safely testable | No internal details leaked |  |  |  |  |  |
| Frontend truth guard | Query/client review or UI artifact if present | Frontend does not infer pricing truth from symbols/external APIs |  |  |  |  |  |

### G5 result

| Field | Value |
| --- | --- |
| G5 status | Not run / Partial / Complete / Failed |
| Completion claim allowed? | No unless all pass criteria above are satisfied |
| Required follow-up PRs |  |
| Blocking issue links |  |
| Summary |  |

## Readiness update rule

After this evidence is captured:

- update `docs/backend-platform-readiness.md` in a separate bounded PR, or in the same evidence PR if the evidence PR remains docs-only.
- do not mark G4 or G5 complete unless the evidence tables above support that claim.
- if a bug is discovered, stop completion-claim work and open a separate focused bugfix PR.

## Final guardrail

Evidence must be tied to a specific environment, commit SHA, wallet/chain scope, and timestamp. Backend readiness must not be inferred from the UI looking correct or from mocked/local-only assumptions.
