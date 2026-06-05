import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Root active app/ tree lives at <repo>/app/
// Canonical source pages live at <repo>/src/app/
// Root re-exports must be thin (only re-export default, no hook/client imports).

const ROOT = path.resolve(__dirname, "../../");

function rootAppPage(route: string) {
  return path.join(ROOT, "app", route, "page.tsx");
}

function srcAppPage(route: string) {
  return path.join(ROOT, "src", "app", route, "page.tsx");
}

function readFile(p: string) {
  return fs.readFileSync(p, "utf8");
}

// ── Source pages exist ────────────────────────────────────────────────────────

describe("src/app canonical pages exist", () => {
  const routes = [
    "",
    "debug/sync",
    "debug/wallets/import",
    "debug/wallets/tracked",
    "debug/prices/status",
    "transactions",
  ];

  for (const route of routes) {
    it(`src/app/${route || "."}/page.tsx exists`, () => {
      expect(fs.existsSync(srcAppPage(route))).toBe(true);
    });
  }
});

// ── Root app/ re-exports exist ────────────────────────────────────────────────

describe("root app/ re-export pages exist for all src/app pages", () => {
  const routes = [
    "",
    "debug/sync",
    "debug/wallets/import",
    "debug/wallets/tracked",
    "debug/prices/status",
    "transactions",
  ];

  for (const route of routes) {
    it(`app/${route || "."}/page.tsx exists`, () => {
      expect(fs.existsSync(rootAppPage(route))).toBe(true);
    });
  }
});

// ── Re-exports are thin ───────────────────────────────────────────────────────

describe("root app/ re-export files are thin (no direct hook/client imports)", () => {
  const routes = [
    { route: "", label: "/" },
    { route: "debug/sync", label: "/debug/sync" },
    { route: "debug/wallets/import", label: "/debug/wallets/import" },
    { route: "debug/wallets/tracked", label: "/debug/wallets/tracked" },
    { route: "debug/prices/status", label: "/debug/prices/status" },
    { route: "transactions", label: "/transactions" },
  ];

  for (const { route, label } of routes) {
    it(`${label} re-export does not import query hooks directly`, () => {
      const source = readFile(rootAppPage(route));
      expect(source).not.toContain("useQuery");
      expect(source).not.toContain("useDashboardQuery");
      expect(source).not.toContain("useTransactionsQuery");
      expect(source).not.toContain("useTrackedWalletsQuery");
    });

    it(`${label} re-export does not import API clients directly`, () => {
      const source = readFile(rootAppPage(route));
      expect(source).not.toContain("fetchTransactions");
      expect(source).not.toContain("fetchPortfolioDashboard");
      expect(source).not.toContain("fetch(");
    });

    it(`${label} re-export contains a default re-export from src/app`, () => {
      const source = readFile(rootAppPage(route));
      expect(source).toMatch(/export\s*\{[^}]*default[^}]*\}\s*from/);
    });
  }
});

// ── Root app/ layout exists ───────────────────────────────────────────────────

describe("root app/ layout re-export exists", () => {
  it("app/layout.tsx exists", () => {
    expect(fs.existsSync(path.join(ROOT, "app", "layout.tsx"))).toBe(true);
  });

  it("app/layout.tsx re-exports default and metadata from src/app/layout", () => {
    const source = readFile(path.join(ROOT, "app", "layout.tsx"));
    expect(source).toContain("default");
    expect(source).toContain("metadata");
    expect(source).toMatch(/export\s*\{[^}]*default[^}]*\}\s*from/);
  });

  it("app/layout.tsx does not define its own html/body markup", () => {
    const source = readFile(path.join(ROOT, "app", "layout.tsx"));
    expect(source).not.toContain("<html");
    expect(source).not.toContain("<body");
  });
});

// ── Backend API routes are not changed ───────────────────────────────────────

describe("root app/api route handlers are not changed by this PR", () => {
  const apiRoutes = [
    "api/debug/health/route.ts",
    "api/debug/status/route.ts",
    "api/portfolio/dashboard/route.ts",
    "api/prices/ingest/route.ts",
    "api/prices/status/route.ts",
    "api/rebuild/route.ts",
    "api/sync/manual/route.ts",
    "api/transactions/route.ts",
    "api/wallets/import/route.ts",
    "api/wallets/tracked/route.ts",
  ];

  for (const route of apiRoutes) {
    it(`app/${route} still exists and is not a re-export shim`, () => {
      const p = path.join(ROOT, "app", route);
      expect(fs.existsSync(p)).toBe(true);
      const source = readFile(p);
      // Route handlers must define a GET/POST/etc export directly, not re-export
      expect(source).toMatch(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/);
    });
  }
});
