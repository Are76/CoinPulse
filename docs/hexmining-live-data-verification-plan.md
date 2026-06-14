# HexMining Live-Data / Opt-In Verification Plan

**Status:** Historical planning record. This document itself did not execute live verification; Gate 10 live-data verification and the Gate 11 production promotion were later completed in PR #252.

## Purpose

This plan defined the auditable verification record required before the remaining HexMining public estimated-yield gate could be lifted. The verification had to prove that a controlled live-data fixture or opt-in wallet on PulseChain could produce canonical backend evidence for a known historical day range, that the estimator reached the gated `evidence_available` state before promotion, and that the yield formula could be independently reproduced from the canonical payload.

This verification is backend-only. It must not use frontend state, frontend calculations, DexScreener, fabricated yield values, or live RPC calls from a documentation-only PR.

## Required inputs

The Gate 10 verification PR had to record all of the following inputs before any public estimated-yield promotion:

- **Chain:** PulseChain only, with `chainId: 369`.
- **Historical day range:** a known, explicit HEX day range selected before execution.
- **Fixture source:** either a known wallet/stake fixture or a controlled opt-in wallet whose use is authorized for this verification.
- **Observation identifiers and provenance:**
  - `observationId`
  - `rangeStartDay`
  - `rangeEndDay`
  - `observedAtBlock`
  - `rpcEndpointLabel` — a sanitized label only, not a private URL.

Do not invent or backfill historical day ranges, block numbers, RPC endpoints, stake identifiers, or expected yield values. If any required input is unavailable, the verification must fail closed and the public estimated-yield gate must remain closed.

## Required checks

The verification had to demonstrate each check below and retain enough evidence for review:

1. `dailyData` evidence exists for the full required historical range.
2. The canonical payload validates against the backend decoder/normalizer used by the estimator path.
3. The observation record used by the estimator is not invalidated, superseded by an unsafe reorg state, or otherwise disqualified.
4. Before any gate lift, the estimator returns `evidence_available` for the verified evidence path rather than public `estimated` output.
5. Formula math can be independently reproduced from the canonical payload using the approved backend formula: cumulative yield over elapsed days with multiply-first bigint arithmetic and deterministic flooring.
6. No frontend truth is involved. The frontend must not compute balances, prices, PnL, LP values, stake values, or HexMining yield.
7. No fabricated yield is introduced. Missing, incomplete, stale, or invalid evidence must remain unavailable or gated, never coerced to zero or a made-up estimate.

## Required output evidence

The future verification record must include a sanitized summary with:

- Commands used to create/read the observation and run the estimator verification.
- Sanitized result summary, including whether the estimator reached `evidence_available` before gate lift.
- Observation provenance: `observationId`, `rangeStartDay`, `rangeEndDay`, `observedAtBlock`, `rpcEndpointLabel`, and `chainId: 369`.
- Warnings emitted by the evidence provider, decoder, estimator, or verification harness.
- Formula reproduction summary, including the canonical payload source and pass/fail outcome, without exposing private or sensitive data.
- Final pass/fail decision for the gate-lift prerequisite.

A passing record was necessary but not sufficient by itself to expose public estimated yield. The final gate-lift PR still had to update the roadmap, preserve the approved DTO contract, and keep the production change narrowly scoped to the estimator promotion.

## Private and sanitized material

The verification record must keep the following private or sanitized:

- Private RPC URLs and provider credentials.
- Secrets, API keys, tokens, cookies, or environment variable values.
- Sensitive wallet notes, ownership details, operational notes, or opt-in communications.
- Any information that could identify an opt-in participant beyond the minimum authorized fixture identifiers needed for auditability.

Use stable labels such as `rpcEndpointLabel` for reviewer-visible provenance, and keep raw secrets out of git, logs, screenshots, and PR comments.

## Not completed by this planning document

- This planning document did not execute live verification.
- This planning document did not lift the production gate.
- This planning document did not expose public estimated yield.
- This planning document did not change code.
- The live verification, gate lift, and production promotion were completed later by PR #252.
