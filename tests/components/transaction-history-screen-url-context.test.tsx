/**
 * TransactionHistoryScreen URL navigation-context behavior.
 *
 * Preserves the established drill-down contract:
 * - walletAddress + chainId + assetId → one-time auto-submit per URL context
 * - walletAddress + chainId without assetId → draft fields only, no auto-submit
 * Fixes the same-route URL synchronization gap: search-param changes while
 * mounted update draft state without loops or repeated submissions.
 * Explicit submit updates the URL once with walletAddress + chainId only.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionHistoryScreen } from "@/components/transactions/transaction-history-screen";
import { useTransactionsQuery } from "@/lib/query/use-transactions-query";

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/transactions",
}));

vi.mock("@/lib/query/use-transactions-query", () => ({
  useTransactionsQuery: vi.fn(),
}));

const mockTransactionsQuery = vi.mocked(useTransactionsQuery);

const WALLET = "0x2222222222222222222222222222222222222222";
const ASSET_ID = "chain:369:erc20:0x4444444444444444444444444444444444444444";

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
  return render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
}

function enabledCalls() {
  return mockTransactionsQuery.mock.calls.filter(([args]) => args.enabled === true);
}

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  mockTransactionsQuery.mockReturnValue(idleQuery() as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Draft-only URL context (no assetId) ──────────────────────────────────────

describe("TransactionHistoryScreen — walletAddress + chainId without assetId", () => {
  it("fills draft fields only", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(WALLET);
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
  });

  it("does not auto-submit", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    renderScreen();
    expect(enabledCalls()).toHaveLength(0);
    expect(screen.getByText("No query submitted")).toBeInTheDocument();
  });
});

// ── Drill-down contract (with assetId) ───────────────────────────────────────

describe("TransactionHistoryScreen — drill-down contract with assetId", () => {
  it("auto-submits once with the assetId filter", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369&assetId=${encodeURIComponent(ASSET_ID)}`;
    renderScreen();
    const enabled = enabledCalls();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.at(-1)![0]).toMatchObject({
      walletAddress: WALLET,
      chainId: 369,
      filters: { assetId: ASSET_ID },
    });
  });

  it("the drill-down auto-submit does not rewrite the URL", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369&assetId=${encodeURIComponent(ASSET_ID)}`;
    renderScreen();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("does not resubmit the same drill-down on rerenders with unchanged params", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369&assetId=${encodeURIComponent(ASSET_ID)}`;
    const { rerender } = renderScreen();
    const callsAfterMount = mockTransactionsQuery.mock.calls.length;
    rerender(<TransactionHistoryScreen />);
    // A resubmission would trigger extra state-change renders; a plain rerender
    // re-invokes the hook exactly once.
    expect(mockTransactionsQuery.mock.calls.length).toBe(callsAfterMount + 1);
  });
});

// ── Validated navigation helper for URL seeding ──────────────────────────────

describe("TransactionHistoryScreen — walletAddress/chainId seeding uses the validated helper", () => {
  it("an unsupported chainId cannot auto-submit the drill-down", () => {
    nav.search = `walletAddress=${WALLET}&chainId=1&assetId=${encodeURIComponent(ASSET_ID)}`;
    renderScreen();
    expect(enabledCalls()).toHaveLength(0);
  });

  it("an unsupported chainId does not seed the wallet or chain draft", () => {
    nav.search = `walletAddress=${WALLET}&chainId=1`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
  });

  it("a malformed chainId cannot seed the draft", () => {
    nav.search = `walletAddress=${WALLET}&chainId=abc`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
  });

  it("a malformed chainId cannot auto-submit even with assetId present", () => {
    nav.search = `walletAddress=${WALLET}&chainId=abc&assetId=${encodeURIComponent(ASSET_ID)}`;
    renderScreen();
    expect(enabledCalls()).toHaveLength(0);
    expect(screen.getByText("No query submitted")).toBeInTheDocument();
  });

  it("a valid supported chainId still seeds the draft and auto-submits with assetId", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369&assetId=${encodeURIComponent(ASSET_ID)}`;
    renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(WALLET);
    expect(screen.getByLabelText("Chain ID")).toHaveValue("369");
    const enabled = enabledCalls();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.at(-1)![0]).toMatchObject({
      walletAddress: WALLET,
      chainId: 369,
      filters: { assetId: ASSET_ID },
    });
  });

  it("a same-route change from valid to unsupported chain clears the draft, without looping", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    const { rerender } = renderScreen();
    expect(screen.getByLabelText("Wallet address")).toHaveValue(WALLET);

    nav.search = `walletAddress=${WALLET}&chainId=1`;
    rerender(<TransactionHistoryScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
    expect(enabledCalls()).toHaveLength(0);

    // The same valid context re-applies cleanly afterward
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    rerender(<TransactionHistoryScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(WALLET);
    expect(enabledCalls()).toHaveLength(0);
  });
});

// ── Same-route URL synchronization ───────────────────────────────────────────

describe("TransactionHistoryScreen — same-route search-param changes", () => {
  it("synchronizes draft fields when search params change while mounted", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    const { rerender } = renderScreen();

    const nextWallet = "0x3333333333333333333333333333333333333333";
    nav.search = `walletAddress=${nextWallet}&chainId=369`;
    rerender(<TransactionHistoryScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(nextWallet);
    expect(enabledCalls()).toHaveLength(0);
  });

  it("a new drill-down while mounted syncs drafts and auto-submits", () => {
    nav.search = "";
    const { rerender } = renderScreen();
    expect(enabledCalls()).toHaveLength(0);

    nav.search = `walletAddress=${WALLET}&chainId=369&assetId=${encodeURIComponent(ASSET_ID)}`;
    rerender(<TransactionHistoryScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue(WALLET);
    expect(screen.getByLabelText("Asset ID filter")).toHaveValue(ASSET_ID);
    const enabled = enabledCalls();
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.at(-1)![0]).toMatchObject({
      walletAddress: WALLET,
      chainId: 369,
      filters: { assetId: ASSET_ID },
    });
  });

  it("does not overwrite user typing without a real search-param change", () => {
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    const { rerender } = renderScreen();
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: "0xedit" } });
    rerender(<TransactionHistoryScreen />);
    expect(screen.getByLabelText("Wallet address")).toHaveValue("0xedit");
  });
});

// ── Explicit submit URL updates ──────────────────────────────────────────────

describe("TransactionHistoryScreen — explicit submit URL updates", () => {
  it("updates the URL once with walletAddress + chainId only (no assetId)", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(walletInput, { target: { value: WALLET } });
    fireEvent.change(screen.getByLabelText("Asset ID filter"), {
      target: { value: ASSET_ID },
    });
    fireEvent.submit(walletInput.closest("form")!);

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(
      `/transactions?walletAddress=${WALLET}&chainId=369`,
      { scroll: false },
    );
    // The submitted query still carries the assetId filter — only the URL omits it
    expect(enabledCalls().at(-1)![0]).toMatchObject({
      walletAddress: WALLET,
      chainId: 369,
      filters: { assetId: ASSET_ID },
    });
  });

  it("the URL replace after submit does not clear filter drafts or resubmit", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(walletInput, { target: { value: WALLET } });
    fireEvent.change(screen.getByLabelText("Asset ID filter"), {
      target: { value: ASSET_ID },
    });
    fireEvent.submit(walletInput.closest("form")!);

    // Simulate the router applying the replaced URL while mounted
    nav.search = `walletAddress=${WALLET}&chainId=369`;
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "10" } });
    expect(screen.getByLabelText("Asset ID filter")).toHaveValue(ASSET_ID);
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("draft edits do not update the URL", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: WALLET } });
    fireEvent.change(screen.getByLabelText("Chain ID"), { target: { value: "369" } });
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "25" } });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("an invalid submit does not update the URL", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.submit(walletInput.closest("form")!);
    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("keeps existing limit and filter inputs in the submitted query args", () => {
    renderScreen();
    const walletInput = screen.getByLabelText("Wallet address");
    fireEvent.change(walletInput, { target: { value: WALLET } });
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Action type filter"), {
      target: { value: "TRANSFER" },
    });
    fireEvent.submit(walletInput.closest("form")!);
    expect(enabledCalls().at(-1)![0]).toMatchObject({
      walletAddress: WALLET,
      chainId: 369,
      limit: 25,
      filters: { actionType: "TRANSFER" },
    });
  });
});
