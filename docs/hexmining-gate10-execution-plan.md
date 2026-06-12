# HexMining Gate 10 Execution Plan

**Status:** Ready for execution. No live verification has been performed by this document.

**Gate 10 state:** OPEN — must pass this plan before any public estimated-yield promotion.

**Gate 11 state:** OPEN — depends on Gate 10 evidence passing and roadmap approval.

---

## Overview

Gate 10 is the live-data verification prerequisite for public estimated-yield release (§11.14 item 10 in `docs/v2-hexmining-roadmap.md`). It requires proving that:

1. A real observation with a complete canonical payload exists on PulseChain (chain ID 369) for a known historical day range.
2. The canonical payload decodes and reproduces yield correctly using the approved backend formula.
3. The estimator reaches `evidence_available` before any gate-lift promotion.
4. The verification harness (`src/services/hexmining/verification-harness.ts`) passes with no unexpected failure codes.
5. A sanitized evidence package is recorded and can be reviewed before Gate 11.

This plan uses the verification harness merged in PR #239. No new code is written during Gate 10 execution.

---

## Preconditions

All of the following must be confirmed before beginning Gate 10 verification.

### Required merged PRs

| PR | Title | Role |
|---|---|---|
| #238 | `docs(hexmining): add live-data verification plan and reference it in roadmap` | Establishes the verification policy this plan implements |
| #239 | `feat(hexmining): add verification harness` | Provides `verifyHexMiningYieldEvidence` used in Step 4 |
| #237 | Closure documentation | Closes DTO/route/reader contract coverage chain |
| #236 | Contract tests for estimated-yield DTO path | Full public estimated-yield route contract coverage |
| #235 | Route dependency wiring | `GET /api/hexmining/stakes` passes `estimateYield` |
| #234 | Reader assembly | Reader can carry injected estimate result through approved DTO path |
| #208–#233 | Phase 4C estimation and gating chain | Formula, BPD, provenance, contract, and evidence infrastructure |

Verify each PR is merged to `main` before proceeding. Run `git log --oneline origin/main` to confirm.

### Required roadmap state (§11.14 items 1–9)

Confirm all are marked `✅ RESOLVED` in `docs/v2-hexmining-roadmap.md`:

1. Elapsed-days-only coverage rule — PR #225
2. BPD attribution gate — PR #226; reader/route coverage closed by PRs #234–#236
3. §11.9 provenance fields — PR #227
4. `HexStakeDto.yield` field assembly — PR #234
5. Route dependency wiring — PR #235
6. Contract tests for public estimated-yield DTO path — PR #236
7. EES/penalty distribution — PR #224 Finding A
8. DTO contract approval — PR #232
9. Explicit contract tests — PR #236

**Do not begin execution if any item 1–9 is unresolved.**

### Required infrastructure

- A working PostgreSQL instance with the production or staging CoinPulse schema applied.
- A working PulseChain RPC endpoint authorized for use in this verification. Record only its sanitized `rpcEndpointLabel` — never commit private URLs.
- Access to run TypeScript server-side code against the database (e.g., a focused `tsx` script or a one-off Vitest test against a seeded fixture).
- Node.js environment with project dependencies installed (`npm install`, `npx prisma generate`).

### Required database state

At least one `HexMiningObservation` record must exist satisfying all of the following:

- `chainId: 369` (PulseChain).
- `isInvalidated: false`.
- `payloadSchemaValid: true`.
- A non-empty `canonicalPayload` containing a valid JSON structure with `schemaVersion: "v1"` and a `dailyData` array whose length equals `rangeEndDay - rangeStartDay + 1`.
- A known, non-negative `rangeStartDay` and `rangeEndDay` (`rangeStartDay ≥ 0`, `rangeEndDay ≥ rangeStartDay`).
- A corresponding stake record with a valid `stakeShares` value (`> 0n`).

If no such record exists, create one through the normal ingestion path (backend sync, not fabricated) before proceeding. Do not manually insert records or fabricate observation IDs, block numbers, day ranges, or canonical payloads.

---

## Pre-verification inputs

Collect all inputs before beginning the verification workflow. All inputs come from the database. None may be invented or backfilled.

### Required inputs

| Input | Source | Constraints |
|---|---|---|
| `observationId` | `HexMiningObservation.id` | UUID; must match a real, non-invalidated record |
| `rangeStartDay` | `HexMiningObservation.rangeStartDay` | Non-negative integer |
| `rangeEndDay` | `HexMiningObservation.rangeEndDay` | Non-negative integer; `≥ rangeStartDay` |
| `observedAtBlock` | `HexMiningObservation.observedAtBlock` | Non-negative integer string or bigint |
| `rpcEndpointLabel` | `HexMiningObservation.rpcEndpointLabel` | Sanitized label; never a private URL |
| `canonicalPayload` | `HexMiningObservation.canonicalPayload` | Valid JSON; `dailyData.length` must equal `rangeEndDay - rangeStartDay + 1` |
| `stakeShares` | Corresponding stake record | BigInt; `> 0n` |
| `warnings` | `HexMiningObservation.warnings` (if any) | String array; may be empty |
| `isInvalidated` | `HexMiningObservation.isInvalidated` | Must be `false`; if `true` disqualify this observation and select another |

### How to retrieve inputs

**Step A — Pre-select the target day range and fixture stake.**

Before querying, the operator must independently decide:
- The exact `rangeStartDay` and `rangeEndDay` for the known historical range being verified, as required by the live-data verification plan. Do not discover this from the database — choose it from the authorized fixture or opt-in stake documentation.
- The specific fixture or opt-in stake to use. Record the stake's identity (wallet address and on-chain stake index or stake ID) from the authorized source before querying. Do not select an arbitrary stake after the observation is found.

**Step B — Retrieve the observation for the pre-selected range.**

Query the database using the pre-selected day range values. Do not use `ORDER BY createdAt DESC LIMIT 1` — that would select an arbitrary observation unrelated to the authorized fixture range:

```sql
SELECT
  id,
  "chainId",
  "rangeStartDay",
  "rangeEndDay",
  "observedAtBlock",
  "rpcEndpointLabel",
  "payloadSchemaValid",
  "isInvalidated",
  "warnings",
  "canonicalPayload"
FROM "HexMiningObservation"
WHERE
  "chainId" = 369
  AND "rangeStartDay" = <pre-selected rangeStartDay>
  AND "rangeEndDay"   = <pre-selected rangeEndDay>
  AND "isInvalidated" = false
  AND "payloadSchemaValid" = true;
```

If the query returns no rows, the required observation does not yet exist. Do not proceed — run the backend ingestion path to create the observation for the pre-selected range, then re-query.

If the query returns more than one row, select the row whose `observedAtBlock` corresponds to the authorized ingestion run and record the reason for the selection in the evidence package.

**Step C — Retrieve `stakeShares` from the fixture stake.**

`HexMiningObservation` records are range-level daily-data evidence; they do not contain a stake identifier or `stakeShares`. The `stakeShares` value must come from the specific fixture or opt-in stake pre-selected in Step A.

Retrieve `stakeShares` using one of the following sources (in preference order):
1. A persisted native HEX stake record in the database for the authorized fixture stake (query by wallet address and on-chain stake index).
2. The on-chain `stakeLists` RPC data read and persisted by the backend ingestion path for the authorized fixture stake.

Do not read `stakeShares` from any source other than the authorized fixture or opt-in stake. Do not pair an arbitrary stake's shares with the observation payload.

Confirm that the `dailyData` array length in the `canonicalPayload` JSON equals `rangeEndDay - rangeStartDay + 1` before proceeding. If there is a mismatch, the harness will fail closed — select a different observation.

---

## Verification workflow

Execute all steps in order. Do not skip steps. Do not promote the public gate after any partial failure.

### Step 1 — Confirm preconditions

Verify all items in the Preconditions section above. Record the HEAD commit SHA of the `main` branch in use:

```bash
git rev-parse HEAD
```

This records which codebase was used for verification and is included in the evidence package.

### Step 2 — Extract and record inputs

Write down (sanitized) all nine inputs listed in the Pre-verification inputs table. Do not record:
- The raw RPC URL or any credentials.
- Private wallet ownership details or opt-in participant identities beyond the minimum fixture identifiers.
- Any secrets, environment variable values, or API tokens.

Use the `rpcEndpointLabel` field from the observation record as the reviewable provenance label.

### Step 3 — Confirm payload entry count

Count the entries in the `canonicalPayload.dailyData` array and confirm it equals `rangeEndDay - rangeStartDay + 1`.

Expected entry count: `rangeEndDay - rangeStartDay + 1`

If the count does not match, **stop**. Select a different observation. Do not continue with a mismatched payload — the harness will reject it, and the evidence is invalid for Gate 10.

### Step 4 — Run the verification harness

Invoke `verifyHexMiningYieldEvidence` from `src/services/hexmining/verification-harness.ts` with the extracted inputs. The function is server-side only (`import "server-only"`) and must be called from a server-side context.

Approach: write a short, focused invocation script (e.g., using `tsx`) or run it from a one-off focused test. The function signature is:

```typescript
import { verifyHexMiningYieldEvidence } from "@/services/hexmining/verification-harness";

const result = await verifyHexMiningYieldEvidence({
  observationId:    "<uuid from observation record>",
  rangeStartDay:    <rangeStartDay from observation record>,
  rangeEndDay:      <rangeEndDay from observation record>,
  observedAtBlock:  "<observedAtBlock from observation record>",
  canonicalPayload: "<canonicalPayload JSON string from observation record>",
  stakeShares:      <stakeShares bigint from stake record>,
  rpcEndpointLabel: "<rpcEndpointLabel from observation record>",
  warnings:         [/* upstream warnings from observation record, if any */],
  isInvalidated:    false,
});
```

Do not pass `deps.estimatorCalculation` during Gate 10 execution. The normal path must run with the real production estimator. The injectable override exists for test-only mismatch detection only.

Record the full return value of `result` as part of the evidence package (sanitized — see below).

### Step 5 — Evaluate the harness result

The result must satisfy all success criteria (see below). Check each field:

| Field | Expected value | Action if unexpected |
|---|---|---|
| `result.passed` | `true` | STOP — record failure code and reason; do not proceed to Gate 11 |
| `result.failureCode` | `null` | STOP — record and investigate |
| `result.estimatorStatus` | `"evidence_available"` | STOP — estimator must reach this state before any gate lift |
| `result.formula.entryCount` | `= rangeEndDay - rangeStartDay + 1` | STOP — payload coverage failure |
| `result.formula.expectedEntryCount` | Same as `entryCount` | Must match |
| `result.formula.reproducedYieldHex` | Non-null string | STOP — formula reproduction failed |
| `result.formula.estimatorInternalYieldHex` | `null` (normal path) | Must be null; non-null means test-only override was used |
| `result.provenance.chainId` | `369` | Must be 369 |
| `result.provenance.observationId` | Matches input `observationId` | Must match |
| `result.provenance.rangeStartDay` | Matches input `rangeStartDay` | Must match |
| `result.provenance.rangeEndDay` | Matches input `rangeEndDay` | Must match |
| `result.warnings` | Any array | Review and record; expected upstream warnings and BPD warnings are acceptable |

**Note on provenance scope:** `result.provenance` is constructed by the harness directly from the input object (`makeProvenance(input)`). It is a sanitized echo of the inputs collected in Step 2 — it does not expose the estimator's own internal provenance. The estimator's own provenance path (populated from the `evidence` record returned by `fetchEvidence`) is exercised by its internal evidence-provider traversal; its correctness is covered by the existing route/reader contract tests in PRs #234–#236. The key evidence that the estimator traversed its own evidence-provider path successfully during Gate 10 is `result.estimatorStatus === "evidence_available"`, which the estimator can only return after fetching evidence, validating it through its own internal checks, and running the calculation — meaning the estimator's own internal provenance-construction path was exercised. If the operator's invocation script has access to the raw `estimatorResult` (before the harness wraps it), record `estimatorResult.provenance` separately in the evidence package as additional confirmation.

### Step 6 — Review warnings

For each entry in `result.warnings`:

- `"hexmining-yield-bpd-attribution-unresolved"` — acceptable if the day range includes protocol day 353 (BPD). Not a blocker for Gate 10; is a known gated state that Gate 11 must address if BPD attribution is required for the specific stake.
- Any `"hexmining-rpc-*"` warning — review upstream RPC health. Not automatically a blocker if the observation itself is complete and valid.
- Any `"hexmining-verification-*"` warning — investigate. A verification warning alongside `passed: true` is unusual and must be explained in the evidence package.
- Any unexpected warning — explain in the evidence package.

An empty `result.warnings` is acceptable and expected for most historical ranges that do not span BPD day 353.

### Step 7 — Record evidence package

Write the sanitized evidence package (see Evidence package requirements below) and commit it to the gate-lift PR as the required Gate 10 record. Do not commit the evidence package to a standalone docs PR — it belongs in the gate-lift PR that also promotes the production estimator.

---

## Evidence package requirements

The evidence package must be a written record in the gate-lift PR body or a committed document, containing all of the following.

### Required records

**Commands run:**
- Exact commands or script invocations used to run the harness.
- The `git rev-parse HEAD` output confirming the codebase revision.
- Database query used to retrieve the observation (sanitized — no credentials).

**Sanitized result summary:**
- Whether `result.passed` was `true` or `false`.
- `result.failureCode` (null if passed).
- `result.estimatorStatus`.
- `result.formula.entryCount` and `result.formula.expectedEntryCount`.
- `result.formula.reproducedYieldHex` — include as a reviewable value. This is a deterministic bigint computation from the canonical payload and `stakeShares`; it is not secret.
- `result.formula.estimatorInternalYieldHex` — must be null (confirming the normal production estimator path ran without test-only override).

**Provenance record:**
- `chainId: 369`
- `observationId`
- `rangeStartDay`
- `rangeEndDay`
- `observedAtBlock`
- `rpcEndpointLabel` (sanitized label only)
- `sourceFamily: "HEXMINING"`

**Warning record:**
- Full `result.warnings` array.
- Explanation of any unexpected warning.

**Pass/fail decision:**
- Explicit statement: "Gate 10 PASSED" or "Gate 10 FAILED — [reason]".

### What NOT to record (sanitization rules)

- No raw RPC URLs or provider credentials.
- No secrets, API keys, tokens, cookies, or environment variable values.
- No private wallet ownership details or opt-in participant identities beyond the minimum fixture identifiers.
- No `canonicalPayload` string — it is internal evidence only and must not appear in PR bodies, review comments, or committed documentation.

---

## Success criteria

Gate 10 passes only when **all** of the following are true:

1. `result.passed === true`
2. `result.failureCode === null`
3. `result.estimatorStatus === "evidence_available"` — the estimator must reach this state before the gate-lift PR promotes it to `"estimated"`
4. `result.formula.entryCount === result.formula.expectedEntryCount` — payload covers the full declared range
5. `result.formula.reproducedYieldHex` is a non-null decimal string — formula reproduction succeeded. Note: "Hex" in this field name refers to the HEX token (hearts unit), not hexadecimal encoding; the value is a bigint base-10 decimal string (e.g., `"500"`).
6. `result.formula.estimatorInternalYieldHex === null` — confirms the normal production estimator path ran without test-only substitution
7. `result.provenance.chainId === 369`
8. All provenance fields match the inputs collected in Step 2
9. All warnings are explained and none are unexpected failures

---

## Failure criteria

Gate 10 fails if **any** of the following occur:

| Condition | Failure code (if applicable) | Required action |
|---|---|---|
| `result.passed === false` | Any | Stop; investigate `failureCode`; do not gate-lift |
| `result.failureCode` is not null | Any | Stop; document and investigate |
| `result.estimatorStatus !== "evidence_available"` | `hexmining-verification-estimator-not-evidence-available` | Stop; estimator path has not reached required state |
| Entry count mismatch | `hexmining-verification-payload-range-mismatch` | Stop; select a different observation with a complete payload |
| Negative or invalid day range | `hexmining-verification-invalid-range` | Stop; disqualify this observation |
| Payload decode failure | `hexmining-verification-invalid-payload` or `hexmining-verification-packed-decode-failed` | Stop; observation payload is corrupt or schema-invalid |
| Observation invalidated | `hexmining-verification-observation-invalidated` | Stop; select a non-invalidated observation |
| `result.formula.estimatorInternalYieldHex !== null` | — | Stop; the test-only override dep was passed; rerun without `deps.estimatorCalculation` |
| Any required input was fabricated or backfilled | — | Stop; verification is invalid; do not gate-lift |

A failed Gate 10 must be documented. Do not proceed to Gate 11 until Gate 10 passes with a fresh, valid observation.

---

## Gate-lift requirements for Gate 11

Gate 11 is the final production promotion PR (§11.14 item 11). It may only be opened after Gate 10 passes.

### Gate 11 prerequisites

1. Gate 10 passed — `result.passed === true` with a recorded sanitized evidence package.
2. Evidence package committed in the gate-lift PR body or a companion docs record.
3. `docs/v2-hexmining-roadmap.md` updated to mark Gate 10 (`§11.14 item 10`) as `✅ RESOLVED` with the gate-lift PR reference.
4. The final production promotion in `src/services/hexmining/yield-estimator.ts`: change the gated `evidence_available` return to surface `"estimated"` with non-null `yieldHex` for valid evidence paths.
5. The approved §11.16 `HexStakeYieldDto` contract shape is preserved — `evidence_available` maps to `"unavailable"` in the reader until the production promotion; after promotion, it maps to `"estimated"`.
6. `valuation.status` and `pnl.status` remain `"unsupported"` — these are unchanged by the gate lift.
7. No `canonicalPayload` appears in any DTO or API response.
8. No frontend calculation of yield, PnL, or valuation is introduced.
9. After gate lift: `docs/v2-hexmining-roadmap.md` item 11 marked `✅ RESOLVED` with the gate-lift PR reference.

### What Gate 11 must NOT do

- Must not fabricate any yield, observation, payload, or provenance.
- Must not expose `canonicalPayload` in any DTO or API response.
- Must not change `valuation.status` or `pnl.status`.
- Must not introduce frontend yield calculations.
- Must not skip the evidence package or reference a failed Gate 10 run.
- Must not partially gate-lift (e.g., surfacing `yieldHex` without provenance or warnings).

---

## After verification

If Gate 10 passes:

1. Do not immediately promote the production gate in a standalone docs PR. The production promotion belongs in the gate-lift implementation PR (Gate 11).
2. Include the evidence package in the gate-lift PR body.
3. Update `docs/v2-hexmining-roadmap.md` in the gate-lift PR to mark item 10 `✅ RESOLVED` and item 11 `✅ RESOLVED` once the gate-lift PR is approved and merged.
4. Keep Gate 10 and Gate 11 marked OPEN in all docs PRs that are not the gate-lift implementation PR itself.

If Gate 10 fails:

1. Document the failure in the gate-lift PR or a standalone investigation record.
2. Resolve the underlying cause (invalid observation, incomplete payload, RPC issue).
3. Re-run the verification from Step 1 with a valid observation.
4. Do not open a Gate 11 PR until Gate 10 has passed.
