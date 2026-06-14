# CoinPulse Operator Environments

**Last updated:** 2026-06-14

---

## 1. Purpose

This file supplements `docs/ai-handoff.md` and `docs/project-decisions.md`. It documents the execution environments in which CoinPulse tasks are performed and clarifies which resources are available in each environment.

Its primary audience is AI assistants (Claude, Codex, ChatGPT) and human operators. It exists to prevent AI assistants from assuming the availability of resources that do not exist in their current environment — a recurring failure mode that has wasted operator effort.

**This file does not change runtime behavior. It is reference documentation only.**

---

## 2. Environment Types

### 2.1 Local Operator Workstation

The operator's own machine where the repository was originally developed. This is the environment in which database access, RPC access, and secret management are routinely available.

**Expected characteristics:**

- Local repository checkout (`git clone`)
- `.env` file present with valid values
- `DATABASE_URL` available and pointing to a live PostgreSQL 17 instance (via `docker compose up -d`)
- `REDIS_URL` available (via `docker compose up -d`)
- `PULSECHAIN_RPC_URL` available (operator-provided; no hardcoded default — see PR #249 and D-024)
- Local filesystem with persistent state
- Local Git access with GitHub auth configured
- Ability to run `npm run dev`, `npm run test`, operator scripts

**Safe assumptions on a local workstation:**

- `.env` is available (operator configured it)
- Docker services are available after `docker compose up -d`
- `git push` is possible if GitHub auth is configured
- `npx tsx scripts/hexmining-*.ts` can be run with explicit `--rpcUrl`
- Database queries and mutations are possible

**Unsafe assumptions on a local workstation:**

- Do not assume Docker is running — verify first
- Do not assume `.env` is populated — verify env vars before operator scripts
- Do not assume any hardcoded RPC URL — operator must supply `PULSECHAIN_RPC_URL`
- Do not assume main is current — run `git pull --ff-only origin main` first

---

### 2.2 Claude Cloud Environment

The remote execution environment used when Claude Code is accessed via the web app, mobile app, GitHub Action, or remote session. The repository is cloned fresh into an ephemeral container. The container does not have access to the operator's local filesystem, local `.env`, or local database.

**Expected characteristics:**

- Repository files are available (fresh clone from GitHub)
- `.env` file is NOT present (ephemeral container has no access to operator secrets)
- `DATABASE_URL`: NOT available unless explicitly injected into the session environment
- `REDIS_URL`: NOT available unless explicitly injected
- `PULSECHAIN_RPC_URL`: NOT available unless explicitly injected
- Filesystem is ephemeral — data written here does not persist after the session
- GitHub read access is available (can fetch, read, inspect)
- GitHub push capability: available via MCP GitHub tools (`mcp__github__push_files`, `mcp__github__create_pull_request`) even when CLI `git push` returns HTTP 403
- CLI `git push` may fail with HTTP 403 for content pushes in this environment (known behavior; use MCP tools instead)
- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` can be run if dependencies are installed and no live DB/RPC is required

**Safe assumptions in Claude Cloud:**

- Repository files can be read, edited, and committed locally
- GitHub MCP tools can push commits and open PRs
- Docs-only PRs, code review, architecture review, and analysis work can be performed
- Tests that do not require a live DB or RPC can be run

**Unsafe assumptions in Claude Cloud:**

- Do NOT assume `.env` is present — it is not
- Do NOT assume `DATABASE_URL`, `REDIS_URL`, or `PULSECHAIN_RPC_URL` are available
- Do NOT assume database queries or mutations are possible
- Do NOT assume observation-fetch or Gate 10 scripts can be run
- Do NOT assume stake discovery against live DB is possible
- Do NOT assume `git push` via CLI will succeed — prefer MCP push tools
- Do NOT assume filesystem state persists between sessions

---

### 2.3 Codex Cloud Environment

The remote execution environment used when GitHub Copilot Codex (workspace or agent) runs tasks. Similar to Claude Cloud in key constraints, but with additional Git bootstrap differences.

**Expected characteristics:**

- May start on branch `work` rather than `main` (documented in `AGENTS.md`)
- `origin` remote may not exist after bootstrap — must be added temporarily if missing
- `.env` file: NOT present
- `DATABASE_URL`, `REDIS_URL`, `PULSECHAIN_RPC_URL`: NOT available unless explicitly injected
- Filesystem is ephemeral
- GitHub push capability: prefer Codex GitHub integration tools or compare-link fallback over CLI `git push`
- CLI `git push` may not be reliable; do not depend on it

**Safe assumptions in Codex Cloud:**

- Repository files can be read and edited
- Docs-only work, code review, analysis, and bounded implementation can be performed
- If GitHub integration is available, PRs can be created

**Unsafe assumptions in Codex Cloud:**

- Do NOT assume `.env` is present
- Do NOT assume database access, RPC access, or secret availability
- Do NOT assume `origin` remote exists — verify and add if missing
- Do NOT assume CLI `git push` will succeed
- Do NOT assume Gate 10 evidence collection or observation fetch can be run

---

## 3. Resource Classification

| Resource | Local Operator | Claude Cloud | Codex Cloud | Notes |
|---|---|---|---|---|
| Repository files | ✅ Available | ✅ Available | ✅ Available | Fresh clone in cloud environments |
| `.env` | ✅ Available | ❌ Not present | ❌ Not present | Must be operator-configured locally |
| `DATABASE_URL` | ✅ If configured | ❌ Not available | ❌ Not available | Requires explicit injection to cloud |
| `REDIS_URL` | ✅ If configured | ❌ Not available | ❌ Not available | Requires explicit injection to cloud |
| `PULSECHAIN_RPC_URL` | ✅ If configured | ❌ Not available | ❌ Not available | No hardcoded default (PR #249, D-024) |
| GitHub fetch | ✅ Available | ✅ Available | ✅ Available (after remote setup) | |
| GitHub push (CLI) | ✅ Available | ⚠️ May fail (HTTP 403) | ⚠️ Unreliable | Use MCP/integration tools in cloud |
| GitHub push (MCP/tool) | N/A | ✅ Available | ✅ If integration available | Preferred push method in Claude Cloud |
| PR creation | ✅ Via `gh` CLI | ✅ Via MCP tools | ✅ Via Codex integration | |
| Local filesystem (persistent) | ✅ Available | ❌ Ephemeral | ❌ Ephemeral | Cloud containers are discarded after session |
| Database queries | ✅ If DB running | ❌ Not available | ❌ Not available | Requires live PostgreSQL + env var |
| Database mutations | ✅ If DB running | ❌ Not available | ❌ Not available | Hard stop if unavailable and task requires it |
| RPC calls | ✅ If URL set | ❌ Not available | ❌ Not available | Operator must supply `--rpcUrl` explicitly |
| Observation fetch | ✅ Local only | ❌ Not available | ❌ Not available | Requires DB + RPC + `.env` |
| Gate 10 execution | ✅ Local only | ❌ Not available | ❌ Not available | Requires DB + RPC + `.env` |
| Stake discovery (live DB) | ✅ Local only | ❌ Not available | ❌ Not available | Requires DB access |
| Stake discovery (on-chain read) | ✅ Available | ⚠️ Possible via Blockscout MCP | ⚠️ Possible via external tools | Read-only; no secrets needed for Blockscout |
| Docs work | ✅ Available | ✅ Available | ✅ Available | All environments |
| PR review (read-only) | ✅ Available | ✅ Available | ✅ Available | All environments |
| Source policy review | ✅ Available | ✅ Available | ✅ Available | All environments |
| `npm run test` (no live DB) | ✅ Available | ✅ Available | ✅ Available | Vitest unit tests with mocks |
| `npm run lint` | ✅ Available | ✅ Available | ✅ Available | |
| `npm run typecheck` | ✅ Available | ✅ Available | ✅ Available | |
| `npm run build` | ✅ Available | ✅ Available | ✅ Available | |

---

## 4. Task Classification

| Task | Local Only | Cloud Allowed | Notes |
|---|---|---|---|
| PR review | No | ✅ Yes | Read-only; safe in all environments |
| Docs PR | No | ✅ Yes | Primary use case for cloud environments |
| Code review | No | ✅ Yes | Read-only analysis |
| Architecture review | No | ✅ Yes | Read-only |
| Source policy review | No | ✅ Yes | Read-only |
| Stake discovery (live DB) | ✅ Yes | ❌ No | Requires local DB + env |
| Stake discovery (on-chain read-only) | No | ⚠️ Partial | Possible via Blockscout MCP; no DB |
| Observation fetch | ✅ Yes | ❌ No | Requires DB + RPC + `.env` |
| Gate 10 evidence collection | ✅ Yes | ❌ No | Requires DB + RPC + `.env` |
| Gate 10 execution | ✅ Yes | ❌ No | Requires DB + RPC + `.env` |
| DB inspection (read-only) | ✅ Yes | ❌ No | Requires live PostgreSQL |
| DB mutation | ✅ Yes | ❌ No | Requires live PostgreSQL; never in cloud |
| RPC read-only inspection | ✅ Yes | ❌ No | Requires `PULSECHAIN_RPC_URL` |
| Bounded implementation PR | No | ✅ Yes | Code changes, tests, lint, typecheck, build |
| Schema migrations | ✅ Yes | ⚠️ Caution | Requires `DATABASE_URL`; prefer local |
| Prisma generate | No | ✅ Yes | No DB connection required |
| Operator script runs | ✅ Yes | ❌ No | All scripts require `.env` and DB/RPC |

---

## 5. Mandatory Environment Verification

Before performing any task that requires database access, RPC access, `.env` secrets, or push capability, the assistant must verify those resources are actually available.

**Never assume. Verify first.**

### Required verification steps

**For any task:**

```bash
git status -sb
git remote -v
git branch --show-current
```

**Before DB-dependent work:**

```bash
# Verify env var presence (do NOT print values)
echo "DATABASE_URL available: $([ -n "$DATABASE_URL" ] && echo true || echo false)"
```

If false: **STOP and report. Do not proceed.**

**Before RPC-dependent work:**

```bash
echo "PULSECHAIN_RPC_URL available: $([ -n "$PULSECHAIN_RPC_URL" ] && echo true || echo false)"
```

If false: **STOP and report. Do not proceed.**

**Before push-dependent work (cloud):**

Prefer MCP push tools (`mcp__github__push_files`, `mcp__github__create_pull_request`) over CLI `git push` in Claude Cloud environments. Verify MCP tools are available before beginning heavy implementation work.

**For .env loading (local or injected):**

```bash
# Load without printing values
set -a && source .env && set +a 2>/dev/null || true
echo "DATABASE_URL available: $([ -n "$DATABASE_URL" ] && echo true || echo false)"
echo "REDIS_URL available: $([ -n "$REDIS_URL" ] && echo true || echo false)"
echo "PULSECHAIN_RPC_URL available: $([ -n "$PULSECHAIN_RPC_URL" ] && echo true || echo false)"
```

Never print raw values of `DATABASE_URL`, `REDIS_URL`, or `PULSECHAIN_RPC_URL`.

---

## 6. Common Failure Modes

These are documented from actual project history. Evidence tags follow the evidence model in `docs/ai-handoff.md`.

| Failure Mode | When It Occurs | Prevention |
|---|---|---|
| Assuming `.env` exists in cloud | Claude/Codex starts a task requiring DB/RPC in a cloud session | Check `.env` existence as first step; hard stop if absent |
| Assuming CLI `git push` works | Cloud session attempts content push and receives HTTP 403 | Use MCP push tools; verify push capability before heavy work |
| Reading large docs before verifying auth | Session spends significant effort on analysis, then discovers it cannot push or commit | Verify push capability on a trivial test push before analysis |
| Assuming DB is running locally | Operator workstation task fails because Docker services are not started | Run `docker compose up -d` and verify connectivity before DB-dependent scripts |
| Assuming RPC URL is configured | Operator script fails with missing URL error | Verify `PULSECHAIN_RPC_URL` is set; no hardcoded default exists (PR #249) |
| Treating cloud stake discovery as equivalent to local | Cloud session cannot query DB for persisted stakes | Distinguish on-chain read (possible via Blockscout) from DB read (local only) |
| Proceeding with Gate 10 in cloud | Session attempts evidence collection without DB or RPC | Hard stop if DB or RPC unavailable; Gate 10 is local-only |

---

## 7. Environment Decision Tree

Use this tree before starting any non-trivial task.

```text
START
│
├── Does the task require .env / DATABASE_URL / REDIS_URL / PULSECHAIN_RPC_URL?
│   │
│   ├── YES
│   │   ├── Am I in a cloud environment (Claude Cloud, Codex Cloud)?
│   │   │   ├── YES → STOP. Report unavailability. Ask operator to run locally
│   │   │   │         or inject the required env vars into the session.
│   │   │   └── NO (local) → Verify .env exists and env vars are set.
│   │   │                     If missing: STOP and report.
│   │   │                     If present: proceed.
│   │   └── (continue if env vars verified)
│   │
│   └── NO (docs, code review, analysis, bounded implementation)
│       └── Safe to proceed in any environment.
│
├── Does the task require git push / PR creation?
│   │
│   ├── In Claude Cloud → Use MCP push tools, not CLI git push.
│   │   Verify MCP tools are available before heavy work.
│   │
│   ├── In Codex Cloud → Use Codex GitHub integration or compare-link fallback.
│   │   Do not rely on CLI git push.
│   │
│   └── Local → CLI git push and gh CLI are available if GitHub auth is configured.
│
├── Does the task require observation fetch?
│   └── Local only. Hard stop in cloud. Report to operator.
│
├── Does the task require Gate 10 execution or evidence collection?
│   └── Local only. Hard stop in cloud. Report to operator.
│
└── Is this docs, review, or bounded code work?
    └── Safe in all environments. Proceed.
```

---

## 8. Maintenance Rule

Update this file only when one or more of the following changes:

- Execution environment model changes (new environment type added or removed)
- Authentication or push-capability model changes (e.g., new MCP tool, auth method change)
- Operator workflow changes (e.g., new required env var, new script requiring local execution)
- New failure mode is documented from project history

Do not update this file for every PR. Do not update it for code changes that do not affect execution environment assumptions.

Cross-link to this file from `docs/ai-handoff.md` if the AI handoff startup block is updated to include environment verification as a mandatory step.
