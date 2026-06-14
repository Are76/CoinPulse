# CoinPulse AI Handoff

**Last updated:** 2026-06-14

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

## Current Project Status (after PR #249)

**Backend/DTO truth posture:** The canonical backend pipeline is the source of truth. All DTO contracts expose `schemaVersion`, provenance, freshness, status, and warnings. No production DTO contains mock fallback truth. [E2]

**Frontend query posture:** TanStack Query is used for all reads via hooks in `src/lib/query/use-*.ts`. Query key conventions and staleTime/gcTime policy are documented in `docs/data-fetching-architecture.md`. [E1]

**HexMining / Gate 10 posture:** Phase 4C internal pipeline is complete. Public estimated yield remains intentionally gated. Gate 10 is OPEN — live-data verification has not been executed. [E1] [E2]

**Source/RPC policy posture:** PR #249 removed the hardcoded `pulsechainstats.com` RPC default. No third-party RPC default is hardcoded. Runtime/operator/env/CLI-supplied RPC is the authoritative transport. PR #246 established the accepted authoritative PulseChain source reference doc. [E2]

---

## HexMining / Gate 10 Current State

> **WARNING: Do not assume Gate 10 is lifted from the existence of runner/operator scripts, tests, or infrastructure PRs.**

**Gate 10 status:** OPEN. [E1]

**Gate 11 status:** OPEN. Depends on Gate 10 passing. [E1]

**Public estimated yield:** NOT exposed. The production estimator returns `status: "evidence_available"`, `yieldHex: null` for valid evidence paths. This is the gated internal state — not public output. [E1] [E3]

**What is complete (PRs #208–#237):**
- Yield formula: complete and internally verified. [E2]
- BPD attribution gate: resolved at estimator boundary. [E2]
- DTO contract (`HexStakeYieldDto`): approved in PR #232. [E2]
- Reader assembly: PR #234 — reader can carry injected estimate result through approved DTO path. [E2]
- Route dependency wiring: PR #235 — route passes `estimateYield` into `readNativeHexStakes`. [E2]
- Contract tests for full DTO path: PR #236. [E2]
- Closure documentation: PR #237. [E2]

**What is NOT yet done (Gate 10 remaining items):**
- Item 10: Live-data fixture or opt-in integration verification against a known historical day range on PulseChain (chain ID 369). Must follow `docs/hexmining-live-data-verification-plan.md` and `docs/hexmining-gate10-execution-plan.md`. [E1]
- Item 11: Final docs record approving the gate lift — roadmap must be updated with gate-lifted evidence and PR reference only after item 10 passes. [E1]
- Final production promotion: change the gated `evidence_available` return in `yield-estimator.ts` to surface `"estimated"` with non-null `yieldHex`. [E1]

**Operator tools available (do NOT treat as gate-lift):**
- `scripts/hexmining-gate10-run.ts` — Gate 10 runner script. Operator use only; does not lift the gate. [E3]
- `scripts/hexmining-dailydata-observation-fetch.ts` — Fetches and persists a dailyData observation from PulseChain. Operator/ingestion tool only; does not lift the gate. [E3]
- `src/services/hexmining/verification-harness.ts` — Verification harness used during Gate 10 execution. Does not itself lift the gate. [E3]

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

---

## Next-Step Posture

Before any public estimated-yield promotion: [E5]

1. Collect live-data verification evidence using `docs/hexmining-gate10-execution-plan.md` and the verification harness.
2. Record the sanitized evidence package.
3. Review the evidence against all Gate 10 success criteria.
4. Only after Gate 10 passes: open a separate, bounded gate-lift implementation PR that updates the roadmap, promotes the production estimator, and records Gate 11 evidence.

Do not combine Gate 10 evidence collection with the gate-lift promotion PR. [E1]

Do not expose public estimated yield based on the existence of runner or operator tools alone. [E1]

---

## New Conversation Startup Block

Copy and paste this block at the start of any new AI session for CoinPulse:

```text
Read docs/ai-handoff.md first.

Then read the specific PR, roadmap, or docs I mention.

Do not assume Gate 10 is lifted.
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
4. verify push capability (git push -u origin HEAD with an empty branch before doing heavy analysis),
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
