# PulseChain Data Source Inventory

**Purpose:** Comprehensive inventory and classification of PulseChain ecosystem data sources relevant to CoinPulse.

**CoinPulse canonical truth remains:** PostgreSQL, backend DTOs, persisted observations, and persisted stake records. No external source classified here is canonical truth. All classifications describe ingestion, verification, or reference roles only.

**Research methodology:** Direct HTTP fetch of the three mandatory primary sources (`pulsechain.com/#/develop`, `g4mm4.io/endpoints-and-resources`, `data.pls-api.com/docs`) returned HTTP 403 in the research environment. All entries below were assembled from web search results, secondary sources, and cross-referencing. Where a source could not be directly confirmed, it is noted as "confirmed via secondary source" or "unconfirmed — direct inspection required."

**Research date:** 2026-06-13

---

## Section 1 — Source Inventory

### 1.1 Official PulseChain RPC (pulsechain.com)

| Field | Value |
|---|---|
| Name | PulseChain Official RPC |
| URL | `https://rpc.pulsechain.com` |
| WebSocket | `wss://rpc.pulsechain.com` |
| Source owner | PulseChain team |
| Category | RPC endpoint |
| Data available | Full Ethereum-compatible JSON-RPC: blocks, transactions, logs, balances, contract calls |
| Authentication | None (public) |
| Rate limits | Not publicly documented; shared public endpoint |
| Reliability notes | Primary official endpoint; confirmed as zero-failure in 2025 benchmarks; single point of failure if pulsechain.com infrastructure has issues |
| CoinPulse relevance | **Primary ingestion candidate** — current ingestion RPC; `observedAtBlock` provenance |

---

### 1.2 PulseChain BlockScout Explorer API (scan.pulsechain.com)

| Field | Value |
|---|---|
| Name | PulseChain BlockScout REST API |
| URL | `https://api.scan.pulsechain.com/api-docs` |
| JSON-RPC API | `https://api.scan.pulsechain.com/api/eth-rpc` |
| Explorer | `https://scan.pulsechain.com` |
| Source owner | PulseChain team (via BlockScout open source; GitLab: `gitlab.com/pulsechaincom/blockscout`) |
| Category | Explorer REST API + JSON-RPC |
| Data available | Accounts, blocks, transactions, tokens, smart contracts, search, stats; Ethereum-compatible RPC methods |
| Authentication | None (public) |
| Rate limits | Not publicly documented |
| Reliability notes | Etherscan-compatible API surface; REST modules documented; JSON-RPC subset only (not all methods supported); officially hosted by PulseChain team |
| CoinPulse relevance | **Primary ingestion candidate** — token transfers, raw transaction data, contract verification; alternative to direct RPC for indexed lookups |

---

### 1.3 PulseChain OtterScan Explorer (otter.pulsechain.com)

| Field | Value |
|---|---|
| Name | PulseChain OtterScan |
| URL | `https://otter.pulsechain.com` |
| Source owner | PulseChain team |
| Category | Explorer (Erigon-based) |
| Data available | Block explorer UI; Erigon-native trace data; internal transaction traces |
| Authentication | None (UI) |
| Rate limits | N/A (no public API documented) |
| Reliability notes | Erigon-based; provides richer trace data than standard explorers; no public programmatic API |
| CoinPulse relevance | **Explorer/debugging source** — manual trace inspection; not suitable for automated ingestion without API layer |

---

### 1.4 PulseChain Beacon Chain Explorer (beacon.pulsechain.com)

| Field | Value |
|---|---|
| Name | PulseChain Beacon Explorer |
| URL | `https://beacon.pulsechain.com` |
| Source owner | PulseChain team |
| Category | Beacon chain explorer (Proof-of-Stake consensus layer) |
| Data available | Validator statistics, epoch data, slot data, staking rewards (consensus layer only) |
| Authentication | None (UI) |
| Rate limits | N/A |
| Reliability notes | Confirmed in search results as accessible; testnet version at `beacon.v4.testnet.pulsechain.com`; consensus-layer data only — not execution layer |
| CoinPulse relevance | **Secondary verification candidate** — validator health; does not cover HEX staking or token-level data |

---

### 1.5 PulseChain Graph Node / Subgraph Infrastructure (graph.pulsechain.com)

| Field | Value |
|---|---|
| Name | PulseChain Graph Node |
| Base URL | `https://graph.pulsechain.com` |
| PulseX Subgraph (GraphiQL) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex` |
| PulseX Subgraph (GraphQL API) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` |
| Source owner | PulseChain team |
| Category | Graph node (self-hosted The Graph protocol) |
| Data available | DEX pair reserves, swap history, liquidity pool state, token metadata for PulseX v1 and v2 pools |
| Authentication | None (public GraphQL) |
| Rate limits | Not publicly documented |
| Reliability notes | Confirmed via search results (GraphiQL link indexed); PulseChain hosts its own Graph node rather than relying on The Graph decentralized network; subgraph list beyond PulseX not fully confirmed — direct inspection required |
| CoinPulse relevance | **Primary ingestion candidate** — on-chain reserve-derived pricing source; required for PulseX pair reserve pricing (CLAUDE.md architecture rule); HEX/WPLS and PLSX/WPLS pair data |

---

### 1.6 G4MM4 RPC Endpoint (g4mm4.io)

| Field | Value |
|---|---|
| Name | G4MM4 PulseChain RPC |
| HTTP URL | `https://rpc-pulsechain.g4mm4.io` |
| WebSocket URL | `wss://rpc-pulsechain.g4mm4.io` |
| Endpoints page | `https://www.g4mm4.io/endpoints-and-resources` |
| Source owner | G4MM4 (community infrastructure operator) |
| Category | RPC endpoint |
| Data available | Full Ethereum-compatible JSON-RPC |
| Authentication | None (public) |
| Rate limits | Not publicly documented |
| Reliability notes | Frequently cited as the most reliable community RPC for PulseChain; lower failure rate than official endpoint in multiple community benchmarks; G4MM4 is a recognized ecosystem infrastructure provider with validator metrics platform |
| CoinPulse relevance | **Primary ingestion candidate** — viable backup/alternative RPC; already referenced as `rpcEndpointLabel` in observation records |

---

### 1.7 G4MM4 OtterScan (otter-pulsechain.g4mm4.io)

| Field | Value |
|---|---|
| Name | G4MM4 OtterScan |
| Mainnet URL | `https://otter-pulsechain.g4mm4.io` |
| Testnet URL | `https://otter-testnet-pulsechain.g4mm4.io` |
| Source owner | G4MM4 |
| Category | Explorer (Erigon-based OtterScan) |
| Data available | Block explorer with Erigon internal transaction traces |
| Authentication | None (UI) |
| Rate limits | N/A |
| Reliability notes | G4MM4-hosted OtterScan; confirmed actively serving transaction and address data |
| CoinPulse relevance | **Explorer/debugging source** — manual debugging of ingestion discrepancies |

---

### 1.8 G4MM4 Validator / Beacon Statistics (g4mm4.io main)

| Field | Value |
|---|---|
| Name | G4MM4 Beacon / Validator Dashboard |
| URL | `https://www.g4mm4.io` |
| Source owner | G4MM4 |
| Category | Beacon chain analytics |
| Data available | Real-time PulseChain validator performance, staking metrics, network health, beacon chain data |
| Authentication | None (UI) |
| Rate limits | N/A |
| Reliability notes | Primary community validator monitoring resource |
| CoinPulse relevance | **Secondary verification candidate** — network health reference; not relevant for token-level ingestion |

---

### 1.9 data.pls-api.com

| Field | Value |
|---|---|
| Name | PLS Data API |
| URL | `https://data.pls-api.com` |
| Docs | `https://data.pls-api.com/docs` |
| Source owner | Unknown — not widely attributed in search results |
| Category | Data API (token prices, market data, on-chain DEX data) |
| Data available | Token prices, market data, on-chain DEX data (exact API groups not confirmed — direct inspection required) |
| Authentication | Unknown — not documented in available search results |
| Rate limits | Unknown |
| Reliability notes | Direct fetch returned 403; not widely documented in community sources as of 2026-06-13; ownership and SLA unclear; treat as unverified until direct inspection |
| CoinPulse relevance | **Unclassified — direct inspection required** before classification; could be pricing source or secondary verification candidate |

---

### 1.10 PublicNode RPC

| Field | Value |
|---|---|
| Name | PublicNode PulseChain RPC |
| HTTP URL | `https://pulsechain.publicnode.com` |
| WebSocket URL | `wss://pulsechain.publicnode.com` |
| Source owner | PublicNode (community infrastructure) |
| Category | RPC endpoint |
| Data available | Full Ethereum-compatible JSON-RPC |
| Authentication | None (public) |
| Rate limits | Not published |
| Reliability notes | Established public node infrastructure provider serving multiple chains |
| CoinPulse relevance | **Secondary verification candidate** — backup RPC option |

---

### 1.11 Moralis PulseChain API

| Field | Value |
|---|---|
| Name | Moralis Web3 Data API — PulseChain |
| URL | `https://docs.moralis.com/web3-data-api/evm/chains/pulsechain` |
| Chain ID | `0x171` (369 decimal) |
| Source owner | Moralis |
| Category | Managed Web3 data API |
| Data available | Token balances (`eth_getTokenBalances`), token prices (`eth_getTokenPrice`), wallet history, NFT data, RPC node access; PulseChain added January 2025 |
| Authentication | API key required |
| Rate limits | Tier-based (paid plans) |
| Reliability notes | Enterprise-grade SLA; adds abstraction layer over raw RPC; pricing data is derived from external sources (not guaranteed to be on-chain reserve-derived); added PulseChain relatively recently |
| CoinPulse relevance | **Secondary verification candidate** — could cross-check token balance ingestion; pricing endpoints must not be used as primary truth per CLAUDE.md rules |

---

### 1.12 CoinGecko PulseChain API

| Field | Value |
|---|---|
| Name | CoinGecko Pulsechain Data API |
| URL | `https://www.coingecko.com/en/api/pulsechain` |
| Source owner | CoinGecko |
| Category | Market data API |
| Data available | Token prices, market cap, DEX pairs (sourced from PulseX), liquidity pools, 24h volume; refreshed every 2–3 seconds for on-chain data; 120K+ PulseChain tokens |
| Authentication | API key (free tier available with rate limits; paid tiers for higher throughput) |
| Rate limits | Free tier limited; paid tiers for production use |
| Reliability notes | Widely used; on-chain DEX pair data sourced from PulseX reserves; not a canonical on-chain source (derived/aggregated) |
| CoinPulse relevance | **Market/pricing source** — not recommended as primary pricing truth per CLAUDE.md rules (DexScreener not permitted; CoinGecko similarly aggregated); acceptable as secondary cross-check |

---

### 1.13 DexScreener PulseChain

| Field | Value |
|---|---|
| Name | DexScreener PulseChain |
| URL | `https://dexscreener.com/pulsechain` |
| Source owner | DexScreener |
| Category | DEX analytics / market data |
| Data available | PulseX v1 and v2 pair data, price charts, volume, liquidity |
| Authentication | None (UI); API available (terms-restricted) |
| Rate limits | Public API rate-limited |
| Reliability notes | Aggregates on-chain data; useful for human reference but not recommended as pricing truth |
| CoinPulse relevance | **Not recommended** — CLAUDE.md explicitly prohibits DexScreener as primary pricing truth |

---

### 1.14 ChainList (PulseChain entry)

| Field | Value |
|---|---|
| Name | ChainList — PulseChain |
| URL | `https://chainlist.org/chain/369` |
| Source owner | DefiLlama / ChainList community |
| Category | Chain metadata registry |
| Data available | Official chain ID (369), RPC endpoint list, currency metadata |
| Authentication | None |
| Rate limits | N/A |
| Reliability notes | Community-maintained; authoritative for chain ID confirmation |
| CoinPulse relevance | **Explorer/debugging source** — chain configuration reference; not an ingestion source |

---

### 1.15 SubQuery PulseChain Indexer

| Field | Value |
|---|---|
| Name | SubQuery — PulseChain Indexer |
| URL | `https://thechaindata.com/indexer/369` |
| Source owner | SubQuery Network |
| Category | Multi-chain indexing platform |
| Data available | Custom indexed data via SubQuery framework; PulseChain data indexing available |
| Authentication | Depends on deployment |
| Rate limits | Depends on deployment |
| Reliability notes | Used by some PulseChain ecosystem projects; not a first-party PulseChain resource |
| CoinPulse relevance | **Secondary verification candidate** — alternative indexing for complex event queries; lower priority than native Graph subgraphs |

---

## Section 2 — Official PulseChain Infrastructure

All resources in this section are directly operated by or linked from the PulseChain team (pulsechain.com).

### 2.1 RPC Endpoints

| Endpoint | Type | URL | Notes |
|---|---|---|---|
| Official RPC | HTTP JSON-RPC | `https://rpc.pulsechain.com` | Primary; chain ID 369 |
| Official WebSocket | WebSocket | `wss://rpc.pulsechain.com` | Paired with above |
| Testnet v4 RPC | HTTP JSON-RPC | `https://rpc.v4.testnet.pulsechain.com` | Testing only |

### 2.2 APIs

| Resource | URL | Notes |
|---|---|---|
| BlockScout REST API | `https://api.scan.pulsechain.com/api-docs` | Full Swagger/OpenAPI docs |
| BlockScout JSON-RPC | `https://api.scan.pulsechain.com/api/eth-rpc` | Eth-compatible subset |
| BlockScout testnet v4 | `https://api.scan.v4.testnet.pulsechain.com/eth-rpc-api-docs` | Testing |

### 2.3 Explorers

| Resource | URL | Notes |
|---|---|---|
| BlockScout Explorer | `https://scan.pulsechain.com` | Primary execution layer explorer |
| OtterScan | `https://otter.pulsechain.com` | Erigon-native; richer trace data |
| Beacon Explorer | `https://beacon.pulsechain.com` | Consensus layer; validator data |
| BlockScout testnet | `https://scan.v4.testnet.pulsechain.com` | Testing |

### 2.4 Graph / Subgraph

| Resource | URL | Notes |
|---|---|---|
| Graph Node (mainnet) | `https://graph.pulsechain.com` | Self-hosted Graph protocol node |
| PulseX Subgraph (GraphiQL) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex` | Interactive UI |
| PulseX Subgraph (API) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | GraphQL endpoint |
| Graph Node (testnet v4) | `https://graph.v4.testnet.pulsechain.com` | Testing |

### 2.5 Applications (developer reference)

| Resource | URL | Notes |
|---|---|---|
| PulseX DEX | `https://app.pulsex.com` | Primary DEX; v1 and v2 pools |
| PulseChain Bridge | `https://bridge.pulsechain.com` | Ethereum ↔ PulseChain bridge |
| PulseChain Develop Portal | `https://pulsechain.com/#/develop` | Links to developer resources |
| BlockScout GitLab | `https://gitlab.com/pulsechaincom/blockscout` | Source code |

---

## Section 3 — Graph / Subgraph Inventory

> **Note:** Direct fetch of `graph.pulsechain.com` returned 403 in the research environment. Subgraph names were assembled from search results and secondary sources. An operator must directly inspect `https://graph.pulsechain.com` to enumerate all deployed subgraphs.

### 3.1 Confirmed Subgraph Endpoints

| Subgraph | GraphQL Endpoint | Owner | Status |
|---|---|---|---|
| PulseX (v1 + v2) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | PulseChain team | Confirmed via search (GraphiQL link indexed) |
| PulseX Pairs (testnet reference) | `https://graph.v4.testnet.pulsechain.com/subgraphs/name/pulsechain/pairs/graphql` | PulseChain team | Confirmed in testnet docs |

### 3.2 Expected But Unconfirmed Subgraphs

The following subgraph deployments are expected based on ecosystem structure but require direct Graph node inspection to confirm endpoint names and availability:

| Expected Subgraph | Likely Endpoint Pattern | Relevance |
|---|---|---|
| PulseX v1 pairs | `…/name/pulsechain/pulsex-v1` or `…/name/pulsechain/pairs` | DEX pricing v1 |
| PulseX v2 pairs | `…/name/pulsechain/pulsex-v2` | DEX pricing v2 |
| HEX staking | Unconfirmed — may not exist | HexMining staking data |
| PNS (Pulse Name Service) | Via community Graph deployment | Name resolution |
| Liquid Loans | Referenced in community sources | DeFi protocol |

### 3.3 HEX Relevance

The PulseX subgraph indexes pair reserves including:
- `v1HEX/WPLS` — HEX price in native PLS (v1 pool)
- `v2HEX/WPLS` — HEX price in native PLS (v2 pool)
- `PLSX/WPLS` — PLSX/PLS price reference

These pair reserves are the on-chain source for HEX reserve-derived pricing, which is the required pricing approach in CLAUDE.md (`Use on-chain PulseChain reserve-derived pricing`).

### 3.4 HexMining Relevance

No dedicated HexMining subgraph was identified. HexMining yield data (`RawHexDailyDataObservation`) is ingested directly from the HEX contract via RPC (`dailyData` mapping), not via subgraph. The subgraph is not required for HexMining verification.

### 3.5 Staking Relevance

Consensus-layer PulseChain staking (validator staking in PLS) is covered by the Beacon chain explorer. HEX token staking is read from the HEX contract via RPC — no subgraph confirmed for this data.

---

## Section 4 — data.pls-api.com Assessment

> **Fetch status:** HTTP 403 returned for `https://data.pls-api.com/docs` in this research environment. The following is assembled from indirect search evidence only. **Direct inspection required before any classification decision.**

### 4.1 What Is Known

| Field | Value |
|---|---|
| Base URL | `https://data.pls-api.com` |
| Docs URL | `https://data.pls-api.com/docs` |
| Source in search results | Found indirectly as `pls.aff.icu` (linked as "Network Data - PulseChain API") |
| Attribution | Not publicly attributed to a known team; absent from PulseChain official developer pages in search results |
| API surface (indirect) | Appears to offer token prices, market data, on-chain DEX data — similar scope to CoinGecko's PulseChain API |

### 4.2 Tentative API Group Assessment

Based on the domain name and indirect search evidence, the API likely covers:

| Group | Likely Available | CoinPulse Use Case |
|---|---|---|
| Token price data | Probable | Pricing cross-check |
| Token metadata | Probable | Token list reference |
| Holder / statistics | Possible | No current CoinPulse use case |
| DEX / liquidity data | Possible | Pricing source (reserve-derived if on-chain) |

### 4.3 Preliminary Classification

**Unclassified — direct inspection required.** Recommend an operator visit `https://data.pls-api.com/docs` manually, capture the API groups and authentication model, and classify based on:
- Whether pricing is reserve-derived (on-chain) or aggregated
- Whether the owner/SLA is identifiable
- Whether authentication is required and at what cost

**Do not integrate before inspection.**

---

## Section 5 — G4MM4 Resource Assessment

> **Fetch status:** HTTP 403 returned for `https://www.g4mm4.io/endpoints-and-resources`. The following is assembled from search results, cross-referencing G4MM4 Twitter/Telegram, and indexed page fragments. **Direct inspection of the endpoints page is required for a complete inventory.**

### 5.1 Confirmed G4MM4 Resources

| Resource | URL | Type |
|---|---|---|
| Mainnet RPC (HTTP) | `https://rpc-pulsechain.g4mm4.io` | JSON-RPC |
| Mainnet RPC (WebSocket) | `wss://rpc-pulsechain.g4mm4.io` | WebSocket JSON-RPC |
| OtterScan (mainnet) | `https://otter-pulsechain.g4mm4.io` | Block explorer |
| OtterScan (testnet) | `https://otter-testnet-pulsechain.g4mm4.io` | Block explorer |
| Validator stats / main site | `https://www.g4mm4.io` | Beacon analytics |
| Endpoints page | `https://www.g4mm4.io/endpoints-and-resources` | Resource index |

### 5.2 Unconfirmed G4MM4 Resources (require direct inspection)

G4MM4 is a broad infrastructure provider. Their endpoints page may include:

| Potential Resource | Pattern | Notes |
|---|---|---|
| Graph node | `https://graph-pulsechain.g4mm4.io` | Not confirmed in search |
| Beacon API | Similar subdomain pattern | Possible given validator focus |
| Prysm beacon HTTP API | Similar subdomain pattern | G4MM4 runs validators |

### 5.3 Pricing and Liquidity Sources

G4MM4 does not appear to offer native pricing APIs. Their RPC endpoint is a raw data source — pricing must be derived from on-chain reserves via the RPC or Graph subgraph.

### 5.4 Indexing Sources

G4MM4 provides Erigon-based RPC (OtterScan requires Erigon's extended API). This enables internal transaction trace data not available on standard RPC implementations.

### 5.5 Staking and HEX Sources

G4MM4's beacon dashboard covers PLS validator staking (consensus layer). No HEX-specific or HexMining-specific data source was identified in G4MM4 resources.

---

## Section 6 — Pricing Source Analysis

### 6.1 Where PulseChain Token Prices Originate

PulseChain token prices are ultimately derived from three mechanisms:

| Mechanism | Description | Primary Source |
|---|---|---|
| On-chain DEX reserve ratio | Token/WPLS reserve ratio in PulseX pools; no oracle required | PulseX subgraph or direct RPC call to pair contract |
| CEX market data | PLS/USD price on centralized exchanges (Kraken, etc.) | External CEX; not on-chain |
| Aggregated price APIs | CoinGecko, CMC, Moralis — aggregate DEX + CEX data | Third-party aggregation |

### 6.2 DEX-Derived Pricing Sources

| Source | Mechanism | URL | Recommended |
|---|---|---|---|
| PulseX subgraph | GraphQL query: `pair.reserve0 / pair.reserve1` | `graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | **YES — primary** |
| Direct RPC pair contract | `eth_call` to `getReserves()` on PulseX pair | `rpc.pulsechain.com` | YES — fallback when subgraph unavailable |
| DexScreener | Aggregated DEX data | `dexscreener.com/pulsechain` | **NO** — explicitly prohibited in CLAUDE.md |
| CoinGecko onchain | Derived from PulseX pairs via CoinGecko's own indexing | `coingecko.com/en/api/pulsechain` | Secondary cross-check only |

### 6.3 API-Derived Pricing Sources

| Source | Mechanism | Notes |
|---|---|---|
| Moralis `eth_getTokenPrice` | Aggregated; source unclear | Not on-chain reserve-derived; do not use as primary |
| CoinGecko DEX API | PulseX reserves + 2-3s refresh | Acceptable secondary cross-check |
| data.pls-api.com | Unknown — requires inspection | Unclassified |

### 6.4 Explorer-Derived Pricing Sources

BlockScout (`scan.pulsechain.com`) displays token prices but sources them externally (likely CoinGecko). Not suitable as a programmatic pricing ingestion source.

### 6.5 Recommended CoinPulse Pricing Strategy

The current CLAUDE.md rule is correct: **on-chain PulseChain reserve-derived pricing only**. The implementation path is:

1. **Primary:** Query PulseX pair reserves via the Graph subgraph (`graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql`) — this is the most efficient and structured approach.
2. **Fallback:** Direct `getReserves()` RPC call to the relevant PulseX pair contract when the subgraph is unavailable.
3. **Never:** Use DexScreener, Moralis price endpoints, or CoinGecko as primary pricing truth.
4. **PLS/USD anchor:** Requires a PLS/USD price reference (CEX or stablecoin pair). The WPLS/USDC or WPLS/DAI PulseX pair is the recommended on-chain source. CEX data (Kraken) may be used as a secondary cross-check.

---

## Section 7 — CoinPulse Source Classification

### Tier A — Official PulseChain-controlled infrastructure

These are operated by the PulseChain team and are the most authoritative data sources available.

| Source | URL | Role |
|---|---|---|
| Official RPC | `https://rpc.pulsechain.com` | Primary ingestion RPC |
| Official WebSocket | `wss://rpc.pulsechain.com` | Real-time log subscriptions |
| BlockScout REST API | `https://api.scan.pulsechain.com/api-docs` | Token transfer ingestion; address lookups |
| BlockScout JSON-RPC | `https://api.scan.pulsechain.com/api/eth-rpc` | Ethereum-compatible RPC fallback |
| PulseX Graph Subgraph | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | On-chain reserve-derived pricing; DEX pair data |
| Beacon Explorer | `https://beacon.pulsechain.com` | Consensus layer health reference |
| OtterScan (official) | `https://otter.pulsechain.com` | Debugging; trace data |

### Tier B — Officially referenced ecosystem resources

These are not PulseChain-team-operated but are prominently referenced or recommended by the PulseChain community infrastructure.

| Source | URL | Role |
|---|---|---|
| G4MM4 RPC | `https://rpc-pulsechain.g4mm4.io` | Backup ingestion RPC; high reliability |
| G4MM4 WebSocket | `wss://rpc-pulsechain.g4mm4.io` | Backup WebSocket |
| G4MM4 OtterScan | `https://otter-pulsechain.g4mm4.io` | Erigon traces; debugging |
| G4MM4 Validator Stats | `https://www.g4mm4.io` | Network health reference |
| PublicNode RPC | `https://pulsechain.publicnode.com` | Tertiary RPC fallback |
| ChainList entry | `https://chainlist.org/chain/369` | Chain configuration reference |

### Tier C — External verification and market-data providers

These are third-party providers with legitimate roles in secondary verification or market pricing cross-checks. **None may be used as primary pricing truth.**

| Source | URL | Role |
|---|---|---|
| Moralis PulseChain API | `https://docs.moralis.com/web3-data-api/evm/chains/pulsechain` | Secondary: token balance cross-check |
| CoinGecko PulseChain API | `https://www.coingecko.com/en/api/pulsechain` | Secondary: pricing cross-check only |
| SubQuery Indexer | `https://thechaindata.com/indexer/369` | Alternative indexing; low priority |
| data.pls-api.com | `https://data.pls-api.com` | Unclassified — inspect before use |

### Tier D — Not recommended

| Source | URL | Reason |
|---|---|---|
| DexScreener | `https://dexscreener.com/pulsechain` | Explicitly prohibited in CLAUDE.md |
| CoinMarketCap | `https://coinmarketcap.com` | Centralized aggregator; not on-chain truth |
| Kraken price feed | `https://www.kraken.com` | CEX data; acceptable only as PLS/USD secondary anchor |

---

## Section 8 — Recommendations

### 8.1 Highest-Priority Future Integrations

| Priority | Integration | Rationale |
|---|---|---|
| 1 | **PulseX subgraph pricing integration** | Required for on-chain reserve-derived pricing per CLAUDE.md; currently missing from pricing pipeline; needed before any token valuation |
| 2 | **G4MM4 RPC as documented backup** | Config-level RPC failover using `rpcEndpointLabel`; improves ingestion reliability without architectural change |
| 3 | **BlockScout REST API for token transfer ingestion** | Provides indexed token transfer data; reduces RPC log-filter load; Etherscan-compatible surface |
| 4 | **Direct PulseX pair `getReserves()` RPC fallback** | When Graph subgraph is unavailable; ensures pricing never silently gaps |

### 8.2 Highest-Priority Verification Sources

| Priority | Source | Use Case |
|---|---|---|
| 1 | **PulseX subgraph** | Cross-check on-chain reserve prices against persisted `PriceObservation` records |
| 2 | **BlockScout REST API** | Cross-check token transfer ingestion completeness |
| 3 | **G4MM4 RPC** | Independent block hash / receipt verification against official RPC |

### 8.3 Highest-Priority Pricing Sources

| Priority | Source | Mechanism |
|---|---|---|
| 1 | **PulseX subgraph** (`graph.pulsechain.com`) | On-chain reserve ratio; structured GraphQL; most efficient |
| 2 | **PulseX pair contract RPC calls** | Direct `getReserves()` fallback; authoritative but less efficient |
| 3 | **WPLS/stablecoin pair on-chain** | PLS/USD anchor; on-chain reserve-derived |

### 8.4 What This Inventory Does Not Recommend

- No implementation work is recommended in this document.
- No Gate 10 execution.
- No Gate 11 lift.
- No public estimated yield exposure.
- No API routes, frontend changes, schema changes, or code changes of any kind.

---

## Appendix A — Fetch Limitations

The following three mandatory primary sources returned HTTP 403 in the research environment and could not be directly fetched:

| Source | URL | Limitation |
|---|---|---|
| PulseChain develop portal | `https://pulsechain.com/#/develop` | HTTP 403 |
| G4MM4 endpoints page | `https://www.g4mm4.io/endpoints-and-resources` | HTTP 403 |
| PLS Data API docs | `https://data.pls-api.com/docs` | HTTP 403 |

Additionally, all WebFetch calls to third-party sites (BlockScout, Moralis, CoinGecko, Coast, Medium, etc.) returned HTTP 403. All data in this document was assembled from web search results and secondary sources.

**Recommended follow-up:** An operator should manually visit each of the three primary sources to verify, supplement, or correct entries in this inventory — particularly:
1. The complete subgraph list on `graph.pulsechain.com`
2. The full G4MM4 endpoint list on `g4mm4.io/endpoints-and-resources`
3. The API groups and authentication model for `data.pls-api.com/docs`

---

## Appendix B — URLs Referenced

All URLs captured during this research, for completeness:

**PulseChain official:**
- `https://pulsechain.com`
- `https://rpc.pulsechain.com`
- `wss://rpc.pulsechain.com`
- `https://scan.pulsechain.com`
- `https://api.scan.pulsechain.com/api-docs`
- `https://api.scan.pulsechain.com/api/eth-rpc`
- `https://otter.pulsechain.com`
- `https://beacon.pulsechain.com`
- `https://graph.pulsechain.com`
- `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex`
- `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql`
- `https://app.pulsex.com`
- `https://bridge.pulsechain.com`
- `https://gitlab.com/pulsechaincom/blockscout`

**PulseChain testnet:**
- `https://rpc.v4.testnet.pulsechain.com`
- `https://scan.v4.testnet.pulsechain.com`
- `https://api.scan.v4.testnet.pulsechain.com/eth-rpc-api-docs`
- `https://graph.v4.testnet.pulsechain.com`
- `https://graph.v4.testnet.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql`
- `https://beacon.v4.testnet.pulsechain.com`

**G4MM4:**
- `https://www.g4mm4.io`
- `https://www.g4mm4.io/endpoints-and-resources`
- `https://rpc-pulsechain.g4mm4.io`
- `wss://rpc-pulsechain.g4mm4.io`
- `https://otter-pulsechain.g4mm4.io`
- `https://otter-testnet-pulsechain.g4mm4.io`

**data.pls-api.com:**
- `https://data.pls-api.com`
- `https://data.pls-api.com/docs`

**Ecosystem / community:**
- `https://pulsechain.publicnode.com`
- `wss://pulsechain.publicnode.com`
- `https://chainlist.org/chain/369`
- `https://dexscreener.com/pulsechain`
- `https://www.coingecko.com/en/api/pulsechain`
- `https://docs.moralis.com/web3-data-api/evm/chains/pulsechain`
- `https://thechaindata.com/indexer/369`
- `https://www.pulsechainstats.com`
- `https://www.g4mm4.io/endpoints-and-resources`
- `https://www.comparenodes.com/protocols/pulsechain/`
- `https://www.dwellir.com/networks/pulsechain`
- `https://getblock.io/nodes/pulse/`

---

*Gate 10: OPEN. Gate 11: OPEN. Public estimated yield: GATED.*
