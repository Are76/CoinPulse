# CoinPulse Project Decisions

**Last updated:** 2026-06-14

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

**Evidence:** [E1] `CLAUDE.md`; `docs/v2-hexmining-roadmap.md` §Next PR.

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

## D-018: Public Estimated Yield Remains Gated Until Gate 10 Is Satisfied

**Status:** Active — Gate 10 OPEN

**Evidence:** [E1] `docs/v2-hexmining-roadmap.md` §11.14; `docs/hexmining-gate10-execution-plan.md`.

**Decision:** Public estimated yield (`status: "estimated"`, non-null `estimatedYieldHex`) must not be exposed until Gate 10 (live-data verification) is satisfied and documented.

**Rationale:** Infrastructure PRs (#234–#237) closed the reader/route/test coverage chain. They are not a gate lift. The gate lift requires verified live-data evidence.

**Implications:** Until Gate 10 passes, the production estimator returns `status: "evidence_available"`, `yieldHex: null`. The reader maps this to `status: "unavailable"` in the public DTO.

**Do not:** Promote `"estimated"` in public output without a passing Gate 10 evidence package.

---

## D-019: Gate 10 Requires Documented Evidence

**Status:** Active — not yet executed

**Evidence:** [E1] `docs/hexmining-gate10-execution-plan.md`; `docs/hexmining-gate10-evidence-template.md`.

**Decision:** Gate 10 requires: a real `HexMiningObservation` record on PulseChain (chain ID 369), a passing verification harness run, and a sanitized evidence package committed in the gate-lift PR.

**Rationale:** Evidence must be reproducible and reviewable. It cannot be asserted or fabricated.

**Implications:** Gate 10 cannot be executed without a live PostgreSQL instance, a PulseChain RPC endpoint, and real ingested observation data.

**Do not:** Declare Gate 10 passed without a recorded, sanitized evidence package.

---

## D-020: Operator Tools Do Not Lift Gates

**Status:** Active

**Evidence:** [E1] `docs/hexmining-gate10-execution-plan.md`; `docs/v2-hexmining-roadmap.md`.

**Decision:** The existence of operator and runner scripts (`gate10-runner.ts`, `hexmining-dailydata-observation-fetch.ts`, `verification-harness.ts`) does not mean Gate 10 is lifted or that public estimated yield is exposed.

**Rationale:** Operator tools are execution infrastructure only. The gate is lifted only by a specific gate-lift PR with recorded evidence.

**Implications:** Any AI that sees these scripts must not infer that the gate is open.

**Do not:** Conclude from the presence of runner/harness scripts that the gate-lift has occurred.

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

**Evidence:** [E2] PR #247 merged; [E3] `scripts/hexmining-gate10-run.ts`.

**Decision:** `stakeShares` must be validated as a non-negative bigint (`>= 0n`) before being used in yield calculations. Negative stakeShares must be rejected with a clear error at the runner boundary. [E3] The current gate10-runner guard rejects `< 0n`; zero passes through to the harness/estimator where it produces a zero-yield result rather than a runner-level error.

**Rationale:** A negative stakeShares value would produce an invalid yield estimate. PR #247 added this guard to the Gate 10 runner. Whether zero stakeShares should also be a runner-level hard error is a separate policy question not yet resolved by repo code.

**Implications:** The runner currently enforces `>= 0n`. Zero stakeShares produces a zero-yield path, not a runner rejection. If the project decides zero must be rejected at the runner, an additional `=== 0n` guard is needed.

**Do not:** Pass negative `stakeShares` to the yield estimator or Gate 10 runner. Do not assume zero is currently rejected at the runner boundary.

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

**Decision:** Documentation must not state that a gate is lifted unless the code, tests, and roadmap docs all agree that the lift has occurred. Docs drift is a hard stop.

**Rationale:** A docs claim that a gate is lifted without code/test confirmation would mislead future AI agents and Are into proceeding with public exposure prematurely.

**Implications:** Any docs PR that updates gate status must include the PR reference that actually lifted the gate, and must not be merged before the implementation PR.

**Do not:** Write "Gate 10 PASSED" or "Gate 10 RESOLVED" in any doc without a recorded, merged gate-lift implementation PR with evidence.
