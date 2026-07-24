# V2 HexMining Roadmap

> **AI USAGE NOTE:** This is the condensed active working document (~200 lines). Full historical context, completed-phase details, PR logs, validation history, and research records are in [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md). **For routine implementation work, read only this file.** Use `grep` to locate specific gates or sections. Do not load the archive into context unless explicitly asked.

**Document status:** HexMining Phase 1 completion scope formally defined as **native pHEX only** (active + ended stakes on PulseChain, chain ID 369) — see D-032 in `docs/project-decisions.md` and the Phase 1 Completion Scope section below. HSI, HTT, and eHEX are **later-phase scope and do not block Phase 1 completion**. Phase 6 HSI backend foundation exists (PRs #312–#317) but public HSI exposure is later scope; HSI live verification is deferred pending availability of an HSI-owning wallet. Native active-stake reads are live-verified (#318) and block-pinned (#319). The ended-stake pipeline (Phase 5, PRs #307–#310) has since gained an operator discovery trigger (#333), start-time stake evidence persistence (#334), completion from start evidence (#335), reader/API verification tooling (#336), historical contract-state evidence recovery (#337), and frontend ended-stake history rendering (#340). Phase 4C remains complete and gate-lifted (PRs #208–#252). Public estimated yield is live for valid evidence paths. HTT source family remains not started.
**Created:** 2026-06-06
**Last updated:** 2026-07-24 (D-032: HexMining Phase 1 completion scope defined as native pHEX only; ended-stake follow-up PRs #333–#337, #340 recorded)

**Archive:** [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md) — historical PR logs, completed phase details, research records, validation history, full §1–§15 prose.

---

## HexMining Phase 1 Completion Scope (D-032)

> **Canonical scope decision:** D-032 in [`docs/project-decisions.md`](./project-decisions.md), accepted 2026-07-24.
> **HexMining Phase 1 = native pHEX stakes on PulseChain (chain ID 369), active + ended.**
> HSI, HTT, and eHEX are **later-phase scope**. They are deferred, not dropped — and they do **not** block declaring HexMining Phase 1 complete. Do not read the internal phase table below (Phases 0–7) as a Phase 1 completion checklist; Phase 1 completion is measured against this scope section only.

**In Phase 1 scope:**

- PulseChain `chainId 369` only
- Native pHEX stakes — active and ended
- Backend-canonical persistence and evidence (raw observations, provenance, warnings)
- DTO/API contracts for native active and ended stakes
- Frontend display of active and ended native stakes (backend DTOs only)
- Backend-provided estimated yield with provenance and warnings
- Bigint/string-safe display conversion (formatting only)
- No frontend computation of yield, pricing, valuation, or PnL

**Later-phase scope (not Phase 1, not dropped):**

- Public HSI DTO/API exposure, HSI frontend UI, HSI live verification
- HTT (Hedron Token Transfer / Actuator delegated) source family
- Ethereum eHEX / any non-PulseChain chain
- Pricing, valuation, and PnL (Phase 7)

**Native pHEX status ladder (exact claims — do not overstate):**

| Area | Implemented | Tested | Live-verified | Operator tooling | Operator evidence |
|---|---|---|---|---|---|
| Native active stakes | ✅ (#190–#191, block-pinned #319) | ✅ | ✅ (#318: stakeCount 32/32, all checks passed) | ✅ (#318) | ✅ recorded in PR #318 |
| Native ended stakes — discovery/reader/DTO/API | ✅ (#307–#310, operator trigger #333) | ✅ | ❌ no live verification run recorded | ✅ verification runner (#336) | ⏳ still pending — evidence template `PENDING OPERATOR EXECUTION` |
| Native ended stakes — evidence completion/recovery | ✅ (#334 start evidence, #335 completion, #337 historical contract-state recovery) | ✅ | ❌ no execute-mode run recorded in repo | ✅ recovery CLI (#337) | ⏳ still pending — evidence template `PENDING OPERATOR EXECUTION` |
| Ended-stake frontend history | ✅ (#340) | ✅ | n/a | n/a | n/a |
| Public estimated yield | ✅ (#252 gate-lifted) | ✅ | ✅ Gate 10 (#252) | ✅ | ✅ recorded in PR #252 |
| HSI backend foundation | ✅ (#312–#317) — **not publicly exposed** | ✅ | ❌ deferred — no HSI-owning wallet available | ✅ (#316) | ⏳ `PENDING OPERATOR EXECUTION` — later phase |
| HTT | ❌ not started — later phase | — | — | — | — |
| eHEX | ❌ not started — later phase | — | — | — | — |

Nothing above is marked live-verified without recorded evidence (per D-017, D-020, D-027).

---

## Phase Completion Status

| Phase | Title | Status |
|---|---|---|
| Phase 0 | Roadmap and decisions | ✅ Complete — merged PR #188 |
| Phase 1 | HexMining DTO contract skeleton | ✅ Complete — merged PR #189 |
| Phase 2 | Native PulseChain active stake reads | ✅ Complete — merged PRs #190, #191 |
| Phase 3 | HexMining page shell / unsupported valuation display | ✅ Complete — merged PRs #192, #193 |
| Phase 4A | Observation persistence, status API, and operator surface | ✅ Complete — merged PRs #199–#202 |
| Phase 4B | dailyDataRange read boundary, persistence wiring, and gated operator route | ✅ Complete — merged PRs #204, #205, #206 |
| Phase 4C | Yield estimation and DTO wiring | ✅ Complete and gate-lifted — PRs #208–#252 merged; formula, DTO contract, reader assembly, route wiring, contract coverage, live-data evidence, and production promotion complete |
| Phase 5 | Ended stake discovery and reader | ✅ Complete — merged PRs #307–#310. Follow-ups merged after Phase 5 closure: operator discovery trigger (#333), start-time stake evidence persistence (#334), completion from start evidence (#335), reader/API verification tooling (#336), historical contract-state evidence recovery (#337), frontend ended-stake history (#340) |
| Phase 6 | HSI and HTT source families | ⏭️ **Later phase — outside HexMining Phase 1 completion scope (D-032).** HSI backend foundation complete — merged PRs #312–#317 (persistence, discovery, reader enrichment, live-verification tooling). Not exposed via public DTO/API (`HexStakeSource` still `"native"` only). HSI live verification **deferred pending availability of an HSI-owning wallet**. HTT source family not started. |
| Phase 7 | Pricing, valuation, and PnL | 🔲 Not started — **later phase, outside HexMining Phase 1 completion scope (D-032)** |

> **Note:** the phase numbers in this table are the roadmap's internal delivery phases, not the Phase 1 completion bar. Per D-032, HexMining Phase 1 completion covers the native pHEX scope only (see the Phase 1 Completion Scope section above); Phases 6–7 are later scope.

> **Native active-stake reads (Phase 2) hardening:** after Phase 2 shipped, PR #318 added native active-stake live-verification tooling and PR #319 pinned the production native stake reader's `stakeCount`/`stakeLists` reads to a single captured block. See the Native Active-Stake Verification Record below.

---

## Core Guardrails

These rules apply to every PR. See archive §3 and §11.6 for full rationale.

- **No frontend calculation.** Yield, PnL, valuation, and stake value are backend-only. Frontend consumes backend DTOs.
- **No frontend RPC.** `dailyDataRange`, `globalInfo`, `currentDay`, `stakeCount`, `stakeLists` are backend ingestion only.
- **No DexScreener.** Use on-chain PulseChain reserve-derived pricing only.
- **No symbol-only identity.** Always use `chain:369:erc20:0x...` (`assetId` format).
- **No zero coercion.** Missing, stale, or unavailable values must remain explicit with provenance and warnings.
- **No mock production data** in DTOs or frontend.
- **No pricing/PnL until Phase 7.** `valuation.status` and `pnl.status` remain `"unsupported"` until Phase 7 prerequisites are met.
- **No HSI/HTT, ended stakes, or Ethereum eHEX** until their respective phases.
- **No `canonicalPayload` exposure** in any DTO or API response.
- **Raw audit records are immutable.** Mark reorgs as REORGED — never delete or overwrite.

---

## Gate-Lift State (§11.14)

**Current public behavior:** `estimateHexMiningYield` returns `status: "estimated"` with non-null `yieldHex` for valid evidence paths after PR #252. The `/api/hexmining/stakes` route passes `estimateYield` into `readNativeHexStakes`, and the reader maps valid estimator output into the approved public `HexStakeYieldDto` shape with non-null `estimatedYieldHex` when provenance is complete. BPD-spanning ranges still carry `bpdYieldHex: null` with the `hexmining-yield-bpd-attribution-unresolved` warning.

See archive §11.14 for full gating rationale, internal behavior details, and review comment policy.

### Gate-protected implementation state

| File | Current constraint/status |
|---|---|
| `src/services/hexmining/yield-estimator.ts` | ✅ PR #252 gate-lifted: valid evidence paths now return `status: "estimated"` with non-null `yieldHex`; `bpdYieldHex: null` with BPD warning for BPD-spanning ranges |
| `src/services/hexmining/reader.ts` | ✅ PR #234 closed reader assembly: injectable `estimateYield` results can assemble the approved `HexStakeYieldDto` shape; without the dep, yield remains `"unsupported"` |
| `app/api/hexmining/stakes/route.ts` | ✅ PR #235 closed route wiring: the route passes `estimateYield` into `readNativeHexStakes` using the existing `estimateHexMiningYield` + evidence-provider dependency path |
| `src/services/hexmining/observation-evidence-provider.ts` | Evidence provider remains backend-only; no canonical payload exposure in public DTO/API response |
| `tests/services/hexmining/reader.test.ts` | ✅ Reader contract coverage includes estimated DTO assembly and safety downgrades |
| `tests/api/hexmining-stakes-route-contract.test.ts` | ✅ PR #236 closed focused route/public DTO contract coverage for the injected estimated-yield path and route envelope |

### Gate-lift prerequisites

A gate-lift PR may promote `"estimated"` into public output **only** when all of the following are satisfied before release:

1. **Elapsed-days-only coverage rule** — ✅ **RESOLVED (PR #225)**
2. **BPD attribution gate** — ✅ **RESOLVED at estimator boundary (PR #226)**; reader/route `bpdYieldHex`/`bpdYieldStatus` assembly and contract coverage closed by PRs #234–#236; production promotion lifted by PR #252
3. **§11.9 provenance fields** — ✅ **RESOLVED (PR #227)**
4. **`HexStakeDto.yield` field assembly** — ✅ **RESOLVED (PR #234)** — including `bpdYieldHex`, `bpdYieldStatus`, `estimatedYieldHex`, `provenance`, and `warnings` wiring from injected `estimateYield` results
5. **`GET /api/hexmining/stakes` route dependency wiring** — ✅ **RESOLVED (PR #235)** — route passes `estimateYield` into `readNativeHexStakes` through the existing `estimateHexMiningYield` + `getObservationEvidenceWithPayloadForRange` path
6. **Contract tests for full public estimated-yield DTO path** — ✅ **RESOLVED (PR #236)** — covers non-null `estimatedYieldHex`, BPD field correlation/statuses, provenance completeness, missing-provenance downgrade, and route envelope
7. **EES/penalty distribution** — ✅ **RESOLVED (PR #224, Finding A)** — penalties already included in `dayPayoutTotal`; see `docs/hexmining-penalty-distribution-research.md`
8. **DTO contract approval** — ✅ **RESOLVED (PR #232)** — §11.16 OQ-1–OQ-6 approved
9. **Explicit contract tests for public estimated-yield DTO path** — ✅ **RESOLVED (PR #236)** — focused route/reader contract tests cover the approved DTO path before public promotion
10. Live-data fixture or opt-in integration verification against a known historical day range on PulseChain (chain ID 369) — ✅ **RESOLVED (PR #252)** — Gate 10 executed 2026-06-14: stakeId 942663, stakeShares 1414291579679, lockedDay 2310, rangeStartDay 2310, rangeEndDay 2384 (75 entries), reproducedYieldHex "20589444841", all 9 criteria passed, harness returned `verified: true`. Evidence package recorded in PR #252 body.
11. Final docs record approving the gate lift — ✅ **RESOLVED (PR #252)** — roadmap updated with gate-lifted evidence and PR reference.

**All gates resolved.** Items 1–11 complete. Public estimated yield is live via `src/services/hexmining/yield-estimator.ts` — valid evidence paths now surface `status: "estimated"` with non-null `yieldHex`.

---

## Approved Public DTO Contract (§11.16)

**Approved in PR #232.** OQ-1–OQ-6 resolved. See archive §11.16 for full prose and original open-question history.

### TypeScript shape

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
  | { bpdYieldStatus: "applicable"; bpdYieldHex: string }
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

### Field contract

**`status`** — discriminant

| Value | Public | Description |
|---|---|---|
| `"unsupported"` | Yes | Gate not lifted or chain unsupported |
| `"unavailable"` | Yes | Evidence fetch failed or insufficient observations |
| `"estimated"` | Yes | Gate-lift target — approved contract shape |
| `"exact"` | Yes | Reserved Phase 5+ |

**Internal statuses — must NEVER appear in any public DTO or API response:**

| Internal status | Maps to public | Notes |
|---|---|---|
| `"evidence_available"` | `"unavailable"` | Internal non-estimated status used when an injected calculation boundary does not produce an estimate; must never appear in public DTOs (OQ-2) |
| `"insufficient_observations"` | `"unavailable"` | Evidence range does not cover elapsed period |
| `"invalid_observation"` | `"unavailable"` | Payload decode failure |

**`estimatedYieldHex`** — non-null only when `status: "estimated"`; hearts as bigint decimal string (OQ-1); cumulative yield via §8 formula (`Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal`, bigint floor, multiply-first) over `[lockedDay, elapsedEndDay]` where `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)`; includes `dayPayoutTotal[353]` when elapsed range covers day 353; `bpdYieldHex` is a reporting split of this value, not additional.

**`bpdYieldStatus`** — null only when `status: "unsupported"`; `"applicable"` when stake was active on BPD day 353; `"not_applicable"` when stake did not span day 353 (`lockedDay > 353` or `lockedDay + stakedDays ≤ 353`); `"unknown"` when elapsed range includes day 353 but attribution unresolved (`hexmining-yield-bpd-attribution-unresolved` warning present).

**`bpdYieldHex`** — non-null ONLY when `bpdYieldStatus: "applicable"` AND `status: "estimated"`; hearts bigint decimal string; **portion of `estimatedYieldHex`** attributable to BPD day 353 — attribution/reporting split only (OQ-3). **Do NOT add `bpdYieldHex` to `estimatedYieldHex`** — `estimatedYieldHex` already includes day 353's payout.

**`provenance`** — non-null when `status: "estimated"`; fields match `HexMiningYieldEstimateProvenance` — `chainId` (always 369), `sourceFamily` (always `"HEXMINING"`), `observationId` (UUID to `HexMiningObservation` record), `rangeStartDay`, `rangeEndDay` (= `elapsedEndDay`) (OQ-4).

**`warnings`** — always present, never null; current codes pass through unchanged (OQ-5): `"hexmining-yield-bpd-attribution-unresolved"`, `"hexmining-yield-no-elapsed-days"`, `"hexmining-yield-insufficient-elapsed-day-coverage"`; future internal-only codes must be filtered at reader boundary.

**`schemaVersion`:** top-level `HexStakeDto.schemaVersion` bumped on gate lift — no separate yield subobject version (OQ-6).

**This contract is IMPLEMENTED FOR VALID EVIDENCE PATHS.** Infrastructure and focused contract-test closure are complete through PR #236, closure documentation was recorded by PR #237, and PR #252 resolved §11.14 items 10–11 plus the final production promotion from gated internal evidence to public `"estimated"`.

---

## Gate-Lift PR Record

```
feat(hexmining): lift public estimated yield gate after live-data verification
```

**Merged as PR #252.** Items 1–11 are resolved. Gate 10 live-data verification used [`docs/hexmining-live-data-verification-plan.md`](./hexmining-live-data-verification-plan.md) and [`docs/hexmining-gate10-execution-plan.md`](./hexmining-gate10-execution-plan.md). Gate 11 production promotion changed valid evidence paths from internal `"evidence_available"`/`yieldHex: null` behavior to public `"estimated"` with non-null `estimatedYieldHex`.

**2026-06-12 closure note (PRs #235–#236):** PR #235 wires the `/api/hexmining/stakes` route to pass `estimateYield` into `readNativeHexStakes` through the existing `estimateHexMiningYield` dependency path. PR #236 adds focused contract coverage for estimated yield plus provenance, BPD `applicable`/`not_applicable`/`unknown`, missing-provenance downgrade, and the route response envelope. These infrastructure/test changes introduced no fabricated yield, no frontend truth, and no DTO weakening.

**Gate-lift PR scope actually merged:**
- Followed the approved §11.16 contract above (field shapes, OQ-1–OQ-6 decisions, internal `evidence_available` never public)
- Kept the production promotion narrow so valid evidence can surface public `"estimated"` output
- Executed and recorded live-data verification against a known historical day range on PulseChain exactly as scoped in the Gate 10 verification docs
- Recorded final docs approval for the gate lift
- Left `valuation.status` and `pnl.status` as `"unsupported"`

**Not changed by the gate lift:**
- No ended stake discovery / exact yield
- No HSI/HTT source families
- No pricing, valuation, or PnL support
- No frontend accounting or yield computation
- No `canonicalPayload` exposure
- No Ethereum eHEX support

**Must NOT happen as a result of the gate lift:**
- No partial future gate lift (e.g., surfacing new yield semantics without provenance completeness)
- No frontend yield calculation; the frontend may only render backend DTO fields
- No `canonicalPayload` exposure in any DTO or API response
- No `valuation.status`/`pnl.status` changes (remain `"unsupported"` until Phase 7)

Full historical context and all prior decisions: [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md)

---

## Phase 5 Completion Record

**Status:** Complete — PRs #307–#310 merged to main (2026-07-03).

Phase 5 delivered a backend pipeline for discovering and reading ended HEX stakes from persisted `RawStakeAction` endStake records. No frontend UI, no pricing, no valuation, no PnL, no HSI/HTT, and no Ethereum eHEX were introduced.

### Slices merged

| PR | Slice | What it delivered |
|---|---|---|
| #307 | Slice 1 — Observation model and store | `RawEndedHexStakeObservation` Prisma model, migration, `persistEndedHexStakeObservation`, `readEndedHexStakeObservations`, idempotent upsert, observation store tests |
| #308 | Slice 2 — Discovery service | `discoverEndedHexStakes`: reads `RawStakeAction` END records, cross-references START records, persists observations with `isComplete: false` and `lockedDay: null`, discovery tests |
| #309 | Slice 3 — Reader and DTO assembly | `readEndedHexStakes`, `EndedHexStakeDto`, `EndedHexStakeListDto`, bigint → decimal string serialization, reader tests |
| #310 | Slice 4 — API route | `GET /api/hexmining/ended-stakes` wiring `readEndedHexStakes`, Zod validation, 400/500 error envelopes, route contract tests |

### Service and data flow

```
RawStakeAction (END rows)
  └─ discoverEndedHexStakes()
       ├─ cross-references START record by stakeId
       └─ persistEndedHexStakeObservation()
            └─ RawEndedHexStakeObservation (persisted)
                 └─ readEndedHexStakeObservations()
                      └─ readEndedHexStakes()
                           └─ EndedHexStakeListDto
                                └─ GET /api/hexmining/ended-stakes
```

### Key architectural constraints (Phase 5)

- `lockedDay` and `stakeShares` are always `null` on discovery — they cannot be recovered from `RawStakeAction` records. `isComplete: false` is set on every observation at discovery time with warning `hexmining-ended-stake-lockedday-unknown`.
- `discoveryMethod` is always `"raw_stake_action"` for Phase 5 observations.
- Bigint fields (`endBlockNumber`, `startBlockNumber`) are serialized as decimal strings in the DTO.
- The reader owns DTO assembly. The API route delegates entirely to the reader with no additional transformation.
- List-level `isComplete` is `false` when any stake observation has `isComplete: false`.
- List-level `warnings` aggregates all individual stake warnings.

### What Phase 5 deliberately did not include

- No `lockedDay` or `stakeShares` recovery (no on-chain backfill from `stakeLists`)
- No `status: "exact"` yield (requires `yieldHex` confirmed at endStake — deferred)
- No HSI or HTT source families
- No pricing, valuation, or PnL
- No frontend UI or HexMining ended-stake display
- No Ethereum eHEX
- No schema changes after Slice 1

---

## Phase 6 HSI Completion Record

**Status:** HSI implementation complete — PRs #312–#317 merged to main (2026-07-04). HSI live verification is **deferred pending availability of an HSI-owning wallet**.

Phase 6 delivers the HSI (Hedron Stake Instance) **backend pipeline**: observation persistence, discovery, and reader enrichment for HSI stakes owned as Hedron NFTs, plus operator live-verification tooling. **HSI is not yet exposed through the public HexMining DTO/API contract** — `HexStakeSource` is still typed `"native"` only and the public `GET /api/hexmining/stakes` route still calls only `readNativeHexStakes`. Public HSI DTO/API integration is not yet done (see Planned / not started). The HTT (Hedron Token Transfer / Actuator delegated) source family remains **not started**. No pricing, valuation, PnL, or frontend UI was introduced.

### Slices merged (Implemented)

| PR | Slice | What it delivered |
|---|---|---|
| #312 | Slice 1 — Observation persistence | `RawHsiStakeObservation` Prisma model, migration, and idempotent observation store |
| #313 | Slice 1 hardening | Hardened `RawHsiStakeObservation` identity/storage safety and migration index naming |
| #314 | Slice 2 — Discovery service | `discoverHsiStakes`: reads HSI NFT ownership, pins reads to a captured `observedAtBlock`, rejects unsupported `chainId` before RPC/persistence, persists two-phase-lifecycle observations |
| #315 | Slice 3 — Reader (stake enrichment) | HSI reader that enriches persisted observations with stake fields and flips `isComplete` |
| #316 | Slice 4 — Live-verification **tooling** | `runHsiLiveVerification` runner, opt-in CLI wrapper, operator runbook, and evidence template (mock-validated); presence/consistency booleans only |
| #317 | Docs alignment | Aligned `RawHsiStakeObservation` comment with the two-phase lifecycle |

### Deferred

- **HSI live verification (not completed).** PR #316 shipped the verification *tooling* only. A genuine live run against a real PulseChain HSI **was not executed**. No HSI-owning wallet is currently available to run it against. (Note: the native runner in #318 only reads HEX `stakeCount`/`stakeLists` — it does not query HSI/ERC-721 ownership, so it does not itself measure HSI NFT count.) The evidence template remains `PENDING OPERATOR EXECUTION`. Status: **deferred pending availability of an HSI-owning wallet.** Do not state that HSI verification passed.

### Planned / not started

- **Public HSI DTO/API integration** — wiring HSI into `HexStakeSource` (`"hsi"`), the public DTO contract, and the `GET /api/hexmining/stakes` route. Not yet done; the backend HSI pipeline above is not exposed publicly.
- HTT (Hedron Token Transfer / Actuator delegated) source family.
- HexMining pricing, valuation, and PnL (Phase 7) — `valuation.status` and `pnl.status` remain `"unsupported"`.
- HSI frontend UI.
- Ethereum eHEX.

---

## Native Active-Stake Verification Record

**Status:** Complete — PRs #318–#319 merged to main (2026-07-04). These are hardening/verification follow-ups to the already-complete native active-stake reads (Phase 2). No new roadmap phase.

### Implemented

- **#318 — Native active-stake live verification tooling.** Additive operator tooling (runner, CLI wrapper, runbook, evidence template, mock-only tests). It drives the existing `stakeCount` → `stakeLists` read path against a known PulseChain wallet and reports presence/consistency booleans only — no pricing, valuation, yield, or PnL. A live run against the production fixture wallet `0x75f808367720951e789d47e9e9db51148d9aa765` (chain ID 369, `observedAtBlock` 26944376) recorded **stakeCount 32 / enumeratedCount 32, all checks passed** — i.e. 32 native HEX stakes enumerated consistently. This runner checks native `stakeCount`/`stakeLists` only; it does not query HSI/ERC-721 ownership.
- **#319 — Production native stake reader block pinning.** `readNativeHexStakes` now captures the current block once and pins **every** `stakeCount` and `stakeLists` read to that single block, removing the theoretical race where per-read `latest` calls could observe changed stake state mid-enumeration. `getBlockNumber` failure still degrades gracefully to `latest` with the existing `hexmining-provenance-block-unavailable` warning; `currentDay` is intentionally left unpinned.

### Not claimed

- No ended-stake live verification exists — the ended-stake pipeline (Phase 5) is discovery/reader only; do not claim live verification for it.
- No pricing, valuation, PnL, or frontend accounting was introduced by #318 or #319.
