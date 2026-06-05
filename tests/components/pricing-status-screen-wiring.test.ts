import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/prices/pricing-status-screen.tsx",
);

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/debug/prices/status/page.tsx",
);

function readScreenSource() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

describe("pricing-status-screen wiring", () => {
  it("page imports and renders PricingStatusScreen", () => {
    const source = readPageSource();
    expect(source).toContain("PricingStatusScreen");
    expect(source).toContain(
      'from "@/components/prices/pricing-status-screen"',
    );
  });

  it("screen imports usePricingStatusQuery from the shared hook", () => {
    const source = readScreenSource();
    expect(source).toContain(
      'import { usePricingStatusQuery } from "@/lib/query/use-pricing-status-query";',
    );
  });

  it("screen does not import fetchPricingStatus directly", () => {
    const source = readScreenSource();
    expect(source).not.toContain("fetchPricingStatus");
  });

  it("screen renders the shared operator tools nav", () => {
    const source = readScreenSource();
    expect(source).toContain(
      'import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";',
    );
    expect(source).toContain("<OperatorToolsNav />");
  });

  it("screen renders backend pricing source fields", () => {
    const source = readScreenSource();
    expect(source).toContain("source.sourceType");
    expect(source).toContain("source.status");
    expect(source).toContain("source.latestObservedAt");
    expect(source).toContain("source.staleAfterSeconds");
    expect(source).toContain("source.observationsCount");
    expect(source).toContain("source.rejectedCount");
    expect(source).toContain("source.reason");
  });

  it('screen has "Pricing status" page title', () => {
    const source = readScreenSource();
    expect(source).toContain("Pricing status");
  });

  it('screen has "No pricing sources" empty-state text', () => {
    const source = readScreenSource();
    expect(source).toContain("No pricing sources");
  });

  it("does not reference external provider fetches or RPC", () => {
    const source = readScreenSource();
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("CoinGecko");
    expect(source).not.toContain("GeckoTerminal");
    expect(source).not.toContain("Piteas");
    expect(source).not.toContain("Moralis");
    expect(source).not.toContain("rpc");
    expect(source).not.toContain("fetch(");
  });

  it("does not use useEffect or setInterval for ad hoc polling", () => {
    const source = readScreenSource();
    expect(source).not.toContain("useEffect");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });

  it("renders rejected count and reason fields explicitly — does not hide or coerce them", () => {
    const source = readScreenSource();
    // Both fields must be rendered directly from the backend DTO
    expect(source).toContain("source.rejectedCount");
    expect(source).toContain("source.reason");
    // Must not coerce null/missing values to zero or OK
    expect(source).not.toMatch(/rejectedCount\s*(?:===|==)\s*0\s*\?\s*["']ok["']/);
    expect(source).not.toMatch(/reason\s*\?\?\s*["']ok["']/);
  });

  it("does not compute prices, valuation, PnL, liquidity, or confidence in the screen", () => {
    const source = readScreenSource();
    expect(source).not.toContain("computePrice");
    expect(source).not.toContain("computeBalance");
    expect(source).not.toContain("pnl");
    expect(source).not.toContain("liquidity");
    expect(source).not.toContain("confidence");
    expect(source).not.toMatch(/price\s*[+\-*/]/);
    expect(source).not.toMatch(/balance\s*[+\-*/]/);
  });

  it("does not load or invalidate dashboard queries", () => {
    const source = readScreenSource();
    expect(source).not.toContain("useDashboard");
    expect(source).not.toContain("useDashboardQuery");
    expect(source).not.toContain('"dashboard"');
    expect(source).not.toContain("invalidateQueries");
  });

  it("page does not import dashboard or wallet mutation hooks", () => {
    const source = readPageSource();
    expect(source).not.toContain("useDashboard");
    expect(source).not.toContain("useWalletImport");
    expect(source).not.toContain("invalidateQueries");
  });
});
