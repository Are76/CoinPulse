# CoinPulse Validation Environment Requirements

## Purpose

This document records the environment variables required to run local, Codex Cloud, or CI validation for CoinPulse without changing runtime behavior.

It exists because build and type-generation commands load server-only modules during Next.js validation. Those modules intentionally require infrastructure connection settings, even for frontend-only PRs.

This document is documentation only. It does not change code, schema, DTO contracts, accounting logic, pricing logic, sync/rebuild behavior, workers, routes, or frontend rendering behavior.

## Required variables for validation

CoinPulse currently requires these variables for full repository validation:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/coinpulse
REDIS_URL=redis://localhost:6379
PULSECHAIN_RPC_URL=https://rpc.pulsechainstats.com
```

These sample values are placeholders for local validation. Do not commit real production secrets.

## Why `DATABASE_URL` is required

`package.json` runs Prisma generation as part of build and typecheck:

```bash
npm run build      # prisma generate && next build
npm run typecheck  # prisma generate && next typegen && tsc --noEmit
```

Prisma must resolve `DATABASE_URL` before it can generate the Prisma Client. If `DATABASE_URL` is missing, validation can fail before the changed code is reached.

## Why `REDIS_URL` is required

`src/lib/server-env.ts` validates server infrastructure settings and currently requires both:

- `DATABASE_URL`
- `REDIS_URL`

During `next build`, Next.js can collect route/page data for server routes such as:

- `/api/debug/health`
- `/api/debug/status`

If those server modules import the server environment contract, a missing `REDIS_URL` can fail build-time validation even when a PR is frontend-only.

This is expected behavior for the current runtime contract. A missing env var should be treated as a validation environment issue unless the PR changed env validation or route imports.

## Recommended local/Codex validation command session

For validation-only runs where no real production services are needed, export placeholder values in the command session:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/coinpulse"
export REDIS_URL="redis://localhost:6379"
export PULSECHAIN_RPC_URL="https://rpc.pulsechainstats.com"

npx prisma generate
npm run test
npm run lint
npm run typecheck
npm run build
```

Do not commit `.env` files or secrets.

## Interpreting failures

### Missing `DATABASE_URL`

If validation fails with a Prisma config error for `DATABASE_URL`, rerun with `DATABASE_URL` exported before diagnosing product code.

### Missing `REDIS_URL`

If `npm run build` fails with a Zod error for `REDIS_URL`, rerun with `REDIS_URL` exported before diagnosing product code.

### Connection refused

If placeholder values are present but a command attempts a real database or Redis connection and fails with a connection error, report the exact command and connection error. Do not mask it as a code regression unless the same command passes on latest `main` and fails only on the PR branch.

## PR reporting rule

When validation fails because required environment variables were absent, the PR summary should state:

- the exact command that failed,
- the exact missing variable,
- whether validation was rerun with placeholder values,
- whether the failure reproduces on latest `main`, if claiming it is pre-existing or environment-only.

Do not mark a PR merge-ready if a validation failure is unexplained.

## Scope guardrails

This document must not be used to justify making infrastructure dependencies optional in runtime code. If a future task changes runtime env validation, that must be a separate implementation PR with tests and explicit architecture review.
