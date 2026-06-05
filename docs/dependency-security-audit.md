# Dependency Security Audit Status

## Purpose

This document records the production dependency audit remediation state for CoinPulse,
updated as part of issue #137 / PR that resolved or documented all findings from
`npm audit --omit=dev`.

---

## Before remediation (origin/main, pre-PR)

```
6 moderate severity vulnerabilities

@hono/node-server  <1.19.13   (GHSA-92pp-h63x-v22m)
hono  <=4.12.20               (GHSA-xrhx-7g5j-rcj5, GHSA-3hrh-pfw6-9m5x,
                               GHSA-f577-qrjj-4474, GHSA-2gcr-mfcq-wcc3)
postcss  <8.5.10              (GHSA-qx2v-qp2m-jg93)
```

---

## After remediation (this PR)

```
5 moderate severity vulnerabilities

@hono/node-server  <1.19.13   (GHSA-92pp-h63x-v22m)
postcss  <8.5.10              (GHSA-qx2v-qp2m-jg93)
```

### Fixed by this PR

| Package | Before | After | Advisories resolved |
|---|---|---|---|
| `hono` | 4.12.18 | 4.12.23 | GHSA-xrhx-7g5j-rcj5, GHSA-3hrh-pfw6-9m5x, GHSA-f577-qrjj-4474, GHSA-2gcr-mfcq-wcc3 |
| `viem` | 2.52.0 | 2.52.2 | n/a (patch update) |
| `ox` (transitive via viem) | 0.14.27 | 0.14.29 | n/a |
| `brace-expansion` (transitive) | 2.0.1 | patched | n/a |

Fixed via `npm audit fix` (no `--force`). No breaking changes.

---

## Remaining findings

### 1. `@hono/node-server <1.19.13` — GHSA-92pp-h63x-v22m

**Severity**: Moderate

**Description**: Middleware bypass via repeated slashes in `serveStatic`.

**Dependency chain**:
```
prisma@7.8.0
  └─ @prisma/dev <=0.24.8
       └─ @hono/node-server <1.19.13  ← vulnerable
```

**Why not fixed**:
`npm audit fix --force` would install `prisma@6.19.3`, a major downgrade from 7.x.
CoinPulse uses Prisma 7 ORM features and migrations that are incompatible with 6.x.

**Actual exposure**:
`@hono/node-server` is an internal transport used by Prisma Studio / Prisma Data Proxy server.
CoinPulse does not use `prisma studio` or the Prisma embedded server in production —
it uses `@prisma/client` as an ORM only. The `serveStatic` middleware bypass is
not reachable through CoinPulse's request surface.

**Safe upgrade path**:
Wait for Prisma to release a version that pins `@prisma/dev` to `@hono/node-server >=1.19.13`.
Monitor https://github.com/prisma/prisma/releases. No manual lockfile override is appropriate.

**Deployment risk**: Low. The affected code path is not exercised in production.

---

### 2. `postcss <8.5.10` — GHSA-qx2v-qp2m-jg93

**Severity**: Moderate

**Description**: XSS via unescaped `</style>` in CSS Stringify output.

**Dependency chain**:
```
next@15.5.19
  └─ node_modules/next/node_modules/postcss  ← bundled, <8.5.10
```

**Why not fixed**:
`npm audit fix --force` offers to install `next@9.3.3`, a nonsensical 6-major-version
downgrade. The advisory affects `next 9.3.4-canary.0 - 16.3.0-canary.5`.
The latest stable Next.js release (`16.2.7`) still falls within the affected range.
No stable Next.js release with a fixed postcss exists as of this audit.

**Actual exposure**:
PostCSS is used by Next.js during the CSS build pipeline (Tailwind CSS processing).
The XSS vector in postcss's stringify output is only exploitable if user-controlled
CSS is passed through `postcss.stringify()` and injected into HTML. CoinPulse does
not accept user-controlled CSS input and does not use postcss at runtime —
it is a build-time tool only.

**Safe upgrade path**:
Monitor the Next.js changelog for a release outside the affected range
(`>16.3.0-canary.5` or a patched 15.x). Do not apply `npm audit fix --force`
to downgrade to `next@9.3.3`.

**Deployment risk**: Low. The vulnerability is in a build-time CSS pipeline;
no runtime CSS stringification of user input occurs in CoinPulse.

---

## Validation results (this PR)

All commands passed after running `npm ci && npx prisma generate`:

| Command | Result |
|---|---|
| `npm ci` | ✅ |
| `npm run validate:env` | ✅ |
| `npx prisma generate` | ✅ |
| `npm run test` | ✅ 76 files, 637 tests |
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `npm audit --omit=dev` | ⚠️ 5 moderate (2 root causes, documented above) |

---

## Notes

- `package-lock.json` was updated only via `npm update` and `npm audit fix`.
  No manual lockfile editing was performed.
- `package.json` version specs were not changed; only the lockfile was updated.
- All remaining advisories are in transitive dependencies of `prisma` (build tooling)
  and `next` (bundled build-time postcss). Neither is exploitable through CoinPulse's
  production request surface.
