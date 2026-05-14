import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const OPERATOR_TOOLS_NAV_PATH = path.resolve(
  __dirname,
  "../../src/components/debug/operator-tools-nav.tsx",
);

const SCREEN_PATHS = [
  {
    name: "debug-sync-screen",
    filePath: path.resolve(
      __dirname,
      "../../src/components/debug/debug-sync-screen.tsx",
    ),
  },
  {
    name: "wallet-import-screen",
    filePath: path.resolve(
      __dirname,
      "../../src/components/wallets/wallet-import-screen.tsx",
    ),
  },
  {
    name: "tracked-wallets-screen",
    filePath: path.resolve(
      __dirname,
      "../../src/components/wallets/tracked-wallets-screen.tsx",
    ),
  },
  {
    name: "pricing-status-screen",
    filePath: path.resolve(
      __dirname,
      "../../src/components/prices/pricing-status-screen.tsx",
    ),
  },
] as const;

const OPERATOR_LINKS = [
  { href: "/debug/sync", label: "Debug sync" },
  { href: "/debug/wallets/import", label: "Wallet import" },
  { href: "/debug/wallets/tracked", label: "Tracked wallets" },
  { href: "/debug/prices/status", label: "Pricing status" },
] as const;

function readSource(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

describe("OperatorToolsNav", () => {
  it("imports Link from next/link", () => {
    const source = readSource(OPERATOR_TOOLS_NAV_PATH);
    expect(source).toContain('import Link from "next/link"');
  });

  it("uses the existing operator tools heading and SurfaceCard styling", () => {
    const source = readSource(OPERATOR_TOOLS_NAV_PATH);
    expect(source).toContain("Operator tools");
    expect(source).toContain("SurfaceCard");
    expect(source).toContain(
      'className="flex flex-wrap items-center gap-x-6 gap-y-2"',
    );
  });

  it.each(OPERATOR_LINKS)("defines the $label link", ({ href, label }) => {
    const source = readSource(OPERATOR_TOOLS_NAV_PATH);
    expect(source).toContain(`href: "${href}"`);
    expect(source).toContain(`label: "${label}"`);
  });

  it("does not reference backend providers, RPC, or browser fetches", () => {
    const source = readSource(OPERATOR_TOOLS_NAV_PATH);
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("CoinGecko");
    expect(source).not.toContain("GeckoTerminal");
    expect(source).not.toContain("Piteas");
    expect(source).not.toContain("Moralis");
    expect(source).not.toContain("rpc");
    expect(source).not.toContain("fetch(");
  });
});

describe.each(SCREEN_PATHS)("$name operator nav wiring", ({ filePath }) => {
  it("imports and renders OperatorToolsNav", () => {
    const source = readSource(filePath);
    expect(source).toContain(
      'import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";',
    );
    expect(source).toContain("<OperatorToolsNav />");
  });

  it("does not import next/link directly for inline operator nav links", () => {
    const source = readSource(filePath);
    expect(source).not.toContain('import Link from "next/link"');
  });

  it.each(OPERATOR_LINKS)("removes the inline $label href", ({ href }) => {
    const source = readSource(filePath);
    expect(source).not.toContain(`href="${href}"`);
  });
});
