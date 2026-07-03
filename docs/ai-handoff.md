# CoinPulse AI Handoff

**Last updated:** 2026-07-03

---

## Purpose

This is the short-form canonical AI handoff document for CoinPulse. It does not replace detailed roadmap docs. It should be read at the start of any new ChatGPT, Claude, or Codex session before doing any implementation work. It records current project status, non-negotiable guardrails, and next-step posture. [E1]

---

## Evidence Model

All claims in this file are tagged:

- `[E1]` Verified from repository documentation
- `[E2]` Verified from merged PR metadata / git log
- `[E3]` Verified from code, tests, scripts, config, or CI files
- `[E4]` Project/user operating instruction from handoff context
- `[E5]` Inference or recommendation, not a repo fact

Do not treat `[E4]` or `[E5]` as repo fact.

---

## Are / User Operating Model

- Are is the product owner and project manager. Are is not a developer. [E4]
- AI assistants (ChatGPT, Claude, Codex) function as senior code expert, project manager, auditor, reviewer, and prompt generator. [E4]
- Coding is performed by Codex or Claude on explicit prompts. [E4]
- Prompts must be complete and explicit — never rely on AI to fill in missing context. [E4]
- Work should be one bounded PR at a time. No scope creep. [E4]
- Always include clean working tree check, origin/main sync, base branch, auth/push capability verification, and hard-stop rules in future prompts. [E4]
- Future prompts should require final reports inside a single Markdown code block so Are can copy them back to ChatGPT. [E4]

---

## Environment / Auth Workflow Lessons

These are active guardrails derived from prior project failures. [E4]

1. **Verify GitHub auth before heavy work.** Confirm the environment can reach the remote before doing any analysis.
2. **Verify remote/origin exists.** Run `git remote -v` before anything else.
3. **Verify push capability early.** Push an empty branch before reading huge docs or doing long analysis. If push fails, hard stop.
4. **Hard stop if push/auth is missing.** Do not spend time reading a large roadmap and then discover the environment cannot open a PR.
5. **For huge roadmap/docs, inspect headings and size first.** Use `wc -l`, `grep "^#"`, and targeted section reads. Do not blindly load entire large files.
6. **Verify branch creation on the correct base.** Confirm `git branch --show-current` and `git rev-parse --short HEAD` match the expected state before writing files.

---

## Non-Negotiable Architecture Guardrails

These rules apply to every PR. [E1]

- **Backend truth first.** PostgreSQL/canonical backend state is the source of truth. [E1]
- **RPC is ingestion/operator input only.** No frontend RPC reads. [E1]
- **Frontend consumes versioned backend DTOs only.** It does not reconstruct accounting truth. [E1]
- **No frontend computation** of balances, prices, valuation, PnL, LP values, stake values, or yield. [E1]
- **No DexScreener as primary truth.** Use on-chain PulseChain reserve-derived pricing only. [E1]
- **No symbol-as-identity.** Always use `chain:369:erc20:0x...` (`assetId` format). [E1]
- **No mock fallback truth in production DTOs.** Mock/test data must not become production DTO fallback truth. [E1]
- **No zero coercion.** Missing, stale, or unavailable values must remain explicit with provenance and warnings. [E1]
- **Bigint-safe math.** On-chain quantities (hearts, shares) must use bigint arithmetic. [E3]
- **Chain-aware identity.** Assets are identified by `chainId + tokenAddress`, not by symbol. [E1]
- **PulseChain (chain ID 369) is the current V1 execution target.** [E1]
- **Ethereum/Base/cross-chain execution is future scope only.** Not current V1 scope unless docs explicitly say otherwise. [E1]
- **Raw audit records are immutable.** Mark reorgs as REORGED — never delete or overwrite. [E1]

---

## Current Project Status (after PR #310)

**Backend/DTO truth posture:** The canonical backend pipeline is the source of truth. All DTO contracts expose `schemaVersion`, provenance, freshness, status, and warnings. No production DTO contains mock fallback truth. [E2]

**Frontend query posture:** TanStack Query is used for all reads via hooks in `src/lib/query/use-*.ts`. Query key conventions and staleTime/gcTime policy are documented in `docs/data-fetching-architecture.md`. [E1]

**HexMining posture:** Phase 4C complete and gate-lifted (PR #252). Phase 5 complete (PRs #307–#310). Public estimated yield is live for valid evidence paths. Ended stake pipeline (persistence, discovery, reader, DTO, API route) is live. Phase 6 (HSI/HTT) and Phase 7 (pricing/valuation/PnL) are not started. [E1] [E2] [E3]

**Source/RPC policy posture:** PR #249 removed the hardcoded `pulsechainstats.com` RPC default. No third-party RPC default is hardcoded. Runtime/operator/env/CLI-supplied RPC is the authoritative transport. PR #246 established the accepted authoritative PulseChain source reference doc. [E2]

---

## HexMining Post-Gate-11 Current State

> **WARNING: Gate 10 / Gate 11 were lifted by PR #252 only. Do not infer future HexMining phases from the existence of runner/operator scripts, tests, or infrastructure PRs.**

**Gate 10 status:** PASSED / RESOLVED by PR #252. Gate 10 executed 2026-06-14 using stakeId 942663, stakeShares 1414291579679, lockedDay 2310, rangeStartDay 2310, rangeEndDay 2384 (75 entries), reproducedYieldHex `"20589444841"`, all 9 criteria passed, and the harness returned `verified: true`. [E1] [E2]

**Gate 11 status:** PASSED / RESOLVED by PR #252. The production estimator promotion is merged. [E1] [E2] [E3]

**Public estimated yield:** Exposed for valid evidence paths. The production estimator returns `status: "estimated"`, `yieldHex: string`, `bpdYieldHex: null` for BPD-spanning ranges with the BPD attribution warning, and complete provenance. The reader maps this into public `HexStakeYieldDto.status: "estimated"` with non-null `estimatedYieldHex` when provenance is complete. [E1] [E3]

**What is complete (PRs #208–#252):**
- Yield formula: complete and internally verified. [E2]
- BPD attribution gate: resolved at estimator boundary. [E2]
- DTO contract (`HexStakeYieldDto`): approved in PR #232. [E2]
- Reader assembly: PR #234 — reader can carry injected estimate result through approved DTO path. [E2]
- Route dependency wiring: PR #235 — route passes `estimateYield` into `readNativeHexStakes`. [E2]
- Contract tests for full DTO path: PR #236. [E2]
- Closure documentation: PR #237. [E2]
- Gate 10 live-data evidence: PR #252 — real PulseChain historical day range verified. [E2]
- Gate 11 production promotion: PR #252 — valid evidence paths surface public `"estimated"` yield. [E2] [E3]

**What is complete after Phase 5 (PRs #307–#310):**
- `RawEndedHexStakeObservation` persistence model and idempotent store. [E2] [E3]
- `discoverEndedHexStakes()` — reads `RawStakeAction` END records, cross-references START records, persists observations. [E2] [E3]
- `readEndedHexStakes()` — reads persisted observations and assembles `EndedHexStakeListDto`. [E2] [E3]
- `EndedHexStakeDto` and `EndedHexStakeListDto` — typed DTO contracts with bigint-as-string serialization. [E2] [E3]
- `GET /api/hexmining/ended-stakes` — read-only API route with Zod validation and error envelopes. [E2] [E3]

**What is still deferred after Phase 5:**
- `lockedDay` and `stakeShares` recovery / exact yield (`status: "exact"`) — no on-chain backfill implemented. [E1]
- HSI/HTT source families remain Phase 6. [E1]
- HexMining pricing, valuation, and PnL remain Phase 7; `valuation.status` and `pnl.status` stay `"unsupported"`. [E1] [E3]
- Ended stake frontend UI — no display in the app. [E1]
- Ethereum eHEX remains future scope. [E1]

**Operator tools available (do NOT treat as gate-lift):**
- `scripts/hexmining-gate10-run.ts` — Gate 10 runner script. Operator use only; its existence alone did not lift the gate. [E3]
- `scripts/hexmining-dailydata-observation-fetch.ts` — Fetches and persists a dailyData observation from PulseChain. Operator/ingestion tool only; its existence alone did not lift the gate. [E3]
- `src/services/hexmining/verification-harness.ts` — Verification harness used during Gate 10 execution. Its existence alone did not lift the gate. [E3]

---

## Recent Critical PR Timeline

| PR | Summary | Evidence |
|---|---|---|
| #200–#202 | Phase 4A: observation persistence, status API, operator surface | [E2] |
| #204–#206 | Phase 4B: dailyDataRange read boundary, persistence wiring, gated operator route | [E2] |
| #211–#214 | dailyData packed decoder decisions: `dailyDataRange` returns `uint256[]`; packed 72+72+56 bit layout; bigint-safe decoding required | [E2] |
| #215 | Yield estimator formula scaffold | [E2] |
| #217 | Yield estimator decodes dailyData | [E2] |
| #221 | Yield estimator formula vectors | [E2] |
| #224 | EES/penalty distribution research — penalties already included in `dayPayoutTotal` | [E2] |
| #225 | Elapsed-days-only coverage rule resolved | [E2] |
| #226 | BPD attribution gate resolved at estimator boundary | [E2] |
| #227 | §11.9 provenance fields resolved | [E2] |
| #232 | DTO contract (`HexStakeYieldDto`) approved — OQ-1–OQ-6 resolved | [E2] |
| #233 | Roadmap split into active + archive | [E2] |
| #234 | Reader assembly — injectable `estimateYield` results can carry through approved DTO path | [E2] |
| #235 | Route dependency wiring — `/api/hexmining/stakes` passes `estimateYield` | [E2] |
| #236 | Contract tests for full public estimated-yield DTO path | [E2] |
| #237 | Closure documentation for yield route/DTO/reader coverage | [E2] |
| #238 | Live-data verification plan — establishes Gate 10 policy | [E2] |
| #239 | Verification harness added | [E2] |
| #240 | Gate 10 execution plan | [E2] |
| #241 | Gate 10 evidence package template | [E2] |
| #242 | Gate 10 operator runbook | [E2] |
| #243 | Gate 10 runner and tests | [E2] |
| #244, #245 | Closed unmerged — do not treat as accepted policy | [E2] (absent from git log of merged commits) |
| #246 | PulseChain authoritative data sources reference — accepted source policy doc | [E2] |
| #247 | Negative stakeShares guard added to gate10-runner | [E2] |
| #248 | dailyData observation fetch operator utility | [E2] |
| #249 | Hardcoded `pulsechainstats.com` RPC default removed per source policy | [E2] |
| #250 | AI handoff and project decision docs added | [E2] |
| #251 | Operator environment reference added | [E2] |
| #252 | Gate 10 evidence collected and Gate 11 public estimated-yield promotion merged | [E2] |
| #253 | Materialization warning order assertion stabilized | [E2] |
| #254 | Materialization negative-balance order assertion stabilized | [E2] |
| #255 | Post-Gate-11 status reconciliation docs | [E2] |
| #256 | HexMining estimated yield rendered in stake table UI | [E2] |
| #257 | HexMining missing evidence coverage report added | [E2] |
| #258 | HexMining estimated yield display units formatted (hearts → HEX decimal) | [E2] |
| #259 | Displayed numbers inventory doc added | [E2] |
| #260 | Pricing status numbers surfaced as read-only cards | [E2] |
| #261 | Missing evidence debug UI added at `/debug/hexmining/evidence/missing` | [E2] |
| #262 | AI-agent worktree folders added to `.gitignore` and ESLint ignore | [E2] |
| #263 | API client fetch helper consolidated (frontend chore) | [E2] |
| #264 | PnL edge-status route contract tests added (low-confidence price, summary warning deduplication) | [E2] |
| #265 | Token metadata stale/conflicting provenance route contract tests added | [E2] |
| #307 | Phase 5 Slice 1 — `RawEndedHexStakeObservation` model, migration, and observation store | [E2] |
| #308 | Phase 5 Slice 2 — `discoverEndedHexStakes()` discovery service | [E2] |
| #309 | Phase 5 Slice 3 — `readEndedHexStakes()`, `EndedHexStakeDto`, `EndedHexStakeListDto` | [E2] |
| #310 | Phase 5 Slice 4 — `GET /api/hexmining/ended-stakes` read-only API route | [E2] |

---

## Post-Phase-5 Posture

After PRs #252 (Gate 11) and #307–#310 (Phase 5): [E1] [E2] [E3]

1. Gate 10 evidence collection is complete.
2. Gate 11 public estimated-yield promotion is merged.
3. Valid evidence paths may surface public `status: "estimated"` with non-null `estimatedYieldHex`.
4. BPD-spanning ranges still carry unresolved BPD attribution as `bpdYieldHex: null` plus warning.
5. Phase 5 ended stake pipeline is complete: persistence, discovery, reader, DTO assembly, and API route are all live.
6. Ended stake observations always have `isComplete: false` and `lockedDay: null` at discovery time — no on-chain backfill is implemented.
7. Pricing, valuation, PnL, HSI/HTT, frontend ended-stake UI, and Ethereum eHEX remain deferred to their documented phases.

Do not treat Phase 5 completion as approval for Phase 6, Phase 7, Ethereum/Base execution, frontend accounting/pricing/PnL logic, or ended-stake exact-yield. [E1]

---

## New Conversation Startup Block

Copy and paste this block at the start of any new AI session for CoinPulse:

```text
Read docs/ai-handoff.md first.

Then read the specific PR, roadmap, or docs I mention.

Treat Gate 10 and Gate 11 as lifted by PR #252. Phase 5 (ended stake pipeline) is complete via PRs #307–#310. Do not infer Phase 6 or Phase 7 from either gate lift or Phase 5 completion.
Do not propose runtime changes until you identify:
1. current latest merged PR,
2. current gate/status,
3. affected docs,
4. affected tests,
5. whether the task is docs-only, code-only, or operator-only.

Before heavy work:
1. verify repo (git status -sb, git remote -v, git rev-parse --show-toplevel),
2. verify origin/main (git fetch origin, git checkout main, git pull --ff-only origin main),
3. verify GitHub auth (git ls-remote origin HEAD),
4. verify push capability (create the task branch first, then git push -u origin HEAD to confirm push works before doing heavy analysis),
5. inspect large docs by headings first (wc -l, grep "^#").

Always separate verified repo facts from assumptions.

Return final reports inside one Markdown code block using the required format.
```

---

## Maintenance Rule

Update this file only when one or more of the following changes:

- Core architecture rules
- Gate / gating status
- Source policy or RPC policy
- Project milestone
- Environment or auth workflow lessons
- AI operating posture

Do not update this file for every small PR. The PR timeline section should be updated when Gate 10 or Gate 11 completes, or when a new milestone changes the gate/status summary.
