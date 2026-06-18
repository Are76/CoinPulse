import { afterEach, describe, expect, it, vi } from "vitest";

import type { TransactionsPageDto } from "@/services/transactions/types";
import {
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions/types";

// Keep in outer scope so mock factory closes over it across vi.resetModules() cycles.
const listCanonicalTransactions = vi.fn();

vi.mock("@/services/transactions/transaction-service", () => ({
  listCanonicalTransactions,
}));

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const VALID_CHAIN_ID = 369;

function makeUrl(params: Record<string, string | number | undefined>): string {
  const url = new URL("http://localhost/api/transactions");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function makeEmptyPage(
  walletAddress: string,
  chainId: number,
  limit = 50,
): TransactionsPageDto {
  return {
    schemaVersion: TRANSACTIONS_SCHEMA_VERSION,
    walletAddress,
    chainId,
    ledgerCoverage: {
      status: "unknown",
      reason: "transaction-ledger-query-not-implemented",
    },
    pageInfo: { hasNextPage: false, nextCursor: null, limit },
    transactions: [],
  };
}

describe("GET /api/transactions route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Success: stable envelope shape ──────────────────────────────────────

  it("returns 200 with stable { data: TransactionsPageDto } envelope", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID),
    );

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.schemaVersion).toBe(TRANSACTIONS_SCHEMA_VERSION);
    expect(typeof body.data.walletAddress).toBe("string");
    expect(typeof body.data.chainId).toBe("number");
    expect(body.data.chainId).toBe(VALID_CHAIN_ID);
    expect(body.data.pageInfo).toBeDefined();
    expect(typeof body.data.pageInfo.hasNextPage).toBe("boolean");
    expect(typeof body.data.pageInfo.limit).toBe("number");
    expect("nextCursor" in body.data.pageInfo).toBe(true);
    expect(body.data.ledgerCoverage).toBeDefined();
    expect(["covered", "partial", "unknown"]).toContain(body.data.ledgerCoverage.status);
    expect(Array.isArray(body.data.transactions)).toBe(true);
    expect(listCanonicalTransactions).toHaveBeenCalledOnce();
  });

  // ── 2. Empty result ─────────────────────────────────────────────────────────

  it("returns 200 with empty transactions and stable pageInfo when service returns nothing", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID),
    );

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.transactions).toEqual([]);
    expect(body.data.pageInfo.hasNextPage).toBe(false);
    expect(body.data.pageInfo.nextCursor).toBeNull();
  });

  // ── 3. Validation: walletAddress ────────────────────────────────────────────

  it("returns 400 INVALID_INPUT when walletAddress is missing", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when walletAddress is not a valid EVM address", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: "not-an-address", chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when walletAddress is too short (not 40 hex chars after 0x)", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: "0x1234", chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  // ── 4. Validation: chainId ──────────────────────────────────────────────────

  it("returns 400 INVALID_INPUT when chainId is missing", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when chainId is zero", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: 0 })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when chainId is negative", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: -1 })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when chainId is a non-numeric string", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const url = new URL("http://localhost/api/transactions");
    url.searchParams.set("walletAddress", VALID_ADDRESS);
    url.searchParams.set("chainId", "not-a-number");

    const response = await GET(new Request(url.toString()));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  // ── 5. Validation: limit ────────────────────────────────────────────────────

  it("returns 400 INVALID_INPUT when limit exceeds TRANSACTIONS_MAX_LIMIT (100)", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, limit: TRANSACTIONS_MAX_LIMIT + 1 }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when limit is fractional", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, limit: 1.5 })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when limit is zero", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, limit: 0 })),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("accepts limit equal to TRANSACTIONS_MAX_LIMIT (100)", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID, TRANSACTIONS_MAX_LIMIT),
    );

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, limit: TRANSACTIONS_MAX_LIMIT }),
      ),
    );

    expect(response.status).toBe(200);
    expect(listCanonicalTransactions).toHaveBeenCalledOnce();
  });

  // ── 6. Validation: date filters ─────────────────────────────────────────────

  it("returns 400 INVALID_INPUT when fromDate is not a valid ISO datetime", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, fromDate: "not-a-date" }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when toDate is not a valid ISO datetime", async () => {
    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(
        makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID, toDate: "2026-13-99" }),
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(listCanonicalTransactions).not.toHaveBeenCalled();
  });

  it("accepts valid ISO datetime strings for fromDate and toDate", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID),
    );

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(
        makeUrl({
          walletAddress: VALID_ADDRESS,
          chainId: VALID_CHAIN_ID,
          fromDate: "2026-01-01T00:00:00.000Z",
          toDate: "2026-06-01T00:00:00.000Z",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(listCanonicalTransactions).toHaveBeenCalledOnce();
  });

  // ── 7. Service call args ────────────────────────────────────────────────────

  it("normalises walletAddress to lowercase before calling service", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID),
    );

    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const { GET } = await import("../../app/api/transactions/route");
    await GET(new Request(makeUrl({ walletAddress: mixedCase, chainId: VALID_CHAIN_ID })));

    expect(listCanonicalTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: mixedCase.toLowerCase() }),
    );
  });

  it("passes chainId as a number to service", async () => {
    listCanonicalTransactions.mockResolvedValue(
      makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID),
    );

    const { GET } = await import("../../app/api/transactions/route");
    await GET(new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })));

    expect(listCanonicalTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: VALID_CHAIN_ID }),
    );
  });

  // ── 8. Internal error → 500, no stack leakage ──────────────────────────────

  it("returns 500 INTERNAL_ERROR with safe envelope and no internal details when service throws", async () => {
    const secretDetail = "secret-host:5432/internal-db";
    listCanonicalTransactions.mockRejectedValue(
      new Error(`database connection refused: ${secretDetail}`),
    );

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error.");
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("database connection refused");
    expect(bodyText).not.toContain("stack");
    expect(listCanonicalTransactions).toHaveBeenCalledOnce();
  });

  // ── 9. No raw log fields in response ────────────────────────────────────────

  it("does not expose raw log fields in the response envelope", async () => {
    const page: TransactionsPageDto = {
      schemaVersion: TRANSACTIONS_SCHEMA_VERSION,
      walletAddress: VALID_ADDRESS.toLowerCase(),
      chainId: VALID_CHAIN_ID,
      ledgerCoverage: { status: "covered", reason: null },
      pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 },
      transactions: [
        {
          transactionId: "ag-1",
          txHash: "0xdeadbeef",
          chainId: VALID_CHAIN_ID,
          walletId: "wallet-1",
          walletAddress: VALID_ADDRESS.toLowerCase(),
          occurredAt: "2026-05-01T12:00:00.000Z",
          blockNumber: null,
          actionGroupId: "ag-1",
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
              entryId: "e-1",
              assetId: "chain:369:native:0x0000000000000000000000000000000000000000",
              assetAddress: null,
              entryType: "TRANSFER_OUT",
              direction: "OUT",
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

    listCanonicalTransactions.mockResolvedValue(page);

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain("rawLog");
    expect(bodyText).not.toContain("rawTransaction");
    expect(bodyText).not.toContain("rawTokenTransfer");
    expect(bodyText).not.toContain('"topics"');
    expect(bodyText).not.toContain('"logIndex"');
  });

  // ── 10. assetId uses chain-aware identity, not bare symbol/ticker ───────────

  it("entry assetId is a chain-aware backend identity, not a bare symbol or ticker", async () => {
    const chainAwareAssetId = "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const page: TransactionsPageDto = {
      schemaVersion: TRANSACTIONS_SCHEMA_VERSION,
      walletAddress: VALID_ADDRESS.toLowerCase(),
      chainId: VALID_CHAIN_ID,
      ledgerCoverage: { status: "covered", reason: null },
      pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 },
      transactions: [
        {
          transactionId: "ag-2",
          txHash: "0xdeadbeef02",
          chainId: VALID_CHAIN_ID,
          walletId: "wallet-1",
          walletAddress: VALID_ADDRESS.toLowerCase(),
          occurredAt: "2026-05-01T12:00:00.000Z",
          blockNumber: null,
          actionGroupId: "ag-2",
          actionType: "SWAP",
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
              entryId: "e-2",
              assetId: chainAwareAssetId,
              assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              entryType: "SWAP_IN",
              direction: "IN",
              quantity: "500000000000000000",
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

    listCanonicalTransactions.mockResolvedValue(page);

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const entry = body.data.transactions[0].entries[0];
    expect(entry.assetId).toBe(chainAwareAssetId);
    expect(entry.assetId).toContain("chain:");
    // Must not be a bare ticker like "PLS", "ETH", "USDC"
    expect(entry.assetId).not.toMatch(/^[A-Z]{2,6}$/);
  });

  // ── 11. ledgerCoverage present and explicit in response ─────────────────────

  it("response carries ledgerCoverage.status from the service, not fabricated by route", async () => {
    const page = makeEmptyPage(VALID_ADDRESS.toLowerCase(), VALID_CHAIN_ID);
    listCanonicalTransactions.mockResolvedValue(page);

    const { GET } = await import("../../app/api/transactions/route");
    const response = await GET(
      new Request(makeUrl({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.ledgerCoverage).toBeDefined();
    expect(body.data.ledgerCoverage.status).toBe("unknown");
    expect(typeof body.data.ledgerCoverage.reason).toBe("string");
    // Skeleton must not claim full coverage
    expect(body.data.ledgerCoverage.status).not.toBe("covered");
  });
});
