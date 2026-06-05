import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/debug/wallets/import/page.tsx",
);

function readPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

describe("wallet-import page wiring", () => {
  it("renders WalletImportScreen", () => {
    const source = readPage();

    expect(source).toContain("WalletImportScreen");
  });

  it("imports WalletImportScreen from the wallets component", () => {
    const source = readPage();

    expect(source).toContain(
      'from "@/components/wallets/wallet-import-screen"',
    );
  });

  it("does not import dashboard or pricing queries", () => {
    const source = readPage();

    expect(source).not.toContain("useDashboard");
    expect(source).not.toContain("usePricingStatus");
    expect(source).not.toContain("useTransaction");
  });
});
