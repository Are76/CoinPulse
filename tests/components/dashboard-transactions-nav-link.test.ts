import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PRESENTERS_PATH = path.resolve(
  __dirname,
  "../../src/components/dashboard/dashboard-presenters.tsx",
);

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/dashboard/dashboard-screen.tsx",
);

function readSource(p: string) {
  return fs.readFileSync(p, "utf8");
}

describe("DashboardHero — /transactions navigation link", () => {
  it("imports Link from next/link", () => {
    const source = readSource(PRESENTERS_PATH);
    expect(source).toContain('import Link from "next/link"');
  });

  it("includes a link to /transactions", () => {
    const source = readSource(PRESENTERS_PATH);
    expect(source).toContain('href="/transactions"');
  });

  it("link label contains 'Transaction history'", () => {
    const source = readSource(PRESENTERS_PATH);
    expect(source).toContain("Transaction history");
  });

  it("link is inside DashboardHero", () => {
    const source = readSource(PRESENTERS_PATH);
    const heroStart = source.indexOf("export function DashboardHero");
    const heroEnd = source.indexOf("\nexport function", heroStart + 1);
    const heroBody = source.slice(heroStart, heroEnd === -1 ? undefined : heroEnd);
    expect(heroBody).toContain('href="/transactions"');
  });
});

describe("DashboardScreen — renders DashboardHero", () => {
  it("renders DashboardHero which contains the /transactions link", () => {
    const source = readSource(SCREEN_PATH);
    expect(source).toContain("<DashboardHero");
  });
});
