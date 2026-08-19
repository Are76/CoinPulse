# CoinPulse Project Decisions

**Last updated:** 2026-08-19 (D-037: PulseIcon privacy and decentralization principles proposed via PR #372, pending product-owner approval — docs-only architecture guardrail)

---

## Purpose

This is the durable decision record for CoinPulse. It records why decisions were made, not just what changed. It prevents future AI assistants from re-litigating settled decisions and distinguishes verified repo facts from operating instructions and recommendations. [E1]

---

## Evidence Model

- `[E1]` Verified from repository documentation
- `[E2]` Verified from merged PR metadata / git log
- `[E3]` Verified from code, tests, scripts, config, or CI files
- `[E4]` Project/user operating instruction from handoff context
- `[E5]` Inference or recommendation, not a repo fact

---

## Decision Format

Each decision uses the following format:

```text
Status: Accepted / Active / Deferred / Rejected / Superseded
Evidence: [E1–E5] tags
Decision: What was decided
Rationale: Why
Implications: What this means in practice
Do not: What must not happen as a result
```

---

## D-001: Backend Truth First

**Status:** Active

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` §Core Guardrails; `CLAUDE.md` architecture rules.

**Decision:** PostgreSQL/canonical backend state is the source of truth. Frontend renders DTOs only. No layer below the DTO boundary may be bypassed or reconstructed on the frontend.

**Rationale:** Auditability and rebuildability require a single source of truth. Frontend reconstruction of accounting values is untestable, unauditable, and inconsistent.

**Implications:** All balances, prices, valuation, PnL, LP values, stake values, and yield flow through the backend pipeline and arrive at the frontend as DTO fields.

**Do not:** Write frontend code that computes, estimates, or reconstructs any accounting value from raw inputs.

---

## D-002: RPC Is Ingestion/Operator Input Only

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md` §Core Guardrails.

**Decision:** RPC is upstream ingestion input only. It is not a frontend data source or a UI truth source.

**Rationale:** On-chain RPC data is raw and unprocessed. It lacks the normalization, provenance tracking, and canonical ledger guarantees required for accounting truth.

**Implications:** All RPC reads happen in backend services. No Next.js route or frontend component calls an RPC endpoint directly.

**Do not:** Add direct RPC calls from any API route or frontend component.

---

## D-003: DTO-First Frontend

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/data-fetching-architecture.md`.

**Decision:** Frontend consumes versioned backend DTOs and does not reconstruct accounting truth. TanStack Query is used for all reads via hooks in `src/lib/query/use-*.ts`.

**Rationale:** DTOs are versioned, testable, and carry provenance. Direct backend traversal from the frontend breaks the service boundary and the audit trail.

**Implications:** Every data shape visible to the frontend must be defined as a DTO in the backend and served through an API route.

**Do not:** Bypass the DTO layer to fetch raw database or RPC data from the frontend.

---

## D-004: No Frontend Computation of Accounting Values

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md` §Core Guardrails.

**Decision:** No frontend computation of balances, prices, valuation, PnL, LP values, stake values, or yield.

**Rationale:** Computation in the frontend is uncheckable by the backend audit pipeline, inconsistent across clients, and not rebuildable deterministically.

**Implications:** These values must be null/unavailable/unsupported in the DTO if the backend cannot produce them — never replaced by a frontend estimate.

**Do not:** Add React hooks or component logic that derives an accounting value from other DTO fields.

---

## D-005: No Symbol-as-Identity

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md` §Core Guardrails.

**Decision:** Token identity uses `chainId + tokenAddress` in `assetId` format (`chain:369:erc20:0x...`). Token symbol, name, or ticker is not used as an accounting identity key.

**Rationale:** Token symbols are non-unique, mutable, and frequently reused by scam/spam tokens. Using them as identity would corrupt the ledger.

**Implications:** All database records, ledger entries, and DTO fields that identify an asset must use the chain-scoped address format.

**Do not:** Use `symbol`, `name`, or `ticker` as a primary key or lookup field in accounting logic.

---

## D-006: No DexScreener or External Market Source as Primary Truth

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md` §Core Guardrails; `docs/pulsechain-authoritative-data-sources.md`.

**Decision:** DexScreener, CoinGecko, CoinMarketCap, and other commercial aggregators are not permitted as primary backend pricing truth. On-chain PulseChain reserve-derived pricing is the required source.

**Rationale:** Third-party aggregators are not PulseChain-controlled, may lag or fabricate data, and are categorized as Tier 3 (out of scope) in the authoritative source policy. [E1]

**Implications:** `DEXSCREENER` is the only currently disallowed primary source type in the resolver (`DISALLOWED_PRIMARY_SOURCES`). [E3] `ORACLE`, `MANUAL`, and reserve-derived `DEX` source types are all permitted. The rule prohibits Tier 3 commercial aggregators (DexScreener, CoinGecko, CoinMarketCap) as primary backend truth — not all non-reserve sources.

**Do not:** Add a DexScreener or other Tier 3 commercial aggregator fetch as a primary pricing source. Do not read this decision as requiring every `PriceObservation` to be reserve-derived — `ORACLE` and `MANUAL` source types are valid.

---

## D-007: Production DTOs Must Not Contain Mock Fallback Truth

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`.

**Decision:** Mock/test data, hard-coded fallback portfolio data, or invented values must not appear in production DTO responses.

**Rationale:** Mock data silently corrupts the audit trail. A user seeing mock numbers cannot distinguish them from real data.

**Implications:** If the backend cannot produce a value, the DTO must express that explicitly (e.g., `status: "unavailable"`, `yieldHex: null`) with a warning — not a placeholder.

**Do not:** Add `|| mockFallback` or similar patterns to production DTO assembly.

---

## D-008: Versioned DTOs with Provenance, Freshness, Warnings, and Status

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/reusable-backend-template-plan.md`.

**Decision:** All read DTOs must include `schemaVersion`, provenance fields, freshness fields, explicit status separation, and partial valuation warnings where relevant.

**Rationale:** Auditability requires the consumer to know when data was observed, from what source, whether it is stale, and what is missing.

**Implications:** Every new DTO type must follow the DTO contract style in `docs/reusable-backend-template-plan.md`.

**Do not:** Omit `schemaVersion`, `asOf`, or status fields from a new DTO. Do not silently return zeros for unavailable values.

---

## D-009: PulseChain-First V1

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md`.

**Decision:** PulseChain (chain ID 369) is the current V1 execution target. Ethereum, Base, and cross-chain support are future scope.

**Rationale:** Correctness on one chain before expanding. Multi-chain accounting requires separate identity, price, and ledger infrastructure.

**Implications:** All current chain-specific logic assumes chain ID 369. Cross-chain logic must not be introduced without an explicit scoped task.

**Do not:** Add Ethereum or Base execution paths in V1 PRs.

---

## D-010: Frontend Query Standardization Is Transport/Cache Only

**Status:** Active

**Evidence:** [E1] `docs/data-fetching-architecture.md`; `docs/frontend-query-standardization-audit.md`.

**Decision:** TanStack Query standardization is transport and caching only. It must not change DTO semantics, backend truth, route contracts, schemas, or accounting behavior.

**Rationale:** The query layer is a delivery mechanism. Changing it must not alter what data is fetched, how it is computed, or what the DTO contract promises.

**Implications:** Migrating a hook to TanStack Query is a refactor that must produce identical data behavior.

**Do not:** Use a query standardization PR to change a DTO field, a route, or a backend calculation.

---

## D-011: Reusable Backend Template Extraction Is Deferred

**Status:** Deferred

**Evidence:** [E1] `docs/reusable-backend-template-plan.md`.

**Decision:** The reusable backend template plan is planning documentation only. No extraction or abstraction has been performed. Readiness criteria must be met before extraction begins.

**Rationale:** Premature abstraction increases complexity without demonstrated benefit. The plan documents future intent.

**Implications:** Existing backend services are not yet refactored to use a shared template. Implementation PRs must not assume template infrastructure exists.

**Do not:** Implement the template extraction without an explicit scoped task and readiness confirmation.

---

## D-012: One Bounded PR at a Time

**Status:** Active

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md`.

**Decision:** Every task must be one independently reviewable, reversible PR. No PR mixes schema changes, frontend changes, and infrastructure changes. No scope creep.

**Rationale:** Mixed-scope PRs are harder to review, harder to revert, and harder to audit.

**Implications:** If a task touches multiple layers, split it into separate PRs in the correct order.

**Do not:** Combine a schema migration with a frontend feature in one PR.

---

## D-013: AI Prompts Must Include Hard-Stop Rules

**Status:** Active

**Evidence:** [E4] Derived from project operating history and Are's role as a non-developer product owner.

**Decision:** All prompts issued to AI coding agents must include: preflight steps, branch/base checks, origin sync, clean working tree confirmation, auth/push verification, scope boundaries, validation requirements, and final report format.

**Rationale:** Without these guardrails, AI agents have performed work that could not be pushed (auth missing), operated on the wrong branch, or exceeded scope.

**Implications:** Template prompts should be reused and updated rather than written from scratch for each session.

**Do not:** Issue a prompt that asks an AI to implement a feature without specifying branch, base, auth preflight, and validation requirements.

---

## D-014: AI Final Reports Must Be Copyable in One Markdown Code Block

**Status:** Active

**Evidence:** [E4] Derived from project operating history.

**Decision:** AI final reports must be enclosed in a single Markdown code block containing all important information. Are copies reports between Claude, Codex, and ChatGPT sessions.

**Rationale:** A single code block is reliably copyable and preserves formatting across different interfaces.

**Implications:** All prompts must end with an instruction to return the final report in one Markdown code block.

**Do not:** Put critical status information outside the code block, or split the report across multiple blocks.

---

## D-015: Verify Auth and Push Capability Before Heavy AI Work

**Status:** Active

**Evidence:** [E4] Derived from prior project failure where a large roadmap was read/processed but the PR could not be pushed because auth was missing.

**Decision:** Before reading large docs, doing long analysis, or writing files, verify that the environment can push a branch and open a PR. Hard stop if it cannot.

**Rationale:** Wasted AI context and time when environment lacks push access.

**Implications:** The first substantive step after repo/remote verification is always a test push of an empty branch.

**Do not:** Spend time reading a large roadmap and then discover the environment cannot push.

---

## D-016: Large Roadmap/Docs Must Be Read Selectively First

**Status:** Active

**Evidence:** [E4] Derived from prior project instability when processing very large roadmap context.

**Decision:** For large docs files, inspect size (`wc -l`, `wc -c`) and headings (`grep "^#"`) first, then read only targeted sections. Do not blindly load the full file unless absolutely necessary.

**Rationale:** Large files consume AI context window and can destabilize long sessions.

**Implications:** `docs/v2-hexmining-roadmap-archive.md` in particular should be accessed only when the specific historical detail is needed.

**Do not:** Load an entire large roadmap file as the first step of an AI session.

---

## D-017: HexMining Is Evidence-First, Not Estimate-First

**Status:** Active

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` §Gate-Lift State; `docs/hexmining-gate10-execution-plan.md`.

**Decision:** The purpose of HexMining yield estimation is auditable, evidence-backed yield computation. It is not a calculator that produces estimates without verified on-chain evidence.

**Rationale:** An unverified yield calculator would violate the project's correctness and auditability requirements.

**Implications:** Every estimated yield must be traceable to a persisted `HexMiningObservation` record with a verified canonical payload.

**Do not:** Surface estimated yield before the evidence pipeline has produced and validated a canonical observation.

---

## D-018: Public Estimated Yield Gate Was Lifted After Gate 10 Evidence

**Status:** Active — Gate 10 satisfied; Gate 11 promotion merged in PR #252

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` §11.14; `docs/hexmining-gate10-execution-plan.md`; [E2] PR #252 merged; [E3] `src/services/hexmining/yield-estimator.ts`, `src/services/hexmining/reader.ts`, `app/api/hexmining/stakes/route.ts`.

**Decision:** Public estimated yield (`status: "estimated"`, non-null `estimatedYieldHex`) may be exposed only after Gate 10 live-data verification is satisfied and documented. As of PR #252, that condition is satisfied and the production estimator promotion is merged.

**Rationale:** Infrastructure PRs (#234–#237) closed the reader/route/test coverage chain but were not themselves a gate lift. PR #252 supplied the required verified live-data evidence and promoted the production estimator path.

**Implications:** Valid evidence paths now return `status: "estimated"` with non-null `yieldHex` from the estimator and map to public `HexStakeYieldDto.status: "estimated"` with non-null `estimatedYieldHex` when provenance is complete. Non-estimated internal states such as `evidence_available`, insufficient observations, invalid observations, unavailable evidence, and unsupported chains still do not expose fabricated yield.

**Do not:** Treat the Gate 11 promotion as approval for ended stake exact-yield discovery, HSI/HTT, HexMining pricing/valuation/PnL, Ethereum eHEX, or frontend yield computation.

---

## D-019: Gate 10 Requires Documented Evidence

**Status:** Active — satisfied by PR #252 for the Gate 11 promotion

**Evidence:** [E1] `docs/hexmining-gate10-execution-plan.md`; `docs/hexmining-gate10-evidence-template.md`; `docs/v2-hexmining-roadmap.md`; [E2] PR #252 merged.

**Decision:** Gate 10 required: a real `HexMiningObservation` record on PulseChain (chain ID 369), a passing verification harness run, and a sanitized evidence package committed in the gate-lift PR. PR #252 records that these requirements were met.

**Rationale:** Evidence must be reproducible and reviewable. It cannot be asserted or fabricated.

**Implications:** Gate 10 was executed locally with the required database/RPC/evidence resources and is no longer an open blocker for public estimated yield. Any future evidence-sensitive gate must still record reproducible evidence before a gate lift.

**Do not:** Re-declare, reopen, or reinterpret Gate 10 based on runner/tool existence alone; use the recorded PR #252 evidence as the accepted gate-lift record.

---

## D-020: Operator Tools Do Not Lift Gates

**Status:** Active

**Evidence:** [E1] `docs/hexmining-gate10-execution-plan.md`; `docs/v2-hexmining-roadmap.md`.

**Decision:** The existence of operator and runner scripts (`gate10-runner.ts`, `hexmining-dailydata-observation-fetch.ts`, `verification-harness.ts`) did not mean Gate 10 was lifted or that public estimated yield was exposed. Gate 10 / Gate 11 were lifted only by PR #252 with recorded evidence and production promotion.

**Rationale:** Operator tools are execution infrastructure only. The gate is lifted only by a specific gate-lift PR with recorded evidence.

**Implications:** Any AI that sees these scripts must not infer gate status from tooling alone. Current gate status comes from PR #252 and the post-gate code/docs state.

**Do not:** Conclude future gate or phase status from the presence of runner/harness scripts.

---

## D-021: HexMining dailyData Packed Decoder Decision

**Status:** Active

**Evidence:** [E2] PRs #211–#214 merged to main; [E3] `src/services/hexmining/daily-data-packed-decoder.ts`.

**Decision:** `dailyDataRange` returns `uint256[]` (not `uint72[]`). Each element is a packed 72+72+56 bit layout. Bigint-safe decoding is required. All arithmetic must use bigint to avoid overflow.

**Rationale:** The ABI type is `uint256[]` but each value encodes three sub-fields. Standard JS number arithmetic would overflow.

**Implications:** Any code reading `dailyDataRange` must use the packed decoder, not direct numeric conversion.

**Do not:** Treat `dailyDataRange` results as plain numeric arrays.

---

## D-022: Observation Persistence and Dedup Model

**Status:** Active

**Evidence:** [E3] `src/services/hexmining/observation-store.ts`; [E2] PRs #199–#206 merged.

**Decision:** HexMining observations are persisted as `RawHexDailyDataObservation` records. Deduplication uses the composite key `chainId + sourceFamily + rangeStartDay + rangeEndDay + observedAtBlock + rpcEndpointLabel + payloadHash` — multiple rows for the same day range are allowed if block, endpoint, or payload differs. [E3] Invalidation is recorded in the separate append-only `RawHexDailyDataObservationInvalidation` table — there is no `isInvalidated` flag on the observation row itself. Source family is always `"HEXMINING"`.

**Rationale:** Immutable audit trail. The full composite dedup key preserves legitimate retry, endpoint, and payload variants for the same day range. Append-only invalidation preserves all ingestion history.

**Implications:** A new observation fetch will create a new record if any of the composite dedup fields differ from existing records. Legitimate re-fetches from a different block or endpoint are preserved, not collapsed.

**Do not:** Delete or overwrite existing observation records. Do not treat day range alone as a sufficient dedup key — doing so would collapse valid multi-endpoint or multi-block observations.

---

## D-023: stakeShares Must Be Validated

**Status:** Active

**Evidence:** [E2] PR #247 merged; PR #252 merged; [E3] `scripts/hexmining-gate10-run.ts`; `src/services/hexmining/yield-estimator.ts`.

**Decision:** `stakeShares` must be validated before being used in yield calculations. The Gate 10 runner rejects negative stakeShares at the runner boundary. The production estimator rejects non-positive stakeShares (`<= 0n`) before evidence fetch with a clear invalid-observation result.

**Rationale:** A negative stakeShares value would produce an invalid yield estimate. PR #247 added this guard to the Gate 10 runner. After PR #252, the production estimator rejects zero and negative `stakeShares` before evidence fetch with `status: "invalid_observation"` and warning `hexmining-yield-invalid-stake-shares`. The runner still rejects negative `stakeShares` at its boundary.

**Implications:** The runner currently enforces no negative `stakeShares`; the estimator enforces strictly positive `stakeShares`. Zero `stakeShares` is rejected by the estimator, not by the runner boundary.

**Do not:** Pass non-positive `stakeShares` to the yield estimator. Do not assume zero is currently rejected at the runner boundary before reaching estimator policy.

---

## D-024: RPC Source Policy After PR #249

**Status:** Active

**Evidence:** [E2] PR #249 merged — commit message: `fix(config): remove hardcoded pulsechainstats.com RPC default per source policy`.

**Decision:** No hardcoded third-party PulseChain RPC URL is permitted as a default in config, code, or scripts. Runtime, operator, environment variable, or CLI-supplied RPC is the authoritative transport.

**Rationale:** `pulsechainstats.com` is not a PulseChain-controlled Tier 1 source. Hardcoding it as a default violates the authoritative source policy.

**Implications:** `PULSECHAIN_RPC_URL` must be set by the operator. Missing RPC URL must result in a clear error, not a fallback to a third-party endpoint.

**Do not:** Add a hardcoded fallback RPC URL to any config, seed, or script file.

---

## D-025: Source Policy After PR #246; PRs #244 and #245 Closed Unmerged

**Status:** Active

**Evidence:** [E2] PR #246 merged — `docs/pulsechain-authoritative-data-sources.md` is the accepted reference. PRs #244 and #245 are absent from the merged commit history of `main`.

**Decision:** PR #246 (`docs/pulsechain-authoritative-data-sources.md`) is the accepted, authoritative source policy for CoinPulse. PRs #244 and #245 were closed without merging and must not be treated as accepted source policy.

**Rationale:** Only merged PRs constitute accepted project decisions.

**Implications:** Any reference to PulseChain authoritative sources must follow the Tier 1/Tier 2/Tier 3 model in `docs/pulsechain-authoritative-data-sources.md`.

**Do not:** Treat #244 or #245 content as accepted source policy. Do not use Tier 3 sources as primary truth.

---

## D-026: CodeRabbit/Review Bots Are Advisory

**Status:** Active

**Evidence:** [E4] Project operating history.

**Decision:** Automated review bot comments (CodeRabbit, similar tools) are useful but not authoritative. They do not replace code, test, and CI review. A bot suggestion must be verified against actual project requirements before acting on it.

**Rationale:** Bots flag patterns that may or may not apply to the project's specific constraints. Blindly accepting bot suggestions has caused scope drift.

**Implications:** When an AI acts on a bot review comment, it must verify the suggestion is consistent with repo docs, tests, and architecture rules.

**Do not:** Accept a bot review suggestion that contradicts a documented architecture rule or test requirement.

---

## D-027: Docs Must Not Claim Gates Are Lifted Unless Code/Tests/Docs Agree

**Status:** Active

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md`; [E4] project audit posture.

**Decision:** Documentation must not state that a gate is lifted unless the code, tests, and roadmap docs all agree that the lift has occurred. PR #252 is the recorded Gate 10 / Gate 11 lift. Docs drift after the gate lift must be reconciled to that merged state.

**Rationale:** A docs claim that a gate is lifted without code/test confirmation would mislead future AI agents and Are into proceeding with public exposure prematurely.

**Implications:** Any docs PR that updates gate status must include the PR reference that actually lifted the gate. For Gate 10 / Gate 11, that reference is PR #252.

**Do not:** Write gate-lift claims for future gates or phases without a recorded, merged implementation PR with evidence.

---

## D-028: Ended Stake Observations Are Always Incomplete at Discovery Time

**Status:** Active **at discovery time only** — partially SUPERSEDED 2026-07-24 by PRs #334, #335, #337 and D-032 (see Supersession Note below). The *discovery-time* invariant remains valid; the claim that observations can never become complete and that no on-chain backfill exists is no longer true.

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` Phase 5 Completion Record; [E2] PRs #307–#308 merged; [E3] `src/services/hexmining/ended-stake-discovery.ts`, `src/services/hexmining/ended-stake-observation-store.ts`.

**Decision:** Every `RawEndedHexStakeObservation` row persisted by `discoverEndedHexStakes()` is set to `isComplete: false` with `lockedDay: null` and `stakeShares: null`. The warning `hexmining-ended-stake-lockedday-unknown` is always included. This reflects a structural limit of Phase 5: `RawStakeAction` END records do not contain `lockedDay` or `stakeShares`, and no on-chain backfill from `stakeLists` is implemented.

**Rationale:** Correctness requires surfacing the incompleteness explicitly rather than fabricating or approximating missing fields. A future phase may recover `lockedDay` and `stakeShares` via an on-chain lookup and patch the observation.

**Implications:** Consumers of `EndedHexStakeListDto` must handle `isComplete: false` rows and null `lockedDay`/`stakeShares` on every Phase 5 observation. `isComplete: true` on the list DTO is only possible if all stake observations are complete, which does not occur for any Phase 5–discovered row.

**Do not:** Set `lockedDay` or `stakeShares` from `RawStakeAction` fields or from inference. Do not suppress the `hexmining-ended-stake-lockedday-unknown` warning. Do not treat `isComplete: false` as an error — it is the expected and correct state for Phase 5.

### Supersession Note (2026-07-24)

**What is superseded.** The original Decision/Implications above described the *only* lifecycle state a `RawEndedHexStakeObservation` could ever have. That is no longer accurate. After the original decision, three merged PRs added a **separate, later completion/recovery lifecycle** on top of discovery:

- **#334 — start-time stake evidence persistence.** Persists start-time `lockedDay`/`stakeShares` evidence for ended stakes where a matching `RawStakeAction` START record exists. [E2]
- **#335 — completion from persisted start evidence.** Enriches an already-discovered observation from that persisted start evidence and can flip it to `isComplete: true`. [E2] [E3] `enrichEndedHexStakeObservation` in `src/services/hexmining/ended-stake-observation-store.ts`.
- **#337 — historical contract-state evidence recovery.** Recovers `lockedDay`/`stakeShares` for ended stakes that have **no** matching START record, by reading pinned historical contract state (`stakeLists` at `endBlockNumber − 1`) and writing dedicated `evidenceRecovery*` provenance columns — never repurposing `discoveryMethod`. [E2] [E3] `recoverEndedHexStakeHistoricalState` in `src/services/hexmining/ended-stake-historical-state-recovery.ts`.

Consequently these original claims are **no longer true**: "no on-chain backfill from `stakeLists` is implemented"; and "`isComplete: true` … does not occur for any Phase 5–discovered row." On-chain backfill IS implemented, and a discovered row CAN later become complete.

**What remains valid.** The **discovery-time** invariant is unchanged and still authoritative: `discoverEndedHexStakes()` itself still persists every row as `isComplete: false` with `lockedDay: null`/`stakeShares: null` and the `hexmining-ended-stake-lockedday-unknown` warning, because END records carry no start-time data. Completion is a distinct, later act performed by the enrichment/recovery functions above — not by discovery.

**Corrected guidance for the "Do not" above.** The prohibition on setting `lockedDay`/`stakeShares` from `RawStakeAction` fields or from *inference* still stands. It does **not** forbid the implemented recovery path: recovering these fields from a matched persisted START record (#334/#335) or from an authoritative pinned historical contract-state read (#337) is evidence-based, not inference, and is the approved, merged mechanism. Agents must **not** read D-028 as active policy forbidding the completion/recovery path.

**Related decisions.** See D-032 (native ended stakes, including evidence completion/recovery, are in HexMining Phase 1 scope). A future decision may formalize a DB-level unique identity constraint on `RawEndedHexStakeObservation`; that is out of scope for this note.

---

## D-029: Ended Stake Reader Owns DTO Assembly; API Route Delegates Entirely

**Status:** Active

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` Phase 5 Completion Record; [E2] PRs #309–#310 merged; [E3] `src/services/hexmining/ended-stake-reader.ts`, `app/api/hexmining/ended-stakes/route.ts`.

**Decision:** `readEndedHexStakes()` is the sole assembly point for `EndedHexStakeDto` and `EndedHexStakeListDto`. The `GET /api/hexmining/ended-stakes` route validates input, calls the reader, and returns `{ data: result }` — it performs no additional transformation. Bigint serialization (block numbers as decimal strings), null preservation, warning aggregation, and `isComplete` rollup all occur inside the reader.

**Rationale:** Consistent with D-001 (backend truth first) and D-003 (DTO-first frontend). The reader is the testable contract boundary. The route is a thin wire.

**Implications:** Any future change to the DTO shape, serialization, or list-level aggregation must be made inside the reader, not in the route. The route contract tests mock the reader — they do not duplicate reader logic.

**Do not:** Add DTO transformation, field renaming, or list aggregation logic to the route handler. Do not add pricing, valuation, or PnL fields to the ended stake DTO until Phase 7 prerequisites are explicitly met.

---

## D-030: HSI Implementation Complete; HSI Live Verification Deferred

**Status:** Active — HSI implementation complete (PRs #312–#317); HSI live verification deferred

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` Phase 6 HSI Completion Record; [E2] PRs #312–#317 merged; [E3] `src/services/hexmining/hsi-discovery.ts`, `src/services/hexmining/hsi-reader.ts`, `src/services/hexmining/hsi-observation-store.ts`, `src/services/hexmining/hsi-live-verification-runner.ts`.

**Decision:** The Phase 6 HSI (Hedron Stake Instance) **backend pipeline** is implemented across observation persistence (#312–#313), discovery (#314), reader enrichment (#315), and live-verification **tooling** (#316), with a docs alignment follow-up (#317). This is backend-only: HSI is **not yet exposed through the public DTO/API** — `HexStakeSource` is still typed `"native"` only and the public `GET /api/hexmining/stakes` route still calls only `readNativeHexStakes`. HSI **live verification itself was not executed** and is deferred pending availability of an HSI-owning wallet. The verification tooling shipped mock-validated only; the evidence template remains `PENDING OPERATOR EXECUTION`.

**Rationale:** PR #316 delivered the operator runner, CLI wrapper, runbook, and evidence template, but a genuine live run requires a configured PulseChain RPC, a synced database, and an authorized HSI-holding wallet. No HSI-owning wallet is currently available to verify against. (The native verification runner in #318 reads HEX `stakeCount`/`stakeLists` only and does not query HSI/ERC-721 ownership, so it does not itself measure HSI NFT count.) Fabricating a verification report would violate the project's anti-fabrication and evidence-first guardrails (see D-017, D-020).

**Implications:** HSI persistence, discovery, and reader enrichment are live on main as a backend pipeline. HSI is not surfaced in any public DTO or API response yet. The correct HSI live-verification status is: **deferred pending availability of an HSI-owning wallet.** Documentation must not state that HSI live verification passed. Public HSI DTO/API integration, and the HTT (Hedron Token Transfer / Actuator delegated) source family — the remainder of Phase 6 — are not started.

**Do not:** State or imply that HSI live verification passed or that a live HSI run occurred. Do not state that HSI is exposed through public DTO/API contracts. Do not infer public HSI DTO/API integration, HTT support, Phase 7 pricing/valuation/PnL, or HSI frontend UI from HSI backend-implementation completion. Do not treat the existence of the HSI verification runner/runbook as a completed verification (consistent with D-020).

---

## D-031: Native Stake Reader Pins Reads to a Single Captured Block

**Status:** Active — merged in PR #319 (follow-up to native live-verification tooling PR #318)

**Evidence:** [E2] PRs #318–#319 merged; [E3] `src/services/hexmining/reader.ts` (`readNativeHexStakes`), `src/services/hexmining/native-stake-live-verification-runner.ts`.

**Decision:** `readNativeHexStakes` captures the current block once up front and pins **every** `stakeCount` and `stakeLists` read to that single captured block. This aligns the production reader with the deterministic single-block pattern already used by the native live-verification runner (#318). If `getBlockNumber` fails, `capturedBlock` stays undefined, reads fall back to `latest`, and the existing `hexmining-provenance-block-unavailable` warning plus graceful degradation are preserved. `currentDay` is intentionally left unpinned — it is outside the `stakeCount`/`stakeLists` race, feeds yield-range math, and is not read by the verification runner.

**Rationale:** Previously the reader captured a block number only for provenance and issued each `stakeCount`/`stakeLists` read at `latest` independently, which could theoretically race if stake state changed between calls. Pinning all reads to one block makes a single production read internally consistent and reproducible. PR #318's native live-verification tooling drives the existing read path and reports presence/consistency booleans only (no pricing, valuation, yield, or PnL); a live run against the fixture wallet recorded `observedAtBlock` 26944376, stakeCount 32, enumeratedCount 32, all checks passed.

**Implications:** Native active-stake reads (Phase 2) are now block-pinned and have operator live-verification tooling. This is hardening/verification of already-complete native work — not a new roadmap phase and not pricing/valuation/PnL. Ended-stake live verification does not exist; only native active-stake verification tooling was added.

**Do not:** Reintroduce independent `latest` reads for `stakeCount`/`stakeLists` in the production native reader. Do not remove the `latest` fallback or the `hexmining-provenance-block-unavailable` warning. Do not claim ended-stake live verification exists, and do not treat #318/#319 as pricing, valuation, PnL, or a new phase.

---

## D-032: HexMining Phase 1 Completion Scope Is Native pHEX Only

**Status:** Accepted (2026-07-24)

**Evidence:** [E2] Merged PRs #190–#191 (native active-stake reads), #252 (Gate 10/11 public estimated yield), #307–#310 (ended-stake pipeline), #318–#319 (native live verification + block pinning), #333 (operator ended-stake discovery trigger), #334 (start-time stake evidence persistence), #335 (ended-stake completion from start evidence), #336 (ended-stake reader/API verification runner), #337 (ended-stake historical contract-state evidence recovery), #340 (ended-stake history rendered in UI). [E3] `src/services/hexmining/types.ts` (`HexStakeSource` is `"native"` only; `"hsi"`/`"htt"` are declared deferred), `app/api/hexmining/stakes/route.ts` (calls only `readNativeHexStakes`), `src/components/hexmining/hexmining-screen.tsx` (renders active and ended native stakes from backend DTOs only). [E1] `docs/v2-hexmining-roadmap.md`; `docs/ai-handoff.md`.

**Decision:** **HexMining Phase 1 is defined as native pHEX stakes on PulseChain (chain ID 369), covering both active and ended stakes.** HexMining Phase 1 completion is measured against this scope only.

Phase 1 **includes**:

- PulseChain `chainId 369` only
- Native pHEX stakes (the HEX contract's own `stakeCount`/`stakeLists` ownership model)
- Active native stakes (persistence, reader, DTO, API, UI)
- Ended native stakes (discovery, persistence, evidence completion/recovery, reader, DTO, API, UI)
- Backend-canonical persistence and evidence (raw observations, provenance, warnings)
- Versioned DTO/API contracts for the above
- Frontend display of active and ended native stakes (backend DTOs only)
- Backend-provided estimated yield with provenance and warnings (per D-018)
- Bigint/string-safe display conversion in the frontend (formatting only, never computation)
- No frontend computation of yield, pricing, valuation, or PnL (per D-004)

Phase 1 **does not include** (later phases — deferred scope, not dropped functionality):

- Public HSI DTO/API exposure (`HexStakeSource: "hsi"`, route wiring)
- HSI frontend UI
- HSI live verification
- HTT (Hedron Token Transfer / Actuator delegated) source family
- Ethereum eHEX or any non-PulseChain chain
- Pricing, valuation, and PnL (Phase 7; `pricing.status`, `valuation.status`, `pnl.status` remain `"unsupported"`)

**Rationale:** Native pHEX is chosen as the Phase 1 completion scope because it is the only source family that is implemented end-to-end and verifiable today: native active-stake reads are implemented, tested, block-pinned (#319), and live-verified with recorded evidence (#318: stakeCount 32 / enumeratedCount 32, all checks passed); the ended-stake pipeline is implemented and tested through discovery, operator trigger, start-evidence completion, historical contract-state evidence recovery, API verification tooling, and UI rendering (#307–#310, #333–#337, #340). The HSI **backend foundation exists** (persistence, discovery, reader enrichment — PRs #312–#317) but public HSI support is not finished: HSI is not exposed through any public DTO/API, and **HSI live verification is blocked by the lack of a suitable HSI-owning wallet/evidence** (D-030). Under the project's evidence-first principle (D-017, D-020, D-027), it would be indefensible to declare HSI complete — or to fold it into the Phase 1 completion bar — without recorded live evidence. HSI, HTT, and eHEX are therefore moved to later phases.

**Implications:** HexMining Phase 1 can be declared functionally complete when the native pHEX scope above is implemented, tested, and its operator evidence is recorded — without HSI, HTT, or eHEX. The roadmap must no longer be read as keeping Phase 1 open because HSI/HTT are unfinished. Existing HSI backend code (observation store, discovery, reader, verification tooling) remains on `main` unchanged and is the foundation for the later HSI phase. Re-including HSI in the Phase 1 completion bar requires a new explicit decision superseding this one.

**Do not:** Treat this decision as deleting, deprecating, or removing existing HSI code — it is a scope decision only. Do not expose HSI publicly, start HTT, or add eHEX under a Phase 1 label. Do not claim HSI live verification passed (D-030 stands). Do not interpret deferred scope as cancelled scope.

---

## D-033: HexMining Phase 1 (Native pHEX) Is Formally Complete

**Status:** Accepted (2026-07-24) — documentation-only completion record; no functional change

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` Phase 1 Completion Record; `docs/hexmining-ended-stake-api-verification-evidence-template.md` (Run 4, `PASS`); `docs/hexmining-ended-stake-historical-state-recovery-evidence-template.md` (dry-run + execute, 0 failures). [E2] Merged PRs #318–#319 (native active-stake live verification + block pinning), #307–#310, #333–#337, #340 (ended-stake pipeline through frontend history), #343 (canonical ended-stake identity enforcement), #252 (public estimated yield gate lift). Operator source material (not repo-verifiable): the run JSONL under `operator-evidence/hexmining-ended-stake-api-verification/` and `operator-evidence/hexmining-ended-stake-historical-state-recovery/` is untracked (kept out of git per evidence policy) and cannot be verified from a checkout of `main`; its factual content is summarized in the committed [E1] evidence templates above, which are the durable record.

**Decision:** **HexMining Phase 1, scoped by D-032 to native pHEX stakes on PulseChain (chain ID 369), is formally complete.** The completion bar is met with recorded evidence:

- Native active stakes: 32 active stakes, live-verified and block-pinned against the canonical backend (#318: stakeCount 32 / enumeratedCount 32, all checks passed; #319 block pinning).
- Native ended stakes: 9 persisted observations — 9 complete, 0 incomplete, 0 duplicate identities — with canonical identity enforced (#343). The API verification runner (#336) recorded `PASS` for wallet `0x75f808367720951e789d47e9e9db51148d9aa765`: HTTP 200, 9 returned, all integrity checks `true`, no runner-level warnings. The runner is a single read-only HTTP GET (no DB connection), so this proves the shipped `GET /api/hexmining/ended-stakes` route serves the persisted observations complete, correctly scoped, duplicate-free, and bigint/string-safe — it does not independently reconcile PostgreSQL rows against the response.
- Historical-state recovery: already executed successfully — the execute-mode run recovered and updated 9/9 previously-incomplete observations with 0 failures; all 9 carry recovery provenance (`evidenceRecoveryMethod` present). No incomplete observations remain and no additional recovery execution is required.

**Rationale:** D-032 defined the Phase 1 bar; the missing pieces at that time were recorded operator evidence for the ended-stake pipeline (API verification and execute-mode recovery). Both have since been executed against a real local server, database, and PulseChain RPC, and their factual outputs are recorded in the docs evidence templates per the evidence-first principle (D-017, D-020, D-027). Nothing is claimed without recorded evidence.

**Implications:** Remaining HexMining roadmap work is later-phase scope only: HSI public exposure/UI/live verification, HTT, eHEX, and pricing/valuation/PnL (Phase 7). Phase 1 is closed and must not be reopened by later-phase work. Future roadmap scope is unchanged by this record.

**Do not:** Treat this record as introducing any functionality — it documents completed, merged, evidence-backed work only. Do not read Phase 1 completion as HSI/HTT/eHEX or pricing/valuation/PnL progress. Do not claim HSI live verification passed (D-030 stands). Do not commit or modify the operator evidence JSONL files.

---

## D-034: Stablecoin (pDAI-to-USD) Pricing Evidence Policy

**Status:** Accepted (2026-08-02) — governance decision only; no functional change

**Evidence:** [E2] Merged PRs #351 (`fix(pricing): correct quote truth for pDAI-routed observations`), #352 (`feat(pricing): explain unavailable USD pricing from pDAI routes`), #354 (`feat(pricing): add wallet-scoped ingest candidate preview`). [E3] `src/services/pricing/price-resolver.ts` (`isUnverifiedPulseXQuoteAssumption`, `DISALLOWED_PRIMARY_SOURCES`, `PriceObservationRejectReason`), `src/services/pricing/types.ts` (`PriceSourceType`), `src/services/pricing/fetchers/onchain-pulsex-fetcher.ts`, `src/config/assets.ts` (`CORE_ASSETS.pdai`), `src/components/dashboard/dashboard-presenters.tsx`, `src/components/portfolio/asset-holdings-screen.tsx`. [E1] `docs/pulsechain-authoritative-data-sources.md` (Tier 1/2/3 source model); D-006 (no Tier 3 aggregator as primary pricing truth).

### 1. Current enforced behavior (verified, unchanged by this decision)

- pDAI is treated as a volatile crypto asset, never as USD. CoinPulse does not hardcode or infer `1 pDAI = 1 USD`.
- `ONCHAIN_POOL` via PulseX (`fetchOnchainPulseXPrice`, token → WPLS → pDAI) is the only implemented live pricing fetcher. Its output is pDAI-denominated.
- `resolveBestPriceObservation` rejects any observation identified by `isUnverifiedPulseXQuoteAssumption` with reason `UNVERIFIED_QUOTE_ASSUMPTION`: a PulseX-route `sourceId` requested/persisted under any quote asset other than the exact canonical pDAI `assetId`, or the legacy fabricated `pulsex:pdai:par` `sourceId` unconditionally, regardless of quote asset. A pDAI-denominated observation is never treated as a USD-denominated observation.
- `ORACLE`, `MANUAL`, and `ONCHAIN_ROUTE` exist as `PriceSourceType` enum values but have no implemented ingestion path today. Declaring them does not mean they are implemented or approved sources.
- Chainlink, Pyth, RedStone, DIA, and Chronicle are not implemented, partially implemented, or approved for CoinPulse.
- No independently verified pDAI→USD source currently exists anywhere in the codebase.
- Where USD pricing is unavailable, `pricing.status`/`valuation.status` surface `unavailable`/`unsupported` (D-008); the Dashboard and Asset Holdings screens explain this only when `pricing.status === "unavailable"`, using reviewed copy that names no route or guarantee the backend does not make (PR #352). Missing USD evidence never produces zero or a fabricated USD value (D-007).

### 2. Required independence (governs any future pDAI→USD evidence proposal)

Any future pDAI→USD evidence must be independent of the PulseX token→WPLS→pDAI route already used to price portfolio assets. The following are explicitly rejected as independence, and any future implementation proposal that relies on them must be rejected at design review:

- Using the same PulseX route as both the token price and the USD anchor.
- Pricing pDAI through a route that terminates back in pDAI.
- Treating pool labels, token names, symbols, or an asset's intended peg as evidence of USD parity.
- Treating multiple observations drawn from one underlying liquidity source or route family as independent corroboration.
- Using frontend calculations, UI display values, or third-party aggregator display values (Tier 3 per `docs/pulsechain-authoritative-data-sources.md`) as backend pricing truth.

### 3. Minimum source requirement categories (deferred — not defined here)

A future pDAI→USD implementation decision must establish, for any proposed source, at minimum:

- Source identity and operator.
- Chain and contract/feed address.
- Quoted asset and unit.
- Update mechanism.
- Freshness/staleness policy.
- Confidence and failure behavior.
- Manipulation and liquidity assumptions.
- Independence from PulseX pDAI routing (per §2).
- Historical availability required for PnL resolution.
- Outage/depeg behavior (per §7).
- Provenance fields to persist on `PriceObservation`.
- Deterministic resolver eligibility rule.
- Auditability and required test coverage.

This decision does not select a provider, a numeric threshold, a minimum liquidity figure, a source count, a confidence value, or an acceptable deviation bound. Those require a separate, evidence-backed decision citing verified sources — not general knowledge of what providers exist.

### 4. Oracle/source governance

- Declaring `ORACLE`, `MANUAL`, or `ONCHAIN_ROUTE` in the `PriceSourceType` enum does not mean the source is implemented or approved for use.
- Any third-party oracle integration (Chainlink, Pyth, RedStone, DIA, Chronicle, or otherwise) requires a separate governance and implementation decision that extends D-034 — or supersedes only its "no provider approved" conclusion — while remaining bound by the independence (§2), provenance, historical-PnL, and fail-closed (§7) requirements this decision establishes.
- Provider adoption must verify, per `docs/pulsechain-authoritative-data-sources.md`'s Tier model: PulseChain deployment, feed ownership, contract identity, update behavior, historical availability, and operational risk — using Tier 1 verification, not vendor claims.
- DexScreener and other Tier 3 commercial aggregators remain unsuitable as primary valuation truth (D-006). This decision does not weaken D-006.
- A `MANUAL` observation must not be introduced as an undocumented operator override; any manual-source policy requires its own decision with persisted provenance and audit trail.

### 5. Resolver policy

- The current `UNVERIFIED_QUOTE_ASSUMPTION` rejection in `resolveBestPriceObservation` remains authoritative and must not be weakened by this decision.
- A future source must not bypass this rejection merely by changing `quoteAsset`, `sourceId`, or route metadata shape. Any resolver change touching pDAI/USD eligibility requires review against `isUnverifiedPulseXQuoteAssumption`'s intent, not just its current pattern match.
- Resolver eligibility for pDAI-derived USD pricing may change only after a future independent-evidence decision is accepted and implemented with test coverage proving the independence, resolver-policy, and failure-mode requirements in §§2, 5, and 7.
- The legacy fabricated `pulsex:pdai:par` observation (`price: "1"`, removed as a producer in PR #274) remains permanently ineligible, including for historical/average-cost PnL resolution.
- Historical PnL price resolution must apply the same evidence policy as current-mark valuation — no separate, weaker historical-only exemption.

### 6. DTO and UI policy

- Frontend continues to render backend DTO truth only (D-003); it must not convert pDAI to USD itself.
- Current unavailable/null valuation behavior (PR #351, #352) remains correct and is not changed by this decision.
- This decision does not require a new DTO status, field, or enum value. Whether the existing `pricing.status`/`valuation.status`/`PriceObservationRejectReason` vocabulary is sufficient for a future pDAI→USD source is a question for the future implementation design, not this policy.
- Any breaking change to DTO vocabulary (new status value, renamed field, changed enum) requires its own separate, bounded contract decision with tests (D-008, D-012).

### 7. Depeg and failure behavior (binding on any future implementation)

A future pDAI→USD implementation must fail closed:

- Stale, missing, conflicting, unsupported, or unhealthy evidence must not produce a USD valuation.
- A depeg must not be hidden by forcing a value of `1`.
- No fallback source may silently replace the canonical source without recorded provenance identifying which source produced the value.
- Valuation and unrealized PnL must become unavailable — not zero, not stale-frozen — when required USD evidence is unavailable.
- Realized PnL must not be erased or nulled merely because current mark pricing is unavailable; realized and unrealized PnL have independent evidence requirements.

### 8. Implementation gate

No pDAI→USD implementation PR may begin until a separate, evidence-backed decision documents:

- The exact source or sources proposed, with Tier 1 verification.
- Exact canonical identities/contracts involved.
- Proof of independence from the PulseX pDAI route (per §2).
- Freshness rules.
- Confidence rules.
- Persistence-model compatibility with `PriceObservation`.
- Resolver eligibility behavior.
- Historical PnL resolution behavior.
- Failure/depeg behavior (per §7).
- Required test coverage.
- Operator observability requirements.

**Rationale:** PR #351 closed a real gap — PulseX pDAI-routed prices were being persisted and could be selected under `quoteAsset: "fiat:usd"` with no independent USD evidence, backed only by an unread `routeMetadata` flag. The fix is provenance-based and correct, but the audit that produced this decision found no durable project record of *why* pDAI routing is insufficient USD evidence, nor of what evidence would be sufficient in the future. Without this record, a future PR could reintroduce the same gap under different field names, or treat PR #354's `quoteAsset` correction (canonical pDAI identity, never `"fiat:usd"`) as an invitation to build a pDAI→USD bridge without evidence. This decision closes that gap in writing only — it changes no code, no resolver behavior, and no DTO contract.

**Implications:** Future pDAI→USD proposals must be evaluated against §§2–8 above before any implementation work starts. The absence of a concrete provider or threshold in this decision is intentional, not an oversight — see §3.

**Do not:** Treat this decision as approving any pricing provider, oracle, or pDAI→USD bridge. Do not treat it as making USD valuation available for pDAI-routed assets. Do not treat PR #354's canonical pDAI `quoteAsset` correction as evidence toward USD parity — it corrects identity only, per PR #354's own commit message ("does not by itself increase Dashboard USD valuation coverage"). Do not weaken D-006 or the `UNVERIFIED_QUOTE_ASSUMPTION` resolver rejection based on this decision. Do not read "sufficient evidence," "reliable source," or "stable enough" anywhere in this decision as a defined threshold — none is defined here; a separate evidence-backed decision is required.

---

## D-035: Atlas Design System Adoption and Portfolio-Tracker-First Product Direction

**Status:** Accepted (2026-08-03) — planning/documentation decision only; no functional change

**Evidence:** [E1] `docs/design/atlas-design-system-v1.md` (existing accepted Atlas component/placeholder reference); `docs/atlas-design-system-integration-plan.md` (this decision's companion document, added in the same PR). [E3] Repository inspection (2026-08-03) of `src/components/ui/atlas-status-badge.tsx`, `src/components/ui/atlas-provenance-row.tsx`, `src/components/ui/value/timestamp-label.tsx`, `src/components/ui/value/value-display.tsx`, `src/components/ui/data-state/warning-banner.tsx`, `src/components/ui/section-card.tsx`, `src/components/ui/surface-card.tsx`, `src/components/dashboard/dashboard-presenters.tsx`, `src/components/dashboard/live-snapshot-card.tsx`, `src/components/portfolio/asset-holdings-screen.tsx`, `src/components/hexmining/hexmining-screen.tsx`, `src/components/layout/app-shell.tsx`, `src/components/debug/operator-tools-nav.tsx`, `src/services/portfolio/live-snapshot-types.ts` (`LiveHoldingsSnapshotDto.coverage: "known_assets_only"`, per-asset `priceStatus`, no unified per-value mode/status pair), `src/services/portfolio/live-holdings-snapshot.ts` (known-token-only query; failed balance read caught, recorded as a `balance-read-failed:<assetId>` warning string, and the token dropped from `assets`). [E2] PR #356 (live-holdings-snapshot for wallets pending ledger sync).

**Decision:** Atlas (Figma Make design system) is the intended visual design system for the CoinPulse frontend, adopted through small bounded PRs into the existing Next.js app — never as a second application, never by copying Figma Make generated `App.tsx`/Vite setup/full shadcn directory. Alongside this, CoinPulse's product direction is clarified: CoinPulse is a portfolio tracker first — fast live view of currently known or covered wallet assets and positions, not a guaranteed complete wallet inventory (the live DTO's `coverage: "known_assets_only"` excludes unregistered tokens and drops any token whose balance read failed, per `src/services/portfolio/live-snapshot-types.ts` and `live-holdings-snapshot.ts`) — with historical transactions, PnL, yield, and DeFi analytics as progressive enrichment layered on top, not a precondition for showing current state. Data is described on two separate axes, never conflated: provenance/data mode (live/estimated/materialized/historically verified) and availability/quality status (available/partial/unavailable/unsupported/stale/conflicting/pending); today's live DTO does not yet carry a unified per-value mode/status pair, and this decision does not claim otherwise — establishing that pair is future bounded implementation work. The full taxonomy, the two-path architecture (fast portfolio path vs. historical enrichment path), the inspected component-to-repository mapping, and the phased implementation roadmap are recorded in `docs/atlas-design-system-integration-plan.md`.

**Fast-path architecture boundary (explicit, supplementing — not replacing — the historical truth stack):** the fast portfolio path (`assembleLiveHoldingsSnapshot()`, `GET /api/portfolio/live-snapshot`) is a deliberately approved, bounded current-state path, not an informal exception to `AGENTS.md`'s backend-truth pipeline. PostgreSQL and the canonical ledger remain the sole source of truth for historical transactions, accounting-grade state, materialized portfolio truth, PnL, and yield — nothing on the fast path is persisted, normalized, or treated as canonical ledger truth; that is this path's accepted, bounded scope only, not license to skip persistence elsewhere. RPC remains backend-only (`assembleLiveHoldingsSnapshot()` is `server-only`) — this decision does not authorize direct frontend RPC calls or any other DTO-boundary bypass. The live snapshot is block-pinned (one `observedBlock` per assembly), coverage-limited (`coverage: "known_assets_only"`), and warning-bearing; it is never canonical ledger truth, historical truth, accounting truth, PnL, or yield (`pnlStatus` is fixed at `"unsupported"`).

**Rationale:** `docs/design/atlas-design-system-v1.md` already established Atlas as an accepted design reference with per-component safe-placeholder behavior, but did not record product positioning, the live/historical architecture split, or an implementation sequence — leaving a gap between "Atlas is a reference" and "here is how and in what order it gets built." Separately, repository inspection found that Atlas naming (`AtlasStatusBadge`, `AtlasProvenanceRow`, `AtlasMetricCard`, `AtlasSummaryCard`) has already begun appearing in production components ahead of any formal roadmap, PR #356 already shipped a first fast-path live snapshot as a deliberately scoped exception requiring explicit architectural framing (not a silent bypass), and PR #297 already landed a substantial Atlas token foundation (`app/globals.css`, `app/layout.tsx`) that a naive "Phase 1" could have duplicated. This decision and its companion document catch the durable record up to all three facts and give future PRs an agreed sequence instead of ad hoc adoption or accidental rework.

**Implications:** Future frontend PRs should treat Atlas as the target visual system and follow the phased roadmap in `docs/atlas-design-system-integration-plan.md` §12 (Phase 0 decision/inventory — this PR; Phase 1 foundation audit and gap-fill against the PR #297 token layer, not a from-scratch introduction; Phase 2 UI primitives; Phase 3 app shell; Phase 4 Live Portfolio; Phase 5 unified portfolio, extending the existing `LpPositionsTable` rather than building LP UI from scratch; later phases unscheduled). The dashboard and future portfolio surfaces should be read as two layers — a live layer (fast path, `GET /api/portfolio/live-snapshot`) and an enrichment layer (historical path, `GET /api/portfolio/dashboard`) — rather than one monolithic PnL view. Historical enrichment is operator-triggered via manual sync today, not automatic — no background-enrichment promise is made or implied. HexMining scope is unaffected: native pHEX only, per D-032/D-033.

**Do not:** Treat this decision as implementing any Atlas component, token, page, CSS, or application code — none is introduced by this PR. Do not treat "portfolio tracker first" as license to skip DTO-only consumption, bigint-safe handling, chain-aware identity, or any other architecture rule in `CLAUDE.md` — the fast portfolio path still terminates in a versioned backend DTO. Do not describe a Live Portfolio surface as PnL, accounting, or historical truth. Do not treat the fast-path architecture boundary above as authorizing frontend RPC or any other backend-truth bypass outside this one, explicitly-scoped path. Do not reopen HSI/HTT/eHEX/cross-chain HexMining scope via this decision — D-032/D-033 stand. Do not treat the component mapping in `docs/atlas-design-system-integration-plan.md` §7 as approval to build any "no dedicated component" row without its own bounded Phase 2 PR, and do not treat Phase 1 as license to duplicate or overwrite the token layer already landed in PR #297.

---

## D-036: PulseChain Fork-State and Inherited-History Policy (Proposed, Pending Review)

**Status:** Proposed — **not yet Accepted**. This entry records a policy proposal awaiting product-owner review; it is not a settled decision like the other entries in this file. **Update (2026-08-04):** the fork-boundary block number is now Tier 1-confirmed (`lastInheritedBlock = 17,232,999`, `firstPostForkBlock = 17,233,000` — see `docs/pulsechain-fork-state-policy.md` §6.1 and `PULSECHAIN_FORK_BOUNDARY` in `src/config/chains.ts`), resolving Open Question 1 of `docs/pulsechain-fork-state-policy.md` §21. Promote to `Accepted` only after the *remaining* open questions in §21 are resolved (stale-docs synchronization; Decision 10's pHEX cost-basis choice) — Tier 1 boundary confirmation alone does not promote this entry to `Accepted`.

**Evidence:** [E1] `docs/pulsechain-fork-state-policy.md` (this decision's companion document, added in the same PR); `docs/v2-hexmining-roadmap-archive.md:449-450` (archived "Decision 10 — Fork-copy cost basis policy," still unresolved — pHEX cost-basis option not yet chosen; D-036 does not choose it either). [E3] Repository inspection (2026-08-04): no fork-boundary, pre-fork, or inherited-history provenance logic exists anywhere in `src/services/` (ingestion, staking, transfer, normalization, materialization, pricing, PnL); `src/config/assets.ts` defines only PulseChain-side assets (no `eHEX`/`chainId: 1` entry). [E4] Task-provided investigation context (PulseChain RPC chain behavior claims, candidate boundary figures, and the claim that two specific stake rows at blocks `15,353,156`/`15,767,882` exist in production) — explicitly not independently re-verified via live RPC or database query in this docs-only session; the block numbers independently match values in committed test fixtures (`tests/services/hexmining/ended-stake-*.test.ts`, [E3]), which is consistent with but does not prove the production-row claim. Treated as investigation input requiring re-verification, not verified chain/database fact, until Tier 1/production-confirmed.

**Decision:** Proposes a five-class provenance model (`PULSECHAIN_POST_FORK`, `ETHEREUM_INHERITED_HISTORY`, `FORK_OPENING_STATE`, `ETHEREUM_CHAIN_HISTORY`, `UNKNOWN_OR_UNVERIFIED`), classified by two precisely named quantities — `lastInheritedBlock` and `firstPostForkBlock = lastInheritedBlock + 1` — never by a single ambiguous "boundary block," and selects **Option C — dual-view evidence model**: inherited Ethereum history retained as immutable evidence with explicit provenance; verified fork-opening state represented as a deterministic, chain-aware, non-duplicable **canonical opening-balance `LedgerEntry`** (provenance `FORK_OPENING_STATE`) so it participates in the existing full-ledger-replay materialization rather than becoming a second, ledger-external accounting source; post-fork ledger/materialization/PnL built from that canonical opening entry plus post-fork activity only, once implemented; inherited history never silently blended into ordinary PulseChain transaction history, balances, or future PnL/cost-basis without that explicit fork-opening-state evidence. Fork-opening state itself must be sourced from a Tier 1-verified state read proven to reflect PulseChain's state *after* fork/genesis transition rules were applied and *before* the first independent post-fork transaction — not a raw read at `lastInheritedBlock`, which would return pre-transition inherited state. Full rationale, terminology, asset-identity rules (pHEX ≠ eHEX despite shared fork-copied contract address), and eleven bounded future implementation phases (ordered so no phase depends on storage an earlier phase has not created) are recorded in `docs/pulsechain-fork-state-policy.md`.

**Rationale:** PulseChain is a state-fork of Ethereum; a PulseChain RPC can return blocks/transactions that are Ethereum-origin history inherited at genesis, indistinguishable today from PulseChain-native activity because CoinPulse stores every row under `chainId: 369` with no provenance marker. Left unaddressed, this is a latent path to fabricated future PnL/cost-basis figures for fork-inherited assets (e.g., pHEX stakes with pre-fork start evidence) and to misrepresenting Ethereum history as PulseChain user activity in transaction-history UI. Option C is the only option consistent with immutable raw-evidence retention (D-001), the "unsupported is safer than misleading" principle (`docs/pnl-accounting-guardrails.md` §11.1), and chain-aware asset identity (D-005) — see `docs/pulsechain-fork-state-policy.md` §16 for the full options analysis (Option A: status quo, perpetuates the gap; Option B: discard inherited history, violates D-001's immutable-evidence rule).

**Implications:** This PR adds the bounded Phase 1 fork-boundary constant (`PULSECHAIN_FORK_BOUNDARY` in `src/config/chains.ts`) and its pure classifier (`src/services/chains/fork-provenance.ts`), per `docs/pulsechain-fork-state-policy.md` §19 item 1 — no Prisma schema or migration change, no DTO or API route change, and no sync, rebuild, backfill, persistence, or database mutation change. No later fork-policy phase (§19 items 2–11) was implemented. Future HexMining, ledger, materialization, pricing, and PnL work touching pre-fork-active wallets or pHEX stakes with pre-fork start evidence should be evaluated against this policy's target architecture once accepted. Documentation drift was found and flagged during this PR's investigation: `docs/ai-handoff.md`, this file's D-0xx entries on transfer-backfill posture, and `docs/wallet-scoped-historical-sync-runbook.md` currently state the TRANSFERS backfill campaign is paused after Window 60 / awaiting Window 61 approval — verified operator/database evidence supplied during this PR's review shows Window 63 has since completed (range `26,634,999–26,635,998`) and the next adjacent descending range (`26,633,999–26,634,998`) is operationally Window 64 per the shared `SyncCursor`, though **not executed**. That stale text is **not corrected in this PR** (out of this PR's bounded Phase 1, no-runbook-edit scope) — a separate, bounded documentation-synchronization PR is required and is listed as follow-up work in `docs/pulsechain-fork-state-policy.md` §21.

**Do not:** Treat this entry as `Accepted` policy — it is `Proposed`, pending product-owner review of the *remaining* open questions in `docs/pulsechain-fork-state-policy.md` §21 (stale-docs synchronization; Decision 10's pHEX cost-basis choice). The fork-boundary pair itself (`lastInheritedBlock = 17,232,999` / `firstPostForkBlock = 17,233,000`) is Tier 1-verified as of 2026-08-04 (§6.1) and exported as `PULSECHAIN_FORK_BOUNDARY` in `src/config/chains.ts` — do not treat that verification as also promoting this entry to `Accepted`, and do not treat it as authorizing any further code, schema, DTO, sync, rebuild, or backfill change beyond the bounded Phase 1 classifier already implemented (§19 item 1). Do not treat the Window 63/64 evidence cited above as approval to execute Window 64 or any further backfill window — no window is approved or executed by this decision. Do not use this decision to reopen HexMining Phase 1 scope (D-032/D-033 stand) or to merge eHEX/pHEX identity (§8 of the companion document explicitly forbids this). Do not treat this decision as choosing any of archived Decision 10's cost-basis options (fork-copy / zero-basis / manual / unknown) for pHEX — that choice remains separate and unresolved. Do not model fork-opening state as a table or code path materialization reads independently of the canonical ledger — the target architecture keeps it inside `LedgerEntry` via the canonical opening-balance entry described above. Do not treat the two specific stake-row block numbers cited in the Evidence line as confirmed production facts — they are unverified investigation input pending re-verification.

---

## D-037: PulseIcon Privacy and Decentralization Principles

**Status:** Proposed — pending product-owner approval (PR #372 opened 2026-08-19). Architecture guardrail document; no functional change. Follows the same pending-approval convention as D-036 until the product owner approves the PR.

**Evidence:** [E1] `docs/architecture/pulseicon-privacy-decentralization-principles.md` (this decision's companion document, added in the same PR); `CLAUDE.md`; D-001, D-004, D-005, D-007, D-008 (existing backend-truth-first, no-frontend-computation, chain-aware-identity, no-mock-fallback, and versioned-DTO rules this decision reinforces and does not weaken). [E3] Repository inspection (2026-08-19): no account, authentication, subscription, billing, or user↔wallet ownership table or code path exists anywhere in `prisma/schema.prisma` or `src/services/`.

**Decision:** Establishes privacy-by-architecture, minimal identity coupling, and non-custodial/read-only product guardrails ahead of any future accounts, subscriptions, billing, multi-device sync, third-party product analytics, or user↔wallet ownership implementation. This trigger does not apply to CoinPulse's existing first-party portfolio/dashboard/PnL analytics. The full principles — domain separation between blockchain identity and user identity, the privacy-sensitivity of any user↔wallet association, account-optional wallet inspection as a future goal, an absolute prohibition on ever requesting or storing seed phrases/private keys, local-first watchlists and client-side-encrypted sync as future guardrails, entitlement/billing separation, request-path privacy beyond schema design, privacy-minimized telemetry, no-ads and no-sale-of-portfolio-data principles, data minimization and classification, and required review triggers before implementing any of accounts/auth/subscriptions/billing/permanent-user-wallet-associations/cross-device-sync/wallet-signatures/third-party-product-analytics/advertising — are recorded in full in `docs/architecture/pulseicon-privacy-decentralization-principles.md` §21, the canonical and complete trigger list; every summary here is non-exhaustive.

**Rationale:** Retrofitting privacy-by-architecture after a conventional `User.hasMany(Wallet)` ownership model, ad-supported monetization, or a plaintext account↔wallet join already exists in production is far more costly and risky than establishing the guardrail before that code is written. CoinPulse's backend-truth-first architecture (D-001) already gives the project a single accounting truth source; this decision adds the complementary constraint that human user identity must not casually become entangled with that canonical blockchain identity as commercial features are added.

**Implications:** Any future PR implementing accounts, authentication, subscriptions, billing, permanent user↔wallet associations, cross-device wallet sync, wallet ownership verification, wallet signatures, notifications tied to wallets, third-party product analytics, advertising, public portfolio profiles, portfolio sharing, account recovery for encrypted user data, or client-side cryptography must be evaluated against `docs/architecture/pulseicon-privacy-decentralization-principles.md` §21 (the canonical, complete review-trigger list — this is a summary, not a substitute for reading §21 directly) before implementation begins. No such feature is implemented, scheduled, or scoped by this decision.

**Do not:** Treat this decision as implementing accounts, subscriptions, billing, encryption, wallet sync, or any other feature described in the companion document — none is introduced by this PR. Do not treat the companion document's product-direction language (PulseIcon naming, account-optional goals) as authorization for a repository-wide rename from CoinPulse to PulseIcon, or as changing any existing DTO, schema, API, or frontend behavior. Do not weaken D-001, D-004, D-005, D-007, or D-008 based on this decision — §1 and §25 of the companion document are explicit that privacy goals must never come at the cost of backend-truth-first architecture. Do not cite this document as marketing evidence of a privacy claim (e.g., "anonymous," "we collect nothing," "encrypted sync") until the specific claim is actually implemented and verified — see the companion document §19.
