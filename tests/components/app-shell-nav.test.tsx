/**
 * AppShell rendering and navigation tests.
 *
 * Verifies that the shell renders the CoinPulse brand, all verified active
 * route links, and the content slot — without inspecting source strings.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "@/components/layout/app-shell";
import { OPERATOR_NAV_LINKS, PRIMARY_NAV_LINKS } from "@/components/layout/nav-config";

afterEach(cleanup);

// ─── Brand ───────────────────────────────────────────────────────────────────

describe("AppShell brand", () => {
  it("renders the CoinPulse brand name at least once", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getAllByText("CoinPulse").length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Desktop sidebar navigation ───────────────────────────────────────────────

describe("AppShell desktop sidebar navigation", () => {
  it("renders the sidebar landmark", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("contains a link to the dashboard at /", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
  });

  it("contains a link to transactions at /transactions", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Transactions" })).toHaveAttribute("href", "/transactions");
  });

  it("contains a link to hexmining at /hexmining", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "HexMining" })).toHaveAttribute("href", "/hexmining");
  });

  it("primary nav link count matches PRIMARY_NAV_LINKS config", () => {
    render(<AppShell><div /></AppShell>);
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    const links = primaryNav.querySelectorAll("a");
    expect(links).toHaveLength(PRIMARY_NAV_LINKS.length);
  });
});

// ─── Desktop operator navigation ──────────────────────────────────────────────

describe("AppShell desktop operator navigation", () => {
  it("contains a link to debug sync at /debug/sync", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Debug sync" })).toHaveAttribute("href", "/debug/sync");
  });

  it("contains a link to wallet import at /debug/wallets/import", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Wallet import" })).toHaveAttribute("href", "/debug/wallets/import");
  });

  it("contains a link to tracked wallets at /debug/wallets/tracked", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Tracked wallets" })).toHaveAttribute("href", "/debug/wallets/tracked");
  });

  it("contains a link to pricing status at /debug/prices/status", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Pricing status" })).toHaveAttribute("href", "/debug/prices/status");
  });

  it("operator nav link count matches OPERATOR_NAV_LINKS config", () => {
    render(<AppShell><div /></AppShell>);
    const operatorNav = screen.getByRole("navigation", { name: "Operator tools" });
    const links = operatorNav.querySelectorAll("a");
    expect(links).toHaveLength(OPERATOR_NAV_LINKS.length);
  });
});

// ─── Mobile navigation ────────────────────────────────────────────────────────

describe("AppShell mobile navigation", () => {
  it("renders a mobile navigation landmark with accessible label", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
  });

  it("mobile navigation renders the CoinPulse brand label", () => {
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(within(mobileNav).getByText("CoinPulse")).toBeInTheDocument();
  });

  it("mobile navigation includes every PRIMARY_NAV_LINKS entry with correct href", () => {
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(mobileNav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("mobile navigation includes every OPERATOR_NAV_LINKS entry with correct href", () => {
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    for (const { label, href } of OPERATOR_NAV_LINKS) {
      expect(within(mobileNav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("mobile navigation link count matches total nav config entries", () => {
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    const links = mobileNav.querySelectorAll("a");
    expect(links).toHaveLength(PRIMARY_NAV_LINKS.length + OPERATOR_NAV_LINKS.length);
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
  it("every PRIMARY_NAV_LINKS entry renders as a link in the desktop sidebar", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("every OPERATOR_NAV_LINKS entry renders as a link in the desktop sidebar", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = screen.getByRole("complementary");
    for (const { label, href } of OPERATOR_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("nav config is the single source of route truth for mobile nav", () => {
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    const mobileLinks = mobileNav.querySelectorAll("a");
    expect(mobileLinks).toHaveLength(PRIMARY_NAV_LINKS.length + OPERATOR_NAV_LINKS.length);
  });
});
