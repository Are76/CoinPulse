import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DEBUG_SYNC_SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/debug/debug-sync-screen.tsx",
);

const WALLET_IMPORT_SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/wallets/wallet-import-screen.tsx",
);

function readDebugSyncScreenSource() {
  return fs.readFileSync(DEBUG_SYNC_SCREEN_PATH, "utf8");
}

function readWalletImportScreenSource() {
  return fs.readFileSync(WALLET_IMPORT_SCREEN_PATH, "utf8");
}

describe("debug-sync-screen operator nav links", () => {
  it("imports Link from next/link", () => {
    const source = readDebugSyncScreenSource();
    expect(source).toContain('import Link from "next/link"');
  });

  it("includes a link to /debug/wallets/import", () => {
    const source = readDebugSyncScreenSource();
    expect(source).toContain('href="/debug/wallets/import"');
  });

  it("includes the label Wallet import", () => {
    const source = readDebugSyncScreenSource();
    expect(source).toContain("Wallet import");
  });

  it("includes a link to /debug/sync", () => {
    const source = readDebugSyncScreenSource();
    expect(source).toContain('href="/debug/sync"');
  });

  it("includes the label Debug sync", () => {
    const source = readDebugSyncScreenSource();
    expect(source).toContain("Debug sync");
  });
});

describe("wallet-import-screen operator nav links", () => {
  it("imports Link from next/link", () => {
    const source = readWalletImportScreenSource();
    expect(source).toContain('import Link from "next/link"');
  });

  it("includes a link to /debug/wallets/import", () => {
    const source = readWalletImportScreenSource();
    expect(source).toContain('href="/debug/wallets/import"');
  });

  it("includes the label Wallet import", () => {
    const source = readWalletImportScreenSource();
    expect(source).toContain("Wallet import");
  });

  it("includes a link to /debug/sync", () => {
    const source = readWalletImportScreenSource();
    expect(source).toContain('href="/debug/sync"');
  });

  it("includes the label Debug sync", () => {
    const source = readWalletImportScreenSource();
    expect(source).toContain("Debug sync");
  });
});
