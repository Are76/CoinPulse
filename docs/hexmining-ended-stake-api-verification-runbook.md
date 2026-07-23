# HexMining Ended-Stake API Verification — Operator Runbook

**Status:** Verification tooling and runbook. This document and its companion
script do **not** by themselves constitute a completed verification — an operator
must run the script against a real local server + database and record the factual
output in the evidence template.

**Scope:** Operator/verification tooling only. This is the ended-stake, DB/API
counterpart of the native active-stake live verification tooling
([`hexmining-native-live-verification-runbook.md`](./hexmining-native-live-verification-runbook.md)).
It adds no product functionality and changes no reader, store, schema, DTO, API
contract, or frontend behavior. It only issues one read-only HTTP GET against the
already-shipped `GET /api/hexmining/ended-stakes` route and reports what the
canonical persisted observations look like when read through that contract.

## Purpose

Prove that a canonical, persisted `EndedHexStakeObservation` — including rows
that PR #335 upgraded in place from a previously-incomplete state — is read
correctly through the existing backend reader and API route, for a **known**
PulseChain wallet. Every check is a boolean presence / consistency / scoping
assertion. There is no financial math.

The verified source of truth is **PostgreSQL**, read only through the shipped
backend DTO. The runner does **not** read RPC, does **not** compute any value,
and does **not** consult any frontend state.

## What this verifies (presence / consistency / scoping only)

For a known wallet on PulseChain (`chainId: 369`), the runner confirms:

- the API route `GET /api/hexmining/ended-stakes` is reachable (HTTP 200) and
  returns the `{ data: EndedHexStakeListDto }` envelope
- every returned observation is scoped to the requested `chainId`
- every returned observation is scoped to the requested `walletAddress`
- every observation marked `isComplete: true` has a non-null `lockedDay`
- every observation marked `isComplete: true` has a canonical digit-only
  `stakeShares` string (uint72-compatible, never a number)
- every incomplete observation carries a warning (the degraded state is never
  silent) — no zero-coercion, no fabricated values
- `stakeShares` is always a string or `null`, never a JSON number
- no two observations share the same dedupe identity
  (`chainId : walletAddress : stakeId : endBlockNumber : discoveryMethod`)

**Explicitly NOT done:** no pricing, valuation, yield, ROI, APR/APY, PnL, or USD
math; no RPC reads; no frontend truth. `stakeShares` and `lockedDay` are checked
for presence and string-safety only — never scaled, priced, or compared.

## Prerequisites

- **Local Next.js server running** and serving the API route (e.g. `npm run dev`),
  reachable at the base URL below. The server process must have a working
  `DATABASE_URL` so the route can read persisted observations. This script itself
  opens no DB connection.
- **PostgreSQL** reachable by that server, containing the ended-stake
  observations to verify. If it holds none for the wallet, the run reports that
  honestly (see WARN below) — an empty result is **not** proof of ingestion.
- Optionally, ended-stake discovery already run for the wallet (via the existing
  operator-gated `POST /api/hexmining/ended-stakes/discover`) so there is
  canonical data to read. This verification script never triggers discovery.

## Required environment variables (by name only)

Never print or record the values of these — presence only.

- `OPERATOR_RUNNER_BASE_URL` — optional. Base URL of the running server. Defaults
  to `http://localhost:3000`. May also be supplied with `--base-url`.
- `DATABASE_URL` — required **by the running server** (not by this script) so the
  route can read observations.

## How to run

```bash
npx tsx scripts/hexmining-ended-stake-api-verification.ts \
  --wallet 0x… \
  [--base-url http://localhost:3000] \   # defaults to OPERATOR_RUNNER_BASE_URL or localhost:3000
  [--chain-id 369] \                     # only 369 (PulseChain) is supported
  [--evidence-dir operator-evidence/hexmining-ended-stake-api-verification]
```

- The runner issues exactly one read-only `GET`. It never writes, never triggers
  discovery, and never calls RPC.
- Output is a JSON verification report on stdout. The base URL value,
  credentials, and environment variable values are never printed.
- When `--evidence-dir` is supplied, the report JSON is appended (one line) to
  `ended-stake-api-verification-evidence.jsonl` in that directory. The default
  evidence location is
  `operator-evidence/hexmining-ended-stake-api-verification/`.

## Interpreting the report and exit codes

The report contains `classification` (`PASS` | `WARN` | `FAIL`), the boolean
`checks`, the observation counts, and any `warnings`/`notes`.

- **PASS** (exit `0`) — API reachable, at least one observation returned, **all**
  observations complete, and every check `true`. The backend read path is
  consistent and string-safe for that wallet.
- **WARN** (exit `2`) — API reachable and every integrity check held, but the
  evidence is not a clean proof:
  - **No observations** for the wallet. This is reported honestly and is **not**
    proof of successful ended-stake ingestion — run discovery first, or choose a
    wallet with known ended stakes.
  - **One or more legitimately incomplete** observations (partial START
    evidence). Each still carries its warning; the evidence is partial.
- **FAIL** (exit `1`) — a hard integrity check failed: API unreachable/non-200,
  malformed envelope, a scoping leak (wrong wallet or chain), a complete row
  missing `lockedDay` or with a non-digit `stakeShares`, a `stakeShares` that is
  not a string/null, an incomplete row with no warning, or duplicate identities.

## If a defect is discovered

Per the slice scope: **stop.** Record the defect (observed vs. expected, the
report JSON, and the inputs) in the evidence template and the PR. Do **not** fix
the reader / store / route logic in this verification PR — a fix is a separate,
scoped change.

## Private and sanitized material

Keep the following out of git, logs, and PR comments:

- The base URL value, private RPC URLs, and provider credentials.
- Secrets, API keys, tokens, cookies, or environment variable values.
- `DATABASE_URL` / `OPERATOR_RUNNER_BASE_URL` values (report presence only).

## Limitations

- **Chain:** PulseChain `chainId: 369` only.
- **Asset:** native pHEX ended stakes only. No HSI, eHEX, Ethereum, or Base.
- **No financial verification:** no pricing, valuation, PnL, or estimated-yield
  checks. This is an API/backend contract verification only.
- This runbook does not execute the verification; the verification is completed
  only when an operator runs the script against a real local server + database
  and records the factual output in the evidence template.
