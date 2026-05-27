# Reusable Data-Fetching Pattern Reference (Internal)

## 1. Scope

This document is an internal reference for reusable data-fetching patterns observed in CoinPulse.

This reference explicitly confirms the following boundaries:

- no template folder is created
- no starter example is created
- no external repo is created
- no code is extracted
- no runtime behavior changes

## 2. What this reference is

This document is:

- a documentation-only summary of reusable patterns
- based on existing route, DTO, query, mutation, invalidation, testing, and PR workflow evidence
- intended to prepare for a future template only after remaining G1-G4 blockers close

## 3. What this reference is not

This document is not:

- a reusable package
- an executable starter
- a template folder
- an external repository
- permission to extract CoinPulse hooks/services
- permission to copy CoinPulse domain rules into another project

## 4. Reusable architecture pattern

Generic reusable pattern:

- backend route owns source-of-truth response contract
- route returns versioned DTO envelope
- route has stable success and safe error envelopes
- frontend client parses/returns backend DTO
- query hook owns query key, enabled behavior, stale/gc timing, and error preservation
- mutation hook owns mutation call and scoped invalidation
- invalidation is explicit and narrow
- UI renders DTOs only
- no frontend inference for backend-owned truth

## 5. Reusable route pattern

Generic expectations:

- validate input at route boundary
- delegate domain work to service layer
- return typed/versioned envelope
- preserve operator-safe errors
- avoid leaking internal exception details
- contract-test success, invalid input, not-found, conflict, and internal-error paths where applicable

## 6. Reusable client/query-hook pattern

Generic expectations:

- API client preserves backend errors
- query key is centralized
- identity fields are explicit and stable
- enabled/disabled behavior is tested
- staleTime/gcTime choices are explicit
- hook returns DTO pass-through
- no frontend computation of backend-owned truth

## 7. Reusable mutation/invalidation pattern

Generic expectations:

- mutation calls one backend operation
- errors/conflicts are preserved
- invalidation is scoped to only affected query families
- broad invalidation requires explicit backend materialization proof
- invalidation behavior has tests for exact keys and unrelated-family exclusions

## 8. Reusable testing pattern

Generic expectations:

- route contract tests
- service tests where domain assembly exists
- API client tests
- query hook tests
- mutation hook tests
- invalidation helper tests
- component wiring tests for "uses hook/client" behavior
- no live RPC/database dependency in unit/contract tests unless explicitly an integration test

## 9. Reusable PR workflow pattern

Generic expectations:

- one task = one branch = one PR
- start from latest main/default branch
- when using Codex GitHub integration, treat a missing local `origin` after bootstrap as expected and create/publish PRs through the integration flow
- docs/planning before implementation when architecture is affected
- contract tests before UI
- small bounded changes
- exact validation results in PR body
- do not hide failed validation
- docs-only PRs must not change runtime behavior

## 10. CoinPulse-specific items intentionally excluded

The following items must not be copied into a generic template:

- PulseChain assumptions
- chain ID 369
- PLS/PLSX/HEX/pDAI language
- CoinPulse canonical ledger implementation details
- CoinPulse pricing/PnL/accounting logic
- LP/stake support details
- Portfolio Intelligence roadmap wording
- Break-Even Scenarios roadmap wording
- CoinPulse debug route names unless generalized
- CoinPulse deployment/env assumptions

## 11. Remaining blockers before template folder

An internal template folder is still not ready because:

- G1 needs full release-cycle stability proof
- G2 needs multi-PR tracked-wallet stability proof
- G3 needs three qualifying dashboard-touching PRs without DTO shape changes
- G4 needs successful production-like operator-run evidence
- this reference itself must be reviewed and kept domain-neutral

## 12. Recommended next step

- If operator access is ready: run and record the G4 manual operator checklist.
- If operator access is not ready: keep this reference as docs-only and wait for G1-G4 evidence before creating any template folder.
