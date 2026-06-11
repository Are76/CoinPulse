# V2 HexMining Roadmap

> **AI USAGE NOTE:** This is the condensed active working document (~200 lines). Full historical context, completed-phase details, PR logs, validation history, and research records are in [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md). **For routine implementation work, read only this file.** Use `grep` to locate specific gates or sections. Do not load the archive into context unless explicitly asked.

**Document status:** Phase 4C internal pipeline complete and gated — PRs #208–#232 merged. Public estimated yield intentionally gated. `HexStakeYieldDto` contract APPROVED FOR IMPLEMENTATION (§11.16, OQ-1–OQ-6 resolved, PR #232). Gate-lift implementation PR is the next step.
**Created:** 2026-06-06
**Last updated:** 2026-06-11 (docs/split-hexmining-roadmap-archive: condensed active roadmap; history moved to archive)

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
| Phase 4C | Yield estimation and DTO wiring | ⚠️ In progress — PRs #208–#232 merged; formula complete and gated; DTO contract approved (PR #232); gate-lift implementation PR is next |
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

**Current public behavior:** `estimateHexMiningYield` always returns `status: "evidence_available"`, `yieldHex: null` for valid evidence paths. The formula runs internally (proven via injectable `applyCalculation` in tests) but the result is not surfaced publicly. The reader (`reader.ts`) hardcodes `yield: { status: "unsupported", ... }`.

See archive §11.14 for full gating rationale, internal behavior details, and review comment policy.

### Files that must NOT be changed until gate is lifted

| File | Constraint |
|---|---|
| `src/services/hexmining/reader.ts` | `yield: { status: "unsupported", ... }` hardcoded; no `fetchYieldEvidence` dep |
| `app/api/hexmining/stakes/route.ts` | No yield evidence fetch; calls `readNativeHexStakes` without yield wiring |
| `src/services/hexmining/observation-evidence-provider.ts` | No `EvidenceWithCanonicalPayload` export; no `getObservationEvidenceWithPayloadForRange` |
| `tests/services/hexmining/reader.test.ts` | Gate-preservation tests only — no yield wiring or estimated-yield assertions |
| `tests/api/hexmining-stakes-route-contract.test.ts` | Gate-preservation tests only — no estimated-yield DTO assertions |

### Gate-lift prerequisites

A gate-lift PR may promote `"estimated"` into public output **only** when all of the following are satisfied in that PR:

1. **Elapsed-days-only coverage rule** — ✅ **RESOLVED (PR #225)**
2. **BPD attribution gate** — ✅ **RESOLVED at estimator boundary (PR #226)**; full `bpdYieldHex`/`bpdYieldStatus` reader/route assembly required in gate-lift PR
3. **§11.9 provenance fields** — ✅ **RESOLVED (PR #227)**
4. `HexStakeDto.yield` field assembly in `reader.ts` updated — including `bpdYieldHex`, `bpdYieldStatus`, `estimatedYieldHex` wiring from `estimateHexMiningYield`
5. `GET /api/hexmining/stakes` route wires the `fetchEvidence` dep
6. Contract tests cover full estimated-yield DTO path (non-null `estimatedYieldHex`, BPD correlation, provenance completeness in assembled `HexStakeDto`)
7. **EES/penalty distribution** — ✅ **RESOLVED (PR #224, Finding A)** — penalties already included in `dayPayoutTotal`; see `docs/hexmining-penalty-distribution-research.md`
8. **DTO contract approval** — ✅ **RESOLVED (PR #232)** — §11.16 OQ-1–OQ-6 approved
9. Explicit contract tests for public estimated-yield DTO path in gate-lift PR
10. Live-data fixture or opt-in integration verification against a known historical day range on PulseChain (chain ID 369)
11. Final docs record approving the gate lift — this roadmap updated with gate-lifted record and PR reference

**Resolved:** items 1, 3, 7, 8; item 2 resolved at estimator boundary. **Remaining for implementation PR:** items 4–6, 9–11.

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
| `"evidence_available"` | `"unavailable"` | Formula ran internally; gate active; reader maps this (OQ-2) |
| `"insufficient_observations"` | `"unavailable"` | Evidence range does not cover elapsed period |
| `"invalid_observation"` | `"unavailable"` | Payload decode failure |

**`estimatedYieldHex`** — non-null only when `status: "estimated"`; hearts as bigint decimal string (OQ-1); cumulative yield via §8 formula (`Σ (stakeShares × dayPayoutTotal) / dayStakeSharesTotal`, bigint floor, multiply-first) over `[lockedDay, elapsedEndDay]` where `elapsedEndDay = min(currentDay − 1, lockedDay + stakedDays − 1)`; includes `dayPayoutTotal[353]` when elapsed range covers day 353; `bpdYieldHex` is a reporting split of this value, not additional.

**`bpdYieldStatus`** — null only when `status: "unsupported"`; `"applicable"` when stake was active on BPD day 353; `"not_applicable"` when stake did not span day 353 (`lockedDay > 353` or `lockedDay + stakedDays ≤ 353`); `"unknown"` when elapsed range includes day 353 but attribution unresolved (`hexmining-yield-bpd-attribution-unresolved` warning present).

**`bpdYieldHex`** — non-null ONLY when `bpdYieldStatus: "applicable"` AND `status: "estimated"`; hearts bigint decimal string; **portion of `estimatedYieldHex`** attributable to BPD day 353 — attribution/reporting split only (OQ-3). **Do NOT add `bpdYieldHex` to `estimatedYieldHex`** — `estimatedYieldHex` already includes day 353's payout.

**`provenance`** — non-null when `status: "estimated"`; fields match `HexMiningYieldEstimateProvenance` — `chainId` (always 369), `sourceFamily` (always `"HEXMINING"`), `observationId` (UUID to `HexMiningObservation` record), `rangeStartDay`, `rangeEndDay` (= `elapsedEndDay`) (OQ-4).

**`warnings`** — always present, never null; current codes pass through unchanged (OQ-5): `"hexmining-yield-bpd-attribution-unresolved"`, `"hexmining-yield-no-elapsed-days"`, `"hexmining-yield-insufficient-elapsed-day-coverage"`; future internal-only codes must be filtered at reader boundary.

**`schemaVersion`:** top-level `HexStakeDto.schemaVersion` bumped on gate lift — no separate yield subobject version (OQ-6).

**This contract is APPROVED FOR IMPLEMENTATION.** Gate-lift PR may proceed. Remaining prerequisites: §11.14 items 4–6, 9–11.

---

## Next PR

```
feat(hexmining): wire estimated yield fields into HexStakeDto and API route
```

**Prerequisites satisfied:** items 1–3, 7, 8 resolved. **Remaining in gate-lift implementation PR:** items 4–6, 9–11.

**Required in the gate-lift PR:**
- Follow the approved §11.16 contract above (field shapes, OQ-1–OQ-6 decisions, `evidence_available` → `"unavailable"` mapping)
- Update `HexStakeDto.yield` field assembly in `reader.ts` — call `estimateHexMiningYield`, assemble `bpdYieldHex`/`bpdYieldStatus`/`estimatedYieldHex`/`provenance`/`warnings`
- Wire `fetchEvidence` dep into `GET /api/hexmining/stakes` route
- Contract tests for full DTO path (non-null `estimatedYieldHex`, BPD field correlation, provenance completeness, warnings pass-through)
- Live-data fixture or opt-in integration verification against a known historical day range on PulseChain
- Final docs record approving gate lift (update this roadmap)
- `valuation.status` and `pnl.status` remain `"unsupported"` — unchanged

**Must NOT happen without a gate-lift implementation PR:**
- No change to steps 8–9 of `estimateHexMiningYield` to return `"estimated"` without all prerequisites
- No `reader.ts` or `route.ts` yield wiring without coverage rule, BPD modelling, and EES verification
- No partial gate lift (e.g., surfacing `yieldHex` without provenance completeness)
- No frontend yield changes, React hooks, or TanStack Query hooks for yield until Step 4 is merged
- No `canonicalPayload` exposure in any DTO or API response
- No `valuation.status`/`pnl.status` changes (remain `"unsupported"` until Phase 7)

Full historical context and all prior decisions: [`docs/v2-hexmining-roadmap-archive.md`](./v2-hexmining-roadmap-archive.md)
