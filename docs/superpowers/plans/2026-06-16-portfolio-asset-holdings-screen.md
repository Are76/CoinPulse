# Portfolio Asset Holdings Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing `/portfolio/assets` page that auto-selects the first tracked wallet and displays its token holdings from the existing backend dashboard DTO.

**Architecture:** Reuses `GET /api/portfolio/dashboard` (existing route, no changes) via the existing `useDashboardQuery` hook. First tracked wallet from `useTrackedWalletsQuery` is auto-selected. Frontend renders `DashboardTokenPositionDto[]` verbatim — no calculations, no RPC, no fabricated data.

**Tech Stack:** Next.js App Router, TanStack Query, `DashboardTokenPositionDto` from `src/services/dashboard/types.ts`, existing UI components (`PageContainer`, `SurfaceCard`, `DataTableShell`, `EmptyState`, `ErrorState`, `LoadingState`, `ValueDisplay`, `StatusBadge`, `LabelBadge`).

---

## Phase 1 Audit Findings (already complete — no edits needed)

Backend: `GET /api/portfolio/dashboard` → `PortfolioDashboardDto.tokenPositions: DashboardTokenPositionDto[]`

Each `DashboardTokenPositionDto` provides:
- `assetId` — canonical chain-aware identity string
- `assetAddress` — on-chain address or null
- `balanceQuantity` — string (bigint-safe)
- `decimals` — number or null
- `pricing.status` — availability/freshness status
- `pricing.sourceType`, `pricing.confidence`, `pricing.observedAt`
- `valuation.status`, `valuation.valueQuote` — backend-computed, or null with explicit status
- `pnl.status`, `pnl.warnings`
- `metadataProvenance.status`, `.source`, `.confidence`

ChainId is at `PortfolioDashboardDto.wallet.chainId` (same for all positions in one response).

**No display name/symbol in DTO** — `assetId` and `assetAddress` are the identity fields.

Safe to build without any backend/schema/API changes: ✅

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/portfolio/asset-holdings-screen.tsx` | Screen component — auto-selects first tracked wallet, renders holdings |
| Create | `src/app/portfolio/assets/page.tsx` | Next.js page — imports and renders `AssetHoldingsScreen` |
| Create | `app/portfolio/assets/page.tsx` | Thin re-export shim (repo pattern) |
| Modify | `src/components/layout/nav-config.ts` | Add `{ href: "/portfolio/assets", label: "Holdings" }` to `PRIMARY_NAV_LINKS` |
| Modify | `tests/app/active-app-route-registration.test.ts` | Add `"portfolio/assets"` to route lists |
| Create | `tests/components/asset-holdings-screen-wiring.test.ts` | Wiring/behavior tests for the new screen |

---

## Task 1: Create the AssetHoldingsScreen component

**Files:**
- Create: `src/components/portfolio/asset-holdings-screen.tsx`

- [ ] **Step 1: Write the wiring test first (fails because file doesn't exist)**

Create `tests/components/asset-holdings-screen-wiring.test.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/portfolio/asset-holdings-screen.tsx",
);

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/portfolio/assets/page.tsx",
);

function readScreen() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

// ── Wiring ─────────────────────────────────────────────────────────────────────

describe("asset-holdings-screen wiring", () => {
  it("page imports and renders AssetHoldingsScreen", () => {
    const src = readPage();
    expect(src).toContain("AssetHoldingsScreen");
    expect(src).toContain('from "@/components/portfolio/asset-holdings-screen"');
  });

  it("screen imports useTrackedWalletsQuery", () => {
    const src = readScreen();
    expect(src).toContain('from "@/lib/query/use-tracked-wallets-query"');
  });

  it("screen imports useDashboardQuery", () => {
    const src = readScreen();
    expect(src).toContain('from "@/lib/query/use-dashboard-query"');
  });

  // ── No RPC / no calculations ─────────────────────────────────────────────────

  it("screen does not import from RPC service", () => {
    const src = readScreen();
    expect(src).not.toContain("@/services/rpc");
    expect(src).not.toContain("rpc-client");
  });

  it("screen does not call Number() on token amounts", () => {
    const src = readScreen();
    // Number() coercion of bigint-safe strings is forbidden
    expect(src).not.toMatch(/Number\s*\(\s*\w*[Qq]uantity/);
    expect(src).not.toMatch(/Number\s*\(\s*\w*[Bb]alance/);
    expect(src).not.toMatch(/parseFloat\s*\(\s*\w*[Qq]uantity/);
    expect(src).not.toMatch(/parseFloat\s*\(\s*\w*[Bb]alance/);
  });

  it("screen does not compute price or valuation in the frontend", () => {
    const src = readScreen();
    expect(src).not.toMatch(/\*\s*price/i);
    expect(src).not.toMatch(/price\s*\*/i);
    expect(src).not.toMatch(/valueQuote\s*\*/);
    expect(src).not.toContain("calculatePnl");
    expect(src).not.toContain("computeValue");
  });

  // ── DTO fields rendered ───────────────────────────────────────────────────────

  it("screen renders position.assetId for canonical identity", () => {
    const src = readScreen();
    expect(src).toContain("position.assetId");
  });

  it("screen renders position.balanceQuantity as display string", () => {
    const src = readScreen();
    expect(src).toContain("position.balanceQuantity");
  });

  it("screen renders valuation status from DTO", () => {
    const src = readScreen();
    expect(src).toContain("position.valuation.status");
  });

  it("screen renders pricing status from DTO", () => {
    const src = readScreen();
    expect(src).toContain("position.pricing.status");
  });

  // ── States ────────────────────────────────────────────────────────────────────

  it('screen has honest empty-state text when no assets', () => {
    const src = readScreen();
    expect(src).toContain("No backend asset holdings available");
  });

  it("screen shows wallet chainId from DTO (not hardcoded)", () => {
    const src = readScreen();
    expect(src).toContain("dashboard.wallet.chainId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/components/asset-holdings-screen-wiring.test.ts
```

Expected: FAIL — ENOENT (files don't exist yet).

- [ ] **Step 3: Create the screen component**

Create `src/components/portfolio/asset-holdings-screen.tsx`:

```tsx
"use client";

import { PageContainer } from "@/components/ui/page-container";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { StatusBadge } from "@/components/ui/status/status-badge";
import { ValueDisplay } from "@/components/ui/value/value-display";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";
import type { DashboardTokenPositionDto } from "@/services/dashboard/types";

const DEFAULT_CHAIN_ID = 369;
const DEFAULT_QUOTE_ASSET = "fiat:usd";

export function AssetHoldingsScreen() {
  const trackedWalletsQuery = useTrackedWalletsQuery();

  const firstWallet =
    trackedWalletsQuery.isSuccess && trackedWalletsQuery.data.wallets.length > 0
      ? trackedWalletsQuery.data.wallets[0]
      : null;

  const dashboardQuery = useDashboardQuery({
    walletAddress: firstWallet?.address ?? "",
    chainId: firstWallet?.chainId ?? DEFAULT_CHAIN_ID,
    quoteAsset: DEFAULT_QUOTE_ASSET,
    enabled: firstWallet !== null,
  });

  if (trackedWalletsQuery.isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  if (trackedWalletsQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          title="Could not load wallets"
          message="Backend wallet list is unavailable. Retry or check the operator tools."
        />
      </PageContainer>
    );
  }

  if (firstWallet === null) {
    return (
      <PageContainer>
        <EmptyState
          title="No tracked wallets"
          message="No backend asset holdings available for this portfolio yet. Import a wallet first via Operator > Wallet import."
        />
      </PageContainer>
    );
  }

  const dashboard = dashboardQuery.data;

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Asset holdings</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Backend-resolved token balances for the first tracked wallet. Valuation and pricing status
          are displayed verbatim from the backend DTO — no frontend calculation.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-[color:var(--color-text-muted)]">
          <span>wallet: {firstWallet.address}</span>
          <span>chainId: {firstWallet.chainId}</span>
        </div>
      </SurfaceCard>

      {dashboardQuery.isPending ? <LoadingState /> : null}

      {dashboardQuery.isError ? (
        <ErrorState
          title="Holdings unavailable"
          message="Backend dashboard DTO could not be loaded. Check that the wallet has been synced."
        />
      ) : null}

      {dashboard !== undefined ? (
        <AssetHoldingsTable
          positions={dashboard.tokenPositions}
          chainId={dashboard.wallet.chainId}
        />
      ) : null}
    </PageContainer>
  );
}

function AssetHoldingsTable({
  positions,
  chainId,
}: {
  positions: DashboardTokenPositionDto[];
  chainId: number;
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="No asset holdings"
        message="No backend asset holdings available for this portfolio yet."
      />
    );
  }

  return (
    <DataTableShell
      title="Token holdings"
      subtitle={`${positions.length} position${positions.length === 1 ? "" : "s"} from backend DTO · chainId ${chainId}`}
    >
      <thead>
        <tr>
          <th>Asset identity</th>
          <th>Balance</th>
          <th>Valuation</th>
          <th>Pricing</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.assetId}>
            <td>
              <div className="flex flex-col gap-1">
                <span className="cp-data text-xs">
                  {position.assetAddress ?? position.assetId}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--color-text-muted)]">
                  assetId: {position.assetId}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--color-text-muted)]">
                  chainId: {chainId}
                </span>
              </div>
            </td>
            <td>
              <div className="flex flex-col gap-1">
                <span className="cp-data">{position.balanceQuantity}</span>
                {position.decimals !== null ? (
                  <span className="text-xs text-[color:var(--color-text-muted)]">
                    decimals: {position.decimals}
                  </span>
                ) : null}
              </div>
            </td>
            <td>
              <ValueDisplay
                status={position.valuation.status}
                value={position.valuation.valueQuote}
              />
            </td>
            <td>
              <StatusBadge status={position.pricing.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}
```

- [ ] **Step 4: Run tests — they should now pass**

```
npx vitest run tests/components/asset-holdings-screen-wiring.test.ts
```

Expected: All pass.

---

## Task 2: Create the Next.js page and re-export shim

**Files:**
- Create: `src/app/portfolio/assets/page.tsx`
- Create: `app/portfolio/assets/page.tsx`

- [ ] **Step 1: Create the src/app page**

Create `src/app/portfolio/assets/page.tsx`:

```tsx
import { AssetHoldingsScreen } from "@/components/portfolio/asset-holdings-screen";

export default function AssetHoldingsPage() {
  return <AssetHoldingsScreen />;
}
```

- [ ] **Step 2: Create the root app/ re-export shim**

Create `app/portfolio/assets/page.tsx`:

```tsx
// Registers /portfolio/assets in the active root app/ tree.
// Re-exports the canonical page from src/app/ to keep a single source of truth.
export { default } from "@/app/portfolio/assets/page";
```

- [ ] **Step 3: Run the wiring test to confirm page wiring**

```
npx vitest run tests/components/asset-holdings-screen-wiring.test.ts
```

Expected: All pass.

---

## Task 3: Add Holdings to navigation

**Files:**
- Modify: `src/components/layout/nav-config.ts`

- [ ] **Step 1: Add "Holdings" to PRIMARY_NAV_LINKS**

In `src/components/layout/nav-config.ts`, add the new entry:

```typescript
export const PRIMARY_NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/hexmining", label: "HexMining" },
  { href: "/portfolio/assets", label: "Holdings" },
] as const;
```

- [ ] **Step 2: Run the app-shell nav test to confirm it picks up the new link**

```
npx vitest run tests/components/app-shell-nav.test.tsx
```

Expected: All pass. The test iterates over `PRIMARY_NAV_LINKS` so it automatically covers the new entry.

---

## Task 4: Update active route registration test

**Files:**
- Modify: `tests/app/active-app-route-registration.test.ts`

- [ ] **Step 1: Add `"portfolio/assets"` to both route arrays in the test**

In `tests/app/active-app-route-registration.test.ts`:

Find the two identical route arrays (one for `src/app canonical pages exist`, one for `root app/ re-export pages exist`) and add `"portfolio/assets"` to each:

```typescript
const routes = [
  "",
  "debug/sync",
  "debug/wallets/import",
  "debug/wallets/tracked",
  "debug/prices/status",
  "transactions",
  "portfolio/assets",   // ← add this line
];
```

Do this for both route arrays (they appear twice, once in each `describe` block). Also add to the third array in `root app/ re-export files are thin`:

```typescript
const routes = [
  { route: "", label: "/" },
  { route: "debug/sync", label: "/debug/sync" },
  { route: "debug/wallets/import", label: "/debug/wallets/import" },
  { route: "debug/wallets/tracked", label: "/debug/wallets/tracked" },
  { route: "debug/prices/status", label: "/debug/prices/status" },
  { route: "transactions", label: "/transactions" },
  { route: "portfolio/assets", label: "/portfolio/assets" },  // ← add this
];
```

- [ ] **Step 2: Run the route registration test**

```
npx vitest run tests/app/active-app-route-registration.test.ts
```

Expected: All pass.

---

## Task 5: Full validation

- [ ] **Step 1: Run all targeted tests together**

```
npx vitest run tests/components/asset-holdings-screen-wiring.test.ts tests/components/app-shell-nav.test.tsx tests/app/active-app-route-registration.test.ts
```

Expected: All pass.

- [ ] **Step 2: Run lint**

```
npm.cmd run lint
```

Expected: No errors.

- [ ] **Step 3: Run typecheck**

```
npm.cmd run typecheck
```

Expected: No errors.

- [ ] **Step 4: Run build**

```
npm.cmd run build
```

Expected: Successful build.

---

## Task 6: Commit and PR

- [ ] **Step 1: Stage and commit**

```bash
git add src/components/portfolio/asset-holdings-screen.tsx \
        src/app/portfolio/assets/page.tsx \
        app/portfolio/assets/page.tsx \
        src/components/layout/nav-config.ts \
        tests/components/asset-holdings-screen-wiring.test.ts \
        tests/app/active-app-route-registration.test.ts \
        docs/superpowers/plans/2026-06-16-portfolio-asset-holdings-screen.md
git commit -m "feat(portfolio): add asset holdings screen at /portfolio/assets"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/portfolio-asset-holdings-screen
gh pr create \
  --title "feat(portfolio): add asset holdings screen" \
  --body "$(cat <<'EOF'
## Summary

- Adds `/portfolio/assets` — a user-facing page showing token holdings for the first tracked wallet
- Consumes existing `GET /api/portfolio/dashboard` DTO (`tokenPositions`) — zero backend changes
- Auto-selects first tracked wallet via `useTrackedWalletsQuery`; shows loading/error/empty states
- Displays `assetId`, `assetAddress`, `balanceQuantity` (string, bigint-safe), `valuation.status/valueQuote`, `pricing.status` verbatim from DTO
- Adds "Holdings" to primary navigation via `nav-config.ts`
- No frontend RPC, no frontend pricing/valuation/PnL calculation, no schema/package changes

## Does not include yet
- Multi-wallet switching (auto-selects first only)
- LP positions or stake positions (separate concerns)
- Display name/symbol (not in DTO)

## Test plan
- [ ] `npx vitest run tests/components/asset-holdings-screen-wiring.test.ts` — wiring, no-RPC, no-calc, DTO field rendering
- [ ] `npx vitest run tests/components/app-shell-nav.test.tsx` — Holdings link in nav
- [ ] `npx vitest run tests/app/active-app-route-registration.test.ts` — route registered
- [ ] `npm.cmd run lint && npm.cmd run typecheck && npm.cmd run build`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

- [x] Spec coverage: auto-select tracked wallet ✅ | token positions table ✅ | canonical identity shown ✅ | balanceQuantity string-display only ✅ | pricing/valuation verbatim ✅ | empty state honest text ✅ | loading/error states ✅ | nav link ✅ | no RPC ✅ | no calculations ✅ | no schema changes ✅
- [x] No placeholders — all code is complete and runnable
- [x] Type consistency — `DashboardTokenPositionDto` used consistently, `dashboard.wallet.chainId` (number) passed as `chainId: number` prop
- [x] Re-export shim pattern matches `app/transactions/page.tsx` exactly
- [x] Route arrays in test updated in all three places (two identical, one with labels)
