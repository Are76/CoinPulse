# PulseIcon Privacy and Decentralization Principles

**Status:** Proposed — pending product-owner approval (opened 2026-08-19). Architecture guardrail document; no functional change. Do not treat this document as accepted policy until the product owner approves PR #372.

**Canonical decision record:** D-037 in `docs/project-decisions.md`.

---

## Purpose

This document establishes privacy-by-architecture, minimal identity coupling, and
non-custodial/read-only product guardrails **before** accounts, subscriptions, billing,
multi-device sync, analytics, or any user↔wallet ownership model is implemented for
PulseIcon (the product identity CoinPulse's canonical backend serves).

It is written now, ahead of that work, so that conventional SaaS patterns — a
`User.hasMany(Wallet)` table, a plaintext account↔wallet join, ad-supported monetization —
never become the default architecture by accident. Retrofitting privacy after those
patterns exist is far more expensive than deciding not to introduce them in the first
place.

This document does not implement anything. It is a guardrail for future decisions, and it
supersedes any future PR's convenience-driven shortcut where the two conflict.

---

## 1. Core architecture decision

PulseIcon pursues three commitments simultaneously, not as a tradeoff against each other:

```text
CANONICAL BACKEND TRUTH
  +
PRIVACY BY ARCHITECTURE
  +
MINIMAL IDENTITY COUPLING
```

**Privacy must not be achieved by weakening backend-truth-first architecture.** This
document adds nothing that contradicts, and reinforces everything that already exists in,
`docs/project-decisions.md` D-001 through D-036 and `CLAUDE.md`:

- PostgreSQL / the canonical backend remains the sole source of truth.
- RPC and third-party blockchain APIs remain ingestion/input only — never frontend truth.
- The frontend still performs no accounting: no balances, pricing, valuation, PnL, yield,
  HEX stake state, or DeFi position computation (D-001, D-004).

Privacy in this document is about a different axis entirely: minimizing unnecessary
linkage between a **human PulseIcon user identity** and a **public blockchain identity**.
It does not relax any existing truth-stack, DTO, or numeric-safety rule.

---

## 2. Fundamental domain separation

Two domains must remain conceptually and architecturally distinct:

**A. Blockchain / canonical domain** — `chainId`, wallet address, asset identity,
transaction identity, protocol identity, position identity, canonical observations,
ledger entries, holdings, HEX stake state, DeFi positions, pricing provenance, PnL
provenance.

**B. User / commercial domain** — account, authentication, subscription, entitlement,
billing, preferences, notification settings.

**Rule: canonical blockchain data belongs to blockchain identities, not PulseIcon user
identities.** A PulseIcon `userId` must not become part of canonical wallet identity,
asset identity, transaction identity, ledger identity, HEX identity, DeFi position
identity, or pricing identity, unless a future explicit architecture decision proves it is
required and that decision supersedes this one.

This is consistent with — and an extension of — D-005 (no symbol-as-identity): each
domain retains its own existing chain-scoped canonical key (for example, token identity as
`chainId + tokenAddress`; a raw transaction as `chainId + txHash + blockHash`; a ledger
entry as `chainId + walletId + dedupeKey`; an ended stake as
`chainId + walletAddress + stakeId`). This document adds one constraint on top of those
existing keys, not a replacement for them: `userId` stays excluded from all of them.

---

## 3. User ↔ wallet association

The association `identified user/account ↔ wallet address` is **privacy-sensitive data**
(see the Class D data classification in §15).

The default architecture must not casually introduce a conventional
`User hasMany Wallet` ownership hierarchy. This is a **future guardrail**, evaluated when
accounts are eventually designed — not a statement that such a table exists today (it does
not; PulseIcon has no account system yet).

Any persistent identifiable user↔wallet relationship requires a dedicated privacy/security
architecture review before implementation (see §21).

Canonical public blockchain data (raw observations, ledger entries, materialized state)
must remain reusable independently of which PulseIcon users happen to inspect or follow a
given address — the same canonical wallet record must not need to be duplicated or scoped
per viewing user.

This section governs *identified human user* ↔ wallet association only. The repository's
existing operator-facing tracked-wallet records (`POST /api/wallets/import`,
`GET /api/wallets/tracked`) are wallet-scoped operational state keyed by
`walletAddress + chainId` — they are not an identified-user ownership model and are not,
by themselves, a violation of this guardrail. They become in scope for the review in §21
only if a future change links them to an identified PulseIcon end-user account.

---

## 4. Account-optional free experience (future goal)

Where technically and economically practical, basic portfolio inspection should **not**
require account creation, email, wallet connection, wallet signing, proof of wallet
ownership, or identity verification.

Target interaction:

```text
open PulseIcon → enter/paste public wallet address → view supported canonical portfolio analytics
```

A user may inspect any public wallet without proving ownership. PulseIcon is a portfolio
analytics product, not a wallet, and the product should reflect that distinction wherever
practical.

This is a target-architecture principle for future account/entitlement design, not a
statement that account gating exists or is being removed today.

---

## 5. Non-custodial / read-only forever

PulseIcon is **not** intended to become a wallet. The architecture must not require a seed
phrase, private key, token approval, transaction signing, or custody of any kind.

**PulseIcon must never request, transmit, log, or persist seed phrases or private keys.**
This is an absolute prohibition, not a scoping question.

If a future feature proposal involves signing, custody, wallet creation, or private-key
handling, that feature requires a separate, explicit security architecture decision and is
outside current product architecture. No current document, roadmap, or PR implies such
functionality is planned.

---

## 6. Local-first watchlists (future guardrail)

For accountless/free usage, saved or followed wallet lists and related UI preferences
**should** remain local-first where practical. A local watchlist should not require a
server-side user↔wallet table merely to remember wallets on one device.

This is documented as a future architecture guardrail for whenever watchlist persistence
is designed. It is not implemented now, and this document does not implement it.

---

## 7. Client-side encrypted multi-device sync (future guardrail)

If PulseIcon later offers cross-device watchlist sync, the preferred target architecture
is:

```text
plaintext wallet list → encryption on client → encrypted blob stored by PulseIcon → decryption on client
```

Server-side storage should not require plaintext access to the saved watchlist merely to
provide synchronization.

This document does not specify a cryptographic scheme, algorithm, or protocol — inventing
one here would be irresponsible. **Any implementation requires a dedicated cryptographic
and security review before it is built, and before any marketing claim such as "PulseIcon
cannot read your saved wallet list" is made** (see §§19 and 21). No such capability exists
in PulseIcon today.

---

## 8. Account/subscription separation (future guardrail)

Premium access should conceptually be an **entitlement**, not ownership of canonical
blockchain records. Target separation:

```text
IDENTITY / BILLING            PORTFOLIO
  user                          wallet
  → subscription                → canonical blockchain state
  → entitlement                 → analytics
```

Where practical, portfolio services should receive only the minimum authorization state
needed to know whether premium features are allowed — not the user's identity, email, or
payment details. Canonical portfolio calculation should not require email, name, payment
details, or a payment processor's customer ID. **Payment identifiers must not become
canonical blockchain identifiers.**

No account or subscription system exists in PulseIcon today; this section is guidance for
when one is designed.

---

## 9. Request-path privacy

Schema-level separation of canonical blockchain data from user data is necessary but not
sufficient. A system can accidentally recreate `user identity ↔ wallet address` linkage
through infrastructure layers even when the application schema avoids it. Any future
privacy review must also cover:

application logs, API request logs, reverse proxies, CDN logs, auth middleware,
observability tooling, error tracking, analytics, support tooling, database query logs,
backups, and infrastructure providers.

**Wallet/account associations must not be logged merely for developer convenience.**

---

## 10. Telemetry and analytics

PulseIcon does not adopt an impossible "no telemetry ever" requirement. Operational
visibility is legitimate and necessary for reliability, performance, crash/error
detection, failed-ingestion monitoring, unsupported-protocol discovery, onboarding
performance, aggregate feature usage, and product-quality measurement.

**Preferred approach:** privacy-minimized, first-party telemetry where practical.

**Explicitly prohibited:** using wallet holdings, portfolio value, transaction history,
PnL, HEX holdings/stakes, or DeFi activity to build advertising profiles. Product
observability is allowed; advertising surveillance is not.

---

## 11. No ads

PulseIcon should not contain third-party advertising. Portfolio information must not be
used for ad targeting — for example: inferring HEX ownership to target a token
advertisement, or inferring a high-value portfolio to build a high-net-worth advertising
profile. Both are explicitly prohibited.

The business model should be aligned with subscription/product value, not monetization of
portfolio information.

---

## 12. No sale of portfolio data

PulseIcon must not sell or broker user-associated wallet watchlists, holdings, portfolio
value, PnL, HEX positions, DeFi positions, or behavioral profiles derived from portfolio
usage.

**Principle: the user is the customer. Their portfolio data is not the advertising
product.**

---

## 13. Public blockchain ≠ public human identity

These are distinct facts and must not be conflated:

- **Public fact:** address `0xABC` performed transaction X. This is inherent to a public
  blockchain and is not, by itself, privacy-sensitive.
- **Privacy-sensitive derivation:** person Y owns, controls, or follows `0xABC`, and
  therefore has portfolio Z. This linkage is the sensitive part.

The public nature of blockchain transactions must not be treated as permission to
unnecessarily centralize identity associations between human users and the addresses they
inspect or hold.

---

## 14. Data minimization

For any new user-specific data field, the question that must be answered before adding it
is: **why does PulseIcon need this?** "May be useful later" is not sufficient
justification.

Give special scrutiny to: real name, physical address, phone number, wallet-ownership
relationship, IP retention, device fingerprints, and behavioral profiling. Collect only
what is concretely needed for product functionality, security, legal obligation, or
operations.

---

## 15. Data classification

At minimum, four conceptual classes apply:

| Class | Examples |
|---|---|
| **A. Public canonical blockchain data** | blocks, transactions, logs, transfers, public addresses, public contract state |
| **B. Derived canonical analytics** | ledger, holdings, HEX state, DeFi positions, backend PnL, pricing observations/provenance |
| **C. User-specific private data** | account, subscription, preferences, encrypted watchlist blob, notification settings |
| **D. Sensitive association data** | identified user/account ↔ wallet address |

**Class D must be aggressively minimized.** It is the one class where existing, otherwise
public (Class A/B) data becomes privacy-sensitive purely through association with an
identified human.

---

## 16. Truth and provenance remain fundamental

These privacy principles reinforce, and must never weaken, CoinPulse/PulseIcon's existing
truth rules (D-001, D-004, D-007, D-008). Never fabricate balances, pricing, valuation,
PnL, cost basis, yield, DeFi position value, wallet ownership, or user identity.
Unsupported or unverifiable results must remain explicitly `unknown`, `unavailable`,
`unsupported`, or `unverified`, as appropriate — never coerced to a default.

---

## 17. Verifiability (target direction)

PulseIcon should move toward verifiable analytics over time. The centralized analytics
backend is not described as inherently trustless — it is not. Instead, the target product
direction is: **important financial results should expose provenance/auditability where
practical** — balances, transaction derivation, historical prices, PnL, HEX stakes, yield,
DeFi positions.

**Don't merely trust the number. Verify how PulseIcon derived it.** This is a direction,
not a claim that end-to-end verifiability exists today.

---

## 18. Exitability

Where practical, future users should be able to: remove user-specific account data, remove
saved wallet associations, clear local watchlists, export appropriate user-specific data,
and cancel a subscription — all without affecting public canonical blockchain truth.

**Explicitly distinguish** deleting a user/account association from deleting reusable
canonical public blockchain observations. These must never be conflated: deleting a user's
account must never be implemented as, or imply, deleting canonical raw/ledger evidence
(consistent with the existing immutable-evidence rule — raw and ledger records are marked,
never deleted, per `CLAUDE.md`).

---

## 19. Marketing claims require proof

Architecture intent is not evidence of implementation. PulseIcon must not claim:

- **"We collect nothing"** — if backend infrastructure processes wallet addresses or
  portfolio data (it does, and will continue to).
- **"Your wallet address never leaves your device"** — if the address is sent to the
  PulseIcon backend (it is, for backend-truth-first analytics to work at all).
- **"Anonymous"** — unless the complete implementation actually supports it.
- **"Decentralized"** — merely because PulseChain itself is decentralized. PulseIcon's
  backend is a centralized analytics service over decentralized chain data; those are not
  the same claim.

Future claims such as *"saved wallet lists are encrypted before reaching PulseIcon
servers"* or *"our account system does not store the wallets you follow"* may only be made
**after** implementation and technical verification actually prove them. This document is
an architecture guardrail, not marketing evidence, and must not be cited as if it were.

---

## 20. PulseChain-native product principles

Guiding product principles, stated on technical merit alone — with no political or
personality endorsement framing:

- read-only by design
- never ask for seed phrases or private keys
- public wallet inspection without a mandatory account, where practical
- no ads
- no sale of portfolio data
- no advertising profiles built from portfolio data
- minimal identity coupling between human users and wallet addresses
- local-first watchlists (future)
- client-side encrypted sync where appropriate and security-reviewed (future)
- canonical backend accuracy (unchanged — see D-001)
- auditable provenance
- unknown means unknown — never coerced to zero or a placeholder
- users pay for product value; portfolios are not monetized as an advertising asset
- avoid unnecessary centralized ownership mapping of public wallets

---

## 21. Required future privacy/security review triggers

Explicit architecture review is required **before** implementation of any of the
following. None of these are routine CRUD additions:

- accounts
- authentication
- subscriptions
- billing
- permanent user↔wallet associations
- cross-device wallet sync
- wallet ownership verification
- wallet signatures
- notifications tied to wallets
- third-party product analytics
- advertising
- public portfolio profiles
- portfolio sharing
- account recovery for encrypted user data
- client-side cryptography

---

## 22. Prohibited default shortcuts

Without an explicit architecture decision approving the exception, future work must not:

- introduce `User.hasMany(Wallet)` as the default ownership model
- make `userId` part of canonical blockchain identity
- move canonical calculations to the frontend for privacy convenience (this would also
  violate D-001/D-004 independently)
- request or store private keys or seed phrases
- log user↔wallet associations unnecessarily
- introduce third-party ad trackers casually
- sell portfolio information
- use portfolio information for advertising
- equate account ownership with blockchain ownership
- equate public wallet data with identified human identity
- create homemade cryptographic protocols

---

## 23. Non-goals

This decision does **not** require PulseIcon to:

- become a wallet
- become fully client-side
- remove PostgreSQL or backend infrastructure
- move calculations into the browser
- decentralize every infrastructure component
- implement encryption now
- implement accounts now
- implement subscriptions now
- claim anonymity
- claim zero-knowledge architecture
- claim trustlessness
- become a crypto accounting product beyond what is already scoped elsewhere

This document defines guardrails only. It implements no feature.

---

## 24. Current vs. future status

**Already true today** (verified against `CLAUDE.md`, `docs/project-decisions.md`,
`AGENTS.md`, and repository inspection at the time of writing):

- Backend truth first; PostgreSQL canonical (D-001).
- RPC is ingestion-only, never frontend truth (D-002).
- No frontend computation of balances, prices, PnL, LP values, or stake values (D-004).
- Chain-aware identity, never symbol-as-identity (D-005).
- No fabricated valuation/PnL/yield; unsupported stays explicit (D-004, D-007, D-008).
- Raw/ledger records are immutable evidence, never deleted (`CLAUDE.md`).
- No account, subscription, billing, or user↔wallet ownership system exists in the
  repository today.

**Future guardrails** (apply once the relevant feature is designed, not implemented by
this document):

- No permanent plaintext user↔wallet relationship by default (§3).
- Account-optional wallet inspection where practical (§4).
- Local-first watchlists (§6).
- Client-side encrypted multi-device sync, cryptography TBD and review-gated (§7).
- Entitlement/billing separation from canonical portfolio data (§8).
- Privacy-minimized first-party telemetry (§10).
- No-ads / no-sale-of-portfolio-data as durable product principles (§11, §12).

**Future implementation ideas requiring dedicated review before any code lands** (§21):
accounts, auth, subscriptions, billing, permanent user↔wallet associations, cross-device
sync, wallet ownership verification/signatures, wallet-tied notifications, third-party
analytics, advertising, public portfolio profiles/sharing, encrypted-data account
recovery, client-side cryptography.

---

## 25. Relationship to existing decisions

This document does not supersede or weaken any existing decision in
`docs/project-decisions.md` (D-001–D-036) or any rule in `CLAUDE.md` / `AGENTS.md`. Where
a future privacy-driven proposal would require weakening backend-truth-first architecture,
frontend DTO-only consumption, chain-aware identity, or any other existing architecture
rule to achieve a privacy goal, that proposal is rejected under this document, not
accepted — see §1.
