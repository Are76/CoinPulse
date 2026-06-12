# HexMining Gate 10 Operator Runbook

**Status:** Gate 10 OPEN — Gate 11 OPEN — public estimated yield GATED

**Purpose:** Step-by-step checklist for the operator executing Gate 10 verification. Follow each section in order. Do not skip sections. Do not proceed to Gate 11 until all sections pass.

**Companion documents (read before starting):**

- `docs/hexmining-gate10-execution-plan.md` — full procedure and preconditions
- `docs/hexmining-gate10-evidence-template.md` — evidence package to fill in during execution
- `docs/hexmining-live-data-verification-plan.md` — required evidence scope
- `docs/v2-hexmining-roadmap.md` §11.14 — gate-lift prerequisites

**Important:** All commands below are examples or placeholders. Do not substitute real observation IDs, block numbers, RPC URLs, or yield values here. Fill those in on the evidence template only, during actual execution.

---

## Section 1 — Environment Preparation

Complete all items before touching any data or running the harness.

### 1.1 Repository sync

```bash
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

- [ ] On `main` branch
- [ ] Working tree is clean (`git status --short` shows no output)
- [ ] HEAD matches the known-good commit SHA recorded in the evidence template

### 1.2 Dependency installation

```bash
npm install
```

- [ ] `node_modules` are present and up to date
- [ ] `npm install` exited cleanly (no unresolved peer dependency errors)

### 1.3 Prisma client generation

```bash
npx prisma generate
```

- [ ] Prisma client generated successfully
- [ ] No errors from `prisma generate`

### 1.4 Node.js version check

```bash
node --version
```

- [ ] Version matches the project's expected runtime (record the exact string in the evidence template)

### 1.5 Verify harness module is present

```bash
ls src/services/hexmining/verification-harness.ts
```

- [ ] File exists
- [ ] PR #239 is confirmed merged (harness is on `main`)

### 1.6 Database connectivity

- [ ] Database is accessible (staging or production — record the environment, not the connection string)
- [ ] `RawHexDailyDataObservation` table is populated with at least one record for chain ID 369

**Environment preparation complete:** `YES / NO`

---

## Section 2 — Observation Selection Checklist

Select the observation **before** querying. Do not use `ORDER BY createdAt DESC LIMIT 1` or any arbitrary sort. Pre-specify the `rangeStartDay` and `rangeEndDay` for the historical range you intend to verify.

### 2.1 Pre-select the day range

Decide the day range before opening the database:

- [ ] `rangeStartDay` selected: `<non-negative integer>`
- [ ] `rangeEndDay` selected: `<non-negative integer ≥ rangeStartDay>`
- [ ] Expected entry count calculated: `rangeEndDay − rangeStartDay + 1 = <integer>`

Record the rationale for this day range (e.g., "covers a known historical period; rangeStartDay ≤ 353 ≤ rangeEndDay to include BPD day"):

> `<rationale>`

### 2.2 Query the observation

Run a sanitized query against the database. Example form (replace `<n>` with actual values):

```sql
SELECT id, "rangeStartDay", "rangeEndDay", "observedAtBlock", "rpcEndpointLabel", "payloadVersion",
       warnings
FROM "RawHexDailyDataObservation"
WHERE "chainId" = 369
  AND "rangeStartDay" = <n>
  AND "rangeEndDay" = <n>
ORDER BY "observedAtBlock" DESC
LIMIT 1;
```

> Retrieve the full `warnings` array (not just the count). The observation's upstream warning strings must be passed to the harness as `input.warnings` and copied verbatim into the evidence template Section 6 warning record. Note: `canonicalPayload` is also retrieved from the same row and passed to the harness internally — see Section 4.

- [ ] Query executed successfully
- [ ] One row returned
- [ ] `rangeStartDay` matches pre-selected value
- [ ] `rangeEndDay` matches pre-selected value

### 2.3 Record observation fields

From the returned row, record these values for the evidence template:

| Field | Value |
|---|---|
| `id` (observationId) | `<cuid>` |
| `rangeStartDay` | `<integer>` |
| `rangeEndDay` | `<integer>` |
| `observedAtBlock` | `<integer string>` |
| `rpcEndpointLabel` | `<sanitized label>` |
| `payloadVersion` | `<version string>` |

- [ ] All six fields recorded
- [ ] `observedAtBlock` is a non-negative integer (no negative values)
- [ ] `rpcEndpointLabel` is a sanitized label (no raw URL)

### 2.4 Check for invalidation records

```sql
SELECT COUNT(*) AS invalidation_count
FROM "RawHexDailyDataObservationInvalidation"
WHERE "observationId" = '<id from 2.3>';
```

- [ ] Query executed successfully
- [ ] `invalidation_count = 0`

**If `invalidation_count > 0`: STOP. Select a different observation with no invalidation records. Do not proceed with an invalidated observation.**

### 2.5 Verify entry count

From the observation's `canonicalPayload`, the decoded `dailyData` array must have exactly `rangeEndDay − rangeStartDay + 1` entries. The harness performs this check — record the expected count here for comparison:

- [ ] Expected entry count: `<rangeEndDay − rangeStartDay + 1>`
- [ ] Entry count will be verified by harness (Section 5)

**Observation selection complete:** `YES / NO`

---

## Section 3 — Stake Selection Checklist

The stake is selected independently of the observation. Use an authorized fixture or opt-in stake record. Do not derive stake data from the observation payload.

### 3.1 Identify the fixture stake

- [ ] Authorized fixture stake or opt-in stake is identified
- [ ] Stake identifier recorded (wallet address + on-chain stake index, or authorized stake ID — minimum identifiers only)

Fixture stake identifier: `<wallet address and stake index, or authorized stake ID>`

### 3.2 Retrieve stakeShares

Retrieve `stakeShares` from the persisted stake record or ingested `stakeLists` RPC data — not from the observation payload:

```sql
-- Example: retrieve from persisted stake record (replace with actual query)
SELECT "stakeShares"
FROM "<StakeTable>"
WHERE "walletAddress" = '<address>'
  AND "stakeIndex" = <n>
  AND "chainId" = 369;
```

- [ ] `stakeShares` retrieved from authorized source
- [ ] `stakeShares` is a non-negative decimal string (no leading zeros, no negative values)
- [ ] Source confirmed: `<persisted stake record / ingested stakeLists RPC data>`

Record:

| Field | Value |
|---|---|
| `stakeShares` (bigint decimal string) | `<decimal string>` |
| Source | `<persisted stake record / ingested stakeLists RPC data>` |

### 3.3 Confirm stake is not derived from observation

- [ ] `stakeShares` was NOT read from `canonicalPayload` or any observation field
- [ ] The source of `stakeShares` was independent of the observation record (persisted stake record or ingested `stakeLists` RPC data only)

**Stake selection complete:** `YES / NO`

---

## Section 4 — Data Collection Checklist

Before running the harness, confirm all required inputs are collected and none are fabricated.

| Input | Collected | Source |
|---|---|---|
| `observationId` | `YES / NO` | `RawHexDailyDataObservation.id` |
| `chainId` | `YES / NO` | Always `369` |
| `rangeStartDay` | `YES / NO` | `RawHexDailyDataObservation.rangeStartDay` |
| `rangeEndDay` | `YES / NO` | `RawHexDailyDataObservation.rangeEndDay` |
| `observedAtBlock` | `YES / NO` | `RawHexDailyDataObservation.observedAtBlock` |
| `rpcEndpointLabel` | `YES / NO` | `RawHexDailyDataObservation.rpcEndpointLabel` |
| `canonicalPayload` | `YES / NO` | `RawHexDailyDataObservation.canonicalPayload` — internal only; passed to harness; do NOT record in evidence output |
| `warnings` (observation warnings) | `YES / NO` | `RawHexDailyDataObservation.warnings` — upstream warning strings; pass to harness as `input.warnings`; copy verbatim into evidence template |
| `stakeShares` | `YES / NO` | Fixture stake record (Section 3) |
| Invalidation check | `YES / NO` | Section 2.4 (count = 0) |

- [ ] All inputs collected
- [ ] No input is fabricated, backfilled, or invented
- [ ] No live RPC call was made from documentation or a frontend context
- [ ] `DATABASE_URL` or equivalent connection string is available in the execution environment (not recorded here)

**Data collection complete:** `YES / NO`

---

## Section 5 — Harness Execution Checklist

### 5.1 Write or locate the execution script

The harness exports `verifyHexMiningYieldEvidence` from `src/services/hexmining/verification-harness.ts`. You need a small script or CLI invocation that:

1. Reads `DATABASE_URL` from the environment
2. Instantiates the Prisma client
3. Fetches `canonicalPayload` and `warnings` from `RawHexDailyDataObservation` (same row as Section 2) — these are required harness inputs but must NOT appear in the evidence output
4. Calls `verifyHexMiningYieldEvidence` with all inputs from Section 4, including `canonicalPayload`
5. Prints the result as JSON

Example invocation form (note: `canonicalPayload` is retrieved internally by the script — it does not appear in CLI output or evidence records):

```bash
DATABASE_URL='<redacted>' npx tsx <path-to-your-script> \
  --observationId <id> \
  --rangeStartDay <n> \
  --rangeEndDay <n> \
  --observedAtBlock <block> \
  --rpcEndpointLabel <label> \
  --stakeShares <decimal>
# canonicalPayload and warnings are read from the DB by the script; not shown in command line
```

- [ ] Script or invocation prepared
- [ ] `DATABASE_URL` is set in the execution environment (not logged or recorded)
- [ ] No `deps.estimatorCalculation` override is used (this override is test-only)

### 5.2 Execute the harness

Run the script. Capture the full JSON output.

- [ ] Harness executed without a thrown exception or unhandled error
- [ ] Raw JSON result captured

### 5.3 Verify no test-only override was used

- [ ] `deps.estimatorCalculation` was NOT passed
- [ ] `result.formula.estimatorInternalYieldHex` is `null` in the output

**If `estimatorInternalYieldHex` is non-null: the test-only override was accidentally triggered. Rerun without the override.**

### 5.4 Capture sanitized result

Record the sanitized JSON result in the evidence template (Section 4c of the template). Remove any sensitive content before recording:

- [ ] `canonicalPayload` does NOT appear anywhere in the recorded result
- [ ] RPC URLs do NOT appear in the recorded result
- [ ] Secrets, API keys, or tokens do NOT appear in the recorded result

### 5.5 Check top-level result fields

| Field | Actual value | Expected |
|---|---|---|
| `result.passed` | `<true / false>` | `true` |
| `result.failureCode` | `<null or string>` | `null` |
| `result.estimatorStatus` | `<string>` | `"evidence_available"` |
| `result.formula.estimatorInternalYieldHex` | `<null>` | `null` |

- [ ] All four fields match expected values

**If any field does not match expected: proceed to Section 7 (Failure Handling).**

**Harness execution complete:** `YES / NO`

---

## Section 6 — Evidence Template Completion Checklist

Open `docs/hexmining-gate10-evidence-template.md`. Fill in every placeholder. Do not leave any section blank. Do not submit the blank template as evidence.

### 6.1 Section 1 — Verification Metadata

- [ ] Verification date filled in (`YYYY-MM-DD`)
- [ ] Operator handle or role filled in (no private identity required)
- [ ] HEAD SHA filled in (`git rev-parse HEAD` on `main`)
- [ ] Node.js version filled in
- [ ] Database environment filled in (`staging` or `production` — no connection string)
- [ ] Harness module confirmed: `src/services/hexmining/verification-harness.ts`
- [ ] Harness function confirmed: `verifyHexMiningYieldEvidence`

### 6.2 Section 2 — Observation Metadata

- [ ] `observationId` filled in
- [ ] `chainId` = `369`
- [ ] `sourceFamily` = `HEXMINING`
- [ ] `rangeStartDay` filled in
- [ ] `rangeEndDay` filled in
- [ ] `observedAtBlock` filled in
- [ ] `rpcEndpointLabel` filled in (sanitized label, not raw URL)
- [ ] `payloadVersion` filled in
- [ ] `dailyData entry count` filled in
- [ ] `expected entry count` filled in
- [ ] Entry count matches expected: `YES`
- [ ] Invalidation records exist: `NO`

### 6.3 Section 3 — Stake Metadata

- [ ] Fixture stake identifier filled in (minimum identifiers only)
- [ ] `stakeShares` filled in (bigint decimal string, no leading zeros)
- [ ] Source of `stakeShares` filled in

### 6.4 Section 4 — Harness Execution Record

- [ ] **4a:** Sanitized observation retrieval query filled in (no connection string)
- [ ] **4b:** Exact harness command filled in (DATABASE_URL redacted to `'...'`)
- [ ] **4b:** "No `deps.estimatorCalculation` override was passed" marked `YES`
- [ ] **4c:** Raw harness result filled in (sanitized; no `canonicalPayload`)
- [ ] **4c:** `warnings` array filled in verbatim (all warning strings copied; `[]` only if truly empty)
- [ ] **4d:** All summary fields filled in

### 6.5 Section 5 — Provenance Record

- [ ] All provenance fields filled in from `result.provenance`
- [ ] All provenance fields match Section 2 values

### 6.6 Section 6 — Warning Record

- [ ] Warning table filled in (one row per warning; write "none" if no warnings)
- [ ] Each warning explained and dispositioned
- [ ] Any unexpected warnings explained in the "Additional explanation" field

### 6.7 Section 7 — Success Criteria Checklist

- [ ] All nine criteria checked `YES`
- [ ] **Gate 10 result** marked `PASSED`

**If any criterion is `NO`: Gate 10 fails. Do not proceed to Section 9 or Gate 11.**

### 6.8 Section 8 — Failure Criteria Checklist

- [ ] All failure conditions confirmed `NO`
- [ ] Failure explanation left blank (or filled in with explanation if any condition applied)

### 6.9 Sanitization confirmation

- [ ] No raw RPC URLs in the document
- [ ] No secrets, API keys, tokens, cookies, or environment variable values in the document
- [ ] No private wallet ownership details beyond minimum authorized identifiers
- [ ] No `canonicalPayload` JSON string in the document
- [ ] Sanitization confirmed: `YES`

**Evidence template complete:** `YES / NO`

---

## Section 7 — Failure Handling Decision Tree

Use this tree when `result.passed === false` or any success criterion fails.

```
result.passed === false?
├── YES → check result.failureCode
│   ├── hexmining-verification-invalid-range
│   │   └── rangeStartDay or rangeEndDay is negative or rangeEndDay < rangeStartDay
│   │       Action: select a valid day range; rerun from Section 2
│   ├── hexmining-verification-invalid-payload
│   │   └── canonicalPayload failed to decode
│   │       Action: select a different observation; rerun from Section 2
│   ├── hexmining-verification-packed-decode-failed
│   │   └── packed-array decode failed inside the payload
│   │       Action: select a different observation or escalate (Section 8)
│   ├── hexmining-verification-payload-range-mismatch
│   │   └── dailyData entry count ≠ rangeEndDay − rangeStartDay + 1
│   │       Action: select an observation whose payload covers the full range; rerun
│   ├── hexmining-verification-observation-invalidated
│   │   └── invalidation record found for this observation
│   │       Action: query a different observation; repeat Section 2.4
│   ├── hexmining-verification-estimator-not-evidence-available
│   │   └── estimatorStatus ≠ "evidence_available"
│   │       Action: investigate estimator path; escalate if estimatorStatus is unexpected
│   └── any other failureCode or null with passed=false
│       Action: escalate to Section 8
│
result.formula.estimatorInternalYieldHex !== null?
├── YES → test-only override was triggered
│   Action: rerun without deps.estimatorCalculation; Gate 10 evidence from this run is invalid
│
result.passed === true AND estimatorStatus ≠ "evidence_available"?
├── YES → estimator returned unexpected status despite passing
│   Action: escalate to Section 8; do not proceed to Gate 11
│
All nine success criteria checked YES?
├── YES → Gate 10 passes; proceed to Section 9
└── NO  → Gate 10 fails; do not proceed to Gate 11
```

**Failure handling notes:**

> `<record any failure encountered, the failure code, and the corrective action taken>`

---

## Section 8 — Escalation Paths

Use when a failure cannot be resolved by re-selecting an observation or stake, or when the failure code is unexpected.

| Situation | Escalation action |
|---|---|
| No valid observation exists for the desired day range | Ingest a new observation via the backend ingestion pipeline before retrying Gate 10 |
| Harness throws an unhandled exception | Report the full stack trace and harness input to the engineering team; do not proceed |
| `estimatorStatus` is not `"evidence_available"` despite `passed: true` | Report to the engineering team with the full sanitized result |
| `reproducedYieldHex` is null when `passed: true` | Report to the engineering team; this should not be reachable |
| Any finding suggests the formula is producing incorrect results | Stop Gate 10; do not proceed; report the discrepancy with full sanitized evidence |
| Sanitization cannot be confirmed | Do not submit evidence; resolve the sanitization issue first |

**Escalation contact / tracking:**

> `<fill in the team contact, issue tracker link, or on-call path before executing Gate 10>`

---

## Section 9 — Gate 11 Readiness Decision Tree

Complete only after Gate 10 passes (Section 7 result = PASSED and all success criteria confirmed YES).

Work through each prerequisite from `docs/v2-hexmining-roadmap.md` §11.14:

```
§11.14 items 1–9 all resolved? (confirmed by PRs #225–#237)
├── YES → continue
└── NO  → do not open gate-lift PR; resolve missing prerequisites first

Gate 10 passed? (Section 7 result = PASSED)
├── YES → continue
└── NO  → do not open gate-lift PR

Evidence package complete and ready to submit?
(filled-in evidence template, not the blank template)
├── YES → continue
└── NO  → complete the evidence template (Section 6) first

Evidence package sanitized?
(no raw URLs, no secrets, no canonicalPayload, no private wallet details)
├── YES → continue
└── NO  → sanitize before submitting

Gate-lift PR scope confirmed narrow?
(promotes evidence_available → "estimated" in yield-estimator.ts only;
 valuation.status and pnl.status remain "unsupported";
 no canonicalPayload in any DTO or API response;
 no frontend yield, PnL, or valuation calculation introduced;
 approved §11.16 HexStakeYieldDto contract shape preserved)
├── YES → continue
└── NO  → narrow the PR scope before opening

docs/v2-hexmining-roadmap.md §11.14 item 10 marked ✅ RESOLVED in the gate-lift PR?
├── YES → continue
└── NO  → update the roadmap in the gate-lift PR

All checks pass:
└── Gate 11 APPROVED TO OPEN GATE-LIFT PR
```

**Gate 11 readiness: `APPROVED TO OPEN GATE-LIFT PR / NOT YET APPROVED`**

**Note:** Gate 10 and Gate 11 both remain OPEN until the above checks are satisfied. Public estimated yield remains gated until the gate-lift PR is merged and `docs/v2-hexmining-roadmap.md` item 11 is marked resolved.

---

## Section 10 — Final Sign-Off

Complete after all sections above are done and Gate 11 is approved.

| Field | Value |
|---|---|
| Operator | `<operator handle or role>` |
| Execution date | `YYYY-MM-DD` |
| Gate 10 result | `PASSED / FAILED` |
| Gate 11 approval | `APPROVED TO OPEN GATE-LIFT PR / NOT YET APPROVED` |
| Evidence package location | `<gate-lift PR body / committed companion document path>` |
| Evidence template commit or PR | `<SHA or PR link>` |
| Harness commit SHA used | `<git rev-parse HEAD on main at time of execution>` |

**Sign-off confirmation:**

- [ ] Gate 10 passed (Section 7 result = PASSED)
- [ ] Evidence template completed and sanitized
- [ ] Evidence package submitted in gate-lift PR body or committed as companion document
- [ ] `docs/v2-hexmining-roadmap.md` §11.14 item 10 marked `✅ RESOLVED` in gate-lift PR
- [ ] `docs/v2-hexmining-roadmap.md` §11.14 item 11 will be marked `✅ RESOLVED` after gate-lift PR merges
- [ ] Gate 11 approval confirmed (Section 9 decision tree = APPROVED)
- [ ] Gate-lift PR scope is narrow and does not include disallowed changes

**Final sign-off: `SIGNED OFF / NOT SIGNED OFF`**

---

## Current gate state

| Gate | Status |
|---|---|
| Gate 10 — live-data verification | **OPEN** |
| Gate 11 — gate-lift implementation PR | **OPEN** |
| Public estimated yield | **GATED** |

This runbook does not lift any gate. No production code is modified by this document. Public estimated yield remains gated until Gate 10 passes, the evidence package is submitted, and the gate-lift PR (Gate 11) is reviewed and merged.
