import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  fetchTransactions,
} from "@/lib/api/transactions-client";
import type { TransactionsPageDto } from "@/services/transactions/types";

const originalFetch = global.fetch;

const MOCK_PAGE: TransactionsPageDto = {
  schemaVersion: "v1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  ledgerCoverage: { status: "covered", reason: null },
  pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 },
  transactions: [],
};

describe("transactions client — fetchTransactions", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── URL construction ──────────────────────────────────────────────────────

  it("requests GET /api/transactions with walletAddress and chainId params", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PAGE }), { status: 200 }),
    ) as typeof fetch;

    await fetchTransactions({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/transactions?walletAddress=0x1111111111111111111111111111111111111111&chainId=369",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("appends limit param when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PAGE }), { status: 200 }),
    ) as typeof fetch;

    await fetchTransactions({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      limit: 10,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/transactions?walletAddress=0x1111111111111111111111111111111111111111&chainId=369&limit=10",
      expect.any(Object),
    );
  });

  it("omits limit param when not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PAGE }), { status: 200 }),
    ) as typeof fetch;

    await fetchTransactions({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("limit");
  });

  // ── DTO passthrough ───────────────────────────────────────────────────────

  it("returns the page DTO from the response data envelope unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: MOCK_PAGE }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchTransactions({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });

    expect(result).toEqual(MOCK_PAGE);
    expect(result.schemaVersion).toBe("v1");
    expect(result.ledgerCoverage).toEqual({ status: "covered", reason: null });
    expect(Array.isArray(result.transactions)).toBe(true);
  });

  it("passes a non-empty transactions array through unchanged", async () => {
    const pageWithTx: TransactionsPageDto = {
      ...MOCK_PAGE,
      transactions: [
        {
          transactionId: "ag-001",
          txHash: "0xdeadbeef",
          chainId: 369,
          walletId: "w-001",
          walletAddress: "0x1111111111111111111111111111111111111111",
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
          entries: [],
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: pageWithTx }), { status: 200 }),
    ) as typeof fetch;

    const result = await fetchTransactions({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionId).toBe("ag-001");
    expect(result.transactions[0].actionType).toBe("TRANSFER");
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("throws ApiClientError with structured fields on a 400 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INPUT",
            message: "walletAddress must be a valid EVM address.",
            details: [{ path: "walletAddress", message: "invalid" }],
          },
        }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchTransactions({ walletAddress: "not-an-address", chainId: 369 }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "INVALID_INPUT",
      message: "walletAddress must be a valid EVM address.",
    });
  });

  it("throws ApiClientError with INTERNAL_ERROR code on a 500 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Internal server error." },
        }),
        { status: 500 },
      ),
    ) as typeof fetch;

    await expect(
      fetchTransactions({
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("throws ApiClientError with UNKNOWN_ERROR code when error body lacks a code", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 503 }),
    ) as typeof fetch;

    await expect(
      fetchTransactions({
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 503,
      code: "UNKNOWN_ERROR",
    });
  });

  it("thrown ApiClientError is an instance of ApiClientError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT", message: "bad" } }),
        { status: 400 },
      ),
    ) as typeof fetch;

    await expect(
      fetchTransactions({ walletAddress: "bad", chainId: 369 }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
