/**
 * DashboardScreen URL navigation-context behavior.
 *
 * URL params (walletAddress + chainId) are draft-state input only:
 * they populate the form, suppress the first-tracked-wallet auto-load, and
 * never enable the dashboard query. Explicit submit updates the URL once via
 * router.replace. Invalid params fall back to existing behavior.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/",
}));

vi.mock("@/lib/api/dashboard-client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  fetchDebugHealth: vi.fn(async () => ({
    status: "ok",
    dependencies: { database: { status: "ok" }, redis: { status: "ok" } },
  })),
  fetchDebugStatus: vi.fn(async () => ({ sourceFamilies: ["pulsechain"] })),
}));

vi.mock("@/lib/query/use-dashboard-query", () => ({
  useDashboardQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-debug-health-query", () => ({
  useDebugHealthQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-debug-status-query", () => ({
  useDebugStatusQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-tracked-wallets-query", () => ({
  useTrackedWalletsQuery: vi.fn(),
}));

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseDebugHealthQuery = vi.mocked(useDebugHealthQuery);
const mockUseDebugStatusQuery = vi.mocked(useDebugStatusQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);

const URL_WALLET = "0x2222222222222222222222222222222222222222";
const TRACKED_WALLET: TrackedWalletDto = {
  id: "wallet-1",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function idleQuery() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  };
}

function trackedWalletsSuccess(wallets: TrackedWalletDto[]) {
  return {
    ...idleQuery(),
    data: { schemaVersion: "v1", wallets },
    isSuccess: true,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderScreen() {
  return render(<DashboardScreen />, { wrapper: makeWrapper() });
}

function dashboardQueryEnabledCalls() {
  return mockUseDashboardQuery.mock.calls.filter(([args]) => args.enabled === true);
}

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  mockUseDashboardQuery.mockReturnValue(idleQuery() as never);
  mockUseDebugHealthQuery.mockReturnValue(idleQuery() as never);
  mockUseDebugStatusQuery.mockReturnValue(idleQuery() as never);
  mockUseTrackedWalletsQuery.mockReturnValue(trackedWalletsSuccess([]) as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── URL params → draft state ─────────────────────────────────────────────────

describe("DashboardScreen — URL params populate draft state only", () => {
  it("populates the wallet and chain fields from valid URL params", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
  });

  it("does not enable the dashboard query before an explicit submit", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    expect(dashboardQueryEnabledCalls()).toHaveLength(0);
  });

  it("suppresses the first-tracked-wallet auto-load when URL params are present", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    mockUseTrackedWalletsQuery.mockReturnValue(
      trackedWalletsSuccess([TRACKED_WALLET]) as never,
    );
    renderScreen();
    expect(dashboardQueryEnabledCalls()).toHaveLength(0);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);
  });

  it("preserves the tracked-wallet auto-load when no URL params exist", () => {
    mockUseTrackedWalletsQuery.mockReturnValue(
      trackedWalletsSuccess([TRACKED_WALLET]) as never,
    );
    renderScreen();
    const enabledCalls = dashboardQueryEnabledCalls();
    expect(enabledCalls.length).toBeGreaterThan(0);
    expect(enabledCalls.at(-1)![0]).toMatchObject({
      walletAddress: TRACKED_WALLET.address.toLowerCase(),
      chainId: TRACKED_WALLET.chainId,
    });
  });

  it("falls back to form defaults for invalid URL params without a validation error", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=abc`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
    expect(screen.queryByText(/Chain ID must be/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Wallet address is required/i)).not.toBeInTheDocument();
  });

  it("keeps the auto-load behavior when URL params are invalid", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=abc`;
    mockUseTrackedWalletsQuery.mockReturnValue(
      trackedWalletsSuccess([TRACKED_WALLET]) as never,
    );
    renderScreen();
    expect(dashboardQueryEnabledCalls().length).toBeGreaterThan(0);
  });
});

// ── URL updates ──────────────────────────────────────────────────────────────

describe("DashboardScreen — URL update behavior", () => {
  it("explicit valid submit enables the query and calls router.replace once", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(walletInput, { target: { value: URL_WALLET } });
    fireEvent.submit(walletInput.closest("form")!);

    expect(dashboardQueryEnabledCalls().length).toBeGreaterThan(0);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(
      `/?walletAddress=${URL_WALLET}&chainId=369`,
      { scroll: false },
    );
  });

  it("draft typing does not call router.replace", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(walletInput, { target: { value: "0xaaa" } });
    fireEvent.change(walletInput, { target: { value: "0xaaab" } });
    fireEvent.change(screen.getByLabelText("Chain ID"), { target: { value: "369" } });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("selecting a tracked wallet alone does not update the URL", () => {
    mockUseTrackedWalletsQuery.mockReturnValue(
      trackedWalletsSuccess([TRACKED_WALLET]) as never,
    );
    // URL context present so the auto-load (an internal submit) stays out of the way
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    fireEvent.click(
      screen.getByRole("button", { name: `Select wallet ${TRACKED_WALLET.address}` }),
    );
    expect(nav.replace).not.toHaveBeenCalled();
    // Selection populates the draft only
    expect(screen.getByLabelText("Wallet address")).toHaveValue(TRACKED_WALLET.address);
    expect(dashboardQueryEnabledCalls()).toHaveLength(0);
  });

  it("an invalid submit does not call router.replace", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(screen.getByLabelText("Chain ID"), { target: { value: "abc" } });
    fireEvent.change(walletInput, { target: { value: URL_WALLET } });
    fireEvent.submit(walletInput.closest("form")!);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Chain ID must be a positive integer/i)).toBeInTheDocument();
  });
});

// ── Same-route URL changes ───────────────────────────────────────────────────

describe("DashboardScreen — same-route URL changes", () => {
  it("updates draft state when the URL context changes while mounted, without looping", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    const { rerender } = renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);

    const nextWallet = "0x3333333333333333333333333333333333333333";
    nav.search = `walletAddress=${nextWallet}&chainId=369`;
    rerender(<DashboardScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(nextWallet);

    // A further rerender with the same URL does not overwrite user edits
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: "0xedit" } });
    rerender(<DashboardScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue("0xedit");

    // No query was enabled and no URL write happened from URL-driven syncs
    expect(dashboardQueryEnabledCalls()).toHaveLength(0);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
