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

G4 requires evidence that a complete **sync -> materialize -> rebuild** cycle can be exercised in production-like conditions **without** structural rework to:

- query behavior
- mutation behavior
- invalidation behavior
- route contracts
- DTO shapes/contracts

## 3) Prerequisites Before Running the Checklist

Before executing the future manual run, confirm all prerequisites:

- known tracked wallet exists and is available for test scope
- `DATABASE_URL` is configured
- `PULSECHAIN_RPC_URL` is configured
- `REDIS_URL` is configured if required by deployment/runtime mode
- environment is local/deployed but production-like in behavior
- operator access exists for `/debug/sync` and `/debug/status` (or equivalent API routes)
- no unrelated PR validation is being performed concurrently in the same environment
- target is current `main` or a clearly identified commit SHA
- backup/rollback awareness exists when operating outside local-only environments

## 4) Evidence to Record

Record each line item during the future manual operator run.

| Item | Command / page / API route used | Expected result | Actual result | Timestamp (UTC) | Commit SHA / environment | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|
| Tracked wallet exists | | Wallet is present and recognized by backend truth pipeline | | | | | |
| Manual sync submitted | | Sync request accepted with expected envelope | | | | | |
| Manual sync completes or fails safely | | Completion success OR structured safe failure envelope | | | | | |
| Debug status reflects sync/ingestion/materialization state | `/debug/status` | Status payload reflects latest sync/ingestion/materialization progression | | | | | |
| Rebuild submitted | | Rebuild request accepted with expected envelope | | | | | |
| Rebuild completes or fails safely | | Completion success OR structured safe failure envelope | | | | | |
| Debug status reflects rebuild/materialization state | `/debug/status` | Status payload reflects rebuild/materialization completion or safe failure state | | | | | |
| Operation lock prevents conflicting operation (if overlap tested) | `/debug/sync`, rebuild route, or equivalent | Conflicting operation blocked by lock with safe response | | | | | |
| Safe conflict envelope observed (if applicable) | | Conflict response is structured/operator-safe | | | | | |
| Mutation invalidation assumptions remain valid | Relevant mutation path + affected pages | No structural invalidation redesign required | | | | | |
| Dashboard query is not broadly invalidated unless materialized dashboard truth is known refreshed | Dashboard + query observation | Existing non-broad invalidation policy remains correct | | | | | |
| No query-key changes required | Query key review (`src/lib/query/query-keys.ts`) | Existing keys are sufficient; no structural change required | | | | | |
| No mutation-hook changes required | Relevant frontend mutation hooks | Existing hooks remain structurally valid | | | | | |
| No route-contract changes required | Sync/rebuild/debug route responses | Route contracts remain valid | | | | | |
| No DTO shape changes required | DTO payload inspection | DTO shapes remain valid | | | | | |
| No frontend pricing/PnL/accounting computation introduced | Frontend behavior check | No frontend truth/accounting pricing logic introduced | | | | | |

## 5) Required Screenshots / Logs / Artifacts

Collect and attach (or link) the following evidence artifacts in the future evidence PR:

- relevant `/debug/status` response and/or screenshot
- relevant `/debug/health` response and/or screenshot (if available in environment)
- manual sync response/status artifact
- rebuild response/status artifact
- operation-state/blocker summary (if available)
- dashboard before/after state artifacts (if dashboard participation is part of the run)
- commit SHA and environment name
- UTC timestamps for each captured event
- safe redacted logs, where needed

**Security rule:** Do **not** paste secrets, private keys, database credentials, RPC tokens, or full sensitive environment variable values into this checklist or evidence PR.

## 6) Pass/Fail Criteria

### Pass criteria

- sync/rebuild routes return expected success envelopes or safe/structured error envelopes
- `/debug/status` reflects operation state transitions accurately
- conflicts (if tested) are safe, structured, and operator-readable
- no internal exception internals are leaked to user-facing envelopes
- no structural query/mutation/invalidation/DTO changes are required
- dashboard non-invalidation policy remains valid unless materialized dashboard truth is explicitly refreshed

### Fail criteria

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

G4 remains **partial** until actual operator-run evidence is captured and recorded.

## 9) Recommended Next Blocker

Smallest safe next step:

- run this checklist in a production-like operator-capable environment and record evidence in a documentation-only PR

Alternative when live/operator access is not ready:

- draft the G8 AGENTS reusable-vs-CoinPulse separation note
