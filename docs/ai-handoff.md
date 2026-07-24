# CoinPulse AI Handoff

**Last updated:** 2026-07-24 (D-032: HexMining Phase 1 completion scope defined as native pHEX only)

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

## Current Project Status (after PR #319)

**Backend/DTO truth posture:** The canonical backend pipeline is the source of truth. All DTO contracts expose `schemaVersion`, provenance, freshness, status, and warnings. No production DTO contains mock fallback truth. [E2]

**Frontend query posture:** TanStack Query is used for all reads via hooks in `src/lib/query/use-*.ts`. Query key conventions and staleTime/gcTime policy are documented in `docs/data-fetching-architecture.md`. [E1]

**HexMining posture:** Phase 4C complete and gate-lifted (PR #252). Phase 5 complete (PRs #307–#310). Public estimated yield is live for valid evidence paths. Ended stake pipeline (persistence, discovery, reader, DTO, API route) is live. Phase 6 **HSI backend implementation is complete** (PRs #312–#317: persistence, discovery, reader enrichment, live-verification tooling), but HSI is **not yet exposed via the public DTO/API** — `HexStakeSource` is still `"native"` only and `GET /api/hexmining/stakes` still calls only `readNativeHexStakes`. **HSI live verification is deferred pending availability of an HSI-owning wallet** (the tooling shipped but no live run occurred). Public HSI DTO/API integration, the **HTT** source family within Phase 6, and Phase 7 (pricing/valuation/PnL) are not started. Native active-stake reads (Phase 2) gained live-verification tooling (#318) — a live run against the fixture wallet recorded stakeCount 32 / 32 with all checks passing — and deterministic single-block read pinning (#319). [E1] [E2] [E3]

**Source/RPC policy posture:** PR #249 removed the hardcoded `pulsechainstats.com` RPC default. No third-party RPC default is hardcoded. Runtime/operator/env/CLI-supplied RPC is the authoritative transport. PR #246 established the accepted authoritative PulseChain source reference doc. [E2]

---

## HexMining Phase 1 Completion Scope (D-032)

**Canonical decision:** D-032 in `docs/project-decisions.md`, accepted 2026-07-24. [E1]

**HexMining Phase 1 = native pHEX stakes on PulseChain (chain ID 369), active + ended.** Phase 1 completion is measured against this scope only. [E1]

- **In scope:** native active stakes; native ended stakes (discovery, evidence completion/recovery, reader, DTO, API, UI); backend-canonical persistence and evidence; DTO/API contracts; frontend display of active and ended native stakes; backend-provided estimated yield with provenance/warnings; bigint/string-safe display formatting; no frontend computation of yield, pricing, valuation, or PnL. [E1]
- **Later-phase scope (deferred, not dropped):** public HSI DTO/API exposure, HSI frontend UI, HSI live verification, HTT, Ethereum eHEX and all non-PulseChain chains, and Phase 7 pricing/valuation/PnL. [E1]
- **HSI:** backend foundation code exists on `main` (PRs #312–#317) but HSI is **not publicly finished** — `HexStakeSource` is `"native"` only, the public stakes route calls only `readNativeHexStakes`, and HSI live verification is blocked by the lack of an HSI-owning wallet/evidence. **Do not pull HSI into Phase 1 without a new explicit decision superseding D-032.** [E1] [E3]
- Frontend rules stand unchanged: no direct frontend RPC, and no frontend computation of yield, pricing, valuation, or PnL. [E1]

**Ended-stake follow-ups merged after this file's PR-timeline cutoff (verify details in git log):** operator discovery trigger (#333), start-time stake evidence persistence (#334), completion from start evidence (#335), reader/API verification tooling (#336), historical contract-state evidence recovery (#337), frontend ended-stake history (#340). Ended-stake operator evidence (verification and recovery execute runs) is still `PENDING OPERATOR EXECUTION` — do not claim it was recorded. [E2] [E3]

**Transfer-backfill posture (unrelated to HexMining scope, recorded here for the next agent):** the TRANSFER-family backfill is **paused after Window 60**. Window 61 requires explicit operator approval before any run. PR #341 (multi-window runner batch fix) is a runner correctness fix only — **it does not authorize further transfer-backfill execution.** [E2] [E4]

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

**What is complete after Phase 6 HSI implementation (PRs #312–#317):**
- `RawHsiStakeObservation` persistence model and idempotent store. [E2] [E3]
- `discoverHsiStakes()` — reads HSI NFT ownership, pins reads to a captured `observedAtBlock`, rejects unsupported `chainId` before RPC/persistence. [E2] [E3]
- HSI reader (stake enrichment) — enriches persisted observations and flips `isComplete`. [E2] [E3]
- HSI live-verification **tooling** (`runHsiLiveVerification`, CLI wrapper, runbook, evidence template) — mock-validated; presence/consistency booleans only. [E2] [E3]
- Note: this is a **backend pipeline only**. HSI is not exposed via the public DTO/API — `HexStakeSource` is typed `"native"` only and `GET /api/hexmining/stakes` calls only `readNativeHexStakes`. Public HSI DTO/API integration is not yet done. [E3]

**What is complete for native active-stake reads (PRs #318–#319):**
- Native active-stake live-verification tooling (#318) — operator runner/CLI/runbook/evidence, mock-tested; a live run against fixture wallet `0x75f808367720951e789d47e9e9db51148d9aa765` recorded stakeCount 32 / enumeratedCount 32 with all checks passing. This runner reads native `stakeCount`/`stakeLists` only and does not query HSI/ERC-721 ownership. [E2] [E3]
- Production native stake reader block pinning (#319) — `readNativeHexStakes` pins every `stakeCount`/`stakeLists` read to a single captured block, with graceful `latest` fallback preserved. [E2] [E3]

**What is still deferred after Phase 6 HSI implementation:**
- **HSI live verification — NOT completed. Deferred pending availability of an HSI-owning wallet.** PR #316 shipped tooling only; no live run occurred and the evidence template is `PENDING OPERATOR EXECUTION`. No HSI-owning wallet is currently available to verify against. Do not state that HSI verification passed. [E1] [E2]
- **Public HSI DTO/API integration** — `HexStakeSource` (`"hsi"`), public DTO fields, and route wiring not yet done. [E1] [E3]
- **HTT** (Hedron Token Transfer / Actuator delegated) source family — not started. [E1]
- `lockedDay` and `stakeShares` recovery / exact yield (`status: "exact"`) for ended stakes — no on-chain backfill implemented; no ended-stake live verification exists. [E1]
- HexMining pricing, valuation, and PnL remain Phase 7; `valuation.status` and `pnl.status` stay `"unsupported"`. [E1] [E3]
- Ended stake and HSI frontend UI — no display in the app. [E1]
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
| #311 | Phase 5 implementation-status finalization docs | [E2] |
| #312 | Phase 6 HSI Slice 1 — `RawHsiStakeObservation` model, migration, and observation store | [E2] |
| #313 | HSI Slice 1 hardening — `RawHsiStakeObservation` identity/storage safety and migration index naming | [E2] |
| #314 | Phase 6 HSI Slice 2 — `discoverHsiStakes()` discovery service (block-pinned, chainId-guarded) | [E2] |
| #315 | Phase 6 HSI Slice 3 — HSI reader (stake enrichment) | [E2] |
| #316 | Phase 6 HSI Slice 4 — HSI live-verification **tooling** (no live run; evidence `PENDING OPERATOR EXECUTION`) | [E2] |
| #317 | Docs — align `RawHsiStakeObservation` comment with two-phase lifecycle | [E2] |
| #318 | Native active-stake live-verification tooling — live run recorded stakeCount 32/32, all checks passed | [E2] |
| #319 | Production native stake reader pins `stakeCount`/`stakeLists` reads to a single captured block | [E2] |

---

## Post-Phase-6-HSI-Implementation Posture

After PRs #252 (Gate 11), #307–#310 (Phase 5), #312–#317 (Phase 6 HSI implementation), and #318–#319 (native active-stake verification/pinning): [E1] [E2] [E3]

1. Gate 10 evidence collection is complete; Gate 11 public estimated-yield promotion is merged.
2. Valid evidence paths may surface public `status: "estimated"` with non-null `estimatedYieldHex`; BPD-spanning ranges still carry `bpdYieldHex: null` plus warning.
3. Phase 5 ended stake pipeline is complete (persistence, discovery, reader, DTO, API route). Ended stake observations always have `isComplete: false` and `lockedDay: null` at discovery time — no on-chain backfill, and no ended-stake live verification exists.
4. Phase 6 **HSI backend implementation is complete**: persistence (#312–#313), discovery (#314), reader enrichment (#315), and live-verification tooling (#316) are all live. HSI is **not yet exposed via the public DTO/API** (`HexStakeSource` is `"native"` only; the public stakes route calls only `readNativeHexStakes`) — public HSI DTO/API integration is not started.
5. **HSI live verification is NOT completed. It is deferred pending availability of an HSI-owning wallet.** The tooling shipped but no live run occurred; the evidence template is `PENDING OPERATOR EXECUTION`. No HSI-owning wallet is currently available. Do not claim HSI verification passed.
6. Native active-stake reads (Phase 2) now have live-verification tooling (#318, live run recorded 32/32 stakes, all checks passed) and single-block read pinning in the production reader (#319).
7. The **HTT** source family (rest of Phase 6), Phase 7 pricing/valuation/PnL, frontend ended-stake/HSI UI, ended-stake exact-yield, and Ethereum eHEX all remain deferred to their documented phases.

Do not treat Phase 6 HSI implementation as approval for HSI live-verification claims, HTT, Phase 7, Ethereum/Base execution, frontend accounting/pricing/PnL logic, or ended-stake exact-yield. [E1]

---

## New Conversation Startup Block

Copy and paste this block at the start of any new AI session for CoinPulse:

```text
Read docs/ai-handoff.md first.

Then read the specific PR, roadmap, or docs I mention.

Treat Gate 10 and Gate 11 as lifted by PR #252. Phase 5 (ended stake pipeline) is complete via PRs #307–#310. Phase 6 HSI implementation is complete via PRs #312–#317, but HSI live verification is deferred pending an HSI-owning wallet (do not claim it passed). Native active-stake verification tooling (#318) and reader block pinning (#319) are merged. Do not infer HTT, Phase 7, or any HSI live-verification pass from HSI implementation completion.

HexMining Phase 1 completion scope is defined by D-032 (docs/project-decisions.md): native pHEX only (active + ended, chainId 369). HSI/HTT/eHEX and pricing/valuation/PnL are later-phase scope and do not block Phase 1 completion. Do not pull HSI into Phase 1 without a new decision superseding D-032. Transfer-backfill is paused after Window 60; Window 61 needs explicit operator approval; PR #341 does not authorize further backfill runs.
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
