# Local Backend Evidence Setup

## Purpose

This document provides a minimal local environment for backend-readiness evidence collection.

It does not change backend truth rules, DTO contracts, pricing logic, sync semantics, rebuild behavior, schema design, or frontend behavior.

## Prerequisites

- Docker Desktop installed and running.
- Repository checked out locally.
- Node.js dependencies installed.

## Start local services

From the repository root:

```bash
docker compose up -d
```

Verify services:

```bash
docker compose ps
```

Expected services:

- postgres
- redis

Both services should report healthy before continuing.

## Validation environment

Example environment values:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/coinpulse"
export REDIS_URL="redis://localhost:6379"
export PULSECHAIN_RPC_URL="http://localhost:8545"
```

Run these exports in every terminal that runs npm, Prisma, seed, or dev-server commands. Environment variables exported in one terminal are not automatically available in another terminal.

Run validation:

```bash
npm run validate:env
npx prisma generate
```

## Database initialization

Apply Prisma schema:

```bash
npx prisma migrate deploy
```

Seed required local reference data:

```bash
npm run db:seed
```

The seed step creates required local reference rows such as the supported PulseChain chain entry. Without it, wallet import can fail with a `Wallet_chainId_fkey` foreign-key error because chain `369` is missing from the local database.

If local development requires a fresh database:

```bash
npx prisma migrate reset
```

Use caution because reset destroys local data. After any reset, rerun the seed step before wallet import or sync evidence.

## Start application

```bash
npm run dev
```

## Evidence collection sequence

1. GET /api/debug/health
2. GET /api/debug/status
3. GET /api/prices/status
4. GET /api/wallets/tracked
5. POST /api/wallets/import
6. GET /api/wallets/tracked
7. POST /api/sync/manual
8. POST /api/rebuild

Record results in the G4/G5 evidence-run record.

## Non-goals

- Production deployment.
- Security hardening.
- Authentication implementation.
- Schema redesign.
- DTO redesign.
- Sync/rebuild logic changes.
