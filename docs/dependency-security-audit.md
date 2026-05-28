# Dependency Security Audit Status

## Purpose

This document records the current bounded dependency/security audit remediation state for CoinPulse backend readiness.

It exists because package-manager generated dependency state and lockfile validation must happen in a real execution environment (`npm audit`, `npm ci`, `npm update`) rather than through manual lockfile editing.

## Current remediation attempt

The following dependency ranges were updated to newer patch/minor targets intended to reduce known production audit exposure:

- `next`: `^15.5.7` -> `^15.5.9`
- `eslint-config-next`: `^15.5.7` -> `^15.5.9`
- `viem`: `^2.48.11` -> `^2.48.13`

## Important constraint

`package-lock.json` was intentionally not manually rewritten.

The repository must run:

```bash
npm update next eslint-config-next viem
npm ci
npm audit --omit=dev
```

in a real package-manager environment so:

- the lockfile is regenerated correctly,
- transitive dependency resolution is deterministic,
- production advisories are re-evaluated against the resolved graph,
- and validation/build/test status can be confirmed.

## Required validation

Before merge/deployment, run:

```bash
npm ci
npm run validate:env
npx prisma generate
npm run test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

## Remaining risk

This bounded remediation does not guarantee that all production advisories are fully resolved until:

- the lockfile is regenerated,
- the resolved dependency graph is re-audited,
- and all validation commands pass.

If advisories remain after package-manager regeneration, the next step should determine whether:

- a safe patch/minor update exists,
- a breaking upgrade is required,
- or a documented temporary acceptance/deployment exception is necessary.
