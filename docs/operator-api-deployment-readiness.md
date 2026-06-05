# Operator API Deployment Readiness Policy

## Purpose

This document records the deployment-readiness policy for CoinPulse operator API surfaces.

It is documentation only. It does not add authentication, change runtime behavior, modify Prisma schema, change DTO/API contracts, change sync/rebuild/materialization/pricing/PnL/tax logic, add workers, or change frontend behavior.

## Decision

CoinPulse must not be deployed as a publicly reachable production application with unauthenticated operator APIs.

Before public deployment, the operator API surface must be protected by either:

1. an external access-control layer, such as private network, VPN, Vercel protection, reverse-proxy auth, or equivalent deployment-level restriction; or
2. application-level operator authentication/authorization implemented in the API routes or middleware.

If neither protection exists, public deployment is blocked.

## Operator API surfaces in scope

The following routes are considered operator or debug/admin surfaces and require protection before public deployment:

- `POST /api/wallets/import`
- `GET /api/wallets/tracked`
- `POST /api/sync/manual`
- `POST /api/rebuild`
- `GET /api/debug/health`
- `GET /api/debug/status`
- `GET /api/prices/status`
- `POST /api/prices/ingest` (internal ingestion route — triggers on-chain RPC price fetching and persists observations)
- `GET /api/transactions` (wallet-scoped transaction history — exposes ledger entries for a specific wallet and chain)

Future operator/admin/debug routes inherit this requirement by default.

## Why this matters

Unprotected operator APIs can allow an unauthenticated caller to:

- import or enumerate tracked wallets.
- trigger expensive RPC/database work.
- start sync or rebuild operations.
- consume operation capacity.
- observe debug/status metadata.
- infer wallet, operation, failure, warning, or pricing-state information.

Even if the backend truth model is correct, unprotected operator surfaces can create operational risk, privacy risk, cost risk, and confusing run-state under public traffic.

## Current backend phase implication

During local/backend-readiness development, the team may continue using these routes as operator/debug surfaces.

However, readiness evidence must clearly identify whether it was captured in:

- local development,
- private/staging environment,
- protected deployment,
- or public deployment.

No public deployment should be treated as production-ready until operator protection is in place and documented.

## Acceptable implementation paths

### Option A: deployment-level protection

Acceptable if the deployment platform prevents public unauthenticated access to the app or operator routes.

Examples:

- private deployment URL.
- VPN/private network.
- reverse-proxy basic auth or identity-aware proxy.
- Vercel deployment protection or equivalent platform gate.

If this path is used, document:

- where the protection is configured,
- what surfaces it covers,
- whether preview deployments are also protected,
- how operator access is granted/revoked.

### Option B: application-level operator auth

Acceptable if CoinPulse routes enforce access in code.

A future implementation PR should:

- protect all operator/debug/admin routes consistently.
- return structured `401`/`403` envelopes without leaking internal details.
- include route-contract tests for unauthenticated and unauthorized requests.
- avoid exposing secrets in frontend bundles.
- avoid relying on client-side checks as security.
- keep public read surfaces explicitly separated from operator surfaces.

## Minimum implementation guardrails for future auth PR

A future operator-auth implementation must not:

- rely on frontend-only hiding of buttons or pages.
- expose API secrets to browser code.
- silently protect some operator routes but leave sibling routes open.
- break existing route success/error envelopes without contract tests.
- mix auth changes with pricing, PnL, tax, sync semantics, or schema changes.

## Readiness status

Status: decision recorded; implementation/protection evidence pending.

This policy is a deployment-readiness gate, not a blocker for local backend correctness work.

## Recommended next bounded PR

After this decision is merged, create a dedicated implementation PR that chooses one path:

- document and verify deployment-level protection, or
- add application-level operator API auth with route-contract tests.

## Final rule

Do not publicly deploy CoinPulse with unauthenticated operator APIs.
