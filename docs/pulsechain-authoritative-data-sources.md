# PulseChain Authoritative Data Sources

**Purpose:** Strict CoinPulse reference document containing only PulseChain-controlled sources and their direct verification status. This is a source-of-truth document.

**Not in scope:** Market data surveys, pricing recommendations, ecosystem surveys, third-party aggregators (CoinGecko, Moralis, DexScreener, CoinMarketCap, CoinPaprika).

**Verification date:** 2026-06-13

**Verification environment:** CoinPulse remote execution environment. Verification method: direct HTTP fetch via WebFetch tool.

---

## Section 1 — Authoritative Source Policy

### Tier 1 — PulseChain-controlled infrastructure

Sources directly operated by the PulseChain team or published in PulseChain-controlled repositories and domains.

- `pulsechain.com` and all subdomains
- PulseChain GitLab group: `gitlab.com/pulsechaincom`
- `data.pls-api.com`
- `graph.pulsechain.com`
- `scan.pulsechain.com` and `api.scan.pulsechain.com`
- `otter.pulsechain.com`
- `beacon.pulsechain.com`
- `rpc.pulsechain.com`
- G4MM4 infrastructure (`g4mm4.io` and subdomains)

Tier 1 is the only permitted basis for implementation decisions in CoinPulse.

### Tier 2 — PulseChain ecosystem resources explicitly referenced by Tier 1

Sources that are not PulseChain-operated but are explicitly linked or referenced from Tier 1 sources. May be used to supplement Tier 1 after Tier 1 has been directly verified. Cannot replace Tier 1.

Examples (require Tier 1 link confirmation before use):
- Community RPC providers explicitly listed on `pulsechain.com/develop`
- Infrastructure resources explicitly listed on `g4mm4.io/endpoints-and-resources`

### Tier 3 — Commercial aggregators and third-party market data

Out of scope for this document. Not permitted as the basis for CoinPulse implementation decisions.

Examples: CoinGecko, CoinMarketCap, CoinPaprika, Moralis, DexScreener.

---

## Section 2 — Verified Sources

Only sources where a direct HTTP fetch returned content are listed here.

### 2.1 gitlab.com/pulsechaincom/blockscout

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/blockscout` |
| Owner | PulseChain team (pulsechaincom GitLab group) |
| Category | Source code — block explorer |
| Description | PulseChain block explorer, a fork of Blockscout |
| Commits | 9,736 |
| Branches | 5 |
| Tags | 1 |
| License | GNU GPLv3 |
| Created | 2021-05-11 |
| Verification method | Direct HTTP fetch — content returned |
| CoinPulse relevance | Source code for `scan.pulsechain.com` and its REST API. Authoritative reference for BlockScout API surface, PulseChain-specific modifications, and supported API modules. |

### 2.2 gitlab.com/pulsechaincom/go-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/go-pulse` |
| Owner | PulseChain team (pulsechaincom GitLab group) |
| Category | Source code — execution client |
| Description | Official PulseChain execution client, forked from Go-Ethereum |
| Commits | 16,310 |
| Branches | 5 |
| Tags | 36 |
| Releases | 29 |
| License | GNU GPLv3 |
| Created | 2021-03-24 |
| Verification method | Direct HTTP fetch — content returned |
| CoinPulse relevance | Authoritative source for PulseChain RPC method availability, block/transaction structure, and any PulseChain-specific EVM behavior differences from Ethereum mainnet. |

### 2.3 gitlab.com/pulsechaincom/prysm-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/prysm-pulse` |
| Owner | PulseChain team (pulsechaincom GitLab group) |
| Category | Source code — consensus client |
| Description | Official PulseChain consensus client, forked from Prysm |
| Commits | 8,840 |
| Branches | 1 |
| Tags | 17 |
| Releases | 11 |
| License | GNU GPLv3 |
| Created | 2023-03-20 |
| Verification method | Direct HTTP fetch — content returned |
| CoinPulse relevance | Consensus layer (Proof-of-Stake) implementation. Not relevant for token or DEX data ingestion. Relevant if consensus-layer validator data is ever required. |

### 2.4 gitlab.com/pulsechaincom/erigon-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/erigon-pulse` |
| Owner | PulseChain team (pulsechaincom GitLab group) |
| Category | Source code — execution client (Erigon variant) |
| Description | Official PulseChain execution client, forked from Erigon |
| Commits | 20,764 |
| Branches | 5 |
| Tags | 14 |
| Releases | 10 |
| License | GNU GPLv3 |
| Created | 2023-03-20 |
| Verification method | Direct HTTP fetch — content returned |
| CoinPulse relevance | The Erigon-based execution client powers OtterScan (`otter.pulsechain.com`) via Erigon's extended trace API. Relevant for understanding internal transaction trace data availability. |

### 2.5 gitlab.com/pulsechaincom/lighthouse-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/lighthouse-pulse` |
| Owner | PulseChain team (pulsechaincom GitLab group) |
| Category | Source code — consensus client (Lighthouse variant) |
| Description | Official PulseChain consensus client, forked from Lighthouse |
| Commits | 6,168 |
| Branches | 2 |
| Tags | 17 |
| Releases | 11 |
| License | Apache License 2.0 |
| Created | 2023-03-20 |
| Verification method | Direct HTTP fetch — content returned |
| CoinPulse relevance | Second consensus client implementation. Not relevant for token or DEX data ingestion. |

---

## Section 3 — Unverified Sources

Every Tier 1 source that returned HTTP 403 is listed here. No information about these sources is stated beyond what was directly observed.

### Access failure log

| URL | Access method | Exact failure | Information unavailable |
|---|---|---|---|
| `https://pulsechain.com/develop` | WebFetch (HTTP GET) | HTTP 403 Forbidden | All developer resources, RPC endpoint list, API links, Graph links, explorer links, any content published on this page |
| `https://pulsechain.com/#/develop` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Same as above |
| `https://www.g4mm4.io/endpoints-and-resources` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Complete G4MM4 endpoint list, all URLs, all resource categories, all infrastructure offered |
| `https://data.pls-api.com/docs` | WebFetch (HTTP GET) | HTTP 403 Forbidden | API groups, endpoint paths, authentication model, rate limits, data types, ownership |
| `https://data.pls-api.com` | Not attempted | — | Root page content and any redirects |
| `https://graph.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the Graph node is live, list of deployed subgraphs, any administrative information |
| `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this subgraph exists, whether the GraphiQL interface is available |
| `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this GraphQL endpoint is live, the subgraph schema, entity types, field names, whether reserve data is indexed |
| `https://scan.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Explorer content, navigation, any developer links |
| `https://api.scan.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | API root response |
| `https://api.scan.pulsechain.com/api-docs` | WebFetch (HTTP GET) | HTTP 403 Forbidden | REST API module list, endpoint paths, parameters, response formats |
| `https://api.scan.pulsechain.com/api/eth-rpc` | Not attempted separately | — | JSON-RPC method support |
| `https://rpc.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether endpoint is live, whether chain ID 369 is served |
| `wss://rpc.pulsechain.com` | Not testable via HTTP fetch | Not applicable | WebSocket availability |
| `https://beacon.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Beacon explorer content, validator data, any API links |
| `https://otter.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | OtterScan content, navigation |
| `https://rpc-pulsechain.g4mm4.io` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether RPC endpoint is live |
| `wss://rpc-pulsechain.g4mm4.io` | Not testable via HTTP fetch | Not applicable | WebSocket availability |
| `https://otter-pulsechain.g4mm4.io` | WebFetch (HTTP GET) | HTTP 403 Forbidden | OtterScan content |
| `https://ipfs.bridge.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted bridge UI is live; any content |
| `https://ipfs.app.pulsex.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted PulseX DEX UI is live; any content |
| `https://ipfs.scan.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted BlockScout UI is live; any content |
| `https://ipfs.launchpad.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted launchpad UI is live; any content |
| `https://ipfs.go.hex.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted HEX application is live; any content |
| `https://gitlab.com/pulsechaincom/graph-node` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/otter-pulse` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/pulsex` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/pulsex-subgraph` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/wrapped-pulse` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/pulse-bridge` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/nimbus-eth2-pulse` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/lodestar-pulse` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |
| `https://gitlab.com/pulsechaincom/teku-pulse` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether this repository exists, its description, content |

### Environment note

All HTTP 403 failures occurred in the CoinPulse remote execution environment on 2026-06-13. HTTP 403 indicates the request was received by the server and rejected. It does not indicate that the endpoint does not exist or is permanently unavailable. These endpoints require validation from an unrestricted network context.

---

## Section 4 — GitLab Repositories

### 4.1 Directly confirmed repositories

#### gitlab.com/pulsechaincom/blockscout

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/blockscout` |
| Purpose | PulseChain block explorer — fork of Blockscout. Powers `scan.pulsechain.com`. |
| CoinPulse relevance | Authoritative reference for the BlockScout REST API surface available at `api.scan.pulsechain.com`. Source for any PulseChain-specific API modifications. |

#### gitlab.com/pulsechaincom/go-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/go-pulse` |
| Purpose | Primary PulseChain execution client (Go-Ethereum fork). Powers `rpc.pulsechain.com` and other Go-Ethereum-based RPC nodes. |
| CoinPulse relevance | Authoritative source for supported JSON-RPC methods, block structure, and PulseChain-specific EVM modifications. Required reading before any RPC ingestion implementation. |

#### gitlab.com/pulsechaincom/prysm-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/prysm-pulse` |
| Purpose | PulseChain consensus client (Prysm fork). Handles Proof-of-Stake consensus layer. |
| CoinPulse relevance | Consensus layer only. Not relevant for token, DEX, or staking-token data ingestion. |

#### gitlab.com/pulsechaincom/erigon-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/erigon-pulse` |
| Purpose | Alternative PulseChain execution client (Erigon fork). Powers OtterScan instances via Erigon's extended API. Higher commit count than go-pulse suggests active development. |
| CoinPulse relevance | Authoritative source for Erigon-specific RPC extensions (internal transaction traces, `ots_` namespace). Required reading if internal transaction trace data is needed for ingestion. |

#### gitlab.com/pulsechaincom/lighthouse-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/lighthouse-pulse` |
| Purpose | Alternative PulseChain consensus client (Lighthouse fork, Apache 2.0). |
| CoinPulse relevance | Consensus layer only. Not relevant for token or DEX data ingestion. |

### 4.2 GitLab group overview

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom` |
| Description returned | "Energy Efficient, Cheaper, Faster Fee-Burning Ethereum fork" |
| Fetch result | Partial — group header and description only; complete project list not returned |

### 4.3 GitLab repository access failures

The following repository URLs were attempted and returned HTTP 403. Their existence cannot be confirmed or denied in this environment.

| URL | Status |
|---|---|
| `https://gitlab.com/pulsechaincom/graph-node` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/otter-pulse` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulsex` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulsex-subgraph` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/wrapped-pulse` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulse-bridge` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/nimbus-eth2-pulse` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/lodestar-pulse` | HTTP 403 — existence not confirmed |
| `https://gitlab.com/pulsechaincom/teku-pulse` | HTTP 403 — existence not confirmed |

---

## Section 5 — Operator Validation Backlog

The following tasks must be completed by an operator with unrestricted network access before any Tier 1 source can serve as the basis for an implementation decision.

| # | Task | URL to visit | Why required |
|---|---|---|---|
| 1 | Enumerate complete PulseChain GitLab repository list | `https://gitlab.com/pulsechaincom` (browser) | Complete project listing not returned by fetch; 9 additional repo names attempted with HTTP 403 |
| 2 | Confirm PulseChain developer portal content | `https://pulsechain.com/#/develop` (browser) | HTTP 403 in this environment; page may list authoritative RPC, subgraph, and API endpoint URLs |
| 3 | Confirm G4MM4 complete endpoint list | `https://www.g4mm4.io/endpoints-and-resources` (browser) | HTTP 403; complete set of G4MM4-hosted endpoints unknown |
| 4 | Confirm data.pls-api.com API surface | `https://data.pls-api.com/docs` (browser) | HTTP 403; API groups, authentication model, and ownership unknown |
| 5 | Confirm PulseX subgraph existence and schema | `https://graph.pulsechain.com` (browser) and GraphQL introspection on `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | HTTP 403; Graph node and subgraph existence not confirmed |
| 6 | Confirm BlockScout REST API module list | `https://api.scan.pulsechain.com/api-docs` (browser) | HTTP 403; API modules and endpoint paths unknown |
| 7 | Confirm official RPC liveness and chain ID | Send `{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}` POST to `https://rpc.pulsechain.com` | HTTP 403 for GET; RPC liveness via POST not confirmed |
| 8 | Confirm G4MM4 RPC liveness | Send `eth_chainId` POST to `https://rpc-pulsechain.g4mm4.io` | HTTP 403 for GET; RPC liveness not confirmed |
| 9 | Confirm OtterScan availability | `https://otter.pulsechain.com` (browser) | HTTP 403 |
| 10 | Confirm Beacon explorer availability and API | `https://beacon.pulsechain.com` (browser) | HTTP 403 |
| 11 | Confirm IPFS application availability | Each URL in Section 7.1 (browser) | All returned HTTP 403; existence and content not confirmed |

---

## Section 6 — CoinPulse Source Governance

### Preference order

**Tier 1 preferred.** All implementation decisions must be grounded in Tier 1 source verification. No ingestion endpoint, API, or data source may be integrated into CoinPulse production code before its Tier 1 source is directly confirmed by an operator.

**Tier 2 fallback.** Tier 2 sources may supplement Tier 1 only after Tier 1 verification establishes that the Tier 2 source is explicitly referenced by Tier 1. Tier 2 sources may not replace Tier 1 sources.

**Tier 3 last resort.** Tier 3 sources (commercial aggregators) are out of scope for CoinPulse implementation decisions. They are not permitted as the basis for ingestion, pricing, or verification architecture.

### Current governance state

As of this document (2026-06-13), the following Tier 1 sources have been directly confirmed in this environment:

- Five PulseChain GitLab repositories (see Section 2)

The following Tier 1 sources have not been directly confirmed in this environment and remain in the operator validation backlog (see Section 5):

- All live infrastructure endpoints (RPC, Graph, BlockScout, OtterScan, Beacon, G4MM4)
- `pulsechain.com` developer portal
- `data.pls-api.com`
- Complete GitLab repository list
- Five IPFS application URLs (see Section 7)

No implementation decision may be made on the basis of unconfirmed Tier 1 sources.

---

## Section 7 — Official PulseChain IPFS Applications

**Category:** Tier 1 PulseChain-controlled user-facing applications

**Intended use:**
- User navigation
- Deep links
- Manual verification by an operator
- Ecosystem reference

**Not intended as:**
- Canonical data sources
- Ingestion APIs
- Pricing APIs

### 7.1 Access failure log

All five IPFS application URLs returned HTTP 403 in this environment (2026-06-13). Their existence, content, and current availability cannot be confirmed here.

| URL | Access method | Exact failure | Information unavailable |
|---|---|---|---|
| `https://ipfs.bridge.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted bridge UI is live; any content |
| `https://ipfs.app.pulsex.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted PulseX DEX UI is live; any content |
| `https://ipfs.scan.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted BlockScout UI is live; any content |
| `https://ipfs.launchpad.pulsechain.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted launchpad UI is live; any content |
| `https://ipfs.go.hex.com` | WebFetch (HTTP GET) | HTTP 403 Forbidden | Whether the IPFS-hosted HEX application is live; any content |

### 7.2 Operator validation required

An operator must confirm each URL is live and determine whether it serves the described application before these are cited as ecosystem references. Add confirmed entries to Section 2 once verified.

---

*Gate 10: OPEN. Gate 11: OPEN. Public estimated yield: GATED.*
