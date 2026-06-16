/**
 * Wiring and contract tests for the AssetHoldingsScreen.
 *
 * These are source-text tests — they verify architectural invariants:
 * no frontend RPC, no frontend calculations, correct hook usage,
 * DTO field rendering, bigint/string-safe balance display.
 */

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

const ROOT_SHIM_PATH = path.resolve(
  __dirname,
  "../../app/portfolio/assets/page.tsx",
);

function readScreen() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

function readShim() {
  return fs.readFileSync(ROOT_SHIM_PATH, "utf8");
}

// ── Route registration ─────────────────────────────────────────────────────────

describe("asset holdings page file structure", () => {
  it("src/app/portfolio/assets/page.tsx exists", () => {
    expect(fs.existsSync(PAGE_PATH)).toBe(true);
  });

  it("app/portfolio/assets/page.tsx shim exists", () => {
    expect(fs.existsSync(ROOT_SHIM_PATH)).toBe(true);
  });

  it("page imports and renders AssetHoldingsScreen", () => {
    const src = readPage();
    expect(src).toContain("AssetHoldingsScreen");
    expect(src).toContain('from "@/components/portfolio/asset-holdings-screen"');
  });

  it("root shim re-exports default from src/app page", () => {
    const src = readShim();
    expect(src).toMatch(/export\s*\{[^}]*default[^}]*\}\s*from/);
    expect(src).toContain("@/app/portfolio/assets/page");
  });

  it("root shim does not import query hooks directly", () => {
    const src = readShim();
    expect(src).not.toContain("useQuery");
    expect(src).not.toContain("useDashboardQuery");
    expect(src).not.toContain("useTrackedWalletsQuery");
  });

  it("root shim does not call fetch functions directly", () => {
    const src = readShim();
    expect(src).not.toContain("fetchPortfolioDashboard");
    expect(src).not.toContain("fetch(");
  });
});

// ── Query hook wiring ──────────────────────────────────────────────────────────

describe("asset-holdings-screen query hook wiring", () => {
  it("screen imports useTrackedWalletsQuery from the shared hook", () => {
    const src = readScreen();
    expect(src).toContain('from "@/lib/query/use-tracked-wallets-query"');
  });

  it("screen imports useDashboardQuery from the shared hook", () => {
    const src = readScreen();
    expect(src).toContain('from "@/lib/query/use-dashboard-query"');
  });

  it("screen does not call fetchPortfolioDashboard directly", () => {
    const src = readScreen();
    expect(src).not.toContain("fetchPortfolioDashboard");
  });

  it("screen does not call fetchTrackedWallets directly", () => {
    const src = readScreen();
    expect(src).not.toContain("fetchTrackedWallets");
  });
});

// ── No frontend RPC ────────────────────────────────────────────────────────────

describe("asset-holdings-screen no RPC", () => {
  it("screen does not import from RPC service", () => {
    const src = readScreen();
    expect(src).not.toContain("@/services/rpc");
    expect(src).not.toContain("rpc-client");
    expect(src).not.toContain("ethers");
    expect(src).not.toContain("viem");
  });

  it("screen does not call eth_call or similar RPC methods", () => {
    const src = readScreen();
    expect(src).not.toContain("eth_call");
    expect(src).not.toContain("eth_getBalance");
    expect(src).not.toContain("getBlock");
  });

  it("screen does not use useEffect for data fetching", () => {
    const src = readScreen();
    // useEffect is the ad-hoc polling anti-pattern; TanStack Query handles this
    expect(src).not.toContain("useEffect");
  });
});

// ── No frontend calculations ───────────────────────────────────────────────────

describe("asset-holdings-screen no frontend calculations", () => {
  it("screen does not call Number() on token quantities or balances", () => {
    const src = readScreen();
    expect(src).not.toMatch(/Number\s*\(\s*\w*[Qq]uantity/);
    expect(src).not.toMatch(/Number\s*\(\s*\w*[Bb]alance/);
    expect(src).not.toMatch(/Number\s*\(\s*balance/i);
  });

  it("screen does not call parseFloat on token quantities or balances", () => {
    const src = readScreen();
    expect(src).not.toMatch(/parseFloat\s*\(\s*\w*[Qq]uantity/);
    expect(src).not.toMatch(/parseFloat\s*\(\s*\w*[Bb]alance/);
  });

  it("screen does not compute price × balance", () => {
    const src = readScreen();
    expect(src).not.toMatch(/price\s*\*\s*balance/i);
    expect(src).not.toMatch(/balance\s*\*\s*price/i);
    expect(src).not.toMatch(/valueQuote\s*\*/);
    expect(src).not.toMatch(/\*\s*valueQuote/);
  });

  it("screen does not compute portfolio total", () => {
    const src = readScreen();
    expect(src).not.toContain("reduce");
    expect(src).not.toContain("totalValue");
    expect(src).not.toContain("portfolioTotal");
  });

  it("screen does not calculate PnL", () => {
    const src = readScreen();
    expect(src).not.toContain("calculatePnl");
    expect(src).not.toContain("computePnl");
    expect(src).not.toContain("averageCost");
  });

  it("screen does not calculate valuation", () => {
    const src = readScreen();
    expect(src).not.toContain("calculateValuation");
    expect(src).not.toContain("computeValue");
    expect(src).not.toContain("computeValuation");
  });

  it("screen does not use token symbol as identity", () => {
    const src = readScreen();
    expect(src).not.toContain("ticker");
    // Should not key by symbol; assetId is the key
    expect(src).not.toMatch(/key=\{position\.symbol/);
    expect(src).not.toMatch(/key=\{position\.ticker/);
  });
});

// ── DTO field rendering ────────────────────────────────────────────────────────

describe("asset-holdings-screen DTO field rendering", () => {
  it("renders position.assetId for canonical asset identity", () => {
    const src = readScreen();
    expect(src).toContain("position.assetId");
  });

  it("renders position.assetAddress for on-chain address", () => {
    const src = readScreen();
    expect(src).toContain("position.assetAddress");
  });

  it("renders position.balanceQuantity as a display string", () => {
    const src = readScreen();
    expect(src).toContain("position.balanceQuantity");
  });

  it("renders position.pricing.status from backend DTO", () => {
    const src = readScreen();
    expect(src).toContain("position.pricing.status");
  });

  it("renders position.valuation.status from backend DTO", () => {
    const src = readScreen();
    expect(src).toContain("position.valuation.status");
  });

  it("renders position.valuation.valueQuote from backend DTO", () => {
    const src = readScreen();
    expect(src).toContain("position.valuation.valueQuote");
  });

  it("renders dashboard.wallet.chainId for chain-aware identity", () => {
    const src = readScreen();
    expect(src).toContain("dashboard.wallet.chainId");
  });

  it('shows "Value unavailable" fallback for null valueQuote', () => {
    const src = readScreen();
    expect(src).toContain("Value unavailable");
  });
});

// ── States ─────────────────────────────────────────────────────────────────────

describe("asset-holdings-screen states", () => {
  it('has honest empty-state text when no assets returned from backend', () => {
    const src = readScreen();
    expect(src).toContain("No backend asset holdings available");
  });

  it("renders a loading state while dashboard data is fetching", () => {
    const src = readScreen();
    // Must reference isPending or isLoading for the dashboard query
    expect(src).toMatch(/dashboardQuery\.(isPending|isLoading)/);
  });

  it("renders an error state when dashboard query fails", () => {
    const src = readScreen();
    expect(src).toContain("dashboardQuery.isError");
  });
});

// ── DexScreener and pricing resolver ──────────────────────────────────────────

describe("asset-holdings-screen no DexScreener or resolver", () => {
  it("does not reference DexScreener", () => {
    const src = readScreen();
    expect(src).not.toContain("dexscreener");
    expect(src).not.toContain("DexScreener");
  });

  it("does not import from pricing resolver", () => {
    const src = readScreen();
    expect(src).not.toContain("price-resolver");
    expect(src).not.toContain("resolveBestPrice");
  });
});
