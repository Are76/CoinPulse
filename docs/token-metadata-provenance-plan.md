# Token Metadata Provenance and Status DTO Plan

## 1. Purpose

Token identity contract work has established that token symbols and names are not identity and that chain/address-safe asset handling must remain intact. The next bounded step is to plan explicit token metadata provenance and status before adding schema fields, DTO fields, route behavior, UI indicators, or analytics that depend on metadata trust.

Token metadata provenance is needed because `symbol`, `name`, and `decimals` affect display, normalization, pricing interpretation, PnL inputs, and operator trust, but they are not accounting identity. A same-symbol token can be a different contract, a wrapped token, an LP token, a bridge representation, or a spoofed asset. Decimals are especially sensitive because a wrong value can mis-scale quantities before valuation or PnL ever sees them.

This plan is documentation-only. It does not change source code, tests, schema, routes, package files, pricing logic, PnL formulas, dashboard UI, query hooks, API clients, or dependencies.

Explicit metadata provenance/status should be planned before implementing origin classification, bridge attribution, native-denominated PnL, or richer analytics. Those future features must not infer trust from display metadata.

## 2. Current state

### Current token metadata fields

The current Prisma schema stores token identity and metadata in `Token`:

- `chainId`
- `address`
- `addressLower`
- `assetId`
- `symbol`
- `name`
- `decimals`
- `decimalsSource`
- `isNative`
- `isIgnored`

`Token` currently enforces uniqueness on `[chainId, addressLower]` and uniqueness on `assetId`. This means the persisted token record is already contract-address and chain scoped, while `symbol`, `name`, and `decimals` are stored as metadata on that chain/address-scoped record.

The schema also has `TokenMetadataSource`, which currently stores source observations per token:

- `tokenId`
- `sourceKind`
- `sourceRef`
- `decimals`
- `symbol`
- `name`
- `observedAt`
- `createdAt`

The current `TokenMetadataSourceKind` values are schema-defined source kinds. Current sync code writes RPC-observed ERC-20 metadata with `sourceKind: "RPC"`, `sourceRef` set to the normalized token address, and the observed `decimals`, `symbol`, and `name`.

Current native/core asset constants define PulseChain native PLS as `chain:369:native:PLS` with the zero address placeholder, symbol `PLS`, and 18 decimals. They also define pHEX as an ERC-20 asset ID built from the PulseChain chain ID and pHEX contract address, with symbol `pHEX` and 8 decimals.

### Where metadata is used today

Current sync, materialization, dashboard, pricing, PnL, and API surfaces use token metadata in these actual ways:

- **Sync metadata resolution:** `resolveTokenMetadata()` normalizes token addresses to lowercase, looks up existing tokens by `[chainId, addressLower]`, reads ERC-20 `decimals`, `symbol`, and `name` from the chain when the token is missing, builds `assetId` as `chain:<chainId>:erc20:<addressLower>`, writes `Token` fields, and upserts a matching `TokenMetadataSource` RPC observation.
- **Raw sync snapshots:** transfer, LP, and stake sync paths preserve `assetIdSnapshot` and decimals snapshots so downstream normalization has the asset ID and quantity-scaling metadata available from ingestion time.
- **Canonical ledger:** ledger entries store `chainId`, optional `tokenId`, `assetId`, normalized `quantity`, direction, occurrence/source-log metadata, and dedupe keys. Ledger identity and grouping are asset/chain based, not symbol based.
- **Materialized dashboard token balances:** `PortfolioTokenBalance` stores `chainId`, `assetId`, optional `assetAddress`, `balanceQuantity`, optional `decimals`, and block-range metadata. It does not currently store a first-class metadata status DTO.
- **Dashboard token rows:** `DashboardTokenPositionDto` exposes `assetId`, `assetAddress`, `balanceQuantity`, `decimals`, block metadata, pricing, valuation, and PnL. It does not currently expose `symbol`, `name`, `tokenMetadata`, `metadataStatus`, or `metadataSource`.
- **LP and stake rows:** LP rows carry LP and underlying asset IDs/addresses. Stake rows carry token asset ID/address and quantities. Neither row type currently exposes token metadata provenance/status.
- **Pricing observations:** `PriceObservation` stores `chainId`, `assetId`, optional `assetAddress`, quote asset, price, source type/source ID, route metadata, liquidity, confidence, observed time, block number, and staleness window. Pricing resolution filters by `chainId`, `assetId`, and `quoteAsset`, not by token symbol/name.
- **PnL:** dashboard PnL uses asset IDs passed into the average-cost engine. Existing PnL status/coverage fields describe price, basis, unsupported, and coverage states, but they do not currently include token metadata provenance/status.
- **API route contract:** dashboard route tests assert that same-symbol different-contract token positions remain separate and keep their own decimals, pricing, and valuation rows.

No current backend DTO exposes a complete token metadata provenance object. No current frontend contract should infer that observed `symbol`, `name`, or `decimals` are verified.

## 3. Metadata provenance rules

The following rules are non-negotiable for future implementation:

1. **`symbol`, `name`, and `decimals` are metadata, not identity.** They must never be used as uniqueness, cache identity, ledger grouping, pricing grouping, PnL grouping, bridge identity, or analytics identity.
2. **Contract identity is `chainId + normalized address`.** ERC-20-like contract identity must remain chain-scoped and address-normalized. Existing `assetId` strings may represent that identity, but symbol/name must not substitute for it.
3. **Metadata source must be backend-owned.** Metadata trust, status, conflicts, refresh time, and confidence must be computed by backend services from persisted/backend-owned evidence, not inferred by UI components.
4. **Frontend must not infer metadata trust.** The frontend may render backend-provided metadata/status fields after they exist, but it must not decide that a token is verified, stale, conflicting, or safe based on symbol/name/decimals alone.
5. **Unknown is safer than guessed.** Missing metadata must be represented as `unknown`/`null` rather than guessed from symbols, price pairs, external labels, or UI heuristics.
6. **Conflicting metadata must be represented explicitly.** If sources disagree on `symbol`, `name`, or `decimals`, the DTO must expose a conflict status/reason instead of silently choosing one without provenance.
7. **Stale metadata must be visible if it can affect valuation/display.** If a future refresh policy determines metadata is stale, the backend must expose that status where stale metadata affects display, normalization, valuation interpretation, or operator trust.
8. **Decimals changes are high-risk.** A decimals conflict or change must not be silently resolved because quantity scaling, valuation, and PnL can be materially wrong.

## 4. Proposed future DTO shape

A future PR should add backend-computed, additive DTO fields only after contract tests define expected behavior. The project currently uses object-shaped dashboard DTOs with explicit status strings and ISO timestamps. A compatible future token metadata object could be:

```ts
tokenMetadata: {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  metadataStatus: "verified" | "observed" | "conflicting" | "stale" | "unknown";
  metadataSource: "chain" | "scanner" | "manual" | "derived" | "unknown";
  observedAt: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
  conflictReason: string | null;
}
```

Placement should remain additive and backend-owned. The first likely consumers are token dashboard rows and any future token identity/origin DTO. LP and stake DTOs may need separate metadata objects for the LP token, underlying tokens, and staked token, but that should be planned in separate bounded slices to avoid mixing LP semantics with basic token metadata provenance.

Possible project-style refinements for implementation review:

- Use `metadataStatus` instead of a generic `status` field to avoid ambiguity with pricing, valuation, PnL, materialization, and ledger coverage statuses.
- Use `observedAt` as an ISO string or `null`, matching existing DTO timestamp conventions.
- Keep `confidence` as a small status vocabulary rather than a number unless there is a documented scoring model.
- Keep `metadataSource` at the status/source-family level; more detailed source IDs can be added later if contract tests require them.

## 5. Status rules

Future backend status computation should be conservative:

- **`verified`:** only when the backend has high-confidence persisted evidence from an approved source or reconciliation policy. It must not mean merely "has a symbol".
- **`observed`:** metadata exists, but the backend cannot strongly verify it. Current RPC-observed metadata would be closer to `observed` than `verified` unless a future policy says otherwise.
- **`conflicting`:** two or more backend-owned sources disagree on `symbol`, `name`, or `decimals`, or the current persisted token fields disagree with trusted source observations.
- **`stale`:** metadata has not been refreshed or validated according to a future backend policy, especially when stale metadata can affect display, quantity interpretation, valuation interpretation, or operator decisions.
- **`unknown`:** metadata is missing or not safe to expose as observed/verified. Unknown fields should be `null` rather than guessed.
- **Decimals conflict:** any decimals conflict should mark the asset high-risk, should produce an explicit status/reason, and must not silently resolve to one value without surfacing provenance.

## 6. Relationship to existing systems

- **Canonical ledger:** Ledger entries remain accounting truth. Metadata provenance must not redefine ledger identity, ledger quantities, entry grouping, or dedupe behavior. Future metadata status may explain display/normalization risk, but it must not make symbol/name an accounting key.
- **Raw audit snapshots:** Raw snapshots and decimals snapshots are evidence points. Future provenance should preserve observed metadata and timestamps rather than overwriting away disagreement.
- **Sync normalization:** Sync currently normalizes ERC-20 identity by chain/address and writes RPC metadata. Future normalization should continue to produce deterministic asset IDs and should add status/provenance only from backend-owned evidence.
- **Dashboard token rows:** Token rows currently expose asset ID, address, balance, decimals, pricing, valuation, and PnL. Future token metadata provenance should be passed through as an additive backend DTO field, with no frontend inference.
- **Pricing observations:** Pricing already resolves by `chainId`, `assetId`, and quote asset. Metadata provenance must not allow pricing to merge same-symbol assets or prefer a price because two tokens share a display symbol.
- **PnL cost basis:** PnL inputs must continue to use ledger entries and asset IDs. Metadata provenance may surface risk warnings in future coverage/status DTOs, but PnL must not merge or split positions based on symbol/name.
- **`pnlCoverage`:** Existing PnL coverage describes valuation, partial, unavailable, unsupported, stale price, source-disabled, and related states. A future metadata risk should be added deliberately if it affects PnL interpretation; it should not be conflated with price availability.
- **Token identity/origin plan:** This plan builds on token identity rules by defining how display metadata should be trusted, not by introducing origin classification. Origin fields should wait until metadata provenance exists.
- **Future bridge attribution:** Bridge attribution must distinguish native, wrapped, bridged, and copied assets by backend-owned identity/origin evidence. It must not assume two same-symbol tokens are equivalent.
- **Future native PnL:** Native-denominated PnL needs reliable asset identity, historical price evidence, and metadata provenance. It should remain deferred until metadata trust and status contracts are explicit.

## 7. Contract test plan

Future contract tests should be added before implementation and should cover:

- `symbol` and `name` do not define token identity.
- Same-symbol different-contract metadata remains separate by chain/address/asset ID.
- Decimals are preserved per asset and passed through without symbol-based merging.
- Conflicting decimals are represented explicitly and are not silently ignored.
- Unknown metadata is represented as `metadataStatus: "unknown"` with nullable metadata fields.
- Dashboard DTOs pass metadata provenance through from backend services without frontend inference.
- Pricing and PnL do not merge assets based on symbol, name, or decimals metadata.
- Existing same-symbol route/service contract tests remain valid after metadata DTO fields are added.

## 8. Known risks

- **Symbol collision:** Multiple unrelated contracts can share the same symbol.
- **Fake token names/symbols:** Malicious contracts can mimic trusted display names.
- **Decimals spoofing or mistakes:** Wrong decimals can mis-scale quantities and materially affect valuation/PnL interpretation.
- **Scanner/chains disagreeing:** Scanner labels, chain RPC metadata, manual overrides, and derived labels may disagree.
- **Stale metadata:** Old observations may no longer reflect current contract behavior or operator expectations.
- **LP token metadata vs underlying token metadata:** LP token metadata is distinct from the metadata of token0/token1 underlyings and must not be collapsed.
- **Bridge/wrapped token confusion:** Native, wrapped, bridged, and copied tokens can share similar symbols/names while representing different assets.
- **Frontend display treating observed as verified:** UI labels can accidentally imply trust if they do not render backend status clearly.

## 9. Recommended implementation sequence

Future PRs should remain small, additive, and ordered:

1. Audit current token metadata fields and all source points, including `Token`, `TokenMetadataSource`, sync reads, raw snapshots, materialized balances, dashboard DTOs, pricing observations, and route contracts.
2. Add token metadata provenance contract tests that encode same-symbol, different-contract, unknown, stale, and conflicting-decimals behavior.
3. Add additive backend DTO fields if current DTOs lack them, without changing pricing, PnL formulas, or frontend inference.
4. Add backend metadata status computation as unknown-first and observed/verified only when backend-owned evidence supports it.
5. Expose conflicts and staleness only from persisted/backend-owned evidence, not live frontend checks or display heuristics.
6. Render a small metadata status indicator only after the backend DTO exists and the UI can pass through backend-provided status without computing trust.
7. Defer origin classification, bridge attribution, and native PnL until metadata provenance/status DTOs and tests exist.

## 10. Non-goals

This plan explicitly does not include:

- code changes;
- test changes;
- schema changes;
- route/API changes;
- package file changes;
- dependency changes;
- pricing logic changes;
- PnL formula changes;
- dashboard UI changes;
- token origin implementation;
- bridge classifier implementation;
- external provider integration;
- Ethereum/Base expansion;
- native PnL implementation.

## 11. Decision

Metadata provenance must be backend-owned.

Unknown or conflicting metadata is safer than guessed metadata.

DTO contracts should come before UI rendering.

Origin classification, bridge attribution, and native PnL should come later, after metadata provenance/status contracts exist.
