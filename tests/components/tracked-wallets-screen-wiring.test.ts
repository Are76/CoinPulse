import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/wallets/tracked-wallets-screen.tsx",
);

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/debug/wallets/tracked/page.tsx",
);

function readSource() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPageSource() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

describe("tracked-wallets-screen wiring", () => {
  it("page imports and renders TrackedWalletsScreen", () => {
    const source = readPageSource();
    expect(source).toContain("TrackedWalletsScreen");
    expect(source).toContain(
      'from "@/components/wallets/tracked-wallets-screen"',
    );
  });

  it("screen imports useTrackedWalletsQuery from the shared hook", () => {
    const source = readSource();
    expect(source).toContain(
      'import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";',
    );
  });

  it("screen does not import fetchTrackedWallets directly", () => {
    const source = readSource();
    expect(source).not.toContain("fetchTrackedWallets");
  });

  it("screen renders the shared operator tools nav", () => {
    const source = readSource();
    expect(source).toContain(
      'import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";',
    );
    expect(source).toContain("<OperatorToolsNav />");
  });

  it("screen renders wallet backend fields: address, chainId, label, createdAt, updatedAt", () => {
    const source = readSource();
    expect(source).toContain("wallet.address");
    expect(source).toContain("wallet.chainId");
    expect(source).toContain("wallet.label");
    expect(source).toContain("wallet.createdAt");
    expect(source).toContain("wallet.updatedAt");
  });

  it('screen has "No tracked wallets" empty-state text', () => {
    const source = readSource();
    expect(source).toContain("No tracked wallets");
  });

  it('screen has "Tracked wallets" page title', () => {
    const source = readSource();
    expect(source).toContain("Tracked wallets");
  });
});
