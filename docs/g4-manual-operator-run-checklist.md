# G4 Manual Operator-Run Checklist (Evidence Collection)

## 1) Scope

This checklist is for a **future manual operator-run evidence collection step** to validate G4 readiness using production-like conditions.

This PR/document explicitly does **not** do any of the following:

- execute sync
- execute rebuild
- require live RPC access
- require live database access
- change runtime behavior
- close G4 by itself

## 2) G4 Evidence Target

G4 requires evidence that a complete **wallet import -> sync -> materialize -> rebuild validation cycle** can be exercised in production-like conditions **without** structural rework to:

- query behavior
- mutation behavior
- invalidation behavior
- route contracts
- DTO shapes/contracts

## 3) Prerequisites Before Running the Checklist

Before executing the future manual run, confirm all prerequisites:

- known tracked wallet exists or a wallet to import is identified for test scope
- `DATABASE_URL` is configured
- `PULSECHAIN_RPC_URL` is configured
- `REDIS_URL` is configured if required by deployment/runtime mode
- environment is local/deployed but production-like in behavior
- operator access exists for `/api/debug/status`, `/api/debug/health`, `/debug/sync` UI page (if used), and equivalent sync/rebuild API routes
- operator access exists for wallet import/tracked-wallet routes (for example `POST /api/wallets/import` and `GET /api/wallets/tracked`)
- no unrelated PR validation is being performed concurrently in the same environment
- target is current `main` or a clearly identified commit SHA
- backup/rollback awareness exists when operating outside local-only environments

## 4) Evidence to Record

Record each line item during the future manual operator run.

Supported evidence sequence for full-cycle validation:

1. wallet import / tracked-wallet confirmation,
2. manual sync,
3. `/api/debug/status` evidence for ingestion/sync state,
4. rebuild request,
5. rebuild/materialization evidence from rebuild response and/or `/api/debug/status`,
6. optional dashboard observation as artifact only (not source of truth).

| Item | Command / page / API route used | Expected result | Actual result | Timestamp (UTC) | Commit SHA / environment | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|
| Wallet import submitted | `POST /api/wallets/import` or equivalent UI path | Import request accepted with expected envelope | | | | | |
| Wallet import result is success or documented idempotent existing-wallet behavior | `POST /api/wallets/import` response | Success OR documented idempotent existing-wallet envelope | | | | | |
| Tracked wallet appears after import | `GET /api/wallets/tracked` | Imported wallet appears for expected chain scope | | | | | |
| Manual sync submitted | Sync route/API used by operator (or `/debug/sync` UI artifact) | Sync request accepted with expected envelope | | | | | |
| Debug status reflects sync/ingestion state | `/api/debug/status` | Status payload reflects latest sync/ingestion progression | | | | | |
| Rebuild submitted | Rebuild route/API used by operator | Rebuild request accepted with expected envelope | | | | | |
| Rebuild/materialization evidence captured | Rebuild response and/or `/api/debug/status` | Materialization result/state is visible and attributable | | | | | |
| Materialization evidence tied to same wallet/chain/commit/environment | Rebuild + `/api/debug/status` + run metadata | Evidence correlation is explicit and consistent | | | | | |
| Conflict run attempted under safe realistic overlap conditions (required for full G4 pass) | Overlap test via sync/rebuild routes | Overlap attempt is executed safely and intentionally | | | | | |
| Conflicting operation returns structured safe conflict envelope | Sync/rebuild conflicting route response | Conflict is blocked with structured/operator-safe envelope | | | | | |
| No internal details leaked in conflict or failure envelopes | Conflict/failure response payloads | No internal exception internals leaked | | | | | |
| Operation-state/blocker summary reflects blocker (if available) | `/api/debug/status` and/or operation-state view | Blocker/lock state is reflected for operators | | | | | |
| Wallet import invalidation assumptions remain valid | Import flow + query inspection | `debug status` invalidated, `debug health` invalidated, chain-scoped tracked-wallet key invalidated, dashboard not broadly invalidated unless backend materialized dashboard truth is known refreshed | | | | | |
| Mutation invalidation assumptions remain valid (non-import flows) | Relevant mutation path + affected pages | No structural invalidation redesign required | | | | | |
| Dashboard query is not broadly invalidated unless materialized dashboard truth is known refreshed | Dashboard page/UI artifact + query observation | Existing non-broad invalidation policy remains correct | | | | | |
| No query-key changes required | Query key review (`src/lib/query/query-keys.ts`) | Existing keys are sufficient; no structural change required | | | | | |
| No mutation-hook changes required | Relevant frontend mutation hooks | Existing hooks remain structurally valid | | | | | |
| No route-contract changes required | Import/sync/rebuild/debug route responses | Route contracts remain valid | | | | | |
| No DTO shape changes required | DTO payload inspection | DTO shapes remain valid | | | | | |
| No frontend pricing/PnL/accounting computation introduced | Frontend behavior check | No frontend truth/accounting pricing logic introduced | | | | | |

> Full G4 closure is not allowed without import-flow evidence and conflict evidence. If import or conflict portions cannot be safely executed, mark G4 as partial (not complete).

## 5) Required Screenshots / Logs / Artifacts

Collect and attach (or link) the following evidence artifacts in the future evidence PR:

- relevant `/api/debug/status` response and/or screenshot
- relevant `/api/debug/health` response and/or screenshot (if available in environment)
- wallet import response/status artifact
- tracked-wallet listing artifact (`GET /api/wallets/tracked`)
- manual sync response/status artifact
- rebuild response/status artifact
- operation-state/blocker summary (if available)
- dashboard before/after UI artifacts (if dashboard participation is part of the run; UI artifact only)
- commit SHA and environment name
- UTC timestamps for each captured event
- safe redacted logs, where needed

**Security rule:** Do **not** paste secrets, private keys, database credentials, RPC tokens, or full sensitive environment variable values into this checklist or evidence PR.

## 6) Pass/Fail Criteria

### Pass criteria

- full-cycle evidence includes successful wallet import behavior (success or documented idempotent existing-wallet behavior)
- full-cycle evidence includes successful manual sync and successful rebuild/materialization evidence for the same run context
- `/api/debug/status` reflects operation state transitions accurately
- `/api/debug/health` and `/api/debug/status` invalidation assumptions remain valid for import flow
- conflict test is executed and passes by returning a structured safe conflict envelope
- no internal exception internals are leaked to user-facing envelopes
- no structural query/mutation/invalidation/DTO changes are required
- dashboard non-invalidation policy remains valid unless materialized dashboard truth is explicitly refreshed

### Fail/Partial criteria

- safe error envelopes prove error handling only and do **not** close full-cycle G4 readiness by themselves
- if sync or rebuild fails safely due to RPC/database/environment issues, mark the run partial/fail for G4 closure (not complete)
- if conflict behavior cannot be safely tested in realistic overlap conditions, mark G4 partial (not complete)
- unsafe error leakage (internal exception detail exposure)
- route shape drift from expected contracts
- dashboard auto-refresh/invalidation behavior mismatches expected policy
- query key or mutation invalidation requires structural rework
- DTO shape change is required to complete the cycle safely
- unresolved operational failure without safe envelope

## 7) How to Use This Checklist Later

A future **evidence PR** may populate this checklist with actual observed results from the operator run.

That future PR should remain **documentation-only** unless the run reveals a concrete bug.

If a real bug is exposed:

1. stop G4 completion claim work,
2. open a separate focused bugfix PR,
3. resolve and verify the bug,
4. then resume G4 evidence closure.

## 8) Template Readiness Implication

This checklist alone does **not** establish:

- internal template readiness
- external repository readiness
- reusable code extraction readiness

This checklist also does **not** create an internal template folder, an external repository, or reusable extraction artifacts.

G4 remains **partial** until actual successful production-like operator evidence is captured and recorded.

## 9) Recommended Next Blocker

Smallest safe next step:

- run this checklist in a production-like operator-capable environment and record evidence in a documentation-only PR

Alternative when live/operator access is not ready:

- draft the G8 AGENTS reusable-vs-CoinPulse separation note
