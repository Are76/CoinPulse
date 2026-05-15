# CoinPulse V1 Token Identity and Origin Metadata Plan

## 1. Purpose

CoinPulse V1 is PulseChain-first and backend-truth-first. The next analytics work must make token identity and origin metadata explicit before native PnL, bridge attribution, richer analytics, or multi-chain expansion are planned or implemented.

Token identity is a prerequisite because PnL, pricing, ledger grouping, materialized balances, bridge attribution, and analytics all depend on knowing exactly which asset is being discussed. Symbols and names are useful display metadata, but they are unsafe as accounting keys because the same symbol can exist on multiple contracts, multiple chains, and multiple token variants. Origin metadata is also needed before bridge or native-vs-wrapped analytics can be represented without guessing.

This PR is documentation-only. It adds this plan and intentionally does not change source code, tests, schema, routes, package files, pricing logic, PnL formulas, dashboard UI, query hooks, or API clients.

## 2. Current state

### Current token identity in schema and code

The current schema already stores token records with explicit chain and address fields:

- `Token.chainId`
- `Token.address`
- `Token.addressLower`
- `Token.assetId`
- `Token.symbol`
- `Token.name`
- `Token.decimals`
- `Token.decimalsSource`
- `Token.isNative`

The `Token` model enforces uniqueness on `[chainId, addressLower]` and also makes `assetId` unique. In current sync code, ERC-20 token metadata resolution builds `assetId` as `chain:${chainId}:erc20:${addressLower}` after normalizing the token address to lowercase. The same sync path persists RPC-observed `symbol`, `name`, and `decimals` as metadata, not as the identity key.

The current native PulseChain asset has an explicit deterministic asset identifier in `src/config/assets.ts`: `chain:369:native:PLS`. It also uses the zero address constant `0x0000000000000000000000000000000000000000` as the current native token address placeholder. This is distinct from ERC-20 asset IDs such as `chain:369:erc20:<address>`.

Current practical identity is therefore:

- ERC-20 token identity: `chainId + normalized contract address`, represented in many persisted and DTO paths through `assetId` values shaped like `chain:<chainId>:erc20:<lowercase-address>`.
- Native coin identity: a deterministic native asset identifier such as `chain:369:native:PLS`, not a symbol-only key.

### Where token metadata currently appears

Current token and asset metadata appears in these actual surfaces:

- **Token schema:** `Token` stores chain, address, lowercase address, asset ID, display metadata, decimals, decimals source, native/ignored flags, and relations to metadata sources, flags, raw transfers, and ledger entries.
- **Token metadata provenance:** `TokenMetadataSource` stores `sourceKind`, `sourceRef`, `decimals`, optional `symbol`, optional `name`, `observedAt`, and `createdAt` for a token.
- **Raw and sync snapshots:** sync paths persist token address, asset ID snapshots, and decimals snapshots for transfers, swaps, LP actions, and stake actions before normalization.
- **Canonical ledger:** `LedgerEntry` stores `chainId`, optional `tokenId`, `assetId`, normalized `quantity`, `entryType`, `direction`, `occurredAt`, source log metadata, and dedupe data. Ledger entries do not currently expose a first-class token identity object.
- **Materialized token balances:** `PortfolioTokenBalance` stores `chainId`, `assetId`, optional `assetAddress`, `balanceQuantity`, optional `decimals`, and materialized block range metadata.
- **Materialized LP positions:** `PortfolioLpPosition` stores an LP asset ID/address plus optional token0/token1 asset IDs and addresses. This separates LP token identity from underlying token identities, but does not yet expose a richer origin model.
- **Materialized stake positions:** `PortfolioStakePosition` stores `tokenAssetId`, optional `tokenAddress`, quantities, status, and block fields.
- **Dashboard DTO:** token position DTOs expose `assetId`, `assetAddress`, `decimals`, pricing, valuation, and PnL. LP and stake DTOs expose their own asset IDs/addresses, but no `tokenIdentity` or `tokenOrigin` object exists today.
- **Pricing observations:** `PriceObservation` stores `chainId`, `assetId`, optional `assetAddress`, quote asset, source type, source ID, confidence, `observedAt`, staleness, route metadata, and optional metadata. Pricing is keyed by `chainId`, `assetId`, and quote asset in resolver logic.
- **Pricing status endpoint:** `GET /api/prices/status` reports source health for PulseChain pricing observations by source type. It does not currently report per-token identity or origin metadata.
- **PnL engine:** PnL inputs and warnings use `chainId` and `assetId`. The current average-cost engine does not use symbol or name as accounting identity.

Current docs already prohibit symbol-based accounting identity. `docs/data-fetching-architecture.md` states that frontend pages must not treat token symbols as asset identity, and `docs/pnl-accounting-guardrails.md` states that symbols are display metadata only.

## 3. Identity rules

The following rules are non-negotiable for future implementation:

1. **Token identity must be `chainId + normalized contract address`.** For ERC-20-like assets, the canonical contract address must be normalized before it is used in persisted identity, query keys, ledger grouping, pricing lookup, PnL lookup, or analytics grouping.
2. **Symbol/name alone must never be identity.** `symbol` and `name` are display metadata only. They must not be used as database uniqueness, cache identity, PnL identity, pricing identity, bridge identity, or analytics identity.
3. **Native coin identity must be explicit.** Native PLS must use a deterministic native identity and must not be confused with wrapped PLS or native-like ERC-20 contracts. A zero-address placeholder can be display or compatibility metadata only when the backend contract defines that convention.
4. **Checksummed/display address is UI metadata, not canonical identity.** The canonical identity must use a normalized address. Any checksummed address can be rendered for users, but must not replace canonical normalized storage identity.
5. **Decimals are token metadata.** Decimals must be read from a trusted backend metadata path and carried with provenance/status. They must not be guessed from symbol, name, or token category.
6. **Same symbol across chains/contracts means different assets unless explicitly mapped.** A symbol collision across chains, contracts, native assets, wrapped assets, bridged assets, LP tokens, or synthetic assets must remain separate unless a backend-owned mapping explicitly and safely relates them.
7. **LP token identity is not underlying-token identity.** An LP token contract must be represented as its own asset identity. Its underlying token identities must be separate fields or nested metadata, not collapsed into the LP identity.
8. **Stake identity must not erase token identity.** A stake position can have a stake key/protocol key and a staked token identity. Those are related but not interchangeable.

## 4. Origin metadata concepts

Future token origin metadata should use explicit, descriptive statuses. These statuses describe what the backend knows about an asset's origin; they are not valuation claims, safety claims, liquidity claims, or trust guarantees.

- **`native`** — the chain's native coin, such as PulseChain PLS, represented through an explicit native asset identity rather than an ERC-20 contract identity.
- **`bridged`** — an asset whose current chain representation is associated with a source-chain asset through bridge evidence or trusted metadata.
- **`wrapped`** — an ERC-20 or ERC-20-like representation of a native coin or another asset on the same chain or another chain.
- **`canonical`** — the backend's current canonical representation for an asset within a defined chain or ecosystem context, supported by explicit metadata policy.
- **`synthetic`** — an asset that tracks or represents another asset without being the same contract/native asset, where the relationship is metadata only unless ledger evidence supports stronger claims.
- **`unknown`** — the backend does not have enough trusted evidence to classify origin. This must be the default for unclassified assets.

Origin metadata must not imply price equivalence, peg stability, bridge solvency, redemption guarantees, or accounting fungibility. For example, a bridged stablecoin or pDAI-like token must not be assumed to equal $1 or to equal another same-symbol token without backend price observations and explicit metadata provenance.

## 5. Proposed future DTO/schema shape

A future PR should add identity and origin fields additively, after current fixtures and contracts are audited. Names can be adjusted to match final project style, but the shape should preserve the separation between identity and origin.

Example future DTO shape:

```ts
tokenIdentity: {
  chainId: number;
  contractAddress: string | null;
  tokenType: "native" | "erc20" | "lp" | "stake" | "unknown";
}

tokenOrigin: {
  status: "native" | "bridged" | "wrapped" | "canonical" | "synthetic" | "unknown";
  sourceChainId: number | null;
  sourceContractAddress: string | null;
  bridgeName: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
  reason: string | null;
}
```

Potential project-specific adjustments:

- Keep existing `assetId` fields during migration for compatibility, but add a structured `tokenIdentity` object beside them rather than silently changing current DTO fields.
- Use `assetIdentity` instead of `tokenIdentity` if the field must cover LP tokens, stake receipt positions, native assets, and future non-ERC-20 assets.
- Use `origin` or `assetOrigin` instead of `tokenOrigin` if the metadata applies beyond fungible ERC-20 tokens.
- Keep source-chain and bridge fields nullable until evidence exists. `unknown` with null details is preferable to invented classification.

If schema changes are later proposed, they should be additive and should preserve deterministic rebuildability. No schema change is made by this documentation PR.

## 6. Required provenance

Future token metadata must expose provenance and status clearly enough that the frontend never has to infer truth from symbol, address shape, or display text.

Required future provenance fields or equivalents:

- **Source of metadata:** for example seed data, RPC, manual operator override, token list, bridge registry, or internal classifier.
- **Observed/imported timestamp:** `observedAt`, `importedAt`, or both, depending on whether the value was observed from chain/provider state or imported from a maintained list.
- **Confidence:** a backend-owned confidence status such as `high`, `medium`, `low`, or `unknown`.
- **Stale/unknown handling:** explicit status and reason when metadata is stale, absent, unsupported, or not yet classified.
- **Conflict handling:** rejection or conflict reason when sources disagree on decimals, symbol, name, origin, bridge, or source-chain mapping.

Existing `TokenMetadataSource` already records source kind, source reference, decimals, optional symbol/name, and observed time. Future metadata work should extend the same provenance discipline instead of replacing it with frontend inference.

## 7. Relationship to existing systems

### Ledger entries

Canonical ledger entries are accounting truth. Future identity metadata should make each ledger asset identity explicit without changing the ledger's role as the source of accounting truth. Ledger rows currently carry `chainId`, optional `tokenId`, and `assetId`; future structured identity can be derived from or linked to these fields, but it must not reinterpret ledger entries by symbol.

Origin metadata should not rewrite historical ledger events. If bridge/source attribution is later added, it must be supported by ledger evidence, raw data, or trusted backend metadata and must preserve deterministic rebuildability.

### Pricing observations

Pricing observations currently use `chainId`, `assetId`, optional `assetAddress`, quote asset, source type, source ID, confidence, `observedAt`, staleness, and optional metadata. Future token identity should align pricing lookup with the same chain-safe identity rules. Origin metadata must not imply price equivalence; a bridged asset still needs its own pricing observations or explicit backend-supported route logic.

### PnL cost basis

The average-cost PnL engine currently groups by `chainId` and `assetId`. Future identity fields must preserve that discipline. Same-symbol assets must not share cost basis unless a future backend rule explicitly maps them and proves the accounting semantics are safe. Native PnL must remain deferred until historical native price coverage and event-level provenance are available.

### `pnlCoverage`

`pnlCoverage` is observability metadata. Future token identity/origin fields can help explain why PnL is unavailable, unsupported, incomplete, or unknown, but they must not make unsupported assets appear valued. Unknown origin should be reflected as a metadata limitation, not filled in by frontend assumptions.

### Materialization freshness

Materialized portfolio state is derived from canonical ledger truth. Token metadata freshness should be separate from materialization freshness, but both should be visible when they affect dashboard confidence. A fresh materialization does not prove token metadata or origin metadata is fresh.

### `ledgerCoverage`

`ledgerCoverage` describes the persisted ledger block range backing materialized dashboard state. Future origin metadata should not exceed ledger coverage claims. Bridge attribution, source-chain attribution, or origin classification should report `unknown` or low confidence when the ledger/raw evidence is incomplete.

### Pricing status endpoint

`GET /api/prices/status` currently reports source-level pricing health, not per-token identity/origin coverage. Future pricing status work could add per-asset coverage or identity-aware diagnostics, but should remain backend-owned and status-first. It must not imply that a healthy pricing source has complete origin metadata.

### Wallet import and tracked wallets

Wallet import and tracked wallet flows are chain-scoped. Future token metadata should remain chain-scoped as well. Importing or tracking a wallet must not create symbol-based assumptions about the assets it holds; asset identity should be discovered and persisted through backend ingestion/materialization paths.

### Future bridge attribution

Bridge/source attribution should come after identity and provenance are explicit. A future bridge classifier must be unknown-first, evidence-based, and additive. It should not classify assets by symbol, stablecoin branding, or frontend display names.

## 8. Known risks

- **Same symbol/different contract confusion:** two unrelated assets can share a symbol on the same chain or across chains.
- **Bridged assets mistaken for native assets:** bridged or wrapped tokens can look native-like in display text but have different contracts, risks, and price behavior.
- **pDAI/stablecoin assumptions:** pDAI and other stablecoin-labeled assets must not be hardcoded to $1 or treated as equivalent to another stablecoin by symbol.
- **Decimals mistakes:** incorrect decimals corrupt normalized quantities, balances, valuations, and PnL. Decimals must carry metadata source and conflict handling.
- **LP token identity vs underlying token identity:** LP token contracts are separate assets from token0/token1 and must not inherit their identity.
- **Stale metadata:** old metadata can become misleading after token migrations, proxy changes, list changes, or manual corrections.
- **Frontend inference from symbols:** UI logic that infers native/bridged/wrapped/stable identity from symbols would violate backend-truth rules.
- **Native PnL using current spot price without historical origin/price support:** native PnL requires historical event-aligned native price observations and provenance, not a current spot conversion.
- **Conflict between sources:** RPC, seed data, token lists, and manual overrides can disagree. Disagreements must produce explicit conflict/rejection metadata.
- **Cross-chain expansion before identity hardening:** adding Ethereum/Base or other chains before token identity is explicit would multiply symbol and bridge ambiguity.

## 9. Recommended implementation sequence

Each item should be a separate bounded future PR:

1. Audit current token metadata fields, seed data, generated fixtures, route fixtures, and contract tests for every place that uses `assetId`, `assetAddress`, `tokenAddress`, `symbol`, `name`, or `decimals`.
2. Add contract tests proving symbol is not identity for dashboard DTOs, pricing lookups, PnL grouping, and any future token metadata routes.
3. Add backend token identity DTO fields if missing, preferably as additive `tokenIdentity`/`assetIdentity` fields alongside existing `assetId` fields.
4. Add metadata provenance/status fields for identity and display metadata, including source, observed/imported time, confidence, stale handling, and conflict/rejection reason.
5. Add origin classification as unknown-first metadata. The first implementation should safely return `unknown` unless backend evidence supports a stronger status.
6. Add bridge/source attribution only when ledger evidence, raw data, or trusted backend metadata supports it without weakening deterministic rebuildability.
7. Only later plan or implement native PnL, after historical native price observations, origin/identity metadata, and event-level provenance are explicit.
8. Only later add richer analytics UI, and only from backend DTO fields that expose statuses, warnings, provenance, and coverage without frontend inference.

## 10. Non-goals

This documentation plan does not include:

- no code changes;
- no test changes;
- no schema changes;
- no route/API changes;
- no pricing logic changes;
- no PnL formula changes;
- no dashboard UI changes;
- no native PnL implementation;
- no bridge classifier implementation;
- no external provider integration;
- no Ethereum/Base expansion;
- no new dependencies;
- no package file changes.

## 11. Decision

Token identity must be explicit before analytics expand. The safe identity baseline is chain-safe backend identity: `chainId + normalized contract address` for ERC-20-like assets and an explicit deterministic identity for native coins.

Unknown origin is safer than invented origin. Origin metadata must default to `unknown` until backend-owned evidence supports a stronger classification.

Backend-owned metadata comes first, UI second. The backend must own token identity, origin, provenance, freshness, confidence, and conflict status before the frontend renders richer analytics or bridge/native PnL surfaces.
