# HEX Penalty Distribution Research Record

**Status:** RESOLVED — **Finding A**: HEX end-stake / EES penalty redistribution is already included in `dayPayoutTotal`.
**Applies to:** `dailyDataRange` penalty accounting; §8 yield formula; §11.15 gate in `docs/v2-hexmining-roadmap.md`.
**Date:** 2026-06-10

---

## 1. Question

Are HEX end-stake and emergency-end-stake (EES) penalty distributions already included in the observed `dayPayoutTotal` values returned by `dailyDataRange`, or do they require separate modeling in CoinPulse's yield calculation?

---

## 2. Primary Source

**On-chain verified HEX contract source (`HEX.sol`)**

| Field | Value |
|---|---|
| Contract address | `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39` |
| Chain | Ethereum mainnet (chain ID 1) |
| Source | Blockscout `inspect_contract_code` — on-chain verified, 2952 lines, compiler `v0.5.13` |
| File name | `HEX.sol` (single file, no imports) |

Source B (JamJomJim gist: `https://gist.github.com/JamJomJim/fb3883c15da1a354857ca085e65d145a`) was fetched and is consistent with the on-chain verified source. Source C (kbahr/HexUtilities.sol) was not accessible (HTTP 404) — not needed; the on-chain verified source is authoritative.

---

## 3. Key Finding

**Finding A: Penalty redistribution IS already represented in `dayPayoutTotal`.**

Fifty percent of every penalty (from any `stakeEnd` call — whether early, on-time with late penalty, or third-party unlock via `stakeGoodAccounting`) is accumulated in `globals.stakePenaltyTotal`. The next time `_dailyDataUpdate` runs — triggered by the next on-chain transaction that touches HEX — that accumulated total is folded directly into `dayPayoutTotal` for the day being settled.

There is **no separate accounting channel** for penalty redistribution. Penalties either go to `ORIGIN_ADDR` (50%) or to `dayPayoutTotal` of a subsequent day (50%). Neither channel requires separate modeling in CoinPulse.

---

## 4. Evidence — Verbatim Contract Code

### 4.1 `_splitPenaltyProceeds` (lines ~1797–1811)

```solidity
function _splitPenaltyProceeds(GlobalsCache memory g, uint256 penalty)
    private
{
    /* Split a penalty 50:50 between Origin and stakePenaltyTotal */
    uint256 splitPenalty = penalty / 2;

    if (splitPenalty != 0) {
        _mint(ORIGIN_ADDR, splitPenalty);
    }

    /* Use the other half of the penalty to account for an odd-numbered penalty */
    splitPenalty = penalty - splitPenalty;
    g._stakePenaltyTotal += splitPenalty;
}
```

**Interpretation:** 50% of gross penalty is minted to `ORIGIN_ADDR` — this portion never reaches stakers and is not in `dayPayoutTotal`. The remaining 50% accumulates in `g._stakePenaltyTotal`.

### 4.2 `_dailyRoundCalc` — penalty sweep into payout (lines ~1222–1257, excerpt)

```solidity
if (g._stakePenaltyTotal != 0) {
    rs._payoutTotal += g._stakePenaltyTotal;
    g._stakePenaltyTotal = 0;
}
```

**Interpretation:** Every unfrozen day's round calculation sweeps `g._stakePenaltyTotal` directly into `rs._payoutTotal` and resets the accumulator to zero.

### 4.3 `_dailyRoundCalcAndStore` (lines ~1259–1267)

```solidity
function _dailyRoundCalcAndStore(GlobalsCache memory g, DailyRoundState memory rs, uint256 day)
    private
{
    _dailyRoundCalc(g, rs, day);

    dailyData[day].dayPayoutTotal      = uint72(rs._payoutTotal);
    dailyData[day].dayStakeSharesTotal = uint72(g._stakeSharesTotal);
    dailyData[day].dayUnclaimedSatoshisTotal = uint56(g._unclaimedSatoshisTotal);
}
```

**Interpretation:** The daily payout total (including swept penalty proceeds) is written directly to `dailyData[day].dayPayoutTotal` — the same field returned by `dailyDataRange` and used by the §8 formula.

### 4.4 `stakeEnd` execution order (line ~1410)

The execution order within `stakeEnd` is:

```
1. _dailyDataUpdateAuto(g)       ← freezes all daily data up to currentDay − 1
2. _stakePerformance(...)        ← computes cappedPenalty (early or late)
3. _splitPenaltyProceeds(g, ...)← 50% to ORIGIN_ADDR; 50% to g._stakePenaltyTotal
4. _globalsSync(g, gSnapshot)   ← persists g._stakePenaltyTotal → globals.stakePenaltyTotal
```

**Interpretation:** `_dailyDataUpdateAuto` runs **before** `_splitPenaltyProceeds`. This means the penalty from a stake ending on day D is **not** included in day D's `dayPayoutTotal` — it accumulates in `globals.stakePenaltyTotal` and is swept into the payout of the first day ≥ D+1 that a subsequent `_dailyDataUpdate` call processes.

### 4.5 `_globalsSync` penalty persistence (lines ~1028–1039, excerpt)

```solidity
globals.stakePenaltyTotal = uint72(g._stakePenaltyTotal);
```

**Interpretation:** The accumulated penalty total is persisted to contract storage after each stake operation, so it survives until the next day's round.

---

## 5. "Emergency End Stake" — Clarification

The on-chain verified `HEX.sol` does **not** contain any function named `emergencyEndStake`, `emergencyEnd`, or similar. There is a single public stake-ending entry point: `stakeEnd`. What the HEX community calls "emergency end stake" (EES) is simply calling `stakeEnd` before the stake's committed term completes, which takes the `servedDays < stakedDays` branch in `_stakePerformance` → `_calcPayoutAndEarlyPenalty`. The penalty mechanism is mechanically identical to the overdue-stake (late) penalty path — both flow through `_splitPenaltyProceeds` → `globals.stakePenaltyTotal` → `dayPayoutTotal`.

---

## 6. Functions Traced

| Function | Role | Penalty path |
|---|---|---|
| `stakeEnd` (line ~1410) | Only public stake-ending entry point (normal and early exit) | Calls `_splitPenaltyProceeds` |
| `stakeGoodAccounting` (line ~1349) | Third-party late-unlock; applies overdue penalty | Calls `_splitPenaltyProceeds` |
| `_stakePerformance` (line ~1680) | Computes `cappedPenalty` from early or late penalty branch | Produces penalty value |
| `_calcPayoutAndEarlyPenalty` (line ~1720) | Early-exit penalty formula | Feeds into `_stakePerformance` |
| `_calcLatePenalty` (line ~1777) | Late/overdue penalty formula | Feeds into `_stakePerformance` |
| `_splitPenaltyProceeds` (line ~1797) | 50% → `ORIGIN_ADDR`; 50% → `g._stakePenaltyTotal` | Penalty distribution |
| `_globalsSync` (line ~1028) | Persists `g._stakePenaltyTotal` → `globals.stakePenaltyTotal` | Persistence |
| `_dailyDataUpdateAuto` (line ~982) | Triggers daily data freeze before any stake operation | Ordering constraint |
| `_dailyDataUpdate` (line ~1269) | Iterates over unfrozen days; calls `_dailyRoundCalcAndStore` per day | Daily settlement |
| `_dailyRoundCalc` (line ~1222) | Sweeps `g._stakePenaltyTotal` into `rs._payoutTotal` | Penalty-to-payout |
| `_dailyRoundCalcAndStore` (line ~1259) | Writes `rs._payoutTotal` → `dailyData[day].dayPayoutTotal` | Final write |
| `globals.stakePenaltyTotal` (storage) | Persistent accumulator for penalty proceeds between days | Cross-day carry |
| `dailyData[day].dayPayoutTotal` (storage) | Per-day payout field read by `dailyDataRange` | Observed field |

---

## 7. Scenario Coverage

| Scenario | Finding |
|---|---|
| Normal active stake (full term served) | No penalty. `dayPayoutTotal` contains standard inflation payout only. §8 formula correct. |
| Overdue stake (past `lockedDay + stakedDays`, late penalty) | `_calcLatePenalty` applies; 50% of late penalty flows into a subsequent day's `dayPayoutTotal` via `globals.stakePenaltyTotal`. §8 formula captures this in the day it lands. |
| Ended stake (normal end within staked period, `goodAccounting` unlock) | Same late-penalty path. §8 formula captures via `dayPayoutTotal`. |
| Early-ended stake / "EES" (`stakeEnd` before term) | `_calcPayoutAndEarlyPenalty` applies; same split path. 50% enters a subsequent day's `dayPayoutTotal`. §8 formula captures this. |
| Zero-share / zero-distribution edge case | `dayStakeSharesTotal === 0n` guard in `defaultApplyCalculation` handles the no-stakers case correctly. Confirmed: `_stakeSharesTotal` written to `dayStakeSharesTotal`; if zero, `_dailyRoundCalc` still runs but no meaningful payout is distributed. |

---

## 8. Implication for the §8 Formula

The CoinPulse §8 formula:

```
perDayYield(d) = (stakeShares × dayPayoutTotal[d]) / dayStakeSharesTotal[d]
```

**This formula correctly captures the staker's pro-rata share of every payout that entered `dayPayoutTotal` for a given day.** Since penalty redistribution (the 50% staker portion) flows through `dayPayoutTotal`, it is automatically included in the formula without any modification.

### Two accounting caveats (not bugs — contract-confirmed behavior)

**Caveat 1 — 50% of gross penalty reaches stakers:**
The gross `cappedPenalty` is split 50/50. Only 50% enters `dayPayoutTotal`; the other 50% is minted to `ORIGIN_ADDR`. The formula already accounts for this correctly because it reads the observed `dayPayoutTotal`, which contains only the staker-redistributed portion. There is nothing extra to add.

**Caveat 2 — Penalty enters a subsequent day, not the penalty day:**
Because `_dailyDataUpdateAuto` freezes daily data **before** `_splitPenaltyProceeds` runs, a penalty assessed on day D lands in the `dayPayoutTotal` of some day D+k (k ≥ 1). This means a staker who held their stake through day D+k will receive a share of that penalty redistribution; a staker whose stake ended before day D+k will not. This is correct protocol behavior, not a formula gap — the formula reads whatever `dayPayoutTotal` was recorded for each day, which correctly reflects the protocol's actual distribution.

### No separate accounting channel

There is no second pool, secondary mapping, or alternative distribution path for penalty proceeds. The only two destinations are:
1. `ORIGIN_ADDR` (minted directly — not staker payout)
2. `dailyData[day].dayPayoutTotal` (via `globals.stakePenaltyTotal` → `_dailyRoundCalc`)

**Conclusion:** The §8 formula requires no penalty-specific modification. The gate (§11.15 of `docs/v2-hexmining-roadmap.md`) is satisfied by this evidence.

---

## 9. Gate Status

§11.15 gate from PR #223: **RESOLVED — Finding A confirmed by on-chain contract source.**

The remaining gate-lift prerequisites from §11.14 (elapsed-days coverage rule, BPD attribution, §11.9 provenance completeness, reader/route wiring, contract tests) are unaffected by this finding and remain open.

---

## 10. Open Questions Remaining

This research resolves the penalty distribution question but does not address:

- **T-share scaling:** `dayStakeSharesTotal` unit — whether the values from `dailyDataRange` are raw shares or T-shares (÷ 1e12). This is tracked in `docs/hex-dailydata-packing-spec.md §7`. The §8 test vectors use raw share values consistent with what `dailyDataRange` returns; the formula is internally consistent at whatever unit the contract uses. Resolution required before public output.
- **Big Pay Day (day 353):** Separate `bpdYieldStatus` / `bpdYieldHex` modeling per §11.4 invariant #5. Not affected by this research.
- **Ethereum eHEX:** This research covers Ethereum mainnet chain 1. PulseChain chain 369 uses the same contract address; bytecode equivalence was not independently verified. CoinPulse is PulseChain-only in Phase 4C scope.
