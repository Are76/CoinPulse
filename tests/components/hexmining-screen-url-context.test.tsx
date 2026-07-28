/**
 * HexMiningScreen URL navigation-context behavior.
 *
 * HexMining remains PulseChain-only (chainId 369, no chain input). A URL
 * walletAddress seeds the draft field only — never a fetch. chainId is
 * accepted from the URL only when it matches 369; anything else is ignored.
 * Explicit submit updates the URL once with chainId=369.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HexMiningScreen } from "@/components/hexmining/hexmining-screen";
import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";
import { useHexMiningEndedStakesQuery } from "@/lib/query/use-hexmining-ended-stakes-query";

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/hexmining",
}));

vi.mock("@/lib/query/use-hexmining-stakes-query", () => ({
  useHexMiningStakesQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-hexmining-ended-stakes-query", () => ({
  useHexMiningEndedStakesQuery: vi.fn(),
}));

const mockStakesQuery = vi.mocked(useHexMiningStakesQuery);
const mockEndedStakesQuery = vi.mocked(useHexMiningEndedStakesQuery);

const URL_WALLET = "0x2222222222222222222222222222222222222222";

function idleQuery() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    error: null,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderScreen() {
  return render(<HexMiningScreen />, { wrapper: makeWrapper() });
}

function stakesEnabledCalls() {
  return mockStakesQuery.mock.calls.filter(([args]) => args?.enabled === true);
}

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  mockStakesQuery.mockReturnValue(idleQuery() as never);
  mockEndedStakesQuery.mockReturnValue(idleQuery() as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HexMiningScreen — URL params populate the wallet draft only", () => {
  it("populates the wallet field from walletAddress + chainId=369", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);
  });

  it("populates the wallet field from walletAddress alone", () => {
    nav.search = `walletAddress=${URL_WALLET}`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);
  });

  it("never fetches before an explicit submit", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    expect(stakesEnabledCalls()).toHaveLength(0);
    expect(
      mockEndedStakesQuery.mock.calls.filter(([args]) => args?.enabled === true),
    ).toHaveLength(0);
    expect(screen.getByText("No wallet selected")).toBeInTheDocument();
  });

  it("ignores an unsupported chainId entirely", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=1`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
    expect(stakesEnabledCalls()).toHaveLength(0);
  });

  it("ignores a non-integer chainId entirely", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=abc`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
  });

  it("does not add a chain ID input — HexMining stays PulseChain-only", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    expect(screen.queryByLabelText("Chain ID")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
});

describe("HexMiningScreen — explicit submit and URL updates", () => {
  it("explicit submit queries with chainId 369 and updates the URL once", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    renderScreen();
    const input = screen.getByLabelText("Wallet address");
    fireEvent.submit(input.closest("form")!);

    const enabled = stakesEnabledCalls();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.at(-1)![0]).toMatchObject({
      walletAddress: URL_WALLET,
      chainId: 369,
    });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(
      `/hexmining?walletAddress=${URL_WALLET}&chainId=369`,
      { scroll: false },
    );
  });

  it("draft typing does not update the URL", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Wallet address"), {
      target: { value: URL_WALLET },
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("an invalid submit does not update the URL", () => {
    renderScreen();
    const input = screen.getByLabelText("Wallet address");
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("HexMiningScreen — same-route URL changes", () => {
  it("updates the wallet draft when the URL context changes while mounted", () => {
    nav.search = `walletAddress=${URL_WALLET}&chainId=369`;
    const { rerender } = renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(URL_WALLET);

    const nextWallet = "0x3333333333333333333333333333333333333333";
    nav.search = `walletAddress=${nextWallet}&chainId=369`;
    rerender(<HexMiningScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(nextWallet);

    // User edits are not overwritten without a real URL change
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: "0xedit" } });
    rerender(<HexMiningScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue("0xedit");
    expect(stakesEnabledCalls()).toHaveLength(0);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
