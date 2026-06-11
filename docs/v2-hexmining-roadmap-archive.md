# V2 HexMining Roadmap — Archive

> **AI USAGE NOTE:** This is the historical archive. It contains completed-phase details, PR-by-PR logs, validation history, research records, and resolved decisions. **Do not load this file into context for routine implementation work.** For active work, read [`docs/v2-hexmining-roadmap.md`](./v2-hexmining-roadmap.md) instead. Use `grep` to locate specific sections in this file if needed.

**Active roadmap:** [`docs/v2-hexmining-roadmap.md`](./v2-hexmining-roadmap.md) — current gate state, approved DTO contract, immediate next PR.

**What this archive contains:** full historical record from PRs #188–#232 including §1–§10 (scope, principles, inventory, research, phases), §11.1–§11.13 (completed phase evidence, decisions, ABI blocker resolution), §11.14 full gating rationale, §11.15 EES penalty-distribution research, §11.16 original proposed-then-approved contract with full prose, Validation Notes, and Final Status ledger.

---

# V2 HexMining Roadmap

**Document status:** Living roadmap — Phases 0–3 complete and merged. Phase 4A observation/status chain complete (PRs #199–#202). Phase 4B dailyDataRange read boundary, persistence wiring, and gated operator route complete (PRs #204–#206). Phase 4C yield estimation is in progress — PRs #208–#228 merged; yield formula implemented (§8 test vectors A–E pass); elapsed-days coverage rule enforced at estimator boundary (PR #225); BPD attribution gate active at estimator boundary (PR #226); §11.9 provenance audit trail verified (PR #227); reader/route gated wiring contract-tested (PR #228); public estimated yield intentionally gated: `estimateHexMiningYield` always returns `evidence_available` with `yieldHex: null` for valid evidence; `"estimated"` path requires a separate future DTO/API contract approval — see §11.14; EES/penalty gate resolved (Finding A — penalties included in `dayPayoutTotal`) — see §11.15; proposed public `HexStakeYieldDto` contract documented in §11.16 (APPROVED FOR IMPLEMENTATION — OQ-1–OQ-6 resolved; see §11.16).
**Created:** 2026-06-06
**Last updated:** 2026-06-11 (docs/hexmining-approve-yield-dto-contract: §11.16 OQ-1–OQ-6 resolved and contract APPROVED FOR IMPLEMENTATION — public estimated yield remains NOT exposed until gate-lift implementation PR)

## Phase completion status

| Phase | Title | Status |
|---|---|---|
| Phase 0 | Roadmap and decisions | ✅ Complete — merged PR #188 |
| Phase 1 | HexMining DTO contract skeleton | ✅ Complete — merged PR #189 |
| Phase 2 | Native PulseChain active stake reads | ✅ Complete — merged PRs #190, #191 |
| Phase 3 | HexMining page shell / unsupported valuation display | ✅ Complete — merged PRs #192, #193 |
| Phase 4A | Observation persistence, status API, and operator surface | ✅ Complete — merged PRs #199–#202 |
| Phase 4B | dailyDataRange read boundary, persistence wiring, and gated operator route | ✅ Complete — merged PRs #204, #205, #206 |
| Phase 4C | Yield estimation and DTO wiring | ⚠️ In progress — PRs #208–#228 merged; yield formula implemented (§8 test vectors A–E); elapsed-days coverage rule enforced (PR #225); BPD attribution gate active at estimator boundary (PR #226); §11.9 provenance verified (PR #227); reader/route gate contract-tested (PR #228); public estimated yield intentionally gated at `evidence_available` — see §11.14 |
| Phase 5 | Ended stake discovery | 🔲 Not started |
| Phase 6 | HSI and HTT source families | 🔲 Not started |
| Phase 7 | Pricing, valuation, and PnL | 🔲 Not started |

---

## 1. Executive Summary

**What HexMining is:**
HexMining is the CoinPulse V2 product module for HEX staking intelligence and stake monitoring. The name is a CoinPulse-internal feature label — it does not refer to proof-of-work mining or new tokenomics. The domain is HEX staking: time-locked principal, stake shares, yield accumulation, and the stake lifecycle (pending → active → overdue → ended). HexMining is the module that surfaces this domain through CoinPulse's deterministic, audit-grade backend.

**Why it belongs to V2:**
V1 already ingests pHEX stake start/end events from on-chain transactions and materializes `PortfolioStakePosition` records with `valuation.status: "unsupported"` and `pnl.status: "unsupported"` sentinels. What V1 does not do is read active stake state directly (via `stakeCount`/`stakeLists`), compute yield from `dailyDataRange`, price or value stake positions, or support HSI/HTT source families. These capabilities require persisted price observations, explicit cost-basis policy decisions, new read models, and new DTO contracts — all of which are V2 scope.

**Why it is important:**
HEX stake positions are often the highest-value, longest-duration positions in a PulseChain portfolio. A portfolio accounting engine that cannot value or yield-annotate stakes returns an incomplete picture. Leaving stakes perpetually at `valuation.status: "unsupported"` is a correct V1 sentinel, not a permanent product state.

**Why it starts after V1/V1+ foundation work:**
The CoinPulse architecture requires persisted backend pricing before any valuation surface. It requires explicit cost-basis policy before any PnL surface. It requires a complete DTO contract skeleton before any frontend consumption. And it requires a completed V1 guardrail checkpoint before adding new ingestion source complexity. HexMining cannot safely start until the V1 foundation is stable and the decisions listed in Section 8 are resolved.

---

## 2. Scope Definition

### In scope for V2 HexMining

- Active stake discovery via on-chain reads: `stakeCount(address)`, `stakeLists(address,uint256)`
- Native PulseChain (chain ID 369) pHEX stakes only for the first slice
- HexMining DTO contract skeleton (schema-versioned, provenance-complete, status-explicit)
- Dashboard stake monitoring panel (read-only, unsupported valuation display)
- Yield estimation from `dailyDataRange` once persisted pricing exists
- Big Pay Day explicit modeling
- Ended stake discovery (backend-only, explorer-first with RPC fallback)
- HSI and HTT source families (later, after native stakes are stable)
- Ethereum eHEX stakes (chain ID 1) (later, chain-aware identity required)
- Pricing, valuation, and PnL for stakes (later, requires persisted price observations and explicit policy)

### Out of scope for first slice

- Any valuation, PnL, or yield calculation
- HSI (Hedron Stake Instance) stakes
- HTT (Hedron Token Transfer) / Actuator delegated stakes
- Ended stake discovery
- Ethereum eHEX (chain ID 1) stakes
- Frontend RPC reads of any kind
- Break-even analysis or scenario planning
- Investment recommendations or portfolio allocation advice
- Cross-chain expansion beyond PulseChain

### Explicitly deferred

- `dailyDataRange` yield reads (Phase 4)
- Big Pay Day explicit modeling (Phase 4)
- Ended stake discovery (Phase 5)
- HSI/HTT source families (Phase 6)
- Pricing, valuation, PnL (Phase 7)
- Ethereum eHEX support (Phase 7 or later)
- Portfolio intelligence layer integration

---

## 3. Architecture Principles

These principles are non-negotiable and apply to every HexMining implementation phase.

**Backend-first.** All stake discovery, yield reads, and valuation live in backend services. No stake calculation reaches the frontend.

**DTO-first.** No frontend page, component, or hook touches HexMining data until a schema-versioned DTO contract with explicit status fields exists and is contract-tested.

**No frontend RPC.** The frontend never calls PulseChain RPC endpoints. `stakeCount`, `stakeLists`, `currentDay`, `dailyDataRange`, and `globalInfo` are backend ingestion concerns only.

**No copied GPL code.** The public Hex Stake Analyzer reference (GPL-3.0) is used for domain/UX research only. No implementation code, ABI lists, calculation logic, or structural patterns are copied from it or any other GPL-licensed project.

**Chain-aware pHEX/eHEX identity.** HEX token identity is never symbol-only. The canonical asset IDs are:
- pHEX (PulseChain): `chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`
- eHEX (Ethereum): `chain:1:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`

These are the same token address on different chains. They must never be conflated.

**Observability and provenance first.** Every stake observation record must carry: chainId, walletAddress, stakeId, stakeIndex, stakeSource, observedAtBlock, observedAt, rpcEndpoint, and a warnings array. Truncation and rate-limit conditions must be surfaced as warnings, not silently dropped.

**Pricing, valuation, and PnL unavailable until persisted backend policy exists.** Stake positions must display `valuation.status: "unsupported"` and `pnl.status: "unsupported"` until:
- Price observations for pHEX are persisted and retrievable by block/timestamp
- Cost-basis policy for fork-copy stakes is explicitly decided and documented
- DTO contracts for valued stake positions are defined and contract-tested
- Backend policy for estimated vs. exact yield is documented

**Explicit status separation.** Every HexMining DTO must carry separate status fields: `stakeStatus`, `valuation.status`, `pnl.status`, `yield.status`. These must never be collapsed or coerced to zero.

---

## 4. Existing CoinPulse Stake Inventory

The following is an audit of what already exists in the CoinPulse V1 codebase as of this document. This inventory distinguishes what V1 already provides from what HexMining V2 must add.

### 4.1 Schema / Models

**`prisma/schema.prisma`**

`SourceFamily` enum (line 50-56) includes `STAKING` alongside `TRANSFERS`, `DEX`, `LP`, `NATIVE`.

`LedgerEntryType` enum includes nine stake-related types:
- `STAKE_START` — boundary marker for stake creation
- `STAKE_END` — boundary marker for stake close
- `STAKE_PRINCIPAL_LOCKED` — principal committed at start
- `STAKE_PRINCIPAL_RETURNED` — principal returned at end
- `STAKE_YIELD_RECEIVED` — yield credited at end
- `STAKE_PENALTY` — penalty applied at end
- `STAKE_LOCK` / `STAKE_UNLOCK` / `STAKE_REWARD` — additional HEX lock/reward entries

`RawStakeAction` model (lines 415-448) — raw audit evidence for a single stake transaction:
- Identity: `chainId`, `protocolSlug`, `actionKind` (START|END), `txHash`, `blockNumber`, `contractAddress`, `initiatorAddress`
- Stake identity: `stakeId` (BigInt), `stakeIndex` (Int)
- Stake parameters: `stakedDays`
- Token snapshot: `tokenAddress`, `assetIdSnapshot`, `decimalsSnapshot`
- Quantities: `principalLockedRaw`, `totalReturnedRaw`, `principalReturnedRaw`, `yieldRaw`, `penaltyRaw`
- Fee: `feeAssetIdSnapshot`, `feeAmountRaw`
- Index: `@@index([chainId, stakeId, blockNumber])`

`PortfolioStakePosition` model (lines 539-561) — materialized derived state:
- Keys: `walletId`, `chainId`, `stakeKey` (unique per wallet+chain+key)
- Identity: `tokenAssetId`, `tokenAddress`
- Quantities: `principalQuantity`, `returnedQuantity`, `yieldQuantity`, `penaltyQuantity`
- Status: `ACTIVE` | `ENDED` | `UNKNOWN`
- Block range: `startBlock`, `endBlock`

**Gap:** `PortfolioStakePosition` lacks `updatedFromBlock`/`updatedToBlock` DTO provenance fields that token and LP positions carry. This is a known V1 gap (G5 tracking in dashboard-data-quality-audit.md).

### 4.2 Sync Source Families

**`src/services/sync/transfer-sync.ts`** — dispatches to STAKING source family:
- `ingestStakeActions()` for ingestion phase
- `normalizeStakeActions()` for normalization phase

**`src/services/sync/stake-sync.ts`** (873 lines) — the V1 stake ingestion pipeline:

The existing ABI (`PHEX_STAKE_ABI`) already includes:
```
stakeCount(address stakerAddr) view returns (uint256)
stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)
startStake(uint256 newStakedHearts, uint256 newStakedDays)
endStake(uint256 stakeIndex, uint40 stakeIdParam)
```

The V1 sync pipeline uses `stakeCount` and `stakeLists` to correlate on-chain stake metadata when processing an observed `startStake` or `endStake` transaction event. It does **not** perform a standalone active-stake scan independent of observed events.

**What V2 HexMining must add:** An independent active-stake read path that discovers all current stakes for a wallet by scanning `stakeCount`/`stakeLists` without requiring prior event observation. This is the fundamental difference between V1 event-based ingestion and V2 active stake monitoring.

### 4.3 Normalization Layer

**`src/services/normalization/stake-normalizer.ts`** (232 lines):
- `normalizeStakeStart()` — produces 2–3 ledger entries: STAKE_START, STAKE_PRINCIPAL_LOCKED, optional FEE
- `normalizeStakeEnd()` — produces 2–5 ledger entries: STAKE_END, optional STAKE_PRINCIPAL_RETURNED, STAKE_YIELD_RECEIVED, STAKE_PENALTY, FEE

### 4.4 Portfolio Materialization

**`src/services/portfolio/materialize-positions.ts`** — `materializeCurrentPortfolioPositions()` accumulates `PortfolioStakePosition` rows from canonical ledger entries via `accumulateStakePosition()`. Status lifecycle: ACTIVE (has STAKE_START, no STAKE_END) / ENDED (has STAKE_END) / UNKNOWN (neither).

### 4.5 Dashboard Stake DTOs

**`src/services/dashboard/types.ts`**

`DashboardStakePositionDto` (lines 177-191):
```typescript
{
  stakeKey: string;
  tokenAssetId: string;
  tokenAddress: string | null;
  principalQuantity: string;
  returnedQuantity: string;
  yieldQuantity: string | null;
  penaltyQuantity: string | null;
  status: string;           // "ACTIVE" | "ENDED" | "UNKNOWN"
  startBlock: string | null;
  endBlock: string | null;
  valuation: DashboardValuationDto;   // always status: "unsupported"
  pnl: DashboardPnlDto;               // always status: "unsupported"
  warnings: string[];                 // includes "stake-valuation-unsupported-v1"
}
```

`PortfolioDashboardDto` includes `stakePositions: DashboardStakePositionDto[]`.

`DashboardPnlCoverageSection` includes `"stakePositions"` as an explicitly tracked unsupported section with `unsupportedPositionsCount`.

`PnLWarningCode` in `src/services/pnl/types.ts` includes `"UNSUPPORTED_STAKE_ACTION"`.

`PnLActionType` in `src/services/pnl/types.ts` includes `"HEX_STAKE_START"`, `"HEX_STAKE_END"`, `"HEX_STAKE_LOCK"`.

**These sentinels must be preserved** until Phase 7 backend pricing and policy prerequisites are met. No phase before Phase 7 should change `valuation.status` or `pnl.status` from `"unsupported"` to any other value.

### 4.6 Existing Docs Mentioning Stakes

| Document | Relevant content |
|---|---|
| `docs/roadmap-pulsechain-analytics-alignment.md` | HEX/pHEX stake analytics classified as Future research / V2 |
| `docs/v1-remaining-guardrail-checklist.md` | Explicit unsupported LP/stake sentinel requirement; Portfolio Intelligence Layer documentation-only until prerequisites |
| `docs/pnl-accounting-guardrails.md` | PnL unsupported guardrails for stake positions |
| `docs/pnl-status-coverage-audit.md` | Stake PnL coverage documentation |
| `docs/pnl-coverage-dto-plan.md` | Coverage metadata including stakePositions section |
| `docs/dashboard-data-quality-audit.md` | V1 unsupported sentinel patterns; G5 provenance gap for stake positions |
| `docs/portfolio-intelligence-layer-plan.md` | Portfolio intelligence scope; stake valuation as future phase |
| `docs/backend-platform-readiness.md` | Backend surfaces stable; no frontend stake computation |
| `docs/data-fetching-architecture.md` | No frontend stake value reconstruction |
| `docs/superpowers/specs/2026-05-08-coinpulse-v1-design.md` | HEX/pHEX stake tracking listed as V1 goal; valuation deferred |

### 4.7 Relevant Tests

| Test file | Lines | What it covers |
|---|---|---|
| `tests/services/sync/stake-sync.test.ts` | 744 | Stake start/end ingestion and normalization; idempotency; ambiguous candidate skipping; mock RPC client |
| `tests/services/normalization/stake-normalizer.test.ts` | 67 | Atomic ledger entry building for stake start (3 entries) and stake end (5 entries) |

No tests yet exist for:
- Active stake reads independent of event observation
- `stakeCount`/`stakeLists` scan-based discovery
- HexMining DTO contract validation
- Dashboard stake position rendering with unsupported sentinels (contract tests)
- Yield estimation or Big Pay Day modeling
- HSI/HTT source families
- Ended stake discovery

---

## 5. Reference Research Summary

A prior research audit reviewed the public Hex Stake Analyzer reference implementation (https://hexstakeanalyzer.github.io/Hex-Stake-Analyzer/). The findings are summarized here for domain research purposes. No code was copied.

**Architecture of the reference:** Browser-only, frontend-only. Public RPC reads directly from the browser. JavaScript calculations performed locally in the page. Structurally small (README.md, LICENSE, index.html). This architecture is the opposite of CoinPulse's backend-first, deterministic, auditable approach.

**License:** GPL-3.0. No implementation code, ABI lists, calculation logic, or structural patterns from the reference may be copied into CoinPulse. The safe path is concepts-only, reimplemented independently.

**HEX contract methods relevant for domain research:**

| Method | Purpose |
|---|---|
| `stakeCount(address)` | Number of active stakes for a wallet |
| `stakeLists(address, uint256)` | Stake detail by index: stakeId, stakedHearts, stakeShares, lockedDay, stakedDays, unlockedDay, isAutoStake |
| `currentDay()` | Current HEX protocol day number |
| `dailyDataRange(uint256, uint256)` | Per-day payout and share data for yield estimation |
| `globalInfo()` | Global protocol state: total shares, current day, etc. |
| `balanceOf(address)` | Free HEX balance (not staked) |

**V1 already uses:** `stakeCount` and `stakeLists` (in `stake-sync.ts` PHEX_STAKE_ABI) — but only as correlation metadata during event ingestion, not for independent active-stake discovery.

**Not yet in V1:** `currentDay()`, `dailyDataRange()`, `globalInfo()`.

**Stake source families (ordered by complexity):**

1. **Native stakes** — discovered directly via `stakeCount(wallet)` + `stakeLists(wallet, index)`. PulseChain-first. The correct first target.
2. **HSI (Hedron Stake Instance) stakes** — stakes wrapped as NFTs via Hedron protocol. Adds ownership indirection (NFT owner ≠ stake initiator). Source family complexity: MEDIUM.
3. **HTT (Hedron Token Transfer) / Actuator delegated stakes** — further ownership indirection. Source family complexity: HIGH. Last target.

**Ended stake discovery:** Materially harder than active stakes. On-chain `stakeLists` only returns active stakes. Ended stakes require explorer-first lookup (transaction history) with RPC fallback. Backend-only. Raw observation caching with provenance. Clear truncation and rate-limit warnings. Correctly deferred to Phase 5.

**Stake status vocabulary:** pending, active, overdue, ended.
- Pending: `lockedDay` > `currentDay()` (stake not yet started, relevant for long-stakedDays starts)
- Active: `lockedDay` ≤ `currentDay()` < `lockedDay + stakedDays`
- Overdue: `currentDay()` ≥ `lockedDay + stakedDays` and stake not ended (penalty accruing)
- Ended: stake no longer in `stakeLists` (closed via `endStake`)

**T-shares:** `stakeShares / 1e12` (approximate unit conversion — exact scaling must be verified against HEX contract source before implementation).

**Big Pay Day (BPD):** A one-time protocol event on HEX day 353 where bonus yield was distributed to stakers who were active during that period. Stakes that included BPD must carry explicit BPD yield attribution. Cannot be inferred silently.

**pHEX/eHEX chain-aware identity:** Same contract address, different chains. Must never be conflated by symbol alone.

**Fork-copy cost basis:** When a wallet held eHEX on Ethereum before the PulseChain fork, pHEX was created as a copy. Cost basis attribution for pHEX from this source is a policy choice, not a neutral accounting fact. Do not implement or promise PnL until this policy is explicit and documented.

---

## 6. Recommended Implementation Phases

These phases are ordered to minimize risk and maintain the CoinPulse architecture guardrails at each step. No phase may skip a prerequisite.

### Phase 0 — Roadmap and decisions (this document)

- Define HexMining scope, architecture principles, and risk register
- Audit existing V1 stake inventory
- Document data model decisions required before implementation
- Establish the "no valuation/PnL until Phase 7" rule explicitly
- **Deliverable:** `docs/v2-hexmining-roadmap.md` (this document)

### Phase 1 — HexMining DTO contract skeleton

- Define `HexStakeDto`, `HexStakeListDto`, `HexStakeValuationDto`, `HexStakePnlDto`, `HexStakeYieldDto` type shapes
- All valuation/PnL/yield fields must carry `status: "unsupported"` in Phase 1
- Schema-versioned (`schemaVersion: "v1"`)
- Provenance-complete: chainId, walletAddress, stakeId, stakeIndex, stakeSource, observedAtBlock, observedAt, warnings
- Status-explicit: stakeStatus, valuation.status, pnl.status, yield.status
- **No live reads yet** — types only
- Contract tests for DTO shape and status invariants
- **No schema migration required**

### Phase 2 — Native PulseChain active stake reads

- Backend service reads active stakes via `stakeCount(wallet)` + `stakeLists(wallet, index)`
- PulseChain only (chain ID 369), pHEX only
- Raw observation model: persist what was observed on-chain (block, timestamp, index, raw fields)
- Raw observations are immutable audit evidence — never overwrite
- Source family: `STAKING` (existing) or new `HEXMINING` read model (decision required — see Section 8)
- Returns `HexStakeListDto` with `valuation.status: "unsupported"`, `pnl.status: "unsupported"`
- Provenance: which RPC endpoint, which block, which wallet, truncation warnings if applicable
- Integration tests with mock RPC client (no live RPC in tests)

### Phase 3 — Dashboard transition panel / unsupported valuation display

- Add HexMining stake monitoring panel to dashboard
- Consumes backend DTO via TanStack Query hook — no frontend calculation
- Displays: stakeId, stakeIndex, stakeStatus, principalHex, stakeShares, tShares, lockedDay, stakedDays, unlockedDay
- Explicitly displays `valuation.status: "unsupported"` and `pnl.status: "unsupported"` as designed UI states
- Preserves existing `PortfolioStakePosition` display (V1 event-based) while adding new read-model panel
- No schema migration required

### Phase 4 — dailyData and yield support

- Prerequisite: Phase 2 complete and stable
- Add `currentDay()` read to determine protocol day
- Add `dailyDataRange(startDay, endDay)` reads for yield estimation
- Persist yield observations as raw audit evidence
- Compute estimated yield with explicit `yield.status: "estimated"` (never "exact" until protocol confirms)
- Model Big Pay Day explicitly with `bpdYieldStatus` field
- Update `HexStakeDto` with yield fields — additive change within schema version
- `valuation.status` and `pnl.status` remain `"unsupported"` in Phase 4

### Phase 5 — Ended stake discovery

- Prerequisite: Phase 2 complete and stable
- Backend-only: explorer-first lookup of historical `endStake` transactions, RPC fallback
- Raw observation caching with provenance
- Explicit truncation and rate-limit warnings in DTO
- Ended stakes carry `stakeStatus: "ended"` but valuation/PnL remain unsupported until Phase 7
- Do not delete or overwrite raw observations from Phase 2

### Phase 6 — HSI and HTT source families

- Prerequisite: Phase 5 complete, native stakes stable
- HSI: Hedron NFT ownership lookup, stake-to-NFT mapping
- HTT/Actuator: delegated stake ownership resolution
- Each source family requires its own raw observation model and provenance
- DTO carries `stakeSource: "native" | "hsi" | "htt"` field
- New source families do not change existing native stake pipeline

### Phase 7 — Pricing, valuation, and PnL

- Prerequisite: All previous phases complete; persisted `PriceObservation` records for pHEX available at ledger-aligned timestamps; explicit cost-basis policy decision documented
- Add mark price to `HexStakeValuationDto`: `valueQuote`, `markPrice`, `valuationAsOf`, `pricing.source`, `pricing.status`
- Add PnL to `HexStakePnlDto`: `averageCost`, `realizedPnl`, `unrealizedPnl`, `costBasisPolicy`
- pHEX and eHEX require separate price observation series (never mixed)
- Fork-copy cost basis policy must be explicitly stated in DTO: `costBasisPolicy: "fork-copy" | "zero-basis" | "manual" | "unknown"`
- No PnL surface until this policy field is populated and its meaning is documented
- `valuation.status` changes from `"unsupported"` to `"supported"` only after this phase

---

## 7. First Implementation Slice

The first safe PR after this docs PR is the HexMining DTO contract skeleton.

**Recommended PR title:** `test(hexmining): add DTO contract skeleton tests`

**Scope:**
- TypeScript type definitions for `HexStakeDto`, `HexStakeListDto`, `HexStakeValuationDto`, `HexStakePnlDto`
- All valuation/PnL status fields typed as `"unsupported"` literals in the first version
- Schema-versioned (`schemaVersion: "v1"`)
- Provenance fields: `chainId`, `walletAddress`, `stakeId`, `stakeIndex`, `stakeSource`, `observedAtBlock`, `observedAt`, `warnings`
- Status fields: `stakeStatus: "pending" | "active" | "overdue" | "ended" | "unknown"`, `valuation.status: "unsupported"`, `pnl.status: "unsupported"`, `yield.status: "unsupported"`
- Contract tests verifying DTO shape invariants and status sentinel behavior
- No live RPC reads
- No schema migration
- No frontend pages or components
- No API routes
- No valuation, PnL, or yield calculation

**Why test-first:** DTO contracts without tests are not contracts — they are suggestions. Writing contract tests before any live implementation forces the field shapes to be explicit and prevents drift when Phase 2 and beyond add data.

**What this PR does NOT do:**
- No `stakeCount`/`stakeLists` live reads
- No `currentDay`/`dailyDataRange`/`globalInfo` reads
- No HSI/HTT
- No ended stake discovery
- No pricing
- No valuation
- No PnL
- No frontend RPC

---

## 8. Data Model Questions

These decisions are required before any schema migration or runtime implementation begins. No implementation phase may proceed without resolving the decisions relevant to that phase.

**Decision 1 — Raw observation model: events vs. reads**
V1 `RawStakeAction` captures event-based observations (startStake/endStake transactions). Phase 2 adds read-based observations (`stakeCount`/`stakeLists` scans). Should these share the same `RawStakeAction` table with an `observationKind` discriminator, or should read-based observations live in a new `RawStakeObservation` table? The decision affects whether V1 event records and V2 read records can be queried together without JOIN complexity.

**Decision 2 — Source family: STAKING vs. HEXMINING**
The existing `SourceFamily.STAKING` is used for V1 event-based ingestion. Phase 2 adds a read-based path. Should read-based stake discovery use the existing `STAKING` source family or a new `HEXMINING` source family? A new source family would make the distinction explicit in `SyncCursor` and `SyncRun` records but would require an Enum migration.

**Decision 3 — stakeId, stakeIndex, stakeSource representation**
`stakeId` is returned as `uint40` from the contract (fits in BigInt). `stakeIndex` is the wallet-relative index. `stakeSource` distinguishes native/HSI/HTT. These three together uniquely identify a stake. The `stakeKey` in `PortfolioStakePosition` is a derived string. Should the new read model use a composite primary key, a canonical string key, or a surrogate ID?

**Decision 4 — Provenance persistence**
How should RPC endpoint identity, block height at time of read, and read timestamp be stored for read-based observations? This affects the `RawStakeObservation` model design and the `HexStakeDto` provenance fields.

**Decision 5 — Estimated vs. exact yield**
`dailyDataRange` returns per-day payout/share data that can be used to estimate yield for an active stake. This is an estimate — the exact yield is only known at `endStake`. The DTO must carry `yield.status: "estimated" | "exact" | "unsupported"`. The schema and calculation service must enforce this distinction.

**Decision 6 — Unsupported valuation/PnL representation**
The existing `DashboardStakePositionDto` already uses `valuation.status: "unsupported"` and `pnl.status: "unsupported"`. The new `HexStakeDto` must be consistent with this pattern. Should the new DTO reuse the existing `DashboardValuationDto` and `DashboardPnlDto` types, or define new HexMining-specific valuation/PnL types that later replace the dashboard types?

**Decision 7 — Active/pending/overdue/ended status derivation**
Status is derived from: `lockedDay`, `stakedDays`, `currentDay()`, and whether the stake still appears in `stakeLists`. The derivation logic must be backend-only and must handle: stake not yet started (pending), stake active (active), stake past end day but not closed (overdue), stake closed (ended — no longer in stakeLists). The algorithm must be documented and tested before implementation.

**Decision 8 — Big Pay Day modeling**
Stakes that were active on HEX day 353 received BPD yield. This yield is part of the historical yield calculation but only applies to stakes that spanned that day. The DTO needs an explicit `bpdYieldHex` field and `bpdYieldStatus: "applicable" | "not_applicable" | "unknown"`. The calculation must correctly determine whether a stake's `lockedDay..lockedDay+stakedDays` range includes day 353.

**Decision 9 — pHEX/eHEX chain-aware identity**
pHEX and eHEX have the same contract address (`0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`) on different chains. All DTO fields must use `assetId` format (`chain:369:erc20:0x...` vs `chain:1:erc20:0x...`), never symbol alone. Price observations must be keyed by `assetId`, never by symbol or address-only. The price observation schema must support both.

**Decision 10 — Fork-copy cost basis policy**
When a wallet held eHEX before the PulseChain fork, pHEX was created as a copy. Possible cost-basis policy options: (a) fork-copy assigns eHEX cost basis to pHEX, (b) pHEX from fork has zero cost basis, (c) manual override, (d) policy not set / unknown. This decision must be documented and stored in the DTO (`costBasisPolicy` field) before any PnL surface is enabled. Do not implement PnL until this field is populated and its meaning is tested.

---

## 9. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Frontend RPC** — team adds `stakeCount`/`stakeLists` reads to frontend hooks | HIGH | DTO-first architecture enforced by contract tests; CLAUDE.md rule; code review gate |
| **GPL code-copy** — reference implementation patterns copied without license review | HIGH | Reference used for domain research only; no file from reference project imported; code review gate |
| **pHEX/eHEX identity confusion** — symbol-only identity causes cross-chain accounting errors | HIGH | `assetId` enforced in all types; no symbol-only fields in HexMining DTOs; contract tests |
| **HSI/HTT complexity** — ownership indirection causes incorrect stake attribution | MEDIUM | HSI/HTT explicitly deferred to Phase 6; native-only for Phases 1-5 |
| **Ended stake discovery / rate limits** — explorer or RPC rate limiting causes truncated results | MEDIUM | Backend-only; explicit truncation warnings in DTO; raw observation caching; no silent drops |
| **dailyData/yield estimation error** — incorrect yield calculation presented as fact | MEDIUM | `yield.status: "estimated"` enforced; exact yield only on `endStake` confirmation; contract tests for estimation logic |
| **Big Pay Day modeling error** — BPD yield incorrectly applied or silently omitted | MEDIUM | Explicit `bpdYieldStatus` field; day 353 range calculation tested separately |
| **Cost basis / fork-copy policy** — PnL surfaces before policy is decided | HIGH | `valuation.status: "unsupported"` until Phase 7; `costBasisPolicy` field required before PnL; documented prerequisite |
| **Pricing/PnL policy** — mark price used without explicit source or staleness handling | HIGH | `pricing.status`, `pricing.source`, `pricing.staleAfterSeconds` required in all valued DTOs; `PriceObservation` must be persisted before Phase 7 |
| **Operator cost / performance** — stake scans across many wallets cause RPC overload | MEDIUM | Scan batched; `SyncRun` lifecycle enforces non-overlap; explicit scan cost warnings; rate limiting in backend service |
| **Reorg handling** — stake state diverges after chain reorg | LOW | Raw observations carry `blockHash`; reorg detection marks observations stale (REORGED, not deleted) |
| **currentDay drift** — HEX protocol day calculation used stale or estimated | LOW | `currentDay()` read on-chain at observation time; stored in observation record; not inferred from wall clock |

---

## 10. Explicit Non-Goals

The following are not part of HexMining V2 in any phase:

- Portfolio recommendations or investment advice of any kind
- Break-even scenario analysis
- Allocation optimizer
- DeFi or LP intelligence
- AI-powered insights
- Ethereum eHEX support in the first slice
- HSI/HTT in the first slice
- Ended stake discovery in the first slice
- Any frontend calculation of stake value, yield, PnL, or share math
- Any hardcoded or mock stake data in DTOs or frontend
- Any pricing truth that is not a persisted `PriceObservation` from a backend read
- GPL-licensed code of any kind
- Silent coercion of unavailable values to zero
- pDAI treated as $1
- Symbol-only stake or asset identity

---

## 11. Phase 4 Kickoff Decisions

This section documents the decisions that must be resolved or explicitly framed before any Phase 4 runtime code is written. Phases 0–3 are complete and merged. No Phase 4 implementation PR may open until these decisions are recorded here.

---

### 11.1 Phase completion summary (Phases 0–3 and Phase 4A)

| PR | Title | Scope |
|---|---|---|
| #188 | `docs(hexmining): define V2 roadmap` | This document (Phase 0) |
| #189 | `feat(hexmining): add Phase 1 DTO contract skeleton` | `types.ts`, `dto-contract.test.ts` |
| #190 | `feat(hexmining): add Phase 2 native PulseChain stake reader` | `reader.ts`, `reader.test.ts` |
| #191 | `feat(hexmining): expose GET /api/hexmining/stakes route` | API route + contract test |
| #192 | `feat(hexmining): add stakes API client and query hook` | `hexmining-client.ts`, `use-hexmining-stakes-query.ts`, tests |
| #193 | `feat(hexmining): add read-only HexMining page shell` | Screen component, nav config, UX tests, wiring tests |
| #194 | `docs(hexmining): define Phase 4 yield decisions` | §11 kickoff — yield status policy, Phase 4 guardrails, Decision 1/2 framing |
| #195 | `test(hexmining): define yield status contract` | `types.ts` yield widening; `yield-contract.test.ts` (53 tests) |
| #196 | `test(hexmining): enforce yield dto invariants` | `types.ts` discriminated union + BPD intersection; `yield-dto-invariants.test.ts` (44 tests) |
| #199 | `feat(hexmining): add observation persistence service contract` | `observation-store.ts`: `validateCanonicalPayload`, `computePayloadHash`, `persistHexDailyDataObservation` (with service-layer dedup), `persistHexDailyDataObservationInvalidation`; 76 tests |
| #200 | `feat(hexmining): expose observation status DTO` | `GET /api/hexmining/observations/status`; read-only DB-backed `HexMiningObservationStatusDto`; bigint-safe `observedAtBlock`; route + service contract tests |
| #201 | `fix(hexmining): report observation freshness and invalidation status` | Added `observedAt` to `HexMiningObservationStatusDto`; filtered invalidated observations with `invalidations: { none: {} }`; 4 new tests |
| #202 | `feat(hexmining): surface observation status in debug status` | `data.hexMining.observationStatus` in `GET /api/debug/status`; `hexMining` added to `debugStatusReportSchema` in `debug-client.ts` (discriminated union for available/missing/unavailable); 7 + 4 new tests |
| #203 | `docs(hexmining): define Phase 4 observation read boundary` | §11.10 updated with Step 2 acceptance criteria; §11.12 Phase 4B defined with scope, non-goals, and end-exclusive `dailyDataRange` semantics |
| #204 | `feat(hexmining): add dailyDataRange read boundary` | `src/services/hexmining/daily-data-reader.ts`: `readCurrentDay()`, `readDailyDataRangeObservation()`; PulseChain chain ID 369 only; pHEX `dailyDataRange` reads; persisted `rangeEndDay` is inclusive, RPC call uses `rangeEndDay + 1` (end-exclusive); `rawDailyData` remains `bigint[]` at read boundary; no persistence, yield, or UI in this PR |
| #205 | `feat(hexmining): wire dailyDataRange observations to persistence` | `acquireAndPersistHexDailyDataObservation()` in `src/services/hexmining/daily-data-observation-service.ts`; encodes `rawDailyData` `bigint[]` as deterministic base-10 decimal strings; validates canonical payload before persistence; persists via `persistHexDailyDataObservation()`; reuses `payloadHash`/dedup in `observation-store.ts`; no `canonicalPayload` exposure; no yield, UI, schema, or sync |
| #206 | `feat(hexmining): add observation admin route` | `POST /api/hexmining/observations`; disabled by default — returns 404 unless `HEXMINING_OBSERVATION_ADMIN_ENABLED=true`; gate fires before JSON parse, client construction, or service invocation; accepts inclusive `rangeStartDay`/`rangeEndDay`; validates via Zod; calls `acquireAndPersistHexDailyDataObservation()`; returns safe metadata only (`id`, `rangeStartDay`, `rangeEndDay`, `observedAtBlock`, `observedAt`, `warnings`); does not expose `canonicalPayload`, `rawDailyData`, or `payloadHash`; no yield, UI, schema, sync, or cron |
| #207 | `docs(hexmining): close Phase 4B observation evidence` | `docs/v2-hexmining-roadmap.md` only; Phase completion table and header updated for Phase 4B complete; §11.12 Phase 4B completion evidence record; §12 updated with Phase 4C estimator-contract as next PR |
| #208 | `feat(hexmining): add Phase 4C yield estimator contract` | `src/services/hexmining/yield-estimator.ts` (new), `tests/services/hexmining/yield-estimator.test.ts` (new); `estimateHexMiningYield(args, deps)` function; `HexMiningYieldEstimateResult` discriminated union; statuses: `estimated \| evidence_available \| insufficient_observations \| invalid_observation \| unavailable \| unsupported`; injectable `fetchEvidence` dep; no RPC, no yield math, no UI |
| #209 | `feat(hexmining): add yield observation evidence provider` | `src/services/hexmining/observation-evidence-provider.ts` (new), `tests/services/hexmining/observation-evidence-provider.test.ts` (new); `getObservationEvidenceForRange(args, deps)` queries persisted `RawHexDailyDataObservation` rows; returns `ObservationEvidenceMetadata` (no `canonicalPayload`/`payloadHash`/`rawDailyData` exposure); `payloadSchemaValid` flag from internal decode; chain guard (369 only); DB mock tests; no RPC |
| #210 | `feat(hexmining): add dailyData payload decoder` | `src/services/hexmining/daily-data-payload-decoder.ts` (new), `tests/services/hexmining/daily-data-payload-decoder.test.ts` (new); `decodeDailyDataPayload(canonicalPayload)` parses `{ schemaVersion: "v1", dailyData: [...] }` canonical payload; rejects numeric JSON values (§11.8), invalid root, missing fields; returns `readonly bigint[]`; 31 tests; **no packed uint72 decoding — each entry remains a raw packed bigint** |
| #211 | `docs(hexmining): record dailyData bit layout blocker` | `docs/v2-hexmining-roadmap.md` only; §11.13 added — full blocker record for packed decoder (what is complete, what is blocked, why, field-name clarification, guardrail, acceptance criteria); §12 updated with blocker state and unblocking path; Phase completion table and header updated for Phase 4C in-progress/blocked |
| #212 | `docs(hexmining): record verified dailyData uint256 packed bit layout and ABI discrepancy` | `docs/hex-dailydata-packing-spec.md` (new), `docs/v2-hexmining-roadmap.md` (updated) — full bit layout specification from three independent sources (on-chain ABI authoritative, JamJomJim/HEX.sol, kbahr/HexUtilities.sol); verified field layout table; TypeScript unpack formula; four deterministic test vectors; ABI discrepancy finding (§5); §11.13 updated with layout verified/ABI blocker |
| #213 | `fix(hexmining): correct dailyDataRange ABI from uint72[] to uint256[]` | `src/services/hexmining/daily-data-reader.ts` line 14: `uint72[]` → `uint256[]`; `rawDailyData` comment updated; ABI discrepancy resolved; no schema, no test logic, no re-acquisition required |
| #214 | `feat(hexmining): add dailyData packed uint256 entry decoder` | `src/services/hexmining/daily-data-packed-decoder.ts` (new), `tests/services/hexmining/daily-data-packed-decoder.test.ts` (new); `decodePackedDailyDataRange(packedValues: readonly bigint[])` returning `DecodedDailyDataEntry[]` with `dayPayoutTotal`, `dayStakeSharesTotal`, `dayUnclaimedSatoshisTotal` bigint fields; rejects negative or out-of-200-bit-range values; bit layout from `docs/hex-dailydata-packing-spec.md §2`; no yield math |
| #215 | `feat(hexmining): wire payload and packed decoders into yield estimator` | `src/services/hexmining/yield-estimator.ts` (updated); wires `decodeDailyDataPayload` (step 6) and `decodePackedDailyDataRange` (step 7) into `estimateHexMiningYield` pipeline; `EvidenceWithPayload` type carries `canonicalPayload` internally (never surfaced); `yield-estimator.test.ts` updated with decoder wiring tests |
| #216 | `feat(hexmining): add internal yield calculation boundary scaffold` | `src/services/hexmining/yield-estimator.ts` (updated); `defaultApplyCalculation` internal function scaffold (returns `calculation_not_implemented`); `YieldCalculationResult` internal type (`estimated \| calculation_not_implemented \| insufficient_formula_evidence`); injectable `applyCalculation` dep in `HexMiningYieldEstimatorDeps`; `yield-estimator.test.ts` updated |
| #217 | `feat(hexmining): wire stakeShares into HexMiningYieldEstimateArgs` | `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated); `stakeShares: bigint` added to `HexMiningYieldEstimateArgs`; `stakeShares <= 0n` validation guard (returns `invalid_observation` with `hexmining-yield-invalid-stake-shares` warning) |
| #218 | `docs(hexmining): add yield formula test vectors to packing spec` | `docs/hex-dailydata-packing-spec.md §8` (new section) — deterministic yield formula specification: per-day formula `(stakeShares × dayPayoutTotal) / dayStakeSharesTotal` (bigint floor, multiply-first, zero-division guard); five test vectors A–E covering single-day, multi-day, zero-shares guard, overflow-resistant multiply-first order, and large stakeShares; `docs/v2-hexmining-roadmap.md §11.10 Step 3` updated with "Prerequisite resolved (PR #218)" |
| #220 | `feat(hexmining): implement deterministic yield formula (§8 test vectors)` | `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated); `defaultApplyCalculation` implements §8 formula — `Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal` (bigint floor, multiply-first, `dayStakeSharesTotal === 0n` skip guard); §8 test vectors A–E verified via injectable `applyCalculation` |
| #221 | `feat(hexmining): Phase 4C — wire yield estimate into HexStakeDto` (scope-corrected) | `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated); **public output gated**: `estimateHexMiningYield` always returns `evidence_available` with `yieldHex: null` for valid evidence; `applyCalculation` runs at step 8 (internal pipeline proof) but its return value is not used in public output; `"estimated"` and non-null `yieldHex` require a separate future DTO/API contract approval PR — see §11.14 |
| #222 | `docs(hexmining): record Phase 4C yield-estimation gating decision` | `docs/v2-hexmining-roadmap.md` only; document header and Phase completion table updated; §11.1 extended with PRs #212–#221; §11.10 Step 3 updated with full PR delivery table; §11.14 added — gating decision record (decision, internal behavior, gate rationale, gate-lift prerequisites, review comment policy, internal evidence vs. public DTO distinction); §12 updated |
| #223 | `docs(hexmining): add EES penalty-distribution verification gate before public estimated yield` | `docs/v2-hexmining-roadmap.md` (updated), `docs/hex-dailydata-packing-spec.md` (updated); §11.14 updated with 7th prerequisite (EES verification); §11.15 added — full penalty-distribution verification gate; §12 updated; packing spec §8 "What is NOT included" updated with EES open question |
| #224 | `docs(hexmining): resolve EES penalty-distribution gate — Finding A confirmed from on-chain source` | `docs/hexmining-penalty-distribution-research.md` (new), `docs/v2-hexmining-roadmap.md` (updated), `docs/hex-dailydata-packing-spec.md` (updated); §11.14 item 7 marked RESOLVED; §11.15 status changed to RESOLVED (Finding A) with full resolution evidence, caveats, EES clarification, and scenario coverage; packing spec §8 EES entry resolved |
| #225 | `test(hexmining): add elapsed-days coverage rule to yield-estimator boundary` | `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated); step 5.5 elapsed-days coverage enforced: `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)`; `currentDay ≤ lockedDay` guard returns `insufficient_observations` with `hexmining-yield-no-elapsed-days`; evidence range gap returns `insufficient_observations` with `hexmining-yield-insufficient-elapsed-day-coverage`; public output remains `evidence_available` with `yieldHex: null` |
| #226 | `test(hexmining): add BPD attribution gate to yield-estimator boundary` | `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated); step 8.5 BPD attribution gate added: elapsed range including HEX protocol day 353 appends `hexmining-yield-bpd-attribution-unresolved` to result warnings; `const HEX_BPD_DAY = 353` constant added; public output remains `evidence_available` with `yieldHex: null` |
| #227 | `test(hexmining): verify §11.9 provenance and formula-input audit trail` | `tests/services/hexmining/yield-estimator.test.ts` (updated, test-only); 12 new tests in "§11.9 provenance and formula-input audit trail" describe block verify all five §11.9 minimum provenance fields (`chainId`, `sourceFamily`, `observationId`, `rangeStartDay`, `rangeEndDay`) already present in `HexMiningYieldEstimateProvenance`; no source changes required |
| #228 | `test(hexmining): reader/route gated wiring contract tests` | `tests/services/hexmining/reader.test.ts` (updated), `tests/api/hexmining-stakes-route-contract.test.ts` (updated); test-only; 5 new reader tests (BPD-era, overdue, unknown-day, multi-stake, serialized regression) and 4 new route contract tests (multi-stake, BPD warning pass-through, serialized regression, error-path no yield fields) verify gate preserved at reader and route layers; public output remains `evidence_available` / `yieldHex: null` |

Post-merge audit (2026-06-08, after PR #202): all 1354 tests pass, lint clean, typecheck clean, build clean, no guardrail violations.

Post-merge audit (2026-06-08, after PR #206): all 1421 tests pass, lint clean, typecheck clean, build clean, no guardrail violations.

Post-merge audit (2026-06-09, after PR #210): tests pass, lint clean, typecheck clean, build clean, no guardrail violations. Phase 4C partial — packed uint72 decoder blocked (see §11.13).

Post-merge audit (2026-06-09, after PR #211): docs-only; lint clean, typecheck clean. Bit layout still unverified at this audit point (blocker record added, evidence PR pending).

Post-merge audit (2026-06-10, after PR #221): 1539 tests pass, lint clean, typecheck clean, build clean, no guardrail violations. Phase 4C formula implementation merged and gated — `estimateHexMiningYield` runs `applyCalculation` internally but public output is `evidence_available` (see §11.14).

Post-merge audit (2026-06-10, after PR #228): 1586 tests pass, lint clean, typecheck clean, no guardrail violations. Phase 4C internal pipeline complete and gate-preserved at estimator, reader, and route layers — elapsed-days coverage (PR #225), BPD attribution gate (PR #226), provenance audit trail (PR #227), reader/route gate wiring tested (PR #228). See §11.14 for remaining gate-lift prerequisites.

---

### 11.2 Decision 1 — Raw observation model for dailyData/yield inputs

**Status: RESOLVED — persist raw dailyData observations as `RawHexDailyDataObservation` records.**

**Background:**

Phase 2 is a pure read-through: RPC calls produce a `HexStakeListDto` that is returned directly to the API caller. No observation record is written to the database. This is correct for Phase 2 (active stake state is cheap to re-read). Phase 4 adds `dailyDataRange` reads, which are substantially different:

- `dailyDataRange(startDay, endDay)` returns historical per-day payout/share data.
- These reads are expensive and may be rate-limited on public RPC endpoints.
- The same data range does not change once the days have passed (historical, not live state).
- Without persistence, every request re-reads the full day range from RPC. This is operationally unsafe at scale.
- Provenance without persistence means there is no audit trail for how a yield estimate was derived.

**Decision: persist raw dailyData observations (Option A).**

Introduce a new `RawHexDailyDataObservation` model to cache `dailyDataRange` results keyed by `(chainId, rangeStartDay, rangeEndDay, observedAtBlock)`. Yield estimates are derived from persisted data, not live RPC. This satisfies CoinPulse's raw-audit-immutability rule and enables deterministic rebuild.

**Why this is the only production-viable path:**
- CoinPulse's architecture requires all ingested data to be immutable raw audit evidence. "RPC is ingestion input only — never frontend truth" applies equally to backend-only reads.
- Yield estimates must be deterministically reproducible during a full rebuild. Without persisted observations, a rebuild cannot verify or reproduce a historical yield estimate.
- `dailyDataRange` data for past days is stable (historical days do not change), making it safe and correct to persist once and reuse. Re-reading the same historical range on every request wastes RPC budget.
- Persisted provenance (which block, which endpoint, which timestamp) enables independent validation of the yield estimate.

**Option B — Live read-through without persistence (spike/investigation only, never merged):**

A live read-through approach (no persistence, `dailyDataRange` called on-demand) is useful as a local spike to validate RPC contract shape and rate-limit behavior before the Option A schema is designed. **Option B must not be merged to production.** Any spike branch must be explicitly marked `[SPIKE — do not merge]` and discarded before the Phase 4 implementation PR is opened. A PR review of an Option B spike will be rejected at the gate.

**Conceptual model name:** `RawHexDailyDataObservation`

The exact Prisma model name, fields, and migration are defined in the persistence contract PR (§11.10, Step 1). See §11.8 for the observation identity and key shape specification.

**What this decision unlocks:** The Phase 4 implementation PR now knows it requires a schema migration for `RawHexDailyDataObservation`, and the DTO `provenance` shape for yield references `observationId` foreign keys. See §11.9 for the minimum provenance fields required before `yield.status: "estimated"` may be set.

---

### 11.3 Decision 2 — Source family for HexMining yield inputs

**Status: RESOLVED — new `HEXMINING` source family (additive schema migration deferred to Phase 4 implementation PR).**

**Background:**

The existing `SourceFamily` enum in `prisma/schema.prisma` includes `STAKING` (used for V1 `startStake`/`endStake` event ingestion) alongside `TRANSFERS`, `DEX`, `LP`, `NATIVE`. Phase 2 native stake reads do not use `SyncRun` or `SyncCursor` — they are on-demand reads, not syncs. Phase 4 `dailyDataRange` reads will be tracked as sync operations once they are batched and persisted (Decision 1 resolved to Option A).

**Decision: new `HEXMINING` source family.**

`dailyDataRange` observations and HexMining read-model scans use a new `HEXMINING` source family, distinct from the existing `STAKING` event family.

**Rationale:**

- V1 `STAKING` event ingestion (startStake/endStake transactions) and V2 HexMining read-model observations (stakeCount/stakeLists scans, dailyDataRange reads) are fundamentally different operations:
  - `STAKING`: event-driven, transaction-indexed, one record per stake lifecycle event.
  - `HEXMINING`: read-model-driven, periodic full-wallet scans, day-range batch reads for yield estimation.
- Conflating them in `SyncCursor` and `SyncRun` records would make it impossible to distinguish "this wallet's stake events have been ingested" from "this wallet's active stake state has been scanned."
- A dedicated `HEXMINING` source family makes the read-model provenance explicit in all sync lifecycle records, audit queries, and DTO responses.
- Adding `HEXMINING` to the `SourceFamily` enum is an additive schema change — it does not modify or touch existing `STAKING` records. The migration risk is low.

**Migration timing:** The `HEXMINING` enum value is added in the Phase 4 schema migration PR (§11.10, Step 2). It is not added in this docs PR or any prior PR.

**What this decision does NOT change:**
- Existing `STAKING` event records and sync cursors are untouched.
- Phase 2 active stake reads (stakeCount/stakeLists) continue to operate without SyncRun tracking — they are on-demand reads, not batched syncs.
- No new `SyncCursor` or `SyncRun` entries are created until `dailyDataRange` batch persistence is implemented in Step 4.

---

### 11.4 Yield status policy

**Status: RESOLVED — documented here for implementation reference.**

`HexYieldStatus` is defined in `src/services/hexmining/types.ts` (updated in PR #194 to add `"unavailable"`):

```typescript
export type HexYieldStatus = "unsupported" | "unavailable" | "estimated" | "exact";
```

The complete vocabulary and its promotion rules are:

| Status | Meaning | Promotion condition |
|---|---|---|
| `"unsupported"` | `dailyDataRange` reads not yet implemented. The backend has no mechanism to produce a yield figure. Current state for all stakes in Phases 1–3. | Never promoted until Phase 4 `dailyDataRange` implementation is merged and stable. |
| `"unavailable"` | `dailyDataRange` reads are implemented but data cannot be produced for this specific stake at this time (rate limit hit, day-range gap, stale data, null `observedAtBlock`). | Set whenever reads are implemented but a specific condition prevents producing a valid estimate. Clears to `"estimated"` only when all promotion conditions are met on a subsequent read. |
| `"estimated"` | Backend has read sufficient `dailyDataRange` data to compute a per-stake estimated yield. The estimate is an approximation — exact yield is only known at `endStake`. | Only set by the backend when: (a) `dailyDataRange` data is available and not stale for all **elapsed active days** (`lockedDay` through `min(currentDay, lockedDay + stakedDays)`), (b) the observation carries a valid `observedAtBlock` and `observedAt`, and (c) all day-range data is complete (no gaps). If any of these conditions fail, status must be `"unavailable"`, not `"estimated"`. |
| `"exact"` | Yield confirmed on-chain at `endStake`. Only available when the stake has ended and the `endStake` transaction has been indexed with confirmed yield. Phase 5+ scope. | Only set by the backend when an `endStake` event has been ingested and the `STAKE_YIELD_RECEIVED` ledger entry is present. Never inferred from `dailyDataRange` estimates. |

**Critical invariants — these must be enforced in tests before implementation:**

1. `yield.status` is set exclusively by the backend reader. The frontend never infers, upgrades, or defaults it.
2. `"unsupported"` → `"estimated"` promotion requires complete, non-stale `dailyDataRange` coverage for the stake's **elapsed active days** — an inclusive range: `rangeStartDay = lockedDay` through `rangeEndDay = min(currentDay, lockedDay + stakedDays - 1)`. Note: `lockedDay + stakedDays` is the first day *after* the stake's committed duration; subtracting one gives the last day within the stake's active period. Future days beyond `currentDay` have no dailyData yet and are excluded from the required range. Partial coverage of elapsed days produces `"unavailable"`, not `"estimated"`.
3. `"estimated"` → `"exact"` promotion requires an indexed `endStake` event with a confirmed `STAKE_YIELD_RECEIVED` ledger entry. It is never promoted from estimate alone.
4. `"estimated"` must always be accompanied by a non-null `estimatedYieldHex` value and a provenance block carrying `observedAtBlock`, `observedAt`, and the day range used.
5. Big Pay Day (`bpdYieldHex`) is separate from general yield. BPD yield is only attributed when `bpdYieldStatus: "applicable"` is confirmed. It is never silently included in `estimatedYieldHex`.
6. Missing, stale, rate-limited, or partial `dailyDataRange` data must produce `status: "unavailable"` with an explicit warning, not a partial estimate passed off as complete.

---

### 11.5 When yield.status must remain "unsupported" or "unavailable"

**"unsupported"** — use when `dailyDataRange` reads are not yet implemented or the backend has no yield read path for this stake:
- All stakes in Phases 1–3 (current state).
- After Phase 4 launches, stakes on unsupported chains (not 369) continue to show `"unsupported"`.
- HSI/HTT stakes before Phase 6 show `"unsupported"`.

**"unavailable"** — use when `dailyDataRange` reads are implemented but data cannot be produced for this specific stake at this time:
- RPC rate limit hit during `dailyDataRange` read.
- `dailyDataRange` returned a gap — some days in the stake's range are missing.
- `currentDay()` could not be read (cannot determine the stake's active day range).
- `observedAtBlock` is `null` or `"unknown"` (provenance insufficient for an auditable estimate).
- Data is stale beyond a configured freshness threshold.

**Neither status may be silently coerced to zero or to an estimated value.** If yield data is unavailable, the DTO must show `"unavailable"` with an explicit warning string (e.g., `"hexmining-yield-data-gap-day-1234"`, `"hexmining-yield-rpc-rate-limited"`).

---

### 11.6 What Phase 4 must NOT include

These guardrails apply to every Phase 4 implementation PR, regardless of what is being added:

- No live-network tests (all RPC reads must use mock clients matching `HexMiningReadClient` interface pattern).
- No frontend calculation of yield, APY, BPD, or any financial value.
- No frontend RPC reads (`dailyDataRange`, `globalInfo`, `currentDay` are backend-only).
- No pricing, valuation, or PnL — those remain `status: "unsupported"` until Phase 7.
- No HSI/HTT stake source families.
- No ended stake discovery.
- No Ethereum/eHEX support.
- No cross-chain yield aggregation.
- No silent coercion of partial or missing yield data to zero or to an estimate.
- No schema migration until Decision 1 and Decision 2 are resolved and documented here.
- No `dailyDataRange` implementation PR until a test-first contract PR has established the `status: "estimated"` invariants and the `HexStakeYieldDto` type widening is contract-tested.

---

### 11.7 Phase 4 test-first contract — completed

**Status: COMPLETE — PRs #195 and #196 fulfilled this work. See §11.10 for the next step.**

The yield status contract test work has been completed in two PRs:

**PR #195 — `test(hexmining): define yield status contract`**
- Widened `HexStakeYieldDto` from `HexMiningUnsupportedStatus`-only to the full `HexYieldStatus` discriminated union (`"unsupported" | "unavailable" | "estimated" | "exact"`).
- Added `yield-contract.test.ts` with 53 tests covering:
  - `"unsupported"` state invariants (all fields null)
  - `"unavailable"` state invariants (distinct from `"unsupported"` — reads implemented but data absent)
  - `"estimated"` state invariants (non-null `estimatedYieldHex` required, BPD correlation rules)
  - `"exact"` state invariants
  - BPD attribution rules
  - Elapsed-days-only coverage rule (future days excluded)

**PR #196 — `test(hexmining): enforce yield dto invariants`**
- Refactored `HexStakeYieldDto` into a fully discriminated union with named member types (`UnsupportedYieldDto`, `UnavailableYieldDto`, `EstimatedYieldDto`, `ExactYieldDto`).
- Added `HexStakeBpdYieldFields` intersection type enforcing BPD field correlation at the type level:
  - `"applicable"` → `bpdYieldHex: string`
  - `"not_applicable"` → `bpdYieldHex: null`
  - `"unknown"` → `bpdYieldHex: null`
- Added `yield-dto-invariants.test.ts` with 44 `@ts-expect-error` compile-time regression guards.

**Combined result:** All four yield states are contract-tested before any live reader code uses them. The `HexStakeYieldDto` type enforces field shape and BPD field correlation at compile time. 1265 tests pass.

**Immediate next PR:** See §11.10, Step 1 — persistence contract test PR.

---

### 11.8 Observation identity and key shape

**Status: RESOLVED — documented here for the persistence contract PR (§11.10, Step 1).**

Each `RawHexDailyDataObservation` record represents a single `dailyDataRange(startDay, endDay)` RPC call result, persisted with full call-level provenance.

**Three distinct concepts — identity key, dedupe key, canonical-selection policy — must not be conflated:**

**Primary identity key (per-row surrogate):**

Each persisted row has a unique `observationId` (surrogate, e.g. UUID or auto-increment) assigned at write time. This is the foreign key referenced by yield provenance (`observationIds` in §11.9). Two calls that read the same day range at the same block from different endpoints or retry attempts produce two separate rows, each with a distinct `observationId`.

**Deduplication key (call-level uniqueness check):**

Before writing a new row, the persistence service checks whether an observation with identical parameters already exists. The dedupe key is:

| Field | Type | Description |
|---|---|---|
| `chainId` | `number` | Chain on which the read was made (369 for pHEX) |
| `sourceFamily` | `string` | Always `"HEXMINING"` for dailyData reads |
| `rangeStartDay` | `number` | `startDay` argument passed to `dailyDataRange` |
| `rangeEndDay` | `number` | **Inclusive** last day of the read range. The stored value is the inclusive upper bound. The RPC call uses `rangeEndDay + 1` as the `endDay` argument because `dailyDataRange(beginDay, endDay)` is end-exclusive (the contract returns data for days `[beginDay, endDay)`). |
| `observedAtBlock` | `string` | Block number (as string) at time of read |
| `rpcEndpointLabel` | `string \| null` | Labeled identifier for the RPC endpoint used (hashed/configured, never raw URL) |
| `payloadHash` | `string` | Hash of the canonical serialized payload (see encoding below) |

If a row with an identical dedupe key already exists, the write is skipped (idempotent re-reads of the same block/range/endpoint produce one row). Observations from different endpoints or with different payload content are never collapsed — they are distinct rows.

**Additional fields on each observation record:**

| Field | Type | Description |
|---|---|---|
| `observedAt` | `string` | ISO 8601 timestamp at time of read |
| `payloadVersion` | `string` | Schema version of the stored payload (e.g., `"v1"`). Allows future decoding changes without re-fetching. |
| `rawDailyDataPayload` | `string` | Canonical bigint-safe JSON encoding of the `dailyDataRange` response (see encoding policy below). Immutable once written. |
| `warnings` | `string[]` | Any warnings from the read (rate-limit proximity, truncation, etc.). |

**Bigint-safe payload encoding policy:**

viem returns `dailyDataRange` results with `uint*` fields as JavaScript `bigint` values. `JSON.stringify` throws on `bigint`; naive encoding is unsafe. The canonical encoding rule is:

- All `uint*` and `int*` contract values from `dailyDataRange` are serialized as **base-10 decimal strings** (not hex, not JavaScript numbers).
- No JavaScript `bigint` values are stored directly in JSON.
- Serialization must be deterministic: fields in a fixed order, no extra whitespace, no locale-dependent formatting.
- `payloadHash` is computed over the canonical serialized payload (e.g., SHA-256 hex of the UTF-8 bytes). If payload content changes between retries, the hash differs and a new row is written.
- PR #199 includes test fixtures using viem-shaped `bigint` input and asserts that the persisted payload contains decimal strings.

**Canonical-selection policy (yield derivation):**

When multiple `RawHexDailyDataObservation` rows cover an overlapping day range (e.g., from different endpoints or retries at different blocks), the yield estimator selects the canonical observation by policy:
- Prefer the observation with the highest `observedAtBlock` (most recent read).
- Among observations at the same block, prefer the row with no `warnings`.
- Among otherwise equal rows, prefer the row from the primary configured RPC endpoint.
- The selection policy is implemented in the yield estimator (Phase 4C), not in the persistence layer.

**Retention policy:**

Observation rows are append-only and immutable. A later read of the same range at a newer block produces a new row; existing rows are never updated or deleted. See reorg invalidation policy below.

**Reorg invalidation — append-only:**

If a chain reorg invalidates an observation (the block it was read at is orphaned), CoinPulse does NOT mutate the existing row. Instead, the persistence layer appends a separate invalidation record (e.g., `RawHexDailyDataObservationInvalidation`) referencing the original `observationId` and recording the reorg event. The raw observation row remains immutable evidence. The exact model name for the invalidation record was decided in PR #199.

**Not in this document:** The exact Prisma model field names, indexes, and foreign key relationships were defined in PR #199.

---

### 11.9 Minimum provenance for "estimated" yield DTO

**Status: RESOLVED — documented here for Phase 4 reader implementation.**

For a `HexStakeDto` to carry `yield.status: "estimated"`, the backend reader must have recorded and can reference all of the following:

| Provenance field | Source | Description |
|---|---|---|
| `chainId` | stake read | Chain on which the observations were made |
| `walletAddress` | stake read | Wallet whose stake is being estimated |
| `stakeId` | stake read | Stake identity (uint40 as string) |
| `stakeIndex` | stake read | Wallet-relative index at time of read |
| `stakeSource` | stake read | `"native"` (Phase 4 scope) |
| `rangeStartDay` | computed | `lockedDay` — first day of estimated range |
| `rangeEndDay` | computed | `min(currentDay, lockedDay + stakedDays - 1)` — last elapsed day (inclusive; `lockedDay + stakedDays` is the first post-stake day) |
| `observedAtBlock` | observation record | Block at which dailyData observations were read |
| `observedAt` | observation record | Timestamp of observations |
| `observationIds` | observation record(s) | Foreign key(s) to `RawHexDailyDataObservation` row(s) used in the estimate |
| `warnings` | reader | Any gap, rate-limit, or staleness warnings |

**Invariant:** If any of these provenance fields cannot be populated (e.g., `observedAtBlock` is null, `rangeEndDay` < `rangeStartDay`, an observation record cannot be located), the reader must set `yield.status: "unavailable"` with an explicit warning. It must never produce `"estimated"` with incomplete provenance.

**`rangeEndDay` computation note:** Phase 4 yield estimates cover only **elapsed active days** (inclusive range). Future days beyond `currentDay` have no `dailyDataRange` data and are excluded. The required range is `lockedDay` through `min(currentDay, lockedDay + stakedDays - 1)`. Here `lockedDay + stakedDays` is the first day after the stake's committed duration; subtracting one gives the last day within the active period. This matches §11.4 invariant #2 exactly. If the stake has not yet started (`lockedDay > currentDay`), no elapsed days exist and the status must be `"unavailable"`.

**BPD provenance:** Big Pay Day yield (`bpdYieldHex`) requires its own provenance: confirmation that the stake's `[lockedDay, lockedDay + stakedDays)` range includes protocol day 353. BPD yield is never inferred or silently included in `estimatedYieldHex`. See §11.4 invariant #5.

---

### 11.10 Phase 4 implementation sequence

**Status: RESOLVED — five ordered steps, each a separate PR, preserving the CoinPulse architecture guardrails. Step 1 is complete (PR #199).**

No step may be skipped. No yield calculation reaches production before Step 3 (Phase 4C).

**Step 1 — Schema contract and persistence tests PR ✅ COMPLETE (PR #199)**
`feat(hexmining): add raw dailyData observation schema contract`
- Added `RawHexDailyDataObservation` model to `prisma/schema.prisma`.
- Added `HEXMINING` to `SourceFamily` enum.
- Added persistence service (`validateCanonicalPayload`, `computePayloadHash`, `persistHexDailyDataObservation`, `persistHexDailyDataObservationInvalidation`) with service-layer dedup.
- Contract tests: model key shape, dedupe invariant, canonical-selection policy, bigint-safe encoding (§11.8), provenance completeness invariant (§11.9).
- No reader, no RPC calls, no yield calculation, no API routes, no frontend.

**Step 2 — `dailyDataRange` read boundary PR (Phase 4B) ✅ COMPLETE (PRs #204, #205, #206)**
`feat(hexmining): add dailyDataRange read boundary` / `feat(hexmining): wire dailyDataRange observations to persistence` / `feat(hexmining): add observation admin route`
- `readCurrentDay()` and `readDailyDataRangeObservation()` in `src/services/hexmining/daily-data-reader.ts` — PulseChain chain ID 369 only.
- `dailyDataRange(rangeStartDay, rangeEndDay + 1)` RPC call — HEX contract `endDay` is end-exclusive; stored `rangeEndDay` is inclusive.
- `rawDailyData` remains `bigint[]` at the read boundary; encoding happens in the persistence wiring layer.
- `acquireAndPersistHexDailyDataObservation()` in `daily-data-observation-service.ts` encodes `rawDailyData` as base-10 decimal strings, validates via `validateCanonicalPayload()`, persists via `persistHexDailyDataObservation()`.
- `POST /api/hexmining/observations` admin route gated behind `HEXMINING_OBSERVATION_ADMIN_ENABLED=true`; returns 404 before any processing when not set.
- No yield calculation, no APY, no pricing, valuation, PnL, no schema/migration, no frontend.
- `canonicalPayload`, `rawDailyData`, and `payloadHash` are never exposed through any DTO or API response.

**Step 3 — Yield estimation PR (Phase 4C) — FORMULA IMPLEMENTED / PUBLIC OUTPUT GATED**

Phase 4C formula pipeline is complete and merged. The following PRs have landed:

| PR | What was delivered |
|---|---|
| #208 | yield estimator contract (`estimateHexMiningYield`) — statuses, deps, provenance; no yield math |
| #209 | observation evidence provider (`getObservationEvidenceForRange`) — reads persisted rows, returns `ObservationEvidenceMetadata`; no `canonicalPayload` exposure |
| #210 | canonical payload decoder (`decodeDailyDataPayload`) — parses `{ schemaVersion: "v1", dailyData: [...] }` to `readonly bigint[]` |
| #212 | bit layout specification in `docs/hex-dailydata-packing-spec.md`; ABI discrepancy record |
| #213 | ABI fix — `daily-data-reader.ts` `uint72[]` → `uint256[]` |
| #214 | packed uint256 entry decoder (`decodePackedDailyDataRange`) — `DecodedDailyDataEntry[]` |
| #215 | decoder wiring — payload decode (step 6) and packed decode (step 7) wired into `estimateHexMiningYield` |
| #216 | internal calculation boundary scaffold — injectable `applyCalculation` dep; `YieldCalculationResult` type |
| #217 | `stakeShares: bigint` added to `HexMiningYieldEstimateArgs`; `stakeShares <= 0n` guard |
| #218 | §8 yield formula test vectors documented in `docs/hex-dailydata-packing-spec.md` |
| #220 | `defaultApplyCalculation` implements §8 formula — `Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal`; §8 vectors A–E verified |
| #221 | **public output gated** — `applyCalculation` runs internally at step 8 (pipeline proof) but result is not used in public output; public function always returns `evidence_available` with `yieldHex: null` |
| #225 | **elapsed-days coverage rule** — step 5.5 added: `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)`; `currentDay ≤ lockedDay` → `insufficient_observations` (`hexmining-yield-no-elapsed-days`); evidence range gap check → `insufficient_observations` (`hexmining-yield-insufficient-elapsed-day-coverage`); public output unchanged |
| #226 | **BPD attribution gate** — step 8.5 added: `const HEX_BPD_DAY = 353`; elapsed range includes day 353 → `hexmining-yield-bpd-attribution-unresolved` appended to warnings; gate is additive (no change to `evidence_available` status or `yieldHex: null`) |
| #227 | **§11.9 provenance audit trail** — test-only; 12 tests verified all five §11.9 minimum provenance fields already present in `HexMiningYieldEstimateProvenance`; no source changes required |
| #228 | **reader/route gated wiring contract tests** — test-only; 5 reader tests + 4 route contract tests verify gate preserved at reader layer (BPD-era, overdue, unknown-day, multi-stake, serialized regression) and route layer (multi-stake, BPD warning pass-through, serialized regression, error path) |

**Current public behavior (after PR #228):** `estimateHexMiningYield` runs the §8 formula internally at step 8 (proven via injectable `applyCalculation` dep in tests), enforces elapsed-days coverage at step 5.5, appends BPD attribution warning at step 8.5 when applicable, and always returns `status: "evidence_available"`, `yieldHex: null` at step 9. The reader (`reader.ts`) hardcodes `yield: { status: "unsupported", ... }` and has no connection to `estimateHexMiningYield`. The route passes reader output through unchanged. The `"estimated"` and non-null `yieldHex` paths exist in the `HexMiningYieldEstimateResult` type for forward compatibility but are not returned publicly. See §11.14 for the gating decision record.

**Remaining Step 3 scope:** All internal estimator-boundary gates — elapsed-days coverage rule, BPD attribution gate, §11.9 provenance audit trail, and reader/route gate-preservation contract tests — are now satisfied. The remaining work is Step 4: wiring estimated yield into `HexStakeDto` and the API route, satisfying gate-lift prerequisites 4–6 and 8–11 in §11.14.

**Step 4 — Yield DTO wiring and API route update PR**
`feat(hexmining): wire estimated yield fields into HexStakeDto and API route`
- Update `HexStakeDto` yield field assembly in the reader/assembler.
- Update `GET /api/hexmining/stakes` to return yield fields.
- Contract tests for the full DTO including yield fields.
- `valuation.status` and `pnl.status` remain `"unsupported"`.
- Files in scope: `src/app/api/hexmining/`, `src/services/hexmining/`, `tests/`.

**Step 5 — Frontend yield display PR**
`feat(hexmining): display yield estimate on HexMining page`
- Add yield fields to the HexMining page display.
- Read-only. No frontend calculation. Status-explicit (`"estimated"` displayed distinctly from `"exact"`).
- BPD yield attribution displayed separately from general yield when `bpdYieldStatus: "applicable"`.
- Files in scope: `src/app/hexmining/`, frontend components only.

**Guardrails that apply to every step in Phase 4:**
- No live-network RPC tests (all reads use mock `HexMiningReadClient`).
- No frontend yield, APY, BPD, or financial calculation.
- No frontend RPC reads (`dailyDataRange`, `globalInfo`, `currentDay` are backend-only).
- No pricing, valuation, or PnL (remain `status: "unsupported"` until Phase 7).
- No HSI/HTT source families.
- No ended stake discovery.
- No Ethereum/eHEX support.
- No cross-chain yield aggregation.
- No silent coercion of partial or missing yield data to zero or to an estimate.
- No yield calculation before Step 3 (Phase 4C).

---

### 11.11 Phase 4A completed work — observation persistence and status surface

**Status: COMPLETE — merged PRs #199–#202.**

The four PRs in this sub-phase delivered the operator observability surface for persisted `RawHexDailyDataObservation` records. They are a prerequisite for Phase 4B but do not themselves introduce any dailyDataRange read logic, yield calculation, or schema beyond what was already in place.

#### What was completed

| Area | What was added |
|---|---|
| Persistence service contract | `src/services/hexmining/observation-store.ts`: `validateCanonicalPayload()`, `computePayloadHash()`, `persistHexDailyDataObservation()` (with service-layer dedup), `persistHexDailyDataObservationInvalidation()` |
| Canonical payload validation | Rejects any observation whose `canonicalPayload` contains a numeric JSON value (§11.8 bigint-safe policy). Throws before hashing or writing. |
| Service-layer dedup | `findFirst` with `(chainId, sourceFamily, rangeStartDay, rangeEndDay, observedAtBlock, rpcEndpointLabel, payloadHash)` dedupe key before `create`; returns existing row ID without error if already present |
| Observation status route | `GET /api/hexmining/observations/status` — read-only, DB-backed, returns `HexMiningObservationStatusDto` |
| `observedAt` freshness | Status DTO includes both `observedAt` (RPC read timestamp) and `createdAt` (DB insert timestamp) in `latestObservation` |
| Invalidation-safe semantics | `findFirst` uses `invalidations: { none: {} }` to exclude any observation that carries a `RawHexDailyDataObservationInvalidation` row; returns `status: "missing"` when all observations are invalidated |
| Debug/status surface | `GET /api/debug/status` now includes `data.hexMining.observationStatus` (full DTO, or `{ status: "unavailable" }` on service failure) via the existing `getHexMiningObservationStatus()` service — no DB truth logic duplicated |
| Client schema alignment | `debugStatusReportSchema` in `src/lib/api/debug-client.ts` includes `hexMining.observationStatus` as a discriminated union (`available` \| `missing` \| `unavailable`) so Zod does not strip the field for `fetchDebugStatus` / `useDebugStatusQuery` consumers |

#### Truth and status model established by Phase 4A

These rules govern all HexMining observation status surfaces. They must be preserved in every subsequent PR.

**Persistence truth:**
- PostgreSQL-persisted `rawHexDailyDataObservation` rows are the backend source of truth for operator status.
- RPC is upstream ingestion input only. Frontend code never calls RPC. Backend readers call RPC and persist the result.
- `canonicalPayload` is stored in the DB and validated before persistence; it is never exposed through status or debug DTOs. Status routes expose metadata only (`id`, `rangeStartDay`, `rangeEndDay`, `observedAtBlock`, `rpcEndpointLabel`, `payloadHash`, `observedAt`, `createdAt`).

**Timestamp semantics:**
- `observedAt` = the ISO timestamp at which the RPC read was taken (set by the caller before calling `persistHexDailyDataObservation`).
- `createdAt` = the ISO timestamp at which the row was inserted into the database (set by the DB via `@default(now())`).
- These two fields are distinct and both must be present in the status DTO. `observedAt` is the freshness signal for consumers; `createdAt` is the persistence audit timestamp. Neither replaces the other.

**Invalidation semantics:**
- Invalidated observations must never be silently returned as usable `"available"` observations.
- The `findFirst` where clause must always include `invalidations: { none: {} }` to exclude rows with a `RawHexDailyDataObservationInvalidation` record.
- When all observations are invalidated (or none exist), the status is `"missing"` — not an error, not `"available"` with a warning.

**Debug/status service contract:**
- `GET /api/debug/status` surfaces `data.hexMining.observationStatus` by calling `getHexMiningObservationStatus()` from the existing service.
- The debug/status aggregation must not duplicate the raw DB query logic — it reuses the service.
- Service failure in the hexmining path is caught and sanitized to `{ status: "unavailable" }` without leaking internals; the overall `/api/debug/status` route remains HTTP 200.

**Client schema alignment:**
- `debugStatusReportSchema` in `src/lib/api/debug-client.ts` must stay aligned with the `GET /api/debug/status` response shape.
- Any future addition to `data.hexMining` must be reflected in the Zod schema in the same PR that adds the backend field, so Zod does not silently strip the new field for `fetchDebugStatus` / `useDebugStatusQuery` consumers.

---

### 11.12 Phase 4B completed work — dailyDataRange read boundary, persistence wiring, and gated operator route

**Status: COMPLETE — merged PRs #204, #205, #206.**

#### Slice name

**Phase 4B: HexMining raw dailyDataRange observation read boundary**

#### What was completed

Phase 4A established the persistence layer and operator status surface. Phase 4B delivered the bounded backend read/ingest path that acquires raw `dailyDataRange` payloads from the PulseChain HEX contract, encodes them safely, validates them, persists them as `RawHexDailyDataObservation` records, and exposes a gated admin route for operator-triggered ingestion.

Phase 4B does not compute yield. It does not estimate APY. It does not expose any financial value. Its responsibility is obtaining, validating, and persisting the raw `dailyDataRange` payload for a requested day range on chain ID 369, making persisted observations available for a future yield estimator.

#### What was not included — preserved for Phase 4C

The following were explicitly excluded from Phase 4B and must not be treated as already implemented:

#### What was delivered

- `src/services/hexmining/daily-data-reader.ts`: `readCurrentDay()` (lightweight RPC call returning the current HEX protocol day) and `readDailyDataRangeObservation()` (acquires `dailyDataRange` payload for a requested day range on chain ID 369).
- `readDailyDataRangeObservation()` calls `dailyDataRange(rangeStartDay, rangeEndDay + 1)` — the HEX contract's `endDay` argument is end-exclusive; the stored `rangeEndDay` is inclusive.
- `rawDailyData` is `bigint[]` at the read boundary; it is not encoded at the reader level.
- `src/services/hexmining/daily-data-observation-service.ts`: `acquireAndPersistHexDailyDataObservation()` encodes `rawDailyData` as base-10 decimal strings per §11.8, validates via `validateCanonicalPayload()`, persists via `persistHexDailyDataObservation()`, and returns the persisted `observationId` (or existing row ID on dedup match).
- `app/api/hexmining/observations/route.ts`: `POST /api/hexmining/observations` admin route; returns 404 unless `HEXMINING_OBSERVATION_ADMIN_ENABLED=true`; gate fires before JSON parse, client construction, or service invocation; accepts inclusive `rangeStartDay`/`rangeEndDay`; validates via Zod; returns safe metadata only.
- `canonicalPayload`, `rawDailyData`, and `payloadHash` are never exposed through any DTO or API response.
- Full test coverage with mock RPC clients — no live network calls in tests.

#### Phase 4B guardrails preserved

- PostgreSQL-persisted `RawHexDailyDataObservation` rows are the backend source of truth.
- RPC is upstream ingestion input only — `dailyDataRange` reads are backend-only; the frontend never calls RPC.
- `canonicalPayload` is raw evidence input, not accounting truth. It is stored but never interpreted by Phase 4B code.
- Frontend consumes backend DTOs only. Phase 4B added no frontend components, React hooks, or TanStack Query hooks.
- `valuation.status` and `pnl.status` remain `"unsupported"` — unchanged by Phase 4B.

#### What was not included — preserved for Phase 4C

The following were excluded from Phase 4B and remain deferred. Phase 4C must observe all of them:

| Deferred item | Phase 4C constraint |
|---|---|
| Yield calculation | Phase 4C must consume **persisted** `RawHexDailyDataObservation` rows — must not call `dailyDataRange` RPC directly from yield logic. |
| Estimated APY | Derived from yield; Phase 4C or later. |
| Pricing, valuation, PnL | Phase 7. Must not appear in Phase 4C. `valuation.status` and `pnl.status` remain `"unsupported"`. |
| Frontend UI | Phase 4C must not introduce any frontend page, panel, chart, or hook for dailyData reads. |
| React / TanStack Query hooks | No `use-hexmining-daily-data-query.ts` or equivalent until yield is wired to the API route (Step 4). |
| HSI/HTT source families | Phase 6. Native pHEX stakes only. |
| Ended stake discovery | Phase 5. |
| Ethereum/eHEX | Chain ID 369 (PulseChain) only. |
| Broad sync jobs | No `SyncRun` / `SyncCursor` lifecycle changes. On-demand reads only. |
| `canonicalPayload` as accounting truth | `canonicalPayload` is raw evidence input. Phase 4C parses it for yield business logic, but the output is `yield.status: "estimated"` — never accounting truth. |
| DexScreener or external price truth | Never a source of truth in CoinPulse. |

#### Phase 4C start constraints

Phase 4C may not begin with a UI or DTO-wiring PR. The first Phase 4C PR must be a small, bounded estimator-contract PR only:
- Reads persisted `RawHexDailyDataObservation` rows from the database.
- Applies the yield estimation logic per §11.4 and §11.9.
- Enforces elapsed-days-only coverage, BPD attribution, and canonical-selection policy.
- Returns `yield.status: "estimated"` or `"unavailable"` with full provenance.
- No API route changes. No frontend changes. No new schema.
- Full contract tests with mock DB reads and no live RPC.

---

### 11.13 Phase 4C partial progress and packed uint72 decoder blocker

**Status: IN PROGRESS — PRs #208, #209, #210 merged. Bit layout VERIFIED (see `docs/hex-dailydata-packing-spec.md`). Packed decoder BLOCKED by ABI discrepancy — `daily-data-reader.ts` declares `uint72[]` but contract returns `uint256[]`.**

---

#### What is already complete

The following Phase 4C building blocks are merged and tested:

| PR | What was delivered |
|---|---|
| #208 | `estimateHexMiningYield(args, deps)` in `src/services/hexmining/yield-estimator.ts`; injectable `fetchEvidence` dep; `HexMiningYieldEstimateResult` discriminated union with statuses `estimated \| evidence_available \| insufficient_observations \| invalid_observation \| unavailable \| unsupported`; no yield math, no RPC, no UI |
| #209 | `getObservationEvidenceForRange(args, deps)` in `src/services/hexmining/observation-evidence-provider.ts`; queries persisted `RawHexDailyDataObservation` rows from the database; chain guard (369 only); returns `ObservationEvidenceMetadata` (never exposes `canonicalPayload`, `payloadHash`, or `rawDailyData`); `payloadSchemaValid` flag from internal payload decode; DB mock tests; no RPC |
| #210 | `decodeDailyDataPayload(canonicalPayload)` in `src/services/hexmining/daily-data-payload-decoder.ts`; parses the persisted canonical payload shape `{ "schemaVersion": "v1", "dailyData": ["val0", "val1", ...] }`; validates schema version, root type, array structure; rejects numeric JSON values (§11.8 bigint-safe policy); returns `{ ok: true, dailyData: readonly bigint[], entryCount, warnings }` on success; **each `dailyData` entry is a raw packed uint256 bigint stored as a decimal string — no packed field decoding occurs in this PR** |

**Key point:** `encodeDailyDataPayload` (PR #205, `daily-data-observation-service.ts`) stores the raw packed uint256 values received from viem directly as base-10 decimal strings. It does not pre-decode them. `decodeDailyDataPayload` (PR #210) parses the canonical payload and returns those packed bigints as-is. Unpacking each bigint into named fields is the responsibility of the packed decoder that this blocker note tracks. (Note: viem returns the full packed uint256 value regardless of whether the ABI declares `uint72[]` or `uint256[]` — no truncation occurs at runtime. Stored `canonicalPayload` rows contain all three fields. See `docs/hex-dailydata-packing-spec.md` §5.)

---

#### What the next intended code slice was

The next intended implementation step after PR #210 was:

A pure decoder function `decodePackedDailyDataEntry(packedValue: bigint)` (or `decodePackedDailyDataEntries`) that:
- Accepts a single raw packed uint72 bigint from the output of `decodeDailyDataPayload`.
- Rejects negative bigints.
- Rejects values greater than max uint72 (`2^72 - 1 = 4722366482869645213695n`).
- Unpacks the bigint into named bigint-safe fields according to the documented HEX `dailyDataRange` uint72 packing layout.
- Returns a result union (not throws) for expected invalid inputs.
- Produces no yield math, no APY, no pricing, valuation, or PnL.

That implementation attempt correctly stopped because the bit layout is not verified in-repo.

---

#### Bit layout — now verified

`docs/hex-dailydata-packing-spec.md` was added in this PR. It documents the verified uint256 packed bit layout from three independent sources:

| Source | Type | Finding |
|---|---|---|
| Source A — Blockscout on-chain ABI (chain 1, `get_contract_abi`) | **Authoritative** | `dailyDataRange` returns `uint256[]`; `dailyData` struct fields: `dayPayoutTotal (uint72)`, `dayStakeSharesTotal (uint72)`, `dayUnclaimedSatoshisTotal (uint56)` |
| Source B — JamJomJim/HEX.sol gist | Corroborating | Packing code confirms `HEART_UINT_SIZE = 72` and `uint256[] memory list` return type: fields packed as `dayUnclaimedSatoshisTotal << 144 \| dayStakeSharesTotal << 72 \| dayPayoutTotal` |
| Source C — kbahr/HexUtilities.sol gist | Corroborating | Unpack code confirms `HEARTS_UINT_SHIFT = 72`, `SATS_UINT_SHIFT = 56`, `HEARTS_MASK = (1<<72)-1`, `SATS_MASK = (1<<56)-1` — confirms all offsets and masks |

Verified bit layout (each element of the `uint256[]` return value):

| Field | Bit range | Width | Mask |
|---|---|---|---|
| `dayPayoutTotal` | bits 0–71 | 72 bits | `(2n**72n) - 1n` |
| `dayStakeSharesTotal` | bits 72–143 | 72 bits | `(2n**72n) - 1n` |
| `dayUnclaimedSatoshisTotal` | bits 144–199 | 56 bits | `(2n**56n) - 1n` |
| (zero padding) | bits 200–255 | 56 bits | — |

Four deterministic test vectors are provided in `docs/hex-dailydata-packing-spec.md` §4.

---

#### Why the packed decoder is still blocked — ABI discrepancy

**`src/services/hexmining/daily-data-reader.ts` line 14 declares `uint72[]` but the contract returns `uint256[]`.**

```typescript
// WRONG — must be corrected before packed decoder can proceed:
"function dailyDataRange(uint256 beginDay, uint256 endDay) view returns (uint72[] list)"
//                                                                        ^^^^^^ should be uint256[]
```

**Verified runtime behavior — viem does not truncate.** The truncation impact was investigated locally using viem `decodeAbiParameters` (see `docs/hex-dailydata-packing-spec.md` §5 for the full verification script). Viem's `decodeNumber` reads the full 32-byte ABI word without masking to the declared bit width. Both `uint72[]` and `uint256[]` return the same full BigInt value. Stored `canonicalPayload` rows are not corrupted.

**The ABI must still be corrected for the following reasons:**

1. **Code correctness:** The declared return type is factually wrong. A future viem version, alternate decoder, or external tooling may apply `uint72` masking and cause data loss.
2. **Type safety:** The `uint72[]` declaration misinforms TypeScript, code reviewers, and static analysis tools about the contract's true return type.
3. **Comment accuracy:** Several comments reference "uint72 packed" values — these must be updated to "uint256 packed" to match the verified bit layout in `docs/hex-dailydata-packing-spec.md`.
4. **Interoperability:** External tools consuming the ABI (block explorers, indexers, wallet integrations) may apply their own type-width masking.

**Required fix (bounded — single line change, no schema changes):**

1. Change line 14 in `daily-data-reader.ts` from `uint72[]` to `uint256[]`.
2. Update the comment on `rawDailyData` in `DailyDataObservation` (line 54) from "uint72 packed" to "uint256 packed".
3. No re-acquisition of stored observations is required — viem already returns the full packed value; existing `canonicalPayload` rows are correct.
4. The packed decoder PR may open after the ABI fix is merged.

This is not scope creep — it is a single-line correction with no schema, frontend, or migration changes.

---

#### Clarification on field-name references in existing tests

The field names `dayPayoutTotal`, `dayStakeSharesTotal`, and `dayUnclaimedSatoshisTotal` appear in `tests/services/hexmining/raw-dailydata-observation-schema.test.ts` (PR #199). These are **not** a bit-layout specification. They appear as illustrative examples of what a human-readable decoded payload might look like in the bigint encoding policy documentation test. Specifically:

- They show how viem-shaped bigint values would be serialized as base-10 decimal strings per the §11.8 bigint-safe policy.
- They demonstrate the encoding rule with named fields as a readable example.
- They are not derived from or verified against the actual HEX contract Solidity source.
- They must not be used to infer bit positions, bit widths, masks, shifts, or field ordering.
- No test in the repository asserts that any uint72 value from viem decodes to specific values for these named fields.

---

#### Guardrail

No packed decoder, yield estimator implementation, APY calculation, pricing, valuation, PnL, DTO exposure, API route, frontend component, or UI work may proceed until the ABI discrepancy is corrected in `daily-data-reader.ts`.

The bit layout specification (`docs/hex-dailydata-packing-spec.md`) satisfies the layout evidence requirements from the original blocker. The remaining hard stop is the ABI fix: packed decoder implementation must not begin until `daily-data-reader.ts` declares `uint256[]`. Stored observations do not need re-acquisition — viem returns the full packed uint256 value regardless of the ABI declaration (verified locally, see `docs/hex-dailydata-packing-spec.md` §5).

---

#### Acceptance criteria for unblocking packed decoder work

Original criteria status after this PR:

| Criterion | Status |
|---|---|
| 1. Verified source for `dailyDataRange` uint256 packed bit layout obtained | ✅ Met — `docs/hex-dailydata-packing-spec.md` §1 (Sources A, B, C) |
| 2. Bit layout documented in-repo with source cited | ✅ Met — `docs/hex-dailydata-packing-spec.md` §2 |
| 3. Field names documented (`dayPayoutTotal`, `dayStakeSharesTotal`, `dayUnclaimedSatoshisTotal`) | ✅ Met — verified from on-chain ABI (Source A) |
| 4. Bit widths and offsets documented (0–71, 72–143, 144–199) | ✅ Met — `docs/hex-dailydata-packing-spec.md` §2 table |
| 5. Shift constants and mask constants documented | ✅ Met — `HEARTS_MASK = (2n**72n)-1n`, `SATS_MASK = (2n**56n)-1n` |
| 6. Units and scaling documented (hearts, stake share units, satoshis) | ✅ Met — `docs/hex-dailydata-packing-spec.md` §3 |
| 7. At least one deterministic test vector documented | ✅ Met — four vectors in `docs/hex-dailydata-packing-spec.md` §4 |
| 8. Tests can be written from the spec without external knowledge | ✅ Met — vectors are mechanically derivable |
| 9. No yield formula until packed decoding verified and tested | ✅ Ongoing — no yield math exists yet |
| 10. Yield formula cites the same verified source | ✅ Deferred (not implemented) |

**Remaining blocker before packed decoder PR may open:**

- `daily-data-reader.ts` line 14 ABI declaration must be corrected from `uint72[]` to `uint256[]`.
- No re-acquisition of stored observations required — viem already returns full packed uint256 values with either ABI declaration (verified, see `docs/hex-dailydata-packing-spec.md` §5).
- The packed decoder PR must cite `docs/hex-dailydata-packing-spec.md` in the PR body.

> **Note (2026-06-10):** All criteria in the table above are now resolved. The ABI was fixed in PR #213, the packed decoder was added in PR #214, and the yield formula was implemented in PR #220. The acceptance criteria table reflects the state at the time §11.13 was written (PR #212). See §11.14 for the current Phase 4C gating decision.

---

### 11.14 Phase 4C yield-estimation gating decision

**Status: ACTIVE POLICY — public estimated yield intentionally gated after PRs #220 and #221.**

---

#### Decision

After PR #221, `estimateHexMiningYield` in `src/services/hexmining/yield-estimator.ts` **never** returns `status: "estimated"` or a non-null `yieldHex` publicly. For any valid evidence path (all pipeline steps 1–8 succeed), the public return is always:

```typescript
{
  status: "evidence_available",
  schemaVersion: "v1",
  yieldHex: null,
  provenance: { ... },
  warnings: evidence.warnings,
}
```

#### What runs internally

The injectable `applyCalculation` dep (defaulting to `defaultApplyCalculation`) is invoked at step 8:

```typescript
const applyCalculation = deps.applyCalculation ?? defaultApplyCalculation;
applyCalculation(packedResult.entries, args);  // runs, return value not used
```

`defaultApplyCalculation` implements the §8 formula:

```
Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal   (bigint floor; multiply-first)
dayStakeSharesTotal === 0n → 0n contribution (zero-division guard)
```

The formula runs internally and is verified via injectable `applyCalculation` in `tests/services/hexmining/yield-estimator.test.ts` (§8 test vectors A–E). However, its return value (`{ status: "estimated", yieldHex: string }`) is **not** used in the public return path at step 9. This is intentional.

#### Why the gate exists

Surfacing `status: "estimated"` and a non-null `yieldHex` to callers requires:

1. Explicit DTO contract approval: the `HexStakeDto.yield` field shape must be finalised (elapsed-days-only coverage rule, BPD attribution, provenance completeness per §11.9).
2. API route wiring: `GET /api/hexmining/stakes` must explicitly opt in to assembling yield from `estimateHexMiningYield`.
3. Separate PR scope: changes to `reader.ts`, `route.ts`, and `types.ts` are out of scope for the formula implementation PR.

Merging the formula ahead of these decisions is safe precisely because the public output is gated. Internal pipeline correctness (steps 6–8) is proven without coupling to the DTO/API contract.

#### Files affected by the gate

| File | Gate role |
|---|---|
| `src/services/hexmining/yield-estimator.ts` | Step 9 always returns `evidence_available`; `applyCalculation` called but result ignored |
| `tests/services/hexmining/yield-estimator.test.ts` | §8 vectors verify formula via injectable dep; no public `yieldHex` assertions |

#### Files that must NOT be changed to lift the gate

The following files must remain at their `origin/main` state (as of PR #221) until the gate is explicitly lifted in a separate approved PR:

| File | Constraint |
|---|---|
| `src/services/hexmining/reader.ts` | `yield: { status: "unsupported", ... }` hardcoded; no `fetchYieldEvidence` dep |
| `app/api/hexmining/stakes/route.ts` | No yield evidence fetch; calls `readNativeHexStakes` without yield wiring |
| `src/services/hexmining/observation-evidence-provider.ts` | No `EvidenceWithCanonicalPayload` export; no `getObservationEvidenceWithPayloadForRange` |
| `tests/services/hexmining/reader.test.ts` | Gate-preservation tests only — PR #228 added 5 new tests (yield gate describe block) verifying yield remains `"unsupported"` at reader layer; no yield wiring or estimated-yield assertions |
| `tests/api/hexmining-stakes-route-contract.test.ts` | Gate-preservation tests only — PR #228 added 4 new tests verifying yield remains `"unsupported"` in route response; no estimated-yield DTO assertions |

#### How to lift the gate

A future PR may promote `"estimated"` into the public output **only** when all of the following are satisfied in that same PR:

1. **Elapsed-days-only coverage rule** — ✅ **RESOLVED (PR #225).** `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)` enforced at step 5.5 of `estimateHexMiningYield`. `currentDay ≤ lockedDay` returns `insufficient_observations`; evidence range gap returns `insufficient_observations`.
2. **BPD attribution gate** — ✅ **RESOLVED at estimator boundary (PR #226).** Step 8.5 appends `hexmining-yield-bpd-attribution-unresolved` warning when the elapsed range includes protocol day 353. Full `bpdYieldHex`/`bpdYieldStatus` field assembly in the public reader/route DTO is a remaining gate-lift requirement (see items 4–6 below).
3. **§11.9 provenance fields** — ✅ **RESOLVED (PR #227).** Test-only PR verified all five minimum provenance fields (`chainId`, `sourceFamily`, `observationId`, `rangeStartDay`, `rangeEndDay`) are already present in `HexMiningYieldEstimateProvenance`. No source changes were required.
4. `HexStakeDto.yield` field assembly in `reader.ts` is updated — including `bpdYieldHex`, `bpdYieldStatus`, and `estimatedYieldHex` wiring from `estimateHexMiningYield`.
5. `GET /api/hexmining/stakes` route wires the `fetchEvidence` dep.
6. Contract tests cover the full estimated-yield DTO path (non-null `estimatedYieldHex`, BPD field correlation, provenance completeness in assembled `HexStakeDto`).
7. **HEX end-stake and EES penalty distribution behavior is verified** — ✅ **RESOLVED** (see §11.15 and `docs/hexmining-penalty-distribution-research.md`). Penalties from end-stake/EES are already included in `dayPayoutTotal` (50% of gross penalty, landing on a subsequent day). No separate modeling required.
8. **Final public DTO/API shape approval for estimated yield** — ✅ **RESOLVED (docs/hexmining-approve-yield-dto-contract).** §11.16 OQ-1–OQ-6 explicitly resolved and contract approved for implementation. See §11.16 for resolved decisions.
9. **Explicit contract tests for the public estimated-yield DTO path** — covering non-null `estimatedYieldHex`, BPD field correlation (`bpdYieldStatus: "applicable"` → non-null `bpdYieldHex`), and provenance completeness in the assembled `HexStakeDto`. PR #228 adds gate-preservation tests only; estimated-yield DTO contract tests required in the gate-lift implementation PR.
10. **Live-data fixture or opt-in integration verification** — confirms the formula produces plausible results against a known historical day range on PulseChain (chain ID 369) before the gate is lifted.
11. **Final docs record approving the gate lift** — this roadmap must be updated with a gate-lifted record and gate-lift PR reference when the gate-lift PR is merged.

These are Step 4 requirements (§11.10). No partial lift is permitted: the gate must remain in place until all requirements are met in the implementation PR. Items 1, 3, 7, 8 are resolved; item 2 is resolved at the estimator boundary; items 4–6, 9–11 remain open for the gate-lift implementation PR.

#### On "do not discard the calculation result" review comments

Review comments that suggest the calculation result should be forwarded to the public DTO without a separate contract approval are **scope-dependent** and are **not automatically accepted**. The formula is correct (§8 test vectors pass). The question of whether and how to surface it publicly is a separate design decision governed by §11.4, §11.9, and Step 4 of §11.10. Discarding the return value at step 9 is intentional policy, not an oversight.

#### Internal evidence vs. public DTO behavior

The `docs/hex-dailydata-packing-spec.md §8` formula documentation and test vectors are **internal calculation evidence**. They prove that `defaultApplyCalculation` is correct. They do not specify or imply the shape of the public `HexStakeDto.yield` DTO, the API route response, or any frontend display format. Those are Step 4 concerns.

---

### 11.15 HEX end-stake / EES penalty-distribution verification gate

**Status: RESOLVED — Finding A: penalty redistribution is already included in `dayPayoutTotal`. No separate modeling required.**

Full research record: `docs/hexmining-penalty-distribution-research.md`

---

#### Resolution summary

The gate opened in PR #223 is now resolved. The on-chain verified HEX contract source (`HEX.sol`, Blockscout chain 1, `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`, compiler v0.5.13, 2952 lines) was inspected in full. The penalty accounting path is unambiguous:

1. Every `stakeEnd` call (whether early, on-time, or late) computes `cappedPenalty` via `_stakePerformance`.
2. `_splitPenaltyProceeds` splits the penalty 50/50: 50% minted to `ORIGIN_ADDR`, 50% added to `globals.stakePenaltyTotal`.
3. The next time `_dailyDataUpdate` runs (triggered by any subsequent HEX transaction), `_dailyRoundCalc` sweeps `globals.stakePenaltyTotal` into `rs._payoutTotal` and resets it to zero.
4. `_dailyRoundCalcAndStore` writes `rs._payoutTotal` to `dailyData[day].dayPayoutTotal` — the same field returned by `dailyDataRange`.

**There is no separate accounting channel.** All penalty redistribution to stakers flows through `dayPayoutTotal`. The §8 formula captures it automatically.

---

#### Two accounting caveats (contract-confirmed, not bugs)

**Caveat 1 — 50% split:** Only 50% of gross `cappedPenalty` reaches stakers via `dayPayoutTotal`. The other 50% is minted to `ORIGIN_ADDR` and never enters the staker payout pool. The formula reads the observed `dayPayoutTotal`, which contains only the staker portion. Nothing extra to add.

**Caveat 2 — Next-day timing:** Because `_dailyDataUpdateAuto` freezes daily data **before** `_splitPenaltyProceeds` runs, a penalty from a stake ending on day D lands in the `dayPayoutTotal` of some day D+k (k ≥ 1). A staker holding through day D+k receives a share of that redistribution; one whose stake ended before D+k does not. This is correct protocol behavior. The formula reads whatever `dayPayoutTotal` was recorded, which already reflects this timing correctly.

---

#### "Emergency End Stake" clarification

The on-chain verified `HEX.sol` contains **no function named `emergencyEndStake`**. There is one public stake-closing entry point: `stakeEnd`. Community usage of "EES" refers to calling `stakeEnd` before the committed term completes, which takes the early-exit branch (`_calcPayoutAndEarlyPenalty`). The penalty mechanism is mechanically identical to overdue-stake penalty — both flow through `_splitPenaltyProceeds`.

---

#### Original open accounting question

HEX yield is not only simple daily inflation payout to active stakers. When a stake is ended early (EES — emergency end stake), the protocol applies a penalty. Part of that penalty is returned to the HEX ecosystem and redistributed to remaining stakers.

**The question was:** Are EES and end-stake penalty distributions already included in the `dayPayoutTotal` values returned by `dailyDataRange`, or do they represent a separate distribution channel that the §8 formula does not capture?

**Answer (Finding A):** Yes — penalty redistribution (50% of gross penalty) is already included in `dayPayoutTotal` of a subsequent day. No separate distribution channel exists. The §8 formula requires no modification to account for penalties.

---

#### Scenario coverage

| Scenario | Finding |
|---|---|
| Normal active stake | `dayPayoutTotal` includes standard inflation. §8 formula correct. |
| Overdue stake (late penalty) | 50% of late penalty enters a subsequent day's `dayPayoutTotal` via `globals.stakePenaltyTotal`. §8 formula captures it. |
| Normal ended stake | Same late-penalty path if applicable. §8 formula captures via `dayPayoutTotal`. |
| Early-ended stake ("EES") | Same `_splitPenaltyProceeds` path. 50% enters a subsequent day's `dayPayoutTotal`. §8 formula captures it. |
| Zero-share / zero-distribution | `dayStakeSharesTotal === 0n` guard in `defaultApplyCalculation` correct. Confirmed by contract. |

---

#### Why this gate existed

The §8 formula computes:

```
perDayYield(d) = (stakeShares × dayPayoutTotal[d]) / dayStakeSharesTotal[d]
```

This formula is arithmetically correct for any observed `dayPayoutTotal` value. The gate existed to verify whether `dayPayoutTotal` included penalty redistribution amounts or whether those flowed through a separate channel. A partial yield figure surfaced as `status: "estimated"` — without documenting what it excludes — would be a material accounting misrepresentation.

**The gate is now resolved.** The contract source confirms penalties flow into `dayPayoutTotal`. The §8 formula is complete for the staker payout pool (subject to the two caveats above and the other gate conditions in §11.14).

---

#### Stake scenarios that must be verified

The future implementation must verify behavior against HEX contract and accounting semantics for all of the following stake scenarios:

| Scenario | Verification requirement |
|---|---|
| Normal active stake | `dayPayoutTotal` includes standard inflation payout; no penalty events in the range |
| Overdue stake (active past `lockedDay + stakedDays`) | Penalty accrual mechanics; whether overdue-period `dayPayoutTotal` is affected |
| Ended stake (normal end within staked period) | No penalty applied; yield is full inflation-share for active days |
| Emergency-ended stake / EES penalty | Penalty applied; question: is the redistributed portion included in `dayPayoutTotal` of the days when the penalty was assessed? |
| Zero-share / zero-distribution edge case | `dayStakeSharesTotal === 0n` is already guarded in the §8 formula; verify this guard covers all protocol edge cases |

At minimum, the verification must cite a primary authoritative source (on-chain contract logic or a verified equivalent) for the conclusion reached.

---

#### What this gate does NOT prohibit

This gate does not block:

- Continued internal formula development and testing (the §8 formula remains valid as internal calculation evidence).
- Other Phase 4C continuation work (elapsed-days coverage rule, BPD attribution, provenance completeness).
- Any Phase 4B, 4A, or earlier work.
- Any Phase 5, 6, or 7 planning.

This gate only blocks the final step of surfacing `status: "estimated"` and a non-null `yieldHex` to callers via the public API. All other work may proceed in parallel.

---

#### Resolution evidence

This gate was resolved in PR #224 (`docs/hexmining-verify-penalty-distribution-accounting`). The full research record is in `docs/hexmining-penalty-distribution-research.md`, which includes:

1. On-chain verified HEX.sol source from Blockscout (chain 1, `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`)
2. Verbatim Solidity code for the complete penalty accounting path: `_splitPenaltyProceeds` → `globals.stakePenaltyTotal` → `_dailyRoundCalc` → `dailyData[day].dayPayoutTotal`
3. Scenario coverage for all five required scenarios (normal stake, overdue, ended, EES, zero-share)
4. Two accounting caveats documented: 50% split to `ORIGIN_ADDR`; next-day timing

---

### 11.16 Proposed public HexStakeYieldDto contract

**Status: APPROVED FOR IMPLEMENTATION — OQ-1–OQ-6 resolved (see below). Not yet implemented.** This contract is approved for use in the gate-lift implementation PR. Remaining implementation prerequisites: §11.14 items 4–6, 9–11. Public estimated yield remains NOT exposed until the gate-lift implementation PR is merged.

---

#### TypeScript shape (proposed)

```typescript
// Discriminated union on `status`
export type HexStakeYieldDto =
  | UnsupportedYieldDto
  | UnavailableYieldDto
  | EstimatedYieldDto;

export interface UnsupportedYieldDto {
  status: "unsupported";
  estimatedYieldHex: null;
  bpdYieldStatus: null;
  bpdYieldHex: null;
  provenance: null;
  warnings: string[];
}

export interface UnavailableYieldDto {
  status: "unavailable";
  estimatedYieldHex: null;
  bpdYieldStatus: "applicable" | "not_applicable" | "unknown";
  bpdYieldHex: null;
  provenance: HexStakeYieldProvenance | null;
  warnings: string[];
}

export type EstimatedYieldDto = {
  status: "estimated";
  estimatedYieldHex: string;            // bigint decimal string, unit: hearts
  provenance: HexStakeYieldProvenance;  // required when estimated
  warnings: string[];
} & (
  | { bpdYieldStatus: "applicable"; bpdYieldHex: string }           // non-null only when applicable
  | { bpdYieldStatus: "not_applicable" | "unknown"; bpdYieldHex: null }
);

export interface HexStakeYieldProvenance {
  chainId: number;       // always 369 (PulseChain)
  sourceFamily: string;  // always "HEXMINING"
  observationId: string; // UUID of the HexMiningObservation record used
  rangeStartDay: number; // inclusive start of observation day range
  rangeEndDay: number;   // inclusive end of observation day range (= elapsedEndDay)
}
```

---

#### Field-by-field contract

**`status`** (discriminant)

| Value | Public-facing | Description |
|---|---|---|
| `"unsupported"` | Yes | Current state — no yield estimation attempted (chain not supported, or gate not lifted) |
| `"unavailable"` | Yes | Yield estimation attempted but evidence fetch failed, or insufficient observations |
| `"estimated"` | Yes | Yield estimated from on-chain dailyData observations — gate-lift target |
| `"exact"` | Yes | Reserved for Phase 5+ (finalized stake yield from on-chain receipt) — not in scope for Phase 4C |

**Internal estimator statuses — must never appear in any public DTO, API response, or frontend-visible state:**

| Internal status | Maps to public status | Notes |
|---|---|---|
| `"evidence_available"` | `"unavailable"` (see OQ-2) | Formula ran internally but gate is active; reader maps this to `"unavailable"` |
| `"insufficient_observations"` | `"unavailable"` | Evidence range does not cover the elapsed period |
| `"invalid_observation"` | `"unavailable"` | Payload decode failure |

> `"evidence_available"` is an internal estimator boundary marker. It must NEVER appear in any public DTO or API response.

---

**`estimatedYieldHex`** (string | null)

- Non-null only when `status: "estimated"`; null in all other variants
- Unit: hearts (HEX smallest denomination; 1 HEX = 10^8 hearts)
- Format: bigint decimal string (no decimals, no exponent notation, no currency symbol)
- Value: cumulative yield accumulated from `lockedDay` through `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)` via the §8 formula — includes `dayPayoutTotal[353]` when the elapsed range covers day 353
- `bpdYieldHex` (when non-null) is a reporting split of a portion of this value, not an additional amount on top of it
- See OQ-1 (resolved)

---

**`bpdYieldStatus`** (`"applicable"` | `"not_applicable"` | `"unknown"` | null)

- Null only when `status: "unsupported"`; present in all other variants
- `"applicable"`: stake was active on HEX BPD (day 353); BPD yield attribution is modeled in `bpdYieldHex`
- `"not_applicable"`: stake was not active on day 353 (`lockedDay > 353` or `lockedDay + stakedDays ≤ 353`)
- `"unknown"`: elapsed range includes day 353 but BPD attribution modeling is incomplete; `hexmining-yield-bpd-attribution-unresolved` warning is present; `bpdYieldHex` is null

---

**`bpdYieldHex`** (string | null)

- Non-null ONLY when `bpdYieldStatus: "applicable"` AND `status: "estimated"`; null in all other cases
- Unit: hearts (same as `estimatedYieldHex`); format: bigint decimal string
- Represents the **portion of `estimatedYieldHex`** attributable to BPD day 353 — attribution/reporting split only, not additional yield on top of `estimatedYieldHex`
- Do NOT add `bpdYieldHex` to `estimatedYieldHex` to compute total yield; `estimatedYieldHex` already includes day 353's payout via the §8 formula
- When `bpdYieldStatus: "unknown"`: `bpdYieldHex` is null; `estimatedYieldHex` may still include day 353 payout but BPD attribution is unresolved
- Assembly of `bpdYieldHex` in reader.ts is deferred to the gate-lift PR (see §11.14 item 2)
- See OQ-3 (resolved)

---

**`provenance`** (HexStakeYieldProvenance | null)

- Non-null when `status: "estimated"`; present (or null) when `status: "unavailable"` if evidence was fetched; null when `status: "unsupported"`
- Fields:
  - `chainId`: always 369 — PulseChain only; this contract does not extend to other chains
  - `sourceFamily`: always `"HEXMINING"` — canonical source family enum value; identifies the observation family
  - `observationId`: UUID of the `HexMiningObservation` record; enables audit trail to raw persisted evidence
  - `rangeStartDay`: inclusive start day of the observation range used
  - `rangeEndDay`: inclusive end day of the observation range used — equals `elapsedEndDay`
- Field names match the internal `HexMiningYieldEstimateProvenance` type; see OQ-4 (resolved)

---

**`warnings`** (string[])

- Always present (empty array when no warnings); never null or omitted
- Pass-through from `HexMiningYieldEstimateResult.warnings` at reader boundary
- Known public warning codes:
  - `"hexmining-yield-bpd-attribution-unresolved"`: elapsed range includes day 353; BPD yield not yet modeled
  - `"hexmining-yield-no-elapsed-days"`: `currentDay ≤ lockedDay`; no elapsed days to estimate
  - `"hexmining-yield-insufficient-elapsed-day-coverage"`: observation range does not cover full elapsed period
- Future internal-only warning codes added to the estimator must be explicitly filtered at the reader boundary if not intended for public consumption
- See OQ-5 (resolved)

---

#### BPD attribution interaction with estimated yield

`estimatedYieldHex` = `Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal` over `[rangeStartDay, elapsedEndDay]` (§8 formula, bigint floor, multiply-first). When day 353 falls within the elapsed range, `dayPayoutTotal[353]` is already included in this sum. `estimatedYieldHex` is always the complete yield figure.

`bpdYieldHex` is an **attribution/reporting split** — the portion of `estimatedYieldHex` that can be attributed specifically to BPD day 353. It is not additional yield on top of `estimatedYieldHex`. Do NOT compute total yield as `estimatedYieldHex + bpdYieldHex`.

| `bpdYieldStatus` | `bpdYieldHex` | Meaning |
|---|---|---|
| `"applicable"` | `string` | Day 353 attribution resolved; `bpdYieldHex` is the BPD portion of `estimatedYieldHex` |
| `"not_applicable"` | `null` | Stake was not active on day 353; no BPD portion exists |
| `"unknown"` | `null` | Elapsed range includes day 353; `estimatedYieldHex` includes the day 353 payout but BPD attribution is unresolved |

When `bpdYieldStatus: "unknown"`, `hexmining-yield-bpd-attribution-unresolved` signals to callers that the BPD split has not been resolved.

---

#### Resolved approval decisions

OQ-1 through OQ-6 are resolved below. Implementation may proceed per the §11.14 gate-lift prerequisites (items 4–6, 9–11).

**OQ-1 RESOLVED: `estimatedYieldHex` unit and format**
**Decision:** hearts as bigint decimal string. Consistent with other token balance serialization in this codebase (`principalLockedRaw`, `yieldRaw`, etc.). No HEX-with-8-decimal-places representation; no JSON number (unsafe for large bigint values).

**OQ-2 RESOLVED: `evidence_available` → `"unavailable"` mapping**
**Decision:** when the estimator returns `evidence_available` (gate active, formula ran internally), the public DTO must expose `status: "unavailable"`. Evidence was fetched and the formula ran; the gate is a deployment decision, not a capability absence. Callers must distinguish capability-present-but-gated (`"unavailable"`) from no-capability (`"unsupported"`). `"evidence_available"` must never appear in any public DTO or API response.

**OQ-3 RESOLVED: `bpdYieldHex` always present, null unless `bpdYieldStatus: "applicable"`**
**Decision:** `bpdYieldHex` is always present in the DTO (never omitted), null unless `bpdYieldStatus: "applicable"` AND `status: "estimated"`. Preserves the discriminated union / intersection shape defined in the TypeScript contract above.

**OQ-4 RESOLVED: Provenance field names match `HexMiningYieldEstimateProvenance`**
**Decision:** use the same field names as the internal `HexMiningYieldEstimateProvenance` type: `chainId`, `sourceFamily`, `observationId`, `rangeStartDay`, `rangeEndDay`. Already minimal and non-implementation-specific; no rename required.

**OQ-5 RESOLVED: Current warning codes pass through; future internal-only codes filtered at reader boundary**
**Decision:** all current estimator warning codes (`hexmining-yield-bpd-attribution-unresolved`, `hexmining-yield-no-elapsed-days`, `hexmining-yield-insufficient-elapsed-day-coverage`) pass through to the public DTO unchanged. Any future internal-only warning codes added to the estimator must be explicitly filtered at the reader boundary before public exposure.

**OQ-6 RESOLVED: Top-level `HexStakeDto` `schemaVersion` bump**
**Decision:** the top-level `schemaVersion` on `HexStakeDto` is bumped when `yield.status` transitions from `"unsupported"` to `"estimated"` in the gate-lift implementation PR. No separate yield subobject version required.

---

#### Implementation approval

**This contract is APPROVED FOR IMPLEMENTATION.** OQ-1–OQ-6 are resolved above. The gate-lift implementation PR may proceed against this contract. Implementation must satisfy the remaining §11.14 gate-lift prerequisites (items 4–6, 9–11) in the same PR. Public estimated yield must NOT be exposed until those prerequisites are satisfied and the gate-lift implementation PR is merged.

---

## 12. Proposed Next PR (updated)

**Phase 4B is complete.** PRs #204, #205, and #206 delivered the full read boundary, persistence wiring, and gated operator route.

**Phase 4C internal pipeline is complete and gated.** PRs #208–#228 have delivered the full yield estimation pipeline, gate-preservation tests, and verification of all estimator-boundary gates. The formula runs internally and is verified. The public output is intentionally gated at `evidence_available` — see §11.14.

**Gate-lift prerequisites now satisfied (see §11.14):**

- ✅ Item 1 — Elapsed-days coverage rule enforced at estimator boundary (PR #225)
- ✅ Item 2 — BPD attribution gate active at estimator boundary (PR #226); full bpdYieldHex/bpdYieldStatus in reader/route DTO still required for gate lift
- ✅ Item 3 — §11.9 provenance fields verified present in estimator output (PR #227)
- ✅ Item 7 — EES/penalty distribution verified (PR #224 — Finding A)
- ✅ Item 8 — §11.16 OQ-1–OQ-6 resolved and DTO contract approved (docs/hexmining-approve-yield-dto-contract)

**Immediate next step: Step 4 gate-lift implementation PR**

§11.16 OQ-1–OQ-6 are now resolved (docs/hexmining-approve-yield-dto-contract). Implementation may begin after that PR is merged. The gate-lift implementation PR (exposing public `status: "estimated"`) must satisfy **all** remaining prerequisites — see §11.14 items 4–6, 9–11. The implementation must follow the approved public DTO contract in **§11.16**:

```text
feat(hexmining): wire estimated yield fields into HexStakeDto and API route
```

- Follow the approved §11.16 contract for `HexStakeYieldDto` field shapes, OQ-1–OQ-6 decisions, and `evidence_available` → `"unavailable"` mapping.
- Update `HexStakeDto.yield` field assembly in `reader.ts` to call `estimateHexMiningYield` and map result per the §11.16 contract (including `bpdYieldHex`, `bpdYieldStatus`, `estimatedYieldHex`, `provenance`, and `warnings`).
- Wire `fetchEvidence` dep into `GET /api/hexmining/stakes` route.
- Contract tests for the full DTO including all §11.16 fields (non-null `estimatedYieldHex`, BPD field correlation, provenance completeness, `warnings` pass-through).
- Live-data fixture or opt-in integration verification against a known historical day range on PulseChain.
- Final docs record approving the gate lift (this document updated with gate-lifted record and PR reference).
- `valuation.status` and `pnl.status` remain `"unsupported"` — unchanged.

**What must NOT happen without a gate-lift implementation PR:**
- No direct change to steps 8–9 of `estimateHexMiningYield` to return `"estimated"` without all prerequisites above.
- No reader.ts or route.ts yield wiring without the coverage rule, BPD modelling, and EES verification.
- No partial gate lift (e.g., surfacing `yieldHex` without provenance completeness or unresolved EES question).
- No assumption that the §8 formula is a complete public accounting model until EES behavior is verified.
- No frontend changes, React hooks, or TanStack Query hooks for yield until Step 4 is merged.
- No `canonicalPayload` exposure in any DTO or API response.
- No `valuation.status` or `pnl.status` changes (remain `"unsupported"` until Phase 7).

See §11.14 for the full gate-lift prerequisite list. See §11.15 for the EES penalty-distribution verification gate.

---

## Validation Notes

**PR #194 validation (docs/hexmining-phase4-kickoff):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run test` — 96 test files, 1168 tests, all passed.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, Prisma client generated, route types generated, no type errors.
- `npm run build` — passed, all routes compiled cleanly including `/hexmining`.

**PR #196 validation (test/hexmining-yield-dto-invariants):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run test` — 103 test files, 1265 tests, all passed.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, all `@ts-expect-error` directives active (no unused-directive errors).
- `npm run build` — passed, all routes compiled cleanly.

**This PR (docs/hexmining-phase4-observation-model) — docs only (both commits):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run test` — 1265 tests, all passed.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.
- `npm run build` — passed, all routes compiled cleanly.

**PR #207 validation (docs/hexmining-phase4b-evidence-closure — docs only):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #211 (docs/hexmining-dailydata-bit-layout-evidence — docs only):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #212 (docs/hexmining-dailydata-bit-layout-evidence-2 — docs only):**
- `git diff --check` — passed, no trailing whitespace.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #220 (feat/hexmining-yield-formula):**
- `npm run test` — 1539 tests, all passed. §8 test vectors A–E verified via injectable `applyCalculation`.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.
- `npm run build` — passed, all routes compiled cleanly.

**PR #221 (feat/hexmining-yield-estimate-gating — scope-corrected):**
- `npm run test` — 1539 tests, all passed. `estimateHexMiningYield` returns `evidence_available` for all valid-evidence paths.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.
- `npm run build` — passed, all routes compiled cleanly.

**PR #222 (docs/hexmining-yield-estimate-gating-record — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #223 (docs/hexmining-penalty-distribution-gate — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md`, `docs/hex-dailydata-packing-spec.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #224 (docs/hexmining-verify-penalty-distribution-accounting — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md`, `docs/hex-dailydata-packing-spec.md`, `docs/hexmining-penalty-distribution-research.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #225 (test/hexmining-elapsed-days-coverage-rule):**
- `npm run test` — all tests passed. Elapsed-days coverage tests verified.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #226 (test/hexmining-bpd-attribution-gate):**
- `npm run test` — 74 tests in yield-estimator.test.ts; all passed. BPD attribution gate tests (12 new) verified.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #227 (test/hexmining-yield-provenance-audit-trail — test only):**
- `npm run test` — 86 tests in yield-estimator.test.ts; all passed. §11.9 provenance audit trail tests (12 new) verified.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #228 (test/hexmining-yield-reader-route-gated-wiring — test only):**
- `git diff --name-only` — `tests/services/hexmining/reader.test.ts`, `tests/api/hexmining-stakes-route-contract.test.ts` only.
- `npm run test` — 1586 tests, all passed (38 in targeted reader+route contract files; 1586 overall).
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #229 (docs/hexmining-yield-gate-status-after-228 — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**PR #230 (docs/hexmining-estimated-yield-dto-contract — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

**This PR (docs/hexmining-approve-yield-dto-contract — docs only):**
- `git diff --name-only` — `docs/v2-hexmining-roadmap.md` only.
- `npm run lint` — passed, no ESLint errors.
- `npm run typecheck` — passed, no type errors.

---

## Final Status

**PR #194 (docs/hexmining-phase4-kickoff) — merged:**
- Changed files: `docs/v2-hexmining-roadmap.md`, `src/services/hexmining/types.ts`

**PR #195 (test/hexmining-yield-status-contract) — merged:**
- Changed files: `src/services/hexmining/types.ts`, `tests/services/hexmining/yield-contract.test.ts`

**PR #196 (test/hexmining-yield-dto-invariants) — merged:**
- Changed files: `src/services/hexmining/types.ts`, `tests/services/hexmining/yield-contract.test.ts`, `tests/services/hexmining/yield-dto-invariants.test.ts`

**PR #199 (feat/hexmining-raw-observation-persistence) — merged:**
- Changed files: `src/services/hexmining/observation-store.ts`, `tests/services/hexmining/observation-store.test.ts`

**PR #200 (feat/hexmining-observation-status-dto) — merged:**
- Changed files: `src/services/api/hexmining-observations.ts`, `app/api/hexmining/observations/status/route.ts`, `tests/api/hexmining-observations-status-route-contract.test.ts`

**PR #201 (fix/hexmining-observation-status-freshness) — merged:**
- Changed files: `src/services/api/hexmining-observations.ts`, `tests/api/hexmining-observations-status-route-contract.test.ts`

**PR #202 (feat/hexmining-observation-status-debug-surface) — merged:**
- Changed files: `src/services/debug/health.ts`, `src/lib/api/debug-client.ts`, `tests/api/debug-status-route-contract.test.ts`, `tests/lib/debug-client.test.ts`, `tests/lib/use-debug-status-query.test.ts`

**PR #203 (docs/hexmining-phase4-observation-model — updated):**
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** Updated Phase completion table; §11.10 Step 2 acceptance criteria; §11.12 Phase 4B definition with scope, non-goals, and end-exclusive `dailyDataRange` semantics; §12 and Final Status.
- **PR status:** DOCS-ONLY

**PR #204 (feat/hexmining-daily-data-reader):**
- **Changed files:** `src/services/hexmining/daily-data-reader.ts` (new), `tests/services/hexmining/daily-data-reader.test.ts` (new)
- **What changed:** `readCurrentDay()` and `readDailyDataRangeObservation()` — PulseChain-only, pHEX `dailyDataRange` reads, end-exclusive RPC call, no persistence, no yield, no UI.
- **PR status:** FEAT — service only

**PR #205 (feat/hexmining-observation-persistence-wiring):**
- **Changed files:** `src/services/hexmining/daily-data-observation-service.ts` (new), `tests/services/hexmining/daily-data-observation-service.test.ts` (new)
- **What changed:** `acquireAndPersistHexDailyDataObservation()` — encodes `rawDailyData` bigint[] as decimal strings, validates payload, persists via `persistHexDailyDataObservation()`, dedup-safe. No `canonicalPayload` exposure, no yield, no schema, no UI.
- **PR status:** FEAT — service only

**PR #206 (feat/hexmining-observation-admin-route):**
- **Changed files:** `app/api/hexmining/observations/route.ts` (new), `tests/api/hexmining-observations-create-route-contract.test.ts` (new), `src/services/hexmining/reader.ts` (type refactor only)
- **What changed:** `POST /api/hexmining/observations` gated admin route; `HexMiningReadClient` type refactored to `Pick<PublicClient, "readContract" | "getBlockNumber">`. 24 contract tests. No yield, no UI, no schema.
- **PR status:** FEAT — route only

**PR #207 (docs/hexmining-phase4b-evidence-closure):**
- **Branch:** `docs/hexmining-phase4b-evidence-closure`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** Document header and Phase completion table updated for Phase 4B complete; §11.1 extended with PRs #203–#206 and post-merge audit (1421 tests); §11.10 Step 2 marked complete; §11.12 repurposed as Phase 4B completion evidence record with delivered items, guardrails, and Phase 4C constraints; §12 updated to describe Phase 4C estimator-contract as the next PR; Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #208 (feat/hexmining-yield-estimator-contract):**
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (new), `tests/services/hexmining/yield-estimator.test.ts` (new), `src/services/hexmining/types.ts` (updated)
- **What changed:** `estimateHexMiningYield(args, deps)` yield estimator contract; `HexMiningYieldEstimateResult` discriminated union; injectable `fetchEvidence` dep; statuses: `estimated | evidence_available | insufficient_observations | invalid_observation | unavailable | unsupported`; no yield math, no RPC, no UI.
- **PR status:** FEAT — service contract only

**PR #209 (feat/hexmining-yield-evidence-provider):**
- **Changed files:** `src/services/hexmining/observation-evidence-provider.ts` (new), `tests/services/hexmining/observation-evidence-provider.test.ts` (new), `src/services/hexmining/yield-estimator.ts` (updated to consume `ObservationEvidenceMetadata`)
- **What changed:** `getObservationEvidenceForRange(args, deps)` evidence provider; `ObservationEvidenceMetadata` return type; chain guard; DB mock tests; no `canonicalPayload` exposure; no RPC.
- **PR status:** FEAT — service only

**PR #210 (feat/hexmining-dailydata-payload-decoder):**
- **Changed files:** `src/services/hexmining/daily-data-payload-decoder.ts` (new), `tests/services/hexmining/daily-data-payload-decoder.test.ts` (new)
- **What changed:** `decodeDailyDataPayload(canonicalPayload)` canonical payload decoder; `DecodeDailyDataPayloadResult` discriminated union; `DecodeDailyDataPayloadErrorCode` literal union; 31 tests. Returns `readonly bigint[]` — no packed uint72 decoding.
- **PR status:** FEAT — service only

**PR #211 (docs/hexmining-dailydata-bit-layout-evidence) — merged:**
- **Branch:** `docs/hexmining-dailydata-bit-layout-evidence`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** Document header and Phase completion table updated for Phase 4C in-progress/blocked; §11.1 extended with PRs #207–#210 and post-merge audit; §11.10 Step 3 updated with partial progress and blocker; §11.13 added — full blocker record for packed uint72 decoder (what is complete, what is blocked, why, clarification on field-name references, guardrail, acceptance criteria); §12 updated with blocker state and unblocking path; Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #212 (docs/hexmining-dailydata-bit-layout-evidence-2) — merged:**
- **Branch:** `docs/hexmining-dailydata-bit-layout-evidence-2`
- **Changed files:** `docs/hex-dailydata-packing-spec.md` (new), `docs/v2-hexmining-roadmap.md` (updated)
- **What changed:** `docs/hex-dailydata-packing-spec.md` — full bit layout specification from three independent sources (on-chain ABI authoritative, two corroborating Solidity gists); verified field layout table; TypeScript unpacking formula; four deterministic test vectors; critical ABI discrepancy finding (§5); §6 summary table. `docs/v2-hexmining-roadmap.md` — §11.1 extended with PR #211 and post-merge audit; §11.10 Step 3 updated to reflect layout verified and new ABI blocker; §11.13 updated with verification evidence and ABI blocker.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #213 (fix/hexmining-abi-correction) — merged:**
- **Changed files:** `src/services/hexmining/daily-data-reader.ts`
- **What changed:** Line 14 `uint72[]` → `uint256[]`; `rawDailyData` comment updated to "uint256 packed". Single-line ABI fix; no schema, no migration, no re-acquisition required.
- **PR status:** FIX — source only

**PR #214 (feat/hexmining-packed-decoder) — merged:**
- **Changed files:** `src/services/hexmining/daily-data-packed-decoder.ts` (new), `tests/services/hexmining/daily-data-packed-decoder.test.ts` (new)
- **What changed:** `decodePackedDailyDataRange(packedValues: readonly bigint[])` returning `DecodedDailyDataEntry[]` with `dayPayoutTotal`, `dayStakeSharesTotal`, `dayUnclaimedSatoshisTotal` bigint fields; rejects negative/out-of-200-bit-range values; bit layout from `docs/hex-dailydata-packing-spec.md §2`; deterministic tests using §4 vectors. No yield math.
- **PR status:** FEAT — service only

**PR #215 (feat/hexmining-yield-estimator-decoder-wiring) — merged:**
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** Steps 6–7 wired into `estimateHexMiningYield`: `decodeDailyDataPayload` (step 6) and `decodePackedDailyDataRange` (step 7); `EvidenceWithPayload` internal type carries `canonicalPayload` (never surfaced); decoder failure paths return `invalid_observation`.
- **PR status:** FEAT — service only

**PR #216 (feat/hexmining-yield-calculation-boundary) — merged:**
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** `YieldCalculationResult` internal type; `defaultApplyCalculation` scaffold (returns `calculation_not_implemented`); injectable `applyCalculation` dep added to `HexMiningYieldEstimatorDeps`; step 8 calls `applyCalculation`.
- **PR status:** FEAT — service only

**PR #217 (feat/hexmining-stake-shares-arg) — merged:**
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** `stakeShares: bigint` added to `HexMiningYieldEstimateArgs`; `stakeShares <= 0n` validation guard at step 1.5 returns `invalid_observation` with `hexmining-yield-invalid-stake-shares` warning.
- **PR status:** FEAT — service only

**PR #218 (docs/hexmining-yield-formula-test-vectors-spec) — merged:**
- **Changed files:** `docs/hex-dailydata-packing-spec.md` (updated — §8 added), `docs/v2-hexmining-roadmap.md` (updated — §11.10 Step 3 "Prerequisite resolved" note)
- **What changed:** §8 yield formula specification: per-day `(stakeShares × dayPayoutTotal) / dayStakeSharesTotal` (bigint floor, multiply-first, zero-division guard); five deterministic test vectors A–E; §11.10 Step 3 updated with prerequisite-resolved note.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #220 (feat/hexmining-yield-formula) — merged:**
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** `defaultApplyCalculation` implements §8 formula — `Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal` (bigint floor, multiply-first, `dayStakeSharesTotal === 0n` skip); §8 test vectors A–E verified via injectable `applyCalculation` that captures decoded entries; 1539 tests pass.
- **PR status:** FEAT — service only

**PR #221 (feat/hexmining-yield-estimate-gating — scope-corrected) — merged:**
- **Branch:** `claude/v2-hexmining-roadmap-O56OV`
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** Public output intentionally gated — `applyCalculation` called at step 8 (internal pipeline proof) but return value is not used; step 9 always returns `evidence_available` with `yieldHex: null`; tests updated to assert `evidence_available` for all valid-evidence paths; §8 test vectors restructured to verify formula via `applyFormula()` helper without public `yieldHex` assertions. See §11.14 for the gating decision record.
- **PR status:** FEAT (scope-corrected) — `yield-estimator.ts` and `yield-estimator.test.ts` only; no reader, route, provider, or reader-test changes.

**PR #222 (docs/hexmining-yield-estimate-gating-record) — merged:**
- **Branch:** `docs/hexmining-yield-estimate-gating-record`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** Document header and Phase completion table updated for current Phase 4C gating state; §11.1 extended with PRs #212–#221 and post-merge audit (1539 tests); §11.10 Step 3 updated with full PR delivery table and current gating state; §11.13 updated with resolved-criteria note; §11.14 added — yield-estimation gating decision record (decision, internal behavior, gate rationale, gate-lift prerequisites, review comment policy, internal evidence vs. public DTO distinction); §12 updated with gate-lift prerequisites as the next PR spec; Validation Notes and Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #223 (docs/hexmining-penalty-distribution-gate) — merged:**
- **Branch:** `docs/hexmining-penalty-distribution-gate`
- **Changed files:** `docs/v2-hexmining-roadmap.md` (updated), `docs/hex-dailydata-packing-spec.md` (updated)
- **What changed:** §11.14 updated with 7th prerequisite (EES verification); §11.15 added — full penalty-distribution verification gate (open question, stake scenarios, gate rationale, resolution path); §12 updated; `docs/hex-dailydata-packing-spec.md §8` "What is NOT included" updated with EES open question.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #224 (docs/hexmining-verify-penalty-distribution-accounting) — merged:**
- **Branch:** `docs/hexmining-verify-penalty-distribution-accounting`
- **Changed files:** `docs/hexmining-penalty-distribution-research.md` (new), `docs/v2-hexmining-roadmap.md` (updated), `docs/hex-dailydata-packing-spec.md` (updated)
- **What changed:** `docs/hexmining-penalty-distribution-research.md` — full research record: on-chain verified HEX.sol source (Blockscout chain 1); verbatim `_splitPenaltyProceeds`, `_dailyRoundCalc`, `_dailyRoundCalcAndStore` code; complete function trace; scenario coverage for all five required scenarios; Finding A confirmed; two accounting caveats documented; §8 formula implication. `docs/v2-hexmining-roadmap.md` — document header updated; §11.14 item 7 marked RESOLVED; §11.15 status changed to RESOLVED (Finding A) with full resolution evidence, caveats, EES clarification, scenario coverage, and resolution evidence record. `docs/hex-dailydata-packing-spec.md §8` — EES entry updated from open question to resolved (Finding A) with reference to research file.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.

**PR #225 (test/hexmining-elapsed-days-coverage-rule) — merged:**
- **Branch:** `test/hexmining-elapsed-days-coverage-rule`
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** Step 5.5 elapsed-days coverage enforced: `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)`; `currentDay ≤ lockedDay` guard returns `insufficient_observations` with `hexmining-yield-no-elapsed-days`; evidence range gap (`rangeStartDay > lockedDay` or `rangeEndDay < elapsedEndDay`) returns `insufficient_observations` with `hexmining-yield-insufficient-elapsed-day-coverage`; public output remains `evidence_available` with `yieldHex: null`. Tests cover both guard conditions and the nominal pass-through path.
- **PR status:** SOURCE + TEST — `yield-estimator.ts` and `yield-estimator.test.ts` only; no reader, route, schema, or frontend changes.

**PR #226 (test/hexmining-bpd-attribution-gate) — merged:**
- **Branch:** `test/hexmining-bpd-attribution-gate`
- **Changed files:** `src/services/hexmining/yield-estimator.ts` (updated), `tests/services/hexmining/yield-estimator.test.ts` (updated)
- **What changed:** Step 8.5 BPD attribution gate: `const HEX_BPD_DAY = 353` added; elapsed range including day 353 appends `hexmining-yield-bpd-attribution-unresolved` to result warnings; 12 new BPD attribution tests (range includes 353, excludes 353, boundary at 353, multi-day range, etc.); public output remains `evidence_available` with `yieldHex: null`. Gate satisfies §11.14 item 2 at estimator boundary; full `bpdYieldHex`/`bpdYieldStatus` reader/route assembly deferred to gate-lift PR.
- **PR status:** SOURCE + TEST — `yield-estimator.ts` and `yield-estimator.test.ts` only; no reader, route, schema, or frontend changes.

**PR #227 (test/hexmining-yield-provenance-audit-trail) — merged:**
- **Branch:** `test/hexmining-yield-provenance-audit-trail`
- **Changed files:** `tests/services/hexmining/yield-estimator.test.ts` only (test-only)
- **What changed:** 12 new §11.9 provenance audit trail tests verify all five minimum provenance fields (`chainId`, `sourceFamily`, `observationId`, `rangeStartDay`, `rangeEndDay`) are present in `HexMiningYieldEstimateProvenance` across all result paths (estimated, evidence_available, invalid, insufficient, unavailable). No source changes required — existing provenance shape already satisfies §11.9 requirements.
- **PR status:** TEST-ONLY — no source, schema, or config files changed.

**PR #228 (test/hexmining-yield-reader-route-gated-wiring) — merged:**
- **Branch:** `test/hexmining-yield-reader-route-gated-wiring`
- **Changed files:** `tests/services/hexmining/reader.test.ts` (updated), `tests/api/hexmining-stakes-route-contract.test.ts` (updated)
- **What changed:** 5 new reader tests in "yield gate — reader output never exposes estimated yield" describe block: BPD-era stake, overdue stake, currentDay-unavailable (stakeStatus unknown), multi-stake list, serialized regression. 4 new route contract tests: multi-stake yield gate, BPD attribution warning pass-through without yield computation, serialized regression, error-path no yield fields. All tests verify gate preserved at reader and route layers. No source files changed. Public output remains `evidence_available` / `yieldHex: null`.
- **PR status:** TEST-ONLY — no source, schema, or config files changed.

**PR #229 (docs/hexmining-yield-gate-status-after-228) — merged:**
- **Branch:** `docs/hexmining-yield-gate-status-after-228`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** Document header and Phase completion table updated for PRs #225–#228; §11.1 extended with PR entries for #222–#228 and post-merge audit (1586 tests); §11.10 Step 3 delivery table extended with #225–#228 entries; "Remaining scope" updated to reflect all estimator-boundary gates complete; §11.14 gate-lift prerequisites updated — items 1, 3 marked RESOLVED, item 2 marked RESOLVED at estimator boundary; items 8–11 added as new open gates; "Files that must NOT be changed" updated for reader/route test additions in PR #228; §12 updated with satisfied prerequisites and Step 4 gate-lift PR spec; Validation Notes and Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.
- **Public estimated yield exposed:** NO — `evidence_available` / `yieldHex: null` gate remains in place.

**PR #230 (docs/hexmining-estimated-yield-dto-contract) — merged:**
- **Branch:** `docs/hexmining-estimated-yield-dto-contract`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** §11.16 added — proposed public `HexStakeYieldDto` contract with full TypeScript shape, per-field documentation (`status`, `estimatedYieldHex`, `bpdYieldStatus`, `bpdYieldHex`, `provenance`, `warnings`), status vocabulary (public vs. internal), BPD attribution interaction, provenance field mapping, and six open approval questions (OQ-1–OQ-6); non-approval statement explicit. Document header updated to reference §11.16 and open questions. §12 updated to require §11.16 contract resolution before gate-lift implementation. Validation Notes and Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.
- **Public estimated yield exposed:** NO — gate remains in place; §11.16 was a proposed contract only.

**This PR (docs/hexmining-approve-yield-dto-contract):**
- **Branch:** `docs/hexmining-approve-yield-dto-contract`
- **Changed files:** `docs/v2-hexmining-roadmap.md` only
- **What changed:** §11.16 status changed from PROPOSED to APPROVED FOR IMPLEMENTATION; OQ-1–OQ-6 explicitly resolved with decisions recorded; non-approval statement replaced with implementation approval; §11.14 item 8 marked RESOLVED; §11.14 summary updated (items 1, 3, 7, 8 resolved; items 4–6, 9–11 open); §12 updated with item 8 satisfied, implementation-may-begin guidance, and §11.16 approval reference; document header and Last updated updated. Validation Notes and Final Status extended.
- **PR status:** DOCS-ONLY — no source, test, schema, or config files changed.
- **Public estimated yield exposed:** NO — gate remains in place; contract approved for implementation, not yet implemented.
