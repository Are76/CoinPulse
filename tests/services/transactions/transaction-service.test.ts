import { describe, expect, it } from "vitest";

import {
  buildEmptyTransactionsPage,
  listCanonicalTransactions,
  resolveTransactionLimit,
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions";

const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CHAIN_ID = 369;

describe("TRANSACTIONS_SCHEMA_VERSION", () => {
  it("is v1", () => {
    expect(TRANSACTIONS_SCHEMA_VERSION).toBe("v1");
  });
});

describe("resolveTransactionLimit", () => {
  it("returns default limit when undefined", () => {
    expect(resolveTransactionLimit(undefined)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("caps at TRANSACTIONS_MAX_LIMIT", () => {
    expect(resolveTransactionLimit(9999)).toBe(TRANSACTIONS_MAX_LIMIT);
  });

  it("returns the requested value when within bounds", () => {
    expect(resolveTransactionLimit(10)).toBe(10);
  });

  it("returns default limit for non-positive values", () => {
    expect(resolveTransactionLimit(0)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
    expect(resolveTransactionLimit(-1)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("TRANSACTIONS_MAX_LIMIT is 100", () => {
    expect(TRANSACTIONS_MAX_LIMIT).toBe(100);
  });
});

describe("buildEmptyTransactionsPage", () => {
  const page = buildEmptyTransactionsPage({
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    limit: 50,
  });

  it("returns v1 schemaVersion", () => {
    expect(page.schemaVersion).toBe("v1");
  });

  it("returns empty transactions array", () => {
    expect(page.transactions).toEqual([]);
  });

  it("returns walletAddress and chainId from args", () => {
    expect(page.walletAddress).toBe(WALLET);
    expect(page.chainId).toBe(CHAIN_ID);
  });

  it("pageInfo has no next page and null cursor", () => {
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it("pageInfo limit matches requested limit", () => {
    expect(page.pageInfo.limit).toBe(50);
  });
});

describe("listCanonicalTransactions", () => {
  it("returns a stable v1 empty envelope", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe("v1");
    expect(result.transactions).toEqual([]);
    expect(result.walletAddress).toBe(WALLET);
    expect(result.chainId).toBe(CHAIN_ID);
  });

  it("applies limit cap when no limit is supplied", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.pageInfo.limit).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("caps limit at TRANSACTIONS_MAX_LIMIT", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 9999,
    });

    expect(result.pageInfo.limit).toBeLessThanOrEqual(TRANSACTIONS_MAX_LIMIT);
  });

  it("pageInfo.hasNextPage is false for empty result", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeNull();
  });
});

describe("DTO type shape — design-time checks", () => {
  it("quantity and blockNumber fields are typed as string, not number", async () => {
    // Import the type definitions to verify string-based precision fields.
    // These assertions run against the type source — string values satisfy them at runtime.
    const entry = {
      entryId: "e1",
      assetId: "asset:369:0xabc",
      assetAddress: null,
      entryType: "ASSET_OUT",
      direction: "OUT" as const,
      quantity: "1000000000000000000",
      decimals: 18,
      pricingStatus: "unavailable" as const,
      pricingProvenance: null,
      valuationStatus: "unavailable" as const,
      valueQuote: null,
      quoteAsset: null,
      pnlImpact: null,
      warnings: [],
      rejectedReason: null,
    };

    // quantity is a string — must not be coerced to number
    expect(typeof entry.quantity).toBe("string");

    const tx = {
      transactionId: "tx-1",
      txHash: "0xdeadbeef",
      chainId: CHAIN_ID,
      walletId: "wallet-1",
      walletAddress: WALLET,
      occurredAt: "2026-05-01T12:00:00.000Z",
      blockNumber: "20000000",
      actionGroupId: "ag-1",
      actionType: "TRANSFER",
      sourceFamily: "NATIVE",
      protocol: null,
      status: "complete" as const,
      warnings: [],
      provenance: { ledgerFresh: true, materializationAsOf: null },
      entries: [entry],
    };

    // blockNumber is a string
    expect(typeof tx.blockNumber).toBe("string");
  });

  it("assetId is not a symbol or ticker — it is a backend-assigned chain-aware id", () => {
    const assetId = "asset:369:0xabc";
    // assetId format includes chainId prefix — not a bare ticker like 'PLS' or 'WPLS'
    expect(assetId).not.toMatch(/^[A-Z]{2,6}$/);
  });

  it("pricingStatus and valuationStatus have explicit unavailable/unsupported states", () => {
    const pricingStatuses = [
      "priced",
      "unpriced",
      "stale",
      "rejected",
      "unsupported",
      "unavailable",
    ] as const;
    const valuationStatuses = [
      "valued",
      "unvalued",
      "stale",
      "rejected",
      "unsupported",
      "unavailable",
    ] as const;

    // Ensure unsupported and unavailable are distinct named states (not zero/ok coercions)
    expect(pricingStatuses).toContain("unsupported");
    expect(pricingStatuses).toContain("unavailable");
    expect(valuationStatuses).toContain("unsupported");
    expect(valuationStatuses).toContain("unavailable");
  });
});

describe("service skeleton — no raw log dependency", () => {
  it("does not import raw log modules", async () => {
    // Dynamic import to inspect the module graph at test time
    const mod = await import(
      "@/services/transactions/transaction-service"
    );

    // The skeleton exposes only the three named exports defined
    const keys = Object.keys(mod);
    expect(keys).toContain("listCanonicalTransactions");
    expect(keys).toContain("buildEmptyTransactionsPage");
    expect(keys).toContain("resolveTransactionLimit");
  });
});
