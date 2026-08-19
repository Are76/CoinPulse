# Canonical Raw-Transfer Provenance

## Purpose

CoinPulse now records which exact wallet-facing `RawTokenTransfer` rows contributed to supported higher-order raw actions. This is backend audit provenance only. It is not exposed in public DTOs or UI, and it does not change accounting, pricing, valuation, PnL, or transfer normalization behavior.

The immediate scope is the current ERC-20 transfer evidence model:

- `RawDexSwapTransferEvidence`
- `RawLpActionTransferEvidence`
- `RawStakeActionTransferEvidence`

Each row links one higher-order raw action to one canonical `RawTokenTransfer` row and labels the economic leg role that consumed it.

## Why `sourceLogKey` Is Not Enough

`sourceLogKey` identifies the normalized ledger source reference for one family. It cannot prove cross-family raw evidence reuse:

- generic TRANSFER entries use the ERC-20 `Transfer` event log index
- SWAP entries use the DEX pool `Swap` event log index
- LP entries may use an aggregated/minimum LP leg log index
- staking entries can be derived from calldata, contract state, and transfer observations

A later transfer-shadow suppression decision must therefore read exact persisted raw-transfer evidence, not compare source log indexes or transaction hashes.

## Many-To-One Evidence

The provenance tables intentionally support many-to-one relationships. One higher-order economic leg can consume multiple `RawTokenTransfer` rows, for example several outbound transfers netted into one SWAP sold leg or several token0 transfers aggregated into one LP add leg.

Uniqueness is enforced per action, leg role, and raw-transfer row, so reruns do not accumulate duplicates.

## Missing Versus Empty

Each higher-order raw action has nullable `rawTransferEvidenceStatus`:

- `null` means provenance was not recorded, usually because the row is historical/legacy
- `RECORDED` means the action was evaluated and one or more evidence rows were persisted
- `VERIFIED_EMPTY` means the action was evaluated and no `RawTokenTransfer` evidence truthfully applies

The migration performs no historical backfill and does not make legacy rows appear empty.

## ERC-20 And Native Boundary

The evidence relation is limited to `RawTokenTransfer`, which is ERC-20 transfer evidence. Native PLS movement is represented elsewhere, primarily through `RawTransaction.valueRaw` and native gas fee fields. This PR does not pretend native PLS value movement is a token transfer and does not introduce a generic movement abstraction.

Current supported SWAP and LP wallet-facing economic legs are derived from wallet-related ERC-20 transfer snapshots. Native PLS gas fees remain separate fee evidence and are not represented in these raw-transfer provenance tables.

## Deferred Use

This provenance is created so a later bounded PR can decide whether a generic TRANSFER group is a true shadow of a higher-order action. This PR deliberately does not suppress TRANSFER groups, alter PnL behavior, add Curve support, run a backfill, or change any frontend/API contract.
