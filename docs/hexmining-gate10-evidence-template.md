# HexMining Gate 10 Evidence Package Template

**Purpose:** Fill in this template when executing Gate 10 verification per `docs/hexmining-gate10-execution-plan.md`. Submit the completed record in the gate-lift PR body or as a committed companion document. Do not submit this blank template as evidence.

**Gate 10 state:** OPEN (fill in only after harness execution)

---

## 1. Verification Metadata

| Field | Value |
|---|---|
| Verification date | `YYYY-MM-DD` |
| Operator | `<operator handle or role — no private identity required>` |
| Codebase commit SHA (`git rev-parse HEAD` on `main`) | `<40-character SHA>` |
| Node.js version (`node --version`) | `<version string>` |
| Database environment | `<staging / production — no connection string>` |
| Harness module | `src/services/hexmining/verification-harness.ts` |
| Harness function | `verifyHexMiningYieldEvidence` |

---

## 2. Observation Metadata

All values retrieved from the `RawHexDailyDataObservation` record identified in Step B of the execution plan. No values may be invented or backfilled.

| Field | Value |
|---|---|
| `observationId` | `<cuid from RawHexDailyDataObservation.id>` |
| `chainId` | `369` |
| `sourceFamily` | `HEXMINING` |
| `rangeStartDay` | `<non-negative integer>` |
| `rangeEndDay` | `<non-negative integer ≥ rangeStartDay>` |
| `observedAtBlock` | `<non-negative integer string>` |
| `rpcEndpointLabel` | `<sanitized label — not the raw URL>` |
| `payloadVersion` | `<version string from record, e.g. "v1">` |
| `dailyData entry count` | `<integer — must equal rangeEndDay − rangeStartDay + 1>` |
| `expected entry count` | `<rangeEndDay − rangeStartDay + 1>` |
| Entry count matches expected | `YES / NO` |
| Invalidation records exist | `YES / NO` |

> If "Invalidation records exist" is YES, stop. Select a different observation with no invalidation records.

---

## 3. Stake Metadata

Retrieved from the authorized fixture or opt-in stake record, pre-selected before the observation query (see Step A of the execution plan). Not derived from the observation record.

| Field | Value |
|---|---|
| Fixture stake identifier | `<wallet address and on-chain stake index, or authorized stake ID — minimum identifiers only>` |
| `stakeShares` (bigint decimal string) | `<non-negative decimal string — no leading zeros>` |
| Source of `stakeShares` | `<persisted stake record / ingested stakeLists RPC data>` |

---

## 4. Harness Execution Record

### 4a. Observation retrieval query (sanitized)

Record the sanitized query or retrieval method used in Step B to look up the `RawHexDailyDataObservation` record. This lets reviewers confirm the observation was selected by the pre-specified `rangeStartDay`/`rangeEndDay`, not by an arbitrary sort order.

```sql
<sanitized query — omit DATABASE_URL, connection string, and any private credentials>
```

Example form (fill in actual values):
```sql
SELECT id, "rangeStartDay", "rangeEndDay", "observedAtBlock", "rpcEndpointLabel", "payloadVersion"
FROM "RawHexDailyDataObservation"
WHERE "chainId" = 369 AND "rangeStartDay" = <n> AND "rangeEndDay" = <n>
ORDER BY "observedAtBlock" DESC
LIMIT 1;
```

### 4b. Command run

```
<exact command or script invocation used to call verifyHexMiningYieldEvidence>
```

Example form (fill in actual values — do not copy this line verbatim):
```
DATABASE_URL='...' npx tsx <script-path> --observationId <id> --rangeStartDay <n> --rangeEndDay <n> ...
```

No `deps.estimatorCalculation` override was passed: `YES / NO`

> Must be YES. The test-only override must not be used during Gate 10 execution.

### 4c. Raw harness result (sanitized)

```json
{
  "passed": <true | false>,
  "failureCode": <null | "string">,
  "estimatorStatus": <"evidence_available" | other>,
  "formula": {
    "reproducedYieldHex": <"decimal string" | null>,
    "estimatorInternalYieldHex": <null>,
    "entryCount": <integer | null>,
    "expectedEntryCount": <integer | null>
  },
  "provenance": {
    "chainId": 369,
    "sourceFamily": "HEXMINING",
    "observationId": "<id>",
    "rangeStartDay": <integer>,
    "rangeEndDay": <integer>,
    "observedAtBlock": "<string>",
    "rpcEndpointLabel": "<sanitized label>"
  },
  "warnings": [<"warning string if present" — copy all strings verbatim; use [] if none>]
}
```

> Do not include `canonicalPayload` anywhere in this record. The `reproducedYieldHex` value is a bigint base-10 decimal string (the "Hex" suffix refers to the HEX token in hearts units, not hexadecimal encoding).

### 4d. Summary fields

| Field | Recorded value | Expected |
|---|---|---|
| `result.passed` | `<true / false>` | `true` |
| `result.failureCode` | `<null or string>` | `null` |
| `result.estimatorStatus` | `<string>` | `"evidence_available"` |
| `result.formula.entryCount` | `<integer>` | `= rangeEndDay − rangeStartDay + 1` |
| `result.formula.expectedEntryCount` | `<integer>` | Same as entryCount |
| `result.formula.reproducedYieldHex` | `<decimal string>` | Non-null |
| `result.formula.estimatorInternalYieldHex` | `<null>` | `null` |

---

## 5. Provenance Record

Populated from `result.provenance` as returned by the harness.

| Field | Value |
|---|---|
| `chainId` | `369` |
| `sourceFamily` | `HEXMINING` |
| `observationId` | `<matches Section 2>` |
| `rangeStartDay` | `<matches Section 2>` |
| `rangeEndDay` | `<matches Section 2>` |
| `observedAtBlock` | `<matches Section 2>` |
| `rpcEndpointLabel` | `<matches Section 2>` |

> `result.provenance` is the harness's sanitized echo of the inputs. The estimator's own internal provenance path is exercised and evidenced by `result.estimatorStatus === "evidence_available"`.

---

## 6. Warning Record

| # | Warning string | Explanation |
|---|---|---|
| 1 | `<warning string or "none">` | `<explanation>` |

Expected warnings and their dispositions:

| Warning code | Disposition |
|---|---|
| `hexmining-yield-bpd-attribution-unresolved` | Acceptable if `rangeStartDay ≤ 353 ≤ rangeEndDay`; not a Gate 10 blocker |
| `hexmining-rpc-*` | Review RPC health; not automatically a blocker if observation is complete |
| `hexmining-verification-*` | Investigate; a verification warning alongside `passed: true` is unusual |
| Any other warning | Explain below |

Additional explanation (if needed):

> `<explain any unexpected warnings here, or write "none">`

---

## 7. Success Criteria Checklist

All nine must be checked YES for Gate 10 to pass.

| # | Criterion | Status |
|---|---|---|
| 1 | `result.passed === true` | `YES / NO` |
| 2 | `result.failureCode === null` | `YES / NO` |
| 3 | `result.estimatorStatus === "evidence_available"` | `YES / NO` |
| 4 | `result.formula.entryCount === result.formula.expectedEntryCount` | `YES / NO` |
| 5 | `result.formula.reproducedYieldHex` is a non-null decimal string | `YES / NO` |
| 6 | `result.formula.estimatorInternalYieldHex === null` | `YES / NO` |
| 7 | `result.provenance.chainId === 369` | `YES / NO` |
| 8 | All provenance fields match the inputs in Section 2 | `YES / NO` |
| 9 | All warnings explained; none are unexpected failures | `YES / NO` |

**Gate 10 result:** `PASSED / FAILED`

---

## 8. Failure Criteria Checklist

Check any that apply. If any box is checked, Gate 10 fails and Gate 11 must not be opened.

| Condition | Applies? | Failure code |
|---|---|---|
| `result.passed === false` | `YES / NO` | Any |
| `result.failureCode` is not null | `YES / NO` | Any |
| `result.estimatorStatus !== "evidence_available"` | `YES / NO` | `hexmining-verification-estimator-not-evidence-available` |
| Entry count mismatch | `YES / NO` | `hexmining-verification-payload-range-mismatch` |
| Negative or invalid day range | `YES / NO` | `hexmining-verification-invalid-range` |
| Payload decode failure | `YES / NO` | `hexmining-verification-invalid-payload` or `hexmining-verification-packed-decode-failed` |
| Observation has invalidation records | `YES / NO` | `hexmining-verification-observation-invalidated` |
| `result.formula.estimatorInternalYieldHex !== null` | `YES / NO` | Test-only override was used — rerun without `deps.estimatorCalculation` |
| Any required input was fabricated or backfilled | `YES / NO` | Verification is invalid |

**Failure explanation** (if any box is YES):

> `<describe the failure, its failure code, and the corrective action taken or required>`

---

## 9. Gate 11 Approval Checklist

Complete only after Gate 10 passes (Section 7 result = PASSED). All items must be confirmed before opening the gate-lift implementation PR.

| # | Requirement | Confirmed |
|---|---|---|
| 1 | Gate 10 passed — `result.passed === true` | `YES / NO` |
| 2 | This evidence package is complete and submitted in the gate-lift PR body or committed as a companion document | `YES / NO` |
| 3 | `docs/v2-hexmining-roadmap.md` §11.14 item 10 will be marked `✅ RESOLVED` in the gate-lift PR | `YES / NO` |
| 4 | The gate-lift PR promotes `evidence_available` → `"estimated"` in `src/services/hexmining/yield-estimator.ts` | `YES / NO` |
| 5 | The approved §11.16 `HexStakeYieldDto` contract shape is preserved | `YES / NO` |
| 6 | `valuation.status` and `pnl.status` remain `"unsupported"` | `YES / NO` |
| 7 | No `canonicalPayload` appears in any DTO or API response | `YES / NO` |
| 8 | No frontend yield, PnL, or valuation calculation is introduced | `YES / NO` |
| 9 | `docs/v2-hexmining-roadmap.md` item 11 will be marked `✅ RESOLVED` after gate-lift PR merges | `YES / NO` |

**Gate 11 approval:** `APPROVED TO OPEN GATE-LIFT PR / NOT YET APPROVED`

---

## Sanitization confirmation

The following must NOT appear anywhere in this document or the gate-lift PR:

- Raw RPC URLs or provider credentials
- Secrets, API keys, tokens, cookies, or environment variable values
- Private wallet ownership details beyond the minimum authorized fixture identifiers
- The `canonicalPayload` JSON string

Sanitization confirmed: `YES / NO`
