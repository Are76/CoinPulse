# G4/G5 Backend Evidence Run Record

## Purpose

This document records the current G4/G5 evidence-run status for CoinPulse backend platform readiness.

It is documentation only. It does not execute wallet import, sync, rebuild, pricing checks, RPC calls, database access, Redis access, or frontend rendering. It does not change runtime behavior, schema, DTO contracts, route behavior, pricing/PnL/accounting logic, workers, or query behavior.

## Source template

This run record follows `docs/g4-g5-backend-evidence-template.md`.

## Current result

No real environment evidence has been captured in this PR.

G4 and G5 must remain incomplete until observations from a named environment, commit SHA, wallet/chain scope, and timestamp are recorded.

## Required run metadata

| Field | Value |
| --- | --- |
| Evidence run ID | Not run |
| Environment name | Not run |
| Commit SHA under test | Not run |
| Branch/ref under test | Not run |
| Operator | Not run |
| UTC start time | Not run |
| UTC end time | Not run |
| Database target | Not run / redacted environment label only |
| Redis target | Not run / redacted environment label only |
| RPC target | Not run / redacted environment label only |
| Test wallet address | Not run |
| Chain ID | 369 |
| Notes / deviations | Evidence-run scaffold only; no completion claim. |

Security rule: never paste secrets, private keys, database credentials, Redis credentials, RPC tokens, seed phrases, or private environment variable values into this document or PR body.

## G4 evidence: wallet import -> sync -> materialize -> rebuild

### G4 evidence table

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preflight env check | `npm run validate:env` or equivalent environment check | Required env vars present | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Debug health baseline | `GET /api/debug/health` | Safe health envelope; no secrets | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Debug status baseline | `GET /api/debug/status` | Safe status envelope with operation state | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Wallet import submitted | `POST /api/wallets/import` | Success or documented idempotent existing-wallet envelope | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Tracked wallet confirmed | `GET /api/wallets/tracked` | Target wallet appears for chain 369 | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Manual sync submitted | `POST /api/sync/manual` or `/debug/sync` UI | Accepted safe sync envelope | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Sync state observed | `GET /api/debug/status` | Sync/ingestion state updates are visible | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Rebuild submitted | `POST /api/rebuild` | Accepted safe rebuild envelope | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Materialization observed | Rebuild response and/or `GET /api/debug/status` | Materialization/rebuild state attributable to same run | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Conflict attempted | Controlled overlap via sync/rebuild route | Conflict is safely triggered or explicitly documented as not safely executable | Not run | Not run | Not captured | Not run | Must be captured only if safe. |
| Conflict envelope observed | Conflicting route response | Structured 409/operator-safe envelope when conflict applies | Not run | Not run | Not captured | Not run | Must be captured only if safe. |
| Internal detail leakage check | Failure/conflict envelopes | No stack traces, secrets, or internal exception internals | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Dashboard artifact optional | `/` dashboard | UI artifact only; not source of truth | Not run | Not run | Not captured | Not run | Optional. |

### G4 result

| Field | Value |
| --- | --- |
| G4 status | Not run |
| Completion claim allowed? | No |
| Required follow-up PRs | Evidence-run PR after real environment run, or bugfix PR if evidence exposes a defect. |
| Blocking issue links | None recorded in this scaffold. |
| Summary | G4 evidence has not been captured. Backend platform readiness cannot mark G4 complete from this document. |

## G5 evidence: persisted-pricing observability

### G5 evidence table

| Item | Command / route / page | Expected result | Actual result | Timestamp UTC | Artifact link / excerpt | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pricing status baseline | `GET /api/prices/status` | Versioned safe envelope | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Top-level status evidence | `GET /api/prices/status` | Top-level `status` is `ok`, `degraded`, or `unknown` | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Per-source status evidence | `GET /api/prices/status` | Per-source `status` is `ok`, `degraded`, `disabled`, or `unknown` where sources are present | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Persisted observation evidence | Backend route response / redacted DB-derived status | Status reflects persisted pricing observations | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Rejected observation evidence | `GET /api/prices/status` | `rejectedCount` is recorded where present; do not infer a distinct stale/low-confidence status | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Backend reason evidence | `GET /api/prices/status` | Backend-provided `reason` is recorded where present | Not run | Not run | Not captured | Not run | Must be captured in real environment. |
| Safe error envelope evidence | Route error path if safely testable | No internal details leaked | Not run | Not run | Not captured | Not run | Must be captured only if safe. |
| Frontend truth guard | Query/client review or UI artifact if present | Frontend does not infer pricing truth from symbols/external APIs | Not run | Not run | Not captured | Not run | Must be captured in real environment or code review. |

### G5 result

| Field | Value |
| --- | --- |
| G5 status | Not run |
| Completion claim allowed? | No |
| Required follow-up PRs | Evidence-run PR after real environment run, or bugfix PR if evidence exposes a defect. |
| Blocking issue links | None recorded in this scaffold. |
| Summary | G5 evidence has not been captured. Backend platform readiness cannot mark G5 complete from this document. |

## Next required action

Run the G4/G5 evidence capture in a named local, staging, protected deployment, or production-like environment using `docs/g4-g5-backend-evidence-template.md`.

After the real run:

1. record environment metadata, commit SHA, operator, wallet/chain scope, timestamps, and redacted artifacts;
2. update this document or create a new dated run record;
3. update `docs/backend-platform-readiness.md` only if the evidence supports a status change;
4. if the run exposes a bug, stop completion-claim work and open a separate focused bugfix PR.

## Final guardrail

This document is not evidence of G4/G5 completion. It is a run-record scaffold to prevent accidental readiness claims without real backend observations.
