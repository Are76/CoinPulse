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

  it("screen references /debug/prices/status", () => {
    const source = readScreenSource();
    expect(source).toContain('href="/debug/prices/status"');
  });

  it("screen references /debug/sync", () => {
    const source = readScreenSource();
    expect(source).toContain('href="/debug/sync"');
  });

  it("screen references /debug/wallets/import", () => {
    const source = readScreenSource();
    expect(source).toContain('href="/debug/wallets/import"');
  });

  it("screen references /debug/wallets/tracked", () => {
    const source = readScreenSource();
    expect(source).toContain('href="/debug/wallets/tracked"');
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
});
