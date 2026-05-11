# Dashboard Wallet Selection Plan

## 1. Purpose

This document plans the future integration of backend-tracked wallets into the CoinPulse dashboard. It does not implement any code changes. Its goal is to define the correct, architecture-safe sequence so that future PRs do not guess or violate CoinPulse V1 guardrails.

---

## 2. Current State

| Area | Status |
|---|---|
| Wallet import page | `/debug/wallets/import` — exists |
| Tracked wallets page | `/debug/wallets/tracked` — exists (PR #40) |
| Backend read endpoint | `GET /api/wallets/tracked` — exists (PR #38) |
| Frontend hook | `useTrackedWalletsQuery` — exists (PR #39) |
| Import invalidation | Wallet import invalidates tracked wallets query (PR #41) |
| Dashboard wallet selection | **Not yet implemented** |

The dashboard currently must not infer wallet state from local form state, import responses, or any non-backend source. The backend is the only source of truth.

---

## 3. Guardrails

All future work in this area must respect the following non-negotiable rules:

- Frontend consumes backend DTOs only.
- No frontend RPC reads.
- No DexScreener as pricing truth.
- No mock production portfolio data.
- No frontend computation of balances, prices, PnL, LP values, stake values, or transactions.
- Dashboard query invalidation after wallet import is prohibited unless the backend can guarantee that materialized dashboard truth is ready.
- No Ethereum/Base execution in this slice.

---

## 4. Recommended Future Sequence

Each item below should be its own bounded PR:

1. **Dashboard wallet selector shell** — Add a selector component that reads from `useTrackedWalletsQuery`. Do not auto-load the dashboard on mount. No query wiring yet.

2. **Explicit selected-wallet state** — Add controlled form/input state for the selected wallet address. No dashboard fetch triggered yet.

3. **Wire wallet into dashboard query** — Pass the selected tracked wallet address into the existing `useDashboardQuery` only on explicit user action (submit/load button). No implicit or automatic fetching.

4. **Preserve manual wallet entry** — Keep the current manual wallet address input available, or document the replacement behavior before removing it.

5. **Add focused tests** — Cover: empty tracked wallets state, selected wallet flow, and manual wallet address fallback.

6. **Default wallet or auto-load** — Only consider this after backend materialization readiness is confirmed and explicitly signalled. Do not add this speculatively.

---

## 5. Dashboard Selection Behavior

- **No tracked wallets exist:** Show empty-state guidance. Keep manual wallet address input available.
- **Tracked wallets exist:** Show a selector listing each wallet by address, label, and chainId as returned by the backend DTO.
- **User action required:** The user must explicitly choose a wallet and submit/confirm before any dashboard fetch is triggered.
- **Dashboard query key:** Must continue to include `schemaVersion`, `chainId`, `walletAddress`, `quoteAsset`, and `asOf`/`latest`. This key must not be restructured as part of the selection feature.
- **No silent multi-wallet fetch:** Do not automatically fetch dashboard data for all tracked wallets.

---

## 6. Invalidation Policy

| Event | Effect |
|---|---|
| Wallet import | Invalidates `useTrackedWalletsQuery` |
| Wallet import | Does **not** invalidate dashboard query |
| Manual sync / rebuild | Invalidates debug metadata queries |
| Dashboard invalidation | Only when backend confirms materialization is complete |

Dashboard query invalidation after wallet import is deferred until the backend exposes a reliable signal that the derived portfolio state is fully materialized and ready to serve.

---

## 7. Milestone Status

> **As of PR #53, the dashboard wallet-selection milestone is complete.**

### Completed

| Item | Delivered in |
|---|---|
| Backend tracked wallets read endpoint (`GET /api/wallets/tracked`) | PR #38 |
| Frontend tracked wallets query hook (`useTrackedWalletsQuery`) | PR #39 |
| Operator tracked wallets debug page (`/debug/wallets/tracked`) | PR #40 |
| Wallet import invalidates tracked wallets query | PR #41 |
| Dashboard tracked-wallet selector shell | PR #43 |
| Selecting a tracked wallet only populates form fields (no auto-fetch) | PR #45 |
| Dashboard submit remains explicit (user-initiated only) | PR #48 |
| Selected-state and submitted-source visual indicators | PR #48 / PR #51 |
| Selected wallet submit context helper | PR #49 |
| Dashboard request contract verified by tests | PR #50 |
| Submitted wallet source indicator | PR #51 |
| Tracked-wallet matching helper refactored and reused | PR #52 |
| Empty tracked-wallet state links to wallet import page | PR #53 |
| Route, client, and behavior tests cover key contracts | PRs #38–#53 |

### Still Not Implemented

The following items were intentionally deferred and are not part of this milestone:

- No dashboard auto-load on wallet selection.
- No default wallet selection (no wallet pre-selected on mount).
- No wallet delete or edit actions.
- No dashboard query invalidation triggered by wallet import.
- No multi-chain execution beyond existing chain ID handling.
- No frontend computation of balances, prices, or PnL (remains a permanent guardrail).

### Recommended Next Implementation Step

Do **not** add wallet delete/edit actions yet. The V1 dashboard read path is not yet stable, and premature mutation actions could complicate materialization correctness guarantees.

Recommended options in order of priority:

1. **Continue portfolio/dashboard data quality work** — Improve pricing confidence, materialization correctness, and dashboard DTO completeness so that the read path is stable before any write actions are introduced.
2. **Add a wallet delete/archive planning document** — If delete is needed sooner, write a bounded planning doc first (analogous to this one) and get architecture review before touching mutation routes or schema.

---

## 8. Non-Goals

This document and the PRs it describes will not:

- Include any code changes.
- Include any UI changes.
- Include any route changes.
- Include any schema changes.
- Integrate tracked wallets into the dashboard.
- Add wallet delete or edit actions.
- Add multi-chain execution.

---

## 8. Acceptance Criteria for the Future Dashboard Wiring PR

A PR that wires tracked wallets into the dashboard will be considered correct only when all of the following are true:

- Uses `useTrackedWalletsQuery` to source wallet options.
- Preserves backend DTO contracts (no shape assumptions in the UI).
- Keeps the manual wallet address path available, or documents its replacement with explicit rationale.
- Adds focused tests covering empty wallets, selected wallet, and manual wallet fallback.
- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
