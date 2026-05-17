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

vi.mock("@/lib/api/dashboard-client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  fetchDebugHealth: vi.fn(async () => ({
    status: "ok",
    dependencies: {
      database: { status: "ok" },
      redis: { status: "ok" },
    },
  })),
  fetchDebugStatus: vi.fn(async () => ({
    sourceFamilies: ["pulsechain"],
  })),
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

const PRIMARY_WALLET: TrackedWalletDto = {
  id: "wallet-primary",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LATER_IMPORTED_WALLET: TrackedWalletDto = {
  id: "wallet-later-imported",
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  chainId: 369,
  label: "Imported later",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const mockUseDashboardQuery = vi.mocked(useDashboardQuery);
const mockUseDebugHealthQuery = vi.mocked(useDebugHealthQuery);
const mockUseDebugStatusQuery = vi.mocked(useDebugStatusQuery);
const mockUseTrackedWalletsQuery = vi.mocked(useTrackedWalletsQuery);

type TrackedWalletsState = {
  wallets: TrackedWalletDto[] | undefined;
  isSuccess: boolean;
  isError: boolean;
  isPending: boolean;
};

let trackedWalletsState: TrackedWalletsState;

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(DashboardScreen),
    ),
  );
}

function setTrackedWalletsState(state: TrackedWalletsState) {
  trackedWalletsState = state;
}

function healthyTrackedWallets(wallets: TrackedWalletDto[]): TrackedWalletsState {
  return {
    wallets,
    isSuccess: true,
    isError: false,
    isPending: false,
  };
}

function erroredTrackedWallets(wallets: TrackedWalletDto[] | undefined): TrackedWalletsState {
  return {
    wallets,
    isSuccess: false,
    isError: true,
    isPending: false,
  };
}

describe("DashboardScreen submitted wallet source behavior", () => {
  beforeEach(() => {
    setTrackedWalletsState(healthyTrackedWallets([PRIMARY_WALLET]));
    mockUseTrackedWalletsQuery.mockImplementation(() => ({
      data: trackedWalletsState.wallets === undefined
        ? undefined
        : { wallets: trackedWalletsState.wallets },
      isSuccess: trackedWalletsState.isSuccess,
      isError: trackedWalletsState.isError,
      isPending: trackedWalletsState.isPending,
    } as ReturnType<typeof useTrackedWalletsQuery>));
    mockUseDashboardQuery.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    } as ReturnType<typeof useDashboardQuery>);
    mockUseDebugHealthQuery.mockReturnValue({
      data: {
        status: "ok",
        dependencies: {
          database: { status: "ready" },
          redis: { status: "ready" },
        },
      },
      error: null,
      isError: false,
    } as ReturnType<typeof useDebugHealthQuery>);
    mockUseDebugStatusQuery.mockReturnValue({
      data: {
        sourceFamilies: ["pulsechain"],
      },
      error: null,
      isError: false,
    } as ReturnType<typeof useDebugStatusQuery>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("disables dashboard metadata polling through shared debug query hooks", () => {
    renderDashboard();

    expect(mockUseDebugHealthQuery).toHaveBeenCalledWith({ refetchInterval: false });
    expect(mockUseDebugStatusQuery).toHaveBeenCalledWith({ refetchInterval: false });
  });

  it("selecting a tracked wallet then submitting shows the submit-time tracked source", () => {
    renderDashboard();

    fireEvent.click(
      screen.getByRole("button", { name: `Select wallet ${PRIMARY_WALLET.address}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

    expect(screen.getByText("Submitted from tracked wallet: Primary")).toBeInTheDocument();
  });

  it("manual address submit shows the submit-time manual source", () => {
    renderDashboard();

    fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
      target: { value: LATER_IMPORTED_WALLET.address },
    });
    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

    expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();
  });

  it("does not flip a submitted manual source when later tracked-wallet data includes that address", () => {
    const view = renderDashboard();

    fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
      target: { value: LATER_IMPORTED_WALLET.address },
    });
    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));
    expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();

    setTrackedWalletsState(healthyTrackedWallets([PRIMARY_WALLET, LATER_IMPORTED_WALLET]));
    view.rerender(
      React.createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        React.createElement(DashboardScreen),
      ),
    );

    expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();
    expect(screen.queryByText("Submitted from tracked wallet: Imported later")).toBeNull();
  });

  it("does not flip a submitted tracked source when later tracked-wallet query state is error with stale data", () => {
    const view = renderDashboard();

    fireEvent.click(
      screen.getByRole("button", { name: `Select wallet ${PRIMARY_WALLET.address}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));
    expect(screen.getByText("Submitted from tracked wallet: Primary")).toBeInTheDocument();

    setTrackedWalletsState(erroredTrackedWallets([PRIMARY_WALLET]));
    view.rerender(
      React.createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        React.createElement(DashboardScreen),
      ),
    );

    expect(screen.getByText("Submitted from tracked wallet: Primary")).toBeInTheDocument();
    expect(screen.queryByText("Submitted from manual entry")).toBeNull();
  });

  it("does not show selected tracked wallet helper from stale data when tracked-wallet query is error", () => {
    setTrackedWalletsState(erroredTrackedWallets([PRIMARY_WALLET]));

    renderDashboard();

    fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
      target: { value: PRIMARY_WALLET.address },
    });

    expect(screen.getByText(/Could not load tracked wallets/i)).toBeInTheDocument();
    expect(screen.queryByText(/Selected tracked wallet:/i)).toBeNull();
  });

  it("matches padded address and chainId 0369 to the same tracked wallet at submit time", () => {
    renderDashboard();

    fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
      target: { value: `  ${PRIMARY_WALLET.address.toUpperCase()}  ` },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Chain ID" }), {
      target: { value: "0369" },
    });

    expect(screen.getByText(/Selected tracked wallet: Primary/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

    expect(screen.getByText("Submitted from tracked wallet: Primary")).toBeInTheDocument();
  });

  it("dashboard fetch remains gated to explicit submit", () => {
    renderDashboard();

    expect(mockUseDashboardQuery).toHaveBeenLastCalledWith({
      walletAddress: "",
      chainId: 0,
      quoteAsset: "fiat:usd",
      enabled: false,
    });

    fireEvent.click(
      screen.getByRole("button", { name: `Select wallet ${PRIMARY_WALLET.address}` }),
    );

    expect(mockUseDashboardQuery).toHaveBeenLastCalledWith({
      walletAddress: "",
      chainId: 0,
      quoteAsset: "fiat:usd",
      enabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

    expect(mockUseDashboardQuery).toHaveBeenLastCalledWith({
      walletAddress: PRIMARY_WALLET.address,
      chainId: 369,
      quoteAsset: "fiat:usd",
      enabled: true,
    });
  });
});
