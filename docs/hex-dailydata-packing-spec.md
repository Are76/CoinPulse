# HEX dailyData uint256 Packing Specification

**Status:** Verified — authoritative on-chain ABI obtained; two independent corroborating sources.
**Applies to:** `dailyDataRange(uint256 beginDay, uint256 endDay)` on the HEX contract at `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39` (Ethereum mainnet chain 1 verified; PulseChain chain 369 uses the same contract address — bytecode equivalence was not independently verified because PulseChain Blockscout was inaccessible during research, see §7).

---

## 1. Sources

### Source A — On-chain ABI (authoritative)

Obtained via Blockscout MCP (`get_contract_abi`) for Ethereum mainnet (chain ID 1), contract address `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`.

The Blockscout ABI includes the public `dailyData` getter, which exposes the underlying struct field names and types directly from the deployed contract:

```json
{
  "name": "dailyData",
  "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
  "outputs": [
    { "internalType": "uint72",  "name": "dayPayoutTotal",            "type": "uint72"  },
    { "internalType": "uint72",  "name": "dayStakeSharesTotal",       "type": "uint72"  },
    { "internalType": "uint56",  "name": "dayUnclaimedSatoshisTotal", "type": "uint56"  }
  ],
  "stateMutability": "view",
  "type": "function"
}
```

The same ABI entry for `dailyDataRange` (the batch accessor used by CoinPulse):

```json
{
  "name": "dailyDataRange",
  "inputs": [
    { "internalType": "uint256", "name": "beginDay", "type": "uint256" },
    { "internalType": "uint256", "name": "endDay",   "type": "uint256" }
  ],
  "outputs": [
    { "internalType": "uint256[]", "name": "list", "type": "uint256[]" }
  ],
  "stateMutability": "view",
  "type": "function"
}
```

**`dailyDataRange` returns `uint256[]`, not `uint72[]`.** See §5 (ABI Discrepancy) for impact.

---

### Source B — JamJomJim/HEX.sol gist (corroborating)

GitHub gist: `https://gist.github.com/JamJomJim/fb3883c15da1a354857ca085e65d145a`

Relevant constant and packing function (verbatim):

```solidity
uint256 internal constant HEART_UINT_SIZE = 72;

function dailyDataRange(uint256 beginDay, uint256 endDay)
    external
    view
    returns (uint256[] memory list)
{
    require(beginDay < endDay && endDay <= globals.dailyDataCount, "HEX: range invalid");
    list = new uint256[](endDay - beginDay);
    uint256 src = beginDay;
    uint256 dst = 0;
    uint256 v;
    do {
        v  = uint256(dailyData[src].dayUnclaimedSatoshisTotal) << (HEART_UINT_SIZE * 2);
        v |= uint256(dailyData[src].dayStakeSharesTotal)       << HEART_UINT_SIZE;
        v |= uint256(dailyData[src].dayPayoutTotal);
        list[dst++] = v;
    } while (++src < endDay);
    return list;
}
```

This confirms: return type is `uint256[]`, `HEART_UINT_SIZE = 72`, and the three-field bit packing order.

---

### Source C — kbahr/HexUtilities.sol gist (corroborating)

GitHub gist: `https://gist.github.com/kbahr/80e61ab761053849f7fdc6226b85a354`

Independent HEX utility library showing the corresponding **unpack** logic (verbatim):

```solidity
uint256 private constant HEARTS_UINT_SHIFT = 72;
uint256 private constant HEARTS_MASK       = (1 << HEARTS_UINT_SHIFT) - 1;
uint256 private constant SATS_UINT_SHIFT   = 56;
uint256 private constant SATS_MASK         = (1 << SATS_UINT_SHIFT)   - 1;

function decodeDailyData(uint256 encDay)
    private
    pure
    returns (DailyDataCache memory)
{
    uint256 v      = encDay;
    uint256 payout = v & HEARTS_MASK;           // dayPayoutTotal
    v              = v >> HEARTS_UINT_SHIFT;
    uint256 shares = v & HEARTS_MASK;           // dayStakeSharesTotal
    v              = v >> HEARTS_UINT_SHIFT;
    uint256 sats   = v & SATS_MASK;             // dayUnclaimedSatoshisTotal
    return DailyDataCache(payout, shares, sats);
}
```

This confirms the unpacking masks and shifts, and independently corroborates the `uint56` (56-bit) width for `dayUnclaimedSatoshisTotal`.

---

### Sources that could not be retrieved

| Source | Outcome |
|---|---|
| Etherscan web page (`etherscan.io`) | HTTP 403 — blocked in this environment |
| Etherscan API (`api.etherscan.io`) | HTTP 403 — API key required |
| PulseChain Blockscout (`scan.pulsechain.com`) | HTTP 403 — blocked |
| PulseChain chain ID 369 via Blockscout MCP | Chain not known to hosted Blockscout MCP instance |
| GitHub raw gist content | HTTP 403 — blocked; fetched via gist HTML page instead |
| HEX whitepaper (`go.hex.com`) | HTTP 403 — blocked |

---

## 2. Verified Field Layout

Each element of the `uint256[]` returned by `dailyDataRange` packs three fields:

| Field | Bit range | Width | Type | Mask (bigint) |
|---|---|---|---|---|
| `dayPayoutTotal` | bits 0–71 | 72 bits | uint72 | `(2n ** 72n) - 1n` |
| `dayStakeSharesTotal` | bits 72–143 | 72 bits | uint72 | `(2n ** 72n) - 1n` |
| `dayUnclaimedSatoshisTotal` | bits 144–199 | 56 bits | uint56 | `(2n ** 56n) - 1n` |
| (zero padding) | bits 200–255 | 56 bits | — | — |

**Total significant bits:** 200. Each packed value fits within a `uint256` (256 bits).

### BigInt unpacking formula (JavaScript/TypeScript)

```typescript
const HEARTS_MASK = (2n ** 72n) - 1n;  // (1n << 72n) - 1n
const SATS_MASK   = (2n ** 56n) - 1n;  // (1n << 56n) - 1n

function decodePackedDailyDataEntry(packed: bigint) {
  const dayPayoutTotal            =  packed                   & HEARTS_MASK;
  const dayStakeSharesTotal       = (packed >> 72n)           & HEARTS_MASK;
  const dayUnclaimedSatoshisTotal = (packed >> 144n)          & SATS_MASK;
  return { dayPayoutTotal, dayStakeSharesTotal, dayUnclaimedSatoshisTotal };
}
```

**Note:** Unit semantics are documented in §3. Do not assume units without reading §3.

---

## 3. Field Semantics (known from on-chain ABI field names)

| Field | Raw unit | Notes |
|---|---|---|
| `dayPayoutTotal` | hearts | HEX smallest denomination. 1 HEX = 10^8 hearts. Per-day total payout distributed to stakers. |
| `dayStakeSharesTotal` | stake share units | Raw T-share related units. T-shares ≈ `stakeShares / 1e12` but exact scaling must be verified against contract source before use in yield calculations (see roadmap §2). |
| `dayUnclaimedSatoshisTotal` | satoshis | Unclaimed BTC claim satoshis available for late-claim bonus. Zero after BPD (day 353). |

**Yield calculation semantics (not implemented yet):**
- Estimated yield for a stake on a given day ≈ `(stakeShares / dayStakeSharesTotal) * dayPayoutTotal`
- This formula is not implemented in this document — it is deferred to the yield estimator PR.
- BPD yield is handled separately (see roadmap §11.4 invariant #5).

---

## 4. Deterministic Test Vectors

These vectors are derived mechanically from the verified layout. They can be used to write implementation tests without external dependencies.

### Vector 1 — zero value

| Field | Value |
|---|---|
| Input packed (decimal string) | `"0"` |
| `dayPayoutTotal` | `0n` |
| `dayStakeSharesTotal` | `0n` |
| `dayUnclaimedSatoshisTotal` | `0n` |

Verification: `0n & HEARTS_MASK = 0n`, `(0n >> 72n) & HEARTS_MASK = 0n`, `(0n >> 144n) & SATS_MASK = 0n`.

---

### Vector 2 — payout and shares, no satoshis

| Field | Value |
|---|---|
| Input packed (decimal string) | `"2361183241434822606849000"` |
| `dayPayoutTotal` | `1000n` |
| `dayStakeSharesTotal` | `500n` |
| `dayUnclaimedSatoshisTotal` | `0n` |

Derivation:
```text
packed = 1000n + (500n * 2n**72n)
       = 1000n + (500n * 4722366482869645213696n)
       = 1000n + 2361183241434822606848000n
       = 2361183241434822606849000n
```

Verification:
```text
2361183241434822606849000n & ((2n**72n) - 1n)         = 1000n  ✓
(2361183241434822606849000n >> 72n) & ((2n**72n) - 1n) = 500n   ✓
(2361183241434822606849000n >> 144n) & ((2n**56n) - 1n) = 0n    ✓
```

---

### Vector 3 — max dayPayoutTotal, non-zero shares

| Field | Value |
|---|---|
| Input packed (decimal string) | `"9444732965739290427391"` |
| `dayPayoutTotal` | `4722366482869645213695n` (= `2n**72n - 1n`, max uint72) |
| `dayStakeSharesTotal` | `1n` |
| `dayUnclaimedSatoshisTotal` | `0n` |

Derivation:
```text
packed = (2n**72n - 1n) + (1n * 2n**72n)
       = 2n * 2n**72n - 1n
       = 2n * 4722366482869645213696n - 1n
       = 9444732965739290427392n - 1n
       = 9444732965739290427391n
```

Verification:
```text
9444732965739290427391n & ((2n**72n) - 1n)          = 4722366482869645213695n  ✓
(9444732965739290427391n >> 72n) & ((2n**72n) - 1n)  = 1n                       ✓
(9444732965739290427391n >> 144n) & ((2n**56n) - 1n) = 0n                       ✓
```

---

### Vector 4 — value exceeding uint72 must be rejected

| Condition | Value |
|---|---|
| Input packed | `4722366482869645213696n` (= `2n**72n`, one above max uint72) |
| Expected | Decoder must reject as out-of-range (> max uint256-packed value is not the issue; the value itself is valid for uint256, but a decoder that receives this as a pre-decoded bigint from `decodeDailyDataPayload` should validate that it is ≤ max uint72 = `4722366482869645213695n` **only if** the input was declared as uint72) |

**Correction:** When the ABI is corrected to `uint256[]`, input values may legitimately span 200 bits. The decoder's validation boundary should be `packed ≤ (2n**200n) - 1n` for the packed uint256, or individual field validation after unpacking. This is an implementation decision for the packed decoder PR — documented here to avoid silent acceptance of negative or unreasonably large inputs.

---

## 5. Critical ABI Discrepancy in Repository

**This is a blocking finding for packed decoder implementation.**

### What is wrong

`src/services/hexmining/daily-data-reader.ts` line 14 declares:

```typescript
"function dailyDataRange(uint256 beginDay, uint256 endDay) view returns (uint72[] list)"
```

The actual on-chain function returns **`uint256[]`**, not `uint72[]` (verified by Source A above).

### Impact

When viem decodes a `uint256[]` ABI response using a `uint72[]` type declaration, it truncates each 32-byte ABI word to 72 bits. The result is that each returned BigInt retains only bits 0–71 of the packed value:

| Field | Bits | With `uint72[]` ABI | With `uint256[]` ABI |
|---|---|---|---|
| `dayPayoutTotal` | 0–71 | ✅ preserved | ✅ preserved |
| `dayStakeSharesTotal` | 72–143 | ❌ silently dropped | ✅ preserved |
| `dayUnclaimedSatoshisTotal` | 144–199 | ❌ silently dropped | ✅ preserved |

**Consequence:** Every `RawHexDailyDataObservation` row currently in the database whose `canonicalPayload` was acquired via the existing `daily-data-reader.ts` code contains only `dayPayoutTotal` for each day. The `dayStakeSharesTotal` and `dayUnclaimedSatoshisTotal` values are lost and cannot be recovered from the stored payload.

### Required fix (deferred to a separate PR — not in this doc PR)

1. Change the ABI declaration in `daily-data-reader.ts` from `uint72[]` to `uint256[]`.
2. Re-acquire affected observation ranges after the fix is deployed — the stored payloads with the wrong ABI cannot be corrected; new observations must be ingested.
3. The packed decoder implementation PR may only proceed after the ABI fix is merged and verified.

### This is not a scope creep risk

The ABI fix is a single line change in `daily-data-reader.ts`. It does not require schema changes. It does not require frontend changes. It should be a bounded, standalone PR.

---

## 6. Summary — Is Implementation Unblocked?

| Question | Answer |
|---|---|
| Is the bit layout verified? | ✅ Yes — from on-chain ABI (Source A) + two corroborating gists (B, C) |
| Are field names verified? | ✅ Yes — `dayPayoutTotal`, `dayStakeSharesTotal`, `dayUnclaimedSatoshisTotal` |
| Are bit widths verified? | ✅ Yes — 72 / 72 / 56 bits respectively |
| Are bit offsets verified? | ✅ Yes — 0 / 72 / 144 |
| Are masks verified? | ✅ Yes — `(1<<72)-1` / `(1<<72)-1` / `(1<<56)-1` |
| Are test vectors available? | ✅ Yes — see §4 above |
| May the packed decoder PR be opened? | ❌ No — the ABI discrepancy in `daily-data-reader.ts` must be fixed first (§5) |
| Is there a new blocker? | ✅ Yes — `uint72[]` ABI declaration must be corrected to `uint256[]` before stored observations contain complete data |

**Recommended immediate next PR:** `fix(hexmining): correct dailyDataRange ABI declaration from uint72[] to uint256[]`

After that fix is merged and verified: `feat(hexmining): add dailyData packed decoder`

---

## 7. Open Questions (not blocking this spec)

- **T-share scaling:** `dayStakeSharesTotal` unit scaling (T-shares = stakeShares / 1e12 or different) must be verified before yield formula is implemented. The roadmap (§2) notes this as "must be verified against HEX contract source before implementation."
- **Yield formula:** Not documented here. Deferred to the yield estimator PR after the packed decoder is complete and the ABI is fixed.
- **BPD detection:** Day 353 BPD logic is deferred — see roadmap §11.4 invariant #5.
