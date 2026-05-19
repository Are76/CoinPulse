# Break-Even Scenarios Plan (Trade Outcome Analyzer)

## 1) Scope

Break-Even Scenarios is a future, transaction-level feature for completed swaps/trades inside the broader Trade Outcome Analyzer module. It is intended to provide deterministic scenario math for:

- recovering original PLS-denominated value
- recovering original USD-denominated value
- comparing current received-token value versus holding the original paid token
- calculating how much of the received token could remain after recovering the original paid-asset value

This plan is V1-adjacent documentation only.

- Backend computes everything.
- Frontend renders DTOs only.
- No runtime code is added in this PR.

## 2) User questions it answers

For each completed swap/trade, the future backend DTOs should support answering:

- What did I pay?
- What did I receive?
- What was the value of both sides at execution time?
- What is the current value of the received asset?
- What would the paid asset be worth now if I had held it?
- Did the swap outperform or underperform holding the original token?
- How much value did I gain or lose in PLS?
- How much value did I gain or lose in USD?
- What received-token price is required to break even?
- How much of the received token must be sold to recover the original PLS value?
- How much of the received token can remain after recovering original value?
- What scenarios allow keeping 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%, or 100% of the received asset where mathematically possible?

## 3) Scenario language

Required language for product copy, DTO descriptions, and operator-facing explanations:

- “At current backend-observed prices...”
- “This swap is outperforming/underperforming the hold-original-asset scenario...”
- “This scenario would recover the original PRVX-denominated value...”
- “This is a deterministic scenario, not a prediction.”

Forbidden language:

- good trade
- bad trade
- you should sell
- buy now
- guaranteed free coins
- risk-free profit
- expected recovery date
- investment advice

## 4) Core formulas

All formulas below are deterministic and depend on backend-observed inputs only.

Let:

- `paidQty` = amount of paid asset at execution
- `receivedQty` = amount of received asset at execution
- `paidPxExecPLS`, `receivedPxExecPLS` = execution-time price observations in PLS
- `paidPxExecUSD`, `receivedPxExecUSD` = execution-time price observations in USD
- `paidPxNowPLS`, `paidPxNowUSD` = current paid-asset price observations
- `receivedPxNowPLS`, `receivedPxNowUSD` = current received-asset price observations
- `targetRetainedPct` = retained percentage target in decimal form (for example, 0.20 for 20%)

Execution values:

- `executionPaidValuePLS = paidQty * paidPxExecPLS`
- `executionPaidValueUSD = paidQty * paidPxExecUSD`
- `executionReceivedValuePLS = receivedQty * receivedPxExecPLS`
- `executionReceivedValueUSD = receivedQty * receivedPxExecUSD`
- `executionDeltaPLS = executionReceivedValuePLS - executionPaidValuePLS`
- `executionDeltaUSD = executionReceivedValueUSD - executionPaidValueUSD`

Current and hold-alternative values:

- `currentReceivedValuePLS = receivedQty * receivedPxNowPLS`
- `currentReceivedValueUSD = receivedQty * receivedPxNowUSD`
- `originalPaidIfHeldValuePLS = paidQty * paidPxNowPLS`
- `originalPaidIfHeldValueUSD = paidQty * paidPxNowUSD`

Opportunity deltas (swap outcome versus hold-original-asset outcome):

- `opportunityDeltaPLS = currentReceivedValuePLS - originalPaidIfHeldValuePLS`
- `opportunityDeltaUSD = currentReceivedValueUSD - originalPaidIfHeldValueUSD`

Required break-even received-token prices:

- `requiredBreakEvenReceivedPxPLS = originalPaidIfHeldValuePLS / receivedQty`
- `requiredBreakEvenReceivedPxUSD = originalPaidIfHeldValueUSD / receivedQty`

Tokens to sell to recover original value (at current observed prices):

- `tokensToSellForRecoveryPLS = originalPaidIfHeldValuePLS / receivedPxNowPLS`
- `tokensToSellForRecoveryUSD = originalPaidIfHeldValueUSD / receivedPxNowUSD`

Tokens remaining and retained percentage:

- `tokensRemainingAfterRecoveryPLS = receivedQty - tokensToSellForRecoveryPLS`
- `tokensRemainingAfterRecoveryUSD = receivedQty - tokensToSellForRecoveryUSD`
- `retainedReceivedPctPLS = tokensRemainingAfterRecoveryPLS / receivedQty`
- `retainedReceivedPctUSD = tokensRemainingAfterRecoveryUSD / receivedQty`

Scenario inversion for target retained percentage:

- `targetRemainingTokens = receivedQty * targetRetainedPct`
- `requiredSaleTokens = receivedQty - targetRemainingTokens`
- `requiredReceivedPxForTargetPLS = originalPaidIfHeldValuePLS / requiredSaleTokens`
- `requiredReceivedPxForTargetUSD = originalPaidIfHeldValueUSD / requiredSaleTokens`

Every computed value must include backend price observation status, confidence, timestamp, and provenance.

## 5) Mathematical impossibility rules

Break-Even Scenarios must explicitly capture mathematical feasibility.

- Keeping 100% of the received asset while recovering the original paid-asset value is not possible from the same received-token position alone.
- It is only possible if there is external capital, yield, rewards, or another income source.
- DTO/UI must mark impossible scenarios explicitly as `not_possible`.

## 6) Status and uncertainty model

Define canonical statuses for overall result and per-scenario items:

- `available`
- `partial`
- `unavailable`
- `insufficient_price_history`
- `low_confidence_price`
- `stale_price`
- `unsupported_trade`
- `not_possible`

Require warnings for:

- missing execution-time price
- missing current price
- stale price
- low-confidence price
- unsupported asset
- unsupported trade route
- stablecoin-like symbol without proven peg
- metadata conflict
- incomplete provenance

## 7) Backend ownership

Ownership boundaries for this feature:

- Backend computes all scenario values.
- Frontend renders DTO only.
- No frontend pricing/PnL/trade-outcome computation.
- No direct RPC-driven UI truth.
- No mock production data.
- All values require provenance, timestamp, status, and confidence.

## 8) Draft illustrative DTO

The following TypeScript is a markdown-only, non-binding DTO sketch for planning and discussion.

- The DTO is illustrative only.
- The DTO must remain inside this markdown document.
- This PR does not add TypeScript source files.

```ts
export type BreakEvenScenarioStatus =
  | 'available'
  | 'partial'
  | 'unavailable'
  | 'insufficient_price_history'
  | 'low_confidence_price'
  | 'stale_price'
  | 'unsupported_trade'
  | 'not_possible';

export interface BreakEvenWarning {
  code:
    | 'missing_execution_price'
    | 'missing_current_price'
    | 'stale_price'
    | 'low_confidence_price'
    | 'unsupported_asset'
    | 'unsupported_trade_route'
    | 'stablecoin_like_without_verified_peg'
    | 'metadata_conflict'
    | 'incomplete_provenance';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface PriceObservationMeta {
  source: string;
  observedAt: string; // ISO8601
  status: BreakEvenScenarioStatus;
  confidence: number; // 0..1
  provenanceId?: string;
}

export interface MoneyValue {
  value: string; // decimal string
  currency: 'PLS' | 'USD';
  observation: PriceObservationMeta;
}

export interface RecoveryScenarioItem {
  retainPct: number; // 0.10 .. 1.00
  status: BreakEvenScenarioStatus;
  requiredReceivedPricePLS?: MoneyValue;
  requiredReceivedPriceUSD?: MoneyValue;
  tokensToSell?: string;
  tokensRemaining?: string;
  retainedPctActual?: number;
  notes?: string[];
}

export interface BreakEvenScenarioDto {
  tradeId: string;
  status: BreakEvenScenarioStatus;
  generatedAt: string; // ISO8601

  paidAsset: {
    assetId: string;
    symbol: string;
    quantity: string;
  };
  receivedAsset: {
    assetId: string;
    symbol: string;
    quantity: string;
  };

  execution: {
    paidValuePLS: MoneyValue;
    paidValueUSD: MoneyValue;
    receivedValuePLS: MoneyValue;
    receivedValueUSD: MoneyValue;
    deltaPLS: MoneyValue;
    deltaUSD: MoneyValue;
  };

  current: {
    receivedValuePLS: MoneyValue;
    receivedValueUSD: MoneyValue;
    paidIfHeldValuePLS: MoneyValue;
    paidIfHeldValueUSD: MoneyValue;
  };

  opportunityDelta: {
    pls: MoneyValue;
    usd: MoneyValue;
    outcomeVsHold: 'outperformed' | 'underperformed' | 'flat';
  };

  breakEvenPrice: {
    requiredReceivedPricePLS: MoneyValue;
    requiredReceivedPriceUSD: MoneyValue;
  };

  recoveryScenarios: RecoveryScenarioItem[]; // includes 10%..100%

  warnings: BreakEvenWarning[];

  provenance: {
    modelVersion: string;
    inputSnapshotId: string;
    computedFromLedgerVersion: string;
    pricingSnapshotIds: string[];
  };
}
```

## 9) Relationship to Trade Outcome Analyzer and Portfolio Intelligence

Positioning and boundaries:

- Break-Even Scenarios is transaction-level.
- Trade Outcome Analyzer is the broader transaction analytics module.
- Portfolio Intelligence Layer is portfolio-level.
- Break-even outputs may later feed portfolio observations only after deterministic DTOs exist.
- AI summaries, if ever added, may summarize backend facts only and must not perform calculations or provide investment advice.

See also: `docs/portfolio-intelligence-layer-plan.md`.

## 10) Phased rollout

- Phase 1 — documentation-only plan
- Phase 2 — contract-first DTO tests
- Phase 3 — backend deterministic calculation service
- Phase 4 — route contract for trade outcome / break-even DTO
- Phase 5 — frontend rendering of backend DTO
- Phase 6 — optional AI summary over backend facts only

## 11) Acceptance criteria

This PR is docs-only planning.

No changes in this PR to:

- source code
- tests
- schema
- API routes
- frontend UI
- package files
- fixtures
- mock data
- pricing logic
- PnL logic
- Portfolio Intelligence implementation
- AI/provider integrations
- template folders
- external repos
- extraction code
