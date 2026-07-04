# HexMining HSI Live Verification — Evidence Template

Fill this in from an **actual** operator run of
`scripts/hexmining-hsi-live-verification.ts` against real PulseChain data. Do not
fabricate any value. Every field below must come from the run's JSON report or
the authorized input source. Leave a field as `PENDING OPERATOR EXECUTION` until
it is filled from a real run.

> **Environment note:** As of this PR, no live run has been executed. There is no
> configured PulseChain RPC endpoint, no synced database, and no authorized
> HSI-holding wallet available in the PR/CI environment. The output section below
> is therefore intentionally left `PENDING OPERATOR EXECUTION`. The verification
> tooling, runner, and tests are complete and validated; the live execution is an
> operator step.

## Run metadata

| Field | Value |
|---|---|
| Date (UTC) | `PENDING OPERATOR EXECUTION` |
| Chain id | `369` |
| Operator | `PENDING OPERATOR EXECUTION` |
| Script commit SHA | `PENDING OPERATOR EXECUTION` |
| `rpcEndpointLabel` (sanitized) | `PENDING OPERATOR EXECUTION` |

## Inputs (from authorized source)

| Field | Value |
|---|---|
| Wallet | `PENDING OPERATOR EXECUTION` |
| HSI manager address | `PENDING OPERATOR EXECUTION` |
| Expected HSI token id | `PENDING OPERATOR EXECUTION` |

## Report output (from the run's JSON)

| Field | Value |
|---|---|
| `discovery.ok` | `PENDING OPERATOR EXECUTION` |
| `discovery.discovered` | `PENDING OPERATOR EXECUTION` |
| `discovery.observedAtBlock` | `PENDING OPERATOR EXECUTION` |
| `target.found` | `PENDING OPERATOR EXECUTION` |
| `target.hsiTokenId` | `PENDING OPERATOR EXECUTION` |
| `target.observedAtBlock` | `PENDING OPERATOR EXECUTION` |
| `target.resolvedHsiContract` (HSI contract) | `PENDING OPERATOR EXECUTION` |
| `target.isCompleteBefore` | `PENDING OPERATOR EXECUTION` |
| `target.warningsBefore` | `PENDING OPERATOR EXECUTION` |
| `enrichment.outcomeStatus` | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.isComplete` | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.stakeId` | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.stakeShares` (presence only) | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.principalHex` (presence only) | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.lockedDay` | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.stakedDays` | `PENDING OPERATOR EXECUTION` |
| `afterEnrichment.warningsAfter` | `PENDING OPERATOR EXECUTION` |

> Record `stakeShares` and `principalHex` for **presence** confirmation only. Do
> not compute, scale, price, or compare them.

## Checks

| Check | Result |
|---|---|
| discovery finds the token | `PENDING OPERATOR EXECUTION` |
| token id matches | `PENDING OPERATOR EXECUTION` |
| observedAtBlock captured | `PENDING OPERATOR EXECUTION` |
| HSI contract resolved | `PENDING OPERATOR EXECUTION` |
| stakeId populated | `PENDING OPERATOR EXECUTION` |
| stakeShares populated | `PENDING OPERATOR EXECUTION` |
| principalHex populated | `PENDING OPERATOR EXECUTION` |
| lockedDay populated | `PENDING OPERATOR EXECUTION` |
| stakedDays populated | `PENDING OPERATOR EXECUTION` |
| isComplete became true | `PENDING OPERATOR EXECUTION` |
| stake-fields-unknown warning removed | `PENDING OPERATOR EXECUTION` |
| **allChecksPassed** | `PENDING OPERATOR EXECUTION` |

## Discovered issues

`PENDING OPERATOR EXECUTION` — if a defect appears, record observed vs. expected
and the report JSON here, then STOP (do not fix in the verification PR).

## Final decision

`PENDING OPERATOR EXECUTION` — PASS only when `allChecksPassed` is `true` from a
real run and no defect was observed.
