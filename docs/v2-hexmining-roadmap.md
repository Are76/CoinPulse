# V2 HexMining Roadmap

> **AI USAGE NOTE:** This is the condensed active working document (~200 lines). Full historical context, completed-phase details, PR logs, validation history, and research records are in [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md). **For routine implementation work, read only this file.** Use `grep` to locate specific gates or sections. Do not load the archive into context unless explicitly asked.

**Document status:** Phase 4C complete and gate-lifted — PRs #208–#252 merged. Public estimated yield is live. Gate 10 executed 2026-06-14 (PR #252); Gate 11 gate-lift PR #252 promotes valid evidence paths to `status: "estimated"` with non-null `yieldHex`. All §11.14 gates resolved.
**Created:** 2026-06-06
**Last updated:** 2026-06-14 (PR #252: Gate 10 evidence collected and Gate 11 production estimator promoted)

**Archive:** [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md) — historical PR logs, completed phase details, research records, validation history, full §1–§15 prose.

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
| Phase 5 | Ended stake discovery | 🔲 Not started |
| Phase 6 | HSI and HTT source families | 🔲 Not started |
| Phase 7 | Pricing, valuation, and PnL | 🔲 Not started |

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
