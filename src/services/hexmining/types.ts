// HexMining V2 DTO contract skeleton — Phase 1
//
// HexMining is CoinPulse's module for HEX staking intelligence / stake monitoring.
// This is NOT proof-of-work mining and NOT new tokenomics.
// Domain: HEX staking — time-locked principal, stake shares, yield accumulation.
//
// Phase 1 scope: types only. No live RPC reads, no schema migration, no frontend.
// Valuation, PnL, and yield remain status: "unsupported" until Phase 7 prerequisites are met.
//
// See docs/v2-hexmining-roadmap.md for full phase plan, data model decisions, and risk register.

// ─── Chain-aware asset identity ──────────────────────────────────────────────
//
// pHEX and eHEX share the same token address but live on different chains.
// Never use symbol alone ("HEX", "pHEX", "eHEX") as accounting identity.

export const PHEX_ASSET_ID =
  "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39" as const;

// eHEX on Ethereum — deferred to Phase 7+. Defined here to make the distinction explicit.
export const EHEX_ASSET_ID =
  "chain:1:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39" as const;

// ─── Stake status vocabulary ──────────────────────────────────────────────────
//
// Derived from protocol day arithmetic (backend only — never computed in the frontend).
//   pending:  lockedDay > currentDay()
//   active:   lockedDay <= currentDay() < lockedDay + stakedDays
//   overdue:  currentDay() >= lockedDay + stakedDays and stake not yet closed
//   ended:    stake no longer present in stakeLists (closed via endStake)
//   unknown:  status cannot be determined from available data

export type HexStakeStatus = "pending" | "active" | "overdue" | "ended" | "unknown";

// ─── Stake source families ────────────────────────────────────────────────────
//
// Phase 1 / Phase 2: native only.
// Phase 6: "hsi" (Hedron Stake Instance) and "htt" (Hedron Token Transfer / Actuator).
// HSI/HTT add ownership indirection — explicitly deferred.

export type HexStakeSource = "native";

// ─── Deferred source families (not usable in Phase 1) ────────────────────────
// Declared as a separate type so future phases can extend HexStakeSource.
// Included here to document what is deliberately excluded from Phase 1.

export type HexStakeSourceDeferred = "hsi" | "htt";

// ─── Big Pay Day yield status ─────────────────────────────────────────────────
//
// Deferred to Phase 4. Defined here so the field shape is stable.
//   applicable:     stake spanned HEX day 353
//   not_applicable: stake did not span HEX day 353
//   unknown:        BPD applicability has not been determined

export type HexBpdYieldStatus = "applicable" | "not_applicable" | "unknown";

// ─── Yield status ─────────────────────────────────────────────────────────────
//
//   unsupported: yield reads not yet implemented (Phases 1–3)
//   unavailable: reads implemented but data cannot be produced for this stake
//                (rate limit hit, day-range gap, stale data, null provenance)
//   estimated:   dailyDataRange estimation available (Phase 4+)
//   exact:       yield confirmed on-chain at endStake (Phase 5+)

export type HexYieldStatus = "unsupported" | "unavailable" | "estimated" | "exact";

// ─── Pricing / valuation / PnL status ────────────────────────────────────────
//
// Reuses the same "unsupported" sentinel as DashboardValuationDto / DashboardPnlDto.
// Status must remain "unsupported" until Phase 7 prerequisites are met:
//   - persisted PriceObservation records for pHEX available at ledger-aligned timestamps
//   - explicit cost-basis policy decision documented
//   - DTO contracts for valued stakes defined and contract-tested

export type HexMiningUnsupportedStatus = "unsupported";

// ─── Provenance ───────────────────────────────────────────────────────────────

export type HexStakeProvenanceDto = {
  chainId: number;
  walletAddress: string;
  stakeId: string;          // uint40 as string — avoids bigint JSON serialization issues
  stakeIndex: number;
  stakeSource: HexStakeSource;
  observedAtBlock: string;  // bigint as string
  observedAt: string;       // ISO 8601 timestamp
  rpcEndpoint: string | null;
  warnings: string[];
};

// ─── Pricing DTO (Phase 1: always unsupported) ────────────────────────────────

export type HexStakePricingDto = {
  status: HexMiningUnsupportedStatus;
  sourceType: null;
  sourceId: null;
  observedAt: null;
};

// ─── Valuation DTO (Phase 1: always unsupported) ──────────────────────────────

export type HexStakeValuationDto = {
  status: HexMiningUnsupportedStatus;
  valueQuote: null;
};

// ─── PnL DTO (Phase 1: always unsupported) ────────────────────────────────────
//
// costBasisPolicy will be populated in Phase 7 once fork-copy policy is decided.
// See docs/v2-hexmining-roadmap.md §8 Decision 10.

export type HexStakePnlDto = {
  status: HexMiningUnsupportedStatus;
  averageCost: null;
  realizedPnl: null;
  unrealizedPnl: null;
  markPrice: null;
  costBasisPolicy: null;
};

// ─── Yield DTO (Phase 1: always unsupported) ──────────────────────────────────
//
// estimatedYieldHex: dailyDataRange-derived estimate (Phase 4+)
// bpdYieldHex: Big Pay Day attribution (Phase 4+)
// bpdYieldStatus: whether this stake spanned HEX day 353

export type HexStakeYieldDto = {
  status: HexMiningUnsupportedStatus;
  estimatedYieldHex: null;
  bpdYieldHex: null;
  bpdYieldStatus: null;
};

// ─── Core stake DTO ───────────────────────────────────────────────────────────

export type HexStakeDto = {
  schemaVersion: "v1";
  stakeId: string;            // uint40 as string
  stakeIndex: number;
  stakeSource: HexStakeSource;
  chainId: number;
  assetId: string;            // chain:369:erc20:0x... — never symbol-only
  walletAddress: string;
  stakeStatus: HexStakeStatus;
  lockedDay: number | null;
  stakedDays: number | null;
  unlockedDay: number | null;
  principalHex: string | null;  // scaled decimal string
  stakeShares: string | null;   // raw uint72 as string
  tShares: string | null;       // stakeShares / 1e12 as string (unit conversion to be verified)
  isAutoStake: boolean | null;
  pricing: HexStakePricingDto;
  valuation: HexStakeValuationDto;
  pnl: HexStakePnlDto;
  yield: HexStakeYieldDto;
  provenance: HexStakeProvenanceDto;
  warnings: string[];
};

// ─── Stake list response DTO ──────────────────────────────────────────────────
//
// isComplete: false when the read was truncated due to rate limits or errors.
// Backend must surface truncation explicitly — never silently drop stakes.

export type HexStakeListDto = {
  schemaVersion: "v1";
  chainId: number;
  walletAddress: string;
  stakeSource: HexStakeSource;
  stakes: HexStakeDto[];
  totalCount: number;
  isComplete: boolean;
  observedAtBlock: string | null;
  observedAt: string | null;
  warnings: string[];
};
