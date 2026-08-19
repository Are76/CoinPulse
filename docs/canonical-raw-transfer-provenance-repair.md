# Historical Canonical Raw-Transfer Provenance Repair

## Purpose

PR #376 started persisting exact `RawTokenTransfer` evidence
(`RawDexSwapTransferEvidence` / `RawLpActionTransferEvidence` /
`RawStakeActionTransferEvidence`, plus `rawTransferEvidenceStatus`) for
newly-ingested SWAP, LP, and currently-supported transfer-derived STAKE
actions. It deliberately performed no historical backfill: pre-existing
ACTIVE actions were left with `rawTransferEvidenceStatus === null`. PR #377
only suppresses generic TRANSFER shadows when `rawTransferEvidenceStatus ===
"RECORDED"`, so a historical action never suppresses its TRANSFER shadow
until its provenance is repaired.

This capability (`src/services/sync/canonical-provenance-repair.ts`,
`npm run repair:canonical-provenance`) re-derives that historical evidence
using **only already-persisted canonical PostgreSQL rows — never RPC**.

## What it does

For a bounded batch of ACTIVE, `rawTransferEvidenceStatus === null` actions
in one family (SWAP, LP, or STAKE), scoped to one chain and optionally one
wallet:

1. Reads the exact ACTIVE, wallet-facing `RawTokenTransfer` rows for that
   action's transaction (`chainId + txHash + blockHash`, wallet
   `fromAddress`/`toAddress`), the same query shape live ingestion uses.
2. Reuses the **exact same deterministic evidence-selection function** the
   live producer uses — `summarizeWalletSwapTransfers` (dex-sync.ts),
   `summarizeWalletLpTransfers` / `buildLpTransferEvidencePlans` (lp-sync.ts),
   or `summarizeStakeStartTransfers` / `summarizeStakeEndTransfers`
   (stake-sync.ts) — now exported so this repair never maintains a second,
   possibly-drifting implementation of that logic.
3. If the reused function can unambiguously shape the transfers, cross-checks
   the recomputed leg asset/amount against what was persisted on the action
   at original ingestion time. This is a **consistency gate, not a selection
   mechanism** — the evidence membership itself was already decided in step 2
   using only the deterministic producer function. A mismatch here means the
   currently-persisted transfer set no longer matches what was true when the
   action was created (for example an intervening reorg), and the action is
   left unresolved rather than repaired against stale-relative-to-now data.
4. Persists evidence via the exact same atomic, idempotent persistence
   helpers PR #376 introduced (`persistRawDexSwapTransferEvidence` /
   `persistRawLpActionTransferEvidence` /
   `persistRawStakeActionTransferEvidence`) — evidence rows and the
   action-level status update happen in one transaction.

## Deterministic repair boundary — family classification

| Family | Classification | Why |
|---|---|---|
| SWAP | **A — deterministically repairable** | `summarizeWalletSwapTransfers` requires exactly one distinct outbound wallet asset and one distinct inbound wallet asset in the transaction; that shape is fully determined by already-persisted ACTIVE `RawTokenTransfer` rows. |
| LP | **A — deterministically repairable** | `summarizeWalletLpTransfers` requires exactly a 2-outbound/1-inbound (ADD) or 1-outbound/2-inbound (REMOVE) wallet-transfer shape; same reproducibility argument as SWAP. |
| STAKE (native pHEX START/END, actionIndex 0) | **A — deterministically repairable, scope-limited** | `summarizeStakeStartTransfers`/`summarizeStakeEndTransfers` require exactly one wallet-facing native-pHEX transfer leg. Only `actionKind` START/END with `actionIndex === 0` and `protocolSlug === "hex"` are in scope — those are the only shapes the live producer (`stake-sync.ts`) has ever written. Any other stake row (different actionKind/actionIndex, e.g. a future HSI path) is **C — not safely repairable** here: current producer semantics don't define its evidence shape, so the candidate reader never selects it and it stays `null`. |

Within each in-scope family, an individual action is only actually repaired
when both the reused shape function succeeds **and** the consistency-gate
cross-check passes. Any action where the shape is ambiguous, the transfer
evidence is missing/reorged, or the recomputed amounts drift from the
persisted snapshot is **B — left unresolved** (`rawTransferEvidenceStatus`
stays `null`), never guessed.

## What it does not do

- **No RPC.** Only already-persisted PostgreSQL rows are read.
- **No heuristic inference.** txHash, token symbol, asset ID alone, amount
  equality, quantity equality, direction alone, or same-transaction
  membership alone are never used to select evidence. The only selection
  authority is the reused deterministic producer function; amount/asset
  comparison is used only as a post-hoc consistency gate (see step 3 above).
- **No mutation of RECORDED or VERIFIED_EMPTY actions.** The candidate
  readers only ever select rows where `rawTransferEvidenceStatus === null`
  and `status === "ACTIVE"`. REORGED actions and REORGED backing transfers
  are never used as evidence.
- **No fabricated VERIFIED_EMPTY.** Under current SWAP/LP/STAKE producer
  semantics every in-scope, successfully-shaped action always has at least
  one non-empty leg, so this repair never persists `VERIFIED_EMPTY` — it can
  only ever produce `RECORDED` or leave the action `null`/unresolved. `null`
  (unresolved) and `VERIFIED_EMPTY` (provably no evidence applies) remain
  distinct; this repair never converts one into the other speculatively.
- **No Curve support, no protocol expansion, no schema/migration change.**
- **No ledger rebuild.** This repairs raw-audit-layer provenance only. A
  later ledger rebuild — a separate, separately-approved operator action —
  is what lets PR #377's TRANSFER-shadow suppression actually observe the
  new evidence for a given wallet's canonical ledger state.
- **No PnL change.**

## Reorg safety

- Only `status === "ACTIVE"` higher-order actions are ever scanned — a
  REORGED action is never repaired as active provenance.
- Only `status === "ACTIVE"` `RawTokenTransfer` rows are ever read as
  candidate evidence — a REORGED transfer is never used.
- Identity is always the full canonical tuple (`chainId + txHash + blockHash`
  [+ `logIndex` for SWAP/LP, + `actionKind` + `actionIndex` for STAKE]),
  never `txHash` alone.

## Idempotency and atomicity

This repair calls the same `persistRaw*TransferEvidence` helpers PR #376
introduced and tested for atomic, `skipDuplicates`-based, idempotent
persistence. Because the candidate readers only ever select
`rawTransferEvidenceStatus === null` rows, a second run against the same
data finds zero remaining candidates for whatever was already repaired —
no duplicate evidence rows, no status oscillation. A persistence failure
inside the shared transaction leaves the action's status and evidence rows
exactly as they were before the attempt.

## Bounded execution

- One family (`SWAP` | `LP` | `STAKE`), one chain, optionally one wallet, per
  invocation.
- `maxActions` bounds the batch: default 100, hard cap 500
  (`PROVENANCE_REPAIR_MAX_ACTIONS_HARD_CAP`) — mirrors the existing
  `repair-fabricated-token-transfers` batch-size convention.
- Deterministic `id`-ascending cursor pagination. A batch that hits the cap
  returns `nextCursorId`; pass it as `--cursor` to resume.

## Usage

Dry-run (default, never mutates):

```bash
npm run repair:canonical-provenance -- --chain-id 369 --family SWAP
```

Apply mode requires an explicit family and chain, same as dry-run, plus
`--apply`:

```bash
npm run repair:canonical-provenance -- --chain-id 369 --family SWAP --apply
```

Optional wallet scope and batch size:

```bash
npm run repair:canonical-provenance -- --chain-id 369 --family LP \
  --wallet 0x... --max-actions 200
```

Resume a bounded scan:

```bash
npm run repair:canonical-provenance -- --chain-id 369 --family STAKE \
  --cursor <nextCursorId>
```

## Operational sequence

This tool performs provenance repair only. The full historical-cleanup
sequence is intentionally kept in separate, separately-approved steps:

1. Dry-run provenance repair (this tool, no `--apply`).
2. Operator review of the dry-run report — repaired/unresolved counts and
   reasons.
3. Approved, bounded apply-mode provenance repair.
4. Verify canonical DB state (evidence rows + `rawTransferEvidenceStatus`).
5. Separately approve a bounded ledger rebuild/re-normalization, if desired,
   for PR #377's TRANSFER-shadow suppression to take effect against the
   newly-repaired historical evidence.

No live repair has been run against production data as part of introducing
this capability.
