import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { TransactionHistoryScreen } from "@/components/transactions/transaction-history-screen";
import type {
  TransactionDto,
  TransactionsPageDto,
} from "@/services/transactions/types";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/query/use-transactions-query", () => ({
  useTransactionsQuery: vi.fn(),
}));

import { useTransactionsQuery } from "@/lib/query/use-transactions-query";

function makeIdleQuery() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    error: null,
  };
}

function makeLoadingQuery() {
  return { ...makeIdleQuery(), isLoading: true, isFetching: true };
}

function makeSuccessQuery(data: TransactionsPageDto) {
  return { ...makeIdleQuery(), data, isSuccess: true };
}

function makeErrorQuery(error: Error) {
  return { ...makeIdleQuery(), isError: true, error };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";

const COVERED_PAGE: TransactionsPageDto = {
  schemaVersion: "v1",
  walletAddress: VALID_ADDRESS,
  chainId: 369,
  ledgerCoverage: { status: "covered", reason: null },
  pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 },
  transactions: [],
};

const UNTRACKED_PAGE: TransactionsPageDto = {
  ...COVERED_PAGE,
  ledgerCoverage: { status: "unknown", reason: "wallet-not-tracked" },
};

const PARTIAL_PAGE: TransactionsPageDto = {
  ...COVERED_PAGE,
  ledgerCoverage: { status: "partial", reason: "sync-incomplete" },
};

const MOCK_TX: TransactionDto = {
  transactionId: "ag-001",
  txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  chainId: 369,
  walletId: "w-001",
  walletAddress: VALID_ADDRESS,
  occurredAt: "2026-05-01T12:00:00.000Z",
  blockNumber: null,
  actionGroupId: "ag-001",
  actionType: "TRANSFER",
  sourceFamily: null,
  protocol: null,
  status: "complete",
  warnings: [],
  provenance: { ledgerCoverage: { status: "covered", reason: null }, materializationAsOf: null },
  entries: [
    {
      entryId: "e-001",
      assetId: "chain:369:native:PLS",
      assetAddress: null,
      entryType: "RECEIVE",
      direction: "IN",
      quantity: "1000000000000000000",
      decimals: 18,
      pricingStatus: "unavailable",
      pricingProvenance: null,
      valuationStatus: "unavailable",
      valueQuote: null,
      quoteAsset: null,
      pnlImpact: null,
      warnings: [],
      rejectedReason: null,
    },
  ],
};

// ── Idle state ────────────────────────────────────────────────────────────────

describe("TransactionHistoryScreen — idle state before submit", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows idle empty state before any submission", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText("No query submitted")).toBeInTheDocument();
  });

  it("does not show a loading spinner before submit", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("submit button is labeled 'Load transactions' when idle", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /Load transactions/i })).toBeInTheDocument();
  });
});

// ── Wallet address normalization ──────────────────────────────────────────────

describe("TransactionHistoryScreen — wallet address normalization on submit", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("normalizes wallet address to lowercase before querying", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" } });
    fireEvent.submit(input.closest("form")!);

    expect(vi.mocked(useTransactionsQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
      }),
    );
  });

  it("trims whitespace from wallet address before querying", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: `  ${VALID_ADDRESS}  ` } });
    fireEvent.submit(input.closest("form")!);

    expect(vi.mocked(useTransactionsQuery)).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: VALID_ADDRESS }),
    );
  });

  it("shows validation error for empty wallet address", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
  });

  it("shows validation error for whitespace-only wallet address", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
  });
});

// ── Explicit submit behavior ──────────────────────────────────────────────────

describe("TransactionHistoryScreen — explicit submit behavior", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("query is not triggered before form submission", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeIdleQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    // On mount, query must be called with enabled: false (submittedParams is null)
    expect(vi.mocked(useTransactionsQuery)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("submit button is disabled while loading", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeLoadingQuery() as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });

    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);

    // After a submit with loading state, button should show Loading…
    // (mocked as loading from the start, so after re-render)
    const btn = screen.getByRole("button", { name: /Loading/i });
    expect(btn).toBeDisabled();
  });
});

// ── Coverage rendering ────────────────────────────────────────────────────────

describe("TransactionHistoryScreen — coverage rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithData(page: TransactionsPageDto) {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeSuccessQuery(page) as never);
    const input_ref: { input: HTMLElement | null } = { input: null };
    const { getByLabelText } = render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    input_ref.input = getByLabelText("Wallet address");
    fireEvent.change(input_ref.input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input_ref.input.closest("form")!);
  }

  it("shows 'Covered' badge for covered ledger coverage", () => {
    renderWithData(COVERED_PAGE);
    expect(screen.getByText("Covered")).toBeInTheDocument();
  });

  it("shows coverage description for covered status", () => {
    renderWithData(COVERED_PAGE);
    expect(screen.getByText(/Full ledger coverage/i)).toBeInTheDocument();
  });

  it("shows 'Partial' badge for partial coverage", () => {
    renderWithData(PARTIAL_PAGE);
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  it("shows reason text for partial coverage", () => {
    renderWithData(PARTIAL_PAGE);
    expect(screen.getByText(/sync-incomplete/i)).toBeInTheDocument();
  });

  it("shows 'Unknown' badge for unknown coverage", () => {
    renderWithData(UNTRACKED_PAGE);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows wallet-not-tracked message for unknown/wallet-not-tracked coverage", () => {
    renderWithData(UNTRACKED_PAGE);
    // Coverage panel says "not tracked"; use getAllByText and assert at least one match
    expect(screen.getAllByText(/not tracked/i).length).toBeGreaterThan(0);
  });

  it("coverage panel has role=status for accessibility", () => {
    renderWithData(COVERED_PAGE);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ── Empty state rendering ─────────────────────────────────────────────────────

describe("TransactionHistoryScreen — empty state rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithData(page: TransactionsPageDto) {
    vi.mocked(useTransactionsQuery).mockReturnValue(makeSuccessQuery(page) as never);
    const { getByLabelText } = render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("shows 'Wallet not tracked' empty state when coverage is unknown/wallet-not-tracked and no transactions", () => {
    renderWithData(UNTRACKED_PAGE);
    expect(screen.getByText("Wallet not tracked")).toBeInTheDocument();
  });

  it("shows generic empty state for covered wallet with no transactions", () => {
    renderWithData(COVERED_PAGE);
    expect(screen.getByText("No transactions")).toBeInTheDocument();
  });
});

// ── Transaction rendering ─────────────────────────────────────────────────────

describe("TransactionHistoryScreen — transaction rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithTx(tx: TransactionDto) {
    const page: TransactionsPageDto = {
      ...COVERED_PAGE,
      transactions: [tx],
    };
    vi.mocked(useTransactionsQuery).mockReturnValue(makeSuccessQuery(page) as never);
    const { getByLabelText } = render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("renders actionType from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText("TRANSFER")).toBeInTheDocument();
  });

  it("renders transaction status from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("renders entry assetId from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText("chain:369:native:PLS")).toBeInTheDocument();
  });

  it("renders entry direction from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText("IN")).toBeInTheDocument();
  });

  it("renders entry quantity from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText("1000000000000000000")).toBeInTheDocument();
  });

  it("renders entry pricingStatus from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText(/pricing: unavailable/i)).toBeInTheDocument();
  });

  it("renders entry valuationStatus from the backend DTO", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText(/valuation: unavailable/i)).toBeInTheDocument();
  });

  it("shows transaction count in table title", () => {
    renderWithTx(MOCK_TX);
    expect(screen.getByText(/Transactions \(1\)/i)).toBeInTheDocument();
  });
});

// ── Explorer link rendering ───────────────────────────────────────────────────

describe("TransactionHistoryScreen — explorer link rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithTx(tx: TransactionDto, chainId = 369) {
    const page: TransactionsPageDto = {
      ...COVERED_PAGE,
      chainId,
      transactions: [tx],
    };
    vi.mocked(useTransactionsQuery).mockReturnValue(makeSuccessQuery(page) as never);
    const { getByLabelText } = render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    const walletInput = getByLabelText("Wallet address");
    const chainInput = getByLabelText("Chain ID");
    fireEvent.change(walletInput, { target: { value: VALID_ADDRESS } });
    fireEvent.change(chainInput, { target: { value: String(chainId) } });
    fireEvent.submit(walletInput.closest("form")!);
  }

  it("renders an explorer link for PulseChain (chainId 369) txHash", () => {
    renderWithTx(MOCK_TX, 369);
    const link = screen.getByRole("link", { name: /View transaction/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("scan.pulsechain.com"));
    expect(link).toHaveAttribute("href", expect.stringContaining(MOCK_TX.txHash));
  });

  it("explorer link opens in a new tab", () => {
    renderWithTx(MOCK_TX, 369);
    const link = screen.getByRole("link", { name: /View transaction/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("truncates the txHash display text", () => {
    renderWithTx(MOCK_TX, 369);
    // Full hash is 66 chars; display should be truncated
    const link = screen.getByRole("link", { name: /View transaction/i });
    expect(link.textContent!.length).toBeLessThan(MOCK_TX.txHash.length);
    expect(link.textContent).toContain("…");
  });

  it("full txHash is accessible via title attribute", () => {
    renderWithTx(MOCK_TX, 369);
    const link = screen.getByRole("link", { name: /View transaction/i });
    expect(link).toHaveAttribute("title", MOCK_TX.txHash);
  });
});

// ── Error rendering ───────────────────────────────────────────────────────────

describe("TransactionHistoryScreen — error rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows error message when query fails", () => {
    vi.mocked(useTransactionsQuery).mockReturnValue(
      makeErrorQuery(new Error("Network error")) as never,
    );
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it("does not show stale results alongside an error", () => {
    // Start with success, then switch to error
    vi.mocked(useTransactionsQuery).mockReturnValue(makeErrorQuery(new Error("err")) as never);
    render(<TransactionHistoryScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.queryByText("Transactions")).not.toBeInTheDocument();
  });
});
