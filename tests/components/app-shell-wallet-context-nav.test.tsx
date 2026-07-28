/**
 * AppShell wallet-context navigation forwarding tests.
 *
 * The shared navigation may forward only validated walletAddress + chainId
 * from the current URL to the primary portfolio links. Invalid or absent
 * params render the plain hrefs, operator links never carry context, and
 * assetId is never forwarded by general navigation.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/app-shell";
import { OPERATOR_NAV_LINKS, PRIMARY_NAV_LINKS } from "@/components/layout/nav-config";

const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const VALID_CONTEXT = `walletAddress=${VALID_ADDRESS}&chainId=369`;

beforeEach(() => {
  nav.search = "";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function getSidebar() {
  return screen.getByRole("complementary");
}

describe("AppShell — no wallet context", () => {
  it("renders plain primary hrefs when no query params exist", () => {
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("renders plain hrefs when only walletAddress is present", () => {
    nav.search = `walletAddress=${VALID_ADDRESS}`;
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });
});

describe("AppShell — valid wallet context forwarding", () => {
  it("appends walletAddress and chainId to every primary link", () => {
    nav.search = VALID_CONTEXT;
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `${href}?walletAddress=${VALID_ADDRESS}&chainId=369`,
      );
    }
  });

  it("mobile navigation forwards the same validated context", () => {
    nav.search = VALID_CONTEXT;
    render(<AppShell><div /></AppShell>);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(mobileNav).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `${href}?walletAddress=${VALID_ADDRESS}&chainId=369`,
      );
    }
  });

  it("operator links never carry wallet context", () => {
    nav.search = VALID_CONTEXT;
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label, href } of OPERATOR_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("does not forward assetId or other unrelated params", () => {
    nav.search = `${VALID_CONTEXT}&assetId=chain:369:erc20:0x2222222222222222222222222222222222222222&cursor=abc`;
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label } of PRIMARY_NAV_LINKS) {
      const href = within(sidebar).getByRole("link", { name: label }).getAttribute("href")!;
      expect(href).toContain(`walletAddress=${VALID_ADDRESS}`);
      expect(href).toContain("chainId=369");
      expect(href).not.toContain("assetId");
      expect(href).not.toContain("cursor");
    }
  });
});

describe("AppShell — invalid params are not forwarded", () => {
  it.each([
    ["unsupported chainId", `walletAddress=${VALID_ADDRESS}&chainId=1`],
    ["non-integer chainId", `walletAddress=${VALID_ADDRESS}&chainId=abc`],
    ["negative chainId", `walletAddress=${VALID_ADDRESS}&chainId=-369`],
    ["blank walletAddress", "walletAddress=%20%20&chainId=369"],
    ["chainId without walletAddress", "chainId=369"],
  ])("renders plain hrefs for %s", (_label, search) => {
    nav.search = search;
    render(<AppShell><div /></AppShell>);
    const sidebar = getSidebar();
    for (const { label, href } of PRIMARY_NAV_LINKS) {
      expect(within(sidebar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });
});

describe("AppShell — structure and accessibility preserved with context", () => {
  it("keeps navigation landmarks, labels, and link counts intact", () => {
    nav.search = VALID_CONTEXT;
    render(<AppShell><div /></AppShell>);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(primaryNav.querySelectorAll("a")).toHaveLength(PRIMARY_NAV_LINKS.length);
    const operatorNav = screen.getByRole("navigation", { name: "Operator tools" });
    expect(operatorNav.querySelectorAll("a")).toHaveLength(OPERATOR_NAV_LINKS.length);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(mobileNav.querySelectorAll("a")).toHaveLength(
      PRIMARY_NAV_LINKS.length + OPERATOR_NAV_LINKS.length,
    );
  });
});
