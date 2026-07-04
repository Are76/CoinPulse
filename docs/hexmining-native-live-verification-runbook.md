# HexMining Native Active-Stake Live Verification — Operator Runbook

**Status:** Verification tooling and runbook. This document and its companion
script do **not** by themselves constitute a completed live verification — an
operator must execute the script against real PulseChain data and record the
factual output in the evidence template.

**Scope:** Operator/verification tooling only. The native-HEX counterpart of the
HSI live verification tooling
([`hexmining-hsi-live-verification-runbook.md`](./hexmining-hsi-live-verification-runbook.md)).
This slice adds no product functionality and changes no read, schema, DTO, API,
or frontend behavior. It only orchestrates the existing native stake reads and
reports what each read produced.

## Purpose

Verify that the native HEX active-stake read path

```
stakeCount → stakeLists (enumerated)
```

produces internally consistent data for a **known** PulseChain wallet. Every
check is a boolean presence/consistency assertion — there is no financial math.

## What this verifies (presence/consistency only)

For a known wallet on PulseChain (`chainId: 369`), the runner confirms:

- a single `observedAtBlock` is captured and every read is pinned to it
- `stakeCount` is read
- every native stake is enumerated via `stakeLists`
- the number of successfully enumerated stakes matches `stakeCount`
- every stake has a `stakeId`
- every stake has `stakeShares`
- every stake has `stakeHearts` (staked hearts / principal)
- every stake has a `lockedDay`
- every stake has `stakedDays`
- no two stakes share the same `stakeId`

**Explicitly NOT done:** no comparison of financial values; no yield, valuation,
APR/APY, ROI, PnL, or USD math. Stake values (`stakeShares`, `stakeHearts`) are
recorded for **presence** only — never scaled, priced, or compared.

## Required inputs (operator must supply, never fabricate)

- **Chain:** PulseChain only, `chainId: 369`.
- **Wallet:** a known wallet address that holds native HEX stakes. Choose it from
  an authorized fixture or opt-in source before running.
- **HEX address:** optional. Defaults to the canonical pHEX address in
  `src/config/assets.ts`. Override with `--hexAddress` only if verifying against
  a different deployment.
- **RPC:** a real PulseChain RPC endpoint via `PULSECHAIN_RPC_URL` (or `--rpcUrl`).

This tool reads on-chain only. It does **not** connect to or modify the database,
and it persists nothing.

Do not invent or backfill wallet addresses, block numbers, stake identifiers, or
stake values. If the required wallet is unavailable, stop — the verification
fails closed. An empty wallet (`stakeCount = 0`) is **not** a passing fixture.

## How to run

```bash
PULSECHAIN_RPC_URL='https://…' \
  npx tsx --conditions react-server \
  scripts/hexmining-native-stake-live-verification.ts \
  --wallet 0x… \
  [--hexAddress 0x…]   # defaults to canonical pHEX
```

- The `--conditions react-server` flag is required because the runner uses the
  `server-only` guard.
- Output is a JSON verification report on stdout. Exit code is `0` only when
  every check passes, `1` otherwise.
- The script prints no credentials and no RPC URL.

## Interpreting the report

The report contains:

- `observedAtBlock` — the single block all reads were pinned to.
- `stakeCount` — the on-chain native stake count for the wallet.
- `enumeratedCount` — how many stakes were successfully read via `stakeLists`.
- `stakes` — per-stake `stakeIndex`, `stakeId`, `stakeHearts`, `stakeShares`,
  `lockedDay`, `stakedDays` (presence-only; values recorded, never compared).
- `warnings` — any per-index read failures.
- `checks` — the boolean checklist above.
- `allChecksPassed` — `true` only when the wallet had at least one stake and
  every check is `true`.

A passing run means the native read path is internally consistent for that
wallet. Record the JSON in the evidence template
([`hexmining-native-live-verification-evidence-template.md`](./hexmining-native-live-verification-evidence-template.md)).

## If a defect is discovered

Per the slice scope: **stop.** Document the defect (observed vs. expected, the
report JSON, and the inputs) in the evidence template and the PR. Do **not** fix
the native read/sync logic in this verification PR — a fix is a separate, scoped
change.

## Private and sanitized material

Keep the following out of git, logs, and PR comments:

- Private RPC URLs and provider credentials.
- Secrets, API keys, tokens, cookies, or environment variable values.
- `DATABASE_URL` / `PULSECHAIN_RPC_URL` values (report presence as true/false only).

## Not completed by this document

- This runbook does not execute live verification.
- This runbook does not change native read, sync, schema, DTO, or API behavior.
- This runbook does not add pricing, valuation, yield, or analytics.
- The live verification itself is completed only when an operator runs the
  script against real PulseChain data and records the factual output.
