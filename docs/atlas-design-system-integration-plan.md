# Atlas Design System & Product Direction — Integration Plan

**Last updated:** 2026-08-03

**Status:** Planning and documentation only. This document introduces no application code, CSS, component, schema, API, or package change.

---

## 1. Purpose

This document records two decisions together, because they are linked:

1. **Atlas** (Figma Make design system) is the intended visual design system for the CoinPulse frontend.
2. CoinPulse's product direction is clarified as a **portfolio tracker first**, with historical/PnL/yield/DeFi analytics as progressive enrichment on top of a fast live view — not as a precondition for showing a wallet's current state.

These are linked because Atlas's component set (`StatusBadge`, `WarningBanner`, `ProvenanceRow`, etc.) is built around explicit data-state surfacing, which is exactly the mechanism the product direction needs to show a fast live view honestly, without pretending partial or pending backend evidence is complete.

This document extends, and does not replace, `docs/design/atlas-design-system-v1.md`. That document is the accepted Atlas **component/placeholder design reference** — approved accents, per-component safe-placeholder behavior, and data-fabrication prohibitions. This document adds what v1 does not cover: product positioning, the data-mode taxonomy, the two architecture paths, the component-to-repository mapping (inspected, not assumed), the phased implementation roadmap, and the immediate next slice. Where the two documents overlap, `atlas-design-system-v1.md`'s approved decisions govern; this document does not re-open them.

Related durable records: `docs/project-decisions.md` (D-035, added alongside this document), `docs/ai-handoff.md`, `CLAUDE.md`, `docs/data-fetching-architecture.md`.

---

## 2. Product definition

> CoinPulse is a PulseChain-first portfolio tracker that gives users a fast view of current wallet assets and positions, then progressively enriches that portfolio with historical transactions, PnL, yield and DeFi analytics.

**Precision note on "current wallet assets and positions":** this means currently known or covered assets and positions, not a guaranteed complete wallet inventory. See §4 (Data modes → Live) for the exact coverage boundary — the live path can miss unregistered/unknown tokens and can drop a token whose balance read failed, and both limitations must be represented explicitly, not implied away by this summary line.

CoinPulse is **not primarily an accounting or tax program**. The canonical ledger and historical backend (raw audit → canonical ledger → materialized state → pricing → PnL, per `CLAUDE.md`) are internal strengths used to improve PnL reliability, yield attribution, historical analysis, provenance, warnings, and coverage. They exist to make the product's numbers trustworthy — they must not become a gate that blocks a useful current-portfolio view while historical evidence is still being built up.

Concretely: a wallet with no ledger history yet, or with a partially-synced ledger, should still be able to see its current PLS balance, currently known token balances, and currently known positions — clearly labeled as live/current and scoped to known coverage, not PnL or historical truth — while historical enrichment proceeds through the existing sync workflow. That workflow is **operator-triggered today, not automatic** — see §9 for the accurate description; this document does not promise background enrichment that does not currently exist.

---

## 3. Non-goals

This document, and the branch that introduces it, do not:

- Implement any Atlas component, token, page, or application code.
- Change CSS, theme files, or any frontend component.
- Change backend services, API routes, DTOs, Prisma schema, or migrations.
- Change package files or lockfiles.
- Change sync, rebuild, pricing, PnL, yield, or HexMining logic.
- Copy Figma Make generated `App.tsx`, Vite config, or the full generated shadcn directory into the repository.
- Select a concrete Atlas-to-repository token mapping (colors/spacing/radius values) — that is Phase 1 implementation work, done in its own PR.
- Approve HSI, HTT, eHEX, cross-chain, or HexMining pricing/valuation/PnL exposure. HexMining scope remains governed by D-032/D-033 (`docs/project-decisions.md`) — native pHEX only.

---

## 4. Data modes

Every value the frontend renders is described along **two separate axes**. Conflating them is the specific mistake this section exists to prevent: "where did this come from" and "can you actually use it right now" are different questions, and a value can be `live` and still `unavailable` (a failed read), or `materialized` and still `conflicting` (an unresolved warning). Both axes require the backend DTO to say so explicitly — the frontend never infers either axis from the absence or shape of data.

This is a **target design discipline for future DTO/UI work**, not a claim that a universal per-value `mode`/`availabilityStatus` pair already exists today. It does not: today's live DTO (`LiveHoldingsSnapshotDto`, `src/services/portfolio/live-snapshot-types.ts`) carries mode and availability information only as separate, DTO-specific fields (`sourceType: "LIVE_RPC_SNAPSHOT"`, `coverage: "known_assets_only"`, `valuationStatus`, per-asset `priceStatus`), not as one uniform pair attached to every value. Exact field names for a unified pair remain future bounded implementation work, scoped one DTO at a time — this document does not invent or mandate new field names.

### Axis A — provenance / data mode

States where a value came from and what evidence class supports it:

- **Live** — backend-observed current wallet or protocol state, read fresh or from a recent snapshot: PLS balance, currently known token balances, current stake state, current pool position, current farm deposit, claimable reward (where supported). Required metadata per value: observed block, observed timestamp, source.
- **Estimated** — backend-provided estimates only — partial current valuation, estimated yield, incomplete price coverage. The frontend must never create these independently; it renders `status: "estimated"` (or equivalent) exactly as the DTO provides it, with its warnings and provenance. This mirrors the existing "Estimated badge" restriction in `docs/design/atlas-design-system-v1.md` (§Restricted decisions): estimated status may only render when the backend DTO explicitly provides it.
- **Materialized** — derived from persisted CoinPulse backend state — ledger-derived token positions, persisted stake state, materialized portfolio state (`PortfolioTokenBalance`, `PortfolioLpPosition`, `PortfolioStakePosition`, per `CLAUDE.md`'s schema overview).
- **Historically verified** — only when sufficient backend evidence exists — covered transaction history, supported PnL, historical yield, ended-stake evidence (e.g. the ended-stake pipeline in `docs/ai-handoff.md`'s Phase 5 entries).

### Axis B — availability / quality status

States whether a value is usable right now, and what limitation applies, independent of which mode produced it:

- **Available** — the value is present and usable as-is.
- **Partial** — some but not all of the expected evidence/coverage is present (e.g. `valuationStatus: "partial"` in the live DTO today).
- **Unavailable** — no usable value exists for this cycle. Never rendered as zero, never silently omitted without a warning.
- **Unsupported** — the backend does not support producing this value at all (distinct from a transient `unavailable`).
- **Stale** — a value exists but has exceeded its freshness window.
- **Conflicting** — evidence disagrees (e.g. a reorg or duplicate observation) and has not been resolved.
- **Pending** — the backend is still working on producing the value (e.g. sync in progress).

### Combining the axes

The two axes compose freely; neither implies the other. Examples that must all be representable: `live` + `available`, `live` + `partial`, `live` + `stale`, `live` + `unavailable`, `materialized` + `available`, `materialized` + `conflicting`, `estimated` + `available`, `historically verified` + `available`.

**Live-path coverage and read failures, stated precisely (current implementation, inspected 2026-08-03):** the live DTO's `coverage: "known_assets_only"` field means the fast path only ever reads tokens already registered in the backend's `Token` table — an unregistered/unknown token never appears in `assets` at all, and this is a real, permanent scope limit, not a transient status. Separately, `src/services/portfolio/live-holdings-snapshot.ts` catches a per-token balance-read failure, records a `balance-read-failed:<assetId>` warning string, and drops that token from `assets` entirely — today that failure is represented only as a warning string, not as a structured per-asset `unavailable` entry. Both are gaps against the target discipline above: a live read failure should reduce coverage and surface as an explicit `live` + `unavailable`/`partial` value with a warning, not a silent omission recoverable only by reading the warnings array. Closing that gap is Phase 2+ implementation work; this document records the target design, not a claim that it is already built.

**Restated policy (unchanged, not new):** unavailable values must never silently disappear or coerce to zero (`CLAUDE.md`; existing DTO status fields `pricing.status`, `valuation.status`, `pnl.status`). Warnings **supplement** provenance and status — they explain *why* — they do not **replace** either axis; a value should never be representable only as a warning string with no corresponding mode/status of its own.

---

## 5. Architecture boundaries

Two complementary data paths feed the frontend. Both terminate in the same place: a versioned backend DTO consumed by TanStack Query.

### Fast portfolio path — a deliberately approved, bounded current-state path

```text
wallet address
  → backend live discovery or snapshot (RPC-backed, backend-only)
  → versioned backend DTO (`LiveHoldingsSnapshotDto`, `GET /api/portfolio/live-snapshot`)
  → TanStack Query (`useLiveSnapshotQuery`)
  → frontend presentation
```

This path exists to make the current-state view fast, independent of how much historical ledger work has completed for that wallet. It is a deliberate product/architecture decision, recorded as such in D-035 (`docs/project-decisions.md`) — not an informal or implicit exception to the backend-truth pipeline in `AGENTS.md` ("PostgreSQL persisted state is the source of truth for application data"; "Canonical ledger entries are accounting truth"). This decision explicitly supplements that pipeline for current-state UX; it does not weaken, replace, or supersede it:

- **PostgreSQL and the canonical ledger remain the sole source of truth** for historical transactions, accounting-grade state, materialized portfolio truth, PnL, and yield. Nothing on this path writes to, replaces, or is treated as canonical ledger truth — `assembleLiveHoldingsSnapshot()` (`src/services/portfolio/live-holdings-snapshot.ts`) makes fresh RPC observations and returns them directly in a DTO, without raw persistence, normalization, or canonical-ledger insertion. That is this path's accepted, bounded scope, not a general license to skip persistence anywhere else in the backend — any future proposal to route live-snapshot observations into raw/ledger tables is separate bounded backend work, not authorized here.
- **RPC stays backend-only.** `assembleLiveHoldingsSnapshot()` is a `server-only` module; the frontend never calls RPC directly, on this path or any other. This decision does not authorize direct frontend RPC calls or any other bypass of the DTO boundary elsewhere in the app.
- **Block-pinned** — every native and token balance read is pinned to one `observedBlock` captured once at the start of assembly, so the DTO's "as of" claim is accurate rather than a mix of reads taken at different heights.
- **Coverage-limited** — `coverage: "known_assets_only"` (§4 Axis B; precision note in §2): only tokens already registered in the backend's `Token` table are read, and a token whose balance read fails is dropped from `assets`, surfaced only via a `balance-read-failed:<assetId>` warning.
- **Warning-bearing** — read failures and partial valuation surface through the DTO's `warnings` array; never silent, never coerced to zero.
- **Not canonical ledger truth, not historical truth, not accounting truth, not PnL, not yield.** The DTO fixes `pnlStatus: "unsupported"` — the live path never claims otherwise, and no future Phase 4+ PR may relabel a live value as verified, accounting, or historical truth.

`src/components/dashboard/live-snapshot-card.tsx` and the live-holdings-snapshot DTO shipped in PR #356 are the first concrete instance of this path — recorded here as the pattern, not introduced by this document.

### Historical enrichment path

```text
RPC ingestion
  → persisted raw evidence
  → canonical ledger
  → materialized state
  → stored pricing evidence
  → backend PnL/yield analysis
  → versioned backend DTO
  → frontend presentation
```

This is the existing truth stack from `CLAUDE.md`, unchanged. It progressively raises coverage as it runs — it does not gate the fast path. **This path runs when an operator triggers manual sync today (`POST /api/sync/manual`), not automatically in the background** — see §9 for the accurate description of the current trigger and why this document does not promise automatic enrichment.

### What does not change

- Frontend consumes backend DTOs only.
- No direct RPC from the frontend.
- No DexScreener (or other Tier 3 aggregator) as pricing truth.
- No frontend financial calculation of any kind.
- No symbol-only asset identity — `assetId` format (`chain:369:erc20:0x...`) throughout.
- All token/monetary values remain bigint/string-safe end to end (no `Number`, unary `+`, or `parseFloat` on them).

---

## 6. Atlas design principles

Carried forward from `docs/design/atlas-design-system-v1.md` (do not re-decide these here):

- Primary accent indigo (`#818cf8`); cyan reserved as a future secondary informational accent.
- Evidence-available / evidence-missing states may be both user-facing (short, explanatory) and operator-facing (deeper diagnostic detail).
- User-facing provenance is short and avoids raw technical identifiers; operator/debug provenance may expose source family, endpoint label, warning codes, observed block.
- No fabricated data in design or implementation: no fake balances, prices, totals, PnL, yield, or APY.

Atlas is adopted **as a visual system for the existing CoinPulse frontend**, not as a second application. Figma Make output is design reference material only.

---

## 7. Component mapping

Mappings below were confirmed by inspecting the current repository (2026-08-03), not assumed from the Atlas reference. Several Atlas-named components already exist as real, in-tree code — Atlas naming has already begun leaking into production components ahead of this plan; this document is catching the documentation up to that fact, not initiating it.

| Atlas reference | CoinPulse purpose | Current repository state (inspected) |
|---|---|---|
| StatusBadge | Live, estimated, verified, stale, pending, unavailable | **Partial implementation — not the full target set.** [`src/components/ui/atlas-status-badge.tsx`](../src/components/ui/atlas-status-badge.tsx) (`AtlasStatusBadge`) implements `BadgeVariant`: `synced` / `pending` / `stale` / `conflicting` / `unsupported` / `unavailable` / `error` / `estimated` / `evidence-available` / `evidence-missing` — it has **no `live`, `materialized`, or `historically-verified` variant**. Mapping the plan's Axis A provenance modes (§4) onto badge variants is unbuilt; treat that gap as future Phase 2 work, not something to build in Phase 1. Legacy parallel: [`src/components/ui/status/status-badge.tsx`](../src/components/ui/status/status-badge.tsx) (`StatusBadge`/`LabelBadge`, `ProvenanceChip`-based) — the atlas-status-badge.tsx header comment says "Use this in new components. Legacy code uses ProvenanceChip + LabelBadge." Consolidation is Phase 2 work, not decided here. |
| ProvenanceRow | Source, block, and evidence-status metadata | Implemented: [`src/components/ui/atlas-provenance-row.tsx`](../src/components/ui/atlas-provenance-row.tsx) (`AtlasProvenanceRow`), composes `AtlasStatusBadge` + `TimestampLabel`. `AtlasProvenanceRowProps` currently exposes `source`, `observedAt`, `schemaVersion`, `evidenceStatus`, `operator`, `sourceFamily`, `syncStatus`, `warningCodes` — **no `confidence` field**, and none is added here: `docs/design/atlas-design-system-v1.md` (§Restricted decisions) states `confidence` is not an Atlas-approved design concept and requires its own bounded implementation decision. Do not add confidence display to `ProvenanceRow` without that separate decision. Legacy parallel: `src/components/ui/provenance-chip.tsx`. |
| TimestampLabel | Snapshot and observation time | Implemented: [`src/components/ui/value/timestamp-label.tsx`](../src/components/ui/value/timestamp-label.tsx). |
| ValueDisplay | Backend-provided value rendering | Implemented: [`src/components/ui/value/value-display.tsx`](../src/components/ui/value/value-display.tsx), status-aware (`present`/`unavailable`/`unsupported`/`stale`/`pending`/`null`), never substitutes zero. |
| WarningBanner | Partial coverage and backend warnings | Implemented: [`src/components/ui/data-state/warning-banner.tsx`](../src/components/ui/data-state/warning-banner.tsx) (`warn`/`danger`/`info` tones). |
| MetricCard | Portfolio totals, PnL, yield and coverage | No standalone exported component yet. `AtlasMetricCard` and `AtlasSummaryCard` exist only as module-private helpers inside [`src/components/dashboard/dashboard-presenters.tsx`](../src/components/dashboard/dashboard-presenters.tsx) (lines ~659, ~700), used for dashboard status tiles and summary fields. Extracting a shared, exported `MetricCard` primitive is Phase 2 work. |
| DataCard | Portfolio and analytics sections | Closest existing equivalents: [`src/components/ui/section-card.tsx`](../src/components/ui/section-card.tsx) (`SectionCard`, titled/subtitled container) and [`src/components/ui/surface-card.tsx`](../src/components/ui/surface-card.tsx) (`SurfaceCard`, base card surface). `SectionCard` composes `SurfaceCard`. |
| TokenAssetRow | Token holdings and underlying assets | Closest existing equivalent: `PositionRow` (module-private, [`src/components/portfolio/asset-holdings-screen.tsx`](../src/components/portfolio/asset-holdings-screen.tsx) line ~308). Not yet a shared, reusable primitive. |
| PositionCard | Stakes, LP positions, farms and lending | Closest existing equivalents: `StakeCard`/`EndedStakeCard` (module-private, [`src/components/hexmining/hexmining-screen.tsx`](../src/components/hexmining/hexmining-screen.tsx)) for stakes, and `LpPositionsTable` ([`src/components/dashboard/dashboard-presenters.tsx`](../src/components/dashboard/dashboard-presenters.tsx) line ~570, rendered from `dashboard-screen.tsx`) for LP positions. **LP frontend presentation already exists** — `LpPositionsTable` renders LP token identity, LP quantity, underlying token0/token1 net quantities, valuation via `ValueDisplay`, PnL status via `StatusBadge`, and warnings. What's missing is a shared, reusable `PositionCard`-style primitive spanning stakes/LP/farms/lending, not an LP surface built from scratch. Farms and lending have no frontend surface at all yet. Phase 5 should extend/restyle the existing `LpPositionsTable` toward a shared primitive rather than treat liquidity UI as net-new. |
| OperatorPanel | Sync and diagnostic controls | Closest existing equivalents: [`src/components/debug/operator-tools-nav.tsx`](../src/components/debug/operator-tools-nav.tsx) (`OperatorToolsNav`, link rail) and the diagnostic sections in [`src/components/dashboard/dashboard-presenters.tsx`](../src/components/dashboard/dashboard-presenters.tsx) (`BackendStatusPanel`, materialization/ledger/PnL coverage sections) and `src/components/debug/debug-sync-screen.tsx`. No single consolidated `OperatorPanel` primitive exists yet. |
| ActionRail | Navigation or contextual actions | No dedicated component. Primary/operator navigation currently lives in [`src/components/layout/app-shell.tsx`](../src/components/layout/app-shell.tsx) as plain `<Link>` lists driven by `nav-config` (`PRIMARY_NAV_LINKS`, `OPERATOR_NAV_LINKS`), styled via `coin-sidebar__link` / `coin-mobile-nav__link` CSS classes — not an Atlas-named component. |
| ButtonSystem | Buttons and form actions | No dedicated `Button` component exists. Buttons are plain `<button>` elements styled inline/per-file across several screens (dashboard, portfolio, transactions, hexmining, debug-sync, wallet-import). Introducing a shared button primitive is Phase 2 work. |

**Reading this table:** "Implemented" rows are already in production and already Atlas-named — treat any further Atlas work on them as extension/consolidation, not net-new. "No dedicated component" rows are real gaps; Phase 2 is where they get built, one bounded PR at a time, not all at once.

---

## 8. Target information architecture

Unchanged from the current app shell — this document does not propose new routes or navigation restructuring. This section is split into currently active routes (verified against `src/components/layout/nav-config.ts` and the `app/**/page.tsx` files that back them, inspected 2026-08-03) and target/future notes, so a later navigation PR does not duplicate what already exists.

### Current user-facing routes (`PRIMARY_NAV_LINKS`)

- `/` — Dashboard (`src/components/dashboard/dashboard-screen.tsx`). This is **two separate backend requests, not one combined endpoint**:
  - `GET /api/portfolio/dashboard` (`useDashboardQuery`) — the persisted/materialized `PortfolioDashboardDto`. Always requested first.
  - `GET /api/portfolio/live-snapshot` (`useLiveSnapshotQuery`) — the live-holdings-snapshot DTO (PR #356). A **separate DTO and endpoint**, not a field of `PortfolioDashboardDto`. `dashboard-screen.tsx` enables this second query only when the dashboard response shows `materialization.status === null` and no materialized token/LP/stake positions exist (`shouldShowLiveSnapshotFallback`) — it is a conditional fallback rendered alongside the dashboard, not a replacement for it.
- `/transactions` — transaction history.
- `/hexmining` — HexMining screen (native pHEX only, per D-032/D-033).
- `/portfolio/assets` — asset holdings screen ("Holdings" in nav).

### Current operator/debug routes (`OPERATOR_NAV_LINKS`)

- `/debug/sync` — manual sync/rebuild trigger (`POST /api/sync/manual`, `POST /api/rebuild`).
- `/debug/wallets/import` — wallet import.
- `/debug/wallets/tracked` — tracked wallets.
- `/debug/prices/status` — pricing status.
- `/debug/hexmining/evidence/missing` — an existing page (`app/debug/hexmining/evidence/missing/page.tsx`) not currently linked from `OPERATOR_NAV_LINKS`; direct-URL access only. Recorded here so a future navigation PR does not treat it as new, and so it isn't silently duplicated.

### Target/future navigation (not decided by this document)

Any information-architecture change — e.g. a distinct "Live Portfolio" route separate from `/`, or linking the currently-orphaned evidence-missing page into operator nav — is a separate, bounded decision. Do not duplicate `/`, `/portfolio/assets`, `/transactions`, or `/hexmining` under new paths without an explicit decision superseding this inventory.

---

## 9. Portfolio dashboard direction

The dashboard should be read, going forward, as two layers on one screen rather than one monolithic PnL view:

1. A **live layer** — current balances/positions via the fast portfolio path (`GET /api/portfolio/live-snapshot`, conditionally enabled — see §8), rendered as soon as the backend has a snapshot, independent of ledger completeness.
2. An **enrichment layer** — coverage, warnings, PnL, yield, and historical detail, rendered from `GET /api/portfolio/dashboard`'s materialized fields, reflecting whatever the backend has processed so far.

**How the enrichment layer actually advances today (stated accurately, not implied):** historical sync is **operator-triggered, not automatic**. Wallet import (`POST /api/wallets/import`) persists/tracks the wallet only — it does not itself run ingestion. Both `useDashboardQuery` and `useLiveSnapshotQuery` are read-only and never trigger sync. The only sync trigger found in the repository is the operator action on `/debug/sync` that posts to `POST /api/sync/manual`, consistent with `AGENTS.md`'s "do not add workers, queues, Redis, or background infrastructure unless explicitly requested." A wallet can remain live-only indefinitely without an operator running manual sync. A safe automatic or user-triggered persisted-sync orchestration is a separate, future bounded design and implementation task — this document does not propose or promise one.

`LiveSnapshotCard` (`src/components/dashboard/live-snapshot-card.tsx`, PR #356) is the first concrete piece of the live layer. The enrichment layer is the existing `MaterializationFreshnessSection`, `LedgerCoverageSection`, and `PnlCoverageSection` in `dashboard-presenters.tsx`. No merge or redesign of these sections is proposed here; this section only names the pattern so future PRs build toward it deliberately instead of by accident.

---

## 10. Frontend safety rules

Restated for this document's scope (all already binding per `CLAUDE.md` and `docs/design/atlas-design-system-v1.md`):

- Consume backend DTOs only; no reconstruction of balances, prices, PnL, LP, or stake values in the frontend.
- No direct RPC calls from the frontend.
- No DexScreener, or any commercial aggregator, as pricing truth.
- No frontend financial calculations of any kind, including "just formatting" that changes a business result.
- No symbol-only asset identity.
- Bigint/string-safe handling for every monetary or token value, throughout.
- No zero-coercion for missing/stale/unavailable/unsupported values — explicit status always.

---

## 11. Accessibility requirements

Atlas adoption must not regress accessibility. Any Phase 2+ primitive (`StatusBadge`, `MetricCard`, `TokenAssetRow`, `Button`, etc.) must, at implementation time:

- Carry sufficient color contrast for status/warning colors in both the badge dot/text and background, in light and dark contexts if the app supports both.
- Not encode status by color alone — pair every status color with a text label (Atlas's existing badges already do this) or an icon plus label.
- Keep interactive elements (buttons, nav links, action rail items) keyboard-reachable and focus-visible, with accessible names — not icon-only controls without `aria-label`.
- Preserve semantic heading structure in cards (`SectionCard`/`DataCard` titles) rather than styling arbitrary `div`s to look like headings.
- Ensure warning/error banners are announced appropriately (e.g. `role="status"`/`role="alert"` where the severity warrants it) — to be confirmed against the current `WarningBanner` implementation during its Phase 2 consolidation PR, not asserted here.

---

## 12. Phased PR roadmap

Each phase is a sequence of small, bounded PRs — never one large PR per phase.

### Phase 0 — Decision and inventory (this document)

- Design-system decision record (D-035 in `docs/project-decisions.md`).
- Current frontend component inventory (§7 above).
- Atlas-to-CoinPulse mapping (§7 above).

### Phase 1 — Foundation audit and gap-filling (not a from-scratch introduction)

**This foundation already substantially exists.** PR #297 (commit `87b9e50`, "apply Atlas design system — tokens, typography, component library") already landed: Atlas hex color tokens for surfaces/borders/text/accents/status in `app/globals.css` (matching the approved indigo accent in `docs/design/atlas-design-system-v1.md`), a `--radius-*` scale, a `--space-*` scale, `--shadow-elevated`/`--shadow-card` elevation tokens, and JetBrains Mono for data values via `app/layout.tsx`. Phase 1 is therefore an audit-and-gap-fill pass, not a greenfield token introduction:

- Inventory existing semantic tokens (color, typography, spacing, radius, elevation, status colors) already in `app/globals.css` / `app/layout.tsx`.
- Compare them against the approved Atlas v1 reference (`docs/design/atlas-design-system-v1.md`).
- Identify missing, duplicate, or incorrectly named tokens — e.g. the missing `live` / `materialized` / `historically-verified` badge variants noted in §7 — not a wholesale replacement of what already exists.
- Migrate only the bounded gaps found; preserve existing visual behavior unless an approved discrepancy against Atlas v1 is found.
- Keep any new status tokens split per §4's two axes (provenance/data-mode tokens vs. availability/quality-status tokens) — do not collapse them into one flat list.
- First implementation slice — see §15.

### Phase 2 — UI primitives

- Consolidate `AtlasStatusBadge` as the single status-badge primitive; retire or wrap the legacy `StatusBadge`/`ProvenanceChip` path.
- Extract a shared, exported `MetricCard` from the current `dashboard-presenters.tsx` private helpers.
- Extract a shared `DataCard` from `SectionCard`/`SurfaceCard`.
- Extract a shared `TokenAssetRow` from `PositionRow`.
- Extract a shared `PositionCard` from `StakeCard`/`EndedStakeCard`.
- Introduce a `ButtonSystem` primitive and a wallet-input primitive.

### Phase 3 — App shell

- Desktop navigation restyle (not restructure) onto Atlas tokens.
- Mobile navigation restyle.
- Wallet selector restyle.
- Page header pattern.

### Phase 4 — Live Portfolio

- Atlas-styled live portfolio surface (building on `LiveSnapshotCard`).
- Wallet import and selection restyle.
- Loading, error, empty, and warning states restyle.
- Coverage and provenance restyle.

### Phase 5 — Unified portfolio

- Tokens.
- HexMining (native pHEX only, per D-032/D-033).
- Liquidity.
- Farms.
- Lending.
- Unsupported/unpriced sections.

### Later phases (unscheduled, not started by this document)

- Canonical transactions restyle.
- Protocol-specific DeFi support.
- PnL.
- Yield.
- Historical charts.
- Product polish.

Each bullet above is implemented as its own bounded PR, or split further if it touches more than one primitive/screen.

---

## 13. Definition of done

For this document/PR:

- [x] Atlas is recorded as the intended frontend design system, extending (not duplicating) `docs/design/atlas-design-system-v1.md`.
- [x] Product direction (portfolio-tracker-first, progressive enrichment) is recorded.
- [x] Two-axis data taxonomy is recorded: provenance/data mode (live/estimated/materialized/historically verified) kept separate from availability/quality status (available/partial/unavailable/unsupported/stale/conflicting/pending), with current live-DTO coverage/read-failure limitations described accurately rather than assumed.
- [x] Two-path architecture (fast portfolio path, historical enrichment path) is recorded.
- [x] Component mapping table is recorded, with every "implemented" claim tied to an inspected file path.
- [x] Phased roadmap is recorded, each phase decomposed into bounded PRs, and Phase 1/§15 are recast as an audit-and-gap-fill against the token foundation already landed in PR #297 rather than a from-scratch introduction.
- [x] Immediate next implementation slice is named (§15) and does not duplicate already-completed foundation work.
- [x] The fast portfolio path is recorded as an explicit, bounded architecture decision (§5, D-035) that supplements — and does not authorize bypassing — the backend-truth pipeline elsewhere.
- [x] Live snapshot and dashboard are documented as two separate API calls/DTOs (§8), not one combined endpoint.
- [x] Current route inventory (§8) and component-capability claims (§7) match inspected repository state, not assumption.
- [x] No application code, CSS, schema, API, DTO, or package file changed.

For each future phase's PRs, done means: one bounded scope, passing `npm run test`/`lint`/`typecheck`/`build`, no unrelated file changes, and (from Phase 4 onward) a live-portfolio surface that never labels a live/estimated value as PnL, accounting, or historical truth.

---

## 14. Risks

- **Naming drift risk:** Atlas-named components (`AtlasStatusBadge`, `AtlasMetricCard`, `AtlasProvenanceRow`) and legacy components (`StatusBadge`, `ProvenanceChip`) currently coexist. Without a Phase 2 consolidation PR, new code may inconsistently pick one or the other.
- **Scope-creep risk:** "Introduce Atlas" is an easy phrase to over-scope into a full redesign PR. The phased roadmap (§12) exists specifically to prevent that; any PR that touches more than one phase bullet should be split.
- **Data-mode mislabeling risk:** The live portfolio path (fast path, §5) is new enough that a future PR could accidentally render a live value with a status word ("verified", "accurate") that overstates what the backend actually attested. Phase 4 PRs must map exactly to the DTO's own status field.
- **Table staleness risk:** §7's mapping reflects the repository at 2026-08-03. It will drift as Phase 2 PRs land; each Phase 2 PR that changes a mapped component should update the corresponding row rather than leaving it stale.
- **HexMining scope risk:** Phase 5's HexMining bullet must stay bounded to native pHEX (D-032/D-033) unless a future decision explicitly reopens HSI/HTT/eHEX for frontend exposure.
- **Axis-conflation risk:** §4's provenance/data-mode axis and availability/quality-status axis are easy to collapse back into one flat list in future edits or PR descriptions. Any change to the taxonomy must keep both axes named separately and must not claim a unified per-value `mode`/`availabilityStatus` pair exists in a DTO until that DTO is actually inspected and confirmed to carry it.
- **Foundation-duplication risk:** PR #297 already landed a substantial Atlas token layer in `app/globals.css`/`app/layout.tsx`. A future Phase 1 PR that skips the audit step in §12 and reintroduces tokens from scratch risks duplicating or overwriting production tokens rather than closing real gaps.
- **Enrichment-trigger overpromise risk:** it is easy to describe the historical enrichment path (§5, §9) as running automatically "in the background." Today it is operator-triggered only (`POST /api/sync/manual`); any future PR or doc edit that implies automatic background enrichment without first shipping that orchestration would misstate current behavior.

---

## 15. Immediate next implementation slice

Given the token foundation already landed in PR #297 (§12 Phase 1), the first Atlas production-code PR must **not** reintroduce token infrastructure from scratch. It should be:

```text
refactor(ui): audit and align existing Atlas design tokens
```

**Scope:**

- Inventory existing semantic tokens, fonts, spacing, radius, elevation, and status colors already defined in `app/globals.css` and `app/layout.tsx`.
- Compare them against the approved Atlas v1 reference (`docs/design/atlas-design-system-v1.md`).
- Identify and document any missing, duplicate, or incorrectly named tokens (e.g. the missing `live` / `materialized` / `historically-verified` badge variants noted in §7).
- Migrate only the bounded gaps found.
- Preserve existing visual behavior unless an approved discrepancy against Atlas v1 is found.
- No page redesign.

**Explicit non-goals for that PR:**

- No dashboard redesign.
- No new navigation.
- No component replacement.
- No backend changes.
- No DTO/API/schema changes.
- No package changes unless strictly required.
- No Figma-generated application code.
- No wholesale replacement of the token layer already landed in PR #297.
