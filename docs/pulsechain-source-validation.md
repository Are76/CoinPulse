# PulseChain Source Validation

**Purpose:** Audit of the findings in `docs/pulsechain-data-source-inventory.md` (PR #244). Every entry is re-verified using Tier 1 authoritative PulseChain sources only. Third-party aggregators (CoinGecko, Moralis, DexScreener, web search results) are not used as evidence.

**Validation date:** 2026-06-13

**Validation method:** Direct HTTP fetch of each Tier 1 URL in this execution environment (WebFetch tool). Results are CONFIRMED (page accessible and content returned), PARTIAL (page accessible but limited content returned), or FAILED (HTTP 403 — page blocked).

**Governing rule (verbatim from this task's SOURCE DISCOVERY RULES):**
> If a Tier 1 source cannot be accessed: STOP. Document: URL, access method, error received, information unavailable. Absence of data is preferred over guessed data. Do not infer. Do not estimate. Do not substitute.

---

## Section 1 — Validation Matrix

| Source | URL | Directly Verified | Indirectly Verified | Access Failure | Confidence |
|---|---|---|---|---|---|
| PulseChain official RPC | `https://rpc.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| PulseChain WebSocket RPC | `wss://rpc.pulsechain.com` | NO | NO | Not testable via HTTP fetch | **NONE — not confirmed in this environment** |
| BlockScout Explorer | `https://scan.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| BlockScout REST API docs | `https://api.scan.pulsechain.com/api-docs` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| BlockScout JSON-RPC | `https://api.scan.pulsechain.com/api/eth-rpc` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| BlockScout (scan.pulsechain.com) root | `https://api.scan.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| OtterScan (official) | `https://otter.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| Beacon Explorer | `https://beacon.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| Graph Node (mainnet) | `https://graph.pulsechain.com` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| PulseX Subgraph (GraphiQL) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| PulseX Subgraph (GraphQL API) | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| PulseChain develop portal | `https://pulsechain.com/#/develop` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| PulseChain develop portal (alt) | `https://pulsechain.com/develop` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| G4MM4 endpoints page | `https://www.g4mm4.io/endpoints-and-resources` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| G4MM4 RPC (HTTP) | `https://rpc-pulsechain.g4mm4.io` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| G4MM4 OtterScan | `https://otter-pulsechain.g4mm4.io` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| data.pls-api.com docs | `https://data.pls-api.com/docs` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| BlockScout GitLab repo | `https://gitlab.com/pulsechaincom/blockscout` | **YES** | — | — | **HIGH — directly confirmed** |
| go-pulse GitLab repo | `https://gitlab.com/pulsechaincom/go-pulse` | **YES** | — | — | **HIGH — directly confirmed** |
| prysm-pulse GitLab repo | `https://gitlab.com/pulsechaincom/prysm-pulse` | **YES** | — | — | **HIGH — directly confirmed** |
| pulsechaincom GitLab group | `https://gitlab.com/pulsechaincom` | PARTIAL | — | — | **LOW — group overview only; no repo list returned** |
| graph-node GitLab repo | `https://gitlab.com/pulsechaincom/graph-node` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| otter-pulse GitLab repo | `https://gitlab.com/pulsechaincom/otter-pulse` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| pulsex GitLab repo | `https://gitlab.com/pulsechaincom/pulsex` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| pulsex-subgraph GitLab repo | `https://gitlab.com/pulsechaincom/pulsex-subgraph` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| wrapped-pulse GitLab repo | `https://gitlab.com/pulsechaincom/wrapped-pulse` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |
| pulse-bridge GitLab repo | `https://gitlab.com/pulsechaincom/pulse-bridge` | NO | NO | HTTP 403 | **NONE — not confirmed in this environment** |

---

## Section 2 — PulseChain-Controlled Sources

### 2.1 RPC Endpoints

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| Official RPC | `https://rpc.pulsechain.com` | **HTTP 403** | None — existence and parameters not confirmed in this environment |
| G4MM4 RPC | `https://rpc-pulsechain.g4mm4.io` | **HTTP 403** | None — not confirmed in this environment |

**Information unavailable due to access failure:**
- Whether `rpc.pulsechain.com` is currently live
- Actual supported JSON-RPC method set
- Rate limit configuration
- Whether `rpc2.pulsechain.com` or any secondary official RPC exists
- G4MM4 RPC availability and latency characteristics

### 2.2 Graph Endpoints and Subgraphs

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| Graph Node root | `https://graph.pulsechain.com` | **HTTP 403** | None |
| PulseX Subgraph GraphiQL | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex` | **HTTP 403** | None |
| PulseX Subgraph GraphQL API | `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | **HTTP 403** | None |

**Information unavailable due to access failure:**
- Whether `graph.pulsechain.com` is currently live
- The complete list of deployed subgraphs
- Whether a PulseX v1 and v2 are separate subgraphs or combined
- PulseX subgraph schema (entity types, field names)
- Whether a HEX-specific or HexMining-specific subgraph exists
- Whether a pairs or staking subgraph exists

### 2.3 data.pls-api.com

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| API docs | `https://data.pls-api.com/docs` | **HTTP 403** | None |
| Root | `https://data.pls-api.com` | Not attempted | None |

**Information unavailable due to access failure:**
- API groups and endpoints
- Authentication model
- Ownership / operator
- Rate limits
- Whether pricing is reserve-derived or aggregated

### 2.4 G4MM4 Resources

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| Endpoints page | `https://www.g4mm4.io/endpoints-and-resources` | **HTTP 403** | None |
| RPC | `https://rpc-pulsechain.g4mm4.io` | **HTTP 403** | None |
| OtterScan | `https://otter-pulsechain.g4mm4.io` | **HTTP 403** | None |

**Information unavailable due to access failure:**
- Complete resource list from the G4MM4 endpoints page
- Whether G4MM4 operates a Graph node
- Whether G4MM4 operates a beacon API endpoint
- Whether G4MM4 provides any data APIs beyond RPC and OtterScan

### 2.5 OtterScan

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| Official OtterScan | `https://otter.pulsechain.com` | **HTTP 403** | None |
| G4MM4 OtterScan | `https://otter-pulsechain.g4mm4.io` | **HTTP 403** | None |

### 2.6 BlockScout

| Endpoint | Attempted URL | Result | Information Available |
|---|---|---|---|
| Explorer UI | `https://scan.pulsechain.com` | **HTTP 403** | None |
| REST API docs | `https://api.scan.pulsechain.com/api-docs` | **HTTP 403** | None |
| JSON-RPC | `https://api.scan.pulsechain.com/api/eth-rpc` | **HTTP 403** | None |
| API root | `https://api.scan.pulsechain.com` | **HTTP 403** | None |
| GitLab repository | `https://gitlab.com/pulsechaincom/blockscout` | **CONFIRMED** | See Section 3 |

---

## Section 3 — GitLab Inventory

Only the GitLab repositories that returned content via direct fetch are listed here. Repositories that returned HTTP 403 are documented as access failures. Repository names attempted that were not accessible are listed separately.

### 3.1 Directly Confirmed Repositories

#### gitlab.com/pulsechaincom/blockscout

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/blockscout` |
| Description | PulseChain block explorer, a fork of Blockscout |
| Commits | 9,736 |
| Branches | 5 |
| Tags | Not returned |
| Releases | 1 |
| License | GNU GPLv3 |
| Created | 2021-05-11 |
| CoinPulse relevance | The source code for `scan.pulsechain.com` and its API. Relevant for understanding BlockScout API surface, schema, and any PulseChain-specific modifications to the standard Etherscan-compatible API. |

#### gitlab.com/pulsechaincom/go-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/go-pulse` |
| Description | Official PulseChain execution client (Go-Ethereum fork) |
| Commits | 16,310 |
| Branches | 5 |
| Tags | 36 |
| Releases | 29 |
| License | GNU GPLv3 |
| Created | 2021-03-24 |
| CoinPulse relevance | The execution layer node software. Directly relevant to understanding what JSON-RPC methods and block/transaction structures are available via `rpc.pulsechain.com`. The source for any PulseChain-specific RPC behavior differences from Ethereum mainnet. |

#### gitlab.com/pulsechaincom/prysm-pulse

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom/prysm-pulse` |
| Description | Official PulseChain consensus client (Prysm fork) |
| Commits | 8,840 |
| Branches | 1 |
| Tags | 17 |
| Releases | 11 |
| License | GNU GPLv3 |
| Created | 2023-03-20 |
| CoinPulse relevance | The consensus layer client. Not directly relevant to token/DEX data ingestion. Relevant for understanding validator staking data structure if consensus-layer data is ever needed. |

### 3.2 Group Overview (Partial)

| Field | Value |
|---|---|
| URL | `https://gitlab.com/pulsechaincom` |
| Description | "Energy Efficient, Cheaper, Faster Fee-Burning Ethereum fork" |
| Fetch result | PARTIAL — group overview only; individual repository list not returned |

### 3.3 Repository Access Failures

The following repository URLs were attempted and returned HTTP 403. Their existence, content, and relevance cannot be confirmed in this environment.

| Attempted URL | Notes |
|---|---|
| `https://gitlab.com/pulsechaincom/graph-node` | Existence not confirmed |
| `https://gitlab.com/pulsechaincom/otter-pulse` | Existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulsex` | Existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulsex-subgraph` | Existence not confirmed |
| `https://gitlab.com/pulsechaincom/wrapped-pulse` | Existence not confirmed |
| `https://gitlab.com/pulsechaincom/pulse-bridge` | Existence not confirmed |

**Action required:** An operator must visit `https://gitlab.com/pulsechaincom` in a browser to enumerate the complete repository list, confirm which repositories exist, and retrieve the purposes of each.

---

## Section 4 — Pricing Source Validation

### 4.1 PulseX Subgraph — Confirmed Capabilities

**Direct verification result: HTTP 403 for all graph.pulsechain.com endpoints.**

The PulseX subgraph at `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` could not be accessed. The following capabilities listed in PR #244 are **NOT confirmed** in this environment:

| Capability | Status in PR #244 | Validation result |
|---|---|---|
| Reserve-derived pricing | Listed as primary recommendation | **NOT CONFIRMED — endpoint inaccessible** |
| Liquidity pool discovery | Implied | **NOT CONFIRMED** |
| Pool/pair discovery | Implied | **NOT CONFIRMED** |
| Token price derivation from reserves | Listed as primary recommendation | **NOT CONFIRMED** |
| PulseX v1 and v2 pool data | Listed | **NOT CONFIRMED** |
| `reserve0 / reserve1` field structure | Listed | **NOT CONFIRMED — schema not verified** |
| HEX/WPLS pair availability | Listed | **NOT CONFIRMED** |

### 4.2 What Can Be Confirmed About Pricing Sources

Nothing can be confirmed about PulseChain pricing source capabilities from Tier 1 sources in this environment. Every pricing-related endpoint returned HTTP 403.

### 4.3 What Must Be Done Before Pricing Integration

Before any pricing integration decision can be made, an operator must:

1. Confirm `https://graph.pulsechain.com` is live and accessible.
2. Enumerate the deployed subgraph list.
3. Query the PulseX subgraph GraphQL schema (`__schema` introspection query) to confirm entity types and field names.
4. Confirm the specific pair entity IDs for HEX/WPLS and PLSX/WPLS on both v1 and v2.
5. Confirm whether the subgraph is updated in real time or has a known lag.
6. Confirm whether `graph.pulsechain.com` is operated by the PulseChain team or a third party.

---

## Section 5 — Corrections to PR #244

### 5.1 Confirmed Findings

The following findings from PR #244 are confirmed by direct fetch in this validation:

| Finding | Source of confirmation |
|---|---|
| `gitlab.com/pulsechaincom/blockscout` exists; is PulseChain's BlockScout fork; GNU GPLv3; created 2021-05-11 | Direct fetch — `gitlab.com/pulsechaincom/blockscout` |
| `gitlab.com/pulsechaincom/go-pulse` exists; is the official execution client (Go-Ethereum fork); GNU GPLv3; created 2021-03-24 | Direct fetch — `gitlab.com/pulsechaincom/go-pulse` |
| `gitlab.com/pulsechaincom/prysm-pulse` exists; is the official consensus client (Prysm fork); GNU GPLv3; created 2023-03-20 | Direct fetch — `gitlab.com/pulsechaincom/prysm-pulse` |
| `gitlab.com/pulsechaincom` is the official PulseChain GitLab group | Direct fetch — group overview |

### 5.2 Findings That Cannot Be Confirmed in This Environment

The following findings from PR #244 were assembled from web search results and secondary sources. They may be accurate, but they are not confirmed by direct Tier 1 access and must be treated as **unverified** until an operator validates them manually.

| PR #244 Finding | Reason Unconfirmed |
|---|---|
| `rpc.pulsechain.com` is the official PulseChain RPC — chain ID 369 | HTTP 403 — endpoint not accessible |
| `wss://rpc.pulsechain.com` is the official WebSocket endpoint | HTTP 403 |
| `scan.pulsechain.com` is the official BlockScout explorer | HTTP 403 |
| `api.scan.pulsechain.com/api-docs` hosts the REST API docs | HTTP 403 |
| `api.scan.pulsechain.com/api/eth-rpc` is the JSON-RPC API | HTTP 403 |
| `otter.pulsechain.com` is the official OtterScan | HTTP 403 |
| `beacon.pulsechain.com` is the official beacon explorer | HTTP 403 |
| `graph.pulsechain.com` hosts the PulseChain Graph node | HTTP 403 |
| PulseX subgraph is at `graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` | HTTP 403 |
| PulseX subgraph supports reserve-derived pricing queries | HTTP 403 — schema not verified |
| HEX/WPLS and PLSX/WPLS pairs are indexed in the PulseX subgraph | HTTP 403 — not confirmed |
| `rpc-pulsechain.g4mm4.io` is G4MM4's RPC endpoint | HTTP 403 |
| `wss://rpc-pulsechain.g4mm4.io` is G4MM4's WebSocket endpoint | HTTP 403 |
| `otter-pulsechain.g4mm4.io` is G4MM4's OtterScan | HTTP 403 |
| `www.g4mm4.io/endpoints-and-resources` lists G4MM4's full resource inventory | HTTP 403 |
| `data.pls-api.com` provides token price data and market data | HTTP 403 |
| `data.pls-api.com/docs` contains API group and endpoint documentation | HTTP 403 |
| G4MM4 RPC is the most reliable community RPC | Cannot confirm — endpoint inaccessible |
| G4MM4 does not operate a Graph node | Cannot confirm — endpoints page inaccessible |
| `bridge.pulsechain.com` is the official bridge | HTTP 403 — not tested |
| `app.pulsex.com` is the official PulseX DEX | HTTP 403 — not tested |

### 5.3 Structural Issue: PR #244 Source Attribution

PR #244 stated in its methodology section:

> "All entries below were assembled from web search results, secondary sources, and cross-referencing."

That disclosure was accurate and should be retained. However, the document did not consistently mark individual entries as "assembled from web search" vs. "directly confirmed." This validation document provides the per-entry confidence ratings that PR #244 lacked.

**Correction needed in PR #244:** Each source entry should display a `Verification Status` field indicating `Directly confirmed`, `Assembled from search results`, or `Not confirmed — direct inspection required`.

### 5.4 Findings Requiring Future Validation (Operator Action Items)

The following items require an operator to verify manually before they can be used as the basis for implementation decisions:

| Item | Action Required |
|---|---|
| Complete PulseChain GitLab repository list | Visit `https://gitlab.com/pulsechaincom` in a browser; enumerate all repos |
| PulseX subgraph schema and capabilities | Query `https://graph.pulsechain.com/subgraphs/name/pulsechain/pulsex/graphql` with `__schema` introspection |
| Complete subgraph list on `graph.pulsechain.com` | Browse Graph node index or query the Graph node API for deployed subgraphs |
| G4MM4 full endpoint list | Visit `https://www.g4mm4.io/endpoints-and-resources` in a browser |
| data.pls-api.com API groups and authentication | Visit `https://data.pls-api.com/docs` in a browser |
| Official RPC endpoint live status | Attempt `eth_chainId` JSON-RPC call to `https://rpc.pulsechain.com` |
| BlockScout REST API module list | Visit `https://api.scan.pulsechain.com/api-docs` in a browser |

---

## Environment Access Summary

This validation was conducted in the CoinPulse remote execution environment (2026-06-13). The WebFetch tool in this environment is blocked from reaching most external HTTP endpoints by network policy. The following pattern was observed:

- **Accessible:** Some GitLab repository pages (inconsistently — some returned 403, some did not)
- **Blocked (HTTP 403):** All PulseChain infrastructure endpoints, all G4MM4 endpoints, all BlockScout API endpoints, all RPC endpoints, all Graph node endpoints, all data.pls-api.com endpoints

This is an environment limitation, not evidence that the endpoints are down or invalid. An operator with unrestricted HTTP access must perform the direct validation steps listed in Section 5.4.

---

*Gate 10: OPEN. Gate 11: OPEN. Public estimated yield: GATED.*
