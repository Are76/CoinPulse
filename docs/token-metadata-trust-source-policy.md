# CoinPulse V1 Token Metadata Trust and Source Policy

## Purpose

This document defines the CoinPulse V1 token metadata trust and source vocabulary before any stronger token identity, origin, bridge, native PnL, or analytics UI work is implemented.

The policy is documentation-only. It does not change the current database schema, Prisma models, backend DTOs, pricing behavior, PnL behavior, API routes, tests, or frontend UI. It provides the target vocabulary and guardrails that later bounded implementation PRs must use when they add stronger token metadata contracts.

## Scope

In scope:

- Token metadata source kinds.
- Token metadata trust/status vocabulary.
- Required provenance fields for metadata-bearing backend records or DTOs.
- Conflict and rejection handling policy.
- UI guardrails for displaying metadata without inventing trust.
- Relationship to the current `metadataProvenance` dashboard surface.

Out of scope:

- Token origin implementation.
- Bridge attribution.
- Native-denominated PnL.
- Pricing logic or peg validation.
- New frontend UI.
- Ethereum/Base execution support.
- Schema, DTO, route, service, or test changes.

## Definitions

Token metadata includes descriptive fields such as decimals, symbol, name, display label, registry labels, and any future backend-provided origin/bridge/native/wrapped hints. Metadata is not accounting identity.

Token identity for accounting must remain backend-owned and must not be derived from symbol, name, stablecoin branding, or frontend heuristics.

## Source types

Future backend metadata records or DTOs that expose metadata provenance should use the following source type vocabulary.

| Source type | Meaning | Expected trust posture |
| --- | --- | --- |
| `rpc_observed` | Metadata observed directly from chain/RPC reads or equivalent chain execution data. | Useful evidence, but not inherently verified. Chain-observed metadata can be spoofed by token contracts and can be stale or incomplete. |
| `seed_data` | Metadata imported from repository-managed seed data or deployment-time curated inputs. | Deterministic and reviewable, but only as trustworthy as the seed review process and import timestamp. |
| `manual_override` | Operator-entered or maintainer-entered correction that intentionally supersedes lower-trust evidence. | Potentially high confidence only when provenance records the operator/source reference and reason. |
| `trusted_registry` | Metadata imported from an explicitly allowlisted registry or canonical backend registry integration. | Candidate for verified status when the registry, asset identity, chain, and import timestamp are recorded. |
| `derived_internal` | Metadata derived by CoinPulse backend logic from canonical internal state, deterministic transforms, or previously materialized truth. | Trust depends on the source inputs and derivation rule; must not hide the underlying evidence. |
| `unknown` | Source is absent, unavailable, unsupported, or not mapped into a known source kind. | Safe default. Must not be promoted by the frontend. |

## Metadata statuses

Future backend metadata records or DTOs that expose metadata trust should use the following status vocabulary.

| Status | Meaning | UI posture |
| --- | --- | --- |
| `unknown` | No usable metadata evidence is available, or available evidence is insufficient to classify. | Display as unknown or unavailable. Do not infer a label, origin, bridge, native/wrapped state, price, or peg. |
| `observed` | Metadata was observed from a source such as RPC but has not been independently verified. | Display as observed/provisional metadata when useful. Do not treat as identity truth. |
| `seeded` | Metadata came from deterministic seed data. | Display with seed provenance. Do not treat as verified unless backend separately marks it verified. |
| `manual` | Metadata came from a manual override. | Display with manual provenance and reason where available. Do not hide that it is an override. |
| `verified` | Metadata passed the backend's configured verification criteria for the relevant source and field. | Display as backend-verified metadata. This still does not make symbol/name accounting identity. |
| `stale` | Metadata source or observation is older than the applicable stale threshold, or the backend cannot confirm freshness. | Display stale state and freshness. Do not silently fall back to stale values as current truth. |
| `conflict` | Two or more metadata sources disagree in a way the backend cannot safely resolve under the current policy. | Display conflict status and backend reason. Do not resolve in the frontend. |
| `rejected` | Metadata evidence was explicitly rejected by backend policy, validation, or operator review. | Display rejection only if useful and safe. Do not use rejected values as fallback metadata. |

## Required provenance

Any future backend table, service output, DTO, or UI-facing contract that exposes token metadata trust should preserve enough provenance for deterministic review and operator debugging.

Required fields:

- **Source kind:** one of the source types defined in this policy.
- **Source reference:** source-specific identifier such as RPC method/contract address, seed file/version, registry name and record id, manual ticket/operator reference, or internal derivation rule/version.
- **Observed/imported timestamp:** when the evidence was observed from the source or imported into CoinPulse.
- **Confidence:** backend-assigned confidence value or enum. Unknown confidence must remain explicit rather than being coerced to low, medium, high, or zero.
- **Stale threshold where relevant:** the maximum acceptable age for sources whose freshness affects correctness or operator interpretation.
- **Conflict/rejection reason:** stable backend-provided reason when status is `conflict` or `rejected`.

Recommended implementation notes for future PRs:

- Preserve raw source evidence separately from normalized display metadata where possible.
- Preserve timestamps even when metadata values are null or unknown.
- Prefer additive, versioned DTO changes over mutating existing semantics silently.
- Keep confidence semantics backend-owned and documented with the DTO that exposes them.

## Conflict policy

Conflicts must be resolved, rejected, or surfaced by backend policy. The frontend must never resolve metadata conflicts.

### Decimals conflicts are high-risk

Decimals affect balance formatting, quantity interpretation, valuation presentation, and downstream analytics. If credible sources disagree on decimals for the same backend asset identity, the backend must treat the conflict as high-risk.

Required behavior for future implementation:

- Preserve the conflicting source references and observed/imported timestamps.
- Prefer `conflict` or `rejected` over guessing.
- Avoid formatting or valuation behavior that implies false precision.
- Require explicit backend policy or operator action before promoting a conflicted decimals value to trusted use.

### Symbol/name conflicts are display-risk

Symbols and names are display metadata. They are not accounting identity and can collide, change, or be spoofed.

Required behavior for future implementation:

- Surface symbol/name conflicts as display-risk, not ledger-risk by default.
- Do not use symbol/name to join assets, infer prices, infer stablecoin status, or infer bridge/native identity.
- Prefer backend-provided labels with explicit provenance over frontend formatting rules.

### Origin/bridge conflicts default to unknown

Future token origin, native/wrapped, and bridge attribution work must default to `unknown` when sources conflict or when provenance is incomplete.

Required behavior for future implementation:

- Do not infer origin from symbol prefixes, names, icons, contract similarities, stablecoin branding, or route labels.
- Do not display bridge/native/wrapped labels unless the backend status and provenance support them.
- Preserve conflict reasons so operators can audit why attribution was withheld.

### Frontend conflict handling

The frontend may display backend-provided status, source, freshness, confidence, and reason fields. It must not:

- select a winning source;
- downgrade a conflict to observed metadata;
- convert unknown/conflict/rejected into display confidence;
- substitute symbol, name, or branding for backend identity;
- hide uncertainty behind zeroes, empty labels, or optimistic badges.

## UI guardrails

All frontend surfaces that display token metadata must follow these guardrails once backend DTOs expose this policy vocabulary:

- No frontend metadata trust inference.
- No symbol/name as identity.
- No stablecoin branding as price, peg, or redeemability proof.
- No bridge/native/wrapped labels unless backend status supports them.
- Unknown is safer than invented confidence.
- Preserve backend-provided metadata statuses, source kinds, timestamps, confidence, stale thresholds, conflict reasons, and rejection reasons.
- Do not compute balances, prices, PnL, LP values, stake values, origin, bridge attribution, or native/wrapped state from metadata display fields.
- Do not use DexScreener, icons, token lists, or third-party display labels as frontend truth.

## Relationship to current implementation

CoinPulse currently exposes dashboard token `metadataProvenance` as a display/provenance aid. It is not a complete token identity, origin, bridge, native/wrapped, pricing, or analytics trust contract.

Current implementation relationship:

- Existing `metadataProvenance` is display/provenance only.
- Existing dashboard metadata provenance does not implement token origin.
- Existing dashboard metadata provenance does not implement bridge attribution.
- Existing dashboard metadata provenance does not prove native/wrapped status.
- Existing dashboard metadata provenance does not prove stablecoin peg, price quality, redeemability, or PnL coverage.
- This policy does not change schema, DTOs, pricing, PnL, routes, tests, or UI.

Future implementation PRs may map the existing dashboard vocabulary onto this policy, but they must do so as explicit backend DTO/API contract work with tests. Until then, this document is only the policy reference for later slices.

## Later references

The following planning and architecture documents should consider referencing this policy in future documentation-only PRs or when related implementation work begins:

- `docs/data-fetching-architecture.md`, for DTO provenance and frontend display guardrails.
- `docs/dashboard-data-quality-audit.md`, for dashboard metadata quality limitations and provenance gaps.
- `docs/pnl-status-coverage-audit.md`, for the recommended V1 sequence before richer analytics and native PnL.
- `docs/pnl-coverage-dto-plan.md`, for ensuring PnL coverage remains separate from token metadata trust.
- Any future token identity/origin plan, bridge/source coverage plan, pricing-status plan, or analytics UI plan.

## Recommended next bounded PR

After this policy lands, the next bounded PR should remain documentation-only: add a token identity/origin metadata plan that references this policy and defines the backend-owned identity, origin, native/wrapped, and bridge-attribution questions that must be answered before any schema, DTO, pricing, PnL, route, or UI implementation begins.
