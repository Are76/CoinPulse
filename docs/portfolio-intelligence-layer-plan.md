# Portfolio Intelligence Layer Plan

## Positioning

The Portfolio Intelligence Layer is a V1-adjacent roadmap module. It is not an immediate implementation task. It should be implemented only after deterministic portfolio state, pricing status, metadata provenance, PnL coverage, and DTO contracts are stable enough to support explainable intelligence.

This document is planning-only. It does not authorize runtime features, database schema changes, API routes, frontend components, scoring engines, AI provider calls, LLM integrations, mock data, test fixtures, package changes, or production logic.

## Purpose

The Portfolio Intelligence Layer should turn deterministic portfolio, ledger, pricing, liquidity, and position data into explainable portfolio-level insights.

The goal is not:

- price prediction
- investment advice
- buy/sell/hold recommendations
- analyst ratings
- hallucinated AI commentary
- frontend inference

The goal is:

- structured risk interpretation
- portfolio exposure analysis
- confidence-aware observations
- scenario framing
- user-facing explanations based only on backend facts

Core architecture rule: deterministic backend intelligence comes before AI summaries.

All calculations and interpretation must originate in backend services and be exposed through explicit DTOs. The frontend must only render backend-provided DTOs.

## Scope

### A. Portfolio Health Score

A future portfolio health score may include:

- diversification
- chain concentration
- token concentration
- stablecoin exposure
- liquidity risk
- stale price exposure
- low-confidence price exposure
- unsupported position exposure
- incomplete basis exposure
- LP exposure
- stake exposure
- valuation coverage
- confidence level

Rules:

- Score must be backend-generated.
- Score must be unavailable or partial when input coverage is insufficient.
- Score must never hide warnings or unavailable states.
- Score must not imply investment advice.
- Score must not be computed in the frontend.
- Score must not be fabricated when inputs are missing.

### B. Analyst-Style Observations

Analyst-style observations are backend-generated structured observations, not human analyst recommendations.

Examples:

- “High portfolio concentration”
- “Price coverage is incomplete”
- “Several assets have stale prices”
- “LP exposure is significant”
- “Portfolio valuation confidence is partial”
- “Some positions have incomplete cost basis”
- “Unsupported position types are excluded from PnL”
- “Metadata confidence is low or conflicting for some assets”

Rules:

- No buy/sell/hold recommendations.
- No price targets.
- No unsupported predictions.
- No fabricated analyst sentiment.
- Every observation must have a code, severity, source/provenance, and confidence/input basis.
- Observations must explain backend facts, not create new facts.

### C. Scenario Framework

The scenario framework should use scenario language, not price prediction.

Planned scenario types:

- base scenario
- upside scenario
- downside/stress scenario
- liquidity stress scenario

Rules:

- Scenarios must be generated from available backend facts only.
- Scenarios must use status fields such as `available`, `partial`, `unavailable`, or `insufficient_data`.
- If data is insufficient, the scenario must say so.
- Scenarios must not promise future outcomes.
- Scenarios must not estimate unsupported prices.
- Scenarios must not be investment recommendations.

### D. Analyst Timeline

A future timeline may track historical portfolio intelligence snapshots over time:

- health score
- confidence state
- major warnings
- input coverage
- changed risks
- detected concentration shifts
- stale/low-confidence pricing trends

Rules:

- Historical snapshots must be deterministic/rebuildable where possible.
- Timeline entries must not rewrite historical facts based on later AI interpretations.
- Snapshot provenance must be preserved.
- Timeline data must be backend-owned.

### E. Portfolio Copilot UX

Future dashboard cards may render:

- portfolio health
- key risks
- confidence state
- top exposures
- stale pricing warnings
- LP/stake risk notes
- incomplete basis notes
- unsupported position notes
- scenario summaries

Rules:

- Frontend renders DTOs only.
- No frontend scoring.
- No frontend inference.
- No frontend price/PnL/risk calculations.
- No mock production data.
- No LLM-only dashboard truth.

## Proposed DTO Shape

The following TypeScript shape is illustrative only and not final. It is a non-binding draft that must remain inside this markdown document only. Do not create TypeScript source files, exported DTO types, service stubs, test fixtures, route handlers, UI components, provider interfaces, scoring functions, AI abstraction files, package changes, schema changes, or mock production data from this example.

```ts
type PortfolioIntelligenceStatus =
  | "available"
  | "partial"
  | "unavailable"
  | "insufficient_data";

type PortfolioIntelligenceConfidence =
  | "high"
  | "medium"
  | "low"
  | "unknown";

type PortfolioIntelligenceSeverity =
  | "info"
  | "warning"
  | "critical";

type PortfolioScenarioType =
  | "base"
  | "upside"
  | "downside"
  | "liquidity_stress";

type PortfolioIntelligenceDto = {
  status: PortfolioIntelligenceStatus;
  confidence: PortfolioIntelligenceConfidence;
  generatedAt: string;
  provenance: string[];
  inputCoverage: {
    positionsTotal: number;
    positionsCovered: number;
    pricedValueCoveragePct: number | null;
    stalePriceCount: number;
    lowConfidencePriceCount: number;
    unsupportedPositionCount: number;
    incompleteBasisCount: number;
  };
  healthScore: {
    status: PortfolioIntelligenceStatus;
    value: number | null;
    confidence: PortfolioIntelligenceConfidence;
    reasons: string[];
  };
  observations: Array<{
    code: string;
    severity: PortfolioIntelligenceSeverity;
    message: string;
    confidence: PortfolioIntelligenceConfidence;
    evidence: string[];
    provenance: string[];
  }>;
  scenarios: Array<{
    type: PortfolioScenarioType;
    status: PortfolioIntelligenceStatus;
    summary: string | null;
    confidence: PortfolioIntelligenceConfidence;
    evidence: string[];
    unavailableReason: string | null;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    severity: PortfolioIntelligenceSeverity;
  }>;
};
```

Clarifications:

- This DTO is illustrative only.
- Final DTOs should be introduced contract-first in a later implementation PR.
- Any later DTO must preserve status, confidence, provenance, `generatedAt`, input coverage, warnings, and unavailable reasons.
- Any later DTO must be backend-owned and frontend-rendered only.

## Backend Ownership

- Intelligence calculations belong in backend services.
- Frontend must receive explicit DTOs.
- Intelligence must be derived from canonical ledger, derived portfolio state, persisted price observations, PnL status, metadata provenance, and other trusted backend facts.
- No frontend inference is allowed.
- No direct RPC-driven UI intelligence is allowed.
- The system must be safe to run without an LLM provider.
- Backend intelligence must preserve status, confidence, provenance, warnings, and unavailable reasons.

## Deterministic First, AI Later

- Phase 1 must be deterministic rule-based intelligence.
- LLM/AI summaries may only be added after deterministic observations exist.
- AI must summarize backend facts only.
- AI must not create new facts, scores, predictions, recommendations, or investment advice.
- If AI is unavailable, core intelligence DTOs must still work.
- AI output must never be required for portfolio correctness.
- AI output must be optional, explainable, and subordinate to deterministic DTOs.

## Forbidden for V1 Implementation

The following remain forbidden until prerequisites are met:

- buy/sell/hold recommendations
- price targets
- predicted token prices
- hallucinated analyst ratings
- LLM-generated calculations
- frontend risk scoring
- frontend PnL/pricing/risk inference
- sentiment-driven recommendations without provenance
- production mock data
- hiding unavailable/stale/low-confidence states
- treating token symbol/name as identity
- inferring stablecoin peg/trust from name, symbol, icon, branding, or UI label
- origin/bridge/source attribution without policy-backed evidence
- direct frontend RPC intelligence
- AI-only portfolio truth
- confidence scores invented without deterministic input basis

## Prerequisites Before Implementation

Implementation must wait for these prerequisites:

- stable canonical ledger and derived portfolio state
- stable price observation and resolver behavior
- explicit pricing confidence/status handling
- PnL coverage/status contracts
- token metadata trust/source policy
- token identity/origin guardrails
- DTO contracts for portfolio intelligence
- tests proving no frontend inference
- tests proving unavailable/partial/low-confidence states are preserved
- clear provenance model for every observation
- deterministic backend input coverage model
- explicit unsupported/incomplete/stale handling
- no dependency on LLM provider for core intelligence

## Recommended Phased Rollout

### Phase 1 — Documentation and roadmap placement

- Add this planning document.
- Cross-reference from existing V1 planning/checklist docs if appropriate.
- No runtime implementation.

### Phase 2 — Contract-first DTO design

- Add type-only or test-only DTO contract planning if appropriate in a later PR.
- Define status, confidence, provenance, input coverage, observations, scenarios, and warnings.
- No UI cards yet.
- No LLM calls.

### Phase 3 — Backend deterministic scoring engine

- Implement rule-based concentration, coverage, stale price, unsupported exposure, incomplete basis, LP/stake exposure, and confidence calculations.
- Add service-level tests.
- No AI summaries yet.

### Phase 4 — Historical intelligence snapshots

- Persist or derive historical intelligence snapshots only after deterministic rules are stable.
- Track score/status/confidence/warnings over time.
- Add rebuild/determinism considerations.

### Phase 5 — Explainable dashboard UI cards

- Render backend DTOs.
- Display status, confidence, warnings, and unavailable states explicitly.
- No frontend inference.

### Phase 6 — Optional AI summary layer

- Add AI summaries only as optional explanations over backend facts.
- Must be disabled safely when no provider is configured.
- Must never be required for core portfolio correctness.
- Must never produce investment advice.

## Acceptance Criteria

- A new planning document exists for Portfolio Intelligence Layer.
- The document clearly places the feature as V1-adjacent/future implementation, not immediate runtime work.
- The document clearly separates deterministic intelligence from optional AI summaries.
- The document forbids buy/sell/hold recommendations and price targets.
- The document forbids hallucinated or unsupported analytics.
- The document requires backend ownership and DTO-driven frontend rendering.
- The document requires status, confidence, provenance, `generatedAt`, input coverage, warnings, and unavailable reasons.
- The document includes a phased rollout.
- The illustrative DTO remains inside the markdown document only.
- No production code, schema, API route, UI component, tests, fixtures, package files, or runtime behavior is changed unless a tiny cross-reference in docs requires no code.
- The PR remains narrow and documentation-only.
