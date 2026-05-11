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

function readScreenSource(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

describe("debug-sync-screen operator nav links", () => {
  it("imports Link from next/link", () => {
    const source = readScreenSource(DEBUG_SYNC_SCREEN_PATH);
    expect(source).toContain('import Link from "next/link"');
  });

  it("includes a link to /debug/wallets/import", () => {
    const source = readScreenSource(DEBUG_SYNC_SCREEN_PATH);
    expect(source).toContain('href="/debug/wallets/import"');
  });

  it("includes the label Wallet import", () => {
    const source = readScreenSource(DEBUG_SYNC_SCREEN_PATH);
    expect(source).toContain("Wallet import");
  });

  it("includes a link to /debug/sync", () => {
    const source = readScreenSource(DEBUG_SYNC_SCREEN_PATH);
    expect(source).toContain('href="/debug/sync"');
  });

  it("includes the label Debug sync", () => {
    const source = readScreenSource(DEBUG_SYNC_SCREEN_PATH);
    expect(source).toContain("Debug sync");
  });
});

describe("wallet-import-screen operator nav links", () => {
  it("imports Link from next/link", () => {
    const source = readScreenSource(WALLET_IMPORT_SCREEN_PATH);
    expect(source).toContain('import Link from "next/link"');
  });

  it("includes a link to /debug/wallets/import", () => {
    const source = readScreenSource(WALLET_IMPORT_SCREEN_PATH);
    expect(source).toContain('href="/debug/wallets/import"');
  });

  it("includes the label Wallet import", () => {
    const source = readScreenSource(WALLET_IMPORT_SCREEN_PATH);
    expect(source).toContain("Wallet import");
  });

  it("includes a link to /debug/sync", () => {
    const source = readScreenSource(WALLET_IMPORT_SCREEN_PATH);
    expect(source).toContain('href="/debug/sync"');
  });

  it("includes the label Debug sync", () => {
    const source = readScreenSource(WALLET_IMPORT_SCREEN_PATH);
    expect(source).toContain("Debug sync");
  });
});
