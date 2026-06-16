# CoinPulse Pricing Observability Audit

**Date:** 2026-06-16
**Branch audited:** origin/main (2c77853)
**Working tree:** CLEAN
**Scope:** Read-only. Zero changes made.

---

## 1. Current Pricing Architecture

```
PulseX V1/V2 DEX Routers (on-chain RPC, viem)
        │
        ▼
onchain-pulsex-fetcher.ts       ← price + liquidity from getAmountsOut + getReserves
        │
        ▼
price-ingestion.ts              ← orchestrates fetch → draft
        │
        ▼
price-store.ts                  ← persist PriceObservation (SHA-256 deduplicated, append-only)
        │
        ▼
price-resolver.ts               ← select best observation (priority, confidence, freshness)
        │
        ▼
GET /api/prices/status          ← operator status DTO (sources, ok/degraded/unknown)
POST /api/prices/ingest         ← manual ingestion trigger (curl or future operator UI)
        │
        ▼
usePricingStatusQuery → PricingStatusScreen (/debug/prices/status)
```

**Source of truth:** PostgreSQL `PriceObservation` table.
**Input:** PulseChain RPC (viem `readContract`). RPC is ingestion input only — never frontend truth.
**Frontend:** Consumes backend DTOs only. Zero price computations in components.

---

## 2. Current Implemented Routes / Screens / Services

| Layer | File | Status |
|-------|------|--------|
| Prisma model | `prisma/schema.prisma` → `PriceObservation` | ✓ Complete |
| Enum | `PriceSourceType` (ONCHAIN_POOL, ONCHAIN_ROUTE, ORACLE, MANUAL, DEXSCREENER) | ✓ Complete |
| Fetcher | `src/services/pricing/fetchers/onchain-pulsex-fetcher.ts` | ✓ Complete |
| Store | `src/services/pricing/price-store.ts` | ✓ Complete |
| Ingestion | `src/services/pricing/price-ingestion.ts` | ✓ Complete |
| Resolver | `src/services/pricing/price-resolver.ts` | ✓ Complete |
| Status service | `src/services/api/prices.ts` → `getPricingStatusReport()` | ✓ Complete |
| Route: status | `app/api/prices/status/route.ts` → `GET /api/prices/status` | ✓ Complete |
| Route: ingest | `app/api/prices/ingest/route.ts` → `POST /api/prices/ingest` | ✓ Complete |
| API client | `src/lib/api/prices-client.ts` → `fetchPricingStatus()` | ✓ Complete |
| Query hook | `src/lib/query/use-pricing-status-query.ts` (15s staleTime, retry:false) | ✓ Complete |
| Query key | `queryKeys.prices.status(369)` in `src/lib/query/query-keys.ts` | ✓ Complete |
| Screen | `src/components/prices/pricing-status-screen.tsx` | ✓ Complete |
| Page route | `src/app/debug/prices/status/page.tsx` → `/debug/prices/status` | ✓ Complete |
| Tests: resolver | `tests/services/pricing/price-resolver.test.ts` | ✓ Complete |
| Tests: store | `tests/services/pricing/price-store.test.ts` | ✓ Complete |
| Tests: status svc | `tests/services/pricing/prices-status.test.ts` (500+ assertions) | ✓ Complete |
| Tests: ingestion | `tests/services/pricing/price-ingestion.test.ts` | ✓ Complete |
| Tests: status route | `tests/api/prices-status-route-contract.test.ts` | ✓ Complete |
| Tests: ingest route | `tests/api/prices-ingest-route-contract.test.ts` | ✓ Complete |
| Tests: screen wiring | `tests/components/pricing-status-screen-wiring.test.ts` (170 lines) | ✓ Complete |

---

## 3. What Works in Dev Today

### Architecture guardrails — all passing

- **DexScreener is permanently disabled.** It lives in `DISALLOWED_PRIMARY_SOURCES`
  in `price-resolver.ts`. Any DEXSCREENER observation is rejected with
  `reason: "SOURCE_DISABLED"`. The status screen surfaces it as `status: "disabled"`.
- **pDAI is not pegged to $1.** Returns actual observed price (par ~1.00 currently
  from ORACLE source, but treated identically to any other asset by the resolver).
- **Frontend computes nothing.** `PricingStatusScreen` only renders backend DTO
  fields verbatim. No arithmetic, no `useEffect`, no `setInterval`, no external
  provider references confirmed by wiring tests.
- **Observations are append-only.** SHA-256 hash deduplication ensures idempotency
  across replays and rebuilds.

### Confidence + source metadata chain

- `confidence` field: `0.0000`–`1.0000` (Decimal(5,4))
- Confidence thresholds from pool liquidity:

| Liquidity (USD) | Confidence |
|----------------|-----------|
| ≥ $1,000,000 | 0.95 |
| ≥ $100,000 | 0.85 |
| ≥ $10,000 | 0.70 |
| ≥ $1,000 | 0.55 |
| < $1,000 | 0.30 |
| No liquidity found | 0.50 (fallback) |

- `liquidityUsd`, `routeMetadata`, `blockNumber`, `staleAfterSeconds` all persisted.

### Source priority ranking

| Source | Priority | Notes |
|--------|---------|-------|
| ONCHAIN_POOL | 5 | Direct pair reserve read |
| ONCHAIN_ROUTE | 4 | Multi-hop via DEX router |
| ORACLE | 3 | pDAI par reference |
| MANUAL | 2 | Operator override |
| DEXSCREENER | 0 | **Disabled — never selected** |

### PriceObservation model (schema.prisma)

```prisma
model PriceObservation {
  id                String          @id          // SHA-256 hash (deterministic)
  chainId           Int
  assetId           String                       // chain:369:erc20:0x...
  assetAddress      String?
  quoteAsset        String                       // "fiat:usd"
  price             Decimal         @db.Decimal(65, 18)
  sourceType        PriceSourceType
  sourceId          String
  routeMetadata     Json?
  liquidityUsd      Decimal?        @db.Decimal(65, 18)
  confidence        Decimal         @db.Decimal(5, 4)
  observedAt        DateTime
  blockNumber       BigInt?
  staleAfterSeconds Int
  metadata          Json?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([chainId, assetId, quoteAsset, observedAt(sort: Desc)])
  @@index([chainId, sourceType, observedAt(sort: Desc)])
}
```

### GET /api/prices/status — DTO shape

```typescript
type PricingStatusDto = {
  schemaVersion: "v1";
  status: "ok" | "degraded" | "unknown";
  asOf: string; // ISO 8601
  sources: Array<{
    sourceType: string;
    status: "ok" | "degraded" | "disabled" | "unknown";
    latestObservedAt: string | null;
    staleAfterSeconds: number | null;
    observationsCount: number;
    rejectedCount: number;
    reason: "source_disabled" | "latest_observation_stale" | "no_observations" | null;
  }>;
};
```

### POST /api/prices/ingest — request / response

```typescript
// Request body
{
  chainId: number,
  blockNumber: string,        // bigint-safe decimal string
  observedAt: string,         // ISO 8601
  assets: Array<{
    assetId: string,          // "chain:369:erc20:0x..." or "chain:369:native:PLS"
    tokenAddress: Address,    // 0x-prefixed, 42 chars
    tokenDecimals: number,    // 0–18
    quoteAsset: string        // "fiat:usd"
  }>
}

// Response (200 OK)
{
  data: {
    schemaVersion: "v1",
    chainId: number,
    blockNumber: string,
    observedAt: string,
    fetchedCount: number,
    persistedCount: number,
    failedCount: number,
    failedAssets: string[]
  }
}
```

### Manually triggering price ingestion in dev

```bash
curl -X POST http://localhost:3000/api/prices/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 369,
    "blockNumber": "21000000",
    "observedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "assets": [
      {
        "assetId": "chain:369:native:PLS",
        "tokenAddress": "0x0000000000000000000000000000000000000000",
        "tokenDecimals": 18,
        "quoteAsset": "fiat:usd"
      },
      {
        "assetId": "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
        "tokenAddress": "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
        "tokenDecimals": 8,
        "quoteAsset": "fiat:usd"
      }
    ]
  }'
```

Requires `PULSECHAIN_RPC_URL` set in `.env` and live PulseChain RPC connectivity.

---

## 4. What Does Not Work Yet

| Gap | Impact | Severity |
|-----|--------|----------|
| **No dev seed command for price observations** | `prisma/seed.ts` seeds chains/tokens but zero `PriceObservation` records. Developer must know the exact curl payload to populate prices. No `npm run prices:seed` script exists. | Medium |
| **No "Ingest Prices" operator button** | `POST /api/prices/ingest` works but requires curl. The `/debug/prices/status` screen is read-only with no mutation trigger. | Medium |
| **No `use-price-ingest-mutation.ts` hook** | The mutation counterpart to `usePricingStatusQuery` does not exist. Blocker for adding the UI trigger. | Low (blocker for button only) |
| **`src/config/pricing.ts` not present** | Pricing thresholds, staleness TTL, lookback window, and router addresses are scattered across `price-resolver.ts` and `onchain-pulsex-fetcher.ts`. Maintainability gap, not a runtime bug. | Low |
| **Dashboard does not render per-asset pricing confidence** | `GET /api/portfolio/dashboard` includes `pricing.status` but the dashboard UI does not display per-asset confidence, staleness warnings, or unpriced asset indicators. | Low |
| **No pricing coverage metrics in dashboard DTO** | No field tracking which assets are priced vs. unpriced, no aggregated confidence score, no source-type breakdown. | Low (future work) |

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **Fresh dev setup has no prices** — `/debug/prices/status` shows `status: "unknown"` for all sources until someone manually calls the ingest endpoint | High (every fresh clone) | Add seed script or operator button (proposed PR) |
| **RPC unavailability in dev** — `POST /api/prices/ingest` returns `failedCount > 0` silently if `PULSECHAIN_RPC_URL` is unset or unreachable | Medium | Document in README; add explicit env check |
| **DEXSCREENER is schema-present, not schema-excluded** — the disable is a runtime check in `DISALLOWED_PRIMARY_SOURCES`, not a database constraint. Code added outside the resolver could persist DEXSCREENER observations that would be counted but not selected | Low | Acceptable; resolver is the correct enforcement point |
| **pDAI ORACLE confidence hardcoded at 1.0** — if pDAI depegs, the ORACLE source continues reporting confidence 1.0. ONCHAIN_POOL (priority 5) would win over ORACLE (priority 3) if both observations exist, but only if on-chain ingestion is active | Low | No bug; resolver priority handles it. Document assumption. |

---

## 6. Recommendation

**→ CODE PR NEEDED**

The pricing observability layer is architecturally complete and correct. All guardrails
pass. DexScreener is disabled. Frontend never computes prices. The only gap blocking
a useful dev pricing visibility flow is: there is no way to populate price observations
without manually crafting a curl command. This is a developer experience gap, not an
architecture gap.

---

## 7. Proposed PR

**Branch:** `feat/pricing-dev-seed-and-ingest-trigger`

**PR title:** `feat(pricing): add dev price seed script and operator ingest button`

### Exact scope

**Part A — Dev seed script**
Add `scripts/seed-prices.ts` that calls `POST /api/prices/ingest` for default
PulseChain assets (PLS, pHEX, pDAI). Add `"prices:seed"` to `package.json` scripts.
Script must exit gracefully with a warning (not an error) if RPC is unreachable.

**Part B — Operator ingest button on `/debug/prices/status`**
Add `src/lib/query/use-price-ingest-mutation.ts` using `useMutation` from TanStack Query.
Wire an "Ingest Prices" button into `PricingStatusScreen`. On settle (success, error,
or conflict), invalidate `queryKeys.prices.status(369)` — same pattern as
`use-manual-sync-mutation.ts`.

**Part C — Optional: extract `src/config/pricing.ts`**
Move confidence thresholds, `staleAfterSeconds`, lookback window, and DEX router
addresses from `price-resolver.ts` / `onchain-pulsex-fetcher.ts` into one constants
file. Pure refactor, zero behavior change.

### Files likely to change

```
package.json
scripts/seed-prices.ts                            ← NEW
src/lib/query/use-price-ingest-mutation.ts        ← NEW
src/lib/api/prices-client.ts                      ← add postPriceIngest() fn
src/components/prices/pricing-status-screen.tsx   ← add "Ingest Prices" button
src/config/pricing.ts                             ← NEW (Part C, optional)
src/services/pricing/price-resolver.ts            ← update import (Part C only)
src/services/pricing/fetchers/onchain-pulsex-fetcher.ts ← update import (Part C only)
```

### Tests required

```
tests/lib/query/use-price-ingest-mutation.test.ts
  - calls POST /api/prices/ingest on mutate
  - invalidates queryKeys.prices.status(369) on settle (success and error)
  - does not retry on 4xx

tests/components/pricing-status-screen-wiring.test.ts  ← extend existing
  - screen renders "Ingest Prices" button
  - button calls usePriceIngestMutation hook, not direct fetch
  - button is disabled during pending state
  - no computation of price/valuation/PnL in button handler
```

### Hard stop rules

- No mock price data in seed script — must call live `POST /api/prices/ingest` or
  skip gracefully if RPC is unavailable. No hardcoded price values.
- No frontend price computation added to screen or mutation handler.
- No DexScreener references in any new code.
- No valuation or PnL promotion — `valuation.status` and `pnl.status` remain
  unchanged throughout.
- No schema changes — `PriceObservation` model is complete.
- Mutation must invalidate on all outcomes (success, failure, conflict).
- Asset list in seed/button must use `assetId` format (`chain:369:erc20:0x...`),
  never symbol strings.
- All price/amount values remain `string` (bigint-safe). No `number` coercion.
- Do not add `retry: true` to the mutation — ingestion failures are deterministic
  per the existing route contract.
