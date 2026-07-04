# HexMining HSI Live Verification — Operator Runbook

**Status:** Verification tooling and runbook. This document and its companion
script do **not** by themselves constitute a completed live verification — an
operator must execute the script against real PulseChain data and record the
factual output in the evidence template.

**Phase:** V2 HexMining Phase 6 — Slice 4 (HSI live verification).

## Purpose

Verify that the already-merged HSI pipeline

```
discovery → observation persistence → reader enrichment
```

produces internally consistent data for a **known** PulseChain HSI. This slice
adds no product functionality and changes no discovery, persistence, reader,
schema, DTO, or frontend behavior. It only orchestrates the shipped services and
reports what each stage produced.

## What this verifies (presence/consistency only)

Using a known HSI on PulseChain (`chainId: 369`), the runner confirms:

- discovery finds the token
- the discovered token id matches the expected token id
- `observedAtBlock` is captured
- the reader resolves the per-stake HSI contract (independently recorded)
- the reader reads the underlying HEX stake
- `stakeId` is populated
- `stakeShares` is populated
- `principalHex` is populated
- `lockedDay` is populated
- `stakedDays` is populated
- `isComplete` becomes `true`
- the `hexmining-hsi-stake-fields-unknown` warning is present before enrichment
  and absent after

**Explicitly NOT done:** no comparison of financial values; no yield, valuation,
APR/APY, ROI, PnL, or USD math. Every check is a boolean presence/consistency
assertion.

## Required inputs (operator must supply, never fabricate)

- **Chain:** PulseChain only, `chainId: 369`.
- **Wallet:** a known wallet address that holds the HSI being verified. Choose it
  from an authorized fixture or opt-in source before running — do not pick an
  arbitrary on-chain wallet after the fact.
- **HSI manager address:** the Hedron `HEXStakeInstanceManager` (ERC-721)
  contract discovery enumerates against.
- **Expected HSI token id:** the known NFT token id to verify (decimal string).
- **RPC:** a real PulseChain RPC endpoint via `PULSECHAIN_RPC_URL` (or `--rpcUrl`).
- **Database:** a `DATABASE_URL` pointing at the environment where observation
  persistence should run.

Do not invent or backfill wallet addresses, token ids, block numbers, stake
identifiers, or stake values. If any required input is unavailable, stop — the
verification fails closed.

## How to run

```bash
DATABASE_URL='postgresql://…' \
PULSECHAIN_RPC_URL='https://…' \
  npx tsx --conditions react-server \
  scripts/hexmining-hsi-live-verification.ts \
  --wallet 0x… \
  --hsiManager 0x… \
  --tokenId <decimal>
```

- The `--conditions react-server` flag is required because the pipeline services
  use the `server-only` guard.
- Output is a JSON verification report on stdout. Exit code is `0` only when
  every check passes, `1` otherwise.
- The script prints no credentials and no RPC URL.

## Interpreting the report

The report contains:

- `discovery` — `ok`, `discovered`, `persisted`, `skipped`, `observedAtBlock`.
- `target` — `found`, `hsiTokenId`, `observedAtBlock`, `resolvedHsiContract`,
  `isCompleteBefore`, `warningsBefore`.
- `enrichment` — `ok`, `outcomeStatus` (`enriched` / `missing` / `failed`).
- `afterEnrichment` — `isComplete`, `stakeId`, `stakeIndex`, `stakeShares`,
  `principalHex`, `lockedDay`, `stakedDays`, `warningsAfter`.
- `checks` — the boolean checklist above.
- `allChecksPassed` — `true` only when every check is `true`.

A passing run means the pipeline is internally consistent for that HSI. Record
the JSON in the evidence template
([`hexmining-hsi-live-verification-evidence-template.md`](./hexmining-hsi-live-verification-evidence-template.md)).

## If a defect is discovered

Per the slice scope: **stop.** Document the defect (observed vs. expected, the
report JSON, and the inputs) in the evidence template and the PR. Do **not** fix
discovery, persistence, or reader logic in this verification PR — a fix is a
separate, scoped change.

## Private and sanitized material

Keep the following out of git, logs, and PR comments:

- Private RPC URLs and provider credentials.
- Secrets, API keys, tokens, cookies, or environment variable values.
- Wallet ownership notes or opt-in participant identities beyond the minimum
  fixture identifiers needed for auditability.

## Not completed by this document

- This runbook does not execute live verification.
- This runbook does not change discovery, persistence, or reader logic.
- This runbook does not add pricing, valuation, yield, or analytics.
- The live verification itself is completed only when an operator runs the
  script against real PulseChain data and records the factual output.
