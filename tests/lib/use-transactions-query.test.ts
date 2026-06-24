import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as transactionsClient from "@/lib/api/transactions-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";
import { useTransactionsQuery } from "@/lib/query/use-transactions-query";
import type { TransactionsPageDto } from "@/services/transactions/types";

// ── Wrapper helpers ───────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, Wrapper };
}

function makeRetryingWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;

const MOCK_PAGE: TransactionsPageDto = {
  schemaVersion: "v1",
  walletAddress: VALID_ADDRESS,
  chainId: CHAIN_ID,
  ledgerCoverage: { status: "covered", reason: null },
  pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 },
  transactions: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTransactionsQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Query key stability ───────────────────────────────────────────────────

  it("uses the exact shared transactions query key and cache lifetimes", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const expectedQueryKey = queryKeys.transactions("v1", {
      walletAddress: VALID_ADDRESS,
      chainId: CHAIN_ID,
    });

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const matchingQueries = queryClient.getQueryCache().findAll({ queryKey: expectedQueryKey });
    expect(matchingQueries).toHaveLength(1);
    expect(matchingQueries[0].queryKey).toEqual(expectedQueryKey);
    const cacheOptions = matchingQueries[0].options as { gcTime?: unknown; staleTime?: unknown };
    expect(cacheOptions.staleTime).toBe(QUERY_DEFAULTS.transactions.staleTime);
    expect(cacheOptions.gcTime).toBe(QUERY_DEFAULTS.transactions.gcTime);
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([
      expectedQueryKey,
    ]);
  });

  it("normalises walletAddress to lowercase in the query key", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);
    const { queryClient, Wrapper } = makeQueryClientWrapper();
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";

    renderHook(
      () => useTransactionsQuery({ walletAddress: mixedCase, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    const key = cachedQuery.queryKey as unknown[];
    // filters object is the third element
    const filters = key[2] as Record<string, unknown>;
    expect(filters.walletAddress).toBe(mixedCase.toLowerCase());
    expect(filters.walletAddress).not.toBe(mixedCase);
  });

  it("two calls with the same normalised address share a single cache entry", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS.toUpperCase(), chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );
    renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS.toLowerCase(), chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );
  });

  it("includes limit in the query key when provided", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID, limit: 10 }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [cachedQuery] = queryClient.getQueryCache().getAll();
    const key = cachedQuery.queryKey as unknown[];
    const filters = key[2] as Record<string, unknown>;
    expect(filters.limit).toBe(10);
  });

  // ── Hook wiring ───────────────────────────────────────────────────────────

  it("calls fetchTransactions with walletAddress, chainId, and no limit by default", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(transactionsClient.fetchTransactions).toHaveBeenCalledWith({
      walletAddress: VALID_ADDRESS,
      chainId: CHAIN_ID,
      limit: undefined,
    });
  });

  it("forwards limit to fetchTransactions when provided", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID, limit: 25 }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(transactionsClient.fetchTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  it("trims walletAddress whitespace before passing to fetchTransactions", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () =>
        useTransactionsQuery({ walletAddress: `  ${VALID_ADDRESS}  `, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(transactionsClient.fetchTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: VALID_ADDRESS }),
    );
  });

  // ── DTO passthrough ───────────────────────────────────────────────────────

  it("passes the backend TransactionsPageDto through without frontend computation", async () => {
    const pageWithTx: TransactionsPageDto = {
      ...MOCK_PAGE,
      ledgerCoverage: { status: "unknown", reason: "wallet-not-tracked" },
      transactions: [
        {
          transactionId: "ag-001",
          txHash: "0xdeadbeef",
          chainId: CHAIN_ID,
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
          provenance: {
            ledgerCoverage: { status: "covered", reason: null },
            materializationAsOf: null,
          },
          entries: [
            {
              entryId: "e-001",
              assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
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
        },
      ],
    };

    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(pageWithTx);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(pageWithTx);
    expect(result.current.data?.transactions[0].entries[0].assetId).toBe("chain:369:native:0x0000000000000000000000000000000000000000");
    expect(result.current.data?.ledgerCoverage.status).toBe("unknown");
  });

  it("exposes ledgerCoverage.status from the backend DTO unchanged", async () => {
    const coveredPage: TransactionsPageDto = {
      ...MOCK_PAGE,
      ledgerCoverage: { status: "covered", reason: null },
    };
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(coveredPage);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.ledgerCoverage.status).toBe("covered");
  });

  // ── Cache behaviour ───────────────────────────────────────────────────────

  it("staleTime and gcTime come from QUERY_DEFAULTS.transactions", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);
    const { queryClient, Wrapper } = makeQueryClientWrapper();

    renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
    );

    const [q] = queryClient.getQueryCache().getAll();
    const opts = q.options as { staleTime?: unknown; gcTime?: unknown };
    expect(opts.staleTime).toBe(QUERY_DEFAULTS.transactions.staleTime);
    expect(opts.gcTime).toBe(QUERY_DEFAULTS.transactions.gcTime);
  });

  it("does not retry failed queries", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockRejectedValue(
      new transactionsClient.ApiClientError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Invalid input.",
      }),
    );

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(transactionsClient.fetchTransactions).toHaveBeenCalledTimes(1);
  });

  // ── enabled / disabled behaviour ─────────────────────────────────────────

  it("does not fetch when enabled is false", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () =>
        useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID, enabled: false }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(transactionsClient.fetchTransactions).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is empty", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: "", chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(transactionsClient.fetchTransactions).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when walletAddress is whitespace only", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockResolvedValue(MOCK_PAGE);

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: "   ", chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(transactionsClient.fetchTransactions).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("propagates fetch errors through the query error state", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeRetryingWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe("Network error");
  });

  it("propagates ApiClientError through the query error state", async () => {
    vi.spyOn(transactionsClient, "fetchTransactions").mockRejectedValue(
      new transactionsClient.ApiClientError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      }),
    );

    const { result } = renderHook(
      () => useTransactionsQuery({ walletAddress: VALID_ADDRESS, chainId: CHAIN_ID }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(transactionsClient.ApiClientError);
    expect((result.current.error as transactionsClient.ApiClientError).code).toBe("INTERNAL_ERROR");
  });
});
