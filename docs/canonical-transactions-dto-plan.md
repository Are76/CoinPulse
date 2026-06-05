# Canonical Transaction DTO Plan

## Purpose

Transaction history, allocation drilldowns, analytics, LP detail pages, stake detail pages,
break-even scenario UI, and portfolio intelligence surfaces all require a canonical backend
transaction DTO. None of these product surfaces may be built before that DTO exists.

This document defines the plan and constraints for implementing `GET /api/transactions` as a
dedicated bounded backend-first work slice.

It is documentation only. It does not add `GET /api/transactions`, change runtime behavior,
modify Prisma schema, change DTO contracts, change pricing/PnL/accounting logic, change
sync/rebuild behavior, add workers, or change frontend rendering.

---

## Current Architecture Constraints

The following constraints apply to all transaction-related implementation work and must not be
relaxed or worked around in any bounded PR:

- **Backend truth first.** PostgreSQL canonical/derived state is the only source of UI truth.
- **RPC/raw logs are ingestion input only.** They must not be exposed as frontend truth, used to
  reconstruct action meaning, or surfaced as transaction records directly.
- **Frontend must not reconstruct transactions.** No action type, direction, value, or event
  interpretation may happen in the browser.
- **Frontend must not infer action meaning from raw logs.** Event signatures, method selectors,
  and input data are ingestion artifacts, not DTO fields.
- **Frontend must not compute pricing, valuation, PnL, LP, stake, or accounting truth.** All
  monetary and accounting values must be materialized by the backend.
- **Asset identity is `assetId` (chain-aware backend ID), not symbol, name, or ticker.** Symbol
  collisions between chains make symbol-as-identity incorrect and forbidden.
- **Unsupported, stale, unpriced, incomplete, unknown, and unavailable states must remain
  explicit.** Do not coerce null/unavailable values to zero or `ok`.
- **Provenance, warnings, materialization freshness, and confidence metadata must be
  preserved** where present in the backend ledger truth.

---

## Proposed Route

```
GET /api/transactions
```

- Versioned DTO response (`schemaVersion` field in envelope).
- Wallet-scoped. Address and chain must be provided.
- Additive only. Do not rename or remove existing routes when implementing.
- Route is read-only. No mutation, no ingestion trigger, no side effects.
- Operator-only or authenticated-only classification must be decided before deployment — do not
  ship as a public unauthenticated read endpoint without an explicit security decision.

---

## Proposed Query Parameters

First version should be conservative. Include only parameters that can be safely evaluated
server-side without performance cliffs or ambiguous semantics.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `walletAddress` | string | Yes | Normalized EVM address. Prefer address over internal walletId at the API boundary. |
| `chainId` | integer | Yes | Chain-scoped read. No cross-chain aggregation in V1. |
| `cursor` | string | No | Opaque pagination cursor. Preferred over offset pagination. |
| `limit` | integer | No | Number of results per page. Server enforces a maximum (e.g. 100). |
| `assetId` | string | No | Filter by backend-assigned asset ID. Do not accept symbol/ticker as filter. |
| `actionType` | string | No | Filter by canonical action type (e.g. `SWAP`, `TRANSFER`, `ADD_LIQUIDITY`). |
| `sourceFamily` | string | No | Filter by source family (e.g. `ONCHAIN_POOL`, `NATIVE`). |
| `protocol` | string | No | Filter by protocol identifier. Nullable in transaction records. |
| `fromDate` / `toDate` | ISO 8601 | No | Date range filter on `occurredAt`. Only safe if indexed and bounded by `limit`. |
| `fromBlock` / `toBlock` | integer | No | Block range alternative to date range. Only include if date range is omitted. |
| `quoteAsset` | string | No | Only include if pricing/valuation/PnL metadata is included in the response. Format: `fiat:usd` or chain-aware asset ID. |

Do not add `fromBlock`/`toBlock` and `fromDate`/`toDate` simultaneously in V1 — pick one range
mechanism and document it.

---

## Proposed Response Shape

```typescript
// Envelope
{
  schemaVersion: string;                   // e.g. "v1"
  walletAddress: string;                   // normalized lowercase
  chainId: number;
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
    limit: number;
    totalCount?: number;                   // omit if expensive to compute
  };
  transactions: TransactionDto[];
}

// Transaction
{
  transactionId: string;                   // deterministic backend ID (not txHash alone)
  txHash: string;
  chainId: number;
  walletId: string;                        // internal wallet record ID
  walletAddress: string;
  occurredAt: string;                      // ISO 8601 UTC
  blockNumber: number;
  actionGroupId: string;                   // groups related entries within a transaction
  actionType: string;                      // canonical action type from backend ledger
  sourceFamily: string;
  protocol: string | null;
  status: "complete" | "incomplete" | "unsupported" | "unknown";
  warnings: string[];
  provenance: {
    ledgerFresh: boolean;
    materializationAsOf: string | null;    // ISO 8601 UTC
  };
  entries: TransactionEntryDto[];
}

// Entry
{
  entryId: string;
  assetId: string;                         // chain-aware backend asset identity — not symbol
  assetAddress: string | null;             // on-chain contract address, nullable for native
  entryType: string;                       // e.g. "ASSET_IN", "ASSET_OUT", "FEE"
  direction: "IN" | "OUT" | "NEUTRAL";
  quantity: string;                        // string to preserve precision — do not parse to float
  decimals: number | null;

  // Pricing fields — only present if backend materialized pricing truth supports them
  pricingStatus: "priced" | "unpriced" | "stale" | "rejected" | "unsupported" | null;
  pricingProvenance: string | null;

  // Valuation fields — only present if backend materialized valuation truth supports them
  valuationStatus: "valued" | "unvalued" | "stale" | "rejected" | "unsupported" | null;
  valueQuote: string | null;               // string, quote asset units — null if not valued
  quoteAsset: string | null;

  // PnL impact — only present if backend materialized PnL truth supports it
  pnlImpact: {
    status: "computed" | "uncomputed" | "incomplete" | null;
    realizedGain: string | null;
    unrealizedGain: string | null;
  } | null;

  warnings: string[];
  rejectedReason: string | null;
}
```

All monetary/quantity values are `string` to preserve decimal precision. The frontend must
render them as-is from the DTO and must not parse them to JavaScript `number` for computation.

---

## Pagination and Ordering

- **Default ordering:** `occurredAt DESC`, `blockNumber DESC`, then `txHash`/`actionGroupId`/
  `transactionId` as tie-breakers for stability.
- Ordering must be deterministic so that cursor-based pagination is stable across pages.
- **Cursor-based pagination preferred** over offset pagination. Offset pagination becomes
  incorrect when new rows are inserted between pages.
- Server must enforce a maximum `limit` (suggested: 100). Clients may not request unbounded
  result sets.
- `pageInfo.hasNextPage` must be accurate. Do not return `true` if no next page exists.
- `pageInfo.totalCount` is optional. Only include if it can be computed without a full table
  scan.

---

## Provenance and Uncertainty

The following states must be explicitly modeled in the DTO and must not be coerced:

| State | Must not be coerced to |
|---|---|
| Unpriced asset | `0` value or `ok` pricing status |
| Stale price | Current price or `ok` status |
| Incomplete ledger coverage | Complete record or suppressed warning |
| Unsupported action type | `unknown` silently or suppressed |
| Rejected observation | Removed or zeroed |
| Unavailable materialization | Empty or `ok` freshness |

Every transaction and entry that carries uncertainty must include a `warnings` array and/or an
explicit status field. The frontend must render these without inferring away the uncertainty.

Include `provenance.ledgerFresh` and `provenance.materializationAsOf` in every transaction
record so the operator can understand data freshness at a glance.

---

## Security and Operator Considerations

- **Wallet-scoped reads only.** The route must reject requests that do not specify a wallet.
  Cross-wallet or all-wallets reads are not in scope for V1.
- **No internal exception leakage.** Errors must use the existing stable error envelope
  (`{ code, message, details? }`). Stack traces, Prisma errors, and raw DB messages must not
  appear in responses.
- **Stable error envelope.** Use the existing `INVALID_INPUT`, `INTERNAL_ERROR`, and domain
  error codes already present in the codebase.
- **Input validation before any DB access.** Validate `walletAddress`, `chainId`, `limit`, and
  cursor format before querying.
- **Operator-only classification.** Decide whether this route is public read or operator-only
  before deployment. Document the decision explicitly. Do not ship as public without a security
  review.
- **No write side-effects.** The route is GET only. It must not trigger sync, rebuild, or
  ingestion operations as a side effect of serving a page.

---

## Required Implementation Sequence

The following PR sequence must be followed. No step may be skipped.

1. **Service/DTO types only + tests**
   - Define TypeScript DTO types and Zod schemas.
   - Add unit tests for schema validation, error cases, and DTO shape.
   - No route. No DB queries. No frontend.

2. **Route contract tests**
   - Add `tests/api/transactions-route-contract.test.ts`.
   - Cover success envelope, empty result, validation errors, internal error envelope.
   - Tests must pass before route implementation begins.

3. **Route implementation from persisted ledger/action-group truth**
   - Implement `GET /api/transactions` route.
   - Use persisted canonical ledger and action-group records only. No raw-log reconstruction.
   - Pass all route contract tests.
   - No frontend changes in this PR.

4. **API client + query hook**
   - Add `src/lib/api/transactions-client.ts` and `src/lib/query/use-transactions-query.ts`.
   - Follow existing pattern: shared query key in `query-keys.ts`, `QUERY_DEFAULTS` timing,
     no dashboard invalidation, `ApiClientError` error handling.
   - Add wiring tests.

5. **Frontend transaction module**
   - Add screen component and page.
   - Use the query hook only. No ad hoc fetch. No useEffect polling.
   - Render backend DTO fields pass-through.
   - No frontend pricing/valuation/PnL computation.
   - Add wiring tests.

6. **Only then: transaction history UI / break-even / analytics**
   - Transaction history UI, allocation, break-even scenarios, LP detail, and analytics pages
     may only begin after steps 1–5 are complete and merged.

---

## Required Tests for Future Implementation

The following test coverage is mandatory. Each PR in the implementation sequence must add or
extend these tests as relevant.

**Route contract:**
- Success envelope with correct `schemaVersion`, `walletAddress`, `chainId`, `pageInfo`,
  `transactions`.
- Empty result (`transactions: []`, `pageInfo.hasNextPage: false`).
- Wallet/chain filtering — wrong wallet or wrong chain returns empty, not 500.
- Pagination limit enforced — requesting above server max returns max, not unbounded result.
- Stable ordering — second page cursor returns records after first page with no duplicates.
- Unsupported/unpriced/stale/incomplete states present in response without coercion to zero
  or `ok`.
- Safe internal-error envelope — DB failure returns `{ code: "INTERNAL_ERROR", message }`
  without stack trace.
- No internal exception leakage — Prisma/DB error text must not appear in response body.

**DTO/wiring:**
- No raw log exposure as UI truth — response must not contain `rawLog`, `inputData`, or
  `topics` fields.
- No symbol-as-identity — `assetId` is the identity field; `symbol`/`name`/`ticker` may appear
  as display metadata only and must not be used as a filter or grouping key.
- No frontend reconstruction — screen source must not contain inline action type parsing,
  log decoding, or price calculation.
- No dashboard invalidation — query hook must not invalidate dashboard query keys on success or
  error.

---

## Explicit Non-Goals for This Document

- Does not implement `GET /api/transactions`.
- Does not add frontend transaction UI.
- Does not add analytics, allocation, break-even, LP detail, or stake detail pages.
- Does not change any existing backend route.
- Does not change any existing DTO.
- Does not change Prisma schema or migrations.
- Does not change pricing, PnL, accounting, sync, rebuild, ingestion, ledger, or accounting
  behavior.
- Does not add Ethereum/Base execution.
- Does not create a reusable template repo.

---

## Final Rule

**No transaction-facing UI may be built from raw logs, frontend reconstruction, or symbol
identity.** The canonical backend transaction DTO defined in this document must exist and be
covered by route-contract tests before any transaction history, allocation, analytics, LP
detail, stake detail, break-even scenario, or portfolio intelligence UI begins.

This rule supersedes any product schedule pressure. There are no exceptions.
