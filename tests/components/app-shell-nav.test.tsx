/**
 * AppShell rendering and navigation tests.
 *
 * Verifies that the shell renders the CoinPulse brand, all verified active
 * route links, and the content slot — without inspecting source strings.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "@/components/layout/app-shell";
import { OPERATOR_NAV_LINKS, PRIMARY_NAV_LINKS } from "@/components/layout/nav-config";

afterEach(cleanup);

// ─── Brand ───────────────────────────────────────────────────────────────────

describe("AppShell brand", () => {
  it("renders the CoinPulse brand name", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByText("CoinPulse")).toBeInTheDocument();
  });
});

// ─── Primary navigation ───────────────────────────────────────────────────────

describe("AppShell primary navigation", () => {
  it("contains a link to the dashboard at /", () => {
    render(<AppShell><div /></AppShell>);
    const link = screen.getByRole("link", { name: "Dashboard" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("contains a link to transactions at /transactions", () => {
    render(<AppShell><div /></AppShell>);
    const link = screen.getByRole("link", { name: "Transactions" });
    expect(link).toHaveAttribute("href", "/transactions");
  });

  it("primary nav link count matches PRIMARY_NAV_LINKS config", () => {
    render(<AppShell><div /></AppShell>);
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    const links = primaryNav.querySelectorAll("a");
    expect(links).toHaveLength(PRIMARY_NAV_LINKS.length);
  });
});

// ─── Operator navigation ──────────────────────────────────────────────────────

describe("AppShell operator navigation", () => {
  it("contains a link to debug sync at /debug/sync", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Debug sync" })).toHaveAttribute("href", "/debug/sync");
  });

  it("contains a link to wallet import at /debug/wallets/import", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Wallet import" })).toHaveAttribute("href", "/debug/wallets/import");
  });

  it("contains a link to tracked wallets at /debug/wallets/tracked", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Tracked wallets" })).toHaveAttribute("href", "/debug/wallets/tracked");
  });

  it("contains a link to pricing status at /debug/prices/status", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Pricing status" })).toHaveAttribute("href", "/debug/prices/status");
  });

  it("operator nav link count matches OPERATOR_NAV_LINKS config", () => {
    render(<AppShell><div /></AppShell>);
    const operatorNav = screen.getByRole("navigation", { name: "Operator tools" });
    const links = operatorNav.querySelectorAll("a");
    expect(links).toHaveLength(OPERATOR_NAV_LINKS.length);
  });
});

// ─── Content slot ─────────────────────────────────────────────────────────────

describe("AppShell content slot", () => {
  it("renders children inside the shell body", () => {
    render(
      <AppShell>
        <div data-testid="page-content">page content</div>
      </AppShell>,
    );
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("renders children text content without modification", () => {
    render(
      <AppShell>
        <p>Hello from page</p>
      </AppShell>,
    );
    expect(screen.getByText("Hello from page")).toBeInTheDocument();
  });
});

// ─── Route coverage ───────────────────────────────────────────────────────────

describe("AppShell verified active route coverage", () => {
  it("every PRIMARY_NAV_LINKS entry renders as a link", () => {
    render(<AppShell><div /></AppShell>);
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("every OPERATOR_NAV_LINKS entry renders as a link", () => {
    render(<AppShell><div /></AppShell>);
    for (const { label, href } of OPERATOR_NAV_LINKS) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
  });
});
