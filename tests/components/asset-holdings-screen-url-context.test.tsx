/**
 * AssetHoldingsScreen URL navigation-context behavior.
 *
 * AppShell forwards validated walletAddress + chainId to /portfolio/assets.
 * The screen must select the matching tracked wallet when the forwarded
 * context is valid, fall back to the existing wallets[0] default when no
 * context is present, ignore invalid/unsupported context, and preserve the
 * existing manual wallet-switch buttons.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetHoldingsScreen } from "@/components/portfolio/asset-holdings-screen";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

vi.mock("@/lib/query/use-dashboard-query", () => ({
  useDashboardQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-tracked-wallets-query", () => ({
  useTrackedWalletsQuery: vi.fn(),
}));

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);

const WALLET_A: TrackedWalletDto = {
  id: "wallet-a",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "First",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const WALLET_B: TrackedWalletDto = {
  id: "wallet-b",
  address: "0x2222222222222222222222222222222222222222",
  chainId: 369,
  label: "Second",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function idleQuery() {
  return { data: undefined, isPending: false, isError: false, isSuccess: false, error: null };
}

function trackedWalletsSuccess(wallets: TrackedWalletDto[]) {
  return { ...idleQuery(), data: { schemaVersion: "v1", wallets }, isSuccess: true };
}

function dashboardIdle() {
  return { ...idleQuery(), isPending: true };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderScreen() {
  return render(<AssetHoldingsScreen />, { wrapper: makeWrapper() });
}

function dashboardCallArgs() {
  return mockUseDashboardQuery.mock.calls.map(([args]) => args);
}

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  mockUseDashboardQuery.mockReturnValue(dashboardIdle() as never);
  mockUseTrackedWalletsQuery.mockReturnValue(trackedWalletsSuccess([WALLET_A, WALLET_B]) as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssetHoldingsScreen — forwarded URL context selects the correct wallet", () => {
  it("selects the tracked wallet matching a valid forwarded walletAddress + chainId", () => {
    nav.search = `walletAddress=${WALLET_B.address}&chainId=369`;
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({
      walletAddress: WALLET_B.address,
      chainId: WALLET_B.chainId,
      enabled: true,
    });
    expect(screen.getByRole("button", { name: WALLET_B.label! })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("matches case-insensitively", () => {
    nav.search = `walletAddress=${WALLET_B.address.toUpperCase()}&chainId=369`;
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_B.address, enabled: true });
  });
});

describe("AssetHoldingsScreen — no URL context preserves existing default behavior", () => {
  it("selects wallets[0] when no query params are present", () => {
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_A.address, chainId: WALLET_A.chainId });
  });
});

describe("AssetHoldingsScreen — invalid or unmatched context is ignored", () => {
  it("falls back to wallets[0] for an unsupported chainId", () => {
    nav.search = `walletAddress=${WALLET_B.address}&chainId=1`;
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_A.address });
  });

  it("falls back to wallets[0] for a malformed chainId", () => {
    nav.search = `walletAddress=${WALLET_B.address}&chainId=abc`;
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_A.address });
  });

  it("falls back to wallets[0] when the forwarded wallet is not tracked", () => {
    nav.search = `walletAddress=0x3333333333333333333333333333333333333333&chainId=369`;
    renderScreen();
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_A.address });
  });
});

describe("AssetHoldingsScreen — manual wallet-switch behavior preserved", () => {
  it("clicking a wallet button still overrides the forwarded URL context", () => {
    nav.search = `walletAddress=${WALLET_A.address}&chainId=369`;
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: WALLET_B.label! }));
    const lastCall = dashboardCallArgs().at(-1)!;
    expect(lastCall).toMatchObject({ walletAddress: WALLET_B.address });
  });
});
