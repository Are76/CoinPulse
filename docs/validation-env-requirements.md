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
PULSECHAIN_RPC_URL=http://localhost:8545
```

These sample values are placeholders for local validation. They are intentionally non-production examples. Do not commit real production secrets.

`npm run validate:env` checks that these values are present and URL-shaped with the expected protocols:

| Variable | Accepted protocols |
| --- | --- |
| `DATABASE_URL` | `postgresql:`, `postgres:` |
| `REDIS_URL` | `redis:`, `rediss:` |
| `PULSECHAIN_RPC_URL` | `http:`, `https:` |

The helper does not test live connectivity. It validates that the environment is structurally suitable before running commands that may load server-only modules.

## Why `DATABASE_URL` is required

`package.json` runs Prisma generation as part of build and typecheck:

```bash
npm run build      # prisma generate && next build
npm run typecheck  # prisma generate && next typegen && tsc --noEmit
```

Prisma must resolve `DATABASE_URL` before it can generate the Prisma Client. If `DATABASE_URL` is missing or malformed, validation can fail before the changed code is reached.

## Why `REDIS_URL` is required

`src/lib/server-env.ts` validates server infrastructure settings and currently requires both:

- `DATABASE_URL`
- `REDIS_URL`

The server environment contract is parsed at module load. During `next build`, any server code that imports that contract can be evaluated or bundled, so a missing or malformed `REDIS_URL` can fail build-time validation even when a PR is frontend-only.

This is expected behavior for the current runtime contract. A missing or malformed env var should be treated as a validation environment issue unless the PR changed env validation or route imports.

## Why `PULSECHAIN_RPC_URL` is required

`src/lib/rpc-env.ts` validates RPC environment settings and currently requires `PULSECHAIN_RPC_URL`.

Some validation commands can load modules that import the RPC environment contract even when they are not making live RPC calls. A missing or malformed `PULSECHAIN_RPC_URL` can therefore fail validation before the changed code is reached.

For generic validation, prefer a non-secret placeholder URL such as `http://localhost:8545`. Use a real PulseChain RPC URL only when the command intentionally needs live RPC access.

## Recommended local/Codex validation command session

For validation-only runs where no real production services are needed, export placeholder values in the command session:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/coinpulse"
export REDIS_URL="redis://localhost:6379"
export PULSECHAIN_RPC_URL="http://localhost:8545"

npm run validate:env
npx prisma generate
npm run test
npm run lint
npm run typecheck
npm run build
```

Do not commit `.env` files or secrets.

## Interpreting failures

### Missing or malformed `DATABASE_URL`

If validation fails with a Prisma config error for `DATABASE_URL`, rerun with a valid `DATABASE_URL` exported before diagnosing product code.

### Missing or malformed `REDIS_URL`

If `npm run build` fails with a Zod error for `REDIS_URL`, rerun with a valid `REDIS_URL` exported before diagnosing product code.

### Missing or malformed `PULSECHAIN_RPC_URL`

If validation fails with an RPC environment error for `PULSECHAIN_RPC_URL`, rerun with a valid URL exported before diagnosing product code. Generic validation can use a localhost placeholder unless the command intentionally needs live RPC access.

### Connection refused

If placeholder values are present but a command attempts a real database, Redis, or RPC connection and fails with a connection error, report the exact command and connection error. Do not mask it as a code regression unless the same command passes on latest `main` and fails only on the PR branch.

## PR reporting rule

When validation fails because required environment variables were absent or malformed, the PR summary should state:

- the exact command that failed,
- the exact missing or malformed variable,
- whether validation was rerun with placeholder values,
- whether the failure reproduces on latest `main`, if claiming it is pre-existing or environment-only.

Do not mark a PR merge-ready if a validation failure is unexplained.

## Scope guardrails

This document must not be used to justify making infrastructure dependencies optional in runtime code. If a future task changes runtime env validation, that must be a separate implementation PR with tests and explicit architecture review.
