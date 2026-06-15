# Atlas Design System v1

## Status

- Atlas Design System v1 is a **visual design reference** for CoinPulse.
- It is **not** production code.
- It is **not** an approved implementation plan.
- Generated Figma code must **not** be copied directly into the CoinPulse repository.
- Any implementation must happen later through small, bounded PRs that follow the architecture rules in `CLAUDE.md`.

---

## Product context

CoinPulse is a backend-truth-first DeFi/Web3 portfolio and analytics application targeting PulseChain (chain ID 369) in V1.

- The frontend consumes backend DTO/API contracts only.
- PostgreSQL/canonical backend data is the source of truth for all application state.
- RPC is ingestion/input only — it is never a frontend truth source.
- The frontend must never compute balances, prices, PnL, LP values, or stake values.

---

## Approved design decisions

| Decision | Detail |
|---|---|
| Primary accent | Indigo (`#818cf8`) is approved. |
| Cyan accent | Reserved as a future secondary informational accent only. |
| Evidence available | May be user-visible (short, explanatory) and operator-visible (deeper diagnostic detail). |
| Evidence missing | May be user-visible (short, explanatory) and operator-visible (deeper diagnostic detail). |
| User-facing provenance | Must be short and explanatory — avoid raw technical identifiers. |
| Operator/debug provenance | May expose deeper diagnostic details (source family, endpoint label, warning codes, observed block). |

---

## Restricted / not approved decisions

| Subject | Constraint |
|---|---|
| Estimated badge | Not generally approved. May only render when a backend DTO **explicitly** provides `estimated` status/value together with provenance and warnings. |
| Fallback states | Approved design-level fallbacks: `Unsupported`, `Evidence missing`, `Evidence available`. Additional display states (e.g., unavailable, stale) may surface from backend-provided status — display wording must be determined during implementation, not by this reference. |
| Confidence field | `confidence` is not an Atlas-approved design concept. Whether and how backend-provided confidence values surface in the UI must be decided during a bounded implementation PR, not by this reference. |
| HexMining yield UI | Concrete HexMining yield UI is **deferred**. |
| Fabricated data | No pricing, valuation, PnL, yield, APY, or portfolio totals may be fabricated in design or implementation. |

---

## Component inventory

### StatusBadge

- **Intended use:** Surface backend-provided status (e.g., `Evidence available`, `Evidence missing`, `Unsupported`, `Stale`, `Pending backend sync`).
- **Safe placeholder behavior:** Render backend-provided status text only. Never infer or calculate status locally.
- **Backend-truth constraint:** Status value must come from the backend DTO. Frontend must not derive it.
- **Visibility:** Both user-facing and operator-facing (with different detail levels).

### MetricCard

- **Intended use:** Display a single backend-provided metric (e.g., total portfolio value, token balance).
- **Safe placeholder behavior:** Display `Unavailable` or `Pending backend sync` when backend value is absent. Never display a calculated or fabricated value.
- **Backend-truth constraint:** All values and statuses must originate from backend DTOs.
- **Visibility:** User-facing.

### DataCard

- **Intended use:** Group related backend-provided fields into a card layout (e.g., position details, sync metadata).
- **Safe placeholder behavior:** Individual fields display `Unavailable` independently. The card must not suppress missing fields by substituting zeros.
- **Backend-truth constraint:** All field values must come from the backend DTO.
- **Visibility:** Both user-facing and operator-facing.

### ProvenanceRow

- **Intended use:** Display provenance metadata below a metric or value (source, observed at, evidence status, etc.).
- **Safe placeholder behavior:** Omit or display `Unavailable` for fields not present in the backend DTO. Do not invent provenance.
- **Backend-truth constraint:** All provenance fields must be backend-provided. Frontend must not infer or fabricate provenance.
- **Visibility:** User-facing (short fields); operator-facing (full diagnostic fields).

### ValueDisplay

- **Intended use:** Render a single backend-provided numeric or string value with optional unit label.
- **Safe placeholder behavior:** Display `Unavailable` or `—` when value is absent. Never substitute zero.
- **Backend-truth constraint:** Values must be passed as bigint-safe strings from the backend. No frontend arithmetic.
- **Visibility:** Both user-facing and operator-facing.

### TimestampLabel

- **Intended use:** Display a backend-provided timestamp (observed at, last synced, updated at).
- **Safe placeholder behavior:** Display `Unavailable` when timestamp is absent. Do not display a local client timestamp as a substitute.
- **Backend-truth constraint:** Timestamp must originate from the backend DTO.
- **Visibility:** Both user-facing and operator-facing.

### WarningBanner

- **Intended use:** Surface backend-provided warnings (partial valuation, stale data, missing evidence, reorg events).
- **Safe placeholder behavior:** Only render when the backend DTO includes warning entries. Do not render empty warning states.
- **Backend-truth constraint:** Warning content must come from backend-provided data. Specific field names are determined during implementation.
- **Visibility:** Both user-facing and operator-facing.

### TokenAssetRow

- **Intended use:** Display a single token asset row (token identity, balance, value) within a list.
- **Safe placeholder behavior:** Display `Unavailable` for balance and value independently. Asset identity must be chain-aware and backend-canonical. Never use symbol/name/ticker alone as identity. Canonical identity format is determined by the backend and must be resolved during implementation.
- **Backend-truth constraint:** All balance and value fields must come from the backend DTO. No frontend calculations.
- **Visibility:** User-facing.

### OperatorPanel

- **Intended use:** Expose deeper diagnostic detail to operators — sync status, endpoint, observed block, warning codes, source family.
- **Safe placeholder behavior:** Display `Unavailable` for absent fields. Do not infer diagnostic state.
- **Backend-truth constraint:** All diagnostic values must come from the backend DTO or debug/status API.
- **Visibility:** Operator-facing only.

### Empty states

- **Intended use:** Render when a list or section has no backend data to display.
- **Safe placeholder behavior:** Show a neutral, accurate message. Do not fabricate example data.
- **Backend-truth constraint:** Empty state must reflect genuine absence of backend data, not a frontend loading artifact.
- **Visibility:** Both user-facing and operator-facing.

### Error states

- **Intended use:** Render when a backend request fails or returns an explicit error.
- **Safe placeholder behavior:** Display the backend-provided error message verbatim where appropriate. Do not substitute a generic message that hides backend context.
- **Backend-truth constraint:** Error detail must originate from the backend response.
- **Visibility:** Both user-facing (simplified) and operator-facing (full detail).

---

## Provenance fields

### Default user-facing fields

| Field | Purpose |
|---|---|
| Source | Where the data originated (exchange, chain, protocol). |
| Observed at | When the backend observed the data. |
| Last synced | When the backend last synced this asset or position. |
| Evidence status | `Evidence available` or `Evidence missing` — backend-provided only. |
| Payload version | DTO schema version (e.g., `v1`). |

### Operator/debug fields

| Field | Purpose |
|---|---|
| Source family | Broad category of the data source (e.g., `on-chain`, `rpc`, `indexed`). |
| Observed block | The block number at which the data was observed. |
| Endpoint label | A human-readable label identifying the data source endpoint. Display-only; must not expose raw URLs or credentials. |
| Sync status | Current sync lifecycle state, as provided by the backend. |
| Warning codes | Machine-readable diagnostic codes, as provided by the backend. |

**Important constraints:**

- These fields are **design references only** unless they are already present in backend DTOs.
- The frontend must **not** invent provenance fields.
- The frontend must **not** infer evidence status from local calculations.

---

## Placeholder and data safety rules

### Approved placeholder set

| Placeholder | When to use |
|---|---|
| Backend-provided value | When a real value exists in the backend DTO. |
| Unavailable | When the backend DTO explicitly indicates the value is unavailable. |
| Unsupported | When the backend DTO indicates the feature or asset is not supported. |
| Stale | When the backend DTO indicates the data has exceeded its freshness window. |
| Pending backend sync | When the backend DTO indicates sync is in progress. |
| Evidence available | When the backend DTO explicitly provides this evidence status. |
| Evidence missing | When the backend DTO explicitly provides this evidence status. |

### Data fabrication prohibitions

- No fake token balances.
- No fake prices.
- No fake portfolio totals.
- No fake PnL.
- No fake yield.
- No fake APY.
- No frontend valuation calculations.
- No frontend pricing calculations.
- No frontend PnL calculations.
- No frontend yield calculations.
- No direct live RPC calls from the frontend.

---

## Backend-truth-first implementation guardrails

- PostgreSQL/canonical backend data is the source of truth.
- RPC is ingestion/input only — never a frontend truth source.
- The frontend consumes backend DTO/API contracts only.
- Asset identity must be chain-aware and backend-canonical. Never use symbol/name/ticker alone. Canonical identity format is determined by the backend.
- Crypto/token values must be bigint/string-safe throughout the stack.
- Avoid floating point for token units, hearts, wei, shares, balances, prices, yield, and PnL.
- No frontend calculations for valuation, pricing, PnL, yield, or staking results unless explicitly approved as display-only formatting from backend-provided values.

---

## HexMining-specific guardrails

- Concrete HexMining yield UI is **intentionally deferred**.
- PulseChain chainId 369 native pHEX stakes remain the current focus unless explicitly expanded.
- Yield display requires backend-provided evidence and provenance.
- Estimated yield must only appear from a backend-provided DTO status/value together with warnings and provenance.
- Do not confuse hearts and HEX:
  - 1 HEX = 100,000,000 hearts.
  - Any display conversion from hearts to HEX must be bigint/string-safe and display-only.

---

## Screen skeletons

Atlas v1 currently includes design sketches for:

- Dashboard skeleton
- Debug/Sync skeleton
- Mobile skeleton

**Omissions (intentional):**

- HexMining-specific yield skeleton is intentionally omitted from this reference.
- Generic evidence-backed module patterns may be reused later only after backend DTO rules are approved and a bounded implementation PR is created.

---

## Future implementation path

Safe path for any component or screen that references Atlas v1:

1. Review Atlas v1 as a design reference.
2. Choose one isolated component or one docs-only follow-up.
3. Implement one bounded PR at a time.
4. Do not change API/DTO/schema/package files unless the task explicitly requires it.
5. Add or adjust tests only when implementation begins.
6. Validate that the frontend continues to consume backend DTOs only.

---

## Non-goals

This document introduces no implementation. The following are explicitly out of scope for this PR:

- No component implementation or migration.
- No CSS rollout.
- No design token rollout.
- No dependency or package changes.
- No backend changes.
- No API changes.
- No schema changes.
- No pricing logic.
- No valuation logic.
- No PnL logic.
- No yield logic.
