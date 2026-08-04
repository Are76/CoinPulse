# PulseChain Fork-State and Inherited-History Policy

**Status:** Proposed — architecture and documentation policy only. D-036 is recorded in `docs/project-decisions.md`, but it remains `Proposed` and is not yet `Accepted`.

**Scope:** Documentation and contract design only. No source code, tests, Prisma schema, migrations, DTOs, API routes, sync, rebuild, or backfill behavior is changed by this document.

---

## 1. Purpose

CoinPulse stores raw and ledger data under `chainId = 369` (PulseChain) for every observation returned by a PulseChain RPC endpoint. PulseChain is a state-fork of Ethereum: it inherited Ethereum's full transaction and state history up to a fork block, and only chain activity after that point is independently produced by PulseChain's own validators.

This means a PulseChain RPC can — and does — return blocks, transactions, and events that are **Ethereum history**, not PulseChain-native activity, with no marker distinguishing the two. Today, CoinPulse's ingestion, ledger, and materialization layers treat every row returned by the PulseChain RPC identically, regardless of which side of the fork it originated on.

The purpose of this document is to define, in writing only, how CoinPulse should represent, classify, and eventually use:

- blocks below the PulseChain fork boundary;
- Ethereum-origin history inherited by PulseChain;
- PulseChain fork-opening balances and contract state;
- pHEX and eHEX identity;
- pre-fork stakes and transfers;
- materialized balances;
- historical transactions;
- PnL, yield, and cost basis;
- user-facing provenance and warnings.

This document does not implement the policy. It defines the policy and the bounded implementation phases that would carry it out in later, separate PRs.

---

## 2. Verified facts

Facts are separated by evidence class per the project's evidence model (`docs/project-decisions.md` §Evidence Model).

### 2.1 Verified chain behavior (from the task's investigation context, re-verified against repository test fixtures where possible)

- PulseChain RPC reports `chainId = 369`. [Task-provided investigation finding; consistent with `src/config/chains.ts` `PULSECHAIN_REFERENCE.id: 369`, [E3].]
- Blocks below `17,233,000` are available through the PulseChain RPC. [Task-provided investigation finding — **not independently re-verified in this session**; this session made no live RPC calls, per the docs-only, no-sync/no-RPC scope of this task. Treat as an unresolved question requiring operator RPC verification (§21) until confirmed.]
- Two wallet stake actions exist at block `15,353,156` (`2022-08-16T15:26:09Z`) and block `15,767,882` (`2022-10-17T12:39:59Z`), with the exact wallet address, the corresponding Ethereum-side match, and their presence in a production `RawStakeAction`/observation row asserted by the task's investigation context. **This session did not re-verify any of that against production data** — no database query, live RPC call, or explorer lookup was performed (docs-only, no-sync/no-RPC scope). **What this session did independently confirm [E3]:** the exact block numbers `15,353,156` and `15,767,882` appear in committed test fixtures — `tests/services/hexmining/ended-stake-observation-store.test.ts`, `tests/services/hexmining/ended-stake-reader.test.ts`, `tests/services/hexmining/ended-stake-historical-state-recovery.test.ts`. A shared block number between a test fixture and an investigation claim is consistent with, but does not prove, the investigation's claim that a real production row exists at that block for a real wallet — the fixture could equally be synthetic test data that happens to reuse a plausible pre-fork block number. Both numbers are below the candidate `lastInheritedBlock` figure (§6), consistent with pre-fork 2022 timestamps (PulseChain mainnet launched 2023), but this is a plausibility check, not proof. **This claim is retagged here as task-provided investigation evidence requiring independent re-verification against production data before any implementation or migration relies on it** — it is not newly verified by this PR's repository inspection.
- **If** such rows exist in production, CoinPulse's schema provides only one storage path for them: `PortfolioStakePosition`, `RawStakeAction`, and all HexMining observation tables are keyed by `chainId` [E3], and the only supported `chainId` in `src/config/chains.ts` and `src/services/hexmining/types.ts` is `369` [E3] — there is no separate storage path for pre-fork vs. post-fork evidence today, regardless of whether these two specific rows exist. This structural fact (no separate storage path exists) is independently repository-verified; it does not depend on confirming these two specific rows.

### 2.2 Verified repository behavior (this session)

- **No block-boundary or fork/pre-fork provenance rule exists anywhere in the codebase.** [E3] — a repository-wide search for `fork`, `17233000`, `genesis`, `pre-fork`, `copied state`, and `cost-basis policy` across `src/` found exactly three matches, none of which implement a boundary:
  - `src/services/hexmining/types.ts:123` — a comment: `// costBasisPolicy will be populated in Phase 7 once fork-copy policy is decided. See docs/v2-hexmining-roadmap.md §8 Decision 10.` This is a deferred placeholder, not a policy or implementation.
  - `src/services/hexmining/ended-stake-historical-state-recovery.ts:178` — a comment clarifying that historical reads must pin to `endBlockNumber - 1`, not `"latest"`, so as not to "read post-fork/current state" — this is about not reading the *wrong point in time* for a historical contract-state lookup, not about classifying pre-fork vs. post-fork *evidence*.
  - `src/services/hexmining/native-stake-live-verification-runner.ts:158` — a comment warning that an operator could point `--rpcUrl` at an "Ethereum/mainnet/fork endpoint" and get false-positive `chainId:369` evidence; the code responds by asking the connected node for its actual `chainId` and failing closed if it disagrees. This guards against a *wrong RPC endpoint*, not against *inherited history returned by the correct PulseChain endpoint*.
  - No other file references `fork`, `eHEX`, `snapshot`, or `genesis` in a fork-state sense. [E3]
- **`src/services/hexmining/types.ts:123` cites `docs/v2-hexmining-roadmap.md §8 Decision 10`, which is a stale in-code cross-reference — the roadmap was split into an active document and an archive (per D-0xx "roadmap split into active + archive", PR #233), and "Decision 10 — Fork-copy cost basis policy" lives in the archive, not the active roadmap.** [E3] — verified at `docs/v2-hexmining-roadmap-archive.md:449-450`: *"When a wallet held eHEX before the PulseChain fork, pHEX was created as a copy. Possible cost-basis policy options: (a) fork-copy assigns eHEX cost basis to pHEX, (b) pHEX from fork has zero cost basis, (c) manual override, (d) policy not set / unknown. This decision must be documented and stored in the DTO (`costBasisPolicy` field) before any PnL surface is enabled."* The same archive document also records, at line 297 and line 379, that `costBasisPolicy: "fork-copy" | "zero-basis" | "manual" | "unknown"` is a required, still-unset DTO field, and at line 465 that this is a HIGH-severity risk mitigated only by keeping `valuation.status: "unsupported"` until the policy is decided. **This decision (`Decision 10`) remains deferred and unresolved** — no option (a)/(b)/(c)/(d) has been chosen. This policy document's `FORK_OPENING_STATE`/§10 architecture defines *how CoinPulse would represent and source* fork-opening balances/state generally (native PLS, PRC-20s, stakes); it does **not** itself choose, and must not be read as silently choosing, which of Decision 10's cost-basis options applies to pHEX — that remains a separate, still-open decision, and §12 of this document explicitly forbids assuming either a copied-Ethereum-cost-basis or a zero-cost-basis default in the interim.
- **CoinPulse does not model an explicit PulseChain fork-opening balance anywhere.** [E3] — no Prisma model, service, or DTO field named anything resembling "opening state," "fork snapshot," or "genesis balance" exists in `prisma/schema.prisma`, `src/services/`, or `src/config/`.
- **`src/config/assets.ts` defines only PulseChain-side assets:** `nativePls` (`chain:369:native:0x0…0`), `phex` (`chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`), `pdai`. There is no `eHEX` asset entry, no Ethereum `chainId: 1` asset entry, and no cross-chain asset-mapping table anywhere in the codebase. [E3]
- **Staking ingestion (`src/services/hexmining/ended-stake-discovery.ts`, `-observation-store.ts`, `-historical-state-recovery.ts`) applies no block-boundary or pre-fork check.** Discovery reads `RawStakeAction` START/END records and persists observations keyed by `chainId: 369` with no branch on block number relative to any fork threshold. [E3]
- **Transfer ingestion (`src/services/sync/transfer-sync.ts`, `sync-common.ts`, `sync-orchestrator.ts`) applies no block-boundary or pre-fork check.** Sync windows are defined purely by `[startBlock, endBlock]` supplied by the operator or resumed from `SyncCursor`; nothing in the ingestion path distinguishes a block below the fork from a block above it. [E3]
- **Canonical asset identity (`assetId = chain:<chainId>:erc20:<address>` / `chain:<chainId>:native:<address>`) is chain-scoped but not fork-boundary-aware.** A pHEX transfer that occurred pre-fork (technically Ethereum HEX activity, replayed into PulseChain's inherited state) and a pHEX transfer that occurred post-fork both normalize to the identical `assetId` (`chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`) with no distinguishing field. [E3]
- **Ledger normalization and materialization (`src/services/normalization/`, `src/services/portfolio/materialize-positions.ts`) treat all `chainId: 369` ledger entries uniformly** regardless of block number. `materializeCurrentPortfolioPositions` reads the entire wallet ledger and reports `negative-token-balance` warnings without any fork-boundary-aware segmentation. [E3]
- **Pricing (`src/services/pricing/`) has no fork-boundary logic.** Price observations are keyed by `chainId`, `assetId`, `quoteAsset`; nothing distinguishes a pre-fork-timestamped ledger event from a post-fork one for historical price resolution purposes. [E3]
- **PnL (`src/services/pnl/average-cost.ts`, `types.ts`) has no fork-boundary logic and computes nothing today** — per D-034 and the guardrails doc, PnL/valuation remain `unsupported`/`unavailable` project-wide; this is independently true regardless of fork-state policy, but it also means no fork-aware cost-basis exemption or rule currently exists because no cost-basis computation exists at all yet. [E3]
- **The two pre-fork stake actions cited in the investigation do not explain the large negative materialized PLS and pHEX balances.** [Task-provided investigation finding — accepted as given per instructions; not independently re-derived from production data in this docs-only session, consistent with the hard-stop rule against running sync/rebuild/backfill/database queries.] The negative balances are documented elsewhere (`docs/transfer-history-backfill-operator-plan.md`, `docs/wallet-scoped-historical-sync-runbook.md`) as primarily associated with **incomplete TRANSFERS history** — outflows ingested without their corresponding inflows — which is an entirely separate, already-documented problem from fork/pre-fork provenance. [E1] `docs/ai-handoff.md`: "Transfer-backfill posture … the TRANSFER-family backfill is paused after Window 60. Window 61 requires explicit operator approval."

### 2.3 Documentation-drift finding: repository operator docs are stale relative to live operational state

This section distinguishes four separate claims that must not be conflated: (1) what the repository's committed documentation says, (2) what verified live database/operator evidence says, (3) which of those two is stale, and (4) what conclusion is safe to draw regardless of exact window numbering.

- **Repository committed documentation (current text, potentially stale):** `docs/ai-handoff.md`, `docs/project-decisions.md`, and `docs/wallet-scoped-historical-sync-runbook.md` state the TRANSFERS backfill campaign is **paused after Window 60**, with **Window 61** requiring explicit operator approval before further execution. [E1] — this is what is committed on `main` as of this PR's base commit.
- **Verified live operator/database evidence (supplied mid-task, treated as current operational fact per the user's correction, not independently re-queried against production in this docs-only session):**
  - Window 63 completed successfully, covering block range `26,634,999–26,635,998`.
  - The current shared `SyncCursor` for the TRANSFERS campaign makes `26,633,999–26,634,998` the next adjacent descending range.
  - A read-only execution-impact investigation confirmed that submitting that adjacent range through the manual wallet-sync route would read and update the **same shared `SyncCursor`** the global campaign uses — i.e., there is only one cursor, not a separate per-feature cursor, so that next range is operationally the campaign's Window 64 **regardless of what policy label or window number any request would use**.
  - **No Window 64 execution occurred.** This document does not treat any window as approved or run by virtue of this finding.
- **Conclusion on staleness:** The repository's Window 60/61 text is **stale documentation**, not the current operational state. This document does not rewrite that stale text to match the newer evidence (that would exceed this PR's docs-only, no-runbook-edit scope — see below) and does not treat the stale text as authoritative for any conclusion in this policy. It records the discrepancy and flags a required follow-up.
- **Scope boundary respected:** Per explicit instruction, this PR does **not** modify `docs/ai-handoff.md`, `docs/project-decisions.md`'s existing D-0xx entries, `docs/wallet-scoped-historical-sync-runbook.md`, or `docs/transfer-history-backfill-operator-plan.md` to correct the Window 60/61 figures — that correction is its own bounded documentation-synchronization task (§21), separate from defining fork-state policy, and is listed as a follow-up rather than performed here. This policy document does not approve or execute Window 64 or any other window.
- **Structural conclusion, independent of exact window numbering (verified from code, holds under either the stale or corrected figures):** `docs/transfer-history-backfill-operator-plan.md` §2 fact 6 and §3 Q4 establish each backfill window covers at most 1,000 blocks, descending from the TRANSFERS cursor's lower edge. The verified current range (~block 26.6 million) is **millions of blocks above** the task-supplied pre-fork/inherited-history region (investigation context: PulseChain RPC serves blocks below `17,233,000`) — a gap on the order of 9.4 million blocks, or roughly 9,400 windows at 1,000 blocks each. **Continuing one more adjacent descending window (Window 64, whether under that label or a corrected one) cannot resolve the historical-origin problem** — it is not remotely close to the fork boundary, and the negative balances the campaign is chasing are, per §2.2, attributable to ordinary incomplete post-fork TRANSFERS history, not to any fork-boundary issue. **This conclusion is correct under both the stale (Window 60/61) and the corrected (Window 63 completed, next range operationally Window 64) operational state** — the window-number discrepancy does not change it.

---

## 3. Current CoinPulse behavior (summary)

Every layer of the truth stack — raw ingestion, canonical ledger, materialized positions, pricing, PnL, HexMining stakes — currently treats `chainId: 369` as a single undifferentiated data space. A row observed at a candidate pre-fork block (e.g., `15,353,156`, per the task-provided investigation context — §2.1 flags this as unverified against production data) and a row observed at a verified post-fork block (e.g., `26,944,376`, the `observedAtBlock` recorded by the native active-stake live-verification run per D-031/PR #318) are stored, normalized, materialized, and would eventually be priced and valued identically, with no field anywhere recording which side of `lastInheritedBlock`/`firstPostForkBlock` (§6) the underlying event actually occurred on.

This is not a bug in any single service — it is the **absence of a policy layer** that no part of the stack was ever asked to implement.

---

## 4. Problem statement

CoinPulse's core value proposition (per `CLAUDE.md` and D-001) is a deterministic, auditable, rebuildable accounting engine. That guarantee currently has a silent gap: storing a row under `chainId: 369` does not, by itself, prove the row represents an event that PulseChain's own validators produced. It may equally represent inherited Ethereum history that PulseChain's fork copied wholesale into its genesis/early state and that the PulseChain RPC continues to serve indefinitely.

Without an explicit policy, three classes of harm are latent:

1. **Accounting harm** — a future PnL/cost-basis implementation could silently treat a 2022 Ethereum HEX stake as a 2022 PulseChain pHEX stake with PulseChain-native cost basis, producing a materially wrong economic answer with no warning.
2. **Identity harm** — pHEX (PulseChain-native, chain 369) and eHEX (Ethereum-native, chain 1) share a contract address by fork-copy convention but are economically and custodially distinct assets on distinct chains; nothing today prevents a future implementation from silently merging them.
3. **User-trust harm** — a user viewing "PulseChain transaction history" that silently includes untagged Ethereum-inherited rows would reasonably believe every listed event happened on PulseChain, when some did not.

---

## 5. Terminology

| Term | Definition |
|---|---|
| **`lastInheritedBlock`** | The highest PulseChain block number that represents copied Ethereum state, not independently PulseChain-produced state. A single, precisely named quantity — never referred to elsewhere in this document as an unqualified "the fork boundary block," to avoid the off-by-one ambiguity of a shared term that means different things in different sections. |
| **`firstPostForkBlock`** | Defined exactly as `lastInheritedBlock + 1`. The lowest PulseChain block number produced independently by PulseChain's own validators. |
| **Inherited Ethereum history** | Transactions, events, and state that occurred on Ethereum at or before `lastInheritedBlock` and are visible today through a PulseChain RPC only because PulseChain's genesis copied Ethereum's full state/history. |
| **Fork-opening state** | The balance and contract-storage snapshot that existed on PulseChain immediately after the fork/genesis transition rules and allocations were applied — the starting point for any *independently PulseChain* accounting, as distinct from both the Ethereum history that produced it and the first independent post-fork user transaction (§10 defines the exact observation-point requirement; it is not simply "a read at `lastInheritedBlock`"). |
| **Post-fork PulseChain activity** | Transactions, events, and state produced independently by PulseChain validators at or after `firstPostForkBlock`. |
| **pHEX** | The HEX-protocol token as it exists on PulseChain (`chainId: 369`, contract `0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`) — a distinct chain-scoped asset from eHEX despite sharing a contract address by fork-copy convention. |
| **eHEX** | The HEX-protocol token as it exists on Ethereum (`chainId: 1`) — out of CoinPulse's current V1/Phase-1 scope per D-009 and D-032, referenced here only to state the identity-separation rule. |
| **Provenance class** | A categorical label attached to an observation or ledger entry describing whether the underlying event is at or below `lastInheritedBlock` or at or above `firstPostForkBlock` — and with what confidence — per §7. |

**Comparator convention (binding throughout this document):** `blockNumber <= lastInheritedBlock` classifies as inherited; `blockNumber >= firstPostForkBlock` classifies as post-fork. Because `firstPostForkBlock = lastInheritedBlock + 1`, these two conditions are exhaustive and mutually exclusive — every block number satisfies exactly one. No section of this document uses a different comparator or an unqualified single "boundary block" term; every classification statement below is expressed against one of these two named quantities.

---

## 6. Fork boundary

**Canonical boundary definition (proposed):** the fork boundary is modeled as two named PulseChain block numbers, not a calendar date and not a single ambiguous "boundary block":

```text
lastInheritedBlock
firstPostForkBlock = lastInheritedBlock + 1
```

Calendar dates are unreliable for this purpose because block-production rate is not perfectly uniform and because timestamps alone cannot distinguish "an Ethereum block replayed at genesis" from "a PulseChain block produced independently around the same historical date" without also checking block number against `lastInheritedBlock`/`firstPostForkBlock`.

- **`lastInheritedBlock` (candidate value, pending Tier 1 verification):** the task's investigation context gives `17,233,000` as the point below which blocks are available through the PulseChain RPC. This document does **not** independently assert a final numeric value for `lastInheritedBlock` — it records the candidate pair `lastInheritedBlock = 17,232,999` / `firstPostForkBlock = 17,233,000` (i.e., treating the task-supplied `17,233,000` as the first post-fork block, one interpretation consistent with the investigation wording "blocks below `17,233,000` are available") as an **unresolved question requiring Tier 1 operator verification** (§21), not as an accepted constant. Neither this number nor its exact inclusive/exclusive placement was independently re-verified via live RPC access in this docs-only session, and no Tier 1 PulseChain source (`docs/pulsechain-authoritative-data-sources.md` §1) was consulted for it in this session. Any future implementation must confirm both the exact value and which side of it `17,233,000` itself falls on before using either constant.
- **Classification comparator (binding, no exceptions elsewhere in this document):**
  ```text
  blockNumber <= lastInheritedBlock   → ETHEREUM_INHERITED_HISTORY
  blockNumber >= firstPostForkBlock   → PULSECHAIN_POST_FORK
  ```
  Every section of this document that classifies a block number uses this exact comparator pair. No section defines `lastInheritedBlock` as anything other than the last block classified `ETHEREUM_INHERITED_HISTORY`, and no section defines `firstPostForkBlock` as anything other than the first block classified `PULSECHAIN_POST_FORK`. This resolves the single-shared-term ambiguity of an earlier draft of this document, where a lone "boundary block" was described inconsistently in different sections.
- **Timestamp and block-hash interpretation at or below `lastInheritedBlock` (proposed):** a block's `timestamp` and `blockHash` at or below `lastInheritedBlock` describe the **original Ethereum block** that PulseChain's genesis copied — they are not evidence of *when on PulseChain's own timeline* the event became visible (PulseChain did not exist yet). Any future implementation must document this explicitly wherever such a timestamp is surfaced, so it is never read as "this happened on PulseChain at this time."
- **Do not rely only on calendar dates (explicit constraint honored):** classification must be implemented as a block-number comparison against `lastInheritedBlock`/`firstPostForkBlock`. A calendar-date heuristic (e.g., "before PulseChain's 2023 mainnet launch") is an acceptable *sanity cross-check* only, never the primary classification mechanism, because block-timestamp data at or below `lastInheritedBlock` describes Ethereum's timeline, not PulseChain's.

---

## 7. Provenance model

Five provenance classes are defined, following repository naming conventions (`SCREAMING_SNAKE_CASE`, consistent with existing enums such as `PriceObservationRejectReason`, `PriceSourceType`, and `HexMiningUnsupportedStatus`):

| Class | Meaning |
|---|---|
| `PULSECHAIN_POST_FORK` | `blockNumber >= firstPostForkBlock` (§6). Produced by PulseChain's own validators. This is the only class eligible for ordinary PulseChain transaction-history, ledger, and (once implemented) PnL/cost-basis treatment without qualification. |
| `ETHEREUM_INHERITED_HISTORY` | `blockNumber <= lastInheritedBlock` (§6), for an observation returned by a PulseChain RPC and stored under `chainId: 369` — i.e., it is Ethereum-origin history that PulseChain's genesis copied and continues to serve. This is the class that today's ingestion silently mislabels as ordinary PulseChain activity. |
| `FORK_OPENING_STATE` | Not a transaction-level observation at all, and not classified by the `lastInheritedBlock`/`firstPostForkBlock` comparator — a distinct, separately-evidenced balance/contract-storage snapshot representing verified PulseChain state immediately after the fork/genesis transition rules were applied and before the first independent post-fork user transaction (§10). This class has no rows in any current CoinPulse table; it does not exist yet. |
| `ETHEREUM_CHAIN_HISTORY` | An observation independently sourced from an **actual Ethereum RPC/explorer** (`chainId: 1`), as opposed to Ethereum history replayed through a PulseChain RPC. CoinPulse does not ingest this today (Ethereum execution is out of V1 scope per D-009) — this class exists in the model so that a future eHEX/cross-chain implementation has a distinct label from `ETHEREUM_INHERITED_HISTORY`, which is specifically about PulseChain-served copies. |
| `UNKNOWN_OR_UNVERIFIED` | The observation's provenance relative to `lastInheritedBlock`/`firstPostForkBlock` has not been determined — for example, because those constants have not yet been confirmed against a Tier 1 source, or because a specific row's block number could not be resolved. Must be the default for any row ingested before this classification logic exists, and for any row where classification cannot be computed with confidence. |

**Explicit non-implication (required by the task):** storing a row under `chainId: 369` does **not**, by itself, prove `PULSECHAIN_POST_FORK` provenance. Today, every row in the database implicitly carries `chainId: 369` with no provenance class assigned at all — which this document treats as equivalent to `UNKNOWN_OR_UNVERIFIED`, not as an implicit `PULSECHAIN_POST_FORK` claim. Any future implementation must compute the provenance class explicitly from block number against the confirmed fork boundary, never infer it from `chainId` alone.

---

## 8. Asset identity

The following rules extend, and do not conflict with, the existing identity policy in `docs/token-identity-origin-plan.md` and D-005:

1. **eHEX (`chainId: 1`) and pHEX (`chainId: 369`) are distinct chain-aware assets.** Per the existing `assetId` convention (`chain:<chainId>:erc20:<address>`), pHEX's canonical identity is `chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39`; a hypothetical future eHEX identity would be `chain:1:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39` (same address, different `chainId`, different `assetId`). These must never be merged, aliased, or treated as fungible.
2. **Identical contract addresses across chains do not make them the same ledger asset.** This is already implied by `assetId = chainId + address` (D-005), but the fork-copy relationship makes the *temptation* to merge them stronger than for an unrelated same-address collision, because pHEX and eHEX genuinely share history up to the fork boundary. The policy is explicit: shared pre-fork history does not create shared post-fork identity.
3. **Pre-fork Ethereum HEX activity must not silently become Ethereum `chainId: 1` accounting inside the PulseChain ledger.** A row with `ETHEREUM_INHERITED_HISTORY` provenance stays under `chainId: 369` (because that is the chain the data is genuinely stored/ingested for) — it is not retroactively relabeled `chainId: 1`. Retagging it as Ethereum-chain data it was never actually ingested as would itself be a fabrication. Instead, its `chainId: 369` row carries an explicit `ETHEREUM_INHERITED_HISTORY` provenance marker so consumers know not to treat it as PulseChain-native.
4. **Native ETH and native PLS must never be merged.** CoinPulse's native-asset identity today is `chain:369:native:0x0…0` (PLS only); no native ETH identity exists in the codebase. This rule constrains any future cross-chain work: native-asset identities must remain chain-scoped exactly like ERC-20 identities, with no shared "native coin" bucket across chains.
5. **Fork-opening copies require explicit provenance.** If a future `FORK_OPENING_STATE` balance is ever persisted for pHEX (or PLS, or any asset), it must carry a provenance record distinct from both `ETHEREUM_INHERITED_HISTORY` and `PULSECHAIN_POST_FORK` — it is neither an Ethereum transaction nor a PulseChain-produced transaction; it is a snapshot fact about the chain's starting state (§10).

---

## 9. Transaction-history policy

Five policy dimensions were posed by the task; this document selects and justifies one composite target policy, consistent with the recommended direction and Option C (§16–17):

- **Retain as inherited historical evidence with explicit provenance:** Yes. `ETHEREUM_INHERITED_HISTORY` rows are never deleted, hidden from raw/audit storage, or relabeled — per D-001 and the existing "raw audit data is immutable evidence" rule (`CLAUDE.md`), and consistent with the general prohibition on deleting raw/ledger records (mark REORGED, never delete).
- **Exclude from normal PulseChain transaction history:** Yes, by default. A user-facing "PulseChain transaction history" view should default to `PULSECHAIN_POST_FORK` rows only, so that "PulseChain activity" means what it says.
- **Expose in a separate inherited-history section:** Yes. `ETHEREUM_INHERITED_HISTORY` rows should be visible to the user, but in a clearly labeled, separate surface (e.g., "Inherited Ethereum History" section), never interleaved silently into the primary PulseChain activity feed.
- **Allow them to support state reconstruction but not ordinary transaction analytics:** Yes. Inherited rows are essential *evidence* for computing fork-opening state (§10) — that is their primary future use — but must not feed ordinary post-fork transaction counts, "recent activity" widgets, or analytics that implicitly assume PulseChain-native timing.
- **Disallow them from PulseChain PnL/cost basis until fork-opening policy exists:** Yes, and this is currently moot in practice — PnL/valuation are already `unsupported`/`unavailable` project-wide per D-034 and the guardrails doc, independent of fork-state policy. This document adds the explicit rule that even once PnL is implemented, an `ETHEREUM_INHERITED_HISTORY` event must not feed PulseChain-native cost basis without a resolved fork-opening-state policy and, separately, without treating it as though it were a PulseChain-native disposal/acquisition event with PulseChain-native pricing (which does not exist for a pre-fork timestamp).

**Explicit non-action (required by the task):** this policy does not delete, hide, or relabel any row that exists in the database today. No such action occurs in this PR, and any future implementation PR must not silently reclassify existing evidence. The correct sequence (§19) is: an additive provenance field is added to storage, defaulting to `UNKNOWN_OR_UNVERIFIED` for all existing rows at the moment the field is added (Phase 3); the **read-only** Phase 2 audit only *identifies and counts* which existing rows would classify as `ETHEREUM_INHERITED_HISTORY`/`PULSECHAIN_POST_FORK` under `lastInheritedBlock`/`firstPostForkBlock` and produces a reviewable report — it performs no writes and does not itself change any row's provenance value; the actual write that backfills those rows' provenance field from `UNKNOWN_OR_UNVERIFIED` to a computed class happens only in the later, controlled Phase 8 migration, after the Phase 2 audit's findings have been reviewed.

---

## 10. Fork-opening state

CoinPulse does not currently model fork-opening state for any asset. This section defines whether it needs to, and what evidence it would require — it does not fabricate any figure.

**Does CoinPulse need explicit opening-state records?** Yes, conceptually, for every asset class where post-fork accounting (balances, PnL, cost basis) is intended to be accurate for a wallet that was active before the fork:

- **Native PLS:** Yes. A wallet's PLS balance at the fork boundary is the correct starting point for post-fork native-PLS accounting; without it, post-fork balance deltas alone cannot reconstruct an accurate running balance for a pre-fork wallet.
- **PRC-20 balances (including pHEX):** Yes, for the same reason — a token balance at the fork boundary is the necessary starting point.
- **HEX stakes copied through the fork:** Yes — an active HEX stake that existed on Ethereum at the fork boundary and continued (or was later closed) on PulseChain needs its starting principal/shares/lockedDay recorded as fork-opening evidence, not re-derived from a PulseChain-only START event that never occurred (the actual `StakeStart` event, if any, happened on Ethereum pre-fork).
- **LP tokens:** Conceptually yes, if any PulseX (or fork-inherited) LP position existed at the fork boundary — though this is likely a much smaller practical surface than native/PRC-20/stake balances, since PulseX itself is a PulseChain-native protocol launched after the fork, not a fork-copied contract with pre-existing liquidity.
- **Protocol positions / contract-storage-derived positions generally:** Yes, as a general category — any position whose current state depends on contract storage that existed before the fork needs the same opening-state treatment as the specific asset classes above.

**Conceptual source of truth and the exact required observation point (corrected — do not read state at `lastInheritedBlock`):** Fork-opening state is not something CoinPulse can compute from its own ledger, because CoinPulse's ledger only begins accumulating PulseChain-scoped evidence from whenever ingestion started — it is not itself the source of truth for "what existed at the fork boundary." It is also **not** simply a state read at `lastInheritedBlock` — a read at that block returns the **inherited pre-transition Ethereum state**, before PulseChain's fork/genesis transition rules and any PulseChain-specific allocations were applied. That inherited snapshot is not proven to equal PulseChain's actual opening state.

The required observation point is instead the verified PulseChain state that exists:

1. **after** all fork/genesis transition rules and allocations have been applied by PulseChain's own genesis process, and
2. **before** the first independent post-fork user transaction (i.e., before or at `firstPostForkBlock`, prior to any state-changing transaction within it) could have altered that state.

A future implementation must either (a) identify a specific, provably-correct PulseChain RPC block number or tag whose state-read semantics satisfy both conditions above, with the proof itself Tier 1-verified and documented (not assumed from convenience or from the fact that a tag is *named* "genesis" or similar), or (b) if no such provably-correct read point can be established, treat fork-opening state as **unavailable** rather than approximate it from `lastInheritedBlock` or any other unproven read point. This read, once identified, must be a Tier 1 PulseChain RPC/state-read at that exact, proven block/tag (analogous in mechanism to the existing `stakeLists` at `endBlockNumber - 1` pattern already used in `ended-stake-historical-state-recovery.ts` for a different, already-correct purpose — but the fork-opening read point is a different moment in time and requires its own proof, not a reuse of that specific offset) — not re-derived from Ethereum mainnet data, and not assumed from any documentation, blog post, or third-party claim about "what PulseChain copied."

**Native PLS — explicit non-assumptions (required by the task):**

- Do **not** assume a wallet's inherited ETH balance (as read from state at or below `lastInheritedBlock`) equals its opening PLS balance. PulseChain's fork/genesis transition may have applied allocations, adjustments, or rules that change balances beyond a literal 1:1 copy; nothing in this document or the current codebase proves a 1:1 mapping, and none should be assumed.
- Do **not** assume that copied Ethereum state alone captures PulseChain-specific allocations or transition changes — the transition process itself is a fact about PulseChain's genesis rules, not about Ethereum's pre-fork state, and must be sourced from PulseChain, not inferred from the Ethereum side.
- Do **not** authorize synthetic opening balances of any kind — not from Ethereum-state copying, not from estimation, not from a third-party claim.
- **If no currently available RPC block/tag is proven to represent the exact post-transition, pre-first-independent-transaction moment**, fork-opening state for native PLS (and, by the same reasoning, for any other asset class in this section) must remain `unavailable`, and any accounting that would depend on it must remain blocked rather than substituted with an unproven approximation.

**Explicit non-fabrication (required by the task):** this document does not propose, estimate, or record any fork-opening balance for any wallet or asset. No such figure exists anywhere in this PR. A future implementation PR must obtain fork-opening state exclusively through the proven observation point described above — never through inference, estimation, a read at `lastInheritedBlock` presented as if it were post-transition state, or a third-party balance snapshot service.

---

## 11. Ledger/materialization implications

Future implementation must distinguish the following evidence classes explicitly, rather than folding them into one undifferentiated ledger stream as today:

- **Inherited transaction evidence** (`ETHEREUM_INHERITED_HISTORY`) — persisted as raw audit evidence (already happens today, just unlabeled); usable to help reconstruct fork-opening state; not itself a canonical PulseChain ledger entry.
- **Opening-state evidence** (`FORK_OPENING_STATE`) — **must remain inside canonical ledger truth, not create a second, parallel accounting source.** Option C's own decision (§17.4) is that post-fork accounting is built from "fork-opening state plus post-fork activity" — that composition only works cleanly if a canonical ledger replay (the mechanism materialization already uses today) naturally includes the opening contribution. The target model is therefore: the verified, Tier 1-sourced opening-state read (§10) is persisted as immutable raw/source evidence first, and from it CoinPulse derives exactly one **deterministic canonical opening-balance `LedgerEntry`** (or an equivalent canonical ledger event, if a future schema review finds `LedgerEntry`'s existing shape cannot represent a point-in-time opening credit without a schema change — but the target stays *inside* the canonical ledger table/model, not a sibling table read by a separate code path). This canonical opening entry:
  - is derived only from verified `FORK_OPENING_STATE` evidence, never fabricated or estimated (§10);
  - is chain-aware and asset-specific, exactly like any other `LedgerEntry` (`chainId` + `assetId`);
  - carries `FORK_OPENING_STATE` provenance, distinguishing it from an ordinary `TRANSFER`/`SWAP`/other entry type — it is not an ordinary transfer and must not be classified, counted, or displayed as one;
  - is idempotent/non-duplicable per wallet+asset, exactly like existing ledger entries use deterministic IDs and `skipDuplicates` (per `docs/transfer-history-backfill-operator-plan.md` fact 7's existing pattern) — at most one canonical opening entry may exist per wallet+asset;
  - is included deterministically in every rebuild: because materialization already replays the *entire* wallet ledger regardless of rebuild range (`docs/transfer-history-backfill-operator-plan.md` fact 10, verified against `src/services/portfolio/materialize-positions.ts`), a canonical opening `LedgerEntry` requires **no new materialization code path** — the existing full-ledger replay already includes it once it is persisted as an ordinary (if specially-provenanced) ledger row;
  - remains `unavailable` — never zero, never estimated — for any wallet/asset where verified opening-state evidence per §10 does not yet exist; a materialization pass for such a wallet/asset must carry an explicit coverage warning (§14) rather than silently omitting the opening contribution.

  **This is the only target architecture recommended by this document.** A future implementation PR should not introduce a second, ledger-external accounting source (e.g., a separate "opening balance" table that materialization reads independently of the ledger) without first revising this document's decision and explicitly specifying how every rebuild would deterministically include that external source — this document does not propose or endorse that alternative.
- **Post-fork canonical transactions** (`PULSECHAIN_POST_FORK`) — today's existing `LedgerEntry` model, unchanged in mechanics, but explicitly labeled as this provenance class going forward.
- **Current live state** — the existing fast-path live snapshot (`assembleLiveHoldingsSnapshot()`, per D-035) reads current on-chain balances directly; this is independent of fork-state policy and already correct regardless of provenance, since it reads the chain's *current* state rather than reconstructing history.
- **Materialized historical balances** (`PortfolioTokenBalance`, `PortfolioStakePosition`, etc.) — the open question this document flags but does not resolve: should materialization for a pre-fork-active wallet start from `FORK_OPENING_STATE` plus post-fork ledger deltas, or continue to be computed purely from whatever ledger entries happen to be ingested (which today may or may not include pre-fork rows depending on backfill coverage)?

**Whether pre-fork debits may affect post-fork balances without an explicit opening-state entry (explicit answer required by the task):** **No, not safely, and this is the central risk this document is written to name.** If a pre-fork `ETHEREUM_INHERITED_HISTORY` outflow is swept into the canonical ledger as an ordinary `LedgerEntry` (which is exactly what happens today, unlabeled, whenever a TRANSFERS backfill window reaches far enough back), it will decrement a materialized balance computed purely from ledger deltas — without any corresponding fork-opening-state credit to balance it. This is a structurally identical failure mode to the negative-balance problem already documented for incomplete TRANSFERS history: a debit is recorded whose matching credit was never ingested. Until fork-opening state exists as a distinct, explicit evidence type, **materialization for any wallet with pre-fork activity should be treated as incomplete-by-construction below the fork boundary**, and any negative balance whose earliest contributing entry has `ETHEREUM_INHERITED_HISTORY` provenance should carry a distinct warning reason from an ordinary missing-transfer negative balance, since the two require different remediation (fork-opening-state recovery vs. TRANSFERS backfill).

---

## 12. PnL/yield/cost-basis implications

These rules bind any future PnL/yield/cost-basis implementation and are additive to, not a replacement for, `docs/pnl-accounting-guardrails.md`:

- **No PnL from forked assets without approved opening-value/cost-basis policy.** An asset with any `ETHEREUM_INHERITED_HISTORY` or `FORK_OPENING_STATE` evidence in its history must not produce a PnL figure until a dedicated, evidence-backed fork-opening cost-basis decision (analogous in rigor to D-034 for pDAI pricing) is accepted.
- **No assumed Ethereum cost basis copied into PulseChain.** Even if a wallet's Ethereum-side eHEX acquisition cost basis were somehow known, it must not be assumed to transfer 1:1 into pHEX cost basis without an explicit decision — the two are distinct assets on distinct chains (§8), and "the same wallet held the same-address token before and after the fork" is not itself evidence of what cost-basis treatment is correct or desired.
- **No zero-cost assumption.** A fork-inherited position must never default to a zero acquisition cost merely because CoinPulse lacks PulseChain-native acquisition evidence for it — that would fabricate a maximally-favorable (or unfavorable) PnL figure from an absence of data, which D-007/D-008 and the guardrails doc already prohibit in general and which applies with particular force here.
- **No frontend inference.** Consistent with D-001/D-004, no fork-boundary classification, opening-state estimate, or fork-aware cost-basis figure may ever be computed in frontend code — this is backend-only, exactly like every other accounting value in CoinPulse.
- **Provenance and coverage must be visible.** Any future PnL DTO field touching a fork-affected asset must expose its provenance class and an explicit coverage/status flag (consistent with the existing `pnlCoverage`, `pnl.status` vocabulary in the guardrails doc), not silently blend fork-affected and fork-unaffected assets into one aggregate figure without distinction.
- **Unsupported and unavailable must not become zero.** Exactly as already established project-wide (D-007, D-008, §6.4 of the guardrails doc) — a fork-blocked PnL figure is `null`/`unsupported`, never `$0.00`.

---

## 13. HexMining implications

This section addresses native pHEX stakes specifically and **does not alter the existing native pHEX Phase 1 scope** (D-032, D-033).

- **Pre-fork Ethereum stake events:** A `RawStakeAction` START record with `blockNumber <= lastInheritedBlock` represents a stake that was actually opened on Ethereum, not PulseChain. Under this policy, such a START record's provenance is `ETHEREUM_INHERITED_HISTORY`, not `PULSECHAIN_POST_FORK`.
- **Copied active stake state:** A stake opened at or below `lastInheritedBlock` that was still active at the fork/genesis transition, and that PulseChain's genesis therefore continued as a live position, is a direct instance of `FORK_OPENING_STATE` (§10) applied to the HexMining domain — its `lockedDay`/`stakeShares`/principal as of the verified post-transition observation point (§10, not a raw read at `lastInheritedBlock`) are the correct opening evidence, not its original Ethereum `StakeStart` parameters reinterpreted as PulseChain-native.
- **Post-fork stake lifecycle:** A stake started and/or ended entirely at `blockNumber >= firstPostForkBlock` requires no special fork-state handling beyond the existing native pHEX pipeline (D-032/D-033) — it is fully `PULSECHAIN_POST_FORK`.
- **Ended stake history:** The two committed test-fixture stakes at blocks `15,353,156` and `15,767,882` (§2.1) are exactly the case this section describes — if real, they represent stakes whose *start* evidence is pre-fork Ethereum history, inherited and stored under `chainId: 369` today with no marker. The existing ended-stake pipeline (D-028 Supersession Note, D-032, D-033) already recovers `lockedDay`/`stakeShares` from historical contract-state reads; this policy does not change that mechanism — it adds the requirement that the *resulting* observation also carry a provenance class reflecting whether its underlying START evidence was pre-fork or post-fork.
- **Distinction from eHEX staking:** A pre-fork HEX stake inherited into PulseChain's genesis is not the same thing as an eHEX stake that remains on Ethereum today and was never inherited — the former is in-scope PulseChain state (with `ETHEREUM_INHERITED_HISTORY`/`FORK_OPENING_STATE` provenance on its origin evidence); the latter is out-of-scope Ethereum chain-1 data entirely (D-009), consistent with the eHEX-is-later-phase rule in D-032.
- **Historical context vs. PulseChain user action:** Inherited pre-fork stake-start events should be presented (once any such UI exists) as historical context explaining a stake's origin, not as if the user personally executed a PulseChain transaction to start that stake — because they did not; the transaction that started it was an Ethereum transaction that PulseChain's fork copied.

**Explicit non-change:** this section does not reopen, expand, or modify D-032/D-033's native-pHEX-only Phase 1 scope, does not touch HSI/HTT/eHEX, and does not change any currently-shipped stake discovery, recovery, or reader code.

---

## 14. Backfill implications

- **Should global TRANSFERS backfill cross the fork boundary?** Not without an additional, explicit gate beyond what exists today. The current backfill plan (`docs/transfer-history-backfill-operator-plan.md`) already requires per-window contamination checks and explicit product-owner approval per window; this policy adds that **any window whose block range includes blocks at or below the fork boundary must additionally be gated on fork-opening-state readiness for the affected wallet/assets** — because, per §11, sweeping pre-fork debits into the canonical ledger without a matching fork-opening-state credit reproduces the exact negative-balance failure mode the backfill campaign already exists to fix, just from a different cause.
- **What additional gate is required before it does?** A fork-boundary check on every proposed backfill window: if `[startBlock, endBlock]` includes any block `<= lastInheritedBlock`, the window must not be submitted for execution through the **current** sync pipeline until both (a) `lastInheritedBlock`/`firstPostForkBlock` are Tier 1-confirmed (§6, §21) and (b) verified fork-opening-state evidence (§10) exists for the wallet/assets the window would affect. **There is currently no available exception to this gate.** Verified against `src/services/sync/sync-orchestrator.ts` and `sync-common.ts` (§2.2): the existing pipeline has exactly one mode, and it always proceeds raw ingestion → normalization → canonical ledger persistence (`skipDuplicates`-idempotent, but still a canonical-ledger write) for every block in a submitted window — there is no "evidence-gathering only" mode today that fetches and persists raw rows without also normalizing them into the ledger. A hypothetical *future* raw-only ingestion mode (§19 Phase 9) — one that persists raw evidence but performs no normalization, creates no `LedgerEntry` rows, advances no `SyncCursor`, and triggers no materialization — could in principle be granted a narrower, explicitly product-owner-approved exception to cross `lastInheritedBlock` for evidence-gathering purposes once it exists, is implemented, and is itself verified to have no accounting-side effect. That mode does not exist today and this document does not authorize building or using it in this PR.
- **Do pre-fork ranges need separate policy labels?** Yes — per §7, any raw evidence ingested from a pre-fork block range should be labeled `ETHEREUM_INHERITED_HISTORY` at ingestion time (once implemented), not left to default `UNKNOWN_OR_UNVERIFIED` indefinitely once the classification logic exists.
- **Must materialization stop at the boundary until opening state exists?** For any wallet with confirmed or suspected pre-fork activity, yes — per §11, materialization computed purely from ledger deltas is unsafe below the fork boundary without an opening-state credit. This does not mean materialization must halt project-wide; it means a fork-boundary-crossing wallet's materialized balances should carry an explicit warning (or degraded-confidence status) until opening-state evidence exists for it, consistent with the project's "never silently coerce to a clean number" principle.
- **Why the next campaign window (operationally Window 64, per §2.3's verified evidence — repository docs still say Window 60/61 and are stale) is unrelated to the historical origin of the current negative balances:** As established in §2.3, the campaign's verified current position (Window 63 completed at block range `26,634,999–26,635,998`, next adjacent descending range `26,633,999–26,634,998`) sits roughly 9.4 million blocks — on the order of 9,400 further 1,000-block windows — above the task-supplied pre-fork/inherited-history boundary region (`17,233,000`). Submitting one more adjacent window cannot reach, and was never claimed to reach, that region. The current negative balances are therefore attributable to **ordinary incomplete post-fork TRANSFERS history** (missing inflows within the already-backfilled, entirely post-fork range), not to any fork-boundary or pre-fork-provenance issue — those two problems are independent and must not be conflated. **No window executed to date, under either the stale or corrected numbering, has approached, let alone crossed, the fork boundary.**

**This document does not approve or execute any window, including the next adjacent range (operationally Window 64).** No backfill action is taken or authorized by this PR. The Window 60/61 references in `docs/ai-handoff.md`, `docs/project-decisions.md`, and the runbooks are stale relative to verified operator/database evidence (§2.3) and require a later, separate, bounded documentation-synchronization PR — not performed here.

---

## 15. API/UI implications

Target metadata concepts for future DTOs (field names not finalized, per task instruction — existing repository DTO conventions such as `schemaVersion`, `status`, `warnings`, `provenance` per D-008 should govern the eventual naming):

- **Origin/provenance class** — one of the five values in §7 (`PULSECHAIN_POST_FORK`, `ETHEREUM_INHERITED_HISTORY`, `FORK_OPENING_STATE`, `ETHEREUM_CHAIN_HISTORY`, `UNKNOWN_OR_UNVERIFIED`).
- **Observed chain** — the `chainId` the row is actually stored/queried under today (currently always `369`).
- **Source chain** — the chain the underlying event actually originated on, which may differ from "observed chain" for `ETHEREUM_INHERITED_HISTORY` rows (source chain conceptually `1`, observed chain `369`).
- **Block number** — already present in raw/ledger evidence; would be the input to provenance-class computation, not a new field.
- **Inherited/fork flag** — a simpler boolean derivable from provenance class, useful for quick UI filtering (e.g., "hide inherited history" toggle) without requiring every consumer to enumerate the full class list.
- **Coverage status** — whether fork-opening-state evidence exists for the affected wallet/asset (relevant to whether materialized balances below the boundary should be trusted).
- **Warning** — a distinct warning code (e.g., a class parallel to the existing `negative-token-balance:<assetId>:<qty>` and `hexmining-ended-stake-lockedday-unknown` patterns) for fork-boundary-related incompleteness, distinguishable from ordinary TRANSFERS-incompleteness warnings per §11/§14.
- **PnL eligibility** — an explicit flag/status (consistent with existing `pnl.status` vocabulary) indicating whether an asset's PnL is blocked specifically by unresolved fork-state policy, as distinct from being blocked by ordinary pricing/ledger-coverage gaps.
- **Cost-basis eligibility** — likewise, a status distinguishing "cost basis blocked by missing fork-opening evidence" from other existing cost-basis blockers (`INSUFFICIENT_COST_BASIS`, etc., per the guardrails doc).

**This document finalizes no field names, no DTO shape, and no schema.** Per D-008/D-012, any concrete DTO/schema change is its own bounded, tested, reviewed future PR.

---

## 16. Options considered

### Option A — Include inherited history in the PulseChain ledger

Treat every row returned by the PulseChain RPC as ordinary PulseChain ledger truth, regardless of block number relative to the fork.

- **Benefits:** Simplest to implement — no new classification logic, no new evidence type, matches current (accidental) behavior. Maximizes apparent transaction-history completeness for pre-fork-active wallets.
- **Risks:** This is the status quo, and the status quo is exactly the gap this document exists to close. It silently misrepresents Ethereum history as PulseChain activity, risks fabricated future PnL/cost-basis figures for fork-inherited assets, and cannot distinguish a genuine post-fork debit from a pre-fork one for negative-balance diagnosis (§11, §14) — indistinguishable from the negative-balance problem the project is already fighting, but now with an additional, un-diagnosable root cause mixed in.

### Option B — Fork-opening state plus post-fork history only

Discard/exclude inherited Ethereum history entirely from CoinPulse's ledger and DTOs; only persist and expose fork-opening state (as a single snapshot) plus everything after it.

- **Benefits:** Cleanest accounting model going forward — every ledger entry is unambiguously post-fork; no risk of pre-fork evidence contaminating post-fork analytics.
- **Risks:** Violates the project's immutable-raw-evidence principle (D-001, `CLAUDE.md` "raw audit data is immutable evidence... never delete") if it requires deleting or refusing to persist already-ingested inherited rows. Also destroys legitimately useful audit/context evidence (e.g., knowing that a stake originated pre-fork is useful historical context even if it doesn't feed PulseChain-native PnL) and makes fork-opening-state evidence *harder*, not easier, to construct later, since the very inherited transactions needed to reconstruct opening state (§10) would be discarded rather than retained.

### Option C — Dual-view evidence model

Inherited history is retained as immutable evidence with explicit provenance; post-fork ledger/materialization/PnL starts from explicit fork-opening state plus post-fork activity; inherited history is exposed separately, never silently blended into ordinary PulseChain transaction history or accounting.

- **Benefits:** Satisfies immutable-evidence retention (no data loss, no violation of D-001). Keeps ordinary PulseChain accounting clean and auditable by construction, since fork-opening state plus post-fork deltas is a well-defined, reconstructable accounting basis. Preserves the ability to show users honest historical context (inherited history) without misrepresenting it as PulseChain-native activity. Aligns with the project's existing two-layer product framing from D-035 (fast live-state path vs. historical enrichment path) — inherited-history-as-context vs. post-fork-ledger-as-accounting-truth is a structurally similar separation.
- **Risks:** Most implementation work of the three options — requires a new evidence type (`FORK_OPENING_STATE`), a new provenance field threaded through raw/ledger/materialization/DTO layers, and a Tier 1-verified fork-boundary constant before any of it can be computed correctly. Until fork-opening-state evidence actually exists for a given wallet, that wallet's post-fork-only accounting is *conservatively incomplete* (shows a coverage warning) rather than *complete* — this is the correct, safe failure mode per the project's "unsupported is safer than misleading" principle (§11.1 of the guardrails doc), but it does mean some wallets will show visibly incomplete state for a period after this policy is adopted, until opening-state recovery work is done for them.

### Recommendation

**Option C is recommended.** It is the only option consistent with all of: immutable raw-evidence retention (D-001), the project's "unknown/unsupported is safer than misleading" principle (guardrails doc §11.1, D-007), chain-aware asset identity (D-005, §8 above), and the existing two-layer live/historical product framing already accepted in D-035. Option A perpetuates the exact silent-misclassification gap this document exists to close. Option B destroys evidence and principle-conflicts with D-001. The higher implementation cost of Option C is the correct tradeoff for an accounting engine whose stated purpose (`CLAUDE.md` §1) is "correctness, auditability, and rebuildability — not rapid feature expansion."

This recommendation matches the "recommended direction to evaluate" supplied in the task, verified against the repository rather than accepted automatically: the repository's existing architecture (immutable raw evidence, explicit status/warning vocabulary, D-035's live/historical split) independently supports the same conclusion.

---

## 17. Decision

**Selected option: Option C — dual-view evidence model.**

1. Inherited Ethereum history (`ETHEREUM_INHERITED_HISTORY`) is retained as immutable raw/audit evidence, exactly as today's ingestion already does — with the addition of an explicit provenance classification once implemented (§19).
2. Fork-opening state (`FORK_OPENING_STATE`) is a new, separately-evidenced concept that does not exist in CoinPulse today. It must be sourced only from a Tier 1-verified, proven post-transition/pre-first-independent-transaction state read (§10) — never from a raw read at `lastInheritedBlock`, never fabricated, estimated, or inferred — and, once verified, represented as a **deterministic canonical opening-balance `LedgerEntry`** so it participates in the existing full-ledger replay materialization already performs (§11), rather than as a second, ledger-external accounting source.
3. Post-fork PulseChain activity (`PULSECHAIN_POST_FORK`) remains the existing canonical ledger model, unchanged in mechanics, with an added provenance label.
4. Portfolio/PnL/yield, once implemented for any fork-affected asset, must be based on fork-opening state plus post-fork activity — never on inherited pre-fork ledger entries treated as though they were post-fork PulseChain-native transactions (§12).
5. This decision does not change any code, schema, test, DTO, or route in this PR. It establishes the target architecture that future bounded PRs (§19) must follow.

---

## 18. Non-goals

This document, and the PR that delivers it, do **not**:

- Modify source code, tests, or Prisma schema/migrations.
- Modify database state.
- Execute sync, rebuild, backfill, or repair operations.
- Repair negative balances.
- Implement PnL, valuation, or yield.
- Implement DeFi/LP fork-state handling beyond the conceptual note in §10.
- Change frontend behavior.
- Merge eHEX and pHEX identity, or implement any eHEX ingestion.
- Reopen or expand HexMining Phase 1 scope (D-032/D-033 stand unchanged).
- Confirm the exact fork-boundary block number as production fact — `17,233,000` is treated as an unresolved question pending Tier 1 verification (§21), not as an accepted constant.
- Approve or execute any TRANSFERS backfill window.

---

## 19. Implementation phases

Each phase below is a separate, bounded future PR. None is implemented by this PR. The sequence is ordered so that **no phase depends on storage, schema, or an evidence type that an earlier phase has not already created** — this reorders and clarifies the roadmap from an earlier draft of this document, where a "wire ingestion to persist provenance" phase implicitly assumed a persisted provenance column that no preceding phase had actually added.

1. **Tier 1 fork-boundary verification and pure classification helper/types.** An operator confirms `lastInheritedBlock`/`firstPostForkBlock` against a Tier 1 PulseChain source (§6, §21). In the same or an immediately following PR, add the five-value provenance enum (§7) as a backend-only TypeScript type (and, if needed, a Prisma enum literal — enum *values*, not yet a persisted *column*) plus a pure function that classifies a block number against the confirmed constants. No ingestion, ledger, storage, or DTO wiring yet — types and a helper only, with unit tests covering boundary edge cases (`blockNumber == lastInheritedBlock`, `blockNumber == firstPostForkBlock`, one below, one above).
2. **Read-only audit of existing pre-fork/inherited rows.** A read-only operator script/query (no writes) that applies Phase 1's classification helper to report how many existing raw/ledger rows across all tables would classify as `ETHEREUM_INHERITED_HISTORY` vs. `PULSECHAIN_POST_FORK`, for which wallets/assets — with no mutation of any kind. Output is an evidence report only: it identifies and counts candidate rows and may recommend a migration mapping; it does **not** write provenance, update rows, backfill fields, or reclassify any persisted data. Any actual write happens later, in Phase 8, after this audit's findings are reviewed.
3. **Additive provenance storage foundation.** A schema migration (additive only, per `AGENTS.md` "keep schema migrations minimal and additive") that adds the provenance field(s) — nullable or `UNKNOWN_OR_UNVERIFIED`-defaulted, never a required field with no safe default — to the relevant raw/ledger tables. This phase creates the column(s); it does **not** populate them for existing rows (that is Phase 8) and does **not** yet wire any ingestion code to write to them (that is Phase 4). Existing rows read `UNKNOWN_OR_UNVERIFIED` (or the schema default) immediately after this migration, by construction.
4. **Wire new ingestion to persist provenance.** Update ingestion (staking, transfer, and any other raw-evidence-writing path) to compute and persist a provenance value — using Phase 1's helper and Phase 3's storage — for every **newly** ingested row going forward. This phase only affects rows ingested after it ships; it does not touch already-persisted rows (still Phase 8's responsibility).
5. **Verified fork-opening evidence model and canonical opening ledger entry.** Service-layer implementation of the §10 proof-based observation-point requirement (verified post-transition, pre-first-independent-transaction state read) and the §11 canonical-ledger-entry model: persist the verified opening-state read as immutable raw evidence, then derive a deterministic, chain-aware, non-duplicable canonical opening-balance `LedgerEntry` (provenance `FORK_OPENING_STATE`) from it. This phase is itself likely large enough to warrant its own sub-decision before implementation, given the schema/migration and truth-hierarchy weight (§11's "no second accounting source" constraint applies here).
6. **API/DTO provenance and eligibility fields.** Add provenance/coverage/eligibility fields to relevant DTOs (transactions, portfolio balances, HexMining stakes) per §15's target concepts, as additive fields with their own schema-version bump and route contract tests, per D-008/D-012. Depends on Phases 3–5 existing so there is real backend data to expose.
7. **UI inherited-history and fork-opening warnings.** Add the separate "inherited history" surface and coverage warnings to relevant frontend screens, consuming only the new DTO fields from Phase 6 — no frontend computation, per D-004.
8. **Controlled migration/backfill of existing rows.** Using Phase 2's audit findings and Phase 3's storage, a bounded, reviewed migration (its own document, with rollback plan and duplicate/invariant gates) that writes computed provenance values onto already-ingested rows that currently read `UNKNOWN_OR_UNVERIFIED`. This is the first phase in the sequence that performs a write to existing data, and it requires all of: Phase 2's audit evidence, an accepted fork-boundary policy, Phase 3's schema readiness, an explicit rollback plan, and duplicate/invariant checks before execution.
9. **Backfill boundary gates, and optional future raw-only evidence-gathering mode.** Wire the fork-boundary gate described in §14 into the TRANSFERS backfill tooling/runbook, so that a window with `blockNumber <= lastInheritedBlock` is mechanically blocked from the accounting-impacting sync pipeline (not just documented as a manual check) until fork-opening-state readiness (Phase 5) is confirmed for the affected wallet. Optionally, and only as later, separately-scoped work within this same phase number: design and implement a genuinely raw-only ingestion mode (persists raw evidence, performs no normalization, creates no `LedgerEntry`, advances no `SyncCursor`, triggers no materialization), verify it has no accounting-side effect, and only then allow it — with explicit product-owner approval per §14 — to cross `lastInheritedBlock` for evidence-gathering purposes. This raw-only mode does not exist today (§14) and is not authorized for use until it is implemented and verified.
10. **Controlled rebuild/rematerialization and post-migration verification.** After Phase 8's migration, run rebuild for affected wallets so materialization reflects the newly available provenance and (where Phase 5 has supplied it) the canonical opening-balance entry; wallets still lacking Phase 5 evidence continue to carry the explicit coverage warning from §11/§14 rather than a silently-omitted opening contribution. Verify post-migration state against the Phase 2 audit's expected counts. This is explicitly the point where "repair negative balances" work would eventually connect, but that connection remains out of scope for this document.
11. **PnL/cost-basis eligibility.** Wire the new provenance/coverage status into the PnL engine's eligibility gating (analogous to `INSUFFICIENT_COST_BASIS`), once PnL itself is otherwise ready to be implemented per the guardrails doc's sequence, and once Decision 10's cost-basis-option choice (§2.2, §21) has been separately resolved — this phase is downstream of, and blocked by, both that broader PnL readiness work and Decision 10, not a shortcut around either.

---

## 20. Migration and safety risks

- **Schema risk:** Phases 3 and 5 above involve additive schema changes (new columns for provenance; new tables/columns and a new canonical `LedgerEntry` provenance value for fork-opening state). Additive-only per repository convention (`AGENTS.md` "Keep schema migrations minimal and additive unless explicitly required") — no destructive migration is proposed anywhere in this document.
- **Backfill-classification risk:** Phase 2's read-only audit could reveal a much larger or smaller pre-fork evidence footprint than expected; this document makes no assumption about that footprint's size.
- **Migration-write risk:** Phase 8 is the first phase that writes to existing rows; it must not proceed without Phase 2's audit evidence, an accepted fork-boundary policy, and an explicit rollback plan, per §19's dependency ordering.
- **Materialization-warning risk:** Phase 10, once implemented, will likely cause some currently-"clean-looking" materialized balances (wallets with pre-fork activity that happen not to currently show negative balances) to newly display a coverage warning — this is a correct, intended behavior change (surfacing previously-hidden incompleteness), not a regression, but should be communicated as such when that phase ships.
- **RPC/Tier-1-verification risk:** The entire fork-boundary constant (§6) depends on an operator confirming it against a Tier 1 PulseChain source or direct RPC query; until that happens, no phase 1+ implementation can compute a correct classification, only a placeholder.
- **Scope-creep risk:** Given the breadth of this policy (touches ingestion, ledger, materialization, pricing, PnL, HexMining, DTOs, UI), the greatest execution risk is treating any single future phase as bigger than one bounded PR (D-012). Each phase above is written to be independently implementable and independently reviewable.

---

## 21. Open questions

1. **Is `17,233,000` the correct fork-boundary block?** Not independently confirmed in this session (no live RPC access, docs-only scope). Requires operator verification against a Tier 1 PulseChain source (`rpc.pulsechain.com`, `scan.pulsechain.com`, or PulseChain's own documented genesis parameters) per `docs/pulsechain-authoritative-data-sources.md`.
2. **When should `docs/ai-handoff.md`, `docs/project-decisions.md`, `docs/wallet-scoped-historical-sync-runbook.md`, and `docs/transfer-history-backfill-operator-plan.md` be updated to replace the stale "Window 60 paused / Window 61 gated" text with the verified current state (Window 63 completed at `26,634,999–26,635,998`; next adjacent descending range `26,633,999–26,634,998` operationally Window 64; not yet executed)?** This is a required follow-up documentation-synchronization task, explicitly out of scope for this PR (§2.3, §18). The structural conclusion in this policy (current backfill progress is millions of blocks from the fork boundary) holds under either the stale or corrected figures and does not depend on that synchronization happening first.
3. **Did the two test-fixture stake blocks (`15,353,156`, `15,767,882`) originate from real production data, or are they synthetic test fixtures only?** This session confirmed they exist in committed test files; it did not confirm whether they also correspond to real production `RawStakeAction` rows for a tracked wallet.
4. **What is the practical scope of pre-fork LP/protocol positions, if any?** §10 treats this as conceptually in-scope but flags that PulseX itself is a post-fork protocol, so the practical surface may be small or empty — unresolved without an operator audit (Phase 2, §19).
5. **Where should the fork-boundary constant live once confirmed?** (e.g., alongside `PULSECHAIN_REFERENCE` in `src/config/chains.ts`, or a new dedicated config module) — a phase-1 implementation decision, not resolved here.
6. **Which of Decision 10's four cost-basis options (`docs/v2-hexmining-roadmap-archive.md:449-450` — fork-copy, zero-basis, manual, or unknown) should apply to pHEX, and how does that choice interact with this policy's `FORK_OPENING_STATE`/§10 architecture?** This document deliberately does not answer that question (§12) — it defines how fork-opening state would be sourced and represented in general, not what cost basis a fork-inherited pHEX position gets. Decision 10 remains open and requires its own dedicated decision. Separately, `src/services/hexmining/types.ts:123`'s in-code comment still points at `docs/v2-hexmining-roadmap.md §8` rather than the archive location confirmed in §2.2 above; updating that comment to cite `docs/v2-hexmining-roadmap-archive.md` (and/or this document) is a small, separate future docs-only follow-up, not performed in this PR.

---

## 22. Definition of done

For this PR (documentation-only):

- [x] `docs/pulsechain-fork-state-policy.md` created with the required 22-section structure.
- [x] One `docs/project-decisions.md` entry added recording this as a proposed/pending decision (not yet `Accepted`, since it introduces open questions that require operator input before acceptance).
- [x] `docs/ai-handoff.md` updated with a concise pointer, per repository practice for architecture-relevant documentation changes.
- [x] No source code, test, schema, migration, package, or DTO file changed.
- [x] No database, sync, rebuild, or backfill operation executed.
- [x] Every factual claim traceable to either repository evidence (marked `[E3]`/file path) or the task's investigation context (marked as such), with discrepancies explicitly flagged rather than silently resolved.
- [x] At least three options presented with one explicit recommendation and rationale.
- [x] Eleven bounded future implementation phases listed, ordered so no phase depends on storage an earlier phase has not created, none implemented here.

For the broader policy to be considered "done" (future work, not this PR):

- [ ] Fork-boundary block number confirmed via Tier 1 PulseChain source or direct operator RPC verification.
- [ ] Stale "Window 60/61" text in `docs/ai-handoff.md`, `docs/project-decisions.md`, and the runbooks synchronized to verified current operational state (Window 63 completed; next adjacent range operationally Window 64, not executed), via a separate bounded documentation PR.
- [ ] Phases 1–11 (§19) implemented as separate bounded PRs, each independently tested and reviewed.
- [ ] This document's `Status` updated from "Proposed" to "Accepted" once the product owner reviews and approves it, at which point `docs/project-decisions.md` should promote the corresponding entry's `Status` from a pending/deferred marker to `Accepted`.
