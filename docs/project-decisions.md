# CoinPulse Project Decisions

**Last updated:** 2026-07-24

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
